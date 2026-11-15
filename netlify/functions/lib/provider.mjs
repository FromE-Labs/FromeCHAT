// Llamadas al proveedor con la clave del usuario, sobre el AI SDK.
//
// El AI SDK se ocupa de hablar con el proveedor: formato de la petición, flujo de
// respuesta, recuento de tokens y caché de instrucciones. Aquí queda solo lo propio:
// la clave del usuario, el nivel de razonamiento, el corte por tiempo y la traducción
// de los errores.
//
// La clave viaja solo en la cabecera de cada petición: no se registra, no se guarda y
// no se devuelve. Los objetos de error del SDK llevan dentro el cuerpo de la petición,
// con las instrucciones: nunca se reenvían ni se registran; de ellos se extrae solo el
// código de estado y el mensaje del proveedor.

import { streamText, generateText, APICallError } from "ai";
import { createAnthropic } from "@ai-sdk/anthropic";

// Nivel de razonamiento previo. Estos modelos piensan antes de responder y, mientras
// piensan, no envían texto; ese tiempo y esos tokens cuentan dentro del límite de la
// llamada. Se pide el nivel mínimo, igual en la respuesta directa y en cada etapa del
// ciclo, para que ambas quepan en el tiempo de ejecución de la plataforma.
export const EFFORT = process.env.MODEL_EFFORT || "low";
const noEffort = new Set(); // modelos que han rechazado el parámetro

const useEffort = (model) => Boolean(EFFORT) && EFFORT !== "default" && !noEffort.has(model);
const effortOptions = (on) => (on ? { anthropic: { effort: EFFORT } } : undefined);

// Un proveedor por petición: la clave solo vive mientras dura la llamada. Para añadir
// otro proveedor basta con reconocer aquí su familia de modelos.
function languageModel(model, key) {
  return createAnthropic({ apiKey: key, fetch: (...args) => globalThis.fetch(...args) })(model);
}

// Las instrucciones llegan como bloques de texto; un bloque puede ir marcado para la
// caché del proveedor.
function instructionsOf(system) {
  if (!system) return undefined;
  if (typeof system === "string") return system;
  return system.map((b) => ({
    role: "system",
    content: b.text,
    ...(b.cache_control ? { providerOptions: { anthropic: { cacheControl: b.cache_control } } } : {}),
  }));
}

function describe(error) {
  if (APICallError.isInstance(error)) {
    const status = error.statusCode || 0;
    return {
      status,
      message: (typeof error.message === "string" && error.message) || "El proveedor no ha respondido.",
      auth: status === 401 || status === 403,
      retryable: status === 429 || status >= 500 || status === 0,
    };
  }
  return { status: 0, message: "El proveedor no ha respondido a tiempo.", auth: false, retryable: true };
}

const rejectsEffort = (error) =>
  APICallError.isInstance(error) && error.statusCode === 400 && /effort|output_config/i.test(String(error.message) + String(error.responseBody || ""));

// Abre el flujo y lee hasta saber si la llamada ha arrancado. Así un rechazo del
// proveedor se puede devolver como estado HTTP antes de empezar a escribir al navegador.
//   { ok: true, … } | { ok: false, error: { status, message, auth, retryable } }
export async function openStream({ key, model, system, messages, maxTokens, signal }) {
  const attempt = async (withEffort) => {
    const ctrl = new AbortController();
    if (signal) {
      if (signal.aborted) ctrl.abort();
      else signal.addEventListener("abort", () => ctrl.abort(), { once: true });
    }
    try {
      const result = streamText({
        model: languageModel(model, key),
        instructions: instructionsOf(system),
        messages,
        maxOutputTokens: maxTokens,
        abortSignal: ctrl.signal,
        maxRetries: 0,
        providerOptions: effortOptions(withEffort),
        onError: () => {},
      });
      const it = result.stream[Symbol.asyncIterator]();
      const pending = [];
      while (true) {
        const { done, value } = await it.next();
        if (done) break;
        if (value.type === "error") return { ok: false, raw: value.error };
        if (value.type === "abort") return { ok: false, raw: null };
        pending.push(value);
        if (value.type !== "start" && value.type !== "start-step") break;
      }
      return { ok: true, it, pending, ctrl };
    } catch (e) {
      return { ok: false, raw: e };
    }
  };
  let up = await attempt(useEffort(model));
  // Si el proveedor rechaza el parámetro de razonamiento, se repite la llamada sin él.
  if (!up.ok && rejectsEffort(up.raw)) {
    noEffort.add(model);
    up = await attempt(false);
  }
  if (!up.ok) return { ok: false, error: describe(up.raw) };
  return up;
}

export async function upstreamError(upstream) {
  return upstream.error || describe(null);
}

