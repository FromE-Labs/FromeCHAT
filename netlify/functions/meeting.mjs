// Sala de reunión privada. La autora modera y varios modelos (ChatGPT, Mistral, DeepSeek
// y Claude) intervienen por turnos sobre la misma transcripción. Es una herramienta
// interna de trabajo: no forma parte del producto y no usa la arquitectura ni sus reglas.
//
// Existe solo si está definida MEETING_TOKEN (o, en su defecto, SELFTEST_TOKEN) con 20
// caracteres o más. La contraseña va en la ruta: /reunion/<contraseña>. Sin ella, 404.
//
// Las claves de cada proveedor las pega la autora en la página. Viajan en la cabecera
// x-provider-key de cada petición: no se guardan en el servidor ni se registran. Solo para
// Claude, si no se pega clave, se usa MEETING_ANTHROPIC_KEY o SELFTEST_KEY si existen.
//
// Cada turno es una petición: el servidor llama a un único proveedor y reenvía el texto
// según llega. No se guarda nada: la transcripción vive en el navegador de la autora.

import { timingSafeEqual } from "node:crypto";
import { PAGE } from "./lib/meeting-page.mjs";

// cap: tope de salida. Va holgado porque en varios modelos el razonamiento previo cuenta dentro
// del tope: con uno corto se lo gastan pensando y no llegan a escribir.
export const PROVIDERS = {
  openai: { name: "ChatGPT", base: "https://api.openai.com/v1", kind: "openai", cap: 8000, tokenParam: "max_completion_tokens", usage: true },
  mistral: { name: "Mistral", base: "https://api.mistral.ai/v1", kind: "openai", cap: 8000, tokenParam: "max_tokens", usage: false },
  deepseek: { name: "DeepSeek", base: "https://api.deepseek.com", kind: "openai", cap: 8000, tokenParam: "max_tokens", usage: true },
  anthropic: { name: "Claude", base: "https://api.anthropic.com/v1", kind: "anthropic", cap: 4000 },
};
const ANTHROPIC_VERSION = "2023-06-01";
const TURN_MS = 52000; // un turno tiene que caber en el tiempo de ejecución de la plataforma
const MAX_PROMPT = 400000; // caracteres

const same = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};
const gone = () => new Response("Not found", { status: 404 });
const PRIVATE = { "cache-control": "no-store", "x-robots-tag": "noindex, nofollow", "referrer-policy": "no-referrer" };
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", ...PRIVATE } });

function keyFor(provider, req) {
  const sent = (req.headers.get("x-provider-key") || "").trim();
  if (sent) return sent;
  if (provider === "anthropic") return (process.env.MEETING_ANTHROPIC_KEY || process.env.SELFTEST_KEY || "").trim();
  return "";
}
const authHeaders = (P, key) => (P.kind === "anthropic" ? { "x-api-key": key, "anthropic-version": ANTHROPIC_VERSION } : { authorization: "Bearer " + key });

// Mensaje de error del proveedor, sin nada que parezca una clave.
async function providerError(res) {
  let message = "";
  try {
    const raw = await res.text();
    try {
      const j = JSON.parse(raw);
      message = j?.error?.message || j?.message || j?.detail || (typeof j?.error === "string" ? j.error : "") || raw;
    } catch {
      message = raw;
    }
  } catch {}
  message = String(message || "").replace(/(sk|key|Bearer)[-_ ]?[A-Za-z0-9_\-]{12,}/g, "[clave]").slice(0, 400);
  return { status: res.status, message: message || "El proveedor no ha respondido." };
}

