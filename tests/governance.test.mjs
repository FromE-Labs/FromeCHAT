import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

process.env.GOVERNANCE_DIR = fileURLToPath(new URL("./fixtures/governance", import.meta.url));
const { loadGovernance, governedSystem, PUBLIC_SYSTEM } = await import("../netlify/functions/lib/governance.mjs");

test("carga el prompt operativo e inserta las marcas canario", () => {
  const g = loadGovernance();
  assert.ok(!g.prompt.includes("{{C"));
  for (const c of g.canaries) assert.ok(g.prompt.includes(c));
  assert.equal(governedSystem().length, 1);
  assert.ok(g.shingles.size > 1000);
});

test("la ruta pública no contiene nada del prompt operativo", () => {
  const g = loadGovernance();
  const pub = PUBLIC_SYSTEM[0].text;
  for (const c of g.canaries) assert.ok(!pub.includes(c));
  assert.ok(!pub.includes("lantern"));
});
