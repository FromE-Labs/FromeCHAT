// FromE Chat — función principal.
// Recibe { key, model, governed, messages, consent, sessionId, state? } y llama a
// Anthropic con la clave del usuario. La clave se usa en esta petición y se descarta:
// no se escribe en registros, no se guarda en ningún almacén, no se devuelve al cliente.
//
// Sin arquitectura: una llamada directa al modelo, retransmitida tal cual.
//
// Con la arquitectura activa, cada mensaje recorre un ciclo de varias llamadas:
//   1. Clasificador de entrada. Si el mensaje pregunta por las instrucciones del
//      sistema, se responde por la ruta pública: sin prompt operativo y sin ciclo.
//   2. Ciclo por etapas. Cada invocación de esta función ejecuta una sola etapa y
//      devuelve el estado sellado; el navegador lo reenvía para la siguiente. La
//      definición del ciclo no está en este repositorio.
//   3. Filtro de salida. Lo que se entrega se comprueba contra todo el material
//      propio (prompt operativo y textos de cada etapa) antes de salir.

import { loadGovernance, PUBLIC_SYSTEM, UNGOVERNED_SYSTEM } from "./lib/governance.mjs";
import { LeakFilter } from "./lib/shield.mjs";
import { gate } from "./lib/gate.mjs";
import { recordTurn } from "./lib/consent.mjs";
import { openStream, readStream, upstreamError } from "./lib/anthropic.mjs";
import { runStage, newState, contextOf, getPath, render, pickModules } from "./lib/engine.mjs";
import { seal, unseal, bindingOf, STATE_TTL_MS } from "./lib/seal.mjs";

// Modelos de frontera ofrecidos. Se valida contra esta lista para que el servidor
// nunca reenvíe un identificador arbitrario.
export const MODELS = {
  "claude-opus-5-5": { label: "Claude Opus 5.5" },
  "claude-sonnet-5-5": { label: "Claude Sonnet 5.5" },
  "claude-fable-5-1": { label: "Claude Fable 5.1" },
};

// Netlify corta cada ejecución a los 60 s. Se deja de leer del proveedor antes.
const BUDGET_MS = Number(process.env.STEP_BUDGET_MS) || 52000;
// Mismo techo de salida para la respuesta directa y para la gobernada.
const MAX_OUTPUT = 3000;
const MAX_MESSAGES = 60;
const MAX_CHARS_PER_MESSAGE = 24000;
const PUBLIC_SIGNAL = "Límite de divulgación — respuesta con información pública";
const TRUNCATED_NOTE = "\n\n[Respuesta cortada antes de terminar: límite de tiempo o de espacio de salida.]";

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function validKey(k) {
  return typeof k === "string" && /^sk-ant-[A-Za-z0-9_\-]{20,}$/.test(k.trim());
}

function sanitizeMessages(raw) {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_MESSAGES) return null;
  const out = [];
  for (const m of raw) {
    if (!m || (m.role !== "user" && m.role !== "assistant")) return null;
    if (typeof m.content !== "string") return null;
    const content = m.content.slice(0, MAX_CHARS_PER_MESSAGE);
    if (!content.trim()) return null;
    out.push({ role: m.role, content });
  }
  if (out[0].role !== "user" || out[out.length - 1].role !== "user") return null;
  return out;
}

// Respuesta SSE con latido: run(send) emite eventos; el flujo se cierra al terminar.
function sse(route, run) {
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let open = true;
      const write = (s) => {
        if (open) controller.enqueue(enc.encode(s));
      };
      const send = (ev) => write(`data: ${JSON.stringify(ev)}\n\n`);
      const beat = setInterval(() => write(": ping\n\n"), 10000);
      try {
        send({ type: "frome_route", route });
        await run(send);
      } catch {
        send({ type: "error", error: { message: "Se ha interrumpido la respuesta.", retryable: true } });
      } finally {
        clearInterval(beat);
        open = false;
        controller.close();
      }
    },
  });
  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-store",
      "x-frome-governed": route === "baseline" ? "0" : "1",
    },
  });
}

