// Página de la sala de reunión. La sirve netlify/functions/meeting.mjs solo con la contraseña
// correcta en la ruta. Todo va en un único documento: sin recursos externos.
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
    <details open><summary>Orden del día y material</summary><div>
      <textarea id="brief" placeholder="De qué va la reunión y qué material tienen todos delante. Lo leen los cuatro antes de cada intervención."></textarea>
      <div class="row" style="margin-top:8px"><label class="btn" style="cursor:pointer">Añadir archivo de texto<input type="file" id="file" accept=".md,.txt,.csv,.json,text/*" multiple hidden></label></div>
    </div></details>
    <details><summary>Reglas de la sala</summary><div>
      <textarea id="rules" style="min-height:220px"></textarea>
      <div class="row" style="margin-top:8px"><button class="btn" id="rules-reset">Restaurar las reglas iniciales</button></div>
    </div></details>
  </div>
  <div class="box"><h4>Acta</h4>
    <div class="row"><button class="btn" id="export">Descargar acta</button><button class="btn" id="copy">Copiar acta</button><button class="btn" id="new">Nueva reunión</button></div>
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
    return { people: people, remember: true, rotate: true, voice: false, rules: RULES, brief: "", log: [], next: 0 };
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
    return S.rules.trim() + "\n\nTú eres " + NAMES[p] + ". En la transcripción tus intervenciones anteriores aparecen como [" + NAMES[p] + "] y las de la moderadora como [" + MOD + "]. Participantes en la sala: " + others + ".";
  }
  function promptFor(p, entry) {
    var out = "";
    if (S.brief.trim()) out += "ORDEN DEL DÍA Y MATERIAL, aportado por la moderadora:\n\n" + S.brief.trim() + "\n\n---\n\n";
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

  /* ---------- acta ---------- */
  function acta() {
    var d = new Date(S.log.length ? S.log[0].ts : Date.now());
    var out = ["# Acta de la reunión — " + d.toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" }), ""];
    out.push("Moderadora: Esmeralda García.");
    var seen = {}; S.log.forEach(function (e) { if (e.who !== "mod" && !e.error) seen[e.name] = e.model; });
    out.push("Participantes: " + (Object.keys(seen).map(function (n) { return n + " (" + seen[n] + ")"; }).join(", ") || "ninguno") + ".", "");
    if (S.brief.trim()) out.push("## Orden del día y material", "", S.brief.trim(), "");
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
  $("#file").addEventListener("change", function (ev) {
    var files = Array.prototype.slice.call(ev.target.files || []);
    var read = function (i) {
      if (i >= files.length) { ev.target.value = ""; $("#brief").value = S.brief; save(); return; }
      var r = new FileReader();
      r.onload = function () { S.brief = (S.brief.trim() ? S.brief.trim() + "\n\n" : "") + "### " + files[i].name + "\n\n" + String(r.result || "").trim(); read(i + 1); };
      r.onerror = function () { read(i + 1); };
      r.readAsText(files[i]);
    };
    read(0);
  });
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
