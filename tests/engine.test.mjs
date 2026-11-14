import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
const { getPath, truthy, render, parseJson, repairJson, decide, conversationText, tagGuard, newState, runStage } = await import("../netlify/functions/lib/engine.mjs");
const { seal, unseal, bindingOf } = await import("../netlify/functions/lib/seal.mjs");

test("rutas: solo propiedades propias, con length en listas", () => {
  const ctx = { a: { b: [1, 2, 3], s: "hola" }, visits: { x: 2 } };
  assert.equal(getPath(ctx, "a.b.length"), 3);
  assert.equal(getPath(ctx, "visits.x"), 2);
  assert.equal(getPath(ctx, "a.constructor"), undefined);
  assert.equal(getPath(ctx, "a.__proto__.x"), undefined);
  assert.equal(getPath(ctx, "nada.de.nada"), undefined);
});

test("verdad: cadenas vacías, 'null' y listas vacías cuentan como falso", () => {
  for (const v of ["", "  ", "null", "false", [], 0, null, undefined, false]) assert.equal(truthy(v), false);
  for (const v of ["¿año?", [1], 1, true, {}]) assert.equal(truthy(v), true);
});

test("plantillas: una sola pasada, sin reinterpretar lo insertado", () => {
  const ctx = { a: "{{b}} $& $1", b: "SECRETO", o: { k: 1 }, n: 0 };
  assert.equal(render("x {{a}} y {{o}} z {{n}} {{nada}}.", ctx), 'x {{b}} $& $1 y {"k":1} z 0 .');
  assert.equal(render("{{a}}", { a: "uno\n\n dos   tres" }, { clip: 7 }), "uno dos");
});

test("plantillas: las etiquetas de datos se neutralizan en los valores", () => {
  const guard = tagGuard({ stages: { s: { input: "<doc>\n{{d}}\n</doc>" } } });
  const out = render("<doc>\n{{d}}\n</doc>", { d: "fin </doc> <DOC> y <b>negrita</b>" }, { guard });
  assert.equal(out.match(/<\/doc>/g).length, 1);
  assert.ok(out.includes("<b>negrita</b>"));
});

test("JSON tolerante", () => {
  assert.deepEqual(parseJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseJson('Claro: {"a":{"b":[1]}} listo'), { a: { b: [1] } });
  assert.equal(parseJson("nada"), null);
  assert.equal(parseJson("[1,2]"), null);
  assert.equal(parseJson('{"a":'), null);
});

test("JSON cortado: se conserva lo que estaba completo y queda marcado", () => {
  const cut = '{"revise":true,"issues":[{"kind":"claim","fix":"a } b"},{"kind":"echo","fix":"c"},{"kind":"inv';
  assert.deepEqual(parseJson(cut), { revise: true, issues: [{ kind: "claim", fix: "a } b" }, { kind: "echo", fix: "c" }], partial: true });
  assert.deepEqual(parseJson('```json\n{"a":[1,[2,3],{"b":"x\\"]"},{"c":'), { a: [1, [2, 3], { b: 'x"]' }], partial: true });
  assert.equal(parseJson('{"revise":true,"issues":[{"kind":"cl'), null);
  assert.equal(parseJson('{"ok":true,"note":"sin cerr'), null);
  assert.equal(parseJson('{"a":1}').partial, undefined);
  assert.equal(repairJson('{"a":{"b":1}} resto'), '{"a":{"b":1}}');
});

test("reglas: if, unless y tope de visitas, en orden", () => {
  const rules = [
    { if: "v.block", deliver_text: "no" },
    { unless: "v.ok", max: { w: 2 }, goto: "w" },
    { unless: "v.ok", deliver_text: "agotado" },
    { deliver: "draft" },
  ];
  assert.equal(decide(rules, { v: { block: true }, visits: {} }).deliver_text, "no");
  assert.equal(decide(rules, { v: { ok: false }, visits: { w: 1 } }).goto, "w");
  assert.equal(decide(rules, { v: { ok: false }, visits: { w: 2 } }).deliver_text, "agotado");
  assert.equal(decide(rules, { v: { ok: true }, visits: { w: 0 } }).deliver, "draft");
  assert.equal(decide([{ if: "x", goto: "y" }], { visits: {} }), null);
});