/* ---------- modelos disponibles con la clave de la autora ---------- */
const NOT_CHAT = /(embed|audio|realtime|tts|transcri|whisper|image|dall|moderation|search|instruct|codex|computer-use|ocr|voxtral|babbage|davinci|sora|guard)/i;
export function chatModels(provider, data) {
  let list = (Array.isArray(data) ? data : []).map((m) => ({
    id: String(m.id || ""),
    label: String(m.display_name || m.name || m.id || ""),
    created: Number(m.created) || Math.floor(Date.parse(m.created_at || "") / 1000) || 0,
    chat: m.capabilities ? m.capabilities.completion_chat !== false : true,
  }));
  list = list.filter((m) => m.id && m.chat && !NOT_CHAT.test(m.id));
  if (provider === "openai") list = list.filter((m) => /^(gpt-|o\d|chatgpt-)/.test(m.id));
  const seen = new Set();
  list = list.filter((m) => (seen.has(m.id) ? false : seen.add(m.id)));
  return list.sort((a, b) => b.created - a.created || a.id.localeCompare(b.id)).map(({ id, label }) => ({ id, label }));
}
// Modelo que se propone de entrada; la autora lo cambia en la página.
export function pickModel(provider, list) {
  const ids = list.map((m) => m.id);
  const first = (...tests) => {
    for (const t of tests) {
      const hit = ids.find((id) => (typeof t === "string" ? id === t : t.test(id)));
      if (hit) return hit;
    }
    return ids[0] || "";
  };
  if (provider === "anthropic") return first("claude-opus-5-5", /opus/);
  if (provider === "mistral") return first("mistral-large-latest", /large/, "mistral-medium-latest");
  if (provider === "deepseek") return first("deepseek-reasoner", "deepseek-chat");
  // OpenAI: la versión más alta de la familia principal, sin variantes reducidas.
  let best = "", bestScore = -1;
  for (const id of ids) {
    const m = id.match(/^gpt-(\d+(?:\.\d+)?)/);
    if (!m) continue;
    let score = Number(m[1]) * 100;
    if (/mini/.test(id)) score -= 30;
    if (/nano/.test(id)) score -= 40;
    if (/chat-latest/.test(id)) score -= 5;
    if (/\d{4}-\d{2}-\d{2}/.test(id)) score -= 1;
    if (score > bestScore) { best = id; bestScore = score; }
  }
  return best || ids[0] || "";
}
async function models(provider, key) {
  const P = PROVIDERS[provider];
  let res;
  try {
    res = await fetch(P.base + "/models" + (P.kind === "anthropic" ? "?limit=100" : ""), { headers: authHeaders(P, key) });
  } catch {
    return json(502, { error: "No se ha podido contactar con " + P.name + "." });
  }
  if (!res.ok) {
    const e = await providerError(res);
    return json(e.status === 401 || e.status === 403 ? 401 : 502, { error: P.name + ": " + e.message });
  }
  let body = {};
  try { body = await res.json(); } catch {}
  const list = chatModels(provider, body.data || body.models || []);
  return json(200, { models: list, suggested: pickModel(provider, list) });
}

/* ---------- un turno ---------- */
// El texto de un fragmento. Casi todos los proveedores lo envían como cadena; algunos
// (Mistral con sus modelos recientes) lo envían como lista de trozos con tipo, donde el
// razonamiento previo va aparte del texto.
export function deltaText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((c) => (typeof c === "string" ? c : c && c.type === "text" && typeof c.text === "string" ? c.text : "")).join("");
}
const isThinking = (content) => Array.isArray(content) && content.some((c) => c && typeof c === "object" && c.type && c.type !== "text");

// Lee un flujo SSE y entrega cada objeto «data:» ya analizado.
async function eachEvent(res, signal, onEvent) {
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const abort = () => reader.cancel().catch(() => {});
  signal.addEventListener("abort", abort);
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line.startsWith("data:")) continue;
        const raw = line.slice(5).trim();
        if (!raw || raw === "[DONE]") continue;
        try { onEvent(JSON.parse(raw)); } catch {}
      }
    }
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

async function openTurn(provider, { key, model, system, prompt, signal }) {
  const P = PROVIDERS[provider];
  if (P.kind === "anthropic") {
    const body = { model, max_tokens: P.cap, system, messages: [{ role: "user", content: prompt }], stream: true };
    const send = (b) => fetch(P.base + "/messages", { method: "POST", signal, headers: { "content-type": "application/json", ...authHeaders(P, key) }, body: JSON.stringify(b) });
    // Razonamiento previo al mínimo para que el turno quepa en el tiempo; si el modelo no lo admite, sin él.
    let res = await send({ ...body, output_config: { effort: "low" } });
    if (res.status === 400) res = await send(body);
    return res;
  }
  const body = { model, stream: true, messages: [{ role: "system", content: system }, { role: "user", content: prompt }], [P.tokenParam]: P.cap };
  if (P.usage) body.stream_options = { include_usage: true };
  return fetch(P.base + "/chat/completions", { method: "POST", signal, headers: { "content-type": "application/json", ...authHeaders(P, key) }, body: JSON.stringify(body) });
}

