// Barrera de servidor de FromE Chat.
//  - Entrada: detección de intentos de obtener las instrucciones del sistema.
//  - Salida: filtro que retiene el final de la respuesta mientras se genera y la corta
//    si reproduce el prompt operativo (literal, con símbolos intercalados, invertido,
//    en leetspeak, con desplazamiento César, en base64/hex), si contiene una marca
//    canario o si acumula huellas de una traducción o paráfrasis.
// Este código es público a propósito: su seguridad no depende de ocultarlo. El
// material que protege (prompt, canarios, huellas) no está en el repositorio.

export const K = 40; // longitud del fragmento normalizado que cuenta como coincidencia
export const HOLD = 480; // caracteres finales que se retienen hasta haberlos comprobado

const LEET = { 0: "o", 1: "i", 3: "e", 4: "a", 5: "s", 7: "t" };

// Solo letras a–z: sin acentos, sin mayúsculas, sin símbolos ni espacios.
export function hardNorm(s) {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[013457]/g, (d) => LEET[d])
    .replace(/[^a-z]/g, "");
}

// Palabras separadas por un espacio, sin acentos ni puntuación.
export function softNorm(s) {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function caesar(s, shift) {
  if (!shift) return s;
  let out = "";
  for (let i = 0; i < s.length; i++) out += String.fromCharCode(((s.charCodeAt(i) - 97 + shift) % 26) + 97);
  return out;
}

// Conjunto con todos los fragmentos de K letras del prompt, en los 26 desplazamientos
// César (el 13 es ROT13) y también invertidos.
export function buildShingles(prompt) {
  const base = hardNorm(prompt);
  const set = new Set();
  for (let shift = 0; shift < 26; shift++) {
    const t = caesar(base, shift);
    const r = t.split("").reverse().join("");
    for (let i = 0; i + K <= t.length; i++) {
      set.add(t.slice(i, i + K));
      set.add(r.slice(i, i + K));
    }
  }
  return set;
}

function decodeCandidates(raw) {
  const out = [];
  for (const m of raw.matchAll(/[A-Za-z0-9+/_-]{80,}={0,2}/g)) {
    try {
      out.push(Buffer.from(m[0].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
    } catch {}
  }
  for (const m of raw.matchAll(/(?:[0-9a-fA-F]{2}[\s:,]?){60,}/g)) {
    try {
      out.push(Buffer.from(m[0].replace(/[^0-9a-fA-F]/g, ""), "hex").toString("utf8"));
    } catch {}
  }
  return out;
}

export class LeakFilter {
  constructor({ shingles, canaries = [], fingerprints = { threshold: 4, groups: [] }, hold = HOLD }) {
    this.shingles = shingles;
    this.canaries = canaries.map(hardNorm).filter((c) => c.length >= 6);
    this.canariesRev = this.canaries.map((c) => c.split("").reverse().join(""));
    this.groups = (fingerprints.groups || []).map((g) => g.map((p) => ` ${softNorm(p)} `));
    this.threshold = fingerprints.threshold || 4;
    this.hold = hold;
    this.raw = "";
    this.norm = "";
    this.checked = 0; // posición en norm hasta la que ya se comprobaron fragmentos
    this.released = 0; // posición en raw ya entregada
    this.sinceDeep = 0;
    this.blocked = null;
  }

  _shingleHit(text, from = 0) {
    for (let i = Math.max(0, from); i + K <= text.length; i++) if (this.shingles.has(text.slice(i, i + K))) return true;
    return false;
  }

  _check(final) {
    // 1. Fragmentos del prompt (cubre literal, intercalado, invertido, leet y César).
    if (this._shingleHit(this.norm, this.checked - K + 1)) return "shingle";
    this.checked = this.norm.length;
    // 2. Marcas canario.
    const tail = this.norm.slice(-(this.hold * 2 + 64));
    for (let i = 0; i < this.canaries.length; i++) {
      if (tail.includes(this.canaries[i]) || tail.includes(this.canariesRev[i])) return "canary";
    }
    // 3. Comprobaciones más caras, cada cierto volumen de texto y al final.
    if (final || this.sinceDeep >= 300) {
      this.sinceDeep = 0;
      for (const decoded of decodeCandidates(this.raw)) {
        const n = hardNorm(decoded);
        if (this._shingleHit(n)) return "encoded";
        for (const c of this.canaries) if (n.includes(c)) return "canary";
      }
      const soft = ` ${softNorm(this.raw)} `;
      let hits = 0;
      for (const g of this.groups) if (g.some((p) => soft.includes(p))) hits++;
      if (hits >= this.threshold) return "fingerprint";
    }
    return null;
  }

  // Devuelve el texto que ya puede entregarse. Si detecta una fuga, this.blocked
  // pasa a indicar el motivo y no se entrega nada más.
  push(text) {
    if (this.blocked) return "";
    this.raw += text;
    this.norm += hardNorm(text);
    this.sinceDeep += text.length;
    const reason = this._check(false);
    if (reason) {
      this.blocked = reason;
      return "";
    }
    const upTo = this.raw.length - this.hold;
    if (upTo <= this.released) return "";
    const out = this.raw.slice(this.released, upTo);
    this.released = upTo;
    return out;
  }

  end() {
    if (this.blocked) return "";
    const reason = this._check(true);
    if (reason) {
      this.blocked = reason;
      return "";
    }
    const out = this.raw.slice(this.released);
    this.released = this.raw.length;
    return out;
  }
}

// --- Entrada -------------------------------------------------------------------

// Patrones de alta precisión. Lo ambiguo lo decide el clasificador.
const PROBE_PATTERNS = [
  /\bsystem ?prompt\b|\bprompt (del|de|du) (sistema|systeme)\b|\bprompt systeme\b|\bsystem message\b|\bmensaje (de|del) sistema\b/,
  /\b(initial|hidden|internal|original|secret|underlying) (instructions?|prompt|rules|directives|guidelines)\b/,
  /\binstrucciones (iniciales|ocultas|internas|originales|secretas|de sistema|del sistema)\b|\binstructions (initiales|cachees|internes|systeme|d origine)\b/,
  /\bignore (all |any )?(of )?(the |your )?(previous|prior|above|earlier)\b|\bdisregard (all |any )?(the |your )?(previous|prior|above)\b/,
  /\b(ignora|olvida|omite) (todas? )?(las |tus )?(instrucciones|reglas|ordenes)( anteriores| previas)?\b|\bignore[sz]? (toutes )?(les |tes |vos )?instructions\b/,
  /\brepeat (all |everything |the (text|words|content) )?(above|before)\b|\b(repite|repetir|reproduce) (todo )?(el texto|lo|el contenido) (anterior|de arriba|previo)\b/,
  /\beverything (above|before) (this|here)\b|\btodo lo (anterior|que hay antes)( a| de)? este mensaje\b|\btext above this\b/,
  /\bdeveloper mode\b|\bmodo desarrollador\b|\bdan mode\b|\bjailbreak\b/,
];

export function heuristicProbe(text) {
  const soft = softNorm(text);
  return PROBE_PATTERNS.some((re) => re.test(soft));
}

// Informe del filtro sobre un texto completo: motivo de bloqueo (o null) y cuántos
// grupos de huella aparecen. Lo usa la entrada de pruebas para dar una medida objetiva.
export function inspect(g, text) {
  const f = new LeakFilter(g);
  f.push(text);
  f.end();
  const soft = ` ${softNorm(text)} `;
  // which: posiciones de los grupos que aparecen (el número, nunca la frase).
  const which = [];
  f.groups.forEach((grp, i) => { if (grp.some((p) => soft.includes(p))) which.push(i); });
  return { blocked: f.blocked, hits: which.length, which, threshold: f.threshold };
}
