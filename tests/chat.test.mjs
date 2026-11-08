import test from "node:test";
import assert from "node:assert/strict";

// Stub del almacén de consentimiento antes de importar la función
const recorded = [];
const consentMod = await import("../netlify/functions/lib/consent.mjs");
const chat = (await import("../netlify/functions/chat.mjs")).default;

function sse(events) {
  const enc = new TextEncoder();
  return new ReadableStream({ start(c) { for (const e of events) c.enqueue(enc.encode(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`)); c.close(); } });
}

test("rechaza clave inválida y mensajes mal formados", async () => {
  let r = await chat(new Request("http://x/api/chat", { method: "POST", body: JSON.stringify({ key: "nope", messages: [{ role: "user", content: "hola" }] }) }));
  assert.equal(r.status, 400);
  r = await chat(new Request("http://x/api/chat", { method: "POST", body: JSON.stringify({ key: "sk-ant-" + "a".repeat(30), messages: [{ role: "assistant", content: "x" }] }) }));
  assert.equal(r.status, 400);
});

test("reenvía el stream, aplica el prompt gobernado y nunca filtra la clave", async () => {
  const KEY = "sk-ant-" + "k".repeat(40);
  let captured = null;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    captured = { url, init };
    return new Response(sse([
      { type: "message_start", message: { usage: { input_tokens: 9000, cache_read_input_tokens: 0 } } },
      { type: "content_block_delta", delta: { type: "text_delta", text: "Hola. " } },
      { type: "content_block_delta", delta: { type: "text_delta", text: "⟶ Signal: INVARIANT_COHERENCE_K — ok" } },
      { type: "message_delta", usage: { output_tokens: 12 } },
      { type: "message_stop" },
    ]), { status: 200, headers: { "content-type": "text/event-stream" } });
  };
  try {
    const r = await chat(new Request("http://x/api/chat", { method: "POST", body: JSON.stringify({ key: KEY, model: "claude-opus-5-5", governed: true, messages: [{ role: "user", content: "hola" }] }) }));
    assert.equal(r.status, 200);
    assert.equal(r.headers.get("x-frome-governed"), "1");
    const text = await r.text();
    assert.ok(text.includes("Hola. "));
    assert.ok(!text.includes(KEY));
    assert.equal(captured.init.headers["x-api-key"], KEY);
    const body = JSON.parse(captured.init.body);
    assert.equal(body.stream, true);
    assert.equal(body.system.length, 2);
    assert.ok(body.system[1].text.includes("RTN Rule"));
    // sin arquitectura
    const r2 = await chat(new Request("http://x/api/chat", { method: "POST", body: JSON.stringify({ key: KEY, governed: false, messages: [{ role: "user", content: "hola" }] }) }));
    await r2.text();
    assert.equal(r2.headers.get("x-frome-governed"), "0");
    assert.equal(JSON.parse(captured.init.body).system.length, 1);
  } finally { globalThis.fetch = realFetch; }
});
