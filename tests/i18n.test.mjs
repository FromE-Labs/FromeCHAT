// Idiomas: cada texto marcado en las páginas y cada texto que escribe app.js tiene
// traducción al inglés y al francés, con las mismas etiquetas HTML y las mismas variables.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const root = new URL("../public/", import.meta.url);
const read = (p) => readFileSync(new URL(p, root), "utf8");

function loadDicts() {
  const dicts = {};
  const sandbox = { window: { FromeI18n: { register: (code, d) => { dicts[code] = d; } } } };
  for (const code of ["en", "fr"]) vm.runInNewContext(read(`assets/lang-${code}.js`), sandbox);
  return dicts;
}

const PAGES = ["index.html", "chat/index.html", "privacidad/index.html"];
const tagsOf = (s) => (s.match(/<\/?(\w+)/g) || []).map((t) => t.replace(/[</]/g, "")).sort();
const varsOf = (s) => Array.from(new Set(s.match(/\{(\w+)\}/g) || [])).sort();

function staticKeys() {
  const keys = new Map();
  for (const page of PAGES) {
    const html = read(page);
    for (const m of html.matchAll(/<(\w+)([^>]*?)data-i18n="([^"]+)"([^>]*)>([\s\S]*?)<\/\1>/g)) if (!keys.has(m[3])) keys.set(m[3], m[5].trim());
    for (const m of html.matchAll(/<\w+[^>]*?data-i18n-attr="([^"]+)"[^>]*>/g)) {
      for (const pair of m[1].split(";")) {
        const [attr, key] = pair.split(":").map((x) => x.trim());
        const v = m[0].match(new RegExp("\\s" + attr + '="([^"]*)"'));
        assert.ok(v, `${page}: el atributo ${attr} de ${key} no tiene valor en español`);
        if (!keys.has(key)) keys.set(key, v[1]);
      }
    }
  }
  return keys;
}

