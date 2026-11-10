import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

// Presupuesto de tiempo por ejecución reducido para la prueba (en producción, 52 s).
process.env.STEP_BUDGET_MS = "700";
process.env.GOVERNANCE_DIR = fileURLToPath(new URL("./fixtures/governance", import.meta.url));
const chat = (await import("../netlify/functions/chat.mjs")).default;
const KEY = "sk-ant-" + "k".repeat(40);

// Proveedor simulado: la redacción y la respuesta directa tardan más que el presupuesto.
function stub() {
  const enc = new TextEncoder();
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    if (!body.stream) return new Response(JSON.stringify({ content: [{ type: "text", text: "SAFE" }] }), { status: 200 });
    const sys = body.system.map((b) => b.text).join("\n");
    const slow = !sys.includes("ALPHA-STAGE") && !sys.includes("GAMMA-STAGE");
    const text = sys.includes("ALPHA-STAGE") ? '{"goal":"x"}' : sys.includes("GAMMA-STAGE") ? '{"ok":true}' : "palabra ".repeat(40);
    let cancelled = false;
    return new Response(
      new ReadableStream({
        async start(c) {
          for (let i = 0; i < text.length && !cancelled; i += 8) {
            c.enqueue(enc.encode(`data: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: text.slice(i, i + 8) } })}\n\n`));
            if (slow) await new Promise((r) => setTimeout(r, 100));
          }
          if (!cancelled) c.close();
        },
        cancel() { cancelled = true; },
      }),
      { status: 200 }
    );
  };
  return () => (globalThis.fetch = real);
}

async function post(payload) {
  const r = await chat(new Request("http://x/api/chat", { method: "POST", body: JSON.stringify(payload) }));
  const events = (await r.text()).split("\n\n").filter((l) => l.startsWith("data: ")).map((l) => JSON.parse(l.slice(6)));
  return { events, text: events.filter((e) => e.type === "content_block_delta").map((e) => e.delta.text).join("") };
}

test("una etapa que no termina a tiempo se corta, el ciclo sigue y la entrega lo dice", async () => {
  const restore = stub();
  try {
    let state, last;
    const t0 = Date.now();
    for (let i = 0; i < 6; i++) {
      last = await post({ key: KEY, messages: [{ role: "user", content: "hola" }], state });
      const c = last.events.find((e) => e.type === "frome_continue");
      if (!c) break;
      state = c.state;
    }
    assert.ok(last.text.startsWith("palabra palabra"));
    assert.ok(last.text.length < "palabra ".repeat(40).length);
    assert.ok(last.text.endsWith("[Respuesta cortada por el límite de tiempo de la plataforma.]"));
    assert.ok(Date.now() - t0 < 2500);
  } finally { restore(); }
});

test("respuesta directa que no termina a tiempo: se corta y se avisa", async () => {
  const restore = stub();
  try {
    const { events, text } = await post({ key: KEY, governed: false, messages: [{ role: "user", content: "hola" }] });
    assert.ok(text.length > 0 && text.length < "palabra ".repeat(40).length);
    assert.ok(events.some((e) => e.type === "frome_truncated"));
    assert.ok(events.some((e) => e.type === "frome_usage"));
  } finally { restore(); }
});
