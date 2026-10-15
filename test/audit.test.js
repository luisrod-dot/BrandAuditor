// Prueba la función api/audit.js sin llamar a Anthropic (fetch simulado).
// Uso: node test/audit.test.js
const assert = require("assert");
const handler = require("../api/audit");

const PIXEL = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=";
const FAKE = { pieza: { sistema: "brand" }, identidad: [{ criterio: "Logo", explicacion: "ok", sugerencia: "", max: 2, pts: 2 }], copy: [{ criterio: "Tono", explicacion: "ok", sugerencia: "", max: 2, pts: 1 }], fotografia: [], sugerencias: [], copy_alternativo: [] };

function mkRes() {
  const r = { code: 200, headers: {}, body: null };
  r.setHeader = (k, v) => { r.headers[k] = v; };
  r.status = (c) => { r.code = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}
async function call(req) { const res = mkRes(); await handler({ headers: {}, ...req }, res); return res; }
function anthropicReply(text, stop = "end_turn", status = 200) {
  global.fetch = async (url, opts) => { global.__last = { url, opts }; return { ok: status === 200, status, json: async () => ({ content: [{ type: "text", text }], stop_reason: stop }), text: async () => text }; };
}

(async () => {
  delete process.env.ACCESS_CODE; delete process.env.ANTHROPIC_API_KEY;

  let r = await call({ method: "GET" });
  assert.deepStrictEqual(r.body, { ok: true, needsCode: false, configured: false });

  r = await call({ method: "POST", body: { images: [PIXEL] } });
  assert.strictEqual(r.body.error, "not_configured");

  process.env.ANTHROPIC_API_KEY = "sk-test";
  process.env.ACCESS_CODE = "rimac2026";

  r = await call({ method: "POST", body: { images: [PIXEL] } });
  assert.strictEqual(r.code, 401);
  r = await call({ method: "POST", headers: { "x-access-code": "mal" }, body: { images: [PIXEL] } });
  assert.strictEqual(r.code, 401);

  const ok = { method: "POST", headers: { "x-access-code": "rimac2026" } };

  r = await call({ ...ok, body: { images: [] } });
  assert.strictEqual(r.body.error, "bad_request");
  r = await call({ ...ok, body: { images: ["data:text/html;base64,AAAA"] } });
  assert.strictEqual(r.body.error, "image_rejected");
  r = await call({ ...ok, body: { images: new Array(6).fill(PIXEL) } });
  assert.strictEqual(r.body.error, "bad_request");
  r = await call({ ...ok, body: { images: ["data:image/jpeg;base64," + "A".repeat(4.2 * 1024 * 1024)] } });
  assert.strictEqual(r.code, 413);

  // respuesta en bloque de código con texto alrededor
  anthropicReply("Aquí va:\n```json\n" + JSON.stringify(FAKE) + "\n```");
  r = await call({ ...ok, body: { images: [PIXEL], tipo: "interface", medio: "impreso", ctx: "post 4:5", depth: "complex" } });
  assert.strictEqual(r.code, 200);
  assert.strictEqual(r.body.result.identidad[0].criterio, "Logo");
  const sent = JSON.parse(global.__last.opts.body);
  assert.strictEqual(global.__last.url, "https://api.anthropic.com/v1/messages");
  assert.strictEqual(global.__last.opts.headers["x-api-key"], "sk-test");
  assert.strictEqual(sent.model, "claude-opus-5-5");
  assert.ok(sent.system.includes("/rimac-branding"));
  assert.strictEqual(sent.messages[0].content[0].type, "image");
  assert.strictEqual(sent.messages[0].content[0].source.media_type, "image/jpeg");
  const note = sent.messages[0].content.at(-1).text;
  assert.ok(note.includes("RIDE System Interface") && note.includes("#E30613") && note.includes("post 4:5"));

  anthropicReply(JSON.stringify(FAKE));
  r = await call({ ...ok, body: { images: [PIXEL] } });
  assert.strictEqual(JSON.parse(global.__last.opts.body).model, "claude-sonnet-5-5");

  anthropicReply("no es json");
  r = await call({ ...ok, body: { images: [PIXEL] } });
  assert.strictEqual(r.body.error, "invalid_json");

  anthropicReply(JSON.stringify(FAKE), "max_tokens");
  r = await call({ ...ok, body: { images: [PIXEL] } });
  assert.strictEqual(r.body.error, "invalid_json");

  anthropicReply("overloaded", "end_turn", 429);
  r = await call({ ...ok, body: { images: [PIXEL] } });
  assert.strictEqual(r.code, 429);
  const errBody = (m) => JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: m } });
  anthropicReply(errBody("invalid x-api-key"), "end_turn", 401);
  r = await call({ ...ok, body: { images: [PIXEL] } });
  assert.strictEqual(r.body.error, "invalid_key");
  anthropicReply(errBody("Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing."), "end_turn", 400);
  r = await call({ ...ok, body: { images: [PIXEL] } });
  assert.strictEqual(r.body.error, "no_credit");
  anthropicReply(errBody("model: claude-xyz"), "end_turn", 404);
  r = await call({ ...ok, body: { images: [PIXEL] } });
  assert.strictEqual(r.body.error, "model_not_found");
  assert.ok(r.body.detail.includes("claude-xyz"));
  anthropicReply(errBody("Overloaded internal error"), "end_turn", 500);
  r = await call({ ...ok, body: { images: [PIXEL] } });
  assert.strictEqual(r.body.error, "upstream_error");
  assert.ok(r.body.detail.includes("500"));
  anthropicReply(errBody("image exceeds 5 MB maximum"), "end_turn", 400);
  r = await call({ ...ok, body: { images: [PIXEL] } });
  assert.strictEqual(r.body.error, "image_rejected");

  r = await call({ method: "PUT" });
  assert.strictEqual(r.code, 405);

  console.log("OK: todas las pruebas de api/audit pasaron");
})().catch((e) => { console.error("FALLÓ:", e.message); process.exit(1); });
