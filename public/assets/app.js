/* FromE Chat — cliente. Sin dependencias. La conversación vive en memoria del
   navegador y no se guarda; la clave, en memoria de sesión o cifrada en localStorage si el
   usuario lo pide. Nada de esto se envía a ningún sitio salvo /api/chat. */
(function () {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const el = {
    key: $("key"), eye: $("btn-eye"), remember: $("remember"), keyState: $("key-state"),
    model: $("model"), governed: $("governed"), compare: $("compare"), consent: $("consent"),
    tGov: $("t-governed"), tCmp: $("t-compare"), tCon: $("t-consent"), tRem: $("t-remember"),
    pillGov: $("pill-gov"), banner: $("banner"), cmpOff: $("btn-compare-off"),
    panes: $("panes"), paneB: $("pane-b"), threadA: $("thread-a"), threadB: $("thread-b"),
    headA: $("head-a"), metaA: $("meta-a"), metaB: $("meta-b"), empty: $("empty"),
    form: $("composer"), input: $("input"), send: $("btn-send"), hintR: $("hint-right"), newBtn: $("btn-new"), sid: $("sid"),
  };

  /* ---------- estado ---------- */
  const state = {
    history: [],          // [{role, content}] del hilo gobernado (o único)
    historyB: [],         // hilo sin arquitectura (comparador)
    busy: false,
    sessionId: cryptoId(),
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
    if (!v) { el.keyState.textContent = "Sin clave. Pégala para empezar."; el.keyState.style.color = ""; }
    else if (keyOk()) { el.keyState.textContent = "Clave con formato válido. Se comprobará en el primer mensaje."; el.keyState.style.color = "var(--ok)"; }
    else { el.keyState.textContent = "Formato no reconocido: una clave de API de Anthropic empieza por sk-ant-."; el.keyState.style.color = "var(--warn)"; }
    el.send.disabled = !keyOk() || state.busy;
  }

  /* ---------- modelos ---------- */
  async function loadModels() {
    try {
      const r = await fetch("/api/models"); const d = await r.json();
      el.model.innerHTML = "";
      for (const m of d.models) { const o = document.createElement("option"); o.value = m.id; o.textContent = m.label; el.model.appendChild(o); }
      try { const saved = localStorage.getItem("fromechat.model"); if (saved && d.models.some((m) => m.id === saved)) el.model.value = saved; } catch {}
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
    el.pillGov.innerHTML = gov ? '<span class="dot"></span> From E™ activa · ciclo por etapas' : '<span class="dot"></span> Sin arquitectura';
    el.headA.textContent = gov ? "Con From E™" : "Sin arquitectura";
    el.hintR.textContent = gov ? (cmp ? "Coste por mensaje: el ciclo de From E™ más una llamada directa" : "Coste por mensaje: el ciclo de From E™, varias llamadas") : "";
    el.hintR.className = gov ? "cost" : "";
    el.sid.hidden = !el.consent.checked;
    el.sid.textContent = "Identificador de esta sesión: " + state.sessionId;
  }

  /* ---------- render ---------- */
  function addMsg(thread, role, text, opts = {}) {
    const m = document.createElement("div"); m.className = "msg " + role;
    const who = document.createElement("div"); who.className = "who"; who.textContent = role === "user" ? "Tú" : (opts.label || "Modelo");
    m.appendChild(who);
    let trace = null;
    if (opts.trace) { trace = document.createElement("ol"); trace.className = "trace"; m.appendChild(trace); }
    const body = document.createElement("div"); body.className = "body" + (opts.streaming ? " streaming" : "");
    body.textContent = text;
    m.appendChild(body); thread.appendChild(m);
    thread.scrollTop = thread.scrollHeight;
    return { body, trace, thread };
  }

  // Traza del ciclo: una fila por etapa, con su estado y su nota.
  function traceRow(ui, id, label, detail) {
    if (!ui.trace) return;
    const last = ui.trace.lastElementChild;
    if (last && last.dataset.id === id && last.classList.contains("run")) return; // reintento de la misma etapa
    const li = document.createElement("li"); li.className = "run"; li.dataset.id = id;
    const b = document.createElement("b"); b.textContent = label || id; li.appendChild(b);
    if (detail) { const d = document.createElement("span"); d.textContent = detail; li.appendChild(d); }
    ui.trace.appendChild(li); ui.thread.scrollTop = ui.thread.scrollHeight;
  }
  function traceDone(ui, id, note, cls) {
    if (!ui.trace) return;
    const last = ui.trace.lastElementChild;
    if (!last || last.dataset.id !== id) return;
    last.className = cls || "ok";
    if (note) { const n = document.createElement("em"); n.textContent = note; last.appendChild(n); }
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
      if ((m = ln.match(/^\s{0,3}>\s?(.*)$/))) { flush(); out.push("<blockquote>" + inline(m[1] || "") + "</blockquote>"); continue; }
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
  async function step({ governed, messages, token, acc, ui }) {
    let res;
    try {
      res = await fetch("/api/chat", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: el.key.value.trim(), model: el.model.value, governed, messages, consent: el.consent.checked, sessionId: state.sessionId, state: token || undefined }),
      });
    } catch { return { error: "No hay conexión con el servidor.", retry: true }; }
    if (!res.ok) {
      let msg = "Error " + res.status;
      try { const e = await res.json(); if (e.message) msg = e.message; } catch {}
      if (res.status === 429) msg = "Demasiadas peticiones seguidas. Espera un minuto.";
      return { error: msg, retry: res.status === 429 || res.status >= 500, wait: res.status === 429 ? 8000 : 0 };
    }
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
          if (ev.type === "frome_route") {
            if (!acc.route) { acc.route = ev.route; if (governed) traceDone(ui, "gate", ev.route === "public" ? "ruta pública" : ""); }
          } else if (ev.type === "frome_stage") {
            if (ev.status === "running") traceRow(ui, ev.id, ev.label, ev.detail); else traceDone(ui, ev.id, ev.note);
          } else if (ev.type === "frome_continue") cont = ev.state;
          else if (ev.type === "frome_deliver") acc.kind = ev.kind;
          else if (ev.type === "content_block_delta" && ev.delta && ev.delta.type === "text_delta") {
            acc.text += ev.delta.text; ui.body.hidden = false;
            if (!ui.raf) ui.raf = requestAnimationFrame(() => { ui.raf = 0; if (ui.body.classList.contains("streaming")) { paint(ui.body, acc.text); ui.thread.scrollTop = ui.thread.scrollHeight; } });
          } else if (ev.type === "frome_signal") acc.signal = ev.text;
          else if (ev.type === "frome_usage") { acc.usage = ev.usage; done = true; }
          else if (ev.type === "frome_truncated") acc.truncated = true;
          else if (ev.type === "frome_blocked") { acc.held = true; done = true; }
          else if (ev.type === "error") err = { error: (ev.error && ev.error.message) || "Error", retry: Boolean(ev.error && ev.error.retryable) };
        }
      }
    } catch { err = err || { error: "Se ha interrumpido la respuesta.", retry: true }; }
    if (err) return err;
    if (cont) return { cont };
    if (done) return { done: true };
    return { error: "La etapa no ha terminado a tiempo.", retry: true };
  }

  async function ask({ governed, messages, thread, label, meta }) {
    const ui = addMsg(thread, "assistant", "", { streaming: true, label, trace: governed });
    const acc = { text: "", signal: "", kind: "answer", held: false, truncated: false, usage: null, route: null };
    const t0 = performance.now();
    if (governed) { ui.body.hidden = true; traceRow(ui, "gate", "Comprobación de entrada", ""); }
    let token = null, tries = 0;
    for (;;) {
      const r = await step({ governed, messages, token, acc, ui });
      if (r.cont) { token = r.cont; tries = 0; continue; }
      if (r.done) break;
      // Solo se reintenta una etapa del ciclo: su estado anterior sigue siendo válido.
      if (r.retry && governed && !acc.text && tries < 2) { tries++; await sleep(r.wait || 1500 * tries); continue; }
      if (ui.trace && ui.trace.lastElementChild) ui.trace.lastElementChild.className = "fail";
      ui.body.hidden = false; ui.body.classList.remove("streaming"); ui.body.classList.add("error");
      ui.body.textContent = acc.text ? acc.text + "\n\n[" + r.error + "]" : r.error;
      throw new Error(r.error);
    }
    ui.body.hidden = false; ui.body.classList.remove("streaming");
    let text = acc.text;
    if (acc.held) {
      // El servidor ha retenido la respuesta: se descarta lo mostrado.
      text = "Respuesta retenida: lo solicitado forma parte de la configuración interna de FromE Chat y no se divulga. Puedes continuar con tu trabajo.";
      ui.body.classList.add("held");
    } else {
      if (acc.truncated) text += "\n\n[Respuesta cortada por el límite de tiempo de la plataforma.]";
      if (acc.kind === "notice") ui.body.classList.add("held");
    }
    if (acc.held || acc.kind === "notice") ui.body.textContent = text; else paint(ui.body, text);
    if (acc.signal && !acc.held) { const sg = document.createElement("span"); sg.className = "signal"; sg.textContent = "⟶ Signal: " + acc.signal; ui.body.appendChild(sg); }
    const secs = ((performance.now() - t0) / 1000).toFixed(1);
    const u = acc.usage;
    meta.textContent = (u ? u.calls + (u.calls === 1 ? " llamada · " : " llamadas · ") + u.input + " in · " + u.output + " out · " : "") + secs + " s";
    ui.thread.scrollTop = ui.thread.scrollHeight;
    return text;
  }

  async function send(text) {
    if (!keyOk() || state.busy || !text.trim()) return;
    state.busy = true; el.send.disabled = true; el.input.disabled = true;
    if (el.remember.checked) saveKey(el.key.value.trim());
    try { localStorage.setItem("fromechat.model", el.model.value); } catch {}
    el.empty && el.empty.remove(); el.empty = null;
    const cmp = el.compare.checked, gov = el.governed.checked;
    addMsg(el.threadA, "user", text);
    state.history.push({ role: "user", content: text });
    const drop = (h) => { if (h.length && h[h.length - 1].role === "user") h.pop(); };
    const jobs = [ask({ governed: gov, messages: state.history.slice(), thread: el.threadA, label: gov ? "Con From E™" : "Sin arquitectura", meta: el.metaA })
      .then((t) => state.history.push({ role: "assistant", content: t }), () => drop(state.history))];
    if (cmp) {
      addMsg(el.threadB, "user", text);
      state.historyB.push({ role: "user", content: text });
      jobs.push(ask({ governed: false, messages: state.historyB.slice(), thread: el.threadB, label: "Sin arquitectura", meta: el.metaB })
        .then((t) => state.historyB.push({ role: "assistant", content: t }), () => drop(state.historyB)));
    }
    try { await Promise.all(jobs); }
    finally { state.busy = false; el.input.disabled = false; refreshKeyState(); el.input.focus(); }
  }

  function reset() {
    if (state.busy) return;
    state.history = []; state.historyB = []; state.sessionId = cryptoId();
    el.threadA.innerHTML = ""; el.threadB.innerHTML = ""; el.metaA.textContent = ""; el.metaB.textContent = "";
    const e = document.createElement("div"); e.className = "empty"; e.innerHTML = "<h3>Nueva conversación.</h3><p>El hilo anterior se ha descartado de tu navegador. No queda guardado en ningún sitio.</p>";
    el.threadA.appendChild(e); el.empty = e;
    syncToggles();
  }

  /* ---------- eventos ---------- */
  el.key.addEventListener("input", refreshKeyState);
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

  /* ---------- arranque ---------- */
  (async () => {
    await loadModels();
    const k = await loadKey();
    if (k) { el.key.value = k; el.remember.checked = true; }
    syncToggles(); refreshKeyState(); autosize();
  })();
})();
