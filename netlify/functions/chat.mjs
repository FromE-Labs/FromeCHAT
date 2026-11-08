// FromE Chat — función de streaming.
// Recibe { key, model, governed, messages, consent, sessionId } y reenvía a Anthropic
// con la clave del usuario. La clave se usa en esta llamada y se descarta: no se
// escribe en registros, no se guarda en ningún almacén, no se devuelve al cliente.

import { governedSystemPrompt, UNGOVERNED_SYSTEM } from "./lib/governance.mjs";
import { recordTurn } from "./lib/consent.mjs";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

// Modelos de frontera ofrecidos. Se valida contra esta lista para que el servidor
// nunca reenvíe un identificador arbitrario.
export const MODELS = {
  "claude-opus-5-5": { label: "Claude Opus 5.5", max: 8192 },
  "claude-sonnet-5-5": { label: "Claude Sonnet 5.5", max: 8192 },
  "claude-fable-5-1": { label: "Claude Fable 5.1", max: 8192 },
};

const MAX_MESSAGES = 60;
const MAX_CHARS_PER_MESSAGE = 24000;

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function validKey(k) {
  return typeof k === "string" && /^sk-ant-[A-Za-z0-9_\-]{20,}$/.test(k.trim());
}

function sanitizeMessages(raw) {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_MESSAGES) return null;
  const out = [];
  for (const m of raw) {
    if (!m || (m.role !== "user" && m.role !== "assistant")) return null;
    if (typeof m.content !== "string") return null;
    const content = m.content.slice(0, MAX_CHARS_PER_MESSAGE);
    if (!content.trim()) return null;
    out.push({ role: m.role, content });
  }
  if (out[0].role !== "user" || out[out.length - 1].role !== "user") return null;
  return out;
}

export default async (req) => {
  if (req.method !== "POST") return json(405, { error: "method" });

  let body;
  try {
    body = await req.json();
  } catch {
    return json(400, { error: "json" });
  }

  const key = (body.key || "").trim();
  if (!validKey(key)) return json(400, { error: "key", message: "Clave de API de Anthropic no válida (empieza por sk-ant-)." });

  const model = MODELS[body.model] ? body.model : "claude-opus-5-5";
  const governed = body.governed !== false;
  const messages = sanitizeMessages(body.messages);
  if (!messages) return json(400, { error: "messages" });

  const system = governed ? await governedSystemPrompt() : UNGOVERNED_SYSTEM;

  const upstream = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model,
      max_tokens: MODELS[model].max,
      system,
      messages,
      stream: true,
    }),
  });

  if (!upstream.ok || !upstream.body) {
    let detail = "";
    try {
      const e = await upstream.json();
      detail = e?.error?.message || "";
    } catch {}
    // Nunca se incluye la clave en el mensaje de error.
    return json(upstream.status === 401 ? 401 : 502, {
      error: "upstream",
      status: upstream.status,
      message: detail || "El proveedor no ha respondido.",
    });
  }

  // Reenvío del SSE de Anthropic tal cual, y acumulación del texto para la
  // sesión consentida (solo si el usuario ha dado consentimiento explícito).
  const consent = body.consent === true;
  const sessionId = typeof body.sessionId === "string" ? body.sessionId.slice(0, 64) : null;
  let assistantText = "";
  let usage = null;
  const decoder = new TextDecoder();
  let buffer = "";

  const stream = new ReadableStream({
    async start(controller) {
      const reader = upstream.body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          controller.enqueue(value);
          if (consent) {
            buffer += decoder.decode(value, { stream: true });
            let idx;
            while ((idx = buffer.indexOf("\n\n")) >= 0) {
              const chunk = buffer.slice(0, idx);
              buffer = buffer.slice(idx + 2);
              const line = chunk.split("\n").find((l) => l.startsWith("data: "));
              if (!line) continue;
              try {
                const ev = JSON.parse(line.slice(6));
                if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") assistantText += ev.delta.text;
                if (ev.type === "message_delta" && ev.usage) usage = ev.usage;
                if (ev.type === "message_start" && ev.message?.usage) usage = { ...ev.message.usage };
              } catch {}
            }
          }
        }
      } finally {
        controller.close();
        if (consent && sessionId && assistantText) {
          // Fuera del camino crítico de la respuesta. Sin clave, sin IP, sin cabeceras.
          recordTurn({ sessionId, model, governed, messages, assistantText, usage }).catch(() => {});
        }
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-store",
      "x-frome-governed": governed ? "1" : "0",
    },
  });
};

export const config = { path: "/api/chat" };
