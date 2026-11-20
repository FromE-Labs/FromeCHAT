// Comprobación de salida para una regla que se ve: si el usuario ha dicho que no se le
// pregunte más, la respuesta no cierra con una pregunta.
//
// No corta la respuesta ni la vuelve a generar: retira la pregunta del final y deja el
// resto como está, incluido lo que la respuesta declara haber dado por hecho. Solo mira
// el cierre; una pregunta en mitad del texto no se toca. Es una pieza aparte del filtro
// de protección (shield.mjs), que no cambia.
//
// Cuándo se aplica lo decide el archivo privado (pipeline.routing.closing): la marca
// que deja el encaminador y las condiciones de la etapa.

import { getPath, truthy } from "./engine.mjs";

export function closingApplies(pipeline, st, ctx) {
  const c = pipeline?.routing?.closing;
  if (!c || !c.mark || !st?.marks?.[c.mark]) return false;
  if (c.when !== undefined && !truthy(getPath(ctx, c.when))) return false;
  if (c.unless !== undefined && truthy(getPath(ctx, c.unless))) return false;
  return true;
}

const MIN_LEFT = 80; // si al quitar la pregunta no queda respuesta, no se toca nada
const WRAP = /[\s*_"'»”)\]]+$/; // cierre de énfasis, comillas o paréntesis tras el signo
const OPEN = /^[\s>*_\-–—•·\d.)"'«“(\[]*$/; // viñeta, numeración o énfasis sin contenido

// Devuelve { text, removed }: removed es el número de preguntas retiradas del cierre.
export function dropClosingQuestion(input) {
  const original = String(input || "").trimEnd();
  // Dentro de un bloque de código sin cerrar no se interpreta nada.
  if ((original.match(/```/g) || []).length % 2) return { text: original, removed: 0 };
  let text = original;
  let removed = 0;
  for (let i = 0; i < 4; i++) {
    const nl = text.lastIndexOf("\n");
    const line = text.slice(nl + 1);
    const bare = line.replace(WRAP, "");
    if (!bare.endsWith("?")) break;
    // Dónde empieza la última pregunta de la línea: en su «¿» o tras el final de la frase anterior.
    let start = bare.lastIndexOf("¿");
    if (start < 0) {
      const body = bare.slice(0, -1);
      const m = [...body.matchAll(/[.!?…:;]["'»”)\]*_]*\s+/g)].pop();
      start = m ? m.index + m[0].length : 0;
    }
    let keep = line.slice(0, start).trimEnd();
    if (OPEN.test(keep)) keep = "";
    text = (text.slice(0, nl + 1) + keep).trimEnd();
    removed += 1;
  }
  if (!removed) return { text: original, removed: 0 };
  // Una línea corta que solo anunciaba la pregunta («Una cosa más:») se va con ella.
  const nl = text.lastIndexOf("\n");
  const lastLine = text.slice(nl + 1);
  if (nl >= 0 && lastLine.length < 80 && /[:：]\s*[*_]*$/.test(lastLine)) text = text.slice(0, nl).trimEnd();
  if (text.replace(/\s+/g, " ").length < MIN_LEFT) return { text: original, removed: 0 };
  return { text, removed };
}
