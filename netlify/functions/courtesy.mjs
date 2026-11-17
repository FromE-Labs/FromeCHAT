// Consulta cuántas preguntas de cortesía le quedan a un código. No consume nada.
// El código viaja en el cuerpo de un POST, nunca en la URL.

import { courtesyConfig, courtesyStatus } from "./lib/courtesy.mjs";

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "method" });
  const cfg = courtesyConfig();
  if (!cfg.enabled) return json(404, { error: "off" });
  let body;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "json" });
  }
  const st = await courtesyStatus(cfg, body?.code);
  if (!st.ok) return json(403, { ok: false, message: "Código de invitación no reconocido." });
  return json(200, { ok: true, remaining: st.remaining, per: st.per, model: "Claude Opus 5.5" });
};

export const config = {
  path: "/api/courtesy",
  // Pocas consultas por minuto: no sirve para probar códigos al azar.
  rateLimit: { windowLimit: 12, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
