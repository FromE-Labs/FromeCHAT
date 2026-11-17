/* FromE Chat — idiomas. Sin dependencias.
   El español de España es el texto de origen y está en el propio HTML y en app.js.
   lang-en.js y lang-fr.js registran las traducciones; lo que no tenga traducción se
   muestra en español. El idioma se elige por ?lang=, por la elección guardada en este
   navegador o por el idioma del navegador, en ese orden. */
(function () {
  "use strict";
  var SUPPORTED = ["es", "en", "fr"];
  var LS = "fromechat.lang";
  var dicts = { es: {} };
  var originals = new WeakMap(); // texto español de cada elemento marcado
  var listeners = [];

  function norm(v) {
    var c = String(v || "").toLowerCase().slice(0, 2);
    if (SUPPORTED.indexOf(c) >= 0) return c;
    // Lenguas cooficiales de España: se sirve el español.
    if (c === "ca" || c === "gl" || c === "eu") return "es";
    return null;
  }

  function detect() {
    try {
      var q = norm(new URLSearchParams(location.search).get("lang"));
      if (q) { try { localStorage.setItem(LS, q); } catch (e) {} return q; }
    } catch (e) {}
    try { var s = norm(localStorage.getItem(LS)); if (s) return s; } catch (e) {}
    var list = (navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language]) || [];
    for (var i = 0; i < list.length; i++) { var c = norm(list[i]); if (c) return c; }
    return "en";
  }

  var lang = detect();
  document.documentElement.lang = lang;
  // Mientras se aplica una traducción, la página no se pinta: evita ver el español un instante.
  if (lang !== "es") {
    document.documentElement.classList.add("i18n-wait");
    setTimeout(function () { document.documentElement.classList.remove("i18n-wait"); }, 3000);
  }

  function fill(s, vars) {
    return String(s).replace(/\{(\w+)\}/g, function (m, k) { return vars && vars[k] !== undefined ? vars[k] : m; });
  }

  // t(clave, textoEnEspañol, variables): la traducción si existe; si no, el español.
  function t(key, es, vars) {
    var d = dicts[lang] || {};
    var v = lang !== "es" && typeof d[key] === "string" ? d[key] : es;
    return fill(v === undefined ? key : v, vars);
  }
  // Dato no textual del idioma actual (listas, tablas de frases). undefined en español.
  function raw(key) { return lang === "es" ? undefined : (dicts[lang] || {})[key]; }

  // Frase fija que llega del servidor en español: traducción exacta o por prefijo.
  function phrase(text) {
    if (lang === "es" || typeof text !== "string") return text;
    var d = dicts[lang] || {}, exact = d.phrases || {}, pre = d.prefixes || [];
    if (Object.prototype.hasOwnProperty.call(exact, text)) return exact[text];
    for (var i = 0; i < pre.length; i++) if (text.indexOf(pre[i][0]) === 0) return pre[i][1] + text.slice(pre[i][0].length);
    return text;
  }
  // Texto compuesto en el servidor con fragmentos conocidos (línea de señal, notas de etapa).
  function fragments(text) {
    if (lang === "es" || typeof text !== "string") return text;
    var list = (dicts[lang] || {}).fragments || [];
    for (var i = 0; i < list.length; i++) text = text.split(list[i][0]).join(list[i][1]);
    return text;
  }

  function apply(root) {
    root = root || document;
    var d = dicts[lang] || {};
    var nodes = root.querySelectorAll("[data-i18n]");
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i], o = originals.get(n);
      if (!o) { o = { html: n.innerHTML, attrs: {} }; originals.set(n, o); }
      var v = lang === "es" ? undefined : d[n.getAttribute("data-i18n")];
      n.innerHTML = typeof v === "string" ? v : o.html;
    }
    var withAttrs = root.querySelectorAll("[data-i18n-attr]");
    for (var j = 0; j < withAttrs.length; j++) {
      var a = withAttrs[j], oa = originals.get(a);
      if (!oa) { oa = { html: null, attrs: {} }; originals.set(a, oa); }
      var pairs = a.getAttribute("data-i18n-attr").split(";");
      for (var k = 0; k < pairs.length; k++) {
        var p = pairs[k].split(":"); if (p.length < 2) continue;
        var name = p[0].trim(), key = p[1].trim();
        if (!(name in oa.attrs)) oa.attrs[name] = a.getAttribute(name);
        var tv = lang === "es" ? undefined : d[key];
        a.setAttribute(name, typeof tv === "string" ? tv : oa.attrs[name]);
      }
    }
    var btns = document.querySelectorAll("[data-lang]");
    for (var b = 0; b < btns.length; b++) {
      var on = btns[b].getAttribute("data-lang") === lang;
      btns[b].classList.toggle("on", on);
      btns[b].setAttribute("aria-pressed", on ? "true" : "false");
    }
    document.documentElement.lang = lang;
    document.documentElement.classList.remove("i18n-wait");
  }

  function set(next) {
    next = norm(next); if (!next || next === lang) return;
    lang = next;
    try { localStorage.setItem(LS, lang); } catch (e) {}
    try {
      var u = new URL(location.href);
      if (u.searchParams.has("lang")) { u.searchParams.set("lang", lang); history.replaceState(null, "", u.toString()); }
    } catch (e) {}
    apply(document);
    for (var i = 0; i < listeners.length; i++) { try { listeners[i](lang); } catch (e) {} }
  }

  window.FromeI18n = {
    supported: SUPPORTED,
    get lang() { return lang; },
    register: function (code, dict) { dicts[code] = dict; },
    t: t, raw: raw, phrase: phrase, fragments: fragments, apply: apply, set: set,
    onChange: function (fn) { listeners.push(fn); },
  };

  document.addEventListener("click", function (e) {
    var b = e.target && e.target.closest ? e.target.closest("[data-lang]") : null;
    if (b) { e.preventDefault(); set(b.getAttribute("data-lang")); }
  });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { apply(document); });
  else apply(document);
})();
