// Descarga en el build el prompt operativo de FromE Chat y sus huellas desde el
// repositorio privado, y genera las marcas canario de este despliegue.
// Requiere GOVERNANCE_TOKEN (token de GitHub de solo lectura sobre ese repositorio).
// Nada de lo que escribe este script se versiona aquí (ver .gitignore).

import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { randomInt } from "node:crypto";

const REPO = process.env.GOVERNANCE_REPO || "FromE-Labs/from-e-architecture";
const PATH = process.env.GOVERNANCE_PATH || "runtime/fromechat";
const REF = process.env.GOVERNANCE_REF || "main";
const TOKEN = process.env.GOVERNANCE_TOKEN;
const OUT = new URL("../governance/", import.meta.url);
const FILES = ["runtime.md", "fingerprints.json"];

// Palabra inventada y pronunciable: sobrevive a una traducción como si fuera un nombre propio.
function canaryWord() {
  const c = "bdfgklmnprstvz", v = "aeiou";
  let w = "";
  for (let i = 0; i < 5; i++) w += c[randomInt(c.length)] + v[randomInt(v.length)];
  return w;
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const present = FILES.every((f) => existsSync(new URL(f, OUT)));
  if (present && !TOKEN) {
    console.log("governance: archivos locales presentes, no se descarga.");
  } else {
    if (!TOKEN) {
      console.error("governance: falta GOVERNANCE_TOKEN y no hay archivos locales. El prompt gobernado no puede componerse.");
      process.exit(1);
    }
    const headers = { authorization: `Bearer ${TOKEN}`, accept: "application/vnd.github.raw+json", "user-agent": "fromechat-build" };
    for (const f of FILES) {
      const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${PATH}/${f}?ref=${encodeURIComponent(REF)}`, { headers });
      if (!r.ok) {
        console.error(`governance: GitHub ${r.status} al descargar ${PATH}/${f}@${REF}`);
        process.exit(1);
      }
      await writeFile(new URL(f, OUT), await r.text(), "utf8");
    }
    console.log(`governance: ${FILES.length} archivos descargados de ${REPO}@${REF}.`);
  }
  const canaries = Array.from({ length: 4 }, canaryWord);
  await writeFile(new URL("canary.json", OUT), JSON.stringify({ build: new Date().toISOString(), canaries }), "utf8");
  console.log("governance: marcas canario generadas para este despliegue.");
}
main();
