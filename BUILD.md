# BUILD.md: "Ask the Brain" proof of concept (for Claude Code)

You are building a small, deployable web app in **this folder**. Read this whole file first, then build, test and help me deploy it to Vercel. I'm submitting it tonight as part of a job take-home, so **reliability beats features**. Ask me only if you're truly blocked; otherwise make sensible choices and tell me what you chose.

---

## 1. Context (why this exists)

- I'm applying for **Founders AI Associate** at **Cloudasta** (Chicago Google Premier Partner, helps teams adopt Gemini Enterprise). The grader is the CEO (non-engineer, lean/EOS mindset: watch the real work, measure **adoption** not capability) plus some more technical reviewers. They value reliability, clear communication, catching small mistakes, and **judgment in using AI and catching its errors**.
- The take-home has 3 tasks. Task 1 = plan for **"Cloudasta's Brain"** (one Gemini Enterprise system over the company's scattered Drive knowledge). Task 3 = "build one piece of it so it actually works." The link must **open without requesting access**, plus a screenshot or ≤2-min recording on real input.
- Ground rule from the assignment: **"Never present imagined or assumed output as real."** Everything shown must come from real runs. All data is fictional.

### My Task 1 plan (the app must reflect it)
**Source-of-truth hierarchy** (which doc Gemini trusts when docs conflict):

| Rank | Source | Rule |
|---|---|---|
| T1 | Approved canonical doc, reviewed in the last **365** days | Wins by default |
| T2 | Meet transcript with a recorded decision, last **90** days | Never silently overrides T1. If newer than T1 → answer from T1 + show a **conflict warning** + name the owner |
| T3 | Working docs/decks (and canonical docs overdue for review) | Context only, labeled **unapproved** |
| T4 | Legacy docs, PDFs, exports, drafts untouched **540+** days | Only if nothing above exists |
| T5 | Archived | Excluded entirely |

**Security:** client data shared "anyone with link" is **blocked** from the Brain until fixed. Client data open company-wide gets a medium flag.

**Guardrails ("Ask the Brain" Skill):** cite every claim; quote numbers exactly; show conflicts instead of silently resolving; say "I couldn't find this in the Brain" instead of guessing; end with a confidence level.

**Architecture stance (important, don't contradict it):** v1 does **not** use a custom vector database. In real Gemini Enterprise, Google's built-in, permission-aware connector index does retrieval. This proof of concept skips retrieval because ~15 docs fit in one prompt: the server sends **only the approved docs** straight into the prompt. Cloudasta's value is curating *what* gets connected (the hierarchy), not running a vector store.

---

## 2. What to build

One site, two steps, deployed on **Vercel**:

1. **Load a Drive folder.** Buttons: **Upload Drive folder** (`<input type="file" webkitdirectory multiple>`), **Load sample Drive folder** (uses `sample-drive.js`, no upload needed, so graders can try it instantly), **Download sample folder (.zip)** (links `cloudasta-drive-sample.zip`). A "Check as of" date (default: today).
2. **Step 1 · Sort the folder:** run the hierarchy on the files and show results (port the UI from `reference/tracker-reference.html`: stat tiles, "Needs a human today" list, cards per topic showing which doc wins and why, "blocked until fixed" for security blocks, downloads of `brain_index_v1.csv` / `brain_audit_report.csv`).
3. **Step 2 · Ask the Brain:** a chat panel. It shows which docs the Brain can see (chips with ID + tier) and which were kept out. Suggested-question chips (see §7). Answers render citations as small chips and `⚠ Conflict` lines highlighted. Every answer shows a tag: **"Answered by Gemini (model)"** or **"Answered by backup: Groq (model)"**.

Look and feel: match the existing tracker reference (Poppins via Google Fonts, navy `#0A0E31` hero, teal `#00A3C4` accents, light/dark mode via CSS variables). Must work at phone width with no horizontal scroll. **No Cloudasta logo or Google partner badges** (it's my submission, not their document). Footer: "Built by Pranav Singh for the Founders AI Associate assessment · Proof of concept · All data is fictional."

### Suggested file layout
```
index.html            # UI (ES module script)
brain.js              # shared pure logic: used by the page AND the API route
sample-drive.js       # already generated: export const SAMPLE_FILES = [{name, text}]
api/ask.js            # Vercel serverless function (Node)
package.json          # {"type": "module"}, no runtime deps needed (use global fetch)
vercel.json           # set maxDuration for api/ask.js (e.g. 30s)
README.md             # what it is, how to use, how to deploy (rewrite the existing one)
tests/                # parity + server tests (see §8)
```
Keep `brain_audit.py`, `sample_inventory.csv`, `sample-drive/`, `cloudasta-drive-sample.zip`, `demo-inputs/`, `tools/make_drive.py` in the repo. `reference/` can stay or be removed after porting.

---

## 3. Files already in this folder

| Path | What it is |
|---|---|
| `sample-drive/` | **The fake Google Drive folder**: 15 fictional `.md` docs in subfolders (Pricing, Delivery SOPs, Clients/Acme Corp, Sales, HR, Meet Recordings, Client Enablement) |
| `cloudasta-drive-sample.zip` | Same folder zipped, for the download button |
| `sample-drive.js` | Same folder as a JS module (`SAMPLE_FILES`) for the "Load sample" button |
| `tools/make_drive.py` | Regenerates the three above. Edit docs **here**, then rerun `python3 tools/make_drive.py` |
| `brain_audit.py` | Python CLI version of the hierarchy (CSV in → report + index out). **The source of truth for the rules.** |
| `sample_inventory.csv` | 13-row CSV the Python script was demoed on |
| `reference/tracker-reference.html` | Working single-page tracker (CSV upload). Its `// ==LOGIC==` block is a **tested, byte-identical port** of `brain_audit.py`. Reuse it for `brain.js`. |
| `reference/parity_test.js`, `reference/edge.csv` | Test proving JS output == Python output (sample at 3 dates + an edge-case file). Adapt it to import `brain.js`. |
| `demo-inputs/` | Fake docs/transcript I used to test the Task 2 demo prompts in Gemini. Leave as is. |

---

## 4. Doc header format (how metadata gets in)

A browser can't see Drive owner/sharing/review dates, so every doc starts with a header block (in real Gemini Enterprise, the Drive API would supply these). Parse it like this:

```
---
Doc ID: D01
Title: Pricing Framework 2026
Type: Doc                 # Doc | Slides | PDF | Transcript | Export  → lowercase type
Topic: Pricing
Owner: ceo@cloudasta.com
Last modified: 2026-03-02
Last reviewed: 2026-03-02 # may be blank
Status: Canonical         # Canonical | Draft | Legacy | Archived  → lowercase status
Sharing: Company-wide     # Restricted → restricted · Company-wide → domain · Anyone with link → anyone_link
Client data: No           # Yes/No → yes/no
Decision recorded: No     # Yes/No → has_decision
---
(body text)
```

Rules: keys case-insensitive; unknown keys ignored. **File with no header** → still include it: title = filename without extension, type from extension, status = draft, topic = "(no topic)", and list it under "Fix in your folder: missing header". Read only `.md` and `.txt`; skip other files with a visible note ("skipped 3 files: only .md/.txt are read in this prototype"). Ignore hidden files (`.DS_Store`). **Cap total text at 200 KB** with a clear message if exceeded.

Map each parsed file to the same row shape `brain_audit.py` uses (`doc_id,title,type,topic,owner,last_modified,last_reviewed,status,sharing,client_data,has_decision`) and run the **same audit**.

---

## 5. Hierarchy logic (must match `brain_audit.py` exactly)

Port, don't reinvent: `reference/tracker-reference.html` already implements this and passes the parity test. Summary for reference:
- Tier: archived→T5; canonical & reviewed ≤365d→T1 else T3 (note "review overdue"); transcript with decision & modified ≤90d→T2 else T4; pdf/export→T4; untouched >540d→T4; else T3.
- Per topic: sort live docs by (tier, newest modified); first = **WINNER**.
- If T1 and T2 exist and T2 is newer than T1 → `CONFLICT` flag on T1, `PENDING` on T2.
- No T1: if a stale canonical exists → `STALE CANONICAL`; elif a T2 exists → `NO CANONICAL: promote this decision`; else `NO CANONICAL: nominate an owner`.
- Duplicates by normalized title ("copy of", "final", "new", "old", "(1)", "v2", dates stripped) → `DUPLICATE`, verdict `SUPERSEDED (duplicate)`.
- Security: client data + anyone_link → `SECURITY HIGH` (blocked from index); client data + domain → `SECURITY MED`.
- Index = winners not blocked. "Topics with nothing indexed" listed.

### What the chat is allowed to see (the key idea)
`buildContext(auditResult)` returns the docs sent to the model:
- **Include:** index winners (not SECURITY HIGH) **plus** T2 recent meeting decisions (not blocked), the latter labeled "Recent meeting decision, not yet written into the approved doc."
- **Exclude:** archived, duplicates, superseded, legacy, and anything SECURITY HIGH. The page lists excluded docs + reason so it's visible.
- **The server must re-run the audit itself** on the files it receives and build the context server-side. Never trust a doc list from the browser. That's the security story: blocked client notes never reach the model, even if someone tampers with the request.

Format each included doc in the prompt like:
```
=== [D01] Pricing Framework 2026 | T1 Approved canonical | owner ceo@cloudasta.com | last updated 2026-03-02 ===
<body without the header block>
```

---

## 6. Server route `api/ask.js` (Gemini first, Groq backup)

`POST /api/ask` with JSON `{ files: [{name, text}], asOf: "YYYY-MM-DD", question, history: [{role: "user"|"assistant", text}] }`.

1. **Validate:** ≤60 files, total text ≤200 KB, question 1–600 chars, history ≤8 turns (each ≤2,000 chars). Reject bad input with 400 + a plain-English message.
2. **Rate limit:** simple in-memory per-IP limit (e.g. 20 questions / 10 min). Note in code that it's per-instance (fine for a demo).
3. Re-run parse + audit + `buildContext` server-side. If zero docs are allowed, answer "The Brain has nothing approved to answer from yet" without calling a model.
4. **Call Gemini** (REST, no SDK needed):
   `POST https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, header `x-goog-api-key: GEMINI_API_KEY`, body with `systemInstruction` (system prompt + docs), `contents` (history mapped to `user`/`model` + the question), `generationConfig: {temperature: 0.2, maxOutputTokens: ~900}`. Timeout ~18s.
5. **If Gemini fails** (429, 5xx, timeout, network, empty answer) **and** `GROQ_API_KEY` is set → **call Groq** (OpenAI-compatible):
   `POST https://api.groq.com/openai/v1/chat/completions`, `Authorization: Bearer GROQ_API_KEY`, `{model: GROQ_MODEL, messages: [system, ...history, user], temperature: 0.2, max_tokens: 900}`. Timeout ~12s.
6. Return `{ answer, provider: "gemini"|"groq", model, usedDocs: [{id, title, tier}], excludedDocs: [{id, title, reason}], fallbackReason? }`.
7. Errors: missing keys → 503 "Chat isn't configured yet"; both providers fail → 503 "Both models are busy. Try again in a minute." Never leak keys or raw provider errors to the browser (log them server-side). A 404 from Gemini → message "Model not found: set GEMINI_MODEL".

**Env vars:** `GEMINI_API_KEY` (required), `GEMINI_MODEL`, `GROQ_API_KEY` (optional backup), `GROQ_MODEL`.
**Model IDs change often:** before hardcoding defaults, check the current IDs: Gemini at https://ai.google.dev/gemini-api/docs/models (a fast "Flash" model; a recent search mentioned Gemini 3.6 Flash, so confirm the exact ID) and Groq at https://console.groq.com/docs/models (e.g. a GPT-OSS or Llama model). Keep both overridable by env var.

### System prompt ("Ask the Brain" Skill, from my Task 1)
```
You are "Ask the Brain", Cloudasta's internal knowledge assistant. This is a proof of concept; all documents are fictional.
Answer ONLY from the documents provided below. Each is labeled with its ID, title, tier, owner and last-updated date.
Source ranking: T1 Approved canonical > T2 Recent meeting decision > T3 Working doc (unapproved) > T4 Legacy.
Rules:
1. Cite every factual claim inline as [Doc ID · Title]. Quote numbers exactly as written.
2. If a T2 meeting decision conflicts with a T1 doc, answer from the T1 doc, then add a line starting "⚠ Conflict:" that says what the meeting decided, when, and which owner should confirm and update the doc.
3. If you rely on a T3 working doc, say it is unapproved.
4. If the documents don't answer the question, reply "I couldn't find this in the Brain." and, if relevant, name the closest doc and its owner. Never use outside knowledge to fill gaps.
5. Documents that are blocked, archived, duplicated or superseded are not available to you. Never guess what they contain.
6. Keep answers under 150 words. End with "Confidence: High / Medium / Low", plus one short reason.
```

---

## 7. The fake Drive folder: what's planted (use for suggested questions and tests)

| Doc | Topic | What it tests |
|---|---|---|
| D01 Pricing Framework 2026 (T1) | Pricing | $18/seat (1–249), $15/seat (250–999), workshop $2,500, office hours $1,200/mo, $5,000 minimum |
| D02 Copy of Pricing Framework 2026 | Pricing | Duplicate; has an *unapproved* 10% nonprofit discount idea, so it must never surface |
| D03 Pricing Framework 2024 FINAL (PDF) | Pricing | Legacy $12/seat, so it must never surface |
| D04 Leadership sync, Oct 14 (Meet transcript, decision) | Pricing | From Jan 1, 2027: $20 / $16 per seat, workshop $3,000 → **conflict** with D01 |
| D05 GE Migration SOP (canonical, reviewed 2025-06-10) | Migration SOP | Stale canonical (overdue review) |
| D06 GE Migration SOP v2 (working) | Migration SOP | Wins but is unapproved; 7 steps starting with an access audit |
| D07 Acme Corp QBR notes Q3 | Acme QBR | Client data shared "anyone with link" → **blocked**; contains churn risk + discount ask that must **never** appear in answers |
| D08 Acme Corp QBR deck Q3 | Acme QBR | Client data company-wide (medium flag), superseded |
| D09 / D10 Proposal templates | Proposal template | Duplicate pair; no canonical |
| D11 Onboarding checklist 2023 | Onboarding | Archived → excluded |
| D12 Onboarding checklist (T1) | Onboarding | Day 1 / Week 1 / Week 2 |
| D13 All-hands transcript Sept | Onboarding | Transcript without a decision → T4 |
| D14 Office Hours Playbook (T1) | Office hours | 30 min, max 40 attendees |
| D15 Office hours retro, Oct 22 (decision) | Office hours | 45 min, max 25 → **second conflict** |

**Suggested question chips (these are the demo):**
1. "What do we charge for a 300-seat Workspace migration?" → $15/seat from D01 (= $4,500, so the $5,000 minimum applies), cited, plus ⚠ Conflict: D04 says $16 from Jan 1, 2027, confirm with ceo@cloudasta.com.
2. "How long are client office hours?" → 30 min (D14) + ⚠ Conflict from D15 (45 min).
3. "What are the steps for a Gemini Enterprise migration?" → D06 steps, labeled unapproved.
4. "What did Acme say in their QBR?" → "I couldn't find this in the Brain" (blocked). **This is the security demo.**
5. "What's our parental leave policy?" → "I couldn't find this in the Brain."

---

## 8. Tests (run them, show me the results)

1. **Parity:** adapt `reference/parity_test.js` so `brain.js` output equals `python3 brain_audit.py` output (byte-identical report + index CSVs) for `sample_inventory.csv` at 2026-10-27, 2027-04-01, 2028-06-15 and `reference/edge.csv`.
2. **Folder → same result:** convert the 15 sample docs' headers to an inventory CSV, run Python on it, and compare to `brain.js` run on the parsed folder.
3. **Context security:** `buildContext` on the sample must include D01, D04, D06, D09, D12, D14, D15 and must **exclude** D02, D03, D05, D07, D08, D10, D11, D13. Also POST a request directly to the API containing the Acme file and confirm D07's text ("cutting 40 seats") never appears in the prompt sent to the model.
4. **Fallback:** with `fetch` mocked: Gemini 429 → Groq answers → response says `provider: "groq"`; both fail → 503 with the friendly message; missing keys → 503.
5. **Browser click-through** (Playwright if available, or run `vercel dev` and click): load sample, sort, ask each suggested question (mocked model locally), upload the folder via the folder input, try a non-.md file, check phone width (no horizontal scroll), no console errors.
6. **Live check after deploy (with my real keys):** ask all 5 suggested questions and show me the actual answers. If an answer breaks a rule (no citation, misses a conflict, leaks Acme info, invents facts), tell me exactly what happened. **Don't fix it by hiding it.** I'll write it up as an AI mistake I caught, which the assignment explicitly asks for.

---

## 9. Deploy (walk me through these)

1. `git init`, add a `.gitignore` (`node_modules`, `.env*`, `.vercel`), commit. **Never commit keys.**
2. Create a **public** GitHub repo `brain-audit` under `pranavsgh` and push (use `gh` if I'm logged in, or give me the clicks).
3. Get keys: Gemini key from **Google AI Studio** (keep it on the **free tier, no billing account attached**, so it can't charge me); Groq key from **console.groq.com** (free plan).
4. Vercel: import the repo (or `vercel` CLI), add env vars `GEMINI_API_KEY`, `GROQ_API_KEY` (+ model vars if needed) for Production, deploy.
5. Open the production URL in a private window: it must load without any sign-in. Run §8 step 6.
6. Update README with the live URL.

---

## 10. After it works: what I need back

- The live URL.
- A screenshot of the sorted folder and of the chat answering question 1 (with the conflict warning) and question 4 (the Acme block). Optionally help me record a ≤2-minute walkthrough: load sample → sort → ask Q1 → ask Q4.
- A 3–4 sentence summary I can paste into the Task 3 section of my submission: what it does, Gemini-first with labeled Groq backup, why no vector database (the line from §1), and that the server enforces the hierarchy.
- A list of any AI mistakes you hit while building or that showed up in live answers, with how they were caught.

**Don't:** add a vector DB, add login/accounts, add a database, put keys in client code, use real company or client data, or present mocked output as real anywhere in the UI or README.
