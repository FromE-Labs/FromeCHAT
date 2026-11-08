import test from "node:test";
import assert from "node:assert/strict";
import { governedSystemPrompt, moduleCount } from "../netlify/functions/lib/governance.mjs";

test("compone los 7 módulos Open Core con caché", async () => {
  assert.equal(await moduleCount(), 7);
  const sys = await governedSystemPrompt();
  assert.equal(sys.length, 2);
  assert.ok(sys[0].text.includes("From E™"));
  assert.deepEqual(sys[1].cache_control, { type: "ephemeral" });
  for (const name of ["Invariant Coherence", "Internal Editor", "Extreme Thinking", "Symbolic Echo Cleaner", "Constructive Loop", "RTN Rule", "Core Self-Validator"]) {
    assert.ok(sys[1].text.includes(name), name);
  }
  // Ninguna referencia a módulos propietarios en el prompt
  for (const p of ["SHADOWSTACK", "Alcubierre", "C.E.P.", "Dimensional Map"]) assert.ok(!sys[1].text.includes(p), p);
});
