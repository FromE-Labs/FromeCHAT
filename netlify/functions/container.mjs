// Contenedor de arquitectura.
//
// Hace una sola cosa: enviar al modelo, como instrucciones de sistema, el texto que la
// autora ha escrito y guardado con su usuario y su contraseña. No añade, no quita y no
// reordena nada de ese texto. Cada respuesta va acompañada de la petición exacta que
// salió hacia el proveedor, para que pueda comprobarse.
//
// Lo que NO hay aquí: ni reglas, ni filtros, ni módulos, ni comprobaciones previas, ni
// texto propio que acompañe al de la autora. Este archivo no contiene arquitectura.
//
// Dónde vive cada cosa:
//   - El texto de la autora se guarda cifrado (AES-256-GCM) con una clave que solo se
//     puede abrir con su contraseña. La contraseña no se guarda: se guarda un derivado
//     que sirve para comprobarla y no para abrir el texto. Sin la contraseña, lo
//     guardado no se puede leer; si se olvida, no se puede recuperar.
//   - La sesión es una galleta sellada que lleva dentro la clave ya abierta. Vive en el
//     navegador de la autora y caduca a las doce horas.
//   - La conversación no se guarda en el servidor y nada de su contenido se registra.
//
// Rutas, todas bajo /contenedor:
//   GET  /                     página
//   GET  /alta/<contraseña de alta>   página en modo alta (solo si aún no hay cuenta)
//   GET  /api/estado           qué hay: cuenta, sesión, texto guardado
//   POST /api/alta             { token, user, pass }        crea la única cuenta
//   POST /api/entrar           { user, pass }
//   POST /api/salir
//   GET  /api/arquitectura[?v=huella]   texto actual o una versión anterior
//   PUT  /api/arquitectura     { text }                     guarda una versión nueva
//   GET  /api/modelos          modelos que ofrece el proveedor para la clave en uso
//   POST /api/mensaje          { model, max_tokens, effort?, bare?, messages, key? }

import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { getStore } from "@netlify/blobs";
import { PAGE } from "./lib/container-page.mjs";

const ANTHROPIC = "https://api.anthropic.com/v1";
const VERSION = "2023-06-01";
const COOKIE = "fe_cont";
const SESSION_MS = 12 * 60 * 60 * 1000;
const BUDGET_MS = Number(process.env.CONTAINER_BUDGET_MS) || 55000; // la plataforma corta a los 60 s
const MAX_TEXT = 400000; // caracteres del texto de la autora
const MAX_TALK = 600000; // caracteres de la conversación enviada
const KEEP_VERSIONS = 20;
const MAX_FAILS = 8;
const FAIL_WINDOW_MS = 15 * 60 * 1000;
const EFFORTS = new Set(["low", "medium", "high"]);

const defaultStore = () => getStore({ name: "container", consistency: "strong" });
const sha = (s) => createHash("sha256").update(s, "utf8").digest("hex");
const json = (status, body, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers } });
const fail = (status, message) => json(status, { error: message });

// --- cifrado -------------------------------------------------------------------

