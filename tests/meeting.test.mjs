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

test("texto que llega troceado por tipos (Mistral): se entrega el texto y el razonamiento no", async () => {
  await env({ MEETING_TOKEN: TOKEN }, async () => {
    const s = stub(() => sse([
      { choices: [{ delta: { content: [{ type: "thinking", thinking: [{ type: "text", text: "a ver…" }] }] } }] },
      { choices: [{ delta: { content: [{ type: "text", text: "Buenas " }] } }] },
      { choices: [{ delta: { content: [{ type: "text", text: "tardes." }] } }] },
      { choices: [{ delta: { content: "" } }], usage: { prompt_tokens: 40, completion_tokens: 5 } },
    ]));
    try {
      const ev = await events(await post(P + "/turno/mistral", { model: "mistral-large-latest", prompt: "x" }, { "x-provider-key": "k" }));
      assert.equal(ev.filter((e) => e.t !== undefined).map((e) => e.t).join(""), "Buenas tardes.");
      assert.ok(ev.every((e) => e.t === undefined || typeof e.t === "string"));
      assert.ok(ev.some((e) => e.thinking));
      assert.ok(!JSON.stringify(ev).includes("a ver"), "el razonamiento previo no entra en la sala");
    } finally { s.restore(); }
  });
  assert.equal(mod.deltaText([{ type: "text", text: "a" }, "b", { type: "thinking", thinking: [] }, null]), "ab");
  assert.equal(mod.deltaText(undefined), "");
});

test("contexto permanente: se guarda en el servidor y vuelve tal cual; sin contraseña no existe", async () => {
  const mem = new Map();
  const store = { get: async (k) => (mem.has(k) ? JSON.parse(mem.get(k)) : null), setJSON: async (k, v) => void mem.set(k, JSON.stringify(v)) };
  const call = (method, path, body) => meeting(new Request("http://x" + path, { method, body: body === undefined ? undefined : JSON.stringify(body) }), {}, store);
  await env({ MEETING_TOKEN: TOKEN }, async () => {
    assert.deepEqual(await (await call("GET", P + "/contexto")).json(), { text: "", updated: null });
    const put = await (await call("PUT", P + "/contexto", { text: "Quién modera: Esmeralda.\nFrom E™ es…" })).json();
    assert.equal(put.ok, true);
    const got = await (await call("GET", P + "/contexto")).json();
    assert.equal(got.text, "Quién modera: Esmeralda.\nFrom E™ es…");
    assert.equal(got.updated, put.updated);
    assert.equal((await call("PUT", P + "/contexto", { text: "x".repeat(120001) })).status, 413);
    assert.equal((await call("DELETE", P + "/contexto")).status, 404);
    assert.equal((await call("GET", "/reunion/otra-contraseña-distinta-012345/contexto")).status, 404);
  });
  await env({}, async () => assert.equal((await call("GET", P + "/contexto")).status, 404));
});

test("Mistral: se pide razonamiento bajo y, si el modelo no lo admite, se repite sin él", async () => {
  await env({ MEETING_TOKEN: TOKEN }, async () => {
    const s = stub((c, n) => (n === 1 ? new Response(JSON.stringify({ message: "Extra inputs are not permitted" }), { status: 422 }) : sse([{ choices: [{ delta: { content: "Vale." } }] }])));
    try {
      const ev = await events(await post(P + "/turno/mistral", { model: "mistral-large-latest", prompt: "x" }, { "x-provider-key": "k" }));
      assert.equal(ev.find((e) => e.t).t, "Vale.");
      assert.equal(s.calls.length, 2);
      assert.equal(s.calls[0].body.reasoning_effort, "low");
      assert.equal(s.calls[1].body.reasoning_effort, undefined);
    } finally { s.restore(); }
  });
});

test("leer un archivo: la imagen o el PDF van al modelo con vista en su formato, y vuelve la transcripción", async () => {
  const IMG = "aGVsbG8gd29ybGQ=";
  await env({ MEETING_TOKEN: TOKEN }, async () => {
    let s = stub(() => sse([{ type: "content_block_delta", delta: { type: "text_delta", text: "Ana: hola\nLuis: buenas" } }, { type: "message_delta", usage: { output_tokens: 8 } }]));
    try {
      const ev = await events(await post(P + "/leer/anthropic", { model: "claude-opus-5-5", kind: "image", mime: "image/jpeg", data: IMG, name: "captura.png" }, { "x-provider-key": "sk-ant-u" }));
      assert.equal(ev.find((e) => e.t).t, "Ana: hola\nLuis: buenas");
      const content = s.calls[0].body.messages[0].content;
      assert.deepEqual(content[0], { type: "image", source: { type: "base64", media_type: "image/jpeg", data: IMG } });
      assert.match(content[1].text, /Transcribe fielmente/);
      assert.equal(s.calls[0].body.max_tokens, 8000);
    } finally { s.restore(); }
    s = stub(() => sse([{ type: "content_block_delta", delta: { type: "text_delta", text: "x" } }]));
    try {
      await events(await post(P + "/leer/anthropic", { model: "m", kind: "pdf", data: IMG, name: "a.pdf" }, { "x-provider-key": "k" }));
      assert.deepEqual(s.calls[0].body.messages[0].content[0], { type: "document", source: { type: "base64", media_type: "application/pdf", data: IMG } });
    } finally { s.restore(); }
    s = stub(() => sse([{ choices: [{ delta: { content: "texto" } }] }]));
    try {
      await events(await post(P + "/leer/openai", { model: "gpt-4o", kind: "image", mime: "image/png", data: IMG }, { "x-provider-key": "k" }));
      assert.deepEqual(s.calls[0].body.messages[1].content[1], { type: "image_url", image_url: { url: "data:image/png;base64," + IMG } });
      await events(await post(P + "/leer/openai", { model: "gpt-4o", kind: "pdf", data: IMG, name: "contrato.pdf" }, { "x-provider-key": "k" }));
      assert.deepEqual(s.calls[1].body.messages[1].content[1], { type: "file", file: { filename: "contrato.pdf", file_data: "data:application/pdf;base64," + IMG } });
      await events(await post(P + "/leer/mistral", { model: "m", kind: "image", mime: "image/webp", data: IMG }, { "x-provider-key": "k" }));
      assert.equal(s.calls[2].body.messages[1].content[1].image_url, "data:image/webp;base64," + IMG);
    } finally { s.restore(); }
    const no = async (path, body) => (await post(P + path, body, { "x-provider-key": "k" })).status;
    assert.equal(await no("/leer/deepseek", { model: "m", kind: "image", mime: "image/png", data: IMG }), 400, "DeepSeek no lee imágenes");
    assert.equal(await no("/leer/mistral", { model: "m", kind: "pdf", data: IMG }), 400, "Mistral no lee PDF por esta vía");
    assert.equal(await no("/leer/openai", { model: "m", kind: "image", mime: "image/svg+xml", data: IMG }), 400);
    assert.equal(await no("/leer/openai", { model: "m", kind: "image", mime: "image/png", data: "no es base64 <>" }), 400);
    assert.equal(await no("/leer/openai", { model: "m", kind: "image", mime: "image/png", data: "A".repeat(5600001) }), 413);
    assert.equal(await no("/leer/openai", { model: "", kind: "image", mime: "image/png", data: IMG }), 400);
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
