// Entrada de pruebas. Permite lanzar un caso (mensaje + módulos) y leer las dos
// respuestas, la gobernada y la directa, sin pasar por la interfaz.
//
// Solo existe donde se cumple todo esto:
//   - el despliegue es una vista previa o una rama, nunca producción;
//   - están definidas las variables SELFTEST_KEY (clave de API de quien prueba) y
//     SELFTEST_TOKEN (contraseña de esta entrada);
//   - la petición trae esa contraseña.
// En cualquier otro caso responde 404, como si no existiera.

import { timingSafeEqual } from "node:crypto";
import { getStore } from "@netlify/blobs";
import { loadGovernance, PUBLIC_SYSTEM, UNGOVERNED_SYSTEM } from "./lib/governance.mjs";
import { pickModules } from "./lib/engine.mjs";
import { runCycle } from "./lib/cycle.mjs";
import { callModel } from "./lib/anthropic.mjs";
import { gate } from "./lib/gate.mjs";
import { MODELS } from "./chat.mjs";

const BUDGET_MS = Number(process.env.SELFTEST_BUDGET_MS) || 55000;
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
  if (!(await underCap())) return new Response("Tope diario de pruebas alcanzado.", { status: 429 });

  const t0 = Date.now();
  const deadline = t0 + BUDGET_MS;
  const g = loadGovernance();
  const model = MODELS[param("model")] ? param("model") : "claude-opus-5-5";
  const mParam = param("m") ?? null;
  const modules = pickModules(g.pipeline, mParam === null ? undefined : mParam.split(",").map((x) => x.trim()).filter(Boolean));
  const side = param("side") || "both";
  const messages = [{ role: "user", content: q }];

  const governed = async () => {
    const s = Date.now();
    const verdict = await gate({ key, messages });
    if (verdict.auth === false) return { error: "Clave rechazada por el proveedor.", ms: Date.now() - s };
    if (verdict.probe) {
      const r = await callModel({ key, model, system: PUBLIC_SYSTEM, messages, maxTokens: MAX_OUTPUT, deadline });
      return r.ok ? { route: "public", text: r.text, signal: "Límite de divulgación", stages: [], usage: { ...r.usage, calls: 2 }, ms: Date.now() - s } : { error: r.message, ms: Date.now() - s };
    }
    const out = await runCycle({ g, key, model, messages, modules, deadline });
    if (verdict.usage && out.usage) {
      out.usage.input += verdict.usage.input;
      out.usage.output += verdict.usage.output;
      out.usage.calls += 1;
    }
    return { route: "governed", ...out, ms: Date.now() - s };
  };
  const baseline = async () => {
    const s = Date.now();
    const r = await callModel({ key, model, system: UNGOVERNED_SYSTEM, messages, maxTokens: MAX_OUTPUT, deadline });
    return r.ok ? { text: r.text, usage: { ...r.usage, calls: 1 }, truncated: r.truncated, ms: Date.now() - s } : { error: r.message, ms: Date.now() - s };
  };

  const [gov, base] = await Promise.all([side === "base" ? null : governed(), side === "gov" ? null : baseline()]);

  const labels = modules.map((m) => g.pipeline.modules?.[m]?.label || m);
  const out = [`PRUEBA ${param("id") || "-"} · ${model} · módulos: ${labels.join(", ") || "ninguno"}`, `PREGUNTA: ${q}`, ""];
  if (gov) {
    out.push(`=== CON FROM E · ruta ${gov.route || "-"} · ${gov.usage ? line(gov.usage) : "-"} · ${(gov.ms / 1000).toFixed(1)} s`);
    if (gov.stages?.length) out.push("TRAZA: " + gov.stages.map((x) => x.label + (x.note ? ` [${x.note}]` : "")).join(" > "));
    if (gov.error) out.push("ERROR: " + gov.error);
    else if (gov.blocked) out.push("RETENIDA POR EL FILTRO DE SALIDA");
    else out.push("SEÑAL: " + gov.signal + (gov.truncated ? " · CORTADA" : ""), "--- respuesta", gov.text);
    out.push("");
  }
  if (base) {
    out.push(`=== SIN ARQUITECTURA · ${base.usage ? line(base.usage) : "-"} · ${(base.ms / 1000).toFixed(1)} s`);
    if (base.error) out.push("ERROR: " + base.error);
    else out.push((base.truncated ? "CORTADA\n" : "") + "--- respuesta", base.text);
    out.push("");
  }
  out.push("=== FIN");
  return new Response(out.join("\n"), { status: 200, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
};

// Sin regla de frecuencia propia: la protegen la contraseña y el tope diario.
export const config = { path: ["/api/selftest", "/api/selftest/*"] };
