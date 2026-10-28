// POST /api/ask: re-runs the audit server-side, then asks Gemini (Groq as labeled backup).
// The browser's doc list is never trusted: only raw files come in, and the allowed context is rebuilt here.
import { LIMITS, parseDate, byteLength, checkLimits, auditFolder, buildContext, systemInstruction } from "../brain.js";

const GEMINI_TIMEOUT_MS = 18000, GROQ_TIMEOUT_MS = 12000;
const RATE_MAX = 20, RATE_WINDOW_MS = 10 * 60 * 1000;
const hits = new Map(); // ip -> timestamps. Per-instance memory only: fine for a demo, not a real limiter.

function rateLimited(ip, now = Date.now()) {
  const recent = (hits.get(ip) || []).filter(t => now - t < RATE_WINDOW_MS);
  if (recent.length >= RATE_MAX) { hits.set(ip, recent); return true; }
  recent.push(now); hits.set(ip, recent);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some(t => now - t < RATE_WINDOW_MS)) hits.delete(k);
  return false;
}
export function _resetRateLimit() { hits.clear(); }

const bad = message => ({ status: 400, json: { error: message } });

function validate(body) {
  if (!body || typeof body !== "object") return "Send a JSON body with files, asOf, question and history.";
  const { files, asOf, question, history } = body;
  if (!Array.isArray(files) || !files.length) return "No files were sent.";
  if (files.length > LIMITS.maxFiles) return `Too many files (max ${LIMITS.maxFiles}).`;
  if (!files.every(f => f && typeof f.name === "string" && typeof f.text === "string")) return "Each file needs a name and text.";
  if (files.reduce((a, f) => a + byteLength(f.text), 0) > LIMITS.maxBytes) return `Too much text (max ${LIMITS.maxBytes / 1024} KB in total).`;
  if (typeof asOf !== "string" || parseDate(asOf) == null || !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return 'asOf must be a real date like "2026-10-28".';
  if (typeof question !== "string" || !question.trim() || question.length > LIMITS.maxQuestion) return `Question must be 1 to ${LIMITS.maxQuestion} characters.`;
  if (history !== undefined) {
    if (!Array.isArray(history) || history.length > LIMITS.maxHistory) return `History can have at most ${LIMITS.maxHistory} turns.`;
    for (const h of history) {
      if (!h || !["user", "assistant"].includes(h.role) || typeof h.text !== "string" || h.text.length > LIMITS.maxHistoryText)
        return `Each history turn needs a role (user or assistant) and text up to ${LIMITS.maxHistoryText} characters.`;
    }
  }
  return "";
}

async function timedFetch(url, init, ms) {
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(url, { ...init, signal: ctl.signal }); } finally { clearTimeout(timer); }
}

async function askGemini({ key, model, system, history, question }) {
  const contents = [...history.map(h => ({ role: h.role === "assistant" ? "model" : "user", parts: [{ text: h.text }] })),
    { role: "user", parts: [{ text: question }] }];
  const body = { systemInstruction: { parts: [{ text: system }] }, contents,
    generationConfig: { temperature: 0.2, maxOutputTokens: 1500, thinkingConfig: { thinkingLevel: process.env.GEMINI_THINKING || "low" } } };
  const r = await timedFetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    { method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": key }, body: JSON.stringify(body) }, GEMINI_TIMEOUT_MS);
  if (!r.ok) { const e = new Error(`Gemini HTTP ${r.status}`); e.status = r.status; e.detail = (await r.text().catch(() => "")).slice(0, 500); throw e; }
  const j = await r.json();
  const parts = j?.candidates?.[0]?.content?.parts || [];
  const text = parts.filter(p => !p.thought).map(p => p.text || "").join("").trim();
  if (!text) { const e = new Error("Gemini returned an empty answer"); e.detail = JSON.stringify({ finish: j?.candidates?.[0]?.finishReason, block: j?.promptFeedback?.blockReason }); throw e; }
  return text;
}

async function askGroq({ key, model, system, history, question }) {
  const messages = [{ role: "system", content: system }, ...history.map(h => ({ role: h.role, content: h.text })), { role: "user", content: question }];
  const r = await timedFetch("https://api.groq.com/openai/v1/chat/completions",
    { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, messages, temperature: 0.2, max_tokens: 900 }) }, GROQ_TIMEOUT_MS);
  if (!r.ok) { const e = new Error(`Groq HTTP ${r.status}`); e.status = r.status; e.detail = (await r.text().catch(() => "")).slice(0, 500); throw e; }
  const j = await r.json();
  const text = (j?.choices?.[0]?.message?.content || "").trim();
  if (!text) throw new Error("Groq returned an empty answer");
  return text;
}

