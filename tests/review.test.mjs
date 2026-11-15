import test from "node:test";
import assert from "node:assert/strict";

const { default: review } = await import("../netlify/functions/review.mjs");

const TOKEN = "contraseña-de-revisión-larga-123";
const URL_ = "https://chat.ejemplo/api/review";

function memStore(init = {}) {
  const data = new Map(Object.entries(init));
  return {
    data,
    list: async () => ({ blobs: [...data.keys()].map((key) => ({ key })) }),
    get: async (key) => (data.has(key) ? structuredClone(data.get(key)) : null),
    setJSON: async (key, v) => void data.set(key, structuredClone(v)),
    delete: async (key) => void data.delete(key),
  };
}
const turn = (ts, condition, text) => ({
  schema: "frome-chat/turn/v2", ts, sessionId: "sesion-abc123", model: "claude-opus-5-5", condition,
  messages: [{ role: "user", content: "Pregunta privada del usuario" }], assistant: text,
  cycle: condition === "from-e" ? { path: ["directa"], signal: "From E™ · una llamada", withheld: false, modules: ["origen"] } : null,
});
const K1 = "2026-11-10/sesion-abc123/2026-11-10T10-00-00-000Z.json";
const K2 = "2026-11-11/sesion-abc123/2026-11-11T09-00-00-000Z.json";
const fresh = () => ({ turns: memStore({ [K1]: turn("2026-11-10T10:00:00.000Z", "from-e", "Respuesta uno"), [K2]: turn("2026-11-11T09:00:00.000Z", "baseline", "Respuesta dos") }), reviews: memStore() });
const call = (stores, { method = "GET", query = "", token = TOKEN, body } = {}) =>
  review(new Request(URL_ + query, { method, headers: token ? { "x-review-token": token } : {}, body: body ? JSON.stringify(body) : undefined }), {}, stores);

test("sin variable o sin contraseña correcta no existe", async () => {
  delete process.env.REVIEW_TOKEN;
  assert.equal((await call(fresh())).status, 404);
  process.env.REVIEW_TOKEN = "corta";
  assert.equal((await call(fresh(), { token: "corta" })).status, 404);
  process.env.REVIEW_TOKEN = TOKEN;
  assert.equal((await call(fresh(), { token: "" })).status, 404);
  assert.equal((await call(fresh(), { token: TOKEN + "x" })).status, 404);
  // La contraseña en la URL no sirve.
  assert.equal((await call(fresh(), { token: "", query: "?t=" + encodeURIComponent(TOKEN) })).status, 404);
});

test("lista los turnos aportados, del más reciente al más antiguo, con su revisión", async () => {
  process.env.REVIEW_TOKEN = TOKEN;
  const stores = fresh();
  stores.reviews.data.set(K1, { verdict: "falla", module: "origen", failure: "", correction: "Primero verifica.", ts: "2026-11-11T12:00:00.000Z" });
  const r = await call(stores);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("cache-control"), "no-store");
  const data = await r.json();
  assert.equal(data.total, 2);
  assert.deepEqual(data.turns.map((t) => t.key), [K2, K1]);
  assert.equal(data.turns[1].review.correction, "Primero verifica.");
  assert.deepEqual(data.turns[1].modules, ["origen"]);
  assert.equal(data.next, null);
});

test("guarda, sustituye y borra la corrección de un turno existente", async () => {
  process.env.REVIEW_TOKEN = TOKEN;
  const stores = fresh();
  let r = await call(stores, { method: "POST", body: { key: K1, verdict: "falla", module: "origen", failure: "Propuso sin mirar.", correction: "¿Cómo decides sin el origen?" } });
  assert.equal(r.status, 200);
  assert.equal(stores.reviews.data.get(K1).correction, "¿Cómo decides sin el origen?");
  assert.equal(stores.reviews.data.get(K1).verdict, "falla");
  // Turno inexistente o clave con otra forma.
  assert.equal((await call(stores, { method: "POST", body: { key: "2026-11-10/otra-sesion/x.json", correction: "x" } })).status, 404);
  assert.equal((await call(stores, { method: "POST", body: { key: "../secreto", correction: "x" } })).status, 404);
  // Vacía: se borra.
  r = await call(stores, { method: "POST", body: { key: K1, verdict: "", failure: "", correction: "" } });
  assert.equal((await r.json()).review, null);
  assert.equal(stores.reviews.data.has(K1), false);
});

test("la exportación lleva solo lo escrito por la autora, nunca la conversación", async () => {
  process.env.REVIEW_TOKEN = TOKEN;
  const stores = fresh();
  await call(stores, { method: "POST", body: { key: K1, verdict: "falla", module: "origen", failure: "Propuso sin mirar.", correction: "¿Cómo decides sin el origen?" } });
  await call(stores, { method: "POST", body: { key: K2, verdict: "bien" } });
  const text = await (await call(stores, { query: "?export=1" })).text();
  const data = JSON.parse(text);
  assert.equal(data.count, 1);
  assert.equal(data.items[0].module, "origen");
  assert.equal(data.items[0].correction, "¿Cómo decides sin el origen?");
  assert.ok(!text.includes("Pregunta privada") && !text.includes("Respuesta uno"));
});
