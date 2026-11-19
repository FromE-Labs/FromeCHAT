import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";

const TOKEN = "alta-de-pruebas-0123456789abcdef";
const KEY = "sk-ant-" + "k".repeat(40);
process.env.CONTAINER_SETUP_TOKEN = TOKEN;
delete process.env.SELFTEST_KEY; delete process.env.CONTAINER_KEY;
const mod = await import("../netlify/functions/container.mjs");
const container = mod.default;

function fakeStore() {
  const m = new Map();
  return { m, get: async (k) => (m.has(k) ? m.get(k) : null), set: async (k, v) => void m.set(k, v) };
}
const U = "https://sitio.example/contenedor/";
function call(store, method, path, { body, cookie, header = true, headers = {} } = {}) {
  const h = { ...headers };
  if (header && method !== "GET") h["x-contenedor"] = "1";
  if (cookie) h.cookie = cookie;
  if (body !== undefined) h["content-type"] = "application/json";
  return container(new Request(U + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) }), {}, store);
}
const cookieFrom = (r) => (r.headers.get("set-cookie") || "").split(";")[0];
async function account(store, user = "esmeralda", pass = "una-contraseña-larga") {
  const r = await call(store, "POST", "api/alta", { body: { token: TOKEN, user, pass } });
  assert.equal(r.status, 200);
  return cookieFrom(r);
}
// Sustituye fetch por un proveedor de pruebas y guarda lo que recibe.
function provider({ text = "Respuesta del modelo.", status = 200 } = {}) {
  const real = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, init) => {
    seen.push({ url: String(url), headers: init.headers, body: init.body ? JSON.parse(init.body) : null, raw: init.body });
    if (String(url).includes("/models")) return new Response(JSON.stringify({ data: [{ id: "claude-opus-5-5", display_name: "Claude Opus 5.5" }] }), { status: 200 });
    if (status !== 200) return new Response(JSON.stringify({ error: { message: "parámetro no admitido" } }), { status });
    const enc = new TextEncoder();
    const evs = [
      { type: "message_start", message: { usage: { input_tokens: 12, cache_read_input_tokens: 0, cache_creation_input_tokens: 900 } } },
      { type: "content_block_delta", delta: { type: "thinking_delta", thinking: "…" } },
      { type: "content_block_delta", delta: { type: "text_delta", text: text.slice(0, 9) } },
      { type: "content_block_delta", delta: { type: "text_delta", text: text.slice(9) } },
      { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 33 } },
    ];
    return new Response(new ReadableStream({ start(c) { for (const e of evs) c.enqueue(enc.encode(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`)); c.close(); } }), { status: 200 });
  };
  return { seen, restore: () => (globalThis.fetch = real) };
}
const events = async (r) => (await r.text()).split("\n\n").filter((l) => l.startsWith("data: ")).map((l) => JSON.parse(l.slice(6)));
const ARCH = "  Regla uno:\tno toques nada.\r\n\r\nRegla dos — «con comillas», emoji 🧭 y línea final con espacios   \n\n";

test("página: se sirve sola, sin recursos externos, y el script es válido", async () => {
  const s = fakeStore();
  const r = await call(s, "GET", "");
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-security-policy"), /default-src 'none'/);
  assert.equal(r.headers.get("cache-control"), "no-store");
  const html = await r.text();
  assert.ok(!/(src|href)="https?:/.test(html) && html.includes("var SETUP = \"\";"));
  new vm.Script(html.match(/<script>([\s\S]*)<\/script>/)[1]);
  const alta = await (await call(s, "GET", "alta/" + TOKEN)).text();
  assert.ok(alta.includes(`var SETUP = "${TOKEN}";`));
  assert.equal((await call(s, "GET", "otra-cosa")).status, 404);
});

test("alta: una sola cuenta, con la dirección de alta y contraseña suficiente", async () => {
  const s = fakeStore();
  assert.equal((await call(s, "POST", "api/alta", { body: { token: "x".repeat(32), user: "eva", pass: "0123456789ab" } })).status, 403);
  assert.equal((await call(s, "POST", "api/alta", { body: { token: TOKEN, user: "e", pass: "0123456789ab" } })).status, 400);
  assert.equal((await call(s, "POST", "api/alta", { body: { token: TOKEN, user: "eva", pass: "corta" } })).status, 400);
  assert.equal((await call(s, "POST", "api/alta", { body: { token: TOKEN, user: "eva", pass: "0123456789ab" }, header: false })).status, 403, "sin la cabecera propia no se admite");
  const r = await call(s, "POST", "api/alta", { body: { token: TOKEN, user: "eva", pass: "0123456789ab" } });
  assert.equal(r.status, 200);
  const c = r.headers.get("set-cookie");
  assert.ok(/HttpOnly/.test(c) && /Secure/.test(c) && /SameSite=Strict/.test(c) && /Path=\/contenedor/.test(c));
  assert.equal((await call(s, "POST", "api/alta", { body: { token: TOKEN, user: "otra", pass: "0123456789ab" } })).status, 409, "no hay segunda cuenta");
  const stored = [...s.m.values()].join("\n");
  assert.ok(!stored.includes("0123456789ab"), "la contraseña no se guarda");
});

test("entrada: contraseña correcta, incorrecta y bloqueo por intentos", async () => {
  const s = fakeStore();
  await account(s, "eva", "la-buena-contraseña");
  assert.equal((await call(s, "POST", "api/entrar", { body: { user: "eva", pass: "otra-contraseña-x" } })).status, 401);
  assert.equal((await call(s, "POST", "api/entrar", { body: { user: "ana", pass: "la-buena-contraseña" } })).status, 401);
  const ok = await call(s, "POST", "api/entrar", { body: { user: "eva", pass: "la-buena-contraseña" } });
  assert.equal(ok.status, 200);
  const st = await (await call(s, "GET", "api/estado", { cookie: cookieFrom(ok) })).json();
  assert.deepEqual([st.account, st.user, st.saved, st.serverKey], [true, "eva", null, false]);
  assert.equal((await (await call(s, "GET", "api/estado")).json()).user, null);
  for (let i = 0; i < 8; i++) await call(s, "POST", "api/entrar", { body: { user: "eva", pass: "mala-mala-mala" } });
  assert.equal((await call(s, "POST", "api/entrar", { body: { user: "eva", pass: "la-buena-contraseña" } })).status, 429, "bloqueada tras ocho fallos");
});

test("sin sesión no se lee ni se envía nada", async () => {
  const s = fakeStore();
  await account(s);
  for (const [m, p] of [["GET", "api/arquitectura"], ["PUT", "api/arquitectura"], ["POST", "api/mensaje"], ["GET", "api/modelos"]]) {
    assert.equal((await call(s, m, p, { body: m === "GET" ? undefined : {} })).status, 401, p);
  }
  assert.equal((await call(s, "GET", "api/arquitectura", { cookie: "fe_cont=inventada" })).status, 401);
});

test("el texto se guarda exactamente como se escribió, cifrado, y con sus versiones", async () => {
  const s = fakeStore();
  const c = await account(s);
  const saved = await (await call(s, "PUT", "api/arquitectura", { cookie: c, body: { text: ARCH } })).json();
  assert.equal(saved.ok, true);
  const back = await (await call(s, "GET", "api/arquitectura", { cookie: c })).json();
  assert.equal(back.text, ARCH, "ni recortes ni normalización");
  assert.equal(back.sha, saved.sha);
  const stored = [...s.m.values()].join("\n");
  assert.ok(!stored.includes("Regla uno") && !stored.includes("Regla dos"), "en el almacén no hay texto legible");
  // Guardar lo mismo no crea versión; guardar otra cosa sí, y la anterior se puede abrir.
  assert.equal((await (await call(s, "PUT", "api/arquitectura", { cookie: c, body: { text: ARCH } })).json()).unchanged, true);
  const two = await (await call(s, "PUT", "api/arquitectura", { cookie: c, body: { text: "Segunda versión." } })).json();
  assert.deepEqual(two.versions.map((v) => v.chars), ["Segunda versión.".length, ARCH.length]);
  assert.equal((await (await call(s, "GET", "api/arquitectura?v=" + saved.sha, { cookie: c })).json()).text, ARCH);
  assert.equal((await (await call(s, "GET", "api/arquitectura", { cookie: c })).json()).text, "Segunda versión.");
});

test("lo guardado solo se abre con la contraseña", async () => {
  const s = fakeStore();
  const c = await account(s, "eva", "primera-contraseña");
  await call(s, "PUT", "api/arquitectura", { cookie: c, body: { text: ARCH } });
  // Con la misma contraseña, otra sesión lo abre.
  const again = cookieFrom(await call(s, "POST", "api/entrar", { body: { user: "eva", pass: "primera-contraseña" } }));
  assert.equal((await (await call(s, "GET", "api/arquitectura", { cookie: again })).json()).text, ARCH);
  // Quien tenga el almacén entero, sin la contraseña ni la galleta, no tiene la clave del texto.
  const acc = JSON.parse(s.m.get("account"));
  assert.ok(acc.wrapped && acc.verifier && acc.salt && !("dek" in acc) && !("pass" in acc));
  // Una galleta de otra cuenta (otro almacén) no vale aquí.
  const other = fakeStore();
  const foreign = await account(other, "eva", "primera-contraseña");
  assert.equal((await call(s, "GET", "api/arquitectura", { cookie: foreign })).status, 401);
});

test("al modelo le llega el texto tal cual, en un solo bloque, y nada más", async () => {
  const s = fakeStore();
  const c = await account(s);
  await call(s, "PUT", "api/arquitectura", { cookie: c, body: { text: ARCH } });
  const p = provider();
  try {
    const talk = [{ role: "user", content: "Primera pregunta." }, { role: "assistant", content: "Primera respuesta." }, { role: "user", content: "Segunda pregunta." }];
    const r = await call(s, "POST", "api/mensaje", { cookie: c, body: { model: "claude-opus-5-5", max_tokens: 2048, messages: talk, key: KEY } });
    assert.equal(r.status, 200);
    const ev = await events(r);
    const sent = p.seen[0];
    assert.equal(sent.url, "https://api.anthropic.com/v1/messages");
    assert.equal(sent.headers["x-api-key"], KEY);
    assert.deepEqual(Object.keys(sent.body).sort(), ["max_tokens", "messages", "model", "stream", "system"]);
    assert.equal(sent.body.system.length, 1);
    assert.equal(sent.body.system[0].text, ARCH, "idéntico, carácter a carácter");
    assert.deepEqual(sent.body.messages, talk, "la conversación, sin añadidos");
    assert.equal(sent.body.max_tokens, 2048);
    // Lo que se enseña como enviado es exactamente lo que se envió, y no lleva la clave.
    assert.deepEqual(ev[0].request, sent.body);
    assert.equal(ev[0].type, "sent");
    assert.ok(!JSON.stringify(ev).includes(KEY));
    assert.equal(ev.filter((e) => e.type === "t").map((e) => e.text).join(""), "Respuesta del modelo.");
    assert.equal(ev.filter((e) => e.type === "thinking").length, 1);
    assert.deepEqual(ev.at(-1), { type: "done", usage: { input: 12, output: 33, cache_read: 0, cache_write: 900 }, stop: "end_turn", ms: ev.at(-1).ms });
  } finally { p.restore(); }
});

test("sin arquitectura no hay instrucciones; el razonamiento solo va si se elige", async () => {
  const s = fakeStore();
  const c = await account(s);
  const p = provider();
  try {
    const one = [{ role: "user", content: "Hola." }];
    // Sin nada guardado, el envío normal se rechaza y el envío sin arquitectura sale.
    assert.equal((await call(s, "POST", "api/mensaje", { cookie: c, body: { model: "claude-opus-5-5", messages: one, key: KEY } })).status, 409);
    await events(await call(s, "POST", "api/mensaje", { cookie: c, body: { model: "claude-opus-5-5", messages: one, key: KEY, bare: true, effort: "high" } }));
    assert.ok(!("system" in p.seen[0].body));
    assert.deepEqual(p.seen[0].body.output_config, { effort: "high" });
    await call(s, "PUT", "api/arquitectura", { cookie: c, body: { text: "Texto." } });
    await events(await call(s, "POST", "api/mensaje", { cookie: c, body: { model: "claude-opus-5-5", messages: one, key: KEY, effort: "inventado" } }));
    assert.ok(!("output_config" in p.seen[1].body), "un valor desconocido no se envía");
  } finally { p.restore(); }
});

test("peticiones mal formadas y errores del proveedor se devuelven tal cual", async () => {
  const s = fakeStore();
  const c = await account(s);
  await call(s, "PUT", "api/arquitectura", { cookie: c, body: { text: "Texto." } });
  const one = [{ role: "user", content: "Hola." }];
  const post = (body) => call(s, "POST", "api/mensaje", { cookie: c, body });
  assert.equal((await post({ model: "claude-opus-5-5", messages: one })).status, 400, "sin clave");
  assert.equal((await post({ model: "gpt-x", messages: one, key: KEY })).status, 400, "modelo");
  assert.equal((await post({ model: "claude-opus-5-5", messages: [{ role: "assistant", content: "x" }], key: KEY })).status, 400);
  assert.equal((await post({ model: "claude-opus-5-5", messages: [...one, { role: "assistant", content: "y" }], key: KEY })).status, 400);
  const p = provider({ status: 400 });
  try {
    const r = await post({ model: "claude-opus-5-5", messages: one, key: KEY, effort: "low" });
    assert.equal(r.status, 502);
    const j = await r.json();
    assert.equal(j.error, "parámetro no admitido");
    assert.equal(j.status, 400);
    assert.equal(p.seen.length, 1, "no se reintenta con otros parámetros");
    assert.equal(j.sent.system[0].text, "Texto.");
  } finally { p.restore(); }
});

test("con clave en el servidor no hace falta pegarla; la lista de modelos sale del proveedor", async () => {
  const s = fakeStore();
  const c = await account(s);
  await call(s, "PUT", "api/arquitectura", { cookie: c, body: { text: "Texto." } });
  process.env.CONTAINER_KEY = KEY;
  const p = provider();
  try {
    assert.equal((await (await call(s, "GET", "api/estado", { cookie: c })).json()).serverKey, true);
    const models = await (await call(s, "GET", "api/modelos", { cookie: c })).json();
    assert.deepEqual(models.models, [{ id: "claude-opus-5-5", name: "Claude Opus 5.5" }]);
    await events(await call(s, "POST", "api/mensaje", { cookie: c, body: { model: "claude-opus-5-5", messages: [{ role: "user", content: "Hola." }] } }));
    assert.equal(p.seen[1].headers["x-api-key"], KEY);
  } finally { p.restore(); delete process.env.CONTAINER_KEY; }
});

test("salir borra la galleta", async () => {
  const s = fakeStore();
  const c = await account(s);
  const r = await call(s, "POST", "api/salir", { cookie: c, body: {} });
  assert.match(r.headers.get("set-cookie"), /fe_cont=; .*Max-Age=0/);
});
