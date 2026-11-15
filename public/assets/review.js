// Revisión privada de sesiones aportadas. La contraseña vive solo en esta pestaña
// (sessionStorage) y viaja en una cabecera, nunca en la URL.
(() => {
  const $ = (id) => document.getElementById(id);
  const el = {
    gate: $("gate"), gateForm: $("gate-form"), token: $("token"), gateState: $("gate-state"),
    board: $("board"), list: $("list"), count: $("count"), empty: $("empty"), more: $("btn-more"),
    fPending: $("f-pending"), fFail: $("f-fail"), exportBtn: $("btn-export"), exportBox: $("export-box"), exportText: $("export-text"), out: $("btn-out"),
  };
  const state = { token: "", turns: [], next: null, total: 0, modules: [] };
  const LABEL = { "from-e": "Con From E™", baseline: "Sin arquitectura", "public-info": "Ruta pública" };

  function node(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  async function api(query = "", opts = {}) {
    const res = await fetch("/api/review" + query, {
      ...opts,
      headers: { "x-review-token": state.token, ...(opts.body ? { "content-type": "application/json" } : {}) },
    });
    if (res.status === 404) throw new Error("gate");
    if (!res.ok) throw new Error("http " + res.status);
    return res.json();
  }

  // Un grupo es un mensaje del usuario con sus respuestas (gobernada y, si la hay, directa).
  function groups() {
    const map = new Map();
    for (const t of state.turns) {
      const users = t.messages.filter((m) => m.role === "user");
      const last = users[users.length - 1]?.content || "";
      const id = [t.sessionId, users.length, last.slice(0, 120)].join("#");
      if (!map.has(id)) map.set(id, { id, ts: t.ts, sessionId: t.sessionId, question: last, history: t.messages.slice(0, -1), turns: [] });
      const g = map.get(id);
      g.turns.push(t);
      if (t.ts > g.ts) g.ts = t.ts;
    }
    return [...map.values()].sort((a, b) => (a.ts < b.ts ? 1 : -1));
  }

  function reviewForm(turn) {
    const box = node("div", "rv-form");
    const r = turn.review || {};
    const verdict = node("div", "rv-verdict");
    let current = r.verdict || null;
    const mk = (value, label) => {
      const b = node("button", "btn secondary", label);
      b.type = "button";
      b.setAttribute("aria-pressed", String(current === value));
      b.addEventListener("click", () => {
        current = current === value ? null : value;
        for (const x of verdict.querySelectorAll("button")) x.setAttribute("aria-pressed", String(x === b && current === value));
      });
      return b;
    };
    verdict.append(mk("bien", "Está bien"), mk("falla", "Falla"));

    const sel = node("select");
    sel.setAttribute("aria-label", "Módulo al que corresponde");
    sel.append(new Option("Módulo al que corresponde (opcional)", ""));
    for (const m of state.modules) sel.append(new Option(m.label, m.id));
    sel.append(new Option("Ninguno de los actuales", "nuevo"));
    sel.value = r.module || "";

    const failure = node("textarea");
    failure.rows = 2;
    failure.placeholder = "Qué hizo mal el modelo aquí, en una línea (opcional)";
    failure.value = r.failure || "";
    const correction = node("textarea");
    correction.rows = 4;
    correction.placeholder = "Lo que le habrías dicho en este punto, con tus palabras";
    correction.value = r.correction || "";

    const row = node("div", "rv-save");
    const save = node("button", "btn", "Guardar");
    save.type = "button";
    const status = node("span", "state", r.ts ? "Guardado el " + new Date(r.ts).toLocaleString("es-ES") : "");
    save.addEventListener("click", async () => {
      save.disabled = true;
      status.textContent = "Guardando…";
      try {
        const res = await api("", { method: "POST", body: JSON.stringify({ key: turn.key, verdict: current, module: sel.value, failure: failure.value, correction: correction.value }) });
        turn.review = res.review;
        status.textContent = res.review ? "Guardado" : "Sin revisión";
      } catch {
        status.textContent = "No se ha podido guardar. Vuelve a intentarlo.";
      }
      save.disabled = false;
    });
    row.append(save, status);
    box.append(verdict, sel, failure, correction, row);
    return box;
  }

  function card(g) {
    const c = node("article", "rv-card");
    const head = node("div", "rv-meta");
    const first = g.turns[0];
    head.append(
      node("span", "", new Date(g.ts).toLocaleString("es-ES")),
      node("span", "", first.model || ""),
      node("span", "", "sesión " + String(g.sessionId).slice(0, 8))
    );
    c.append(head);

    if (g.history.length) {
      const d = node("details", "rv-history");
      d.append(node("summary", "", `Conversación anterior (${g.history.length} mensajes)`));
      for (const m of g.history) {
        const p = node("p", "rv-line");
        p.append(node("b", "", m.role === "user" ? "Usuario: " : "Respuesta: "), document.createTextNode(m.content));
        d.append(p);
      }
      c.append(d);
    }
    const q = node("div", "rv-question");
    q.append(node("small", "", "Mensaje"), node("p", "", g.question));
    c.append(q);

    const order = { "from-e": 0, "public-info": 1, baseline: 2 };
    const cols = node("div", "rv-cols" + (g.turns.length > 1 ? " two" : ""));
    for (const t of g.turns.sort((a, b) => (order[a.condition] ?? 9) - (order[b.condition] ?? 9))) {
      const col = node("div", "rv-col");
      col.append(node("h4", "", LABEL[t.condition] || t.condition));
      const bits = [];
      const name = (id) => state.modules.find((m) => m.id === id)?.label || id;
      if (t.modules) bits.push("módulos: " + (t.modules.length ? t.modules.map(name).join(", ") : "ninguno"));
      if (t.signal) bits.push(t.signal);
      if (t.withheld) bits.push("respuesta retenida");
      if (bits.length) col.append(node("p", "state", bits.join(" · ")));
      col.append(node("div", "rv-answer", t.assistant));
      if (t.condition !== "baseline" || g.turns.length === 1) col.append(reviewForm(t));
      cols.append(col);
    }
    c.append(cols);
    return c;
  }

  function paint() {
    el.list.replaceChildren();
    let gs = groups();
    const reviewed = (g) => g.turns.some((t) => t.review);
    if (el.fPending.checked) gs = gs.filter((g) => !reviewed(g));
    if (el.fFail.checked) gs = gs.filter((g) => g.turns.some((t) => t.review?.verdict === "falla"));
    for (const g of gs) el.list.append(card(g));
    el.count.textContent = `${state.total} turnos aportados · ${groups().length} mensajes cargados`;
    el.empty.hidden = state.total > 0;
    el.more.hidden = !state.next;
  }

  async function load(more = false) {
    const data = await api(more && state.next ? "?before=" + encodeURIComponent(state.next) : "");
    state.turns = more ? state.turns.concat(data.turns) : data.turns;
    state.next = data.next;
    state.total = data.total;
    paint();
  }

  async function enter(token) {
    state.token = token;
    el.gateState.textContent = "Comprobando…";
    try {
      try {
        const m = await (await fetch("/api/models")).json();
        state.modules = m.modules || [];
      } catch {}
      await load();
      try { sessionStorage.setItem("fromechat.review", token); } catch {}
      el.gate.hidden = true;
      el.board.hidden = false;
      el.exportBtn.hidden = false;
      el.out.hidden = false;
    } catch (e) {
      state.token = "";
      el.gateState.textContent = e.message === "gate" ? "Contraseña incorrecta, o la revisión no está activada en este sitio." : "No se ha podido cargar. Vuelve a intentarlo.";
    }
  }

  el.gateForm.addEventListener("submit", (ev) => {
    ev.preventDefault();
    const t = el.token.value.trim();
    if (t) enter(t);
  });
  el.more.addEventListener("click", () => load(true).catch(() => {}));
  el.fPending.addEventListener("change", paint);
  el.fFail.addEventListener("change", paint);
  el.out.addEventListener("click", () => {
    try { sessionStorage.removeItem("fromechat.review"); } catch {}
    location.reload();
  });
  el.exportBtn.addEventListener("click", async () => {
    try {
      const data = await api("?export=1");
      const lines = [`CORRECCIONES FromE Chat · ${data.count}`];
      data.items.forEach((it, i) => {
        lines.push("", `[${i + 1}] módulo: ${it.module || "sin asignar"} · veredicto: ${it.verdict || "sin marcar"} · turno: ${it.turn}`);
        if (it.failure) lines.push("Qué falló: " + it.failure);
        if (it.correction) lines.push("Mi corrección: " + it.correction);
      });
      el.exportText.value = lines.join("\n");
      el.exportBox.hidden = false;
      try { await navigator.clipboard.writeText(el.exportText.value); } catch { el.exportText.select(); }
    } catch {}
  });

  let saved = "";
  try { saved = sessionStorage.getItem("fromechat.review") || ""; } catch {}
  if (saved) enter(saved);
})();
