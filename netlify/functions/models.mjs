import { MODELS } from "./chat.mjs";
import { loadGovernance } from "./lib/governance.mjs";

// Datos públicos para la interfaz: modelos y nombre de cada módulo. Nunca sus textos.
export default async () => {
  let modules = [];
  let presets = [];
  try {
    const p = loadGovernance().pipeline;
    modules = Object.entries(p?.modules || {}).filter(([, m]) => !m.hidden).map(([id, m]) => ({ id, label: m.label, desc: m.desc || "", default: m.default !== false }));
    presets = (p?.presets || []).map((x) => ({ id: x.id, label: x.label, modules: x.modules }));
  } catch {}
  return new Response(
    JSON.stringify({
      models: Object.entries(MODELS).map(([id, m]) => ({ id, label: m.label })),
      modules,
      presets,
      openCoreModules: 7,
      maxOutputTokens: 3000,
      effort: process.env.MODEL_EFFORT || "low",
      architecture: "From E™",
      spec: "https://doi.org/10.5281/zenodo.19041459",
    }),
    { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=300" } }
  );
};

export const config = { path: "/api/models" };
