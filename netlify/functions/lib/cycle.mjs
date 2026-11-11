// Ciclo completo en una sola ejecución. Lo usa la entrada de pruebas; el chat normal
// avanza una etapa por petición (ver chat.mjs). La lógica de paso es la misma.

import { runStage, newState, contextOf, getPath, render } from "./engine.mjs";
import { LeakFilter } from "./shield.mjs";

function clean(g, text) {
  const f = new LeakFilter(g);
  f.push(text);
  f.end();
  return !f.blocked;
}

export async function runCycle({ g, key, model, messages, modules, deadline }) {
  const { pipeline, guard } = g;
  const st = newState(pipeline, { bind: "selftest", ttl: 0, modules });
  const stages = [];
  for (;;) {
    const id = st.next;
    const stage = pipeline.stages[id];
    if (Date.now() > deadline - 2000) return { error: "Sin tiempo para terminar el ciclo.", stages, usage: st.usage };
    const out = await runStage({ pipeline, st, key, model, messages, deadline, guard });
    if (out.error) return { error: out.error.message, stages, usage: st.usage };
    const ctx = contextOf(st, messages);
    const note = out.inconclusive ? String(stage.fallback_note || "no concluyente") : render(stage.note, ctx, { clip: 80 });
    stages.push({ id, label: stage.label, note });
    let rule = out.rule;
    st.step += 1;
    if (rule?.goto && st.step < (pipeline.max_steps || 12) && pipeline.stages[rule.goto]) {
      st.next = rule.goto;
      continue;
    }
    if (!rule || rule.goto) rule = { deliver: "draft", signal: "Ciclo interrumpido — límite de etapas" };
    const notice = rule.deliver_text !== undefined;
    const text = (notice ? render(rule.deliver_text, ctx, { clip: 160 }) : String(getPath(ctx, rule.deliver) ?? "")).trim();
    const signal = render(rule.signal, ctx, { clip: 60 });
    if (!text) return { error: "El ciclo no ha producido respuesta.", stages, usage: st.usage };
    if (!clean(g, text) || !clean(g, signal)) return { blocked: true, stages, usage: st.usage };
    return { text, signal, kind: notice ? "notice" : "answer", stages, usage: st.usage, truncated: st.truncated };
  }
}
