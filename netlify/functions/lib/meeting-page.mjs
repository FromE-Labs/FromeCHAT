// Página de la sala de reunión. La sirve netlify/functions/meeting.mjs solo con la contraseña
// correcta en la ruta. Todo va en un único documento; lo único que se carga de fuera, y solo
// al añadir un PDF, es la biblioteca que los lee (pdf.js).
// (El guion de la página no usa plantillas de texto, para poder vivir dentro de esta.)
export const PAGE = String.raw`<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<title>Sala de reunión — From E™</title>
<style>
:root{--bg:#06080b;--panel:#0a0e13;--panel2:#0d1218;--text:#f5f7fa;--muted:#a6b0ba;--line:#1b242d;--line2:#2b3947;--accent:#2ca9ff;--soft:rgba(44,169,255,.11);--ok:#3ddc97;--warn:#ffb454;--bad:#ff6b6b}
*{box-sizing:border-box}
html,body{height:100%}
body{margin:0;background:var(--bg);color:var(--text);font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;font-size:15px;line-height:1.55;-webkit-font-smoothing:antialiased}
button,input,select,textarea{font:inherit;color:inherit}
header{height:56px;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:0 18px;border-bottom:1px solid var(--line);background:rgba(6,8,11,.94)}
header b{font-size:17px;letter-spacing:-.02em}
header b span{color:var(--accent)}
header small{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);font-weight:700}
.grid{display:grid;grid-template-columns:340px 1fr;height:calc(100% - 56px)}
aside{border-right:1px solid var(--line);overflow:auto;padding:16px;background:var(--panel)}
h4{margin:0 0 10px;font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:var(--accent);font-weight:800}
.box{margin-bottom:20px}
.p{border:1px solid var(--line);background:var(--panel2);padding:10px 12px;margin-bottom:8px}
.p.off{opacity:.5}
.p-top{display:flex;align-items:center;gap:8px;margin-bottom:8px}
.p-top b{font-size:14.5px}
.p-top a{margin-left:auto;font-size:11.5px;color:var(--muted);text-decoration:underline;text-underline-offset:3px}
.dot{width:8px;height:8px;border-radius:50%;background:var(--line2);flex:none}
.dot.ok{background:var(--ok)}.dot.bad{background:var(--bad)}
.p input[type=password],.p select,textarea,.say textarea{width:100%;background:#070a0e;border:1px solid var(--line2);padding:8px 10px;outline:none}
.p input[type=password]:focus,.p select:focus,textarea:focus{border-color:var(--accent)}
.p select{margin-top:6px}
.p .st{font-size:11.5px;color:var(--muted);margin-top:5px;min-height:1em}
.p .st.bad{color:var(--bad)}
details{border:1px solid var(--line);background:var(--panel2);margin-bottom:8px}
summary{cursor:pointer;padding:9px 12px;font-weight:650;font-size:13.5px}
details>div{padding:0 12px 12px}
textarea{min-height:120px;resize:vertical;font-size:13.5px;line-height:1.5}
.hint{font-size:11.5px;color:var(--muted);margin:6px 0 0}
.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.btn{border:1px solid var(--line2);background:transparent;padding:8px 12px;cursor:pointer;font-weight:700;font-size:13px;white-space:nowrap}
.btn:hover{border-color:#fff}
.btn.pri{background:var(--accent);border-color:var(--accent);color:#031421}
.btn.stop{border-color:var(--bad);color:var(--bad)}
.btn:disabled{opacity:.4;cursor:not-allowed}
label.chk{display:flex;gap:8px;align-items:center;font-size:12.5px;color:var(--muted);margin-top:8px}
.room{display:flex;flex-direction:column;min-width:0;min-height:0}
#log{flex:1;overflow:auto;padding:18px 22px 8px}
.empty{max-width:640px;margin:8vh auto 0;color:var(--muted);text-align:center}
.empty b{display:block;color:#fff;font-size:22px;letter-spacing:-.03em;margin-bottom:8px}
.m{max-width:860px;margin:0 0 16px}
.m .who{display:flex;align-items:baseline;gap:10px;font-size:11px;letter-spacing:.14em;text-transform:uppercase;font-weight:800;color:var(--muted);margin-bottom:4px}
.m .who i{font-style:normal;font-weight:600;letter-spacing:.02em;text-transform:none;color:#71808e}
.m .who button{margin-left:auto;border:0;background:none;color:#71808e;cursor:pointer;font-size:14px;padding:0 4px}
.m .body{border:1px solid var(--line);background:var(--panel);padding:12px 16px;white-space:pre-wrap;word-wrap:break-word}
.m.mod{margin-left:auto}
.m.mod .who{color:var(--accent);justify-content:flex-end}
.m.mod .who button{margin-left:0}
.m.mod .body{background:var(--soft);border-color:rgba(44,169,255,.35)}
.m.openai .body{border-left:3px solid #74d3ae}
.m.mistral .body{border-left:3px solid #ff9f43}
.m.deepseek .body{border-left:3px solid #7c8cff}
.m.anthropic .body{border-left:3px solid #e58f6b}
.m .body.wait{color:var(--muted)}
.m .body.err{border-color:#7a2d2d;color:#ffb3b3}
.say{border-top:1px solid var(--line);background:var(--panel);padding:12px 22px 16px}
.say textarea{min-height:64px;max-height:240px;font-size:15px}
.say .row{margin-top:10px}
.btn.live{border-color:var(--bad);color:#fff;background:rgba(255,107,107,.16)}
.btn.hold{border-color:var(--warn);color:var(--warn)}
.say .voice{display:flex;gap:14px;flex-wrap:wrap;align-items:center;margin-top:10px;font-size:12.5px;color:var(--muted)}
.say .voice label{display:flex;gap:7px;align-items:center;cursor:pointer}
.f{display:flex;gap:8px;align-items:center;border:1px solid var(--line);background:#070a0e;padding:6px 9px;margin-top:6px;font-size:12.5px}
.f b{font-weight:650;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0}
.f span{color:var(--muted);white-space:nowrap}
.f button{border:0;background:none;color:var(--muted);cursor:pointer;padding:0 2px;font-size:12px;text-decoration:underline;text-underline-offset:3px}
.f.work b{color:var(--warn)}
.f.bad span{color:var(--bad);white-space:normal}
body.drop #log{outline:2px dashed var(--accent);outline-offset:-10px}
.say .sep{width:1px;align-self:stretch;background:var(--line2);margin:0 2px}
#conf{display:none}
@media(max-width:900px){
  .grid{grid-template-columns:1fr;height:auto}
  aside{border-right:0;border-bottom:1px solid var(--line);display:none}
  aside.open{display:block}
  #conf{display:inline-block;padding:6px 10px}
  header{padding:0 14px}
  header b{font-size:15px;white-space:nowrap}
  header small{display:none}
  .room{height:calc(100vh - 56px)}
  #log{padding:14px}
  .say{padding:10px 14px 14px}
}
</style>
</head>
<body>
<header><b>Sala de reunión · From<span> E™</span></b><span class="row"><button class="btn" id="conf">Configuración</button><small>Privada</small></span></header>
<div class="grid">
<aside id="aside">
  <div class="box"><h4>Participantes</h4><div id="people"></div>
    <label class="chk"><input type="checkbox" id="remember"> Recordar las claves en este navegador</label>
    <label class="chk"><input type="checkbox" id="rotate"> Rotar quién empieza cada ronda</label>
    <p class="hint">Las claves las pegas tú. Viajan solo con cada petición, hacia su proveedor, y el servidor no las guarda.</p>
  </div>
  <div class="box"><h4>La reunión</h4>
    <details open><summary>Contexto permanente</summary><div>
      <textarea id="ctx" style="min-height:150px" placeholder="Lo que todos saben de ti y de tu trabajo. Lo leen los cuatro antes de cada intervención, en todas las reuniones."></textarea>
      <p class="hint" id="ctx-note">Se guarda en tu servidor y vale para todas las reuniones y dispositivos.</p>
    </div></details>
    <details open><summary>Orden del día y material</summary><div>
      <textarea id="brief" placeholder="De qué va la reunión y qué material tienen todos delante. Lo leen los cuatro antes de cada intervención."></textarea>
      <div class="row" style="margin-top:8px"><label class="btn" style="cursor:pointer">Añadir archivos<input type="file" id="file" accept=".md,.txt,.csv,.json,.pdf,image/*,text/*,application/pdf" multiple hidden></label></div>
      <div id="files"></div>
      <p class="hint" id="files-note">PDF, imágenes y texto. También puedes arrastrarlos a la sala o pegar una captura con Ctrl+V.</p>
    </div></details>
    <details><summary>Reglas de la sala</summary><div>
      <textarea id="rules" style="min-height:220px"></textarea>
      <div class="row" style="margin-top:8px"><button class="btn" id="rules-reset">Restaurar las reglas iniciales</button></div>
    </div></details>
  </div>
  <div class="box"><h4>Acta</h4>
    <div class="row"><button class="btn" id="export">Descargar acta</button><button class="btn" id="copy">Copiar acta</button><button class="btn" id="new">Nueva reunión</button></div>
    <div class="row" style="margin-top:8px"><button class="btn" id="keep">Guardar las conclusiones en el contexto</button></div>
    <p class="hint" id="acta-note">La transcripción se guarda solo en este navegador.</p>
  </div>
</aside>
<section class="room">
  <div id="log"></div>
  <div class="say">
    <textarea id="say" placeholder="Hablas tú. Escribe y da la palabra: a uno, o a todos en una ronda."></textarea>
    <div class="row">
      <button class="btn pri" id="round">Enviar y ronda completa</button>
      <button class="btn" id="only">Solo enviar</button>
      <span class="sep"></span>
      <span class="row" id="floor"></span>
      <button class="btn stop" id="stop" hidden>Parar</button>
    </div>
    <div class="voice">
      <button class="btn" id="mic">Micrófono</button>
      <label><input type="checkbox" id="voice"> Los participantes hablan en voz alta</label>
      <span id="voice-note">Con el micrófono abierto, termina con «adelante, Mistral» o «ronda completa» para dar la palabra.</span>
    </div>
  </div>
</section>
</div>
<script>
(function () {
  "use strict";
  var BASE = location.pathname.replace(/\/+$/, "");
  var ORDER = ["openai", "mistral", "deepseek", "anthropic"];
  var NAMES = { openai: "ChatGPT", mistral: "Mistral", deepseek: "DeepSeek", anthropic: "Claude" };
  var KEYS = { openai: "https://platform.openai.com/api-keys", mistral: "https://console.mistral.ai/api-keys", deepseek: "https://platform.deepseek.com/api_keys", anthropic: "https://console.anthropic.com/settings/keys" };
  var MOD = "Esmeralda";
  var LS = "frome.reunion.v1";
  var RULES = [
    "Esto es una reunión de trabajo por escrito. Modera Esmeralda García y solo ella da la palabra. Participan varios modelos de distintos proveedores.",
    "",
    "- Intervienes solo cuando te toca y hablas solo por ti. No escribas intervenciones de otros participantes ni de la moderadora.",
    "- Lee toda la transcripción antes de hablar. No repitas lo ya dicho: si coincides con alguien, dilo en una línea y aporta lo que falta.",
    "- Si alguien se equivoca en algo de fondo, incluida la moderadora, dilo y explica por qué. No des la razón por cortesía ni suavices una objeción. No corrijas erratas ni formas de hablar.",
    "- Separa lo que es un hecho comprobable con el material de la sala de lo que es interpretación tuya.",
    "- No afirmes haber visto nada que no esté en la sala. Si te falta un dato para opinar, pídelo.",
    "- Sé breve: unas 200 palabras, salvo que la moderadora pida más. Sin introducciones ni despedidas.",
    "- A un saludo o a una prueba de sonido se responde en una línea.",
    "- Responde en español."
  ].join("\n");
  // Reglas iniciales de versiones anteriores: si la sala las tiene sin tocar, se actualizan solas.
  var OLD_RULES = ["- Si alguien se equivoca, incluida la moderadora, dilo y explica por qué. No des la razón por cortesía ni suavices una objeción de fondo."];
  function outdated(text) { return OLD_RULES.some(function (line) { return text.indexOf(line) >= 0; }) && text.split("\n").length === 9; }
  var $ = function (s) { return document.querySelector(s); };
  var el = function (tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };

  /* ---------- estado ---------- */
  function fresh() {
    var people = {}; ORDER.forEach(function (p) { people[p] = { on: true, model: "", key: "" }; });
    return { people: people, remember: true, rotate: true, voice: false, rules: RULES, brief: "", files: [], log: [], next: 0 };
  }
  function load() {
    var s = fresh();
    try {
      var raw = JSON.parse(localStorage.getItem(LS) || "null");
      if (raw && raw.people) {
        ORDER.forEach(function (p) { if (raw.people[p]) { s.people[p].on = raw.people[p].on !== false; s.people[p].model = raw.people[p].model || ""; s.people[p].key = raw.people[p].key || ""; } });
        s.remember = raw.remember !== false; s.rotate = raw.rotate !== false; s.voice = raw.voice === true;
        s.rules = typeof raw.rules === "string" && raw.rules.trim() && !outdated(raw.rules) ? raw.rules : RULES;
        s.brief = raw.brief || ""; s.next = raw.next || 0;
        s.files = Array.isArray(raw.files) ? raw.files.filter(function (f) { return f && f.name && typeof f.text === "string"; }) : [];
        s.log = Array.isArray(raw.log) ? raw.log.filter(function (e) { return e && e.text; }) : [];
      }
    } catch (e) {}
    return s;
  }
  var S = load();
  function save() {
    try {
      var copy = JSON.parse(JSON.stringify(S));
      if (!S.remember) ORDER.forEach(function (p) { copy.people[p].key = ""; });
      copy.log = copy.log.filter(function (e) { return e.text && !e.pending; });
      localStorage.setItem(LS, JSON.stringify(copy));
      $("#acta-note").textContent = "La transcripción se guarda solo en este navegador.";
    } catch (e) { $("#acta-note").textContent = "No se ha podido guardar en este navegador: descarga el acta antes de cerrar."; }
  }
  var CTX = { text: "", timer: null };
  var serverKey = { anthropic: false };
  var busy = false, stopFlag = false, ctl = null;
  var ui = {};

  /* ---------- participantes ---------- */
  function buildPeople() {
    var box = $("#people");
    ORDER.forEach(function (p) {
      var card = el("div", "p"), top = el("div", "p-top"), dot = el("span", "dot");
      var chk = document.createElement("input"); chk.type = "checkbox"; chk.checked = S.people[p].on;
      var link = el("a", "", "obtener clave"); link.href = KEYS[p]; link.target = "_blank"; link.rel = "noopener noreferrer";
      top.appendChild(chk); top.appendChild(el("b", "", NAMES[p])); top.appendChild(dot); top.appendChild(link);
      var key = document.createElement("input"); key.type = "password"; key.autocomplete = "off"; key.spellcheck = false; key.placeholder = "Clave de API de " + NAMES[p]; key.value = S.people[p].key;
      var sel = document.createElement("select"); var st = el("div", "st");
      card.appendChild(top); card.appendChild(key); card.appendChild(sel); card.appendChild(st); box.appendChild(card);
      ui[p] = { card: card, dot: dot, key: key, sel: sel, st: st, chk: chk };
      setOptions(p, S.people[p].model ? [{ id: S.people[p].model, label: S.people[p].model }] : []);
      chk.addEventListener("change", function () { S.people[p].on = chk.checked; save(); paint(); });
      key.addEventListener("change", function () { S.people[p].key = key.value.trim(); save(); loadModels(p); });
      sel.addEventListener("change", function () { S.people[p].model = sel.value; save(); paint(); });
    });
  }
  function setOptions(p, list) {
    var sel = ui[p].sel; sel.innerHTML = "";
    if (!list.length) { var o = el("option", "", "Modelo: pega la clave para ver la lista"); o.value = ""; sel.appendChild(o); return; }
    list.forEach(function (m) { var o = el("option", "", m.label && m.label !== m.id ? m.label + " · " + m.id : m.id); o.value = m.id; sel.appendChild(o); });
    sel.value = S.people[p].model;
  }
  function status(p, text, kind) { ui[p].st.textContent = text || ""; ui[p].st.className = "st" + (kind === "bad" ? " bad" : ""); ui[p].dot.className = "dot" + (kind ? " " + kind : ""); }
  function hasKey(p) { return Boolean(S.people[p].key) || Boolean(serverKey[p]); }
  function loadModels(p) {
    if (!hasKey(p)) { setOptions(p, []); status(p, "", ""); paint(); return; }
    status(p, "Comprobando la clave…", "");
    var headers = {}; if (S.people[p].key) headers["x-provider-key"] = S.people[p].key;
    fetch(BASE + "/modelos/" + p, { headers: headers }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); }).then(function (x) {
      if (!x.ok) { status(p, x.j.error || "Clave no válida.", "bad"); paint(); return; }
      var list = x.j.models || [];
      if (!list.some(function (m) { return m.id === S.people[p].model; })) S.people[p].model = x.j.suggested || (list[0] && list[0].id) || "";
      setOptions(p, list); save();
      status(p, (S.people[p].key ? "Clave válida" : "Con la clave del servidor") + " · " + list.length + " modelos", "ok"); paint();
    }).catch(function () { status(p, "No se ha podido comprobar la clave.", "bad"); paint(); });
  }
  function ready(p) { return S.people[p].on && hasKey(p) && Boolean(S.people[p].model); }
  function present() { return ORDER.filter(ready); }

  /* ---------- transcripción ---------- */
  function esc(t) { return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function fmt(t) { return esc(t).replace(/\*\*([^*\n]+?)\*\*/g, "<strong>$1</strong>").replace(/^#{1,6}\s+(.*)$/gm, "<strong>$1</strong>"); }
  function hhmm(ts) { var d = new Date(ts); return ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2); }
  function entryNode(e) {
    var m = el("div", "m " + (e.who === "mod" ? "mod" : e.who));
    var who = el("div", "who"); who.appendChild(el("span", "", e.name));
    var meta = el("i", "", metaOf(e)); who.appendChild(meta);
    var del = el("button", "", "×"); del.title = "Quitar de la transcripción"; who.appendChild(del);
    var body = el("div", "body" + (e.error ? " err" : ""));
    if (e.pending && !e.text) { body.className = "body wait"; body.textContent = e.name + " está preparando su intervención…"; } else body.innerHTML = fmt(e.text);
    m.appendChild(who); m.appendChild(body);
    del.addEventListener("click", function () { if (busy) return; var i = S.log.indexOf(e); if (i >= 0) { S.log.splice(i, 1); save(); renderLog(); } });
    e._body = body; e._meta = meta;
    return m;
  }
  function metaOf(e) {
    var bits = [hhmm(e.ts)];
    if (e.model) bits.push(e.model);
    if (e.usage && (e.usage.input || e.usage.output)) bits.push(e.usage.input + " in · " + e.usage.output + " out");
    if (e.cut) bits.push("cortado por tiempo");
    return bits.join(" · ");
  }
  function renderLog() {
    var log = $("#log"); log.innerHTML = "";
    if (!S.log.length) {
      var em = el("div", "empty"); em.appendChild(el("b", "", "La sala está vacía."));
      em.appendChild(document.createTextNode("Pon el orden del día a la izquierda, escribe tu primera intervención y da la palabra."));
      log.appendChild(em); return;
    }
    S.log.forEach(function (e) { log.appendChild(entryNode(e)); });
    log.scrollTop = log.scrollHeight;
  }
  function add(e) {
    var log = $("#log"); if (S.log.length === 0) log.innerHTML = "";
    S.log.push(e); log.appendChild(entryNode(e)); log.scrollTop = log.scrollHeight;
  }
  function transcript(upTo) {
    var out = [];
    for (var i = 0; i < S.log.length; i++) { var e = S.log[i]; if (e === upTo) break; if (!e.text || e.error) continue; out.push("[" + e.name + "]\n" + e.text.trim()); }
    var text = out.join("\n\n");
    if (text.length > 160000) text = "[…se omite el principio de la reunión por longitud…]\n\n" + text.slice(-160000);
    return text;
  }
  function systemFor(p) {
    var others = present().map(function (x) { return NAMES[x]; }).join(", ");
    return S.rules.trim() + (CTX.text.trim() ? "\n\nConoces el contexto permanente de la sala: es lo que ya sabes de la moderadora y de su trabajo. No pidas que te lo vuelva a explicar ni digas que no tienes información si está ahí." : "") + "\n\nTú eres " + NAMES[p] + ". En la transcripción tus intervenciones anteriores aparecen como [" + NAMES[p] + "] y las de la moderadora como [" + MOD + "]. Participantes en la sala: " + others + ".";
  }
  function promptFor(p, entry) {
    var out = "";
    if (CTX.text.trim()) out += "CONTEXTO PERMANENTE DE LA SALA, conocido por todos los participantes:\n\n" + CTX.text.trim() + "\n\n---\n\n";
    if (S.brief.trim()) out += "ORDEN DEL DÍA Y MATERIAL, aportado por la moderadora:\n\n" + S.brief.trim() + "\n\n---\n\n";
    if (S.files.length) out += "ARCHIVOS APORTADOS POR LA MODERADORA, transcritos para todos los participantes:\n\n" + S.files.map(function (f) { return "### " + f.name + "\n\n" + f.text.trim(); }).join("\n\n") + "\n\n---\n\n";
    var t = transcript(entry);
    out += "TRANSCRIPCIÓN DE LA REUNIÓN HASTA AHORA:\n\n" + (t || "(todavía no ha hablado nadie)") + "\n\n---\n\nTe toca intervenir a ti, " + NAMES[p] + ". Escribe solo tu intervención, sin poner tu nombre delante.";
    return out;
  }

  /* ---------- un turno ---------- */
  function speak(p) {
    return new Promise(function (resolve) {
      var who = S.people[p];
      var e = { who: p, name: NAMES[p], model: who.model, text: "", ts: Date.now(), pending: true };
      var prompt = promptFor(p, null);
      add(e);
      var headers = { "content-type": "application/json" }; if (who.key) headers["x-provider-key"] = who.key;
      ctl = new AbortController();
      var log = $("#log");
      var finish = function (ok, msg) {
        e.pending = false;
        if (!ok && !e.text) { e.error = true; e.text = msg || "No ha habido respuesta."; e._body.className = "body err"; e._body.textContent = e.text; }
        else if (!ok && msg) { e.text += "\n\n[" + msg + "]"; e._body.innerHTML = fmt(e.text); }
        e._meta.textContent = metaOf(e);
        save(); if (ok) sayAloud(e); resolve(ok);
      };
      fetch(BASE + "/turno/" + p, { method: "POST", headers: headers, signal: ctl.signal, body: JSON.stringify({ model: who.model, system: systemFor(p), prompt: prompt }) }).then(function (res) {
        if (!res.ok || !res.body) return res.json().then(function (j) { finish(false, j.error || "Error " + res.status); }, function () { finish(false, "Error " + res.status); });
        var reader = res.body.getReader(), dec = new TextDecoder(), buf = "", failed = "";
        var pump = function () {
          return reader.read().then(function (r) {
            if (r.done) { finish(!failed && Boolean(e.text), failed); return; }
            buf += dec.decode(r.value, { stream: true });
            var i;
            while ((i = buf.indexOf("\n\n")) >= 0) {
              var chunk = buf.slice(0, i); buf = buf.slice(i + 2);
              if (chunk.indexOf("data: ") !== 0) continue;
              var ev; try { ev = JSON.parse(chunk.slice(6)); } catch (x) { continue; }
              if (typeof ev.t === "string" && ev.t) { var stick = log.scrollHeight - log.scrollTop - log.clientHeight < 80; e.text += ev.t; e._body.className = "body"; e._body.innerHTML = fmt(e.text); if (stick) log.scrollTop = log.scrollHeight; }
              else if (ev.thinking && !e.text) e._body.textContent = e.name + " está razonando antes de escribir…";
              else if (ev.cut) e.cut = true;
              else if (ev.error) failed = ev.error;
              else if (ev.done) e.usage = ev.usage;
            }
            return pump();
          });
        };
        return pump();
      }).catch(function () { finish(Boolean(e.text) && stopFlag, stopFlag ? "interrumpido" : "Se ha cortado la conexión."); });
    });
  }
  function setBusy(v) { busy = v; if (v) micHold(); else micResume(); paint(); }
  function takeSay() {
    var box = $("#say"), text = box.value.trim();
    if (text) { add({ who: "mod", name: MOD, text: text, ts: Date.now() }); box.value = ""; save(); }
    return Boolean(text);
  }
  function run(list) {
    if (busy || !list.length) return;
    stopFlag = false; setBusy(true);
    var i = 0;
    var next = function () {
      if (stopFlag || i >= list.length) { setBusy(false); return; }
      speak(list[i++]).then(next);
    };
    next();
  }
  function round() {
    var list = present();
    if (!list.length) return;
    takeSay();
    if (S.rotate && list.length > 1) { var k = S.next % list.length; list = list.slice(k).concat(list.slice(0, k)); S.next += 1; }
    run(list);
  }

  /* ---------- voz: los participantes hablan y la moderadora dicta ---------- */
  var synth = window.speechSynthesis || null;
  var Rec = window.SpeechRecognition || window.webkitSpeechRecognition || null;
  var rec = null, listening = false, wantMic = false, speaking = 0;
  var PITCH = { openai: 1, mistral: 0.82, deepseek: 1.18, anthropic: 0.94 };
  var WHO = [["openai", /chat\s*g\s*p\s*t|chat\s*gepet/], ["mistral", /mistral/], ["deepseek", /deep\s*s[ei]+[ck]|dip\s*s[ei]+[ck]/], ["anthropic", /claude|cloud|claud|clod/]];
  function voiceFor(p) {
    if (!synth) return null;
    var list = synth.getVoices().filter(function (v) { return /^es([-_]|$)/i.test(v.lang); });
    if (!list.length) return null;
    list.sort(function (a, b) { return (/es[-_]ES/i.test(b.lang) ? 1 : 0) - (/es[-_]ES/i.test(a.lang) ? 1 : 0); });
    return list[ORDER.indexOf(p) % list.length];
  }
  function plain(t) { return t.replace(/\*\*|__/g, "").replace(/^#{1,6}\s+/gm, "").replace(/^\s*[-*•]\s+/gm, "").replace(/\[(.*?)\]\((.*?)\)/g, "$1").replace(/\s+/g, " ").trim(); }
  // Frases cortas: las voces del navegador se cortan con textos largos.
  function pieces(t) {
    var parts = t.match(/[^.!?…:;]+[.!?…:;]*\s*/g) || [t], out = [], cur = "";
    parts.forEach(function (x) { if ((cur + x).length > 180 && cur) { out.push(cur.trim()); cur = x; } else cur += x; });
    if (cur.trim()) out.push(cur.trim());
    return out;
  }
  function sayAloud(e) {
    if (!S.voice || !synth || e.error || !e.text) return;
    var v = voiceFor(e.who);
    micHold();
    [e.name + "."].concat(pieces(plain(e.text))).forEach(function (text) {
      var u = new SpeechSynthesisUtterance(text);
      u.lang = v ? v.lang : "es-ES"; if (v) u.voice = v; u.pitch = PITCH[e.who] || 1; u.rate = 1.06;
      speaking += 1;
      u.onend = u.onerror = function () { speaking = Math.max(0, speaking - 1); if (!speaking) micResume(); };
      synth.speak(u);
    });
  }
  function hush() { if (synth) synth.cancel(); speaking = 0; }
  function micPaint() {
    var b = $("#mic");
    if (!Rec) { b.disabled = true; b.textContent = "Micrófono no disponible"; b.title = "Este navegador no permite dictar. Funciona en Chrome."; return; }
    b.className = "btn" + (listening ? " live" : wantMic ? " hold" : "");
    b.textContent = listening ? "Escuchando · pulsa para cerrar" : wantMic ? "Micrófono en espera" : "Micrófono";
  }
  // Órdenes de voz al final de lo dictado: «adelante, Mistral» o «ronda completa».
  function command() {
    var box = $("#say"), t = box.value, m;
    if ((m = t.match(/[\s,.;:]*(ronda completa|adelante,?\s+(a\s+)?todos)[\s.!]*$/i))) { box.value = t.slice(0, m.index).trim(); round(); return true; }
    if ((m = t.match(/[\s,.;:]*adelante,?\s+([a-záéíóúñ ]{3,16})[\s.!]*$/i))) {
      var name = m[1].toLowerCase(), p = null;
      WHO.forEach(function (w) { if (!p && w[1].test(name)) p = w[0]; });
      if (p && ready(p)) { box.value = t.slice(0, m.index).trim(); takeSay(); run([p]); return true; }
    }
    return false;
  }
  function micStart() {
    if (!Rec || listening || busy || speaking) { micPaint(); return; }
    var box = $("#say"), base = box.value ? box.value.replace(/\s+$/, "") + " " : "", fin = "";
    rec = new Rec(); rec.lang = "es-ES"; rec.continuous = true; rec.interimResults = true;
    rec.onresult = function (ev) {
      var interim = "", gotFinal = false;
      for (var i = ev.resultIndex; i < ev.results.length; i++) { var r = ev.results[i]; if (r.isFinal) { fin += r[0].transcript; gotFinal = true; } else interim += r[0].transcript; }
      box.value = base + fin + interim;
      if (gotFinal && !interim) command();
    };
    rec.onerror = function (ev) {
      if (ev.error === "not-allowed" || ev.error === "service-not-allowed") { wantMic = false; $("#voice-note").textContent = "El navegador no tiene permiso para usar el micrófono: actívalo en el candado de la barra de direcciones."; }
    };
    rec.onend = function () { listening = false; micPaint(); if (wantMic && !busy && !speaking) setTimeout(micStart, 300); };
    try { rec.start(); listening = true; } catch (x) { listening = false; }
    micPaint();
  }
  function micHold() { if (rec && listening) { rec.onresult = null; try { rec.stop(); } catch (x) {} } }
  function micResume() { if (wantMic && !busy && !speaking) setTimeout(micStart, 350); else micPaint(); }

  /* ---------- archivos: PDF, imágenes y texto ---------- */
  // Todo archivo acaba convertido en texto, que es lo que leen los cuatro por igual. El texto de
  // un PDF se saca aquí mismo; las imágenes y los PDF escaneados los transcribe un participante
  // con vista (Claude o, si no está, ChatGPT).
  var PDFJS = "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/";
  var jobs = [];
  function filesPaint() {
    var box = $("#files"); box.innerHTML = "";
    S.files.forEach(function (f) {
      var row = el("div", "f"); row.appendChild(el("b", "", f.name)); row.appendChild(el("span", "", f.text.length.toLocaleString("es-ES") + " car."));
      var up = el("button", "", "al contexto"); up.title = "Añadirlo al contexto permanente, para todas las reuniones";
      var del = el("button", "", "quitar");
      up.addEventListener("click", function () { CTX.text = CTX.text.replace(/\s+$/, "") + (CTX.text.trim() ? "\n\n" : "") + "## Documento: " + f.name + "\n\n" + f.text.trim() + "\n"; $("#ctx").value = CTX.text; ctxSave(); up.textContent = "añadido"; up.disabled = true; });
      del.addEventListener("click", function () { var i = S.files.indexOf(f); if (i >= 0) { S.files.splice(i, 1); save(); filesPaint(); } });
      row.appendChild(up); row.appendChild(del); box.appendChild(row);
    });
    jobs.forEach(function (j) {
      var row = el("div", "f " + (j.bad ? "bad" : "work")); row.appendChild(el("b", "", j.name)); row.appendChild(el("span", "", j.note));
      if (j.bad) { var x = el("button", "", "quitar"); x.addEventListener("click", function () { jobs.splice(jobs.indexOf(j), 1); filesPaint(); }); row.appendChild(x); }
      box.appendChild(row);
    });
    var total = S.files.reduce(function (n, f) { return n + f.text.length; }, 0);
    var note = $("#files-note");
    if (total > 150000) { note.textContent = "Mucho material (" + total.toLocaleString("es-ES") + " caracteres): cada turno cuesta más y puede no caberle a algún modelo."; note.style.color = "var(--warn)"; }
    else { note.textContent = "PDF, imágenes y texto. También puedes arrastrarlos a la sala o pegar una captura con Ctrl+V."; note.style.color = ""; }
  }
  function reader(kind) {
    if (hasKey("anthropic") && S.people.anthropic.model) return "anthropic";
    if (hasKey("openai") && S.people.openai.model) return "openai";
    if (kind === "image" && hasKey("mistral") && S.people.mistral.model) return "mistral";
    return "";
  }
  function b64(buf) { var bytes = new Uint8Array(buf), out = "", i; for (i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(out); }
  async function transcribe(att) {
    var p = reader(att.kind);
    if (!p) throw new Error("Para leer imágenes hace falta Claude o ChatGPT en la sala.");
    var headers = { "content-type": "application/json" }; if (S.people[p].key) headers["x-provider-key"] = S.people[p].key;
    var res = await fetch(BASE + "/leer/" + p, { method: "POST", headers: headers, body: JSON.stringify({ model: S.people[p].model, kind: att.kind, mime: att.mime, data: att.data, name: att.name }) });
    var raw = await res.text(), text = "", err = "", cut = false;
    if (!res.ok) { try { err = JSON.parse(raw).error; } catch (x) { err = "Error " + res.status; } throw new Error(err); }
    raw.split("\n\n").forEach(function (chunk) { if (chunk.indexOf("data: ") !== 0) return; try { var ev = JSON.parse(chunk.slice(6)); if (typeof ev.t === "string") text += ev.t; if (ev.error) err = ev.error; if (ev.cut) cut = true; } catch (x) {} });
    if (!text) throw new Error(err || "No se ha podido leer.");
    return text.trim() + (cut ? "\n[…lectura cortada por tiempo…]" : "");
  }
  function jpeg(canvas) { return canvas.toDataURL("image/jpeg", 0.86).split(",")[1]; }
  function imageData(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        var k = Math.min(1, 1800 / Math.max(img.naturalWidth, img.naturalHeight)), c = document.createElement("canvas");
        c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
        var g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url); resolve(jpeg(c));
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("No se ha podido abrir la imagen.")); };
      img.src = url;
    });
  }
  function pdfLib() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    return new Promise(function (resolve, reject) {
      var sc = document.createElement("script"); sc.src = PDFJS + "pdf.min.js";
      sc.onload = function () { if (!window.pdfjsLib) return reject(new Error("pdf")); window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS + "pdf.worker.min.js"; resolve(window.pdfjsLib); };
      sc.onerror = function () { reject(new Error("pdf")); };
      document.head.appendChild(sc);
    });
  }
  async function readPdf(file, job) {
    var buf = await file.arrayBuffer(), lib = null;
    try { lib = await pdfLib(); } catch (x) {}
    if (!lib) { // sin la biblioteca: el PDF entero a un participante que sepa leerlo
      if (file.size > 4000000) throw new Error("PDF demasiado grande para leerlo de una vez.");
      job.note = "leyendo…"; filesPaint();
      return transcribe({ kind: "pdf", mime: "application/pdf", data: b64(buf), name: file.name });
    }
    var doc = await lib.getDocument({ data: new Uint8Array(buf) }).promise, n = doc.numPages, pages = [], chars = 0, i;
    for (i = 1; i <= n; i++) {
      job.note = "página " + i + " de " + n; filesPaint();
      var page = await doc.getPage(i), tc = await page.getTextContent(), t = "";
      tc.items.forEach(function (it) { if (typeof it.str !== "string") return; t += it.str; if (it.hasEOL) t += "\n"; else if (it.str && !/\s$/.test(it.str)) t += " "; });
      t = t.replace(/[ \t]+\n/g, "\n").replace(/[ \t]{2,}/g, " ").trim(); chars += t.length; pages.push(t);
    }
    if (chars >= 80 * n) return pages.map(function (t, k) { return (n > 1 ? "[página " + (k + 1) + "]\n" : "") + t; }).join("\n\n");
    // PDF escaneado: cada página se convierte en imagen y se transcribe.
    var max = Math.min(n, 40), out = [];
    for (i = 1; i <= max; i++) {
      job.note = "transcribiendo página " + i + " de " + max; filesPaint();
      var pg = await doc.getPage(i), base = pg.getViewport({ scale: 1 }), vp = pg.getViewport({ scale: Math.min(2.4, 1700 / Math.max(base.width, base.height)) });
      var c = document.createElement("canvas"); c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
      await pg.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
      out.push("[página " + i + "]\n" + (await transcribe({ kind: "image", mime: "image/jpeg", data: jpeg(c), name: file.name + " · página " + i })));
    }
    if (n > max) out.push("[…el PDF tiene " + n + " páginas; se han leído las " + max + " primeras…]");
    return out.join("\n\n");
  }
  function readText(file) { return new Promise(function (resolve, reject) { var r = new FileReader(); r.onload = function () { resolve(String(r.result || "")); }; r.onerror = function () { reject(new Error("No se ha podido leer.")); }; r.readAsText(file); }); }
  var filing = Promise.resolve();
  function addFiles(list) {
    list.forEach(function (file, k) {
      var name = file.name && file.name !== "image.png" ? file.name : "captura-" + hhmm(Date.now()).replace(":", "") + (list.length > 1 ? "-" + (k + 1) : "") + ".png";
      var job = { name: name, note: "en cola…", bad: false }; jobs.push(job);
      filing = filing.then(async function () {
        try {
          var isPdf = /pdf$/i.test(file.type) || /\.pdf$/i.test(name), isImg = /^image\//.test(file.type), text;
          job.note = "leyendo…"; filesPaint();
          if (isPdf) text = await readPdf(file, job);
          else if (isImg) text = await transcribe({ kind: "image", mime: "image/jpeg", data: await imageData(file), name: name });
          else text = await readText(file);
          text = String(text || "").trim();
          if (!text) throw new Error("No tiene texto que se pueda leer.");
          if (text.length > 400000) text = text.slice(0, 400000) + "\n[…recortado por longitud…]";
          jobs.splice(jobs.indexOf(job), 1); S.files.push({ name: name, text: text }); save();
        } catch (x) { job.bad = true; job.note = (x && x.message) || "No se ha podido leer."; }
        filesPaint();
      });
    });
    filesPaint();
  }

  /* ---------- contexto permanente: la memoria de la sala ---------- */
  function ctxNote(text, bad) { var n = $("#ctx-note"); n.textContent = text; n.style.color = bad ? "var(--bad)" : ""; }
  function ctxLoad() {
    return fetch(BASE + "/contexto").then(function (r) { return r.json(); }).then(function (j) {
      CTX.text = j.text || ""; $("#ctx").value = CTX.text;
      try { localStorage.setItem(LS + ".ctx", CTX.text); } catch (e) {}
      ctxNote(CTX.text ? "Cargado del servidor" + (j.updated ? " · última edición " + new Date(j.updated).toLocaleString("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "") + "." : "Vacío. Lo que escribas aquí lo sabrán los cuatro en todas las reuniones.");
    }).catch(function () {
      try { CTX.text = localStorage.getItem(LS + ".ctx") || ""; } catch (e) {}
      $("#ctx").value = CTX.text; ctxNote("No se ha podido leer del servidor: se usa la copia de este navegador.", true);
    });
  }
  function ctxSave() {
    clearTimeout(CTX.timer);
    try { localStorage.setItem(LS + ".ctx", CTX.text); } catch (e) {}
    return fetch(BASE + "/contexto", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: CTX.text }) }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); }).then(function (x) {
      ctxNote(x.ok ? "Guardado en el servidor · " + hhmm(Date.now()) : (x.j.error || "No se ha podido guardar."), !x.ok);
    }).catch(function () { ctxNote("No se ha podido guardar en el servidor.", true); });
  }
  // Al terminar una reunión, un participante la resume y el resumen se añade al contexto.
  function keep() {
    var p = ready("anthropic") ? "anthropic" : present()[0];
    var t = transcript(null), b = $("#keep");
    if (busy || !p || !t) return;
    var who = S.people[p], headers = { "content-type": "application/json" }; if (who.key) headers["x-provider-key"] = who.key;
    b.disabled = true; b.textContent = "Resumiendo…";
    var system = "Eres el secretario de una reunión de trabajo. Escribes en español, sin adornos y sin opinar.";
    var prompt = (S.brief.trim() ? "ORDEN DEL DÍA:\n\n" + S.brief.trim() + "\n\n---\n\n" : "") + "TRANSCRIPCIÓN:\n\n" + t + "\n\n---\n\nResume la reunión en un máximo de 150 palabras para que quien no estuvo sepa dónde quedó: tema, acuerdos, desacuerdos entre participantes y lo que queda pendiente o tiene que decidir la moderadora. Texto corrido, sin título.";
    var done = function (text, err) {
      b.disabled = false; b.textContent = "Guardar las conclusiones en el contexto";
      if (!text) { ctxNote(err || "No se ha podido resumir la reunión.", true); return; }
      var d = new Date(S.log.length ? S.log[0].ts : Date.now()).toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" });
      var base = CTX.text.replace(/\s+$/, "");
      if (base.indexOf("## Reuniones anteriores") < 0) base += (base ? "\n\n" : "") + "## Reuniones anteriores";
      CTX.text = base + "\n\n### " + d + "\n\n" + text.trim() + "\n"; $("#ctx").value = CTX.text; ctxSave();
    };
    fetch(BASE + "/turno/" + p, { method: "POST", headers: headers, body: JSON.stringify({ model: who.model, system: system, prompt: prompt }) }).then(function (r) { return r.text(); }).then(function (raw) {
      var text = "", err = "";
      raw.split("\n\n").forEach(function (chunk) { if (chunk.indexOf("data: ") !== 0) return; try { var ev = JSON.parse(chunk.slice(6)); if (typeof ev.t === "string") text += ev.t; if (ev.error) err = ev.error; } catch (x) {} });
      done(text, err);
    }).catch(function () { done("", "Se ha cortado la conexión al resumir."); });
  }

  /* ---------- acta ---------- */
  function acta() {
    var d = new Date(S.log.length ? S.log[0].ts : Date.now());
    var out = ["# Acta de la reunión — " + d.toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" }), ""];
    out.push("Moderadora: Esmeralda García.");
    var seen = {}; S.log.forEach(function (e) { if (e.who !== "mod" && !e.error) seen[e.name] = e.model; });
    out.push("Participantes: " + (Object.keys(seen).map(function (n) { return n + " (" + seen[n] + ")"; }).join(", ") || "ninguno") + ".", "");
    if (S.brief.trim()) out.push("## Orden del día y material", "", S.brief.trim(), "");
    if (S.files.length) out.push("Archivos aportados: " + S.files.map(function (f) { return f.name; }).join(", ") + ".", "");
    out.push("## Transcripción", "");
    S.log.forEach(function (e) { if (e.error) return; out.push("**" + e.name + "** · " + hhmm(e.ts) + (e.cut ? " · cortado por tiempo" : ""), "", e.text.trim(), ""); });
    return out.join("\n");
  }
  function stamp() { var d = new Date(); var z = function (n) { return ("0" + n).slice(-2); }; return d.getFullYear() + "-" + z(d.getMonth() + 1) + "-" + z(d.getDate()) + "-" + z(d.getHours()) + z(d.getMinutes()); }

  /* ---------- pintar y eventos ---------- */
  function paint() {
    var list = present();
    ORDER.forEach(function (p) { ui[p].card.className = "p" + (S.people[p].on ? "" : " off"); });
    $("#round").disabled = busy || !list.length; $("#only").disabled = busy;
    $("#stop").hidden = !busy;
    var floor = $("#floor"); floor.innerHTML = "";
    ORDER.forEach(function (p) {
      if (!S.people[p].on) return;
      var b = el("button", "btn", "Adelante, " + NAMES[p]); b.disabled = busy || !ready(p);
      if (!ready(p)) b.title = hasKey(p) ? "Elige un modelo" : "Falta la clave";
      b.addEventListener("click", function () { takeSay(); run([p]); });
      floor.appendChild(b);
    });
  }
  buildPeople();
  $("#remember").checked = S.remember; $("#rotate").checked = S.rotate;
  $("#rules").value = S.rules; $("#brief").value = S.brief;
  $("#remember").addEventListener("change", function (e) { S.remember = e.target.checked; save(); });
  $("#rotate").addEventListener("change", function (e) { S.rotate = e.target.checked; save(); });
  $("#rules").addEventListener("input", function (e) { S.rules = e.target.value; save(); });
  $("#rules-reset").addEventListener("click", function () { S.rules = RULES; $("#rules").value = RULES; save(); });
  $("#brief").addEventListener("input", function (e) { S.brief = e.target.value; save(); });
  $("#file").addEventListener("change", function (ev) { var list = Array.prototype.slice.call(ev.target.files || []); ev.target.value = ""; addFiles(list); });
  var depth = 0;
  window.addEventListener("dragenter", function (e) { if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], "Files") >= 0) { depth += 1; document.body.classList.add("drop"); } });
  window.addEventListener("dragleave", function () { depth = Math.max(0, depth - 1); if (!depth) document.body.classList.remove("drop"); });
  window.addEventListener("dragover", function (e) { if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], "Files") >= 0) e.preventDefault(); });
  window.addEventListener("drop", function (e) { depth = 0; document.body.classList.remove("drop"); if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) { e.preventDefault(); addFiles(Array.prototype.slice.call(e.dataTransfer.files)); } });
  window.addEventListener("paste", function (e) { var fs = e.clipboardData && e.clipboardData.files ? Array.prototype.slice.call(e.clipboardData.files) : []; if (fs.length) { e.preventDefault(); addFiles(fs); } });
  filesPaint();
  $("#round").addEventListener("click", round);
  $("#only").addEventListener("click", function () { takeSay(); });
  $("#stop").addEventListener("click", function () { stopFlag = true; hush(); if (ctl) ctl.abort(); });
  $("#mic").addEventListener("click", function () { if (wantMic) { wantMic = false; micHold(); micPaint(); } else { wantMic = true; hush(); micStart(); } });
  $("#voice").checked = S.voice; if (!synth) { $("#voice").disabled = true; }
  $("#voice").addEventListener("change", function (e) { S.voice = e.target.checked; if (!S.voice) hush(); save(); });
  if (synth) { synth.getVoices(); if (synth.addEventListener) synth.addEventListener("voiceschanged", function () {}); }
  micPaint();
  $("#say").addEventListener("keydown", function (e) { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); round(); } });
  $("#export").addEventListener("click", function () {
    var a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([acta()], { type: "text/markdown;charset=utf-8" })); a.download = "acta-reunion-" + stamp() + ".md";
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  });
  $("#copy").addEventListener("click", function () {
    var b = $("#copy");
    (navigator.clipboard ? navigator.clipboard.writeText(acta()) : Promise.reject()).then(function () { b.textContent = "Copiada"; }, function () { b.textContent = "No se ha podido copiar"; }).then(function () { setTimeout(function () { b.textContent = "Copiar acta"; }, 1600); });
  });
  $("#new").addEventListener("click", function () {
    if (busy) return;
    if (S.log.length && !window.confirm("Se vacía la transcripción de esta sala. El orden del día, las reglas y las claves se conservan. ¿Seguir?")) return;
    S.log = []; S.next = 0; save(); renderLog();
  });
  $("#conf").addEventListener("click", function () { $("#aside").classList.toggle("open"); });
  $("#ctx").addEventListener("input", function (e) { CTX.text = e.target.value; ctxNote("Sin guardar…"); clearTimeout(CTX.timer); CTX.timer = setTimeout(ctxSave, 900); });
  $("#keep").addEventListener("click", keep);
  ctxLoad();
  // Dos pestañas de la sala abiertas: la que no está trabajando sigue a la otra.
  window.addEventListener("storage", function (ev) {
    if (busy || ev.key !== LS) return;
    var other = load(); S.log = other.log; S.brief = other.brief; S.next = other.next; S.files = other.files;
    $("#brief").value = S.brief; renderLog(); filesPaint();
  });
  renderLog(); paint();
  fetch(BASE + "/estado").then(function (r) { return r.json(); }).then(function (j) { serverKey = (j && j.serverKey) || serverKey; }).catch(function () {}).then(function () {
    if (serverKey.anthropic) ui.anthropic.key.placeholder = "Opcional: hay una clave en el servidor";
    ORDER.forEach(function (p) { if (hasKey(p)) loadModels(p); });
    if (!ORDER.some(hasKey)) $("#aside").classList.add("open"); // primera visita: las claves a la vista
    paint();
  });
})();
</script>
</body>
</html>`;