function dynamicKeys() {
  const js = read("assets/app.js");
  const keys = new Map();
  for (const m of js.matchAll(/(?:\bT|paintCourtesy)\("([a-z][\w.]*)",\s*"((?:[^"\\]|\\.)*)"/g)) keys.set(m[1], m[2]);
  for (const m of js.matchAll(/data-i18n="([\w.]+)">(.*?)<\//g)) keys.set(m[1], m[2]);
  return keys;
}

test("las tres páginas cargan el sistema de idiomas y ofrecen el selector", () => {
  for (const page of PAGES) {
    const html = read(page);
    for (const f of ["i18n.js", "lang-en.js", "lang-fr.js"]) assert.ok(html.includes(`/assets/${f}`), `${page} no carga ${f}`);
    assert.ok(html.indexOf("/assets/i18n.js") < html.indexOf("/assets/lang-en.js"), `${page}: i18n.js debe cargarse antes que los diccionarios`);
    for (const l of ["es", "en", "fr"]) assert.ok(html.includes(`data-lang="${l}"`), `${page} no ofrece ${l}`);
    assert.match(html, /<html lang="es">/, `${page}: el texto de origen es español`);
  }
});

test("todo texto marcado en las páginas está traducido, con las mismas etiquetas", () => {
  const dicts = loadDicts();
  const keys = staticKeys();
  assert.ok(keys.size > 120, "se esperaban más de 120 textos marcados");
  for (const [code, d] of Object.entries(dicts)) {
    for (const [key, es] of keys) {
      assert.equal(typeof d[key], "string", `${code}: falta ${key}`);
      assert.ok(d[key].trim(), `${code}: ${key} está vacío`);
      assert.deepEqual(tagsOf(d[key]), tagsOf(es), `${code}: ${key} no conserva las etiquetas HTML`);
    }
  }
});

test("todo texto que escribe app.js está traducido, con las mismas variables", () => {
  const dicts = loadDicts();
  const keys = dynamicKeys();
  assert.ok(keys.size > 30, "se esperaban más de 30 textos en app.js");
  for (const [code, d] of Object.entries(dicts)) {
    for (const [key, es] of keys) {
      assert.equal(typeof d[key], "string", `${code}: falta ${key}`);
      assert.deepEqual(varsOf(d[key]), varsOf(es), `${code}: ${key} no conserva las variables`);
    }
  }
});

test("los errores del servidor con código y sus frases fijas tienen traducción", () => {
  const dicts = loadDicts();
  const fn = new URL("../netlify/functions/", import.meta.url);
  const src = ["chat.mjs", "courtesy.mjs", "lib/courtesy.mjs", "lib/anthropic.mjs", "lib/engine.mjs", "lib/governance.mjs"].map((f) => readFileSync(new URL(f, fn), "utf8")).join("\n");
  // Códigos de error que llegan al usuario con un mensaje propio en español.
  const codes = new Set();
  for (const m of src.matchAll(/error:\s*"(\w+)",\s*message:\s*["`C]/g)) codes.add(m[1]);
  for (const m of src.matchAll(/reason:\s*"(\w+)"/g)) codes.add("courtesy_" + m[1]);
  codes.delete("upstream"); // mensaje del proveedor: se muestra tal cual
  assert.ok(codes.size >= 10, "se esperaban al menos diez códigos de error");
  for (const [code, d] of Object.entries(dicts)) {
    for (const c of codes) assert.equal(typeof d["err." + c], "string", `${code}: falta err.${c}`);
    // Cada frase fija traducida existe tal cual en el código del servidor o viene de las reglas privadas.
    const fromRules = new Set(["No puedo mostrar ese material: mis instrucciones de trabajo son confidenciales. Dime qué necesitas y te ayudo con ello."]);
    for (const es of Object.keys(d.phrases)) assert.ok(src.includes(es) || fromRules.has(es), `${code}: la frase «${es}» ya no existe en el servidor`);
    assert.ok(Array.isArray(d.fragments) && d.fragments.length > 5 && Array.isArray(d.prefixes));
  }
});

test("inglés y francés tienen exactamente las mismas claves", () => {
  const { en, fr } = loadDicts();
  assert.deepEqual(Object.keys(en).sort(), Object.keys(fr).sort());
  assert.deepEqual(Object.keys(en.phrases).sort(), Object.keys(fr.phrases).sort());
  assert.equal(en["url.frome"], "https://frome-one.com/en/");
  assert.equal(fr["url.frome"], "https://frome-one.com/fr/");
});

test("el motor de idiomas elige idioma, traduce y vuelve al español", () => {
  const store = new Map();
  const made = [];
  const el = (key, html) => ({ innerHTML: html, getAttribute: (n) => (n === "data-i18n" ? key : null) });
  const nodes = [el("a.send", "Enviar"), el("clave.sin.traducir", "Texto sin traducción")];
  const html = { lang: "es", classList: { add() {}, remove() {} } };
  const document = {
    documentElement: html, readyState: "complete",
    querySelectorAll: (sel) => (sel === "[data-i18n]" ? nodes : []),
    addEventListener() {},
  };
  const sandbox = {
    document, navigator: { languages: ["fr-FR", "en"] }, location: { search: "", href: "https://x/" },
    localStorage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) },
    URLSearchParams, URL, history: { replaceState() {} }, setTimeout: (f) => made.push(f), WeakMap,
  };
  sandbox.window = sandbox;
  vm.runInNewContext(read("assets/i18n.js"), sandbox);
  vm.runInNewContext(read("assets/lang-en.js"), sandbox);
  vm.runInNewContext(read("assets/lang-fr.js"), sandbox);
  const I = sandbox.FromeI18n;
  assert.equal(I.lang, "fr", "sin elección guardada manda el idioma del navegador");
  I.apply(document);
  assert.equal(nodes[0].innerHTML, "Envoyer");
  assert.equal(nodes[1].innerHTML, "Texto sin traducción", "lo que no tiene traducción se queda en español");
  assert.equal(I.t("d.calln", "{n} llamadas", { n: 3 }), "3 appels");
  assert.equal(I.t("clave.inexistente", "Hola {n}", { n: 2 }), "Hola 2");
  assert.equal(I.fragments("Core Self-Validator™ — validado · iteraciones: 1"), "Core Self-Validator™ — validé · itérations : 1");
  I.set("en");
  assert.equal(store.get("fromechat.lang"), "en");
  assert.equal(nodes[0].innerHTML, "Send");
  assert.equal(I.fragments("Pregunta decisiva · una llamada"), "Decisive question · one call");
  assert.equal(I.phrase("Se ha interrumpido la respuesta."), "The response was interrupted.");
  assert.equal(I.phrase("Respuesta retenida por From E™: no supera la validación final. nota"), "Answer withheld by From E™: it does not pass final validation. nota");
  I.set("es");
  assert.equal(nodes[0].innerHTML, "Enviar", "al volver al español se restaura el texto de origen");
  assert.equal(I.phrase("Se ha interrumpido la respuesta."), "Se ha interrumpido la respuesta.");
  I.set("de");
  assert.equal(I.lang, "es", "un idioma no admitido no cambia nada");
});