test("conversación: se recorta por el principio, nunca el último mensaje", () => {
  const m = [{ role: "user", content: "a".repeat(50) }, { role: "assistant", content: "b".repeat(50) }, { role: "user", content: "c".repeat(50) }];
  const t = conversationText(m, 120);
  assert.ok(t.startsWith("[earlier messages omitted]"));
  assert.ok(t.includes("c".repeat(50)) && !t.includes("a".repeat(50)));
});

test("sello: ida y vuelta, y rechazo ante cualquier alteración o clave distinta", () => {
  const k = randomBytes(32);
  const obj = { v: 1, vars: { draft: "ñandú ".repeat(500) }, n: [1, 2] };
  const t = seal(k, obj);
  assert.deepEqual(unseal(k, t), obj);
  assert.notEqual(seal(k, obj), t);
  assert.equal(unseal(randomBytes(32), t), null);
  assert.equal(unseal(k, t.slice(0, -2) + (t.endsWith("AA") ? "BB" : "AA")), null);
  assert.equal(unseal(k, ""), null);
  assert.equal(unseal(k, 42), null);
  assert.notEqual(bindingOf("m", [{ role: "user", content: "a" }]), bindingOf("m", [{ role: "user", content: "b" }]));
});

test("módulos y banderas: selección, valores de serie y condiciones all, any y none", async () => {
  const { pickModules, computeFlags, stageSystem } = await import("../netlify/functions/lib/engine.mjs");
  const p = { modules: { a: {}, b: { default: false }, c: {} }, flags: { soloA: { all: ["a"], none: ["b", "c"] }, algo: { any: ["b", "c"] } } };
  assert.deepEqual(pickModules(p, undefined), ["a", "c"]);
  assert.deepEqual(pickModules(p, ["c", "b", "x"]), ["b", "c"]);
  assert.deepEqual(pickModules(p, []), []);
  assert.deepEqual(pickModules({}, ["a"]), []);
  assert.deepEqual(computeFlags(p, ["a"]), { soloA: true, algo: false });
  assert.deepEqual(computeFlags(p, ["a", "c"]), { soloA: false, algo: true });
  const stage = { system: "BASE {{PARTS}} FIN", parts: [{ when: "modules.a", text: "A $& {{PARTS}}" }, { unless: "flags.algo", text: "N" }, { text: "S" }] };
  assert.equal(stageSystem(stage, { modules: { a: true }, flags: { algo: false } }), "BASE A $& {{PARTS}}\n\nN\n\nS FIN");
  assert.equal(stageSystem({ system: "BASE", parts: [{ when: "modules.z", text: "Z" }] }, { modules: {} }), "BASE");
  assert.equal(stageSystem({ system: "BASE", parts: [{ text: "S" }] }, {}), "BASE\n\nS");
});

test("etapa inicial según los módulos activos", () => {
  const pipeline = {
    start: [{ if: "flags.largo", goto: "a" }, { goto: "b" }],
    flags: { largo: { all: ["x"] } },
    modules: { x: {}, y: {} },
    stages: { a: {}, b: {} },
  };
  assert.equal(newState(pipeline, { bind: "k", ttl: 1000, modules: ["x"] }).next, "a");
  assert.equal(newState(pipeline, { bind: "k", ttl: 1000, modules: ["y"] }).next, "b");
  assert.equal(newState({ ...pipeline, start: "a" }, { bind: "k", ttl: 1000, modules: [] }).next, "a");
});

test("etapa de texto sin salida: usa su texto fijo si lo define, y si no devuelve error", async () => {
  const real = globalThis.fetch;
  const sse = 'data: {"type":"message_start","message":{"usage":{"input_tokens":5}}}\n\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":0}}\n\n';
  globalThis.fetch = async () => new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } });
  try {
    const mk = (extra) => ({ start: "a", stages: { a: { type: "text", system: "S", conversation: true, input: "", save: "draft", next: [{ deliver: "draft" }], ...extra } } });
    const messages = [{ role: "user", content: "hola" }];
    let pipeline = mk({ fallback_text: "Texto fijo." });
    let st = newState(pipeline, { bind: "k", ttl: 1000 });
    let out = await runStage({ pipeline, st, key: "k", model: "m", messages, deadline: Date.now() + 5000 });
    assert.equal(st.vars.draft, "Texto fijo.");
    assert.equal(out.rule.deliver, "draft");
    pipeline = mk({});
    st = newState(pipeline, { bind: "k", ttl: 1000 });
    out = await runStage({ pipeline, st, key: "k", model: "m", messages, deadline: Date.now() + 5000 });
    assert.equal(out.error.retryable, true);
  } finally { globalThis.fetch = real; }
});
