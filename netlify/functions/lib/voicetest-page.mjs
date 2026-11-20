// Página de la prueba de voz a ciegas. Se sirve solo en vistas previas y con contraseña
// (ver voicetest.mjs). Todo ocurre en el navegador de quien la hace: pide las respuestas
// a la entrada de pruebas, las baraja y guarda el avance en ese navegador.
// El script no puede contener acentos graves ni la secuencia dólar-llave.

export const PAGE = String.raw`<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Prueba de voz — From E™</title>
<style>
  :root { --bg: #0d1014; --panel: #151a21; --line: #262d38; --text: #e7e9ec; --dim: #97a0ad; --accent: #35c2ae; --accent-ink: #06231f; --warn: #e0a34a; }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text); font: 16px/1.55 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  header { display: flex; justify-content: space-between; align-items: baseline; gap: 16px; padding: 16px 20px; border-bottom: 1px solid var(--line); }
  header b { font-size: 17px; } header b i { color: var(--accent); font-style: normal; }
  header span { color: var(--dim); font-size: 12px; letter-spacing: .14em; }
  main { max-width: 1180px; margin: 0 auto; padding: 24px 16px 64px; }
  h1 { font-size: 26px; line-height: 1.2; margin: 8px 0 12px; }
  p.lead { color: var(--dim); max-width: 68ch; margin: 0 0 12px; }
  .btn { font: inherit; font-weight: 600; padding: 10px 16px; border-radius: 6px; border: 1px solid var(--line); background: var(--panel); color: var(--text); cursor: pointer; }
  .btn.main { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); }
  .btn:disabled { opacity: .45; cursor: default; }
  .row { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin: 18px 0; }
  .bar { height: 6px; background: var(--line); border-radius: 3px; overflow: hidden; margin: 14px 0 6px; max-width: 520px; }
  .bar i { display: block; height: 100%; width: 0; background: var(--accent); transition: width .3s; }
  .note { color: var(--dim); font-size: 14px; }
  .err { color: var(--warn); }
  .ask { border-left: 3px solid var(--accent); background: var(--panel); padding: 12px 16px; margin: 14px 0 18px; border-radius: 0 6px 6px 0; }
  .ask .who { color: var(--dim); font-size: 12px; letter-spacing: .1em; text-transform: uppercase; }
  .ask p { margin: 2px 0 10px; } .ask p:last-child { margin-bottom: 0; }
  .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  @media (max-width: 760px) { .pair { grid-template-columns: 1fr; } }
  .card { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; display: flex; flex-direction: column; min-width: 0; }
  .card > .tag { padding: 10px 16px; border-bottom: 1px solid var(--line); color: var(--dim); font-size: 13px; letter-spacing: .14em; }
  .card > .body { padding: 6px 16px 10px; overflow-wrap: anywhere; flex: 1; }
  .card > .foot { padding: 12px 16px 16px; display: flex; flex-wrap: wrap; gap: 10px; }
  .body h3 { font-size: 16px; margin: 14px 0 6px; } .body p { margin: 10px 0; } .body ul, .body ol { margin: 8px 0; padding-left: 22px; }
  .body blockquote { margin: 10px 0; padding-left: 12px; border-left: 2px solid var(--line); color: var(--dim); }
  .body hr { border: 0; border-top: 1px solid var(--line); margin: 14px 0; }
  .more { color: var(--dim); font-size: 14px; background: none; border: 0; padding: 0; cursor: pointer; text-decoration: underline; font: inherit; }
  table { border-collapse: collapse; margin: 16px 0; width: 100%; max-width: 640px; }
  th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--line); font-size: 15px; }
  th { color: var(--dim); font-weight: 500; font-size: 13px; }
  .big { font-size: 44px; font-weight: 700; line-height: 1.1; margin: 8px 0; font-variant-numeric: tabular-nums; }
  .ok { color: var(--accent); } .ko { color: var(--warn); }
</style>
</head>
<body>
<header><b>Prueba de voz · From <i>E™</i></b><span>PRIVADA</span></header>
<main id="app"></main>
<script>
(function () {
  var CFG = __CONFIG__;
  var LS = "frome.prueba-voz.v1";
  var app = document.getElementById("app");
  var S = load();
  var busy = false;

  function load() {
    try { var s = JSON.parse(localStorage.getItem(LS) || "null"); if (s && s.v === 1 && s.run === CFG.run) return s; } catch (e) {}
    return { v: 1, run: CFG.run, texts: {}, failed: {}, order: {}, picks: {}, at: 0, done: false };
  }
  function save() { try { localStorage.setItem(LS, JSON.stringify(S)); } catch (e) {} }
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; }
  function clear() { while (app.firstChild) app.removeChild(app.firstChild); }
  function esc(s) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

  // Markdown mínimo: títulos, negrita, cursiva, listas, citas y párrafos.
  function inline(s) {
    return esc(s).replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>").replace(/(^|[\s(«"'])\*([^*\n]+)\*(?=[\s.,;:!?)»"']|$)/g, "$1<i>$2</i>");
  }
  function md(src) {
    var out = [], list = null, quote = [], para = [];
    function flush() {
      if (para.length) { out.push("<p>" + para.map(inline).join("<br>") + "</p>"); para = []; }
      if (list) { out.push("<" + list.t + ">" + list.items.map(function (x) { return "<li>" + inline(x) + "</li>"; }).join("") + "</" + list.t + ">"); list = null; }
      if (quote.length) { out.push("<blockquote>" + quote.map(inline).join("<br>") + "</blockquote>"); quote = []; }
    }
    src.split("\n").forEach(function (raw) {
      var line = raw.replace(/\s+$/, ""), m;
      if (!line.trim()) { flush(); return; }
      if ((m = line.match(/^#{1,6}\s+(.*)$/))) { flush(); out.push("<h3>" + inline(m[1]) + "</h3>"); return; }
      if (/^(-{3,}|\*{3,})$/.test(line.trim())) { flush(); out.push("<hr>"); return; }
      if ((m = line.match(/^\s*[-*•]\s+(.*)$/))) { if (!list || list.t !== "ul") { flush(); list = { t: "ul", items: [] }; } list.items.push(m[1]); return; }
      if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) { if (!list || list.t !== "ol") { flush(); list = { t: "ol", items: [] }; } list.items.push(m[1]); return; }
      if ((m = line.match(/^>\s?(.*)$/))) { if (!quote.length) flush(); quote.push(m[1]); return; }
      if (list || quote.length) flush();
      para.push(line);
    });
    flush();
    return out.join("");
  }
  // Principio de una respuesta, cortado en un final de párrafo.
  function head(text) {
    if (text.length <= CFG.excerpt * 1.25) return { text: text, cut: false };
    var cut = text.lastIndexOf("\n\n", CFG.excerpt);
    if (cut < CFG.excerpt * 0.5) cut = text.indexOf("\n\n", CFG.excerpt);
    if (cut < 0) return { text: text, cut: false };
    return { text: text.slice(0, cut), cut: true };
  }

  function ready() { return CFG.cases.filter(function (c) { var t = S.texts[c.id]; return t && t.con && t.sin; }); }
  function pending() {
    var jobs = [];
    CFG.cases.forEach(function (c) {
      ["con", "sin"].forEach(function (k) { if (!(S.texts[c.id] && S.texts[c.id][k]) && !S.failed[c.id + "." + k]) jobs.push({ c: c, k: k }); });
    });
    return jobs;
  }
  // Mínimo de aciertos que el azar alcanza menos de una vez de cada dieciséis.
  function threshold(n) {
    function comb(a, b) { var r = 1; for (var i = 1; i <= b; i++) r = r * (a - b + i) / i; return r; }
    for (var k = 0; k <= n; k++) { var p = 0; for (var j = k; j <= n; j++) p += comb(n, j) / Math.pow(2, n); if (p <= 0.06) return { k: k, p: p }; }
    return { k: n + 1, p: 0 };
  }

  function fetchOne(job) {
    var mods = job.k === "con" ? CFG.withVoice : CFG.noVoice;
    var base = "/api/selftest/" + CFG.token + "/" + CFG.run + "-" + job.c.id + "/" + mods + "/caso." + job.c.id + "/" + CFG.model + "/gov/";
    var n = 0;
    function attempt() {
      n += 1;
      return fetch(base + n, { cache: "no-store" }).then(function (r) {
        return r.text().then(function (t) {
          if (r.status === 429) throw new Error("tope");
          if (r.status !== 200) throw new Error("estado " + r.status);
          if (t.indexOf("=== FIN") < 0) {
            if (n >= 40) throw new Error("sin terminar");
            return new Promise(function (res) { setTimeout(res, 3000); }).then(attempt);
          }
          var i = t.indexOf("--- respuesta\n");
          if (i < 0) throw new Error(/RETENIDA/.test(t) ? "retenida por el filtro" : "sin respuesta");
          return t.slice(i + 14, t.lastIndexOf("=== FIN")).trim();
        });
      });
    }
    return attempt();
  }

  function generate() {
    if (busy) return;
    busy = true;
    var jobs = pending(), total = CFG.cases.length * 2, stop = null;
    viewProgress(total, "");
    function next() {
      if (stop || !jobs.length) return Promise.resolve();
      var job = jobs.shift();
      return fetchOne(job).then(function (text) {
        if (!S.texts[job.c.id]) S.texts[job.c.id] = {};
        S.texts[job.c.id][job.k] = text;
      }, function (e) {
        if (e.message === "tope") stop = "Se ha alcanzado el tope diario de pruebas. Lo generado queda guardado; el resto, mañana.";
        else S.failed[job.c.id + "." + job.k] = e.message;
      }).then(function () { save(); viewProgress(total, stop || ""); return next(); });
    }
    Promise.all([next(), next(), next()]).then(function () { busy = false; S.at = 0; save(); if (stop && ready().length < 4) viewIntro(stop); else viewPair(); });
  }

  function viewIntro(msg) {
    clear();
    app.appendChild(el("h1", "", "¿Reconoces tu voz?"));
    app.appendChild(el("p", "lead", "Diez encargos. De cada uno verás dos respuestas del mismo modelo con tu arquitectura: una lleva tu voz y la otra no. No hay etiquetas y el orden es al azar. Marcas cuál es la tuya."));
    app.appendChild(el("p", "lead", "Pasa con ocho de diez o más: acertar ocho por azar ocurre unas cinco veces de cada cien."));
    var have = ready().length, miss = pending().length;
    var row = el("div", "row");
    if (miss) {
      var b = el("button", "btn main", have ? "Generar lo que falta" : "Generar los diez pares");
      b.addEventListener("click", generate);
      row.appendChild(b);
    }
    if (have >= 4) { var go = el("button", miss ? "btn" : "btn main", "Empezar con " + have + " pares"); go.addEventListener("click", function () { viewPair(); }); row.appendChild(go); }
    app.appendChild(row);
    if (miss) app.appendChild(el("p", "note", "Generar son " + miss + " respuestas con la clave de pruebas: " + CFG.cost + " Tarda unos dos minutos y queda guardado en este navegador."));
    if (msg) app.appendChild(el("p", "note err", msg));
  }

  function viewProgress(total, msg) {
    clear();
    var done = 0; CFG.cases.forEach(function (c) { var t = S.texts[c.id] || {}; if (t.con) done++; if (t.sin) done++; });
    var bad = Object.keys(S.failed).length;
    app.appendChild(el("h1", "", "Generando las respuestas"));
    var bar = el("div", "bar"), fill = el("i"); fill.style.width = Math.round(100 * (done + bad) / total) + "%"; bar.appendChild(fill); app.appendChild(bar);
    app.appendChild(el("p", "note", done + " de " + total + (bad ? " · " + bad + " sin respuesta" : "")));
    if (msg) app.appendChild(el("p", "note err", msg));
  }

  function orderOf(id) {
    if (!S.order[id]) { var r = new Uint8Array(1); crypto.getRandomValues(r); S.order[id] = r[0] & 1 ? "AB" : "BA"; save(); }
    return S.order[id]; // "AB": la A es la que lleva la voz
  }

  function viewPair() {
    var cases = ready();
    if (!cases.length) { viewIntro(""); return; }
    if (S.at >= cases.length) { S.done = true; save(); viewResult(); return; }
    var c = cases[S.at], ord = orderOf(c.id), t = S.texts[c.id];
    clear();
    app.appendChild(el("p", "note", "Par " + (S.at + 1) + " de " + cases.length));
    var ask = el("div", "ask");
    c.turns.forEach(function (m) { ask.appendChild(el("div", "who", m.role === "user" ? "Usuario" : "Respuesta anterior")); ask.appendChild(el("p", "", m.content)); });
    app.appendChild(ask);
    var pair = el("div", "pair");
    ["A", "B"].forEach(function (L) {
      var text = (L === "A") === (ord === "AB") ? t.con : t.sin;
      var card = el("div", "card"), h = head(text), open = false;
      card.appendChild(el("div", "tag", "RESPUESTA " + L));
      var body = el("div", "body"); body.innerHTML = md(h.text); card.appendChild(body);
      var foot = el("div", "foot");
      var pick = el("button", "btn" + (S.picks[c.id] === L ? " main" : ""), "Esta es mi voz");
      pick.addEventListener("click", function () { S.picks[c.id] = L; S.at += 1; save(); window.scrollTo(0, 0); viewPair(); });
      foot.appendChild(pick);
      if (h.cut) {
        var more = el("button", "more", "Ver entera");
        more.addEventListener("click", function () { open = !open; body.innerHTML = md(open ? text : h.text); more.textContent = open ? "Ver solo el principio" : "Ver entera"; });
        foot.appendChild(more);
      }
      card.appendChild(foot);
      pair.appendChild(card);
    });
    app.appendChild(pair);
    if (S.at > 0) { var row = el("div", "row"), back = el("button", "btn", "Volver al par anterior"); back.addEventListener("click", function () { S.at -= 1; save(); viewPair(); }); row.appendChild(back); app.appendChild(row); }
  }

  function viewResult() {
    var cases = ready().filter(function (c) { return S.picks[c.id]; });
    var hits = 0, rows = [];
    cases.forEach(function (c, i) { var ok = (S.picks[c.id] === "A") === (orderOf(c.id) === "AB"); if (ok) hits++; rows.push({ n: i + 1, id: c.id, ok: ok }); });
    var th = threshold(cases.length), pass = hits >= th.k;
    clear();
    app.appendChild(el("p", "note", "Resultado"));
    app.appendChild(el("div", "big " + (pass ? "ok" : "ko"), hits + " de " + cases.length));
    app.appendChild(el("p", "lead", pass ? "Has reconocido tu voz. El mínimo para descartar el azar era " + th.k + " de " + cases.length + "." : "No llega al mínimo de " + th.k + " de " + cases.length + ": con este resultado no se puede decir que la voz se reconozca."));
    var table = el("table"), hr = el("tr"); ["Par", "Caso", "Elegiste"].forEach(function (x) { hr.appendChild(el("th", "", x)); }); table.appendChild(hr);
    rows.forEach(function (r) { var tr = el("tr"); tr.appendChild(el("td", "", String(r.n))); tr.appendChild(el("td", "", r.id)); tr.appendChild(el("td", r.ok ? "ok" : "ko", r.ok ? "la que lleva tu voz" : "la que no la lleva")); table.appendChild(tr); });
    app.appendChild(table);
    var summary = "Prueba de voz a ciegas: " + hits + " de " + cases.length + " (mínimo " + th.k + "). " + rows.map(function (r) { return r.id + (r.ok ? " sí" : " no"); }).join(", ") + ".";
    var row = el("div", "row");
    var copy = el("button", "btn main", "Copiar el resultado");
    copy.addEventListener("click", function () { navigator.clipboard.writeText(summary).then(function () { copy.textContent = "Copiado"; }, function () { copy.textContent = "No se ha podido copiar"; }); });
    var again = el("button", "btn", "Repetir con otro orden");
    again.addEventListener("click", function () { S.order = {}; S.picks = {}; S.at = 0; S.done = false; save(); viewPair(); });
    var review = el("button", "btn", "Revisar los pares");
    review.addEventListener("click", function () { S.at = 0; S.done = false; save(); viewPair(); });
    row.appendChild(copy); row.appendChild(again); row.appendChild(review);
    app.appendChild(row);
    app.appendChild(el("p", "note", summary));
  }

  if (S.done) viewResult(); else if (ready().length && !pending().length && Object.keys(S.picks).length) viewPair(); else viewIntro("");
})();
</script>
</body>
</html>`;
