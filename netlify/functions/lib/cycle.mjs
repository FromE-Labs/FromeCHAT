// Avance del ciclo fuera del chat. Lo usa la entrada de pruebas; el chat normal avanza
// una etapa por petición (ver chat.mjs). La lógica de paso es la misma.

import { runStage, contextOf, getPath, render } from "./engine.mjs";
import { LeakFilter } from "./shield.mjs";
import { closingApplies, dropClosingQuestion } from "./closing.mjs";

function clean(g, text) {
  const f = new LeakFilter(g);
  f.push(text);
  f.end();
  return !f.blocked;
}

// Ejecuta UNA etapa sobre el estado st y anota su traza en stages. Devuelve null si
// el ciclo sigue, o el resultado final: { text, signal, kind, truncated } | { blocked }
// | { error, retryable }. Tras un error el estado no cambia: se puede repetir la etapa.
export async function stepCycle({ g, key, model, messages, st, stages, deadline }) {
  const { pipeline, guard } = g;
  const id = st.next;
  const stage = pipeline.stages[id];
  const out = await runStage({ pipeline, st, key, model, messages, deadline, guard });
  if (out.error) return { error: out.error.message, retryable: Boolean(out.error.retryable) };
  const ctx = contextOf(st, messages);
  const note = out.inconclusive ? String(stage.fallback_note || "no concluyente") : render(stage.note, ctx, { clip: 80 });
  stages.push({ id, label: stage.label, note });
  let rule = out.rule;
  st.step += 1;
  if (rule?.goto && st.step < (pipeline.max_steps || 12) && pipeline.stages[rule.goto]) {
    st.next = rule.goto;
    return null;
  }
  if (!rule || rule.goto) rule = { deliver: "draft", signal: "Ciclo interrumpido — límite de etapas" };
  const notice = rule.deliver_text !== undefined;
  let text = (notice ? render(rule.deliver_text, ctx, { clip: 160 }) : String(getPath(ctx, rule.deliver) ?? "")).trim();
  const signal = render(rule.signal, ctx, { clip: 60 });
  if (!text) return { error: "El ciclo no ha producido respuesta.", retryable: false };
  // Regla visible: si el usuario pidió que no se le pregunte más, el cierre no es una pregunta.
  let closing = null;
  if (!notice && !st.truncated && closingApplies(pipeline, st, ctx)) {
    const c = dropClosingQuestion(text);
    text = c.text;
    closing = c.removed;
  }
  if (!clean(g, text) || !clean(g, signal)) return { blocked: true };
  return { text, signal, kind: notice ? "notice" : "answer", truncated: st.truncated, ...(closing === null ? {} : { closing }) };
}
