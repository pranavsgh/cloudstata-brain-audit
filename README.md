# Ask the Brain (proof of concept)

A small web app that shows how a "Brain" over scattered Drive knowledge should decide **which document to trust**, then answers questions only from the approved ones.

**Live:** _add the Vercel URL here after deploy_ · All data is fictional.

## What it does
1. **Load a Drive folder:** upload a folder of `.md`/`.txt` docs, load the built-in sample, or download the sample `.zip` to see the format.
2. **Step 1 · Sort the folder:** applies the source-of-truth hierarchy (same rules as `brain_audit.py`): which doc wins per topic, duplicates, stale canonical docs, meeting decisions that conflict with approved docs, and client data shared too widely (blocked). Download `brain_index_v1.csv` / `brain_audit_report.csv`.
3. **Step 2 · Ask the Brain:** a chat that sees only the approved docs. Answers cite sources, show `⚠ Conflict` lines, say "I couldn't find this in the Brain" instead of guessing, and end with a confidence level. Every answer is tagged with the model that wrote it: **Gemini first, labeled Groq backup** if Gemini fails.

## Why there is no vector database
v1 does not use one. In real Gemini Enterprise, Google's built-in, permission-aware connector index does retrieval. This proof of concept skips retrieval because ~15 docs fit in one prompt: the server sends **only the approved docs** straight into the prompt. Cloudasta's value is curating *what* gets connected (the hierarchy), not running a vector store.

## Security model
The browser only sends raw files. `api/ask.js` re-runs the parse, audit and `buildContext` itself, so a doc blocked for security (client data shared "anyone with link"), archived, duplicated or superseded never reaches the model, even if a request is tampered with. Keys live only in server env vars.

## Abuse protection
- Keys are server-side only; the free-tier Gemini key has no billing account attached, so it cannot charge you.
- `/api/ask` only accepts requests from the site's own page (same-origin check), JSON only, and caps input size.
- Per-IP limit (20 questions / 10 min) and a global daily cap (400 model calls per instance). Both are in-memory per instance: fine for a demo, not a hardened limiter.
- Security headers (CSP, nosniff, frame deny) in `vercel.json`; `robots.txt` asks crawlers to skip `/api/`.
- The Origin check can be forged by a determined attacker; rotate the key if you ever see unexpected usage.

## Doc header format
```
---
Doc ID: D01
Title: Pricing Framework 2026
Type: Doc                 # Doc | Slides | PDF | Transcript | Export
Topic: Pricing
Owner: ceo@cloudasta.com
Last modified: 2026-03-02
Last reviewed: 2026-03-02 # may be blank
Status: Canonical         # Canonical | Draft | Legacy | Archived
Sharing: Company-wide     # Restricted | Company-wide | Anyone with link
Client data: No
Decision recorded: No
---
body text
```
(In real Gemini Enterprise the Drive API supplies these.) Files without a header are kept as unapproved drafts and listed under "missing header". Only `.md`/`.txt` are read; hidden files are ignored; limits are 60 files and 200 KB of text. An unrecognised `Sharing` value is treated as "Anyone with link" (fail safe) and reported.

For uploads, "Check as of" defaults to today. The sample folder pins it to 2026-10-28 because the sample docs are dated October 2026 and the 90/365/540-day rules would otherwise drift.

## Files
| Path | Purpose |
|---|---|
| `index.html` | the UI (ES module) |
| `brain.js` | shared pure logic (audit, folder parsing, `buildContext`, system prompt), used by page and API |
| `api/ask.js` | Vercel function: validation, rate limit, Gemini then Groq |
| `sample-drive/`, `sample-drive.js`, `cloudasta-drive-sample.zip` | the fake Drive folder in three forms; edit docs in `tools/make_drive.py` and rerun it |
| `brain_audit.py` | the Python CLI; the source of truth for the rules |
| `tests/` | `npm test` |

## Environment variables
| Name | Notes |
|---|---|
| `GEMINI_API_KEY` | required (Google AI Studio, free tier) |
| `GEMINI_MODEL` | default `gemini-3.6-flash` |
| `GROQ_API_KEY` | optional backup (console.groq.com) |
| `GROQ_MODEL` | default `llama-3.3-70b-versatile` |
| `GEMINI_THINKING` | optional thinking level, default `low` |

Never commit keys. For local runs put them in `.env.local` (gitignored).

## Tests
`npm test` (Node 20+, Python 3) runs: JS/Python parity on 5 inventories and dates; folder-parse vs Python on header-derived inventories; context include/exclude lists; a direct API request containing the blocked Acme notes (their text must not reach the model); fallback behaviour with `fetch` mocked; validation and rate limits. The mocks exist only in tests; the app never shows mocked output.

## Deploy (Vercel)
1. Push this repo to GitHub (public).
2. vercel.com → Add New → Project → import the repo. No build settings needed (static page + `api/`).
3. Settings → Environment Variables: add `GEMINI_API_KEY` (and `GROQ_API_KEY`) for Production, then redeploy.
4. Open the URL in a private window: it loads with no sign-in.
