// Sala de reunión privada: contraseña en la ruta, claves que solo viajan en la cabecera,
// un proveedor por turno y nada que se guarde en el servidor.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";

const mod = await import("../netlify/functions/meeting.mjs");
const meeting = mod.default;
const { chatModels, pickModel, PROVIDERS } = mod;
const { PAGE } = await import("../netlify/functions/lib/meeting-page.mjs");

const TOKEN = "contraseña-de-la-sala-0123456789";
const P = "/reunion/" + encodeURIComponent(TOKEN);
const enc = new TextEncoder();
const sse = (events) => new Response(new ReadableStream({ start(c) { for (const e of events) c.enqueue(enc.encode("data: " + (typeof e === "string" ? e : JSON.stringify(e)) + "\n\n")); c.close(); } }), { status: 200, headers: { "content-type": "text/event-stream" } });

function env(vars, fn) {
  const keys = ["MEETING_TOKEN", "SELFTEST_TOKEN", "MEETING_ANTHROPIC_KEY", "SELFTEST_KEY"];
  const old = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) delete process.env[k];
  Object.assign(process.env, vars);
  return Promise.resolve().then(fn).finally(() => { for (const k of keys) { if (old[k] === undefined) delete process.env[k]; else process.env[k] = old[k]; } });
}
function stub(handler) {
  const real = globalThis.fetch; const calls = [];
  globalThis.fetch = async (url, init = {}) => { const c = { url: String(url), headers: init.headers || {}, body: init.body ? JSON.parse(init.body) : null }; calls.push(c); return handler(c, calls.length); };
  return { calls, restore: () => (globalThis.fetch = real) };
}
const get = (path, headers) => meeting(new Request("http://x" + path, { headers }));
const post = (path, body, headers) => meeting(new Request("http://x" + path, { method: "POST", body: JSON.stringify(body), headers }));
async function events(res) {
  const raw = await res.text();
  return raw.split("\n\n").filter((l) => l.startsWith("data: ")).map((l) => JSON.parse(l.slice(6)));
}

test("sin contraseña definida, o con otra, la sala no existe", async () => {
  await env({}, async () => assert.equal((await get(P)).status, 404));
  await env({ MEETING_TOKEN: "corta" }, async () => assert.equal((await get("/reunion/corta")).status, 404));
  await env({ MEETING_TOKEN: TOKEN }, async () => {
    assert.equal((await get("/reunion/otra-contraseña-distinta-012345")).status, 404);
    assert.equal((await get("/reunion")).status, 404);
    assert.equal((await post(P + "/turno/openai", { model: "m", prompt: "p" })).status, 400, "sin clave no se llama a nadie");
    assert.equal((await get(P + "/modelos/otro", { "x-provider-key": "k" })).status, 404);
  });
});

