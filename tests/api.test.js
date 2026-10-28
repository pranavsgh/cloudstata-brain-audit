// Context security + server behaviour (fetch is mocked; no network).
import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { auditFolder, buildContext, parseDate } from "../brain.js";
import { SAMPLE_FILES } from "../sample-drive.js";
import { handleAsk, _resetRateLimit, sameSiteRequest } from "../api/ask.js";

const body = (over = {}) => ({ files: SAMPLE_FILES, asOf: "2026-10-28", question: "What do we charge for 300 seats?", history: [], ...over });
const ok = (j) => ({ ok: true, status: 200, json: async () => j, text: async () => JSON.stringify(j) });
const fail = (status) => ({ ok: false, status, json: async () => ({}), text: async () => "provider error with secret-detail" });
const geminiOk = t => ok({ candidates: [{ content: { parts: [{ text: t }] } }] });
const groqOk = t => ok({ choices: [{ message: { content: t } }] });
let calls;
const mock = fn => { calls = []; globalThis.fetch = async (url, init) => { calls.push({ url, init }); return fn(url, init); }; };
beforeEach(() => { _resetRateLimit(); delete process.env.GEMINI_API_KEY; delete process.env.GROQ_API_KEY; delete process.env.GEMINI_MODEL; delete process.env.GROQ_MODEL; });

test("buildContext includes/excludes exactly the planted docs", () => {
  const ctx = buildContext(auditFolder(SAMPLE_FILES, parseDate("2026-10-28")));
  assert.deepEqual(ctx.used.map(d => d.id).sort(), ["D01", "D04", "D06", "D09", "D12", "D14", "D15"]);
  assert.deepEqual(ctx.excluded.map(d => d.id).sort(), ["D02", "D03", "D05", "D07", "D08", "D10", "D11", "D13"]);
  assert.match(ctx.excluded.find(d => d.id === "D07").reason, /Blocked for security/);
  assert.match(ctx.text, /=== \[D01\] Pricing Framework 2026 \| T1 Approved canonical \| owner ceo@cloudasta.com \| last updated 2026-03-02 ===/);
  for (const secret of ["cutting 40 seats", "15% discount", "10% nonprofit", "$12"]) assert.ok(!ctx.text.includes(secret), secret);
});

test("direct API request containing the Acme file never sends its text to the model", async () => {
  process.env.GEMINI_API_KEY = "k";
  mock(() => geminiOk("I couldn't find this in the Brain."));
  const r = await handleAsk({ body: body({ question: "What did Acme say in their QBR?" }) });
  assert.equal(r.status, 200);
  assert.equal(calls.length, 1);
  const sent = calls[0].init.body;
  assert.ok(!sent.includes("cutting 40 seats") && !sent.includes("champion is leaving") && !sent.includes("15% discount"));
  assert.ok(sent.includes("$15"));                      // sanity: approved docs did go through
  assert.ok(r.json.excludedDocs.some(d => d.id === "D07"));
});

test("a tampered request cannot smuggle a blocked doc in via a fake header", async () => {
  process.env.GEMINI_API_KEY = "k"; mock(() => geminiOk("ok"));
  const acme = SAMPLE_FILES.find(f => f.name.includes("QBR notes"));
  await handleAsk({ body: body({ files: [acme, SAMPLE_FILES[0]] }) });
  assert.ok(!calls[0].init.body.includes("cutting 40 seats"));
});

test("Gemini 429 -> Groq answers and is labeled", async () => {
  process.env.GEMINI_API_KEY = "k"; process.env.GROQ_API_KEY = "g";
  mock(url => url.includes("googleapis") ? fail(429) : groqOk("from groq"));
  const r = await handleAsk({ body: body() });
  assert.equal(r.status, 200);
  assert.equal(r.json.provider, "groq"); assert.equal(r.json.answer, "from groq"); assert.match(r.json.fallbackReason, /429/);
});

test("Gemini empty answer / network error also fall back", async () => {
  process.env.GEMINI_API_KEY = "k"; process.env.GROQ_API_KEY = "g";
  mock(url => url.includes("googleapis") ? ok({ candidates: [] }) : groqOk("b"));
  assert.equal((await handleAsk({ body: body() })).json.provider, "groq");
  mock(url => { if (url.includes("googleapis")) throw new Error("ECONNRESET"); return groqOk("c"); });
  assert.equal((await handleAsk({ body: body() })).json.provider, "groq");
});