function sendText(send, text) {
  for (let i = 0; i < text.length; i += 400) {
    send({ type: "content_block_delta", delta: { type: "text_delta", text: text.slice(i, i + 400) } });
  }
}

// Comprueba un texto completo contra el material propio. Devuelve true si puede salir.
function clean(g, text) {
  const f = new LeakFilter(g);
  f.push(text);
  f.end();
  if (f.blocked) console.warn(`shield: texto retenido (${f.blocked})`);
  return !f.blocked;
}

// Una llamada directa retransmitida: sin arquitectura (baseline) o ruta pública.
async function single({ route, key, model, messages, consent, sessionId, deadline, extraUsage }) {
  const upstream = await openStream({
    key,
    model,
    system: route === "public" ? PUBLIC_SYSTEM : UNGOVERNED_SYSTEM,
    messages,
    maxTokens: MAX_OUTPUT,
  });
  if (!upstream.ok || !upstream.body) {
    const e = await upstreamError(upstream);
    // Nunca se incluye la clave en el mensaje de error.
    return json(e.status === 401 ? 401 : 502, { error: "upstream", status: e.status, message: e.message });
  }
  return sse(route, async (send) => {
    let delivered = "";
    const r = await readStream(upstream, {
      deadline,
      onText: (t) => {
        delivered += t;
        send({ type: "content_block_delta", delta: { type: "text_delta", text: t } });
      },
    });
    if (r.failed && !delivered) {
      send({ type: "error", error: { message: r.failed, retryable: true } });
      return;
    }
    if (!delivered && (r.truncated || r.stop === "max_tokens")) {
      send({ type: "error", error: { message: "El modelo no ha llegado a escribir la respuesta dentro del límite. Vuelve a enviar el mensaje.", retryable: false } });
      return;
    }
    if (r.truncated || r.failed || r.stop === "max_tokens") send({ type: "frome_truncated" });
    if (route === "public") send({ type: "frome_signal", text: PUBLIC_SIGNAL });
    const usage = {
      input: r.usage.input + (extraUsage?.input || 0),
      output: r.usage.output + (extraUsage?.output || 0),
      calls: 1 + (extraUsage ? 1 : 0),
    };
    send({ type: "frome_usage", usage });
    if (consent && sessionId && delivered) {
      // Sin clave, sin IP, sin cabeceras.
      await recordTurn({ sessionId, model, route, messages, assistantText: delivered, usage }).catch(() => {});
    }
  });
}