// Lee el flujo abierto. Devuelve { usage, truncated, failed, stop }.
//  - onText(texto) puede devolver false para dejar de leer.
//  - deadline (ms epoch): al alcanzarlo se deja de leer y truncated pasa a true.
export async function readStream(upstream, { onText, onUsage, deadline }) {
  const usage = { input: 0, output: 0 };
  let truncated = false;
  let failed = null;
  let stop = null;
  let timer = null;
  if (deadline) {
    timer = setTimeout(() => {
      truncated = true;
      upstream.ctrl.abort();
    }, Math.max(0, deadline - Date.now()));
  }
  const setUsage = (u) => {
    if (!u) return;
    if (typeof u.inputTokens === "number") usage.input = u.inputTokens;
    if (typeof u.outputTokens === "number") usage.output = u.outputTokens;
    // De esa entrada, cuánto se ha leído de la caché del proveedor y cuánto se ha escrito en ella.
    if (u.inputTokenDetails?.cacheReadTokens) usage.cached = u.inputTokenDetails.cacheReadTokens;
    if (u.inputTokenDetails?.cacheWriteTokens) usage.cacheWrite = u.inputTokenDetails.cacheWriteTokens;
    onUsage?.(usage);
  };
  // Devuelve false para dejar de leer.
  const handle = (part) => {
    if (part.type === "text-delta") {
      if (onText(part.text) === false) {
        upstream.ctrl.abort();
        return false;
      }
    } else if (part.type === "custom" && part.kind === "anthropic.message_start") {
      // La entrada se conoce desde el principio; sirve si la respuesta se corta antes del final.
      const u = part.providerMetadata?.anthropic?.usage;
      if (u) {
        usage.input = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
        if (u.cache_read_input_tokens) usage.cached = u.cache_read_input_tokens;
        if (u.cache_creation_input_tokens) usage.cacheWrite = u.cache_creation_input_tokens;
        onUsage?.(usage);
      }
    } else if (part.type === "finish-step" || part.type === "finish") {
      setUsage(part.usage || part.totalUsage);
      if (part.finishReason && part.finishReason !== "error") stop = part.rawFinishReason || (part.finishReason === "length" ? "max_tokens" : part.finishReason);
    } else if (part.type === "error") {
      failed = (APICallError.isInstance(part.error) && part.error.message) || "Se ha interrumpido la respuesta.";
    } else if (part.type === "abort") {
      // Solo se aborta desde aquí: por tiempo. Lo escrito hasta ahora se conserva.
      truncated = true;
      return false;
    }
    return true;
  };
  try {
    let go = true;
    for (const part of upstream.pending) {
      if (!(go = handle(part))) break;
    }
    while (go) {
      const { done, value } = await upstream.it.next();
      if (done) break;
      if (!handle(value)) break;
    }
  } catch {
    if (!truncated) failed = failed || "Se ha interrumpido la respuesta.";
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (truncated) failed = null;
  return { usage, truncated, failed, stop };
}

// Llamada completa: devuelve el texto acumulado.
//   { ok: true, text, usage, truncated } | { ok: false, status, message, auth, retryable }
export async function callModel({ key, model, system, messages, maxTokens, deadline }) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), Math.max(0, deadline - Date.now()));
  const upstream = await openStream({ key, model, system, messages, maxTokens, signal: ctrl.signal });
  if (!upstream.ok) {
    clearTimeout(timer);
    return { ok: false, ...upstream.error };
  }
  let text = "";
  const r = await readStream(upstream, { onText: (t) => void (text += t), deadline });
  clearTimeout(timer);
  if (r.failed && !text) return { ok: false, status: 0, message: r.failed, auth: false, retryable: true };
  if (!text && (r.truncated || r.stop === "max_tokens")) {
    return { ok: false, status: 0, message: "El modelo no ha llegado a escribir la respuesta dentro del límite.", auth: false, retryable: true };
  }
  // Cortada: por tiempo, por fallo a mitad o por agotar el espacio de salida.
  return { ok: true, text, usage: r.usage, truncated: r.truncated || Boolean(r.failed) || r.stop === "max_tokens", stop: r.stop };
}

// Una pregunta breve sin flujo (la usa la comprobación de entrada).
//   { ok: true, text, usage } | { ok: false, status, message, auth, retryable }
export async function askOnce({ key, model, system, content, maxTokens, signal }) {
  const attempt = async (withEffort) => {
    try {
      const r = await generateText({
        model: languageModel(model, key),
        instructions: system,
        messages: [{ role: "user", content }],
        maxOutputTokens: maxTokens,
        abortSignal: signal,
        maxRetries: 0,
        providerOptions: effortOptions(withEffort),
      });
      return { ok: true, text: r.text || "", usage: { input: r.usage?.inputTokens || 0, output: r.usage?.outputTokens || 0 } };
    } catch (e) {
      return { ok: false, raw: e };
    }
  };
  let r = await attempt(useEffort(model));
  if (!r.ok && rejectsEffort(r.raw)) {
    noEffort.add(model);
    r = await attempt(false);
  }
  if (!r.ok) return { ok: false, ...describe(r.raw) };
  return r;
}
