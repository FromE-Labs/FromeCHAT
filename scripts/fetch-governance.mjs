// Descarga las especificaciones Open Core de From E™ desde el repositorio privado
// en el momento del build. Requiere en Netlify la variable GOVERNANCE_TOKEN
// (token de GitHub de solo lectura sobre FromE-Labs/from-e-architecture).
// En desarrollo local, si governance/ ya tiene los .md, no hace nada.

import { mkdir, readdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";

const REPO = process.env.GOVERNANCE_REPO || "FromE-Labs/from-e-architecture";
const PATH = process.env.GOVERNANCE_PATH || "architecture/open-core";
const REF = process.env.GOVERNANCE_REF || "main";
const TOKEN = process.env.GOVERNANCE_TOKEN;
const OUT = new URL("../governance/", import.meta.url);

async function main() {
  await mkdir(OUT, { recursive: true });
  const have = existsSync(OUT) ? (await readdir(OUT)).filter((f) => /^\d{2}-.*\.md$/.test(f)) : [];
  if (have.length >= 7 && !process.env.GOVERNANCE_FORCE) {
    console.log(`governance: ${have.length} módulos ya presentes, no se descarga.`);
    return;
  }
  if (!TOKEN) {
    console.error("governance: falta GOVERNANCE_TOKEN y no hay módulos locales. El prompt gobernado no puede componerse.");
    process.exit(1);
  }
  const headers = { authorization: `Bearer ${TOKEN}`, accept: "application/vnd.github+json", "user-agent": "fromechat-build" };
  const list = await fetch(`https://api.github.com/repos/${REPO}/contents/${PATH}?ref=${REF}`, { headers });
  if (!list.ok) { console.error(`governance: GitHub ${list.status} al listar ${REPO}/${PATH}`); process.exit(1); }
  const files = (await list.json()).filter((f) => f.type === "file" && /^\d{2}-.*\.md$/.test(f.name));
  if (files.length === 0) { console.error("governance: no se han encontrado módulos."); process.exit(1); }
  for (const f of files) {
    const r = await fetch(f.download_url, { headers: { authorization: `Bearer ${TOKEN}`, "user-agent": "fromechat-build" } });
    if (!r.ok) { console.error(`governance: ${r.status} al descargar ${f.name}`); process.exit(1); }
    await writeFile(new URL(f.name, OUT), await r.text(), "utf8");
  }
  console.log(`governance: ${files.length} módulos descargados de ${REPO}@${REF}.`);
}
main();