test("con la contraseña se sirve la página, privada y sin recursos externos", async () => {
  await env({ MEETING_TOKEN: TOKEN }, async () => {
    const r = await get(P);
    assert.equal(r.status, 200);
    assert.match(r.headers.get("content-type"), /text\/html/);
    assert.equal(r.headers.get("cache-control"), "no-store");
    assert.match(r.headers.get("x-robots-tag"), /noindex/);
    assert.equal(r.headers.get("referrer-policy"), "no-referrer");
    const html = await r.text();
    assert.ok(html.includes("Sala de reunión"));
    const css = (html.match(/<style>([\s\S]*?)<\/style>/) || ["", ""])[1];
    assert.ok(!/<script[^>]+src=|<link[^>]+href=|<img|<iframe/i.test(html) && !/@import|url\(/i.test(css), "no carga nada de fuera");
    assert.ok(!html.includes(TOKEN), "la contraseña no está escrita en la página");
  });
  // La contraseña de las pruebas internas sirve mientras no haya una propia.
  await env({ SELFTEST_TOKEN: TOKEN }, async () => assert.equal((await get(P)).status, 200));
});

test("el guion de la página es JavaScript válido", () => {
  const scripts = [...PAGE.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  assert.equal(scripts.length, 1);
  assert.doesNotThrow(() => new vm.Script(scripts[0]));
});

test("lista los modelos de conversación de cada proveedor con la clave de la cabecera", async () => {
  await env({ MEETING_TOKEN: TOKEN }, async () => {
    let s = stub(() => new Response(JSON.stringify({ data: [
      { id: "gpt-9-mini", created: 5 }, { id: "gpt-9", created: 4 }, { id: "gpt-8.5", created: 3 }, { id: "text-embedding-9", created: 9 },
      { id: "gpt-9-realtime", created: 9 }, { id: "whisper-2", created: 1 }, { id: "ft:algo", created: 9 },
    ] }), { status: 200 }));
    try {
      const r = await get(P + "/modelos/openai", { "x-provider-key": "sk-usuario" });
      const j = await r.json();
      assert.deepEqual(j.models.map((m) => m.id), ["gpt-9-mini", "gpt-9", "gpt-8.5"]);
      assert.equal(j.suggested, "gpt-9");
      assert.equal(s.calls[0].url, "https://api.openai.com/v1/models");
      assert.equal(s.calls[0].headers.authorization, "Bearer sk-usuario");
    } finally { s.restore(); }
    s = stub(() => new Response(JSON.stringify({ error: { message: "Incorrect API key provided: sk-usuario1234567890abcdef" } }), { status: 401 }));
    try {
      const r = await get(P + "/modelos/mistral", { "x-provider-key": "sk-usuario1234567890abcdef" });
      assert.equal(r.status, 401);
      const j = await r.json();
      assert.ok(j.error.startsWith("Mistral: "));
      assert.ok(!j.error.includes("sk-usuario1234567890abcdef"), "el mensaje de error no devuelve la clave");
    } finally { s.restore(); }
  });
});

test("para Claude, sin clave pegada, se usa la del servidor si existe", async () => {
  await env({ MEETING_TOKEN: TOKEN, SELFTEST_KEY: "sk-ant-servidor" }, async () => {
    assert.deepEqual(await (await get(P + "/estado")).json(), { serverKey: { anthropic: true } });
    const s = stub(() => new Response(JSON.stringify({ data: [{ id: "claude-sonnet-5-5", display_name: "Claude Sonnet 5.5", created_at: "2026-02-01T00:00:00Z" }, { id: "claude-opus-5-5", display_name: "Claude Opus 5.5", created_at: "2026-01-01T00:00:00Z" }] }), { status: 200 }));
    try {
      const j = await (await get(P + "/modelos/anthropic")).json();
      assert.equal(j.suggested, "claude-opus-5-5");
      assert.equal(s.calls[0].headers["x-api-key"], "sk-ant-servidor");
      assert.ok(!JSON.stringify(j).includes("sk-ant-servidor"));
      assert.equal((await get(P + "/modelos/deepseek")).status, 400, "los demás proveedores no tienen clave de servidor");
    } finally { s.restore(); }
  });
  await env({ MEETING_TOKEN: TOKEN }, async () => assert.deepEqual(await (await get(P + "/estado")).json(), { serverKey: { anthropic: false } }));
});

test("un turno llama solo al proveedor pedido y reenvía su texto", async () => {
  await env({ MEETING_TOKEN: TOKEN }, async () => {
    const reply = () => sse([{ choices: [{ delta: { reasoning_content: "pensando" } }] }, { choices: [{ delta: { content: "Hola" } }] }, { choices: [{ delta: { content: " a todos." } }] }, { choices: [], usage: { prompt_tokens: 120, completion_tokens: 7 } }, "[DONE]"]);
    for (const [provider, url, param] of [["openai", "https://api.openai.com/v1/chat/completions", "max_completion_tokens"], ["mistral", "https://api.mistral.ai/v1/chat/completions", "max_tokens"], ["deepseek", "https://api.deepseek.com/chat/completions", "max_tokens"]]) {
      const s = stub(reply);
      try {
        const r = await post(P + "/turno/" + provider, { model: "modelo-x", system: "Reglas", prompt: "Transcripción" }, { "x-provider-key": "clave-" + provider });
        assert.equal(r.status, 200);
        const ev = await events(r);
        assert.equal(ev.filter((e) => e.t).map((e) => e.t).join(""), "Hola a todos.");
        assert.ok(ev.some((e) => e.thinking), "avisa de que el modelo razona antes de escribir");
        assert.deepEqual(ev.at(-1), { done: true, usage: { input: 120, output: 7 } });
        assert.equal(s.calls.length, 1);
        assert.equal(s.calls[0].url, url);
        assert.equal(s.calls[0].headers.authorization, "Bearer clave-" + provider);
        assert.equal(s.calls[0].body.model, "modelo-x");
        assert.deepEqual(s.calls[0].body.messages, [{ role: "system", content: "Reglas" }, { role: "user", content: "Transcripción" }]);
        assert.equal(s.calls[0].body[param], PROVIDERS[provider].cap);
        assert.ok(!JSON.stringify(ev).includes("clave-" + provider));
      } finally { s.restore(); }
    }
  });
});

test("el turno de Claude usa su formato y repite sin el nivel de razonamiento si el modelo no lo admite", async () => {
  await env({ MEETING_TOKEN: TOKEN }, async () => {
    const s = stub((c, n) => (n === 1 ? new Response(JSON.stringify({ error: { message: "output_config no admitido" } }), { status: 400 }) : sse([{ type: "message_start", message: { usage: { input_tokens: 300 } } }, { type: "content_block_delta", delta: { type: "text_delta", text: "De acuerdo en parte." } }, { type: "message_delta", usage: { output_tokens: 9 } }])));
    try {
      const ev = await events(await post(P + "/turno/anthropic", { model: "claude-opus-5-5", system: "Reglas", prompt: "Transcripción" }, { "x-provider-key": "sk-ant-usuario" }));
      assert.equal(ev.find((e) => e.t).t, "De acuerdo en parte.");
      assert.deepEqual(ev.at(-1), { done: true, usage: { input: 300, output: 9 } });
      assert.equal(s.calls.length, 2);
      assert.equal(s.calls[0].url, "https://api.anthropic.com/v1/messages");
      assert.deepEqual(s.calls[0].body.output_config, { effort: "low" });
      assert.equal(s.calls[1].body.output_config, undefined);
      assert.equal(s.calls[1].body.system, "Reglas");
      assert.equal(s.calls[1].headers["x-api-key"], "sk-ant-usuario");
    } finally { s.restore(); }
  });
});

test("los errores del proveedor llegan a la sala con su nombre, y un turno vacío se avisa", async () => {
  await env({ MEETING_TOKEN: TOKEN }, async () => {
    let s = stub(() => new Response(JSON.stringify({ error: { message: "Insufficient Balance" } }), { status: 402 }));
    try {
      const ev = await events(await post(P + "/turno/deepseek", { model: "deepseek-chat", prompt: "x" }, { "x-provider-key": "k" }));
      assert.deepEqual(ev, [{ error: "DeepSeek (402): Insufficient Balance" }]);
    } finally { s.restore(); }
    s = stub(() => sse(["[DONE]"]));
    try {
      const ev = await events(await post(P + "/turno/mistral", { model: "m", prompt: "x" }, { "x-provider-key": "k" }));
      assert.match(ev[0].error, /no ha devuelto texto/);
    } finally { s.restore(); }
    assert.equal((await post(P + "/turno/openai", { model: "", prompt: "x" }, { "x-provider-key": "k" })).status, 400);
    assert.equal((await post(P + "/turno/openai", { model: "m", prompt: "x".repeat(400001) }, { "x-provider-key": "k" })).status, 413);
  });
});

test("modelo propuesto por proveedor", () => {
  const ids = (...a) => a.map((id) => ({ id, label: id }));
  assert.equal(pickModel("mistral", ids("mistral-small-latest", "mistral-large-latest")), "mistral-large-latest");
  assert.equal(pickModel("deepseek", ids("deepseek-chat", "deepseek-reasoner")), "deepseek-reasoner");
  assert.equal(pickModel("anthropic", ids("claude-haiku-5-5", "claude-opus-6")), "claude-opus-6");
  assert.equal(pickModel("openai", ids("gpt-5-nano", "gpt-5.5-2026-03-01", "gpt-5.5", "gpt-5", "o9")), "gpt-5.5");
  assert.equal(pickModel("openai", []), "");
  assert.deepEqual(chatModels("mistral", [{ id: "mistral-embed", capabilities: { completion_chat: false } }, { id: "mistral-large-latest", capabilities: { completion_chat: true } }, { id: "mistral-ocr-latest" }]).map((m) => m.id), ["mistral-large-latest"]);
});