function turn(provider, { key, model, system, prompt }) {
  const P = PROVIDERS[provider];
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let open = true;
      const write = (s) => { if (open) controller.enqueue(enc.encode(s)); };
      const send = (ev) => write("data: " + JSON.stringify(ev) + "\n\n");
      const beat = setInterval(() => write(": ping\n\n"), 8000);
      const ctl = new AbortController();
      let late = false;
      const timer = setTimeout(() => { late = true; ctl.abort(); }, TURN_MS);
      const usage = { input: 0, output: 0 };
      let chars = 0, thinking = false;
      try {
        const res = await openTurn(provider, { key, model, system, prompt, signal: ctl.signal });
        if (!res.ok) {
          const e = await providerError(res);
          send({ error: P.name + " (" + e.status + "): " + e.message });
          return;
        }
        await eachEvent(res, ctl.signal, (ev) => {
          let text = "";
          if (P.kind === "anthropic") {
            if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") text = ev.delta.text || "";
            else if (ev.type === "content_block_delta" && ev.delta?.type === "thinking_delta") thinking = true;
            else if (ev.type === "message_start") usage.input = ev.message?.usage?.input_tokens || 0;
            else if (ev.type === "message_delta") usage.output = ev.usage?.output_tokens || usage.output;
            else if (ev.type === "error") send({ error: P.name + ": " + String(ev.error?.message || "error").slice(0, 300) });
          } else {
            const d = ev.choices?.[0]?.delta;
            text = deltaText(d?.content);
            if (!text && (d?.reasoning_content || isThinking(d?.content))) thinking = true;
            if (ev.usage) { usage.input = ev.usage.prompt_tokens || 0; usage.output = ev.usage.completion_tokens || 0; }
          }
          if (thinking && !chars && !text) { send({ thinking: true }); thinking = false; }
          if (text) { chars += text.length; send({ t: text }); }
        });
        if (late) send({ cut: true });
        else if (!chars) send({ error: P.name + " no ha devuelto texto. Prueba otra vez o cambia de modelo." });
        send({ done: true, usage });
      } catch {
        if (late) { send({ cut: true }); send({ done: true, usage }); }
        else send({ error: "Se ha interrumpido la conexión con " + P.name + "." });
      } finally {
        clearTimeout(timer);
        clearInterval(beat);
        open = false;
        controller.close();
      }
    },
  });
  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream; charset=utf-8", "x-accel-buffering": "no", ...PRIVATE } });
}

export default async (req) => {
  const token = (process.env.MEETING_TOKEN || process.env.SELFTEST_TOKEN || "").trim();
  const parts = new URL(req.url).pathname.split("/").filter(Boolean); // reunion / <contraseña> / acción / proveedor
  let given = "";
  try { given = decodeURIComponent(parts[1] || ""); } catch {}
  if (token.length < 20 || parts[0] !== "reunion" || !same(given, token)) return gone();
  const action = parts[2] || "";

  if (!action && req.method === "GET") {
    return new Response(PAGE, { status: 200, headers: { "content-type": "text/html; charset=utf-8", "x-frame-options": "DENY", "x-content-type-options": "nosniff", "permissions-policy": "microphone=(self), camera=(), geolocation=()", ...PRIVATE } });
  }
  if (action === "estado" && req.method === "GET") {
    return json(200, { serverKey: { anthropic: Boolean((process.env.MEETING_ANTHROPIC_KEY || process.env.SELFTEST_KEY || "").trim()) } });
  }
  const provider = parts[3] || "";
  if (!Object.prototype.hasOwnProperty.call(PROVIDERS, provider)) return gone();
  const key = keyFor(provider, req);
  if (!key) return json(400, { error: "Falta la clave de " + PROVIDERS[provider].name + "." });

  if (action === "modelos" && req.method === "GET") return models(provider, key);
  if (action === "turno" && req.method === "POST") {
    let body;
    try { body = await req.json(); } catch { return json(400, { error: "Petición mal formada." }); }
    const model = String(body?.model || "").trim().slice(0, 120);
    const system = String(body?.system || "").slice(0, 20000);
    const prompt = String(body?.prompt || "");
    if (!model || !prompt.trim()) return json(400, { error: "Faltan el modelo o el contenido del turno." });
    if (prompt.length > MAX_PROMPT) return json(413, { error: "La reunión es demasiado larga para un turno. Exporta el acta y empieza otra con un resumen." });
    return turn(provider, { key, model, system, prompt });
  }
  return gone();
};

export const config = { path: ["/reunion/*"] };
