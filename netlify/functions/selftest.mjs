// Entrada de pruebas. Permite lanzar un caso (mensaje + módulos) y leer las dos
// respuestas, la gobernada y la directa, sin pasar por la interfaz.
//
// Solo existe donde se cumple todo esto:
//   - el despliegue es una vista previa o una rama, nunca producción;
//   - están definidas las variables SELFTEST_KEY (clave de API de quien prueba) y
//     SELFTEST_TOKEN (contraseña de esta entrada);
//   - la petición trae esa contraseña.
// En cualquier otro caso responde 404, como si no existiera.

import { createHash, timingSafeEqual } from "node:crypto";
import { getStore } from "@netlify/blobs";
import { loadGovernance, PUBLIC_SYSTEM, UNGOVERNED_SYSTEM } from "./lib/governance.mjs";
import { pickModules, newState } from "./lib/engine.mjs";
import { stepCycle } from "./lib/cycle.mjs";
import { seal, unseal } from "./lib/seal.mjs";
import { callModel } from "./lib/anthropic.mjs";
import { gate } from "./lib/gate.mjs";
import { MODELS } from "./chat.mjs";

const BUDGET_MS = Number(process.env.SELFTEST_BUDGET_MS) || 52000;
const MIN_START_MS = 25000; // no se empieza una llamada con menos tiempo que este
const DAILY_CAP = Number(process.env.SELFTEST_DAILY_CAP) || 80;
const MAX_OUTPUT = 3000;
const gone = () => new Response("Not found", { status: 404 });

function previewHost(host) {
  return /^deploy-preview-\d+--/.test(host) || (host.includes("--") && host.endsWith(".netlify.app")) || /^(localhost|127\.0\.0\.1)(:|$)/.test(host);
}

function sameToken(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && x.length >= 24 && timingSafeEqual(x, y);
}

// Tope diario: evita que un descuido gaste la clave de pruebas.
async function underCap() {
  try {
    const store = getStore({ name: "selftest", consistency: "strong" });
    const day = new Date().toISOString().slice(0, 10);
    const n = Number((await store.get(day)) || 0);
    if (n >= DAILY_CAP) return false;
    await store.set(day, String(n + 1));
  } catch {}
  return true;
}

const line = (u) => `${u.calls ?? 1} llamadas · ${u.input} in · ${u.output} out`;

// Un caso es un trabajo reanudable. Una respuesta gobernada completa no cabe en una
// sola ejecución de la plataforma, así que cada petición avanza lo que le da tiempo,
// guarda el estado sellado y la siguiente continúa donde quedó.
const mem = new Map(); // reserva si el almacén no está disponible
const jobStore = () => getStore({ name: "selftest", consistency: "strong" });
async function loadJob(g, id) {
  try {
    const raw = await jobStore().get("job-" + id);
    return raw ? unseal(g.sealKey, raw) : null;
  } catch {
    return mem.get(id) || null;
  }
}
async function saveJob(g, id, job) {
  try {
    await jobStore().set("job-" + id, seal(g.sealKey, job));
  } catch {
    mem.set(id, job);
  }
}
const finished = (job) => (!job.gov || Boolean(job.gov.out)) && (!job.base || Boolean(job.base.out));

// Producción se reconoce por el contexto del despliegue; si la plataforma no lo da,
// por el nombre del host. Además, la clave solo tiene valor en vistas previas.
function isProduction(host, context) {
  const ctx = context?.deploy?.context;
  if (ctx) return ctx === "production";
  return !previewHost(host);
}

