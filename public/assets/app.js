/* FromE Chat — cliente. Sin dependencias. La conversación vive en memoria del
   navegador; la clave, en memoria de sesión o cifrada en localStorage si el
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
    form: $("composer"), input: $("input"), send: $("btn-send"), hintR: $("hint-right"), newBtn: $("btn-new"),
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
      el.pillGov.innerHTML = '<span class="dot"></span> From E™ activa · ' + d.openCoreModules + " módulos";
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
    el.pillGov.innerHTML = gov ? '<span class="dot"></span> From E™ activa · 7 módulos' : '<span class="dot"></span> Sin arquitectura';
    el.headA.textContent = gov ? "From E™ Open Core" : "Sin arquitectura";
    el.hintR.textContent = cmp ? "Coste: ×2 tokens por mensaje" : "";
    el.hintR.className = cmp ? "cost" : "";
  }

  /* ---------- render ---------- */
  function addMsg(thread, role, text, opts = {}) {
    const m = document.createElement("div"); m.className = "msg " + role;
    const who = document.createElement("div"); who.className = "who"; who.textContent = role === "user" ? "Tú" : (opts.label || "Modelo");
    const body = document.createElement("div"); body.className = "body" + (opts.streaming ? " streaming" : "") + (opts.error ? " error" : "");
    body.textContent = text;
    m.appendChild(who); m.appendChild(body); thread.appendChild(body.parentNode);
    thread.scrollTop = thread.scrollHeight;
    return body;
  }
  function finalize(body, text) {
    body.classList.remove("streaming");
    // Separa la línea de señal del Signal System™, si existe, para mostrarla aparte.
    const m = text.match(/\n?(⟶ Signal:[^\n]*)\s*$/);
    if (m) {
      body.textContent = text.slice(0, m.index).replace(/\s+$/, "");
      const s = document.createElement("span"); s.className = "signal"; s.textContent = m[1];
      body.appendChild(s);
    } else body.textContent = text;
  }

  /* ---------- envío ---------- */
  async function streamOne({ governed, messages, thread, label, meta }) {
    const body = addMsg(thread, "assistant", "", { streaming: true, label });
    const t0 = performance.now();
    let text = "", inTok = null, outTok = null, held = false;
    const res = await fetch("/api/chat", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ key: el.key.value.trim(), model: el.model.value, governed, messages, consent: el.consent.checked, sessionId: state.sessionId }),
    });
    if (!res.ok) {
      let msg = "Error " + res.status;
      try { const e = await res.json(); if (e.message) msg = e.message; } catch {}
      body.classList.remove("streaming"); body.classList.add("error"); body.textContent = msg;
      throw new Error(msg);
    }
    const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = "";
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
        const line = chunk.split("\n").find((l) => l.startsWith("data: ")); if (!line) continue;
        try {
          const ev = JSON.parse(line.slice(6));
          if (ev.type === "content_block_delta" && ev.delta && ev.delta.type === "text_delta") { text += ev.delta.text; body.textContent = text; thread.scrollTop = thread.scrollHeight; }
          if (ev.type === "message_start" && ev.message && ev.message.usage) inTok = ev.message.usage.input_tokens + (ev.message.usage.cache_read_input_tokens || 0) + (ev.message.usage.cache_creation_input_tokens || 0);
          if (ev.type === "message_delta" && ev.usage) outTok = ev.usage.output_tokens;
          if (ev.type === "frome_blocked") { held = true; }
          if (ev.type === "error") throw new Error(ev.error && ev.error.message || "error");
        } catch (e) { if (e.message !== "error" && !(e instanceof SyntaxError)) throw e; }
      }
    }
    if (held) {
      // El servidor ha retenido la respuesta: se descarta lo mostrado.
      text = "Respuesta retenida: lo solicitado forma parte de la configuración interna de FromE Chat y no se divulga. Puedes continuar con tu trabajo.";
      body.classList.remove("streaming"); body.classList.add("held"); body.textContent = text;
    } else finalize(body, text);
    const secs = ((performance.now() - t0) / 1000).toFixed(1);
    meta.textContent = (inTok != null ? inTok + " in · " : "") + (outTok != null ? outTok + " out · " : "") + secs + " s";
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
    const jobs = [streamOne({ governed: gov, messages: state.history, thread: el.threadA, label: gov ? "From E™ Open Core" : "Sin arquitectura", meta: el.metaA })
      .then((t) => state.history.push({ role: "assistant", content: t }))];
    if (cmp) {
      addMsg(el.threadB, "user", text);
      state.historyB.push({ role: "user", content: text });
      jobs.push(streamOne({ governed: false, messages: state.historyB, thread: el.threadB, label: "Sin arquitectura", meta: el.metaB })
        .then((t) => state.historyB.push({ role: "assistant", content: t })));
    }
    try { await Promise.all(jobs); }
    catch { /* el error ya está pintado en el hilo */ state.history = state.history.filter((m, i, a) => !(i === a.length - 1 && m.role === "user")); state.historyB = state.historyB.filter((m, i, a) => !(i === a.length - 1 && m.role === "user")); }
    finally { state.busy = false; el.input.disabled = false; refreshKeyState(); el.input.focus(); }
  }

  function reset() {
    state.history = []; state.historyB = []; state.sessionId = cryptoId();
    el.threadA.innerHTML = ""; el.threadB.innerHTML = ""; el.metaA.textContent = ""; el.metaB.textContent = "";
    const e = document.createElement("div"); e.className = "empty"; e.innerHTML = "<h3>Nueva conversación.</h3><p>El hilo anterior se ha descartado de tu navegador. La arquitectura sigue activa.</p>";
    el.threadA.appendChild(e); el.empty = e;
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
