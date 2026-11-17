// Preguntas de cortesía.
// La autora paga las primeras preguntas de quien recibe un código de invitación. El
// servidor usa entonces su clave (COURTESY_KEY), que nunca llega al navegador, con el
// modelo fijado y un número de preguntas por código. El tope de gasto real lo pone el
// espacio de trabajo de esa clave en la consola del proveedor; lo de aquí es el reparto.
//
// Variables: COURTESY_KEY, COURTESY_CODES (códigos separados por comas o espacios),
// COURTESY_PER_CODE (preguntas por código, 3 por defecto), COURTESY_TOTAL (tope global).
// Sin clave o sin códigos, la función no existe para nadie.

import { getStore } from "@netlify/blobs";
import { createHash } from "node:crypto";

const STORE = "courtesy";
const CODE_RE = /^[A-Z0-9]{2,4}(-[A-Z0-9]{4}){2,4}$/;
const TURN_RE = /^[A-Za-z0-9_-]{8,48}$/;

export const COURTESY_MODEL = "claude-opus-5-5";
export const COURTESY_MAX_CHARS = 6000; // por mensaje
export const COURTESY_MAX_TOTAL_CHARS = 30000; // conversación entera

let injected = null;
// Solo para pruebas: sustituye el almacén.
export function useCourtesyStore(s) {
  injected = s;
}
const store = () => injected || getStore({ name: STORE, consistency: "strong" });

const clampInt = (v, d, lo, hi) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};

export function normalizeCode(raw) {
  return String(raw ?? "").trim().toUpperCase().replace(/\s+/g, "");
}

export function courtesyConfig() {
  const key = (process.env.COURTESY_KEY || "").trim();
  const codes = (process.env.COURTESY_CODES || "").split(/[,\s]+/).map(normalizeCode).filter((c) => CODE_RE.test(c));
  const per = clampInt(process.env.COURTESY_PER_CODE, 3, 1, 20);
  const total = clampInt(process.env.COURTESY_TOTAL, codes.length * per, 1, 5000);
  const enabled = /^sk-ant-[A-Za-z0-9_\-]{20,}$/.test(key) && codes.length > 0;
  return { enabled, key, codes: new Set(codes), per, total };
}

const recKey = (code) => "c-" + createHash("sha256").update(code).digest("hex").slice(0, 32);
const TOTAL_KEY = "total";

async function load(key, fallback) {
  try {
    return (await store().get(key, { type: "json" })) || fallback;
  } catch {
    return fallback;
  }
}

// Cuántas preguntas le quedan a un código. No consume nada.
export async function courtesyStatus(cfg, rawCode) {
  const code = normalizeCode(rawCode);
  if (!cfg.enabled || !cfg.codes.has(code)) return { ok: false };
  const rec = await load(recKey(code), { used: 0, turns: {} });
  return { ok: true, remaining: Math.max(0, cfg.per - (rec.used || 0)), per: cfg.per };
}

// Reserva una llamada de una pregunta. Una pregunta (turn) admite una llamada gobernada
// ("g") y una directa ("b"): el comparador no gasta dos preguntas.
export async function takeCourtesy(cfg, { code: rawCode, turn, slot }) {
  const code = normalizeCode(rawCode);
  if (!cfg.enabled || !cfg.codes.has(code)) return { ok: false, status: 403, reason: "code", message: "Código de invitación no reconocido." };
  if (typeof turn !== "string" || !TURN_RE.test(turn)) return { ok: false, status: 400, reason: "turn", message: "Petición de cortesía mal formada." };
  const k = recKey(code);
  const rec = await load(k, { used: 0, turns: {} });
  rec.turns = rec.turns || {};
  const cur = rec.turns[turn];
  if (cur) {
    if (cur[slot]) return { ok: false, status: 409, reason: "replay", message: "Esa pregunta ya se ha respondido. Envía un mensaje nuevo." };
    cur[slot] = 1;
  } else {
    if ((rec.used || 0) >= cfg.per) {
      return { ok: false, status: 402, reason: "exhausted", message: "Se han terminado las preguntas de cortesía de este código. Para seguir, pega tu propia clave de Anthropic." };
    }
    const tot = await load(TOTAL_KEY, { used: 0 });
    if ((tot.used || 0) >= cfg.total) {
      return { ok: false, status: 402, reason: "closed", message: "Las preguntas de cortesía se han agotado. Para seguir, pega tu propia clave de Anthropic." };
    }
    rec.used = (rec.used || 0) + 1;
    rec.turns[turn] = { [slot]: 1, t: Date.now() };
    await store().setJSON(TOTAL_KEY, { used: (tot.used || 0) + 1 });
  }
  await store().setJSON(k, rec);
  return { ok: true, code, turn, slot, remaining: Math.max(0, cfg.per - rec.used) };
}

// Devuelve la llamada reservada cuando el proveedor ha fallado sin entregar nada, para
// que el reintento no gaste otra pregunta.
export async function refundCourtesy(cfg, { code, turn, slot }) {
  try {
    const k = recKey(code);
    const rec = await load(k, null);
    const cur = rec?.turns?.[turn];
    if (!cur || !cur[slot]) return;
    delete cur[slot];
    if (!cur.g && !cur.b) {
      delete rec.turns[turn];
      rec.used = Math.max(0, (rec.used || 0) - 1);
      const tot = await load(TOTAL_KEY, { used: 0 });
      await store().setJSON(TOTAL_KEY, { used: Math.max(0, (tot.used || 0) - 1) });
    }
    await store().setJSON(k, rec);
  } catch {}
}