export default async (req, context) => {
  const url = new URL(req.url);
  // Los parámetros pueden venir en la consulta o en la ruta, porque algunos lectores
  // no conservan la consulta:
  //   /api/selftest/status[/<contraseña>]
  //   /api/selftest/<contraseña>/<id>/<módulos>/<pregunta en base64url>[/<modelo>[/<lado>]]
  // En la ruta, los módulos van separados por punto; «todos» usa los de por defecto y
  // «ninguno» no activa ninguno.
  const seg = url.pathname.replace(/^\/api\/selftest\/?/, "").split("/").filter(Boolean);
  const fromPath = {};
  if (seg[0] === "status") { fromPath.status = "1"; if (seg[1]) fromPath.t = seg[1]; }
  else if (seg.length) {
    [fromPath.t, fromPath.id, fromPath.m, fromPath.q, fromPath.model, fromPath.side] = seg;
    if (fromPath.m === "todos") delete fromPath.m;
    else if (fromPath.m === "ninguno") fromPath.m = "";
    else if (fromPath.m) fromPath.m = fromPath.m.replace(/\./g, ",");
    try { fromPath.q = fromPath.q ? Buffer.from(fromPath.q, "base64url").toString("utf8") : ""; } catch { fromPath.q = ""; }
  }
  const param = (name) => (fromPath[name] !== undefined ? fromPath[name] : url.searchParams.get(name));
  const key = (process.env.SELFTEST_KEY || "").trim();
  const token = (process.env.SELFTEST_TOKEN || "").trim();
  const prod = isProduction(url.host, context);
  // Diagnóstico sin secretos: solo dice qué condiciones se cumplen.
  if (param("status") === "1") {
    const given = param("t") || "";
    const info = `selftest · método: ${req.method} · consulta recibida: ${url.search ? "sí" : "no"} · contexto: ${context?.deploy?.context || "desconocido"} · host: ${url.host} · producción: ${prod ? "sí" : "no"} · clave definida: ${key ? "sí" : "no"} · contraseña definida: ${token ? "sí (" + token.length + " caracteres)" : "no"} · contraseña recibida: ${given ? (token && sameToken(given, token) ? "coincide" : "no coincide (" + given.length + " caracteres)") : "ninguna"}`;
    const json = param("fmt") === "json";
    return new Response(json ? JSON.stringify({ status: info }) : info, {
      status: 200,
      headers: { "content-type": json ? "application/json; charset=utf-8" : "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  }
  const allowed = Boolean(key && token && !prod && sameToken(param("t") || "", token));
  // Algunos lectores preguntan antes con HEAD: se contesta sin ejecutar nada.
  if (req.method === "HEAD" && allowed) return new Response(null, { status: 200, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
  if (req.method !== "GET" || !allowed) return gone();

  const q = (param("q") || "").slice(0, 8000).trim();
  if (!q) return new Response("Falta q", { status: 400 });
  const t0 = Date.now();
  const deadline = t0 + BUDGET_MS;
  const g = loadGovernance();
  const model = MODELS[param("model")] ? param("model") : "claude-opus-5-5";
  const mParam = param("m") ?? null;
  const modules = pickModules(g.pipeline, mParam === null ? undefined : mParam.split(",").map((x) => x.trim()).filter(Boolean));
  const side = ["gov", "base"].includes(param("side")) ? param("side") : "both";
  const messages = [{ role: "user", content: q }];
  const jobId = createHash("sha256").update([param("id") || "", model, modules.join(","), side, q].join("\n")).digest("hex").slice(0, 32);

  let job = await loadJob(g, jobId);
  if (!job) {
    if (!(await underCap())) return new Response("Tope diario de pruebas alcanzado.", { status: 429 });
    job = {
      v: 1,
      lease: 0,
      gov: side === "base" ? null : { gate: false, gateUsage: null, route: null, st: null, stages: [], out: null, ms: 0, retries: 0 },
      base: side === "gov" ? null : { out: null, ms: 0, retries: 0 },
    };
  }

  let chain = Promise.resolve();
  const save = () => (chain = chain.then(() => saveJob(g, jobId, job)));
  const left = () => deadline - Date.now();

  const advanceBase = async () => {
    const B = job.base;
    if (left() < MIN_START_MS) return;
    const s = Date.now();
    const r = await callModel({ key, model, system: UNGOVERNED_SYSTEM, messages, maxTokens: MAX_OUTPUT, deadline });
    B.ms += Date.now() - s;
    if (r.ok) B.out = { text: r.text, usage: { ...r.usage, calls: 1 }, truncated: r.truncated };
    else if (r.retryable && B.retries < 2) B.retries += 1;
    else B.out = { error: r.message };
    await save();
  };

  const advanceGov = async () => {
    const G = job.gov;
    let mark = Date.now();
    const clock = () => { G.ms += Date.now() - mark; mark = Date.now(); };
    try {
      if (!G.gate) {
        const verdict = await gate({ key, messages });
        G.gate = true;
        G.gateUsage = verdict.usage || null;
        if (verdict.auth === false) { G.out = { error: "Clave rechazada por el proveedor." }; return; }
        G.route = verdict.probe ? "public" : "governed";
        await save();
      }
      if (G.route === "public") {
        if (left() < MIN_START_MS) return;
        const r = await callModel({ key, model, system: PUBLIC_SYSTEM, messages, maxTokens: MAX_OUTPUT, deadline });
        if (r.ok) G.out = { text: r.text, signal: "Límite de divulgación", usage: { ...r.usage, calls: 1 }, truncated: r.truncated };
        else if (r.retryable && G.retries < 2) G.retries += 1;
        else G.out = { error: r.message };
        return;
      }
      if (!G.st) G.st = newState(g.pipeline, { bind: "selftest", ttl: 0, modules });
      while (left() >= MIN_START_MS) {
        const res = await stepCycle({ g, key, model, messages, st: G.st, stages: G.stages, deadline });
        if (res?.error && res.retryable && G.retries < 3) { G.retries += 1; continue; }
        if (res) { G.out = { ...res, usage: { ...G.st.usage } }; return; }
        clock();
        await save();
      }
    } finally {
      clock();
      await save();
    }
  };

  if (!finished(job) && job.lease < Date.now()) {
    job.lease = deadline + 4000;
    await save();
    const work = Promise.all([job.gov && !job.gov.out ? advanceGov() : null, job.base && !job.base.out ? advanceBase() : null])
      .catch(() => {})
      .then(() => { job.lease = 0; return save(); });
    // Si la plataforma lo permite, se responde ya y el trabajo sigue; si no, se espera.
    if (typeof context?.waitUntil === "function") context.waitUntil(work);
    else await work;
  }

  const labels = modules.map((m) => g.pipeline.modules?.[m]?.label || m);
  const out = [`PRUEBA ${param("id") || "-"} · ${model} · módulos: ${labels.join(", ") || "ninguno"}`, `PREGUNTA: ${q}`, ""];
  const G = job.gov;
  const B = job.base;
  if (G) {
    const u = G.out?.usage || G.st?.usage || null;
    const usage = u ? { input: u.input + (G.gateUsage?.input || 0), output: u.output + (G.gateUsage?.output || 0), calls: (u.calls || 0) + (G.gate ? 1 : 0) } : null;
    out.push(`=== CON FROM E · ruta ${G.route || "-"} · ${usage ? line(usage) : "-"} · ${(G.ms / 1000).toFixed(1)} s`);
    if (G.stages.length) out.push("TRAZA: " + G.stages.map((x) => x.label + (x.note ? ` [${x.note}]` : "")).join(" > "));
    if (!G.out) out.push("EN CURSO");
    else if (G.out.error) out.push("ERROR: " + G.out.error);
    else if (G.out.blocked) out.push("RETENIDA POR EL FILTRO DE SALIDA");
    else out.push("SEÑAL: " + G.out.signal + (G.out.truncated ? " · CORTADA" : ""), "--- respuesta", G.out.text);
    out.push("");
  }
  if (B) {
    out.push(`=== SIN ARQUITECTURA · ${B.out?.usage ? line(B.out.usage) : "-"} · ${(B.ms / 1000).toFixed(1)} s`);
    if (!B.out) out.push("EN CURSO");
    else if (B.out.error) out.push("ERROR: " + B.out.error);
    else out.push((B.out.truncated ? "CORTADA\n" : "") + "--- respuesta", B.out.text);
    out.push("");
  }
  out.push(finished(job) ? "=== FIN" : "=== EN CURSO · vuelve a pedirlo con otro número al final de la ruta");
  return new Response(out.join("\n"), { status: 200, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
};

// Sin regla de frecuencia propia: la protegen la contraseña y el tope diario.
export const config = { path: ["/api/selftest", "/api/selftest/*"] };
