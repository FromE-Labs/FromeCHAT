import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

process.env.GOVERNANCE_DIR = fileURLToPath(new URL("./fixtures/governance", import.meta.url));
const TOKEN = "t".repeat(40);
const KEY = "sk-ant-" + "k".repeat(40);
const selftest = (await import("../netlify/functions/selftest.mjs")).default;
const PREVIEW = "https://deploy-preview-1--sitio.netlify.app/api/selftest";

function sse(text) {
  const enc = new TextEncoder();
  const evs = [{ type: "message_start", message: { usage: { input_tokens: 100 } } }, { type: "content_block_delta", delta: { type: "text_delta", text } }, { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 20 } }];
  return new ReadableStream({ start(c) { for (const e of evs) c.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n\n`)); c.close(); } });
}
function stub() {
  const real = globalThis.fetch;
  const keys = [];
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    keys.push(init.headers["x-api-key"]);
    if (!body.stream) return new Response(JSON.stringify({ content: [{ type: "text", text: "SAFE" }], usage: { input_tokens: 10, output_tokens: 1 } }), { status: 200 });
    const sys = body.system.map((b) => b.text).join("\n");
    const text = sys.includes("ALPHA-STAGE") ? '{"goal":"x","q":"¿Fecha?"}' : sys.includes("GAMMA-STAGE") ? '{"ok":true}' : sys.includes("BETA-STAGE") ? "Respuesta gobernada." : "Respuesta directa.";
    return new Response(sse(text), { status: 200 });
  };
  return { keys, restore: () => (globalThis.fetch = real) };
}
const call = (url, ctx) => selftest(new Request(url), ctx);

test("no existe sin configurar, con contraseña mala o en producción", async () => {
  delete process.env.SELFTEST_KEY; delete process.env.SELFTEST_TOKEN;
  assert.equal((await call(`${PREVIEW}?t=${TOKEN}&q=hola`)).status, 404);
  process.env.SELFTEST_KEY = KEY; process.env.SELFTEST_TOKEN = TOKEN;
  assert.equal((await call(`${PREVIEW}?t=${"x".repeat(40)}&q=hola`)).status, 404);
  assert.equal((await call(`${PREVIEW}?q=hola`)).status, 404);
  assert.equal((await call(`https://sitio.netlify.app/api/selftest?t=${TOKEN}&q=hola`)).status, 404);
  assert.equal((await call(`https://chat.ejemplo.com/api/selftest?t=${TOKEN}&q=hola`)).status, 404);
  assert.equal((await selftest(new Request(`${PREVIEW}?t=${TOKEN}&q=hola`, { method: "POST" }))).status, 404);
  // El contexto del despliegue manda sobre el nombre del host.
  assert.equal((await call(`${PREVIEW}?t=${TOKEN}&q=hola`, { deploy: { context: "production" } })).status, 404);
});

test("diagnóstico: informa de las condiciones sin devolver ningún valor", async () => {
  process.env.SELFTEST_KEY = KEY; process.env.SELFTEST_TOKEN = TOKEN;
  const text = await (await call(`https://interno.ejemplo/api/selftest?status=1&t=${TOKEN}`, { deploy: { context: "deploy-preview" } })).text();
  assert.ok(text.includes("contexto: deploy-preview") && text.includes("producción: no") && text.includes("coincide"));
  assert.ok(!text.includes(KEY) && !text.includes(TOKEN));
});

test("lanza el caso con los módulos pedidos y devuelve las dos respuestas sin la clave", async () => {
  process.env.SELFTEST_KEY = KEY; process.env.SELFTEST_TOKEN = TOKEN;
  const s = stub();
  try {
    const r = await call(`${PREVIEW}?t=${TOKEN}&id=7&m=m1,m2&q=${encodeURIComponent("¿Qué hago?")}`);
    const text = await r.text();
    assert.equal(r.status, 200);
    assert.ok(text.includes("PRUEBA 7") && text.includes("módulos: Módulo uno, Módulo dos"));
    assert.ok(text.includes("TRAZA: Etapa alfa > Etapa beta [pasada 1] > Etapa gamma"));
    assert.ok(text.includes("SEÑAL: Gamma — validada · pasadas: 1") && text.includes("Respuesta gobernada."));
    assert.ok(text.includes("=== SIN ARQUITECTURA") && text.includes("Respuesta directa."));
    assert.ok(text.includes("4 llamadas") && text.trim().endsWith("=== FIN"));
    assert.ok(!text.includes(KEY) && !text.includes(TOKEN));
    assert.ok(s.keys.every((k) => k === KEY));
  } finally { s.restore(); }
});

test("con un solo módulo entrega la pregunta; side=gov omite la respuesta directa", async () => {
  process.env.SELFTEST_KEY = KEY; process.env.SELFTEST_TOKEN = TOKEN;
  const s = stub();
  try {
    const text = await (await call(`${PREVIEW}?t=${TOKEN}&m=m1&side=gov&q=hola`)).text();
    assert.ok(text.includes("SEÑAL: Alfa — solo") && text.includes("¿Fecha?"));
    assert.ok(!text.includes("SIN ARQUITECTURA"));
  } finally { s.restore(); }
});
