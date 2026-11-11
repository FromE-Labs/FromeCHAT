import { MODELS } from "./chat.mjs";

export default async () =>
  new Response(
    JSON.stringify({
      models: Object.entries(MODELS).map(([id, m]) => ({ id, label: m.label })),
      openCoreModules: 7,
      maxOutputTokens: 3000,
      effort: process.env.MODEL_EFFORT || "low",
      architecture: "From E™",
      spec: "https://doi.org/10.5281/zenodo.19041459",
    }),
    { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=3600" } }
  );

export const config = { path: "/api/models" };