function seal(key, plain) {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64url");
}
function open(key, packed) {
  try {
    const raw = Buffer.from(String(packed), "base64url");
    const d = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([d.update(raw.subarray(28)), d.final()]);
  } catch {
    return null;
  }
}
// De la contraseña salen dos mitades: una abre la clave del texto y no se guarda; la
// otra solo sirve para comprobar la contraseña y es la que se guarda.
function derive(pass, saltHex) {
  const k = scryptSync(String(pass).normalize("NFKC"), Buffer.from(saltHex, "hex"), 64, { N: 32768, r: 8, p: 1, maxmem: 96 * 1024 * 1024 });
  return { kek: k.subarray(0, 32), verifier: k.subarray(32).toString("hex") };
}
function same(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

// --- almacén -------------------------------------------------------------------

async function read(store, key) {
  try {
    const raw = await store.get(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
const write = (store, key, value) => store.set(key, JSON.stringify(value));

// --- sesión --------------------------------------------------------------------

function cookieOf(req) {
  const m = (req.headers.get("cookie") || "").match(new RegExp("(?:^|;\\s*)" + COOKIE + "=([^;]+)"));
  return m ? m[1] : "";
}
async function session(req, store) {
  const packed = cookieOf(req);
  if (!packed) return null;
  const secret = await read(store, "secret");
  if (!secret?.hex) return null;
  const plain = open(Buffer.from(secret.hex, "hex"), packed);
  if (!plain) return null;
  let s;
  try {
    s = JSON.parse(plain.toString("utf8"));
  } catch {
    return null;
  }
  if (!s || s.exp < Date.now() || typeof s.dek !== "string") return null;
  const account = await read(store, "account");
  if (!account || account.user !== s.u || account.epoch !== s.e) return null;
  return { user: s.u, dek: Buffer.from(s.dek, "hex") };
}
function setCookie(value, maxAge) {
  return `${COOKIE}=${value}; Path=/contenedor; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}
async function grant(store, account, dek) {
  const secret = await read(store, "secret");
  const token = seal(Buffer.from(secret.hex, "hex"), Buffer.from(JSON.stringify({ u: account.user, e: account.epoch, exp: Date.now() + SESSION_MS, dek: dek.toString("hex") })));
  return json(200, { ok: true, user: account.user }, { "set-cookie": setCookie(token, Math.floor(SESSION_MS / 1000)) });
}

// --- cuenta --------------------------------------------------------------------

const setupToken = () => (process.env.CONTAINER_SETUP_TOKEN || process.env.SELFTEST_TOKEN || "").trim();
const validSetup = (given) => {
  const t = setupToken();
  return t.length >= 20 && same(given || "", t);
};
const validUser = (u) => typeof u === "string" && /^[A-Za-z0-9._@-]{3,60}$/.test(u);
const validPass = (p) => typeof p === "string" && p.length >= 10 && p.length <= 200;

async function signup(req, store) {
  const b = await body(req);
  if (!b) return fail(400, "Petición no válida.");
  if (await read(store, "account")) return fail(409, "Ya hay una cuenta. El contenedor tiene una sola.");
  if (!validSetup(b.token)) return fail(403, "La dirección de alta no es válida.");
  if (!validUser(b.user)) return fail(400, "El usuario admite letras, números, punto, guion y arroba; entre 3 y 60 caracteres.");
  if (!validPass(b.pass)) return fail(400, "La contraseña necesita al menos 10 caracteres.");
  const salt = randomBytes(16).toString("hex");
  const { kek, verifier } = derive(b.pass, salt);
  const dek = randomBytes(32);
  const account = { user: b.user, salt, verifier, wrapped: seal(kek, dek), epoch: randomBytes(8).toString("hex"), created: new Date().toISOString() };
  await write(store, "secret", { hex: randomBytes(32).toString("hex") });
  await write(store, "account", account);
  return grant(store, account, dek);
}

async function login(req, store) {
  const b = await body(req);
  if (!b) return fail(400, "Petición no válida.");
  const account = await read(store, "account");
  if (!account) return fail(404, "Todavía no hay cuenta.");
  const fails = (await read(store, "fails")) || { n: 0, since: 0 };
  const fresh = Date.now() - fails.since > FAIL_WINDOW_MS;
  if (!fresh && fails.n >= MAX_FAILS) return fail(429, "Demasiados intentos. Espera un cuarto de hora.");
  const { kek, verifier } = derive(typeof b.pass === "string" ? b.pass : "", account.salt);
  const dek = same(String(b.user || ""), account.user) && same(verifier, account.verifier) ? open(kek, account.wrapped) : null;
  if (!dek) {
    await write(store, "fails", fresh ? { n: 1, since: Date.now() } : { n: fails.n + 1, since: fails.since });
    return fail(401, "Usuario o contraseña incorrectos.");
  }
  if (fails.n) await write(store, "fails", { n: 0, since: 0 });
  return grant(store, account, dek);
}

// --- texto de la autora --------------------------------------------------------

// Devuelve { text, at, sha, chars } o null. v: huella de una versión anterior.
async function loadText(store, dek, v) {
  const arch = await read(store, "arch");
  if (!arch?.versions?.length) return null;
  const entry = v ? arch.versions.find((x) => x.sha === v) : arch.versions[0];
  if (!entry) return null;
  const plain = open(dek, entry.sealed);
  if (!plain) return null;
  return { text: plain.toString("utf8"), at: entry.at, sha: entry.sha, chars: entry.chars };
}
const listVersions = (arch) => (arch?.versions || []).map((x) => ({ at: x.at, sha: x.sha, chars: x.chars }));

async function textRoute(req, store, s, url) {
  if (req.method === "GET") {
    const cur = await loadText(store, s.dek, url.searchParams.get("v") || "");
    const arch = await read(store, "arch");
    return json(200, { text: cur?.text ?? "", at: cur?.at ?? null, sha: cur?.sha ?? null, versions: listVersions(arch) });
  }
  if (req.method !== "PUT") return fail(405, "Método no admitido.");
  const b = await body(req);
  if (!b || typeof b.text !== "string") return fail(400, "Falta el texto.");
  if (b.text.length > MAX_TEXT) return fail(413, `El texto admite hasta ${MAX_TEXT} caracteres.`);
  // Se guarda exactamente lo recibido: ni se recorta ni se normaliza.
  const entry = { at: new Date().toISOString(), sha: sha(b.text), chars: b.text.length, sealed: seal(s.dek, Buffer.from(b.text, "utf8")) };
  const arch = (await read(store, "arch")) || { versions: [] };
  if (arch.versions[0]?.sha === entry.sha) return json(200, { ok: true, at: arch.versions[0].at, sha: entry.sha, versions: listVersions(arch), unchanged: true });
  arch.versions = [entry, ...arch.versions.filter((x) => x.sha !== entry.sha)].slice(0, KEEP_VERSIONS);
  await write(store, "arch", arch);
  return json(200, { ok: true, at: entry.at, sha: entry.sha, versions: listVersions(arch) });
}

// --- proveedor -----------------------------------------------------------------

const serverKey = () => (process.env.CONTAINER_KEY || process.env.SELFTEST_KEY || "").trim();
const validKey = (k) => typeof k === "string" && /^sk-ant-[A-Za-z0-9_-]{20,}$/.test(k);
const pickKey = (given) => serverKey() || (validKey(given) ? given : "");
const validModel = (m) => typeof m === "string" && /^claude-[a-z0-9.-]{3,60}$/.test(m);

async function modelsRoute(req) {
  const key = pickKey(req.headers.get("x-provider-key") || "");
  if (!key) return json(200, { models: [], needKey: true });
  try {
    const r = await fetch(`${ANTHROPIC}/models?limit=100`, { headers: { "x-api-key": key, "anthropic-version": VERSION } });
    if (!r.ok) return json(200, { models: [], status: r.status });
    const data = await r.json();
    return json(200, { models: (data?.data || []).map((m) => ({ id: m.id, name: m.display_name || m.id })) });
  } catch {
    return json(200, { models: [] });
  }
}

function cleanMessages(raw) {
  if (!Array.isArray(raw) || !raw.length || raw.length > 400) return null;
  let total = 0;
  const out = [];
  for (const m of raw) {
    if (!m || (m.role !== "user" && m.role !== "assistant") || typeof m.content !== "string" || !m.content.trim()) return null;
    total += m.content.length;
    out.push({ role: m.role, content: m.content });
  }
  if (total > MAX_TALK || out[0].role !== "user" || out[out.length - 1].role !== "user") return null;
  return out;
}

// La petición que sale hacia el proveedor. Es lo único que este contenedor construye:
// el texto de la autora, entero y en un solo bloque, y la conversación.
export function buildRequest({ model, maxTokens, effort, text, messages }) {
  const req = { model, max_tokens: maxTokens, messages, stream: true };
  // cache_control no cambia lo que recibe el modelo: pide al proveedor que no vuelva a
  // cobrar entero un texto que ya ha visto hace unos minutos.
  if (text) req.system = [{ type: "text", text, cache_control: { type: "ephemeral" } }];
  if (effort) req.output_config = { effort };
  return req;
}

async function messageRoute(req, store, s) {
  const b = await body(req);
  if (!b) return fail(400, "Petición no válida.");
  const key = pickKey(b.key);
  if (!key) return fail(400, "Falta una clave de API de Anthropic válida (empieza por sk-ant-).");
  if (!validModel(b.model)) return fail(400, "Modelo no válido.");
  const messages = cleanMessages(b.messages);
  if (!messages) return fail(400, "La conversación no es válida: tiene que empezar y acabar con un mensaje tuyo.");
  const maxTokens = Math.min(Math.max(Number(b.max_tokens) || 4096, 256), 32000);
  const effort = EFFORTS.has(b.effort) ? b.effort : "";
  let saved = null;
  if (b.bare !== true) {
    saved = await loadText(store, s.dek, "");
    if (!saved || !saved.text) return fail(409, "No hay arquitectura guardada. Escríbela y guárdala primero, o envía «sin arquitectura».");
  }
  const request = buildRequest({ model: b.model, maxTokens, effort, text: saved?.text || "", messages });
  const t0 = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), BUDGET_MS);
  let upstream;
  try {
    upstream = await fetch(`${ANTHROPIC}/messages`, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": VERSION },
      body: JSON.stringify(request),
    });
  } catch {
    clearTimeout(timer);
    return fail(504, "El proveedor no ha respondido a tiempo.");
  }
  if (!upstream.ok || !upstream.body) {
    clearTimeout(timer);
    // El error del proveedor se devuelve tal cual: aquí no se reintenta con otros parámetros.
    let message = "";
    try { message = (await upstream.json())?.error?.message || ""; } catch {}
    return json(502, { error: message || "El proveedor ha rechazado la petición.", status: upstream.status, sent: request });
  }

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(out) {
      const send = (ev) => out.enqueue(enc.encode(`data: ${JSON.stringify(ev)}\n\n`));
      // Primero, lo enviado: la petición exacta, sin la clave.
      send({ type: "sent", request, sha: saved?.sha || null, saved_at: saved?.at || null });
      const usage = { input: 0, output: 0, cache_read: 0, cache_write: 0 };
      let stop = null;
      let cut = false;
      let thinking = false;
      const reader = upstream.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf("\n\n")) >= 0) {
            const line = buf.slice(0, i).split("\n").find((l) => l.startsWith("data: "));
            buf = buf.slice(i + 2);
            if (!line) continue;
            let ev;
            try { ev = JSON.parse(line.slice(6)); } catch { continue; }
            if (ev.type === "message_start" && ev.message?.usage) {
              const u = ev.message.usage;
              usage.input = u.input_tokens || 0;
              usage.cache_read = u.cache_read_input_tokens || 0;
              usage.cache_write = u.cache_creation_input_tokens || 0;
            } else if (ev.type === "content_block_delta" && ev.delta?.type === "text_delta") {
              send({ type: "t", text: ev.delta.text });
            } else if (ev.type === "content_block_delta" && ev.delta?.type === "thinking_delta" && !thinking) {
              thinking = true;
              send({ type: "thinking" });
            } else if (ev.type === "message_delta") {
              if (ev.delta?.stop_reason) stop = ev.delta.stop_reason;
              if (ev.usage?.output_tokens) usage.output = ev.usage.output_tokens;
            } else if (ev.type === "error") {
              send({ type: "error", message: ev.error?.message || "error del proveedor" });
            }
          }
        }
      } catch {
        cut = true;
      } finally {
        clearTimeout(timer);
      }
      if (cut) send({ type: "cut", after_ms: Date.now() - t0 });
      send({ type: "done", usage, stop, ms: Date.now() - t0 });
      out.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" } });
}

// --- entrada -------------------------------------------------------------------

async function body(req) {
  try {
    const b = await req.json();
    return b && typeof b === "object" ? b : null;
  } catch {
    return null;
  }
}

const PAGE_HEADERS = {
  "content-type": "text/html; charset=utf-8",
  "cache-control": "no-store",
  "x-robots-tag": "noindex, nofollow",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "content-security-policy": "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};

export default async (req, context, injected) => {
  const store = injected || defaultStore();
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/contenedor\/?/, "").replace(/\/+$/, "");

  if (!path.startsWith("api/")) {
    if (req.method !== "GET") return fail(405, "Método no admitido.");
    // /alta/<contraseña de alta>: la página arranca en modo alta. No se comprueba aquí
    // nada más: quien decide si el alta procede es /api/alta.
    const setup = path.startsWith("alta/") ? path.slice(5) : "";
    if (path && !setup) return new Response("Not found", { status: 404 });
    return new Response(PAGE.replace("__SETUP__", () => JSON.stringify(setup).replace(/</g, "\\u003c")), { status: 200, headers: PAGE_HEADERS });
  }

  const action = path.slice(4);
  // Las peticiones que cambian algo llevan una cabecera propia: un formulario de otra
  // web no puede ponerla.
  if (req.method !== "GET" && req.headers.get("x-contenedor") !== "1") return fail(403, "Petición no admitida.");

  if (action === "estado" && req.method === "GET") {
    const account = await read(store, "account");
    const s = account ? await session(req, store) : null;
    const arch = s ? await read(store, "arch") : null;
    return json(200, { account: Boolean(account), user: s?.user || null, saved: arch?.versions?.[0] ? { at: arch.versions[0].at, sha: arch.versions[0].sha, chars: arch.versions[0].chars } : null, serverKey: Boolean(serverKey()) });
  }
  if (action === "alta" && req.method === "POST") return signup(req, store);
  if (action === "entrar" && req.method === "POST") return login(req, store);
  if (action === "salir" && req.method === "POST") return json(200, { ok: true }, { "set-cookie": setCookie("", 0) });

  const s = await session(req, store);
  if (!s) return fail(401, "Sesión no iniciada o caducada.");
  if (action === "arquitectura") return textRoute(req, store, s, url);
  if (action === "modelos" && req.method === "GET") return modelsRoute(req);
  if (action === "mensaje" && req.method === "POST") return messageRoute(req, store, s);
  return fail(404, "No existe.");
};

export const config = {
  path: ["/contenedor", "/contenedor/*"],
  rateLimit: { windowLimit: 120, windowSize: 60, aggregateBy: ["ip", "domain"] },
};
