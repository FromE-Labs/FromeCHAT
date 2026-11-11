import { MODELS } from "./chat.mjs";
import { loadGovernance } from "./lib/governance.mjs";

// Datos públicos para la interfaz: modelos y nombre de cada módulo. Nunca sus textos.
export default async (req, context) => {
  // TEMPORAL (diagnóstico de la entrada de pruebas; se retira al resolverlo): fuera de
  // producción, ?diag=1 consulta el estado de /api/selftest desde el propio servidor.
  const u = new URL(req.url);
  if (u.searchParams.get("diag") === "1" && context?.deploy?.context !== "production") {
    let seen;
    try {
      const r = await fetch(`${u.origin}/api/selftest?status=1&fmt=json`, { signal: AbortSignal.timeout(8000) });
      seen = { http: r.status, type: r.headers.get("content-type"), body: (await r.text()).slice(0, 600) };
    } catch (e) {
      seen = { error: String(e?.message || e).slice(0, 200) };
    }
    return new Response(JSON.stringify({ diag: { origin: u.origin, context: context?.deploy?.context || null, selftest: seen } }), {
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=5" },
    });
  }
  let modules = [];
  let presets = [];
  try {
    const p = loadGovernance().pipeline;
    modules = Object.entries(p?.modules || {}).map(([id, m]) => ({ id, label: m.label, desc: m.desc || "", default: m.default !== false }));
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
