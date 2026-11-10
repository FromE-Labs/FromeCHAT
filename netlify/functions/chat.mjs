// FromE Chat — función de streaming.
// Recibe { key, model, governed, messages, consent, sessionId } y llama a Anthropic con
// la clave del usuario. La clave se usa en esta petición y se descarta: no se escribe
// en registros, no se guarda en ningún almacén, no se devuelve al cliente.
//
// Con la arquitectura activa, cada turno pasa por tres capas:
//   1. Clasificador de entrada: si el mensaje pregunta por las instrucciones del sistema,
//      el turno se responde por la ruta pública, sin prompt operativo.
//   2. Prompt operativo mínimo (reglas de conducta; no contiene la arquitectura).
//   3. Filtro de salida: retiene el final de la respuesta y la corta si reproduce el prompt.

import { governedSystem, loadGovernance, PUBLIC_SYSTEM, UNGOVERNED_SYSTEM, SIGNAL_NAMES } from "./lib/governance.mjs";
import { LeakFilter } from "./lib/shield.mjs";
import { gate } from "./lib/gate.mjs";
import { recordTurn } from "./lib/consent.mjs";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

// Modelos de frontera ofrecidos. Se valida contra esta lista para que el servidor
// nunca reenvíe un identificador arbitrario.
export const MODELS = {
  "claude-opus-5-5": { label: "Claude Opus 5.5", max: 8192 },
  "claude-sonnet-5-5": { label: "Claude Sonnet 5.5", max: 8192 },
  "claude-fable-5-1": { label: "Claude Fable 5.1", max: 8192 },
};

const MAX_MESSAGES = 60;
const MAX_CHARS_PER_MESSAGE = 24000;
const PUBLIC_SIGNAL = "\n\n⟶ Signal: Límite de divulgación — respuesta con información pública";

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

function mapSignals(text) {
  return text.replace(/(⟶ Signal:\s*)S([1-7])\b/g, (_, pre, n) => pre + SIGNAL_NAMES[n]);
}

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "method" });

  let body;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "json" });
  }

  const key = (body.key || "").trim();
  if (!validKey(key)) return json(400, { error: "key", message: "Clave de API de Anthropic no válida (empieza por sk-ant-)." });

  const model = MODELS[body.model] ? body.model : "claude-opus-5-5";
  const wantsGoverned = body.governed !== false;
  const messages = sanitizeMessages(body.messages);
  if (!messages) return json(400, { error: "messages" });

  // Ruta: baseline (sin arquitectura), governed (prompt operativo + filtro) o public.
  let route = "baseline";
  if (wantsGoverned) {
    const g = await gate({ key, messages });
    if (g.auth === false) return json(401, { error: "upstream", status: g.status, message: g.message || "Clave rechazada por el proveedor." });
    route = g.probe ? "public" : "governed";
  }
  const system = route === "governed" ? governedSystem() : route === "public" ? PUBLIC_SYSTEM : UNGOVERNED_SYSTEM;

  const upstream = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": ANTHROPIC_VERSION },
    body: JSON.stringify({ model, max_tokens: MODELS[model].max, system, messages, stream: true }),
  });

  if (!upstream.ok || !upstream.body) {
    let detail = "";
    try {
      detail = (await upstream.json())?.error?.message || "";
    } catch {}
    // Nunca se incluye la clave en el mensaje de error.
    return json(upstream.status === 401 ? 401 : 502, {
      error: "upstream",
      status: upstream.status,
      message: detail || "El proveedor no ha respondido.",
    });
  }

  const consent = body.consent === true;
  const sessionId = typeof body.sessionId === "string" ? body.sessionId.slice(0, 64) : null;
  const filter = route === "governed" ? new LeakFilter(loadGovernance()) : null;
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  let delivered = "";
  let usage = null;

  // El servidor interpreta el SSE del proveedor y emite el suyo con el mismo formato
  // de eventos, para poder retener, comprobar y cortar el texto antes de entregarlo.
  const stream = new ReadableStream({
    async start(controller) {
      const send = (ev) => controller.enqueue(enc.encode(`data: ${JSON.stringify(ev)}\n\n`));
      const sendText = (text) => {
        if (!text) return;
        delivered += text;
        send({ type: "content_block_delta", delta: { type: "text_delta", text } });
      };
      const reader = upstream.body.getReader();
      let buf = "";
      let blocked = false;
      try {
        send({ type: "frome_route", route });
        outer: while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf("\n\n")) >= 0) {
            const chunk = buf.slice(0, i);
            buf = buf.slice(i + 2);
            const line = chunk.split("\n").find((l) => l.startsWith("data: "));
            if (!line) continue;
            let ev;
            try {
              ev = JSON.parse(line.slice(6));
            } catch {
              continue;
            }
            if (ev.type === "message_start" && ev.message?.usage) {
              usage = { ...ev.message.usage };
              send({ type: "message_start", message: { usage: ev.message.usage } });
            } else if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") {
              if (filter) {
                sendText(filter.push(ev.delta.text));
                if (filter.blocked) {
                  blocked = true;
                  break outer;
                }
              } else sendText(ev.delta.text);
            } else if (ev.type === "message_delta" && ev.usage) {
              usage = { ...(usage || {}), ...ev.usage };
              send({ type: "message_delta", usage: ev.usage });
            } else if (ev.type === "error") {
              send({ type: "error", error: { message: ev.error?.message || "error" } });
            }
          }
        }
        if (filter && !blocked) {
          const tail = filter.end();
          if (filter.blocked) blocked = true;
          else sendText(mapSignals(tail));
        }
        if (blocked) {
          try {
            await reader.cancel();
          } catch {}
          console.warn(`shield: respuesta retenida (${filter.blocked})`);
          send({ type: "frome_blocked" });
        } else if (route === "public") {
          sendText(PUBLIC_SIGNAL);
        }
      } catch {
        send({ type: "error", error: { message: "Se ha interrumpido la respuesta." } });
      } finally {
        controller.close();
        if (consent && sessionId && delivered && !blocked) {
          // Fuera del camino crítico de la respuesta. Sin clave, sin IP, sin cabeceras.
          recordTurn({ sessionId, model, route, messages, assistantText: delivered, usage }).catch(() => {});
        }
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
};

export const config = {
  path: "/api/chat",
  // Límite por IP: frena el barrido automático de intentos de extracción.
  rateLimit: { windowLimit: 30, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