// Core logic, separated from the HTTP wrapper so tests can call it directly.
export async function handleAsk({ body, ip = "unknown" }) {
  const err = validate(body);
  if (err) return bad(err);
  if (rateLimited(ip)) return { status: 429, json: { error: "You've asked a lot of questions in a short time. Please wait a few minutes and try again." } };

  const limitErr = checkLimits(body.files);
  if (limitErr) return bad(limitErr);
  let res;
  try { res = auditFolder(body.files, parseDate(body.asOf)); } catch (e) { return bad(e.message); }
  const ctx = buildContext(res);
  const usedDocs = ctx.used.map(d => ({ id: d.id, title: d.title, tier: d.tierName }));
  const excludedDocs = ctx.excluded;

  if (!ctx.used.length)
    return { status: 200, json: { answer: "The Brain has nothing approved to answer from yet.", provider: "none", model: null, usedDocs, excludedDocs } };

  const geminiKey = process.env.GEMINI_API_KEY, groqKey = process.env.GROQ_API_KEY;
  if (!geminiKey && !groqKey) return { status: 503, json: { error: "Chat isn't configured yet." } };

  let history = (body.history || []).map(h => ({ role: h.role, text: h.text }));
  while (history.length && history[0].role !== "user") history.shift();
  const args = { system: systemInstruction(ctx), history, question: body.question.trim() };

  let fallbackReason, geminiStatus;
  if (geminiKey) {
    const model = process.env.GEMINI_MODEL || "gemini-3.6-flash";
    try {
      const answer = await askGemini({ key: geminiKey, model, ...args });
      return { status: 200, json: { answer, provider: "gemini", model, usedDocs, excludedDocs } };
    } catch (e) {
      geminiStatus = e.status;
      fallbackReason = e.name === "AbortError" ? "Gemini timed out" : e.status ? `Gemini error ${e.status}` : "Gemini unavailable";
      console.error("[ask] gemini failed:", e.message, e.detail || "");
    }
  } else fallbackReason = "Gemini not configured";

  if (groqKey) {
    const model = process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
    try {
      const answer = await askGroq({ key: groqKey, model, ...args });
      return { status: 200, json: { answer, provider: "groq", model, usedDocs, excludedDocs, fallbackReason } };
    } catch (e) { console.error("[ask] groq failed:", e.message, e.detail || ""); }
  }
  if (geminiStatus === 404) return { status: 503, json: { error: "Model not found: set GEMINI_MODEL." } };
  return { status: 503, json: { error: "Both models are busy. Try again in a minute." } };
}

export default async function handler(req, res) {
  res.setHeader("cache-control", "no-store");
  if (req.method !== "POST") { res.setHeader("allow", "POST"); return res.status(405).json({ error: "Use POST." }); }
  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = null; } }
  const ip = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").split(",")[0].trim();
  try {
    const { status, json } = await handleAsk({ body, ip });
    return res.status(status).json(json);
  } catch (e) {
    console.error("[ask] unexpected:", e);
    return res.status(500).json({ error: "Something went wrong on our side. Try again." });
  }
}
