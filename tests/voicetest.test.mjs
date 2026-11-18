import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

process.env.GOVERNANCE_DIR = fileURLToPath(new URL("./fixtures/governance", import.meta.url));
process.env.VOICETEST_CASES = "uno,charla,rota,dos,tres,no existe,inventado";
process.env.VOICETEST_OFF_MODULE = "mv";
const TOKEN = "t".repeat(40);
const KEY = "sk-ant-" + "k".repeat(40);
const voz = (await import("../netlify/functions/voicetest.mjs")).default;
const PREVIEW = "https://deploy-preview-1--sitio.netlify.app/prueba-voz/";
const call = (url, ctx, init) => voz(new Request(url, init), ctx);

test("prueba de voz: no existe sin configurar, con contraseña mala ni en producción", async () => {
  delete process.env.SELFTEST_KEY; delete process.env.SELFTEST_TOKEN;
  assert.equal((await call(PREVIEW + TOKEN)).status, 404);
  process.env.SELFTEST_KEY = KEY; process.env.SELFTEST_TOKEN = TOKEN;
  assert.equal((await call(PREVIEW + "x".repeat(40))).status, 404);
  assert.equal((await call(PREVIEW)).status, 404);
  assert.equal((await call("https://chat.ejemplo.com/prueba-voz/" + TOKEN)).status, 404);
  assert.equal((await call(PREVIEW + TOKEN, { deploy: { context: "production" } })).status, 404);
  assert.equal((await call(PREVIEW + TOKEN, undefined, { method: "POST" })).status, 404);
});

test("prueba de voz: la página lleva los casos y los módulos, no las respuestas ni las reglas", async () => {
  process.env.SELFTEST_KEY = KEY; process.env.SELFTEST_TOKEN = TOKEN;
  const r = await call(PREVIEW + TOKEN);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get("cache-control"), "no-store");
  assert.match(r.headers.get("x-robots-tag"), /noindex/);
  const html = await r.text();
  const cfg = JSON.parse(html.match(/var CFG = (\{.*?\});\n/s)[1]);
  assert.deepEqual(cfg.cases.map((c) => c.id), ["uno", "charla", "dos", "tres"], "solo los casos que existen y acaban en un turno del usuario");
  assert.deepEqual(cfg.cases[1].turns.map((m) => m.role), ["user", "assistant", "user"]);
  assert.equal(cfg.withVoice, "todos");
  assert.equal(cfg.noVoice, "m1.m2.mv", "los módulos por defecto más el que quita la voz");
  assert.ok(!html.includes("Blue lantern") && !html.includes("Voz de prueba") && !html.includes(KEY), "ni reglas, ni voz, ni clave");
  new vm.Script(html.match(/<script>([\s\S]*)<\/script>/)[1]);
});

test("prueba de voz: sin casos suficientes o sin módulo de voz no hay prueba", async () => {
  process.env.SELFTEST_KEY = KEY; process.env.SELFTEST_TOKEN = TOKEN;
  const again = async (env) => {
    const before = { ...process.env };
    Object.assign(process.env, env);
    const mod = await import("../netlify/functions/voicetest.mjs?" + JSON.stringify(env));
    const r = await mod.default(new Request(PREVIEW + TOKEN));
    for (const k of Object.keys(env)) process.env[k] = before[k];
    return r.status;
  };
  assert.equal(await again({ VOICETEST_CASES: "uno,charla,rota" }), 404);
  assert.equal(await again({ VOICETEST_OFF_MODULE: "noexiste" }), 404);
});
