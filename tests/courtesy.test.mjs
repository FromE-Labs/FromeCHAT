import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

process.env.GOVERNANCE_DIR = fileURLToPath(new URL("./fixtures/governance", import.meta.url));
const chat = (await import("../netlify/functions/chat.mjs")).default;
const status = (await import("../netlify/functions/courtesy.mjs")).default;
const models = (await import("../netlify/functions/models.mjs")).default;
const { useCourtesyStore, courtesyConfig } = await import("../netlify/functions/lib/courtesy.mjs");

const SERVER_KEY = "sk-ant-" + "s".repeat(40);
const USER_KEY = "sk-ant-" + "u".repeat(40);
const C1 = "FE-AAAA-BBBB-CCCC", C2 = "FE-DDDD-EEEE-FFFF";

function memStore() {
  const data = new Map();
  return { data, get: async (k) => (data.has(k) ? structuredClone(data.get(k)) : null), setJSON: async (k, v) => void data.set(k, structuredClone(v)) };
}
function sse(text) {
  const enc = new TextEncoder();
  const evs = [{ type: "message_start", message: { usage: { input_tokens: 100 } } }, { type: "content_block_delta", delta: { type: "text_delta", text } }, { type: "message_delta", usage: { output_tokens: 7 } }, { type: "message_stop" }];
  return new ReadableStream({ start(c) { for (const e of evs) c.enqueue(enc.encode(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`)); c.close(); } });
}
// Sustituye al proveedor y anota con qué clave y qué modelo se le llama.
function stub({ fail = 0 } = {}) {
  const calls = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ key: init.headers["x-api-key"], model: body.model, stream: Boolean(body.stream) });
    if (!body.stream) return new Response(JSON.stringify({ content: [{ type: "text", text: "SAFE" }], usage: { input_tokens: 10, output_tokens: 1 } }), { status: 200 });
    if (fail) return new Response(JSON.stringify({ error: { message: "credit balance is too low" } }), { status: fail });
    return new Response(sse("Respuesta."), { status: 200, headers: { "content-type": "text/event-stream" } });
  };
  return { calls, restore: () => (globalThis.fetch = real) };
}
const turnId = (n) => "turno" + String(n).padStart(8, "0");
async function post(payload) {
  const r = await chat(new Request("http://x/api/chat", { method: "POST", body: JSON.stringify({ messages: [{ role: "user", content: "hola" }], ...payload }) }));
  const raw = await r.text();
  return { r, raw, left: r.headers.get("x-frome-courtesy") };
}
const check = async (code) => { const r = await status(new Request("http://x/api/courtesy", { method: "POST", body: JSON.stringify({ code }) })); return { status: r.status, body: await r.json() }; };
function on({ per = "3", total } = {}) {
  process.env.COURTESY_KEY = SERVER_KEY; process.env.COURTESY_CODES = `${C1}, ${C2} no-vale`; process.env.COURTESY_PER_CODE = per;
  if (total) process.env.COURTESY_TOTAL = total; else delete process.env.COURTESY_TOTAL;
  const s = memStore(); useCourtesyStore(s); return s;
}
function off() { delete process.env.COURTESY_KEY; delete process.env.COURTESY_CODES; delete process.env.COURTESY_PER_CODE; delete process.env.COURTESY_TOTAL; }

test("sin clave de cortesía o sin códigos, la función no existe", async () => {
  off(); useCourtesyStore(memStore());
  const s = stub();
  try {
    assert.equal((await post({ code: C1, turn: turnId(1), governed: false })).r.status, 403);
    assert.equal((await check(C1)).status, 404);
    assert.equal((await (await models()).json()).courtesy, false);
    assert.equal(s.calls.length, 0, "no se llama al proveedor");
  } finally { s.restore(); }
});

test("código válido: clave del servidor, modelo fijado y una pregunta por turno aunque haya comparador", async () => {
  on();
  assert.equal(courtesyConfig().codes.size, 2, "solo cuentan los códigos bien formados");
  assert.equal((await (await models()).json()).courtesy, true);
  assert.deepEqual((await check(C1)).body, { ok: true, remaining: 3, per: 3, model: "Claude Opus 5.5" });
  const s = stub();
  try {
    const a = await post({ code: " fe-aaaa-bbbb-cccc ", turn: turnId(1), governed: false, model: "claude-fable-5-1" });
    assert.equal(a.r.status, 200); assert.equal(a.left, "2");
    assert.ok(s.calls.every((c) => c.key === SERVER_KEY), "se usa la clave del servidor");
    assert.ok(s.calls.every((c) => !c.stream || c.model === "claude-opus-5-5"), "el modelo queda fijado");
    assert.ok(!a.raw.includes(SERVER_KEY), "la clave no sale en la respuesta");
    // La llamada gobernada de la misma pregunta no gasta otra.
    const b = await post({ code: C1, turn: turnId(1), governed: true });
    assert.equal(b.r.status, 200); assert.equal(b.left, "2");
    assert.ok(!b.raw.includes(SERVER_KEY));
    // Repetir la misma llamada de la misma pregunta se rechaza sin llamar al proveedor.
    const n = s.calls.length;
    assert.equal((await post({ code: C1, turn: turnId(1), governed: false })).r.status, 409);
    assert.equal(s.calls.length, n);
    assert.equal((await post({ code: C1, turn: turnId(2), governed: false })).left, "1");
    assert.equal((await post({ code: C1, turn: turnId(3), governed: false })).left, "0");
    const x = await post({ code: C1, turn: turnId(4), governed: false });
    assert.equal(x.r.status, 402); assert.match(JSON.parse(x.raw).message, /propia clave/);
    assert.equal((await check(C1)).body.remaining, 0);
    assert.equal((await check(C2)).body.remaining, 3, "cada código lleva su cuenta");
  } finally { s.restore(); }
});

test("código desconocido, turno mal formado, mensaje demasiado largo y ciclo por etapas: nada se gasta", async () => {
  on();
  const s = stub();
  try {
    assert.equal((await post({ code: "FE-ZZZZ-ZZZZ-ZZZZ", turn: turnId(1), governed: false })).r.status, 403);
    assert.equal((await check("FE-ZZZZ-ZZZZ-ZZZZ")).status, 403);
    assert.equal((await post({ code: C1, turn: "x", governed: false })).r.status, 400);
    assert.equal((await post({ code: C1, turn: turnId(1), governed: false, messages: [{ role: "user", content: "a".repeat(6001) }] })).r.status, 413);
    assert.equal((await post({ code: C1, turn: turnId(1), governed: true, state: "abc" })).r.status, 400);
    assert.equal(s.calls.length, 0);
    assert.equal((await check(C1)).body.remaining, 3);
  } finally { s.restore(); }
});

test("si el proveedor falla, la pregunta se devuelve y el error no revela nada", async () => {
  on();
  const s = stub({ fail: 400 });
  try {
    const a = await post({ code: C1, turn: turnId(1), governed: false });
    assert.equal(a.r.status, 503);
    assert.ok(!a.raw.includes("credit balance") && !a.raw.includes(SERVER_KEY));
    assert.equal((await check(C1)).body.remaining, 3);
  } finally { s.restore(); }
});

test("tope global: agotado, ningún código sigue aunque le queden preguntas", async () => {
  on({ total: "1" });
  const s = stub();
  try {
    assert.equal((await post({ code: C1, turn: turnId(1), governed: false })).r.status, 200);
    const x = await post({ code: C2, turn: turnId(2), governed: false });
    assert.equal(x.r.status, 402); assert.match(JSON.parse(x.raw).message, /agotado/);
  } finally { s.restore(); }
});

test("con clave propia válida se ignora el código y no se gasta cortesía", async () => {
  on();
  const s = stub();
  try {
    const a = await post({ key: USER_KEY, code: C1, turn: turnId(1), governed: false });
    assert.equal(a.r.status, 200); assert.equal(a.left, null);
    assert.ok(s.calls.every((c) => c.key === USER_KEY));
    assert.equal((await check(C1)).body.remaining, 3);
  } finally { s.restore(); off(); }
});
