// Llamadas al proveedor con la clave del usuario. La clave viaja solo en la cabecera
// de cada petición: no se registra, no se guarda y no se devuelve.

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

// Nivel de razonamiento previo. Estos modelos piensan antes de responder y, mientras
// piensan, no envían texto; ese tiempo y esos tokens cuentan dentro del límite de la
// llamada. Se pide el nivel mínimo, igual en la respuesta directa y en cada etapa del
// ciclo, para que ambas quepan en el tiempo de ejecución de la plataforma.
export const EFFORT = process.env.MODEL_EFFORT || "low";
const noEffort = new Set(); // modelos que han rechazado el parámetro

export function effortFor(model) {
  return EFFORT && EFFORT !== "default" && !noEffort.has(model) ? { output_config: { effort: EFFORT } } : {};
}

// Si el proveedor rechaza el parámetro de razonamiento, se repite la llamada sin él.
export async function postMessages({ key, body, signal }) {
  const send = (b) =>
    fetch(ANTHROPIC_URL, {
      method: "POST",
      signal,
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": ANTHROPIC_VERSION },
      body: JSON.stringify(b),
    });
  let res = await send(body);
  if (res.status === 400 && body.output_config) {
    const text = await res.text();
    if (/effort|output_config/i.test(text)) {
      noEffort.add(body.model);
      const { output_config, ...rest } = body;
      res = await send(rest);
    } else {
      res = new Response(text, { status: 400, headers: { "content-type": "application/json" } });
    }
  }
  return res;
}

export async function openStream({ key, model, system, messages, maxTokens, signal }) {
  return postMessages({ key, signal, body: { model, max_tokens: maxTokens, system, messages, stream: true, ...effortFor(model) } });
}

export async function upstreamError(res) {
  let message = "";
  try {
    message = (await res.json())?.error?.message || "";
  } catch {}
  const status = res.status;
  return {
    status,
    message: message || "El proveedor no ha respondido.",
    auth: status === 401 || status === 403,
    retryable: status === 429 || status >= 500,
  };
}

// Lee el SSE del proveedor. Devuelve { usage, truncated, failed, stop }.
//  - onText(texto) puede devolver false para dejar de leer.
//  - deadline (ms epoch): al alcanzarlo se deja de leer y truncated pasa a true.
export async function readStream(upstream, { onText, onUsage, deadline }) {
  const reader = upstream.body.getReader();
  const dec = new TextDecoder();
  const usage = { input: 0, output: 0 };
  let buf = "";
  let truncated = false;
  let failed = null;
  let stop = null;
  let timer = null;
  if (deadline) {
    timer = setTimeout(() => {
      truncated = true;
      reader.cancel().catch(() => {});
    }, Math.max(0, deadline - Date.now()));
  }
  try {
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
          const u = ev.message.usage;
          usage.input = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
          onUsage?.(usage);
        } else if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") {
          if (onText(ev.delta.text) === false) {
            await reader.cancel().catch(() => {});
            break outer;
          }
        } else if (ev.type === "message_delta") {
          if (ev.delta?.stop_reason) stop = ev.delta.stop_reason;
          if (ev.usage) {
            usage.output = ev.usage.output_tokens || usage.output;
            onUsage?.(usage);
          }
        } else if (ev.type === "error") {
          failed = ev.error?.message || "error";
        }
      }
    }
  } catch (e) {
    if (!truncated) failed = failed || "Se ha interrumpido la respuesta.";
  } finally {
    if (timer) clearTimeout(timer);
  }
  return { usage, truncated, failed, stop };
}

// Llamada completa: devuelve el texto acumulado.
//   { ok: true, text, usage, truncated } | { ok: false, status, message, auth, retryable }
export async function callModel({ key, model, system, messages, maxTokens, deadline }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), Math.max(0, deadline - Date.now()));
  let upstream;
  try {
    upstream = await openStream({ key, model, system, messages, maxTokens, signal: ctrl.signal });
  } catch {
    clearTimeout(timer);
    return { ok: false, status: 0, message: "El proveedor no ha respondido a tiempo.", auth: false, retryable: true };
  }
  if (!upstream.ok || !upstream.body) {
    clearTimeout(timer);
    return { ok: false, ...(await upstreamError(upstream)) };
  }
  let text = "";
  const r = await readStream(upstream, { onText: (t) => void (text += t), deadline });
  clearTimeout(timer);
  if (r.failed && !text) return { ok: false, status: 0, message: r.failed, auth: false, retryable: true };
  if (!text && (r.truncated || r.stop === "max_tokens")) {
    return { ok: false, status: 0, message: "El modelo no ha llegado a escribir la respuesta dentro del límite.", auth: false, retryable: true };
  }
  // Cortada: por tiempo, por fallo a mitad o por agotar el espacio de salida.
  return { ok: true, text, usage: r.usage, truncated: r.truncated || Boolean(r.failed) || r.stop === "max_tokens", stop: r.stop };
}
