// Prueba de voz a ciegas. Sirve una página privada que enseña, para una lista de casos
// guardados, dos respuestas gobernadas del mismo modelo: una con la voz de la autora y
// otra sin ella, sin etiquetas y en orden aleatorio. Quien la hace marca cuál es la suya.
//
// Existe donde existe la entrada de pruebas y con su misma contraseña: solo en vistas
// previas o ramas, nunca en producción. La página no contiene las respuestas: las pide
// a la entrada de pruebas desde el navegador y las guarda allí.

import { timingSafeEqual } from "node:crypto";
import { loadGovernance } from "./lib/governance.mjs";
import { pickModules } from "./lib/engine.mjs";
import { PAGE } from "./lib/voicetest-page.mjs";

const RUN = "voz1"; // cambia si cambian los casos: identifica la tanda en la entrada de pruebas
const CASES = (process.env.VOICETEST_CASES || "a0,hosting,informe,dinero,comite,agentes,despido,hipotesis,lluvia,fundada").split(",").map((x) => x.trim()).filter(Boolean);
const VOICE_OFF = process.env.VOICETEST_OFF_MODULE || "sinvoz";
const gone = () => new Response("Not found", { status: 404 });

function previewHost(host) {
  return /^deploy-preview-\d+--/.test(host) || (host.includes("--") && host.endsWith(".netlify.app")) || /^(localhost|127\.0\.0\.1)(:|$)/.test(host);
}
function sameToken(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && x.length >= 24 && timingSafeEqual(x, y);
}

export default async (req, context) => {
  const url = new URL(req.url);
  const ctx = context?.deploy?.context;
  const prod = ctx ? ctx === "production" : !previewHost(url.host);
  const token = (process.env.SELFTEST_TOKEN || "").trim();
  let given = "";
  try { given = decodeURIComponent(url.pathname.replace(/^\/prueba-voz\/?/, "").split("/")[0] || ""); } catch {}
  if (req.method !== "GET" || prod || !token || !(process.env.SELFTEST_KEY || "").trim() || !sameToken(given, token)) return gone();

  const g = loadGovernance();
  if (!g.pipeline || !g.voice || !g.pipeline.modules?.[VOICE_OFF]) return new Response("Este despliegue no tiene voz que medir.", { status: 404 });
  const cases = [];
  for (const id of CASES) {
    if (!/^[a-z0-9_-]{1,40}$/i.test(id)) continue;
    const c = g.cases?.[id];
    const turns = Array.isArray(c)
      ? c.filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string").map((m) => ({ role: m.role, content: m.content }))
      : typeof c === "string" && c.trim() ? [{ role: "user", content: c.trim() }] : null;
    if (turns && turns.length && turns[turns.length - 1].role === "user") cases.push({ id, turns });
  }
  if (cases.length < 4) return new Response("No hay casos suficientes para la prueba.", { status: 404 });

  const cfg = {
    run: RUN,
    token: given,
    model: "opus",
    cases,
    withVoice: "todos",
    noVoice: [...pickModules(g.pipeline, undefined), VOICE_OFF].join("."),
    excerpt: 1100,
    cost: "unos 70 céntimos a precio de lista, estimados.",
  };
  const html = PAGE.replace("__CONFIG__", () => JSON.stringify(cfg).replace(/</g, "\\u003c"));
  return new Response(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex, nofollow",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
    },
  });
};

export const config = { path: ["/prueba-voz/*"] };