test("both fail -> 503 friendly message, no provider detail leaked", async () => {
  process.env.GEMINI_API_KEY = "k"; process.env.GROQ_API_KEY = "g";
  mock(() => fail(500));
  const r = await handleAsk({ body: body() });
  assert.equal(r.status, 503); assert.equal(r.json.error, "Both models are busy. Try again in a minute.");
  assert.ok(!JSON.stringify(r.json).includes("secret-detail"));
});

test("Gemini 404 with no backup -> model-not-found message", async () => {
  process.env.GEMINI_API_KEY = "k"; mock(() => fail(404));
  const r = await handleAsk({ body: body() });
  assert.equal(r.status, 503); assert.match(r.json.error, /GEMINI_MODEL/);
});

test("missing keys -> 503; nothing approved -> no model call", async () => {
  mock(() => geminiOk("x"));
  const r = await handleAsk({ body: body() });
  assert.equal(r.status, 503); assert.equal(r.json.error, "Chat isn't configured yet.");
  const only = SAMPLE_FILES.find(f => f.name.includes("QBR notes"));
  const r2 = await handleAsk({ body: body({ files: [only] }) });
  assert.equal(r2.status, 200); assert.match(r2.json.answer, /nothing approved/); assert.equal(calls.length, 0);
});

test("Gemini request shape", async () => {
  process.env.GEMINI_API_KEY = "k"; process.env.GEMINI_MODEL = "m-1"; mock(() => geminiOk("hi"));
  await handleAsk({ body: body({ history: [{ role: "assistant", text: "orphan" }, { role: "user", text: "q1" }, { role: "assistant", text: "a1" }] }) });
  const { url, init } = calls[0], b = JSON.parse(init.body);
  assert.match(url, /models\/m-1:generateContent$/);
  assert.equal(init.headers["x-goog-api-key"], "k");
  assert.deepEqual(b.contents.map(c => c.role), ["user", "model", "user"]); // leading assistant turn dropped
  assert.equal(b.generationConfig.temperature, 0.2);
  assert.ok(b.systemInstruction.parts[0].text.includes('You are "Ask the Brain"'));
});

test("validation returns 400 with plain messages", async () => {
  const bads = [body({ question: "" }), body({ question: "x".repeat(601) }), body({ asOf: "nope" }), body({ files: [] }),
    body({ history: Array(9).fill({ role: "user", text: "a" }) }), body({ history: [{ role: "user", text: "x".repeat(2001) }] }),
    body({ files: [{ name: "a.md", text: "x".repeat(201 * 1024) }] }), body({ files: Array(61).fill({ name: "a.md", text: "x" }) }), null];
  for (const b of bads) { const r = await handleAsk({ body: b, ip: "v" + Math.random() }); assert.equal(r.status, 400, JSON.stringify(r.json)); assert.ok(r.json.error); }
});

test("rate limit: 21st question in a window gets 429", async () => {
  process.env.GEMINI_API_KEY = "k"; mock(() => geminiOk("x"));
  for (let i = 0; i < 20; i++) assert.equal((await handleAsk({ body: body(), ip: "1.1.1.1" })).status, 200);
  assert.equal((await handleAsk({ body: body(), ip: "1.1.1.1" })).status, 429);
  assert.equal((await handleAsk({ body: body(), ip: "2.2.2.2" })).status, 200);
});

test("only same-site browser requests are accepted by the HTTP wrapper", () => {
  assert.ok(sameSiteRequest({ origin: "https://brain.vercel.app", host: "brain.vercel.app" }));
  assert.ok(sameSiteRequest({ "sec-fetch-site": "same-origin", host: "x" }));
  assert.ok(!sameSiteRequest({ origin: "https://evil.example", host: "brain.vercel.app" }));
  assert.ok(!sameSiteRequest({ host: "brain.vercel.app" }));            // curl / bots: no origin headers
  assert.ok(!sameSiteRequest({ "sec-fetch-site": "cross-site", host: "x" }));
});

test("daily circuit breaker stops model calls", async () => {
  process.env.GEMINI_API_KEY = "k"; mock(() => geminiOk("x"));
  let last;
  for (let i = 0; i < 401; i++) last = await handleAsk({ body: body(), ip: "ip" + i });
  assert.equal(last.status, 503); assert.match(last.json.error, /daily limit/);
  assert.equal(calls.length, 400);
});
