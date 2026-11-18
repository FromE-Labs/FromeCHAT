/* FromE Chat — cliente. Sin dependencias. La conversación vive en memoria del
   navegador y no se guarda; la clave, en memoria de sesión o cifrada en localStorage si el
   usuario lo pide. Nada de esto se envía a ningún sitio salvo /api/chat. */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  // Idiomas: el español es el texto de origen; T(clave, español, variables) lo traduce si hay traducción.
  const I = window.FromeI18n || { lang: "es", t: (k, es, v) => String(es).replace(/\{(\w+)\}/g, (m, x) => (v && v[x] !== undefined ? v[x] : m)), phrase: (x) => x, fragments: (x) => x, apply: () => {}, onChange: () => {} };
  const T = I.t;
  const el = {
    key: $("key"), eye: $("btn-eye"), remember: $("remember"), keyState: $("key-state"),
    model: $("model"), governed: $("governed"), compare: $("compare"), consent: $("consent"),
    tGov: $("t-governed"), tCmp: $("t-compare"), tCon: $("t-consent"), tRem: $("t-remember"),
    pillGov: $("pill-gov"), banner: $("banner"), cmpOff: $("btn-compare-off"),
    panes: $("panes"), paneB: $("pane-b"), threadA: $("thread-a"), threadB: $("thread-b"),
    headA: $("head-a"), metaA: $("meta-a"), metaB: $("meta-b"), empty: $("empty"),
    form: $("composer"), input: $("input"), send: $("btn-send"), hintR: $("hint-right"), newBtn: $("btn-new"), sid: $("sid"), modsBox: $("mods-box"), mods: $("modules"), presets: $("presets"),
    code: $("code"), codeState: $("code-state"), czBox: $("courtesy-box"),
  };

  /* ---------- estado ---------- */
  const state = {
    history: [],          // [{role, content}] del hilo gobernado (o único)
    historyB: [],         // hilo sin arquitectura (comparador)
    busy: false,
    sessionId: cryptoId(),
    turn: null,           // identificador de la pregunta en curso (cortesía)
    viaCode: false,       // la pregunta en curso va con código de invitación
    courtesy: { enabled: false, ok: false, remaining: null },
  };

  function cryptoId() {
    const a = new Uint8Array(12); crypto.getRandomValues(a);
    return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
  }

  /* ---------- clave: memoria o cifrada en localStorage ---------- */
  const KEY_LS = "fromechat.key.v1", SALT_LS = "fromechat.salt.v1";
  async function deriveKey(salt) {
    // Cifrado local con una clave derivada de un secreto por dispositivo. Protege
    // frente a lectura casual del almacenamiento; no frente a un atacante con
    // control del navegador. Se explica así en Privacidad.
    const raw = new TextEncoder().encode(navigator.userAgent + "|fromechat|" + location.host);
    const base = await crypto.subtle.importKey("raw", raw, "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: 120000, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  }
  async function saveKey(k) {
    try {
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ck = await deriveKey(salt);
      const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, ck, new TextEncoder().encode(k));
      localStorage.setItem(SALT_LS, b64(salt) + "." + b64(iv));
      localStorage.setItem(KEY_LS, b64(new Uint8Array(ct)));
    } catch {}
  }
  async function loadKey() {
    try {
      const s = localStorage.getItem(SALT_LS), c = localStorage.getItem(KEY_LS);
      if (!s || !c) return null;
      const [salt, iv] = s.split(".").map(unb64);
      const ck = await deriveKey(salt);
      const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, ck, unb64(c));
      return new TextDecoder().decode(pt);
    } catch { return null; }
  }
  function forgetKey() { try { localStorage.removeItem(KEY_LS); localStorage.removeItem(SALT_LS); } catch {} }
  const b64 = (u8) => btoa(String.fromCharCode(...u8));
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

  function keyOk() { return /^sk-ant-[A-Za-z0-9_\-]{20,}$/.test(el.key.value.trim()); }
  function refreshKeyState() {
    const v = el.key.value.trim();
    if (!v) { el.keyState.textContent = T("d.key.none", "Sin clave. Pégala para empezar."); el.keyState.style.color = ""; }
    else if (keyOk()) { el.keyState.textContent = T("d.key.ok", "Clave con formato válido. Se comprobará en el primer mensaje."); el.keyState.style.color = "var(--ok)"; }
    else { el.keyState.textContent = T("d.key.bad", "Formato no reconocido: una clave de API de Anthropic empieza por sk-ant-."); el.keyState.style.color = "var(--warn)"; }
    if (!v && useCourtesy()) { el.keyState.textContent = T("d.key.code", "Sin clave: se usará tu código de invitación."); el.keyState.style.color = "var(--ok)"; }
    el.model.disabled = useCourtesy();
    if (useCourtesy()) el.model.value = "claude-opus-5-5";
    el.send.disabled = !canSend() || state.busy;
  }

  /* ---------- código de invitación: preguntas de cortesía ---------- */
  function codeVal() { return el.code.value.trim().toUpperCase().replace(/\s+/g, ""); }
  function codeFormatOk() { return /^[A-Z0-9]{2,4}(-[A-Z0-9]{4}){2,4}$/.test(codeVal()); }
  function useCourtesy() { const c = state.courtesy; return !keyOk() && c.enabled && c.ok && c.remaining > 0; }
  function canSend() { return keyOk() || useCourtesy(); }
  function paintCourtesy(key, es, warn) {
    const c = state.courtesy; c.note = [key, es, warn];
    let t = key ? T(key, es) : "", w = Boolean(warn);
    if (!key && c.ok) {
      if (c.remaining > 0) t = c.remaining === 1 ? T("d.code.left1", "Código válido. Te queda 1 pregunta de cortesía, con Claude Opus 5.5.") : T("d.code.leftn", "Código válido. Te quedan {n} preguntas de cortesía, con Claude Opus 5.5.", { n: c.remaining });
      else { t = T("d.code.empty", "Este código ya no tiene preguntas. Para seguir, pega tu propia clave de Anthropic."); w = true; }
    }
    el.codeState.textContent = t; el.codeState.style.color = !t ? "" : w ? "var(--warn)" : "var(--ok)";
  }
  let codeTimer = 0;
  async function checkCode() {
    const c = state.courtesy; c.ok = false; c.remaining = null;
    if (!c.enabled || !codeVal()) { paintCourtesy(); refreshKeyState(); return; }
    if (!codeFormatOk()) { paintCourtesy("d.code.format", "Formato no reconocido. Un código tiene esta forma: FE-XXXX-XXXX-XXXX.", true); refreshKeyState(); return; }
    try {
      const r = await fetch("/api/courtesy", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ code: codeVal() }) });
      if (r.ok) { const d = await r.json(); c.ok = true; c.remaining = Number(d.remaining) || 0; try { localStorage.setItem("fromechat.code", codeVal()); } catch {} paintCourtesy(); }
      else if (r.status === 429) paintCourtesy("d.code.rate", "Demasiados intentos seguidos. Espera un minuto.", true);
      else paintCourtesy("d.code.unknown", "Código no reconocido.", true);
    } catch { paintCourtesy("d.code.fail", "No se ha podido comprobar el código.", true); }
    refreshKeyState();
  }

  /* ---------- modelos y módulos ---------- */
  const mods = { defs: [], on: new Set() };
  // Interruptores de medición: no salen en la interfaz y solo se añaden por dirección
  // (?medir=uno.otro). El servidor ignora los que no existan en su despliegue.
  const measuring = (new URLSearchParams(location.search).get("medir") || "").split(/[.,]/).map((x) => x.trim()).filter((x) => /^[a-z]{2,20}$/.test(x)).slice(0, 6);
  function shownModules() { return mods.defs.filter((m) => mods.on.has(m.id)).map((m) => m.id); }
  function activeModules() { return shownModules().concat(measuring.filter((id) => !mods.on.has(id))); }
  function saveModules() { try { localStorage.setItem("fromechat.modules", JSON.stringify(shownModules())); } catch {} }
  function paintModules() {
    for (const lab of el.mods.querySelectorAll("label.toggle")) {
      const inp = lab.querySelector("input"); inp.checked = mods.on.has(inp.dataset.mod); lab.classList.toggle("on", inp.checked);
    }
    // El nivel cuyo conjunto de módulos coincide con lo marcado queda resaltado.
    for (const bt of el.presets.querySelectorAll("button")) {
      const want = (bt.dataset.mods || "").split(",").filter(Boolean);
      bt.classList.toggle("on", want.length === mods.on.size && want.every((id) => mods.on.has(id)));
    }
  }
  // Nombre y descripción de módulos y niveles: los del servidor en español; traducidos por identificador.
  function buildModules(d, keep) {
    mods.data = d;
    mods.defs = d.modules || [];
    if (!mods.defs.length) return;
    if (!keep) {
      mods.on = new Set(mods.defs.filter((m) => m.default).map((m) => m.id));
      try { const saved = JSON.parse(localStorage.getItem("fromechat.modules") || "null"); if (Array.isArray(saved)) mods.on = new Set(saved.filter((id) => mods.defs.some((m) => m.id === id))); } catch {}
    }
    el.mods.innerHTML = "";
    for (const m of mods.defs) {
      const lab = document.createElement("label"); lab.className = "toggle"; lab.style.marginTop = "8px";
      const inp = document.createElement("input"); inp.type = "checkbox"; inp.dataset.mod = m.id;
      const sp = document.createElement("span"); const b = document.createElement("b"); b.textContent = T("mod." + m.id, m.label); const sm = document.createElement("small"); sm.textContent = T("mod." + m.id + ".d", m.desc);
      sp.appendChild(b); sp.appendChild(sm); lab.appendChild(inp); lab.appendChild(sp); el.mods.appendChild(lab);
      inp.addEventListener("change", () => { if (inp.checked) mods.on.add(m.id); else mods.on.delete(m.id); saveModules(); paintModules(); syncToggles(); });
    }
    el.presets.innerHTML = "";
    for (const pr of d.presets || []) {
      const bt = document.createElement("button"); bt.type = "button"; bt.dataset.mods = (pr.modules || []).join(",");
      const nm = document.createElement("b"); nm.textContent = T("lvl." + pr.id, pr.label); bt.appendChild(nm);
      if (pr.desc) { const ds = document.createElement("small"); ds.textContent = T("lvl." + pr.id + ".d", pr.desc); bt.appendChild(ds); }
      bt.addEventListener("click", () => { mods.on = new Set(pr.modules); saveModules(); paintModules(); syncToggles(); });
      el.presets.appendChild(bt);
    }
    el.modsBox.hidden = false; paintModules();
  }
  async function loadModels() {
    try {
      const r = await fetch("/api/models"); const d = await r.json();
      el.model.innerHTML = "";
      for (const m of d.models) { const o = document.createElement("option"); o.value = m.id; o.textContent = m.label; el.model.appendChild(o); }
      try { const saved = localStorage.getItem("fromechat.model"); if (saved && d.models.some((m) => m.id === saved)) el.model.value = saved; } catch {}
      buildModules(d);
      state.courtesy.enabled = d.courtesy === true; el.czBox.hidden = !state.courtesy.enabled;
      if (state.courtesy.enabled) { try { const sc = localStorage.getItem("fromechat.code"); if (sc) el.code.value = sc; } catch {} }
    } catch {
      el.model.innerHTML = '<option value="claude-opus-5-5">Claude Opus 5.5</option>';
    }
  }

  /* ---------- UI de toggles ---------- */
  function syncToggles() {
    el.tGov.classList.toggle("on", el.governed.checked);
    el.tCmp.classList.toggle("on", el.compare.checked);
    el.tCon.classList.toggle("on", el.consent.checked);
    el.tRem.classList.toggle("on", el.remember.checked);
    const cmp = el.compare.checked;
    el.banner.hidden = !cmp;
    el.paneB.hidden = !cmp;
    el.panes.classList.toggle("compare", cmp);
    if (cmp) { el.governed.checked = true; el.governed.disabled = true; el.tGov.classList.add("on"); } else { el.governed.disabled = false; }
    const gov = el.governed.checked;
    el.pillGov.classList.toggle("on", gov);
    el.pillGov.innerHTML = '<span class="dot"></span> ' + esc(gov ? T("d.pill.on", "From E™ activa") : T("d.without", "Sin arquitectura"));
    el.headA.textContent = gov ? T("d.with", "Con From E™") : T("d.without", "Sin arquitectura");
    el.hintR.textContent = gov ? T("d.cost", "Con From E™ activa, cada mensaje consume más que una respuesta directa.") : "";
    el.modsBox.classList.toggle("off", !gov);
    for (const inp of el.mods.querySelectorAll("input")) inp.disabled = !gov;
    for (const bt of el.presets.querySelectorAll("button")) bt.disabled = !gov;
    el.hintR.className = gov ? "cost" : "";
    el.sid.hidden = !el.consent.checked;
    el.sid.textContent = T("d.sid", "Identificador de esta sesión: {id}", { id: state.sessionId });
  }

  /* ---------- render ---------- */
  function addMsg(thread, role, text, opts = {}) {
    const m = document.createElement("div"); m.className = "msg " + role;
    const who = document.createElement("div"); who.className = "who"; who.textContent = role === "user" ? T("d.you", "Tú") : (opts.label || T("d.model", "Modelo"));
    m.appendChild(who);
    const body = document.createElement("div"); body.className = "body" + (opts.streaming ? " streaming" : "");
    body.textContent = text;
    m.appendChild(body); thread.appendChild(m);
    thread.scrollTop = thread.scrollHeight;
    return { body, thread };
  }

  /* ---------- formato (Markdown mínimo y seguro) ---------- */
  // Todo el texto se escapa antes de aplicar formato: solo salen las etiquetas de aquí.
  const esc = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  function inline(t) {
    const codes = [];
    t = esc(t).replace(/`([^`\n]+)`/g, (_, c) => { codes.push(c); return "\u0000" + (codes.length - 1) + "\u0000"; });
    t = t.replace(/\*\*([^*\n]+?)\*\*/g, "<strong>$1</strong>").replace(/(^|[\s(])\*([^*\s][^*\n]*?)\*(?=[\s).,;:!?]|$)/g, "$1<em>$2</em>");
    t = t.replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
    return t.replace(/\u0000(\d+)\u0000/g, (_, i) => "<code>" + codes[Number(i)] + "</code>");
  }
  function md(text) {
    const lines = text.replace(/\r/g, "").split("\n");
    const out = []; let para = [], list = null, i = 0;
    const flushP = () => { if (para.length) { out.push("<p>" + para.map(inline).join("<br>") + "</p>"); para = []; } };
    const flushL = () => { if (list) { out.push("<" + list.tag + ">" + list.items.map((x) => "<li" + (x.deep ? ' class="deep"' : "") + ">" + inline(x.t) + "</li>").join("") + "</" + list.tag + ">"); list = null; } };
    const flush = () => { flushP(); flushL(); };
    for (; i < lines.length; i++) {
      const ln = lines[i]; let m;
      if (/^\s*```/.test(ln)) {
        flush(); const buf = []; i++;
        while (i < lines.length && !/^\s*```/.test(lines[i])) buf.push(lines[i++]);
        out.push("<pre><code>" + esc(buf.join("\n")) + "</code></pre>"); continue;
      }
      if (/^\s*\|.*\|\s*$/.test(ln)) {
        flush(); const rows = [];
        while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(lines[i++]); i--;
        const cells = (r) => r.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
        const body = rows.filter((r) => !/^\s*\|[\s:|-]+\|\s*$/.test(r));
        out.push('<div class="tw"><table>' + body.map((r, k) => "<tr>" + cells(r).map((c) => (k === 0 && body.length < rows.length ? "<th>" : "<td>") + inline(c) + (k === 0 && body.length < rows.length ? "</th>" : "</td>")).join("") + "</tr>").join("") + "</table></div>"); continue;
      }
      if ((m = ln.match(/^\s{0,3}(#{1,6})\s+(.*)$/))) { flush(); out.push("<h" + Math.min(6, m[1].length + 2) + ">" + inline(m[2].replace(/\s+#+\s*$/, "")) + "</h" + Math.min(6, m[1].length + 2) + ">"); continue; }
      if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(ln)) { flush(); out.push("<hr>"); continue; }
      if ((m = ln.match(/^(\s*)([-*+]|\d{1,3}[.)])\s+(.*)$/))) {
        flushP(); const tag = /\d/.test(m[2]) ? "ol" : "ul"; const deep = m[1].length >= 2;
        if (list && list.tag !== tag && !deep) flushL();
        if (!list) list = { tag, items: [] };
        list.items.push({ t: m[3], deep }); continue;
      }
      if (/^\s{0,3}>/.test(ln)) {
        // Líneas de cita seguidas forman una sola cita; una línea «>» vacía separa párrafos.
        flush(); const ps = [[]];
        while (i < lines.length && (m = lines[i].match(/^\s{0,3}>\s?(.*)$/))) { if (m[1].trim()) ps[ps.length - 1].push(m[1]); else ps.push([]); i++; }
        i--;
        out.push("<blockquote>" + ps.filter((x) => x.length).map((x) => "<p>" + x.map(inline).join("<br>") + "</p>").join("") + "</blockquote>"); continue;
      }
      if (!ln.trim()) { flush(); continue; }
      if (list && /^\s{2,}\S/.test(ln)) { list.items[list.items.length - 1].t += " " + ln.trim(); continue; }
      flushL(); para.push(ln);
    }
    flush();
    return out.join("");
  }
  function paint(body, text) { body.classList.add("md"); body.innerHTML = md(text); }

  /* ---------- envío ---------- */
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // Una petición a /api/chat. En modo gobernado ejecuta una etapa del ciclo.
  // Devuelve { cont } si hay más etapas, { done } si hay entrega, o { error, retry }.
  async function step({ governed, messages, token, acc, ui, modules }) {
    let res;
    try {
      res = await fetch("/api/chat", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...(state.viaCode ? { code: codeVal(), turn: state.turn } : { key: el.key.value.trim() }), model: el.model.value, governed, messages, consent: el.consent.checked, sessionId: state.sessionId, state: token || undefined, modules: governed && mods.defs.length ? modules : undefined }),
      });
    } catch { return { error: T("d.err.conn", "No hay conexión con el servidor."), retry: true }; }
    if (!res.ok) {
      let msg = "Error " + res.status;
      // El servidor responde en español con un código de error: se traduce por código y, si no, por frase.
      try { const e = await res.json(); if (e.message) msg = T("err." + e.error, I.phrase(e.message), { n: (String(e.message).match(/\d[\d.]*/) || [""])[0] }); } catch {}
      if (res.status === 429) msg = T("d.err.rate", "Demasiadas peticiones seguidas. Espera un minuto.");
      if (res.status === 402 && state.viaCode) { state.courtesy.remaining = 0; paintCourtesy(); }
      return { error: msg, retry: res.status === 429 || res.status >= 500, wait: res.status === 429 ? 8000 : 0 };
    }
    const left = res.headers.get("x-frome-courtesy");
    if (left !== null && state.viaCode) { state.courtesy.remaining = Number(left) || 0; paintCourtesy(); }
    const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = "";
    let cont = null, done = false, err = null;
    try {
      while (true) {
        const r = await reader.read(); if (r.done) break;
        buf += dec.decode(r.value, { stream: true });
        let i;
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
          const line = chunk.split("\n").find((l) => l.startsWith("data: ")); if (!line) continue;
          let ev; try { ev = JSON.parse(line.slice(6)); } catch { continue; }
          if (ev.type === "frome_continue") cont = ev.state;
          else if (ev.type === "frome_deliver") acc.kind = ev.kind;
          else if (ev.type === "content_block_delta" && ev.delta && ev.delta.type === "text_delta") {
            acc.text += ev.delta.text; ui.body.hidden = false;
            if (!ui.raf) ui.raf = requestAnimationFrame(() => { ui.raf = 0; if (ui.body.classList.contains("streaming")) { paint(ui.body, acc.text); ui.thread.scrollTop = ui.thread.scrollHeight; } });
          } else if (ev.type === "frome_signal") acc.signal = ev.text;
          else if (ev.type === "frome_usage") { acc.usage = ev.usage; done = true; }
          else if (ev.type === "frome_truncated") acc.truncated = true;
          else if (ev.type === "frome_blocked") { acc.held = true; done = true; }
          else if (ev.type === "error") err = { error: I.phrase((ev.error && ev.error.message) || "Error"), retry: Boolean(ev.error && ev.error.retryable) };
        }
      }
    } catch { err = err || { error: T("d.err.cut", "Se ha interrumpido la respuesta."), retry: true }; }
    if (err) return err;
    if (cont) return { cont };
    if (done) return { done: true };
    return { error: T("d.err.late", "La etapa no ha terminado a tiempo."), retry: true };
  }

  async function ask({ governed, messages, thread, label, meta }) {
    const ui = addMsg(thread, "assistant", "", { streaming: true, label });
    const acc = { text: "", signal: "", kind: "answer", held: false, truncated: false, usage: null };
    const t0 = performance.now();
    let token = null, tries = 0;
    const modules = activeModules(); // fijados para toda la respuesta
    for (;;) {
      const r = await step({ governed, messages, token, acc, ui, modules });
      if (r.cont) { token = r.cont; tries = 0; continue; }
      if (r.done) break;
      // Solo se reintenta una etapa del ciclo: su estado anterior sigue siendo válido.
      if (r.retry && governed && !acc.text && tries < 2) { tries++; await sleep(r.wait || 1500 * tries); continue; }
      ui.body.hidden = false; ui.body.classList.remove("streaming"); ui.body.classList.add("error");
      ui.body.textContent = acc.text ? acc.text + "\n\n[" + r.error + "]" : r.error;
      throw new Error(r.error);
    }
    ui.body.hidden = false; ui.body.classList.remove("streaming");
    let text = I.phrase(acc.text); // los textos fijos del servidor se muestran en el idioma elegido
    if (acc.held) {
      // El servidor ha retenido la respuesta: se descarta lo mostrado.
      text = T("d.held", "Respuesta retenida: lo solicitado forma parte de la configuración interna de FromE Chat y no se divulga. Puedes continuar con tu trabajo.");
      ui.body.classList.add("held");
    } else {
      if (acc.truncated) text += "\n\n" + T("d.truncated", "[Respuesta cortada antes de terminar: límite de tiempo o de espacio de salida.]");
      if (acc.kind === "notice") ui.body.classList.add("held");
    }
    if (acc.held || acc.kind === "notice") ui.body.textContent = text; else paint(ui.body, text);
    if (acc.signal && !acc.held) { const sg = document.createElement("span"); sg.className = "signal"; sg.textContent = "⟶ Signal: " + I.fragments(acc.signal); ui.body.appendChild(sg); }
    const secs = ((performance.now() - t0) / 1000).toFixed(1);
    const u = acc.usage;
    meta.textContent = (u ? u.input + " in · " + u.output + " out · " : "") + secs + " s";
    ui.thread.scrollTop = ui.thread.scrollHeight;
    return text;
  }

  async function send(text) {
    if (!canSend() || state.busy || !text.trim()) return;
    state.viaCode = useCourtesy(); state.turn = cryptoId();
    state.busy = true; el.send.disabled = true; el.input.disabled = true;
    if (el.remember.checked && keyOk()) saveKey(el.key.value.trim());
    try { localStorage.setItem("fromechat.model", el.model.value); } catch {}
    el.empty && el.empty.remove(); el.empty = null;
    const cmp = el.compare.checked, gov = el.governed.checked;
    addMsg(el.threadA, "user", text);
    state.history.push({ role: "user", content: text });
    const drop = (h) => { if (h.length && h[h.length - 1].role === "user") h.pop(); };
    const jobs = [ask({ governed: gov, messages: state.history.slice(), thread: el.threadA, label: gov ? T("d.with", "Con From E™") : T("d.without", "Sin arquitectura"), meta: el.metaA })
      .then((t) => state.history.push({ role: "assistant", content: t }), () => drop(state.history))];
    if (cmp) {
      addMsg(el.threadB, "user", text);
      state.historyB.push({ role: "user", content: text });
      jobs.push(ask({ governed: false, messages: state.historyB.slice(), thread: el.threadB, label: T("d.without", "Sin arquitectura"), meta: el.metaB })
        .then((t) => state.historyB.push({ role: "assistant", content: t }), () => drop(state.historyB)));
    }
    try { await Promise.all(jobs); }
    finally { state.busy = false; el.input.disabled = false; refreshKeyState(); el.input.focus(); }
  }

  function reset() {
    if (state.busy) return;
    state.history = []; state.historyB = []; state.sessionId = cryptoId();
    el.threadA.innerHTML = ""; el.threadB.innerHTML = ""; el.metaA.textContent = ""; el.metaB.textContent = "";
    const e = document.createElement("div"); e.className = "empty"; e.innerHTML = '<h3 data-i18n="d.reset.h">Nueva conversación.</h3><p data-i18n="d.reset.p">El hilo anterior se ha descartado de tu navegador. No queda guardado en ningún sitio.</p>';
    el.threadA.appendChild(e); el.empty = e; I.apply(e);
    syncToggles();
  }

  /* ---------- eventos ---------- */
  el.key.addEventListener("input", refreshKeyState);
  el.code.addEventListener("input", () => { clearTimeout(codeTimer); codeTimer = setTimeout(checkCode, 500); });
  el.eye.addEventListener("click", () => { el.key.type = el.key.type === "password" ? "text" : "password"; });
  el.remember.addEventListener("change", () => { if (el.remember.checked) { if (keyOk()) saveKey(el.key.value.trim()); } else forgetKey(); syncToggles(); });
  [el.governed, el.compare, el.consent].forEach((c) => c.addEventListener("change", syncToggles));
  el.cmpOff.addEventListener("click", () => { el.compare.checked = false; syncToggles(); });
  el.newBtn.addEventListener("click", reset);
  el.form.addEventListener("submit", (e) => { e.preventDefault(); const t = el.input.value; el.input.value = ""; autosize(); send(t); });
  el.input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); el.form.requestSubmit(); } });
  el.input.addEventListener("input", autosize);
  document.addEventListener("click", (e) => { const b = e.target.closest("[data-ex]"); if (b) { el.input.value = b.getAttribute("data-ex"); autosize(); el.input.focus(); el.input.setSelectionRange(el.input.value.length, el.input.value.length); } });
  function autosize() { el.input.style.height = "auto"; el.input.style.height = Math.min(220, el.input.scrollHeight) + "px"; }

  // Al cambiar de idioma se repinta lo que este archivo ha escrito. La conversación no se toca.
  I.onChange(() => {
    if (mods.data) buildModules(mods.data, true);
    syncToggles(); refreshKeyState();
    const n = state.courtesy.note || []; paintCourtesy(n[0], n[1], n[2]);
  });

  /* ---------- arranque ---------- */
  (async () => {
    await loadModels();
    const k = await loadKey();
    if (k) { el.key.value = k; el.remember.checked = true; }
    syncToggles(); refreshKeyState(); autosize();
    if (state.courtesy.enabled && codeVal()) checkCode();
  })();
})();
