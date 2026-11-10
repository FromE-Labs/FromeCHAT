// Motor de ciclos por etapas. Es genérico a propósito: no contiene ninguna etapa, ni
// su orden, ni sus condiciones, ni sus textos. Todo eso se define en un archivo que
// el build descarga de un repositorio privado (ver governance.mjs). Aquí solo hay
// cuatro piezas: plantillas, reglas de paso, lectura de JSON y ejecución de una etapa.
//
// Cada invocación de la función ejecuta UNA etapa (una llamada al modelo) y devuelve
// el estado sellado para la siguiente. Ninguna llamada contiene el ciclo completo.

import { callModel } from "./anthropic.mjs";

const SAFE_KEY = /^[A-Za-z0-9_]+$/;

// Acceso por ruta ("review.issues.length") limitado a propiedades propias.
export function getPath(ctx, path) {
  let cur = ctx;
  for (const part of String(path).split(".")) {
    if (cur == null || !SAFE_KEY.test(part)) return undefined;
    if (part === "length" && (Array.isArray(cur) || typeof cur === "string")) cur = cur.length;
    else if (typeof cur === "object" && Object.prototype.hasOwnProperty.call(cur, part)) cur = cur[part];
    else return undefined;
  }
  return cur;
}

export function truthy(v) {
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    return s !== "" && s !== "null" && s !== "false" && s !== "none";
  }
  return Boolean(v);
}

function asText(v) {
  if (v === undefined || v === null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return JSON.stringify(v);
}

// Sustituye {{ruta}} por su valor. Una sola pasada: lo insertado no se vuelve a
// interpretar. guard neutraliza en los valores las etiquetas que delimitan datos en
// las plantillas, para que un texto no pueda cerrar su propio bloque.
export function render(tpl, ctx, { guard = null, clip = 0 } = {}) {
  return String(tpl || "").replace(/\{\{([A-Za-z0-9_.]+)\}\}/g, (_, path) => {
    let v = asText(getPath(ctx, path));
    if (clip) v = v.replace(/\s+/g, " ").trim().slice(0, clip);
    if (guard) v = v.replace(guard, "‹$1$2›");
    return v;
  });
}

export function tagGuard(pipeline) {
  const names = new Set();
  for (const st of Object.values(pipeline.stages)) {
    for (const m of String(st.input || "").matchAll(/<\/?([a-z_]+)>/g)) names.add(m[1]);
  }
  return names.size ? new RegExp(`<(/?)(${[...names].join("|")})>`, "gi") : null;
}

// Tolerante: admite vallas de código y texto alrededor del objeto.
export function parseJson(text) {
  const s = String(text || "");
  const a = s.indexOf("{");
  const b = s.lastIndexOf("}");
  if (a < 0 || b <= a) return null;
  try {
    const v = JSON.parse(s.slice(a, b + 1));
    return v && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

// Primera regla aplicable: { if?, unless?, max?, goto | deliver | deliver_text, signal? }.
export function decide(rules, ctx) {
  for (const r of rules || []) {
    if (r.if !== undefined && !truthy(getPath(ctx, r.if))) continue;
    if (r.unless !== undefined && truthy(getPath(ctx, r.unless))) continue;
    if (r.max && Object.entries(r.max).some(([id, n]) => (ctx.visits?.[id] || 0) >= n)) continue;
    return r;
  }
  return null;
}

export function conversationText(messages, budget = 60000) {
  const out = [];
  let used = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const line = `[${messages[i].role}] ${messages[i].content}`;
    if (used + line.length > budget && out.length) {
      out.unshift("[earlier messages omitted]");
      break;
    }
    out.unshift(line);
    used += line.length;
  }
  return out.join("\n\n");
}

export function newState(pipeline, { bind, ttl }) {
  const visits = {};
  for (const id of Object.keys(pipeline.stages)) visits[id] = 0;
  return {
    v: 1,
    exp: Date.now() + ttl,
    bind,
    next: pipeline.start,
    step: 0,
    vars: {},
    visits,
    usage: { input: 0, output: 0, calls: 0 },
    path: [],
    truncated: false,
  };
}

export function contextOf(st, messages) {
  return { ...st.vars, visits: st.visits, conversation: conversationText(messages) };
}

// Ejecuta la etapa st.next y actualiza st. Devuelve { stage, rule } o { stage, error }.
export async function runStage({ pipeline, st, key, model, messages, deadline, guard }) {
  const id = st.next;
  const stage = pipeline.stages[id];
  if (!stage) return { stage: null, error: { message: "Etapa desconocida.", retryable: false } };

  const ctx = contextOf(st, messages);
  const input = render(stage.input, ctx, { guard });
  const system = stage.conversation
    ? [{ type: "text", text: stage.system }, { type: "text", text: input }]
    : [{ type: "text", text: stage.system }];
  const msgs = stage.conversation ? messages : [{ role: "user", content: input }];
  const call = () =>
    callModel({
      key,
      model: stage.model && stage.model !== "main" ? stage.model : model,
      system,
      messages: msgs,
      maxTokens: stage.max_tokens || 1000,
      deadline,
    });

  let res = await call();
  if (!res.ok) return { stage, error: res };
  const account = (r) => {
    st.usage.input += r.usage.input;
    st.usage.output += r.usage.output;
    st.usage.calls += 1;
  };
  account(res);

  let value;
  if (stage.type === "json") {
    value = parseJson(res.text);
    // Un segundo intento si el modelo no devolvió JSON y queda tiempo en esta ejecución.
    if (value === null && deadline - Date.now() > 25000) {
      res = await call();
      if (res.ok) {
        account(res);
        value = parseJson(res.text);
      }
    }
    if (value === null) value = stage.fallback ?? {};
  } else {
    value = res.text.trim();
    if (!value) return { stage, error: { message: "El modelo no ha devuelto texto.", retryable: true } };
    st.truncated = Boolean(res.truncated);
  }

  st.vars[stage.save || id] = value;
  st.visits[id] = (st.visits[id] || 0) + 1;
  st.path.push(id);
  return { stage, rule: decide(stage.next, contextOf(st, messages)) };
}
