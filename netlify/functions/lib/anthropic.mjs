// Llamadas al proveedor con la clave del usuario. La clave viaja solo en la cabecera
// de cada petición: no se registra, no se guarda y no se devuelve.

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

export async function openStream({ key, model, system, messages, maxTokens, signal }) {
  return fetch(ANTHROPIC_URL, {
    method: "POST",
    signal,
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": ANTHROPIC_VERSION },
    body: JSON.stringify({ model, max_tokens: maxTokens, system, messages, stream: true }),
  });
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

// Lee el SSE del proveedor. Devuelve { usage, truncated, failed }.
//  - onText(texto) puede devolver false para dejar de leer.
//  - deadline (ms epoch): al alcanzarlo se deja de leer y truncated pasa a true.
export async function readStream(upstream, { onText, onUsage, deadline }) {
  const reader = upstream.body.getReader();
  const dec = new TextDecoder();
  const usage = { input: 0, output: 0 };
  let buf = "";
  let truncated = false;
  let failed = null;
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
        } else if (ev.type === "message_delta" && ev.usage) {
          usage.output = ev.usage.output_tokens || usage.output;
          onUsage?.(usage);
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
  return { usage, truncated, failed };
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
  return { ok: true, text, usage: r.usage, truncated: r.truncated || Boolean(r.failed) };
}
