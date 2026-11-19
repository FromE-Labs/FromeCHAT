// Página del contenedor de arquitectura (ver container.mjs). Un solo documento, sin
// recursos externos. El script no puede contener acentos graves ni la secuencia
// dólar-llave.

export const PAGE = String.raw`<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Contenedor — From E™</title>
<style>
  :root { --bg: #0d1014; --panel: #151a21; --line: #262d38; --text: #e7e9ec; --dim: #97a0ad; --accent: #35c2ae; --accent-ink: #06231f; --warn: #e0a34a; --mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace; }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text); font: 16px/1.55 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  header { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 14px 20px; border-bottom: 1px solid var(--line); flex-wrap: wrap; }
  header b { font-size: 17px; } header b i { color: var(--accent); font-style: normal; }
  header .who { color: var(--dim); font-size: 14px; display: flex; gap: 12px; align-items: center; }
  main { max-width: 980px; margin: 0 auto; padding: 22px 16px 70px; }
  h1 { font-size: 24px; line-height: 1.2; margin: 6px 0 10px; }
  h2 { font-size: 17px; margin: 0 0 8px; }
  p.lead { color: var(--dim); max-width: 70ch; margin: 0 0 12px; }
  .note { color: var(--dim); font-size: 14px; } .err { color: var(--warn); } .ok { color: var(--accent); }
  label { display: block; font-size: 14px; color: var(--dim); margin: 12px 0 4px; }
  input[type=text], input[type=password], input[type=number], select, textarea { width: 100%; font: inherit; color: var(--text); background: var(--panel); border: 1px solid var(--line); border-radius: 6px; padding: 9px 11px; }
  textarea { resize: vertical; }
  textarea#arch { min-height: 46vh; font: 14px/1.5 var(--mono); }
  textarea#say { min-height: 84px; }
  .btn { font: inherit; font-weight: 600; padding: 9px 15px; border-radius: 6px; border: 1px solid var(--line); background: var(--panel); color: var(--text); cursor: pointer; }
  .btn.main { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); }
  .btn.small { font-size: 13px; padding: 5px 9px; font-weight: 500; }
  .btn:disabled { opacity: .45; cursor: default; }
  .row { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin: 12px 0; }
  .tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--line); margin-bottom: 18px; }
  .tabs button { font: inherit; background: none; border: 0; border-bottom: 2px solid transparent; color: var(--dim); padding: 9px 14px; cursor: pointer; }
  .tabs button.on { color: var(--text); border-bottom-color: var(--accent); font-weight: 600; }
  .box { background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 16px; max-width: 460px; }
  .grid { display: grid; grid-template-columns: 2fr 1fr 1fr; gap: 12px; } @media (max-width: 700px) { .grid { grid-template-columns: 1fr; } }
  .msg { margin: 16px 0; } .msg .tag { color: var(--dim); font-size: 12px; letter-spacing: .12em; margin-bottom: 4px; }
  .msg.user .bubble { background: var(--panel); border-left: 3px solid var(--accent); padding: 10px 14px; border-radius: 0 6px 6px 0; white-space: pre-wrap; overflow-wrap: anywhere; }
  .msg.model .bubble { overflow-wrap: anywhere; }
  .bubble h3 { font-size: 16px; margin: 14px 0 6px; } .bubble p { margin: 10px 0; } .bubble ul, .bubble ol { margin: 8px 0; padding-left: 22px; }
  .bubble blockquote { margin: 10px 0; padding-left: 12px; border-left: 2px solid var(--line); color: var(--dim); } .bubble hr { border: 0; border-top: 1px solid var(--line); margin: 14px 0; }
  .bubble pre { background: var(--panel); border: 1px solid var(--line); border-radius: 6px; padding: 10px; overflow: auto; font: 13px/1.45 var(--mono); }
  details.sent { margin-top: 8px; border: 1px solid var(--line); border-radius: 6px; }
  details.sent summary { cursor: pointer; padding: 7px 11px; color: var(--dim); font-size: 14px; }
  details.sent .in { padding: 4px 12px 12px; }
  details.sent pre { background: var(--bg); border: 1px solid var(--line); border-radius: 6px; padding: 10px; overflow: auto; max-height: 340px; font: 12.5px/1.45 var(--mono); white-space: pre-wrap; overflow-wrap: anywhere; margin: 6px 0 12px; }
  table { border-collapse: collapse; width: 100%; margin: 8px 0; } th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid var(--line); font-size: 14px; } th { color: var(--dim); font-weight: 500; }
  code { font: 13px var(--mono); }
  .hidden { display: none !important; }
  .check { display: flex; gap: 8px; align-items: center; color: var(--text); font-size: 15px; margin: 0; } .check input { width: auto; }
</style>
</head>
<body>
<header><b>Contenedor · From <i>E™</i></b><span class="who" id="who"></span></header>
<main id="app"></main>
<script>
(function () {
  var SETUP = __SETUP__;
  var app = document.getElementById("app"), who = document.getElementById("who");
  var ST = { user: null, account: false, saved: null, serverKey: false };
  var TALK = [], busy = false, tab = "arch", models = [];
  var PREF = loadPref();

  function loadPref() { try { return JSON.parse(localStorage.getItem("frome.contenedor.pref") || "{}") || {}; } catch (e) { return {}; } }
  function savePref() { try { localStorage.setItem("frome.contenedor.pref", JSON.stringify(PREF)); } catch (e) {} }
  function loadTalk() { try { var t = JSON.parse(sessionStorage.getItem("frome.contenedor.talk") || "[]"); if (Array.isArray(t)) TALK = t; } catch (e) {} }
  function saveTalk() { try { sessionStorage.setItem("frome.contenedor.talk", JSON.stringify(TALK)); } catch (e) {} }
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; }
  function clear(n) { while (n.firstChild) n.removeChild(n.firstChild); }
  function esc(s) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function when(iso) { try { return new Date(iso).toLocaleString("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); } catch (e) { return iso; } }
  function api(method, path, data, extra) {
    var h = { "x-contenedor": "1" }; if (data !== undefined) h["content-type"] = "application/json";
    if (extra) for (var k in extra) h[k] = extra[k];
    return fetch("/contenedor/api/" + path, { method: method, headers: h, body: data === undefined ? undefined : JSON.stringify(data), credentials: "same-origin", cache: "no-store" });
  }
  function apiJson(method, path, data, extra) { return api(method, path, data, extra).then(function (r) { return r.json().then(function (j) { j._status = r.status; return j; }, function () { return { _status: r.status, error: "Respuesta no válida." }; }); }); }

  // Markdown mínimo para las respuestas.
  function inline(s) { return esc(s).replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>").replace(/(^|[\s(«"'])\*([^*\n]+)\*(?=[\s.,;:!?)»"']|$)/g, "$1<i>$2</i>").replace(/\x60([^\x60]+)\x60/g, "<code>$1</code>"); }
  function md(src) {
    var out = [], list = null, quote = [], para = [], code = null;
    function flush() {
      if (para.length) { out.push("<p>" + para.map(inline).join("<br>") + "</p>"); para = []; }
      if (list) { out.push("<" + list.t + ">" + list.items.map(function (x) { return "<li>" + inline(x) + "</li>"; }).join("") + "</" + list.t + ">"); list = null; }
      if (quote.length) { out.push("<blockquote>" + quote.map(inline).join("<br>") + "</blockquote>"); quote = []; }
    }
    src.split("\n").forEach(function (raw) {
      var line = raw.replace(/\s+$/, ""), m;
      if (/^\x60\x60\x60/.test(line)) { if (code === null) { flush(); code = []; } else { out.push("<pre>" + esc(code.join("\n")) + "</pre>"); code = null; } return; }
      if (code !== null) { code.push(raw); return; }
      if (!line.trim()) { flush(); return; }
      if ((m = line.match(/^#{1,6}\s+(.*)$/))) { flush(); out.push("<h3>" + inline(m[1]) + "</h3>"); return; }
      if (/^(-{3,}|\*{3,})$/.test(line.trim())) { flush(); out.push("<hr>"); return; }
      if ((m = line.match(/^\s*[-*•]\s+(.*)$/))) { if (!list || list.t !== "ul") { flush(); list = { t: "ul", items: [] }; } list.items.push(m[1]); return; }
      if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) { if (!list || list.t !== "ol") { flush(); list = { t: "ol", items: [] }; } list.items.push(m[1]); return; }
      if ((m = line.match(/^>\s?(.*)$/))) { if (!quote.length) flush(); quote.push(m[1]); return; }
      if (list || quote.length) flush();
      para.push(line);
    });
    if (code !== null) out.push("<pre>" + esc(code.join("\n")) + "</pre>");
    flush();
    return out.join("");
  }

  function refresh() { return apiJson("GET", "estado").then(function (s) { ST = { user: s.user || null, account: Boolean(s.account), saved: s.saved || null, serverKey: Boolean(s.serverKey) }; }); }
  function paintWho() {
    clear(who);
    if (!ST.user) return;
    who.appendChild(el("span", "", ST.user));
    var out = el("button", "btn small", "Salir");
    out.addEventListener("click", function () { api("POST", "salir", {}).then(function () { TALK = []; saveTalk(); start(); }); });
    who.appendChild(out);
  }

  // --- alta y entrada ---
  function viewAccess() {
    clear(app); paintWho();
    var setup = !ST.account;
    app.appendChild(el("h1", "", setup ? "Crea tu acceso" : "Entra"));
    if (setup && !SETUP) { app.appendChild(el("p", "lead", "Todavía no hay cuenta. Se crea desde la dirección de alta.")); return; }
    app.appendChild(el("p", "lead", setup ? "El contenedor tiene una sola cuenta: la tuya. Con ella se cifra lo que guardes. La contraseña no se puede recuperar: si la olvidas, lo guardado no se puede abrir." : "Con tu usuario y tu contraseña."));
    var box = el("div", "box");
    var lu = el("label", "", "Usuario"), u = el("input"); u.type = "text"; u.autocomplete = "username";
    var lp = el("label", "", "Contraseña" + (setup ? " (10 caracteres o más)" : "")), p = el("input"); p.type = "password"; p.autocomplete = setup ? "new-password" : "current-password";
    box.appendChild(lu); box.appendChild(u); box.appendChild(lp); box.appendChild(p);
    var p2 = null;
    if (setup) { var l2 = el("label", "", "Repite la contraseña"); p2 = el("input"); p2.type = "password"; p2.autocomplete = "new-password"; box.appendChild(l2); box.appendChild(p2); }
    var msg = el("p", "note err", ""), go = el("button", "btn main", setup ? "Crear la cuenta" : "Entrar"), row = el("div", "row");
    function submit() {
      if (setup && p.value !== p2.value) { msg.textContent = "Las dos contraseñas no coinciden."; return; }
      go.disabled = true; msg.textContent = "";
      apiJson("POST", setup ? "alta" : "entrar", setup ? { token: SETUP, user: u.value.trim(), pass: p.value } : { user: u.value.trim(), pass: p.value }).then(function (r) {
        go.disabled = false;
        if (r._status !== 200) { msg.textContent = r.error || "No se ha podido."; return; }
        if (setup && history.replaceState) history.replaceState(null, "", "/contenedor/");
        start();
      });
    }
    go.addEventListener("click", submit);
    [u, p, p2].forEach(function (x) { if (x) x.addEventListener("keydown", function (e) { if (e.key === "Enter") submit(); }); });
    row.appendChild(go); box.appendChild(row); box.appendChild(msg); app.appendChild(box);
  }

  // --- aplicación ---
  function viewApp() {
    clear(app); paintWho();
    var tabs = el("div", "tabs");
    [["arch", "Tu arquitectura"], ["chat", "Chat"]].forEach(function (t) {
      var b = el("button", tab === t[0] ? "on" : "", t[1]);
      b.addEventListener("click", function () { tab = t[0]; viewApp(); });
      tabs.appendChild(b);
    });
    app.appendChild(tabs);
    var pane = el("div"); app.appendChild(pane);
    if (tab === "arch") viewArch(pane); else viewChat(pane);
  }

  function viewArch(pane) {
    pane.appendChild(el("p", "lead", "Lo que escribas aquí se envía al modelo tal cual, como instrucciones, en cada mensaje. El contenedor no añade, no quita y no reordena nada. Se guarda cifrado con tu contraseña."));
    var ta = el("textarea"); ta.id = "arch"; ta.spellcheck = false; ta.placeholder = "Pega o escribe aquí tu arquitectura."; pane.appendChild(ta);
    var row = el("div", "row"), save = el("button", "btn main", "Guardar"), count = el("span", "note", ""), status = el("span", "note", "");
    row.appendChild(save); row.appendChild(count); row.appendChild(status); pane.appendChild(row);
    var hist = el("div"); pane.appendChild(hist);
    var loadedSha = null;
    function paintCount() { count.textContent = ta.value.length.toLocaleString("es-ES") + " caracteres"; }
    function paintHist(versions, current) {
      clear(hist);
      if (!versions || !versions.length) return;
      hist.appendChild(el("h2", "", "Versiones guardadas"));
      var table = el("table"), hr = el("tr"); ["Guardada", "Caracteres", "Huella", ""].forEach(function (x) { hr.appendChild(el("th", "", x)); }); table.appendChild(hr);
      versions.forEach(function (v, i) {
        var tr = el("tr");
        tr.appendChild(el("td", "", when(v.at) + (i === 0 ? " · en uso" : "")));
        tr.appendChild(el("td", "", v.chars.toLocaleString("es-ES")));
        var td = el("td"); td.appendChild(el("code", "", v.sha.slice(0, 12))); tr.appendChild(td);
        var act = el("td");
        if (v.sha !== current) { var b = el("button", "btn small", "Abrir en el cuadro"); b.addEventListener("click", function () { load(v.sha, true); }); act.appendChild(b); }
        tr.appendChild(act); table.appendChild(tr);
      });
      hist.appendChild(table);
      hist.appendChild(el("p", "note", "Abrir una versión anterior solo la pone en el cuadro. No pasa a estar en uso hasta que pulses «Guardar»."));
    }
    function load(v, old) {
      apiJson("GET", "arquitectura" + (v ? "?v=" + encodeURIComponent(v) : "")).then(function (r) {
        if (r._status !== 200) { status.textContent = r.error || "No se ha podido leer."; status.className = "note err"; return; }
        ta.value = r.text || ""; loadedSha = r.sha; paintCount(); paintHist(r.versions, old ? null : r.sha);
        status.className = "note"; status.textContent = old ? "Versión del " + when(r.at) + " en el cuadro, sin guardar." : (r.at ? "En uso desde el " + when(r.at) + "." : "Todavía no hay nada guardado.");
      });
    }
    ta.addEventListener("input", function () { paintCount(); status.className = "note"; status.textContent = "Cambios sin guardar."; });
    save.addEventListener("click", function () {
      save.disabled = true;
      apiJson("PUT", "arquitectura", { text: ta.value }).then(function (r) {
        save.disabled = false;
        if (r._status !== 200) { status.className = "note err"; status.textContent = r.error || "No se ha podido guardar."; return; }
        ST.saved = { at: r.at, sha: r.sha, chars: ta.value.length }; loadedSha = r.sha;
        status.className = "note ok"; status.textContent = r.unchanged ? "Sin cambios: ya estaba guardada." : "Guardada. Huella " + r.sha.slice(0, 12) + ".";
        paintHist(r.versions, r.sha);
      });
    });
    load("", false);
  }

  function viewChat(pane) {
    var top = el("div", "grid");
    var c1 = el("div"), c2 = el("div"), c3 = el("div");
    c1.appendChild(el("label", "", "Modelo")); var sel = el("select"); c1.appendChild(sel);
    c2.appendChild(el("label", "", "Salida máxima (tokens)")); var mt = el("input"); mt.type = "number"; mt.min = "256"; mt.max = "32000"; mt.step = "256"; mt.value = PREF.max_tokens || 4096; c2.appendChild(mt);
    c3.appendChild(el("label", "", "Razonamiento previo")); var ef = el("select");
    [["", "El del modelo"], ["low", "Bajo"], ["medium", "Medio"], ["high", "Alto"]].forEach(function (o) { var op = el("option", "", o[1]); op.value = o[0]; ef.appendChild(op); }); ef.value = PREF.effort || ""; c3.appendChild(ef);
    top.appendChild(c1); top.appendChild(c2); top.appendChild(c3); pane.appendChild(top);
    var keyIn = null;
    if (!ST.serverKey) { pane.appendChild(el("label", "", "Clave de API de Anthropic (se usa en cada petición y no se guarda)")); keyIn = el("input"); keyIn.type = "password"; keyIn.autocomplete = "off"; pane.appendChild(keyIn); }
    function paintModels() {
      clear(sel);
      var list = models.length ? models : [{ id: "claude-opus-5-5", name: "claude-opus-5-5" }];
      list.forEach(function (m) { var o = el("option", "", m.name === m.id ? m.id : m.name + " · " + m.id); o.value = m.id; sel.appendChild(o); });
      if (PREF.model && list.some(function (m) { return m.id === PREF.model; })) sel.value = PREF.model;
    }
    function fetchModels() { apiJson("GET", "modelos", undefined, keyIn && keyIn.value ? { "x-provider-key": keyIn.value.trim() } : null).then(function (r) { if (r.models && r.models.length) { models = r.models; paintModels(); } }); }
    paintModels(); if (!models.length) fetchModels();
    if (keyIn) keyIn.addEventListener("change", fetchModels);
    sel.addEventListener("change", function () { PREF.model = sel.value; savePref(); });
    mt.addEventListener("change", function () { PREF.max_tokens = Number(mt.value) || 4096; savePref(); });
    ef.addEventListener("change", function () { PREF.effort = ef.value; savePref(); });

    var info = el("p", "note", ST.saved ? "Arquitectura en uso: guardada el " + when(ST.saved.at) + ", " + ST.saved.chars.toLocaleString("es-ES") + " caracteres, huella " + ST.saved.sha.slice(0, 12) + "." : "No hay arquitectura guardada todavía.");
    pane.appendChild(info);
    var log = el("div"); pane.appendChild(log);
    var say = el("textarea"); say.id = "say"; say.placeholder = "Escribe tu mensaje."; pane.appendChild(say);
    var row = el("div", "row"), send = el("button", "btn main", "Enviar"), bareL = el("label", "check"), bare = el("input"); bare.type = "checkbox";
    bareL.appendChild(bare); bareL.appendChild(document.createTextNode("Enviar este mensaje sin arquitectura"));
    var fresh = el("button", "btn", "Nueva conversación"), exp = el("button", "btn", "Descargar la conversación");
    row.appendChild(send); row.appendChild(bareL); row.appendChild(fresh); row.appendChild(exp); pane.appendChild(row);
    pane.appendChild(el("p", "note", "Si quieres comparar con y sin arquitectura en limpio, hazlo en conversaciones separadas: en una misma conversación, cada respuesta ve las anteriores."));
    var msg = el("p", "note err", ""); pane.appendChild(msg);

    function sentBlock(m) {
      var d = el("details", "sent"), s = el("summary", "", "Lo que se ha enviado al modelo");
      d.appendChild(s);
      var inn = el("div", "in");
      var r = m.sent.request, sys = r.system && r.system[0] ? r.system[0].text : "";
      var line = "Modelo " + r.model + " · salida máxima " + r.max_tokens + " · razonamiento " + (r.output_config ? r.output_config.effort : "el del modelo");
      inn.appendChild(el("p", "note", line));
      if (sys) {
        var match = ST.saved && m.sent.sha === ST.saved.sha;
        inn.appendChild(el("p", "note " + (m.sent.sha ? "ok" : ""), "Instrucciones: " + sys.length.toLocaleString("es-ES") + " caracteres, huella " + (m.sent.sha || "").slice(0, 12) + ", guardadas el " + when(m.sent.saved_at) + (match ? ". Es la versión en uso." : ". Ya no es la versión en uso.")));
        inn.appendChild(el("pre", "", sys));
      } else inn.appendChild(el("p", "note", "Sin instrucciones: este mensaje se envió sin arquitectura."));
      inn.appendChild(el("p", "note", "Conversación enviada (" + r.messages.length + " mensajes):"));
      inn.appendChild(el("pre", "", r.messages.map(function (x) { return "[" + x.role + "]\n" + x.content; }).join("\n\n")));
      if (m.usage) inn.appendChild(el("p", "note", "Consumo que declara el proveedor: " + (m.usage.input + m.usage.cache_read + m.usage.cache_write) + " tokens de entrada (" + m.usage.cache_read + " leídos de caché, " + m.usage.cache_write + " escritos en caché) y " + m.usage.output + " de salida. Tiempo: " + (m.ms / 1000).toFixed(1) + " s." + (m.stop && m.stop !== "end_turn" ? " Motivo de parada: " + m.stop + "." : "")));
      d.appendChild(inn);
      return d;
    }
    function paintLog() {
      clear(log);
      TALK.forEach(function (m) {
        var wrap = el("div", "msg " + (m.role === "user" ? "user" : "model"));
        wrap.appendChild(el("div", "tag", m.role === "user" ? "TÚ" : (m.bare ? "MODELO · SIN ARQUITECTURA" : "MODELO · CON TU ARQUITECTURA")));
        var b = el("div", "bubble");
        if (m.role === "user") b.textContent = m.content; else b.innerHTML = m.content ? md(m.content) : "<p class=\"note\">" + (m.state || "…") + "</p>";
        wrap.appendChild(b);
        if (m.note) wrap.appendChild(el("p", "note err", m.note));
        if (m.sent) wrap.appendChild(sentBlock(m));
        log.appendChild(wrap);
      });
    }
    function setBusy(v) { busy = v; send.disabled = v; fresh.disabled = v; }
    function submit() {
      var text = say.value.trim();
      if (busy || !text) return;
      msg.textContent = "";
      TALK.push({ role: "user", content: text });
      var a = { role: "assistant", content: "", bare: bare.checked, state: "Enviando…" };
      TALK.push(a); say.value = ""; paintLog(); setBusy(true);
      var payload = { model: sel.value, max_tokens: Number(mt.value) || 4096, effort: ef.value, bare: bare.checked, messages: TALK.slice(0, -1).filter(function (m) { return m.content; }).map(function (m) { return { role: m.role, content: m.content }; }) };
      if (keyIn && keyIn.value) payload.key = keyIn.value.trim();
      api("POST", "mensaje", payload).then(function (r) {
        if (r.status !== 200 || !r.body) {
          return r.json().then(function (j) { return j; }, function () { return {}; }).then(function (j) {
            a.note = (j.error || "No se ha podido enviar.") + (j.status ? " (estado " + j.status + " del proveedor)" : "");
            if (j.sent) a.sent = { request: j.sent, sha: null, saved_at: null };
            a.state = "Sin respuesta."; if (r.status === 401) { start(); return; }
            finish();
          });
        }
        var reader = r.body.getReader(), dec = new TextDecoder(), buf = "", last = 0;
        function pump() {
          return reader.read().then(function (x) {
            if (x.done) { finish(); return; }
            buf += dec.decode(x.value, { stream: true });
            var i;
            while ((i = buf.indexOf("\n\n")) >= 0) {
              var line = buf.slice(0, i); buf = buf.slice(i + 2);
              if (line.indexOf("data: ") !== 0) continue;
              var ev; try { ev = JSON.parse(line.slice(6)); } catch (e) { continue; }
              if (ev.type === "sent") a.sent = { request: ev.request, sha: ev.sha, saved_at: ev.saved_at };
              else if (ev.type === "thinking") a.state = "El modelo está razonando…";
              else if (ev.type === "t") a.content += ev.text;
              else if (ev.type === "error") a.note = ev.message;
              else if (ev.type === "cut") a.note = "Respuesta cortada a los " + Math.round(ev.after_ms / 1000) + " s: es el límite de tiempo de la plataforma. Prueba con menos razonamiento previo o menos salida.";
              else if (ev.type === "done") { a.usage = ev.usage; a.ms = ev.ms; a.stop = ev.stop; if (ev.stop === "max_tokens") a.note = (a.note ? a.note + " " : "") + "Respuesta cortada: ha agotado la salida máxima."; }
            }
            if (Date.now() - last > 120) { last = Date.now(); paintLog(); }
            return pump();
          });
        }
        return pump();
      }).catch(function () { a.note = "Se ha interrumpido la conexión."; finish(); });
    }
    function finish() { if (!TALK[TALK.length - 1].content) TALK[TALK.length - 1].state = "Sin respuesta."; saveTalk(); setBusy(false); paintLog(); }
    send.addEventListener("click", submit);
    say.addEventListener("keydown", function (e) { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) submit(); });
    fresh.addEventListener("click", function () { if (busy) return; TALK = []; saveTalk(); paintLog(); });
    exp.addEventListener("click", function () {
      var out = ["# Conversación en el contenedor", "", new Date().toLocaleString("es-ES"), ""];
      TALK.forEach(function (m) {
        out.push(m.role === "user" ? "## Tú" : "## Modelo" + (m.bare ? " (sin arquitectura)" : " (con arquitectura, huella " + ((m.sent && m.sent.sha) || "").slice(0, 12) + ")"), "", m.content || "(sin respuesta)", "");
        if (m.usage) out.push("_" + (m.sent ? m.sent.request.model : "") + " · " + (m.usage.input + m.usage.cache_read + m.usage.cache_write) + " in · " + m.usage.output + " out · " + (m.ms / 1000).toFixed(1) + " s_", "");
      });
      var a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([out.join("\n")], { type: "text/markdown" })); a.download = "conversacion-contenedor.md"; a.click();
    });
    paintLog();
  }

  function start() { refresh().then(function () { if (ST.user) { loadTalk(); viewApp(); } else viewAccess(); }, function () { clear(app); app.appendChild(el("p", "note err", "No se ha podido conectar con el contenedor.")); }); }
  start();
})();
</script>
</body>
</html>`;
