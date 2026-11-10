// Sesiones consentidas para investigación.
// Se guarda solo lo que el usuario ha aceptado: la conversación, el modelo y la
// condición (con o sin arquitectura). Nunca la clave, ni IP, ni cabeceras, ni correo.
// Almacén: Netlify Blobs del propio sitio (región del sitio; se recomienda
// desplegar en la UE). Cada turno lleva un hash SHA-256 de su contenido para la
// cadena de evidencia.

import { getStore } from "@netlify/blobs";
import { createHash } from "node:crypto";

const STORE = "consented-sessions";

export async function recordTurn({ sessionId, model, route, messages, assistantText, usage }) {
  const store = getStore({ name: STORE, consistency: "strong" });
  const ts = new Date().toISOString();
  const turn = {
    schema: "frome-chat/turn/v1",
    ts,
    sessionId,
    model,
    condition: route === "governed" ? "from-e" : route === "public" ? "public-info" : "baseline",
    messages,
    assistant: assistantText,
    usage: usage || null,
  };
  const payload = JSON.stringify(turn);
  const hash = createHash("sha256").update(payload).digest("hex");
  const key = `${ts.slice(0, 10)}/${sessionId}/${ts.replace(/[:.]/g, "-")}.json`;
  await store.setJSON(key, { ...turn, sha256: hash });
  return hash;
}
