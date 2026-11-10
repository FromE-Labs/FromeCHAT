// Estado sellado del ciclo. Entre una etapa y la siguiente, el servidor entrega al
// navegador el estado intermedio (borrador, notas de trabajo, contadores) cifrado y
// autenticado con una clave que solo existe en el servidor. El navegador lo devuelve
// tal cual en la siguiente petición: no puede leerlo, alterarlo ni reutilizarlo con
// otra conversación.

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { deflateRawSync, inflateRawSync } from "node:zlib";

export const STATE_TTL_MS = 15 * 60 * 1000;
const MAX_TOKEN_CHARS = 400_000;

export function bindingOf(model, messages) {
  return createHash("sha256").update(model + "\n" + JSON.stringify(messages)).digest("base64url");
}

export function seal(key, obj) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([c.update(deflateRawSync(Buffer.from(JSON.stringify(obj), "utf8"))), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), data]).toString("base64url");
}

// Devuelve el objeto o null si el sello no es válido.
export function unseal(key, token) {
  if (typeof token !== "string" || token.length < 40 || token.length > MAX_TOKEN_CHARS) return null;
  try {
    const raw = Buffer.from(token, "base64url");
    const d = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(12, 28));
    const data = Buffer.concat([d.update(raw.subarray(28)), d.final()]);
    return JSON.parse(inflateRawSync(data, { maxOutputLength: 4_000_000 }).toString("utf8"));
  } catch {
    return null;
  }
}
