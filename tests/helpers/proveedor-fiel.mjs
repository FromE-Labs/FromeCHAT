// Las pruebas simulan al proveedor con respuestas mínimas. El AI SDK valida el formato
// real, así que este módulo completa cada respuesta simulada hasta el formato que envía
// Anthropic, y presenta a cada simulación el cuerpo de la petición con los mensajes como
// texto simple. Se importa al principio de cada archivo de pruebas que sustituye fetch.

const original = globalThis.fetch;
let current = original;
const esProveedor = (url) => String(url).startsWith("https://api.anthropic.com/");
const linea = (e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`;

function flujoFiel(stream, model) {
  const dec = new TextDecoder();
  const enc = new TextEncoder();
  let buf = "";
  let abierto = false;
  let cerrado = false; // ha llegado message_delta: la respuesta terminó de forma normal
  let parado = false;
  const convertir = (ev) => {
    if (ev.type === "message_delta") cerrado = true;
    if (ev.type === "message_stop") parado = true;
    const out = [];
    if (ev.type === "message_start") {
      out.push({ type: "message_start", message: { id: "msg_prueba", type: "message", role: "assistant", model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 0, output_tokens: 0, ...(ev.message?.usage || {}) } } });
    } else if (ev.type === "content_block_delta") {
      if (!abierto) { out.push({ type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }); abierto = true; }
      out.push({ type: "content_block_delta", index: 0, delta: ev.delta });
    } else if (ev.type === "message_delta") {
      if (abierto) { out.push({ type: "content_block_stop", index: 0 }); abierto = false; }
      out.push({ type: "message_delta", delta: { stop_reason: ev.delta?.stop_reason ?? "end_turn", stop_sequence: null }, usage: { output_tokens: ev.usage?.output_tokens ?? 0 } });
    } else if (ev.type === "error") {
      out.push({ type: "error", error: { type: "overloaded_error", message: ev.error?.message || "error" } });
    } else out.push(ev);
    return out;
  };
  return stream.pipeThrough(new TransformStream({
    transform(chunk, ctrl) {
      buf += typeof chunk === "string" ? chunk : dec.decode(chunk, { stream: true });
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const trozo = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const data = trozo.split("\n").find((l) => l.startsWith("data: "));
        if (!data) continue;
        let ev;
        try { ev = JSON.parse(data.slice(6)); } catch { continue; }
        for (const e of convertir(ev)) ctrl.enqueue(enc.encode(linea(e)));
      }
    },
    // El proveedor real cierra siempre con message_stop. Si la simulación terminó de
    // forma normal y no lo envió, se añade; si se cortó a medias, no.
    flush(ctrl) {
      if (cerrado && !parado) ctrl.enqueue(enc.encode(linea({ type: "message_stop" })));
    },
  }));
}

function envolver(fn) {
  return async (url, init) => {
    if (!esProveedor(url) || !init?.body) return fn(url, init);
    const body = JSON.parse(init.body);
    const simple = { ...body, messages: (body.messages || []).map((m) => ({ ...m, content: Array.isArray(m.content) && m.content.every((c) => c.type === "text") ? m.content.map((c) => c.text).join("") : m.content })) };
    const headers = init.headers instanceof Headers ? Object.fromEntries(init.headers) : init.headers;
    const res = await fn(url, { ...init, headers, body: JSON.stringify(simple) });
    if (!res.ok) {
      let message = "";
      try { message = (await res.json())?.error?.message || ""; } catch {}
      return new Response(JSON.stringify({ type: "error", error: { type: "api_error", message } }), { status: res.status, headers: { "content-type": "application/json" } });
    }
    if (!body.stream) {
      const j = await res.json();
      const content = (j.content || []).map((c) => (c.type === "thinking" ? { signature: "firma", ...c } : c));
      return new Response(JSON.stringify({ id: "msg_prueba", type: "message", role: "assistant", model: body.model, stop_reason: "end_turn", stop_sequence: null, ...j, content, usage: { input_tokens: 0, output_tokens: 0, ...(j.usage || {}) } }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response(flujoFiel(res.body, body.model), { status: 200, headers: { "content-type": "text/event-stream" } });
  };
}

Object.defineProperty(globalThis, "fetch", {
  configurable: true,
  get: () => current,
  set: (fn) => { current = fn === original ? original : envolver(fn); },
});
