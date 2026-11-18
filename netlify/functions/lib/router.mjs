// Encaminador por tipo de caso. Una llamada breve a un modelo rápido etiqueta el
// último mensaje, y con esas etiquetas se decide qué módulos, de los que el usuario
// tiene encendidos, se envían en este mensaje. Nunca enciende nada que el usuario no
// haya encendido: solo acota. Si no puede decidir, no acota y va el conjunto completo.
//
// Es genérico a propósito, como el motor: las etiquetas, lo que significa cada una, a
// qué módulos corresponde y el texto que recibe el modelo que etiqueta están en el
// archivo privado (pipeline.routing). Aquí solo se hace la llamada y se lee el resultado.
//
//   routing: {
//     when: [bandera, ...]      el encaminador solo se llama si alguna está activa
//     narrow_when: bandera      solo con ella se acotan módulos; sin ella, solo marcas
//     scope: [módulo, ...]      módulos que el encaminador puede dejar fuera
//     system: texto             instrucciones del modelo que etiqueta
//     labels: { ETIQUETA: { type, modules: [...] } | { mark } | { all: true } }
//     closing: { mark, when?, unless? }   ver closing.mjs
//   }
//
// Es una llamada aparte de la comprobación de entrada, que no se toca: las dos salen a
// la vez, así que no añade espera.

import { postMessages, effortFor } from "./anthropic.mjs";

const ROUTER_MODEL = process.env.ROUTER_MODEL || process.env.GATE_MODEL || "claude-haiku-5-5";
const ROUTER_TIMEOUT_MS = 12000;
const ROUTER_MAX_TOKENS = 400; // el modelo también piensa antes de contestar
const MAX_WORDS = 12; // un veredicto son unas pocas etiquetas; más que eso no se interpreta

export function routingActive(pipeline, flags) {
  const r = pipeline?.routing;
  return Boolean(r && typeof r.system === "string" && r.system && r.labels && (r.when || []).some((f) => flags?.[f]));
}

const nothing = (via) => ({ types: [], marks: {}, modules: null, via });

// Lee el veredicto. Devuelve { types, marks, modules }: modules es la lista de módulos
// que tocan a este mensaje, o null si no hay que acotar.
export function readLabels(routing, text, flags) {
  const words = String(text || "").toUpperCase().match(/[A-Z_]+/g) || [];
  if (!words.length || words.length > MAX_WORDS) return { types: [], marks: {}, modules: null };
  const seen = new Set(words);
  const types = [];
  const marks = {};
  const mods = new Set();
  let all = false;
  for (const [label, def] of Object.entries(routing.labels || {})) {
    if (!seen.has(label.toUpperCase()) || !def) continue;
    if (def.all) all = true;
    else if (def.mark) marks[def.mark] = true;
    else {
      types.push(def.type || label.toLowerCase());
      for (const m of def.modules || []) mods.add(m);
    }
  }
  const narrow = routing.narrow_when === undefined || Boolean(flags?.[routing.narrow_when]);
  return { types, marks, modules: narrow && !all && types.length ? [...mods] : null };
}

function clip(s, n) {
  return s.length <= n ? s : s.slice(0, n) + " […]";
}

// Devuelve { types, marks, modules, via: "model"|"error", usage? }. Nunca lanza: ante
// cualquier fallo no se acota nada y la respuesta se genera como sin encaminador.
export async function route({ pipeline, key, messages, flags }) {
  const routing = pipeline.routing;
  const last = messages[messages.length - 1].content;
  const prior = messages
    .slice(-5, -1)
    .map((m) => `[${m.role}] ${clip(m.content, 1200)}`)
    .join("\n");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ROUTER_TIMEOUT_MS);
  try {
    const r = await postMessages({
      key,
      signal: ctrl.signal,
      body: {
        model: ROUTER_MODEL,
        max_tokens: ROUTER_MAX_TOKENS,
        system: routing.system,
        messages: [{ role: "user", content: `<context>\n${prior}\n</context>\n<last_message>\n${clip(last, 6000)}\n</last_message>` }],
        ...effortFor(ROUTER_MODEL),
      },
    });
    if (!r.ok) {
      console.warn(`router: proveedor ${r.status}; no se acota`);
      return nothing("error");
    }
    const data = await r.json();
    const text = (data?.content || []).filter((c) => c?.type === "text").map((c) => c.text).join(" ");
    const usage = { input: data?.usage?.input_tokens || 0, output: data?.usage?.output_tokens || 0 };
    return { ...readLabels(routing, text, flags), via: "model", usage };
  } catch (e) {
    console.warn(`router: ${e?.name || "error"}; no se acota`);
    return nothing("error");
  } finally {
    clearTimeout(timer);
  }
}
