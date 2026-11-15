import test from "node:test";
import assert from "node:assert/strict";
const { openStream, readStream, callModel, askOnce } = await import("../netlify/functions/lib/provider.mjs");

// Aquí el proveedor simulado responde con el formato real, sin ayudante: se comprueba
// lo que sale de verdad hacia el proveedor y lo que se lee de su respuesta.
const INSTR = "INSTRUCCIONES-PRIVADAS-DE-PRUEBA";
const ev = (e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`;
const flujo = (text, usage, stop = "end_turn") =>
  [
    { type: "message_start", message: { id: "msg_1", type: "message", role: "assistant", model: "m", content: [], stop_reason: null, stop_sequence: null, usage } },
    { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "", signature: "" } },
    { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "razonamiento interno" } },
    { type: "content_block_stop", index: 0 },
    { type: "content_block_start", index: 1, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index: 1, delta: { type: "text_delta", text } },
    { type: "content_block_stop", index: 1 },
    { type: "message_delta", delta: { stop_reason: stop, stop_sequence: null }, usage: { output_tokens: 7 } },
    { type: "message_stop" },
  ].map(ev).join("");

function stub(handler) {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const call = { url: String(url), headers: Object.fromEntries(new Headers(init.headers)), body: JSON.parse(init.body) };
    calls.push(call);
    return handler(call, calls.length);
  };
  return { calls, restore: () => (globalThis.fetch = real) };
}
const sse = (text, usage, stop) => new Response(flujo(text, usage, stop), { status: 200, headers: { "content-type": "text/event-stream" } });
const system = [{ type: "text", text: INSTR, cache_control: { type: "ephemeral" } }];
const messages = [{ role: "user", content: "hola" }];

test("proveedor: lo que se envía lleva la clave en la cabecera, el bloque marcado para caché y el nivel de razonamiento", async () => {
  const s = stub(() => sse("respuesta", { input_tokens: 20, output_tokens: 1, cache_creation_input_tokens: 900, cache_read_input_tokens: 0 }));
  try {
    const r = await callModel({ key: "sk-ant-clave", model: "claude-opus-5-5", system, messages, maxTokens: 3000, deadline: Date.now() + 5000 });
    const c = s.calls[0];
    assert.equal(s.calls.length, 1);
    assert.equal(c.url, "https://api.anthropic.com/v1/messages");
    assert.equal(c.headers["x-api-key"], "sk-ant-clave");
    assert.equal(c.headers["anthropic-version"], "2023-06-01");
    assert.deepEqual(c.body.system, [{ type: "text", text: INSTR, cache_control: { type: "ephemeral" } }]);
    assert.deepEqual(c.body.messages, [{ role: "user", content: [{ type: "text", text: "hola" }] }]);
    assert.deepEqual(c.body.output_config, { effort: "low" });
    assert.equal(c.body.max_tokens, 3000);
    assert.equal(c.body.stream, true);
    assert.ok(!JSON.stringify(c.body).includes("sk-ant-clave"));
    // Solo llega el texto: el razonamiento previo no se entrega.
    assert.deepEqual(r, { ok: true, text: "respuesta", usage: { input: 920, output: 7, cacheWrite: 900 }, truncated: false, stop: "end_turn" });
  } finally { s.restore(); }
});

test("proveedor: lectura de caché y corte por espacio de salida", async () => {
  const s = stub(() => sse("a medias", { input_tokens: 25, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 900 }, "max_tokens"));
  try {
    const r = await callModel({ key: "k", model: "claude-opus-5-5", system, messages, maxTokens: 10, deadline: Date.now() + 5000 });
    assert.deepEqual(r.usage, { input: 925, output: 7, cached: 900 });
    assert.equal(r.stop, "max_tokens");
    assert.equal(r.truncated, true);
  } finally { s.restore(); }
});

test("proveedor: un rechazo se devuelve con su estado y sin arrastrar las instrucciones ni la clave", async () => {
  const s = stub(() => new Response(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }), { status: 401, headers: { "content-type": "application/json" } }));
  try {
    const up = await openStream({ key: "sk-ant-mala", model: "claude-opus-5-5", system, messages, maxTokens: 100 });
    assert.equal(up.ok, false);
    assert.deepEqual(up.error, { status: 401, message: "invalid x-api-key", auth: true, retryable: false });
    const r = await callModel({ key: "sk-ant-mala", model: "claude-opus-5-5", system, messages, maxTokens: 100, deadline: Date.now() + 5000 });
    const todo = JSON.stringify([up, r]);
    assert.ok(!todo.includes(INSTR) && !todo.includes("sk-ant-mala"));
    const caido = stub(() => new Response(JSON.stringify({ type: "error", error: { type: "overloaded_error", message: "Overloaded" } }), { status: 529, headers: { "content-type": "application/json" } }));
    const r2 = await callModel({ key: "k", model: "claude-opus-5-5", system, messages, maxTokens: 100, deadline: Date.now() + 5000 });
    caido.restore();
    assert.equal(r2.ok, false);
    assert.equal(r2.status, 529);
    assert.equal(r2.retryable, true);
    assert.equal(caido.calls.length, 1); // sin reintentos automáticos
  } finally { s.restore(); }
});

test("proveedor: si se rechaza el nivel de razonamiento, se repite sin él, y la pregunta breve ignora el pensamiento", async () => {
  const s = stub((c) => {
    if (c.body.output_config) return new Response(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "output_config.effort: not supported" } }), { status: 400, headers: { "content-type": "application/json" } });
    return new Response(JSON.stringify({ id: "msg_2", type: "message", role: "assistant", model: c.body.model, content: [{ type: "thinking", thinking: "x", signature: "s" }, { type: "text", text: "SAFE" }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 10, output_tokens: 2 } }), { status: 200, headers: { "content-type": "application/json" } });
  });
  try {
    const r = await askOnce({ key: "k", model: "modelo-sin-esfuerzo", system: "SYS", content: "x", maxTokens: 400 });
    assert.deepEqual(r, { ok: true, text: "SAFE", usage: { input: 10, output: 2 } });
    assert.equal(s.calls.length, 2);
    assert.ok(s.calls[0].body.output_config && !s.calls[1].body.output_config);
    assert.deepEqual(s.calls[1].body.system, [{ type: "text", text: "SYS" }]);
    assert.equal(s.calls[1].body.stream, undefined);
    // El modelo queda anotado: la siguiente llamada ya va sin el parámetro.
    await askOnce({ key: "k", model: "modelo-sin-esfuerzo", system: "SYS", content: "x", maxTokens: 400 });
    assert.equal(s.calls.length, 3);
  } finally { s.restore(); }
});

test("proveedor: se puede dejar de leer a mitad y no se llama a nadie más que al proveedor", async () => {
  const s = stub(() => sse("uno dos tres", { input_tokens: 5, output_tokens: 1 }));
  try {
    const up = await openStream({ key: "k", model: "claude-opus-5-5", system, messages, maxTokens: 100 });
    let visto = "";
    await readStream(up, { onText: (t) => { visto += t; return false; } });
    assert.equal(visto, "uno dos tres");
    assert.ok(s.calls.every((c) => c.url.startsWith("https://api.anthropic.com/")));
  } finally { s.restore(); }
});
