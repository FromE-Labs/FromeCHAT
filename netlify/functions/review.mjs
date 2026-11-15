// Revisión privada de las sesiones aportadas. Solo para la autora de la arquitectura:
// lee los turnos que los usuarios han consentido aportar y guarda, junto a cada uno,
// su corrección. Esas correcciones son la materia de la que salen los ejemplos nuevos
// de los módulos; aquí solo se leen y se guardan, no se incorporan a nada.
//
// Existe solo si está definida la variable REVIEW_TOKEN (20 caracteres o más). La
// contraseña viaja en la cabecera x-review-token, nunca en la URL. Sin variable, o con
// contraseña incorrecta, responde 404.

import { getStore } from "@netlify/blobs";
import { timingSafeEqual } from "node:crypto";

const TURNS = "consented-sessions";
const REVIEWS = "session-reviews";
const PAGE = 30;
const KEY_RE = /^\d{4}-\d{2}-\d{2}\/[A-Za-z0-9_-]{6,64}\/[0-9A-Za-z-]+\.json$/;

const defaultStores = () => ({
  turns: getStore({ name: TURNS, consistency: "strong" }),
  reviews: getStore({ name: REVIEWS, consistency: "strong" }),
});

function same(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const gone = () => new Response("Not found", { status: 404 });
const clip = (v, n) => String(v ?? "").slice(0, n).trim();

async function allKeys(store) {
  const { blobs } = await store.list();
  return blobs.map((b) => b.key).filter((k) => KEY_RE.test(k)).sort().reverse(); // más recientes primero
}

function summary(key, t, review) {
  const messages = Array.isArray(t.messages) ? t.messages : [];
  return {
    key,
    ts: t.ts,
    sessionId: t.sessionId,
    model: t.model,
    condition: t.condition,
    modules: t.cycle?.modules || null,
    signal: t.cycle?.signal || null,
    withheld: Boolean(t.cycle?.withheld),
    messages,
    assistant: t.assistant || "",
    review: review || null,
  };
}

export default async (req, context, stores) => {
  const token = (process.env.REVIEW_TOKEN || "").trim();
  if (token.length < 20 || !same(req.headers.get("x-review-token") || "", token)) return gone();
  const { turns, reviews } = stores || defaultStores();
  const url = new URL(req.url);

  if (req.method === "GET" && url.searchParams.get("export") === "1") {
    // Solo lo que ha escrito la autora: módulo, qué falló y su corrección. Sin la
    // conversación del usuario.
    const { blobs } = await reviews.list();
    const items = [];
    for (const b of blobs.sort((a, c) => (a.key < c.key ? -1 : 1))) {
      const r = await reviews.get(b.key, { type: "json" });
      if (r && (r.correction || r.failure)) items.push({ turn: b.key, module: r.module || null, verdict: r.verdict || null, failure: r.failure || "", correction: r.correction || "", ts: r.ts });
    }
    return json(200, { schema: "frome-chat/corrections/v1", count: items.length, items });
  }

  if (req.method === "GET") {
    const keys = await allKeys(turns);
    const before = url.searchParams.get("before") || "";
    const start = before ? keys.findIndex((k) => k < before) : 0;
    const page = start < 0 ? [] : keys.slice(start, start + PAGE);
    const out = await Promise.all(
      page.map(async (key) => {
        const [t, r] = await Promise.all([turns.get(key, { type: "json" }), reviews.get(key, { type: "json" })]);
        return t ? summary(key, t, r) : null;
      })
    );
    const last = page[page.length - 1];
    return json(200, { total: keys.length, turns: out.filter(Boolean), next: last && keys.indexOf(last) < keys.length - 1 ? last : null });
  }

  if (req.method === "POST") {
    let body;
    try {
      body = await req.json();
    } catch {
      return json(400, { error: "json" });
    }
    const key = String(body.key || "");
    if (!KEY_RE.test(key) || !(await turns.get(key, { type: "json" }))) return json(404, { error: "turn" });
    const review = {
      schema: "frome-chat/review/v1",
      ts: new Date().toISOString(),
      verdict: ["bien", "falla"].includes(body.verdict) ? body.verdict : null,
      module: clip(body.module, 40) || null,
      failure: clip(body.failure, 600),
      correction: clip(body.correction, 4000),
    };
    if (!review.verdict && !review.failure && !review.correction) {
      await reviews.delete(key);
      return json(200, { ok: true, review: null });
    }
    await reviews.setJSON(key, review);
    return json(200, { ok: true, review });
  }

  return json(405, { error: "method" });
};

export const config = {
  path: "/api/review",
  rateLimit: { windowLimit: 40, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