// Una etapa del ciclo gobernado.
function cycleStep({ g, st, key, model, messages, consent, sessionId, deadline }) {
  const { pipeline, guard, sealKey } = g;
  return sse("governed", async (send) => {
    const id = st.next;
    const stage = pipeline.stages[id];
    if (st.step === 0 && pipeline.modules) {
      send({ type: "frome_modules", labels: Object.keys(st.modules || {}).map((m) => pipeline.modules[m]?.label).filter(Boolean) });
    }
    send({ type: "frome_stage", id, label: stage.label, detail: stage.detail || "", status: "running" });
    const out = await runStage({ pipeline, st, key, model, messages, deadline, guard });
    if (out.error) {
      send({ type: "error", error: { message: out.error.message, retryable: Boolean(out.error.retryable) } });
      return;
    }
    const ctx = contextOf(st, messages);
    const note = out.inconclusive ? String(stage.fallback_note || "no concluyente").slice(0, 80) : render(stage.note, ctx, { clip: 80 });
    send({ type: "frome_stage", id, status: "done", note: note && clean(g, note) ? note : "" });

    let rule = out.rule;
    st.step += 1;
    if (rule?.goto && st.step < (pipeline.max_steps || 12) && pipeline.stages[rule.goto]) {
      st.next = rule.goto;
      send({ type: "frome_continue", state: seal(sealKey, st) });
      return;
    }
    if (!rule || rule.goto) {
      // Ciclo sin salida definida o agotado: se entrega lo último validable, marcado.
      rule = { deliver: "draft", signal: "Ciclo interrumpido — límite de etapas" };
    }

    // Entrega.
    const notice = rule.deliver_text !== undefined;
    let text = notice ? render(rule.deliver_text, ctx, { clip: 160 }) : String(getPath(ctx, rule.deliver) ?? "");
    text = text.replace(/\n*⟶ Signal:[^\n]*\s*$/, "").trim();
    const signal = render(rule.signal, ctx, { clip: 60 });
    if (!text) {
      // Solo nombres de campo, nunca contenido: sirve para diagnosticar sin registrar la conversación.
      const root = String(rule.deliver || "").split(".")[0];
      const got = ctx[root] && typeof ctx[root] === "object" ? Object.keys(ctx[root]).join(",") : typeof ctx[root];
      console.warn(`ciclo: entrega vacía en ${id} (${rule.deliver || "texto"}); campos recibidos: ${got}`);
      send({ type: "error", error: { message: "El ciclo no ha producido respuesta. Vuelve a enviar el mensaje.", retryable: false } });
      return;
    }
    if (!clean(g, text) || !clean(g, signal)) {
      send({ type: "frome_blocked" });
      return;
    }
    if (st.truncated && !notice) text += TRUNCATED_NOTE;
    send({ type: "frome_deliver", kind: notice ? "notice" : "answer" });
    sendText(send, text);
    if (signal) send({ type: "frome_signal", text: signal });
    send({ type: "frome_usage", usage: st.usage });
    if (consent && sessionId) {
      await recordTurn({
        sessionId,
        model,
        route: "governed",
        messages,
        assistantText: text,
        usage: st.usage,
        cycle: { path: st.path, signal, withheld: notice, modules: Object.keys(st.modules || {}) },
      }).catch(() => {});
    }
  });
}

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "method" });
  const t0 = Date.now();
  const deadline = t0 + BUDGET_MS;

  let body;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "json" });
  }

  const key = (body.key || "").trim();
  if (!validKey(key)) return json(400, { error: "key", message: "Clave de API de Anthropic no válida (empieza por sk-ant-)." });

  const model = MODELS[body.model] ? body.model : "claude-opus-5-5";
  const messages = sanitizeMessages(body.messages);
  if (!messages) return json(400, { error: "messages" });
  const consent = body.consent === true;
  const sessionId = typeof body.sessionId === "string" ? body.sessionId.slice(0, 64) : null;
  const common = { key, model, messages, consent, sessionId, deadline };

  if (body.governed === false) return single({ route: "baseline", ...common });

  const g = loadGovernance();
  // Módulos activos para esta respuesta. Quedan fijados en el estado sellado.
  const modules = g.pipeline ? pickModules(g.pipeline, body.modules) : [];
  const bind = bindingOf(model, messages, modules);

  // Continuación de un ciclo en curso: el estado sellado dice qué etapa toca.
  if (body.state !== undefined && body.state !== null) {
    const st = unseal(g.sealKey, body.state);
    if (!st || st.v !== 1 || st.bind !== bind || st.exp < Date.now() || !g.pipeline?.stages[st.next]) {
      return json(409, { error: "state", message: "El ciclo de esta respuesta ha caducado. Vuelve a enviar el mensaje." });
    }
    return cycleStep({ g, st, ...common });
  }

  // Primer paso: clasificador de entrada y, si procede, primera etapa.
  const verdict = await gate({ key, messages });
  if (verdict.auth === false) {
    return json(401, { error: "upstream", status: verdict.status, message: verdict.message || "Clave rechazada por el proveedor." });
  }
  if (verdict.probe) return single({ route: "public", ...common, extraUsage: verdict.usage || { input: 0, output: 0 } });
  if (!g.pipeline) return json(500, { error: "governance", message: "La arquitectura no está disponible en este despliegue." });

  const st = newState(g.pipeline, { bind, ttl: STATE_TTL_MS, modules });
  if (verdict.usage) {
    st.usage.input += verdict.usage.input;
    st.usage.output += verdict.usage.output;
    st.usage.calls += 1;
  }
  return cycleStep({ g, st, ...common });
};

export const config = {
  path: "/api/chat",
  // Límite por IP: frena el barrido automático de intentos de extracción. Una
  // respuesta gobernada son varias peticiones (una por etapa).
  rateLimit: { windowLimit: 90, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
