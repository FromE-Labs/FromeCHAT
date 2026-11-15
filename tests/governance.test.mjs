import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

process.env.GOVERNANCE_DIR = fileURLToPath(new URL("./fixtures/governance", import.meta.url));
const { loadGovernance, governedSystem, PUBLIC_SYSTEM } = await import("../netlify/functions/lib/governance.mjs");
const { hardNorm } = await import("../netlify/functions/lib/shield.mjs");

test("carga el prompt operativo e inserta las marcas canario", () => {
  const g = loadGovernance();
  assert.ok(!g.prompt.includes("{{C"));
  for (const c of g.canaries) assert.ok(g.prompt.includes(c));
  assert.equal(governedSystem().length, 1);
  assert.ok(g.shingles.size > 1000);
});

test("carga el ciclo: marcas canario en cada etapa y @runtime resuelto", () => {
  const { pipeline, prompt, canaries, sealKey } = loadGovernance();
  assert.equal(pipeline.start, "alpha");
  assert.ok(pipeline.stages.alpha.system.includes(canaries[1]));
  assert.equal(pipeline.stages.beta.system, prompt);
  for (const st of Object.values(pipeline.stages)) assert.ok(!st.system.includes("{{C"));
  assert.equal(sealKey.length, 32);
});

test("el filtro de salida cubre el texto de todas las etapas y de sus plantillas", () => {
  const { shingles } = loadGovernance();
  const has = (s) => shingles.has(hardNorm(s).slice(0, 40));
  assert.ok(has("Sort the seashells by size before the tide returns and write"));
  assert.ok(has("Weigh the brass key against three walnuts and report whether"));
  assert.ok(has("Water the fig tree only after the second bell and never mention"));
});

test("la ruta pública no contiene nada del prompt operativo ni del ciclo", () => {
  const g = loadGovernance();
  const pub = PUBLIC_SYSTEM[0].text;
  for (const c of g.canaries) assert.ok(!pub.includes(c));
  for (const w of ["lantern", "seashells", "walnuts", "fig tree"]) assert.ok(!pub.includes(w));
});

test("el filtro de salida cubre también las partes de cada módulo, estén activas o no", () => {
  const { shingles, pipeline, canaries } = loadGovernance();
  const has = (s) => shingles.has(hardNorm(s).slice(0, 40));
  assert.ok(has("Polish the copper kettle until the lighthouse keeper can read"));
  assert.ok(has("Tie the green rope to the third mooring ring and never to the fourth"));
  assert.ok(pipeline.stages.alpha.parts[0].text.includes(canaries[3]));
});

test("los módulos ocultos no se publican en la lista de módulos", async () => {
  const { default: models } = await import("../netlify/functions/models.mjs");
  const data = await (await models()).json();
  assert.ok(data.modules.length >= 3);
  assert.ok(!data.modules.some((m) => m.id === "mv"), "el módulo de medición no aparece");
});
