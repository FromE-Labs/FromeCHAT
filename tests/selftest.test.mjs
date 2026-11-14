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
  const systems = [];
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    keys.push(init.headers["x-api-key"]);
    if (!body.stream) return new Response(JSON.stringify({ content: [{ type: "text", text: "SAFE" }], usage: { input_tokens: 10, output_tokens: 1 } }), { status: 200 });
    const sys = body.system.map((b) => b.text).join("\n");
    systems.push(sys);
    const text = sys.includes("ALPHA-STAGE") ? '{"goal":"x","q":"¿Fecha?"}' : sys.includes("GAMMA-STAGE") ? '{"ok":true}' : sys.includes("BETA-STAGE") ? "Respuesta gobernada." : "Respuesta directa.";
    return new Response(sse(text), { status: 200 });
  };
  return { keys, systems, restore: () => (globalThis.fetch = real) };
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

test("admite los parámetros en la ruta, con la pregunta en base64url", async () => {
  process.env.SELFTEST_KEY = KEY; process.env.SELFTEST_TOKEN = TOKEN;
  const st = await (await call(`${PREVIEW}/status/${TOKEN}`, { deploy: { context: "deploy-preview" } })).text();
  assert.ok(st.includes("consulta recibida: no") && st.includes("coincide") && !st.includes(TOKEN));
  assert.equal((await call(`${PREVIEW}/${"x".repeat(40)}/1/m1/${Buffer.from("hola").toString("base64url")}`)).status, 404);
  const s = stub();
  try {
    const r = await call(`${PREVIEW}/${TOKEN}/9/m1.m2/${Buffer.from("¿Qué hago con esto?").toString("base64url")}`);
    const text = await r.text();
    assert.equal(r.status, 200);
    assert.ok(text.includes("PRUEBA 9") && text.includes("módulos: Módulo uno, Módulo dos") && text.includes("PREGUNTA: ¿Qué hago con esto?"));
    assert.ok(text.includes("Respuesta gobernada.") && text.includes("Respuesta directa.") && !text.includes(TOKEN));
  } finally { s.restore(); }
});

test("si la plataforma deja seguir tras responder, contesta «en curso» y luego el resultado", async () => {
  process.env.SELFTEST_KEY = KEY; process.env.SELFTEST_TOKEN = TOKEN;
  const s = stub();
  try {
    const q = Buffer.from("caso reanudable").toString("base64url");
    let pending = null;
    const ctx = { deploy: { context: "deploy-preview" }, waitUntil: (p) => (pending = p) };
    const first = await (await call(`${PREVIEW}/${TOKEN}/21/m1.m2/${q}/-/-/1`, ctx)).text();
    assert.ok(first.includes("EN CURSO") && !first.includes("=== FIN"));
    await pending;
    const calls = s.keys.length;
    const second = await (await call(`${PREVIEW}/${TOKEN}/21/m1.m2/${q}/-/-/2`, ctx)).text();
    assert.ok(second.includes("Respuesta gobernada.") && second.includes("Respuesta directa.") && second.trim().endsWith("=== FIN"));
    assert.equal(s.keys.length, calls, "el caso terminado no se vuelve a ejecutar");
  } finally { s.restore(); }
});

test("la pregunta puede venir por nombre de caso guardado; informa del filtro", async () => {
  process.env.SELFTEST_KEY = KEY; process.env.SELFTEST_TOKEN = TOKEN;
  assert.equal((await call(`${PREVIEW}/${TOKEN}/31/m1.m2/caso.noexiste`)).status, 400);
  const s = stub();
  try {
    const text = await (await call(`${PREVIEW}/${TOKEN}/31/m1.m2/caso.uno/x/gov`)).text();
    assert.ok(text.includes("CASO: uno") && !text.includes("pregunta guardada"));
    assert.ok(/FILTRO: limpio · huellas 0\/\d+ · \d+ caracteres/.test(text) && !text.includes("SIN ARQUITECTURA"));
  } finally { s.restore(); }
});

test("lado «ciclo»: entra al ciclo sin comprobación de entrada e informa del material interno", async () => {
  process.env.SELFTEST_KEY = KEY; process.env.SELFTEST_TOKEN = TOKEN;
  const s = stub();
  try {
    const text = await (await call(`${PREVIEW}/${TOKEN}/41/m1.m2/caso.uno/x/ciclo`)).text();
    assert.ok(text.includes("ruta governed (forzada, sin comprobación de entrada)") && text.includes("3 llamadas"));
    assert.ok(/INTERNO: .*limpio 0\/\d+/.test(text) && text.includes("Respuesta gobernada.") && !text.includes("SIN ARQUITECTURA"));
    assert.equal(s.keys.length, 3, "no se llama al clasificador de entrada");
  } finally { s.restore(); }
});

test("celdas de medición: lado «voz» sin gobernanza y módulo oculto que quita la voz", async () => {
  process.env.SELFTEST_KEY = KEY; process.env.SELFTEST_TOKEN = TOKEN;
  const s = stub();
  try {
    const solo = await (await call(`${PREVIEW}/${TOKEN}/51/todos/caso.uno/x/voz`)).text();
    assert.ok(solo.includes("=== SOLO VOZ (sin gobernanza)") && solo.includes("Respuesta directa.") && !solo.includes("CON FROM E"));
    assert.ok(s.systems.some((x) => x.includes("Voz de prueba") && x.includes("helpful assistant")), "la llamada directa lleva la voz");
    const n = s.systems.length;
    const sin = await (await call(`${PREVIEW}/${TOKEN}/52/m1.m2.mv/caso.uno/x/gov`)).text();
    assert.ok(sin.includes("Sin voz") && sin.includes("Respuesta gobernada."));
    assert.ok(!s.systems.slice(n).some((x) => x.includes("Voz de prueba")), "con el módulo oculto ninguna etapa lleva la voz");
    const m = s.systems.length;
    await (await call(`${PREVIEW}/${TOKEN}/53/m1.m2/caso.uno/x/gov`)).text();
    assert.ok(s.systems.slice(m).some((x) => x.includes("Voz de prueba")), "por defecto la voz está activa");
  } finally { s.restore(); }
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
