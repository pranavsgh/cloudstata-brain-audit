// Shared pure logic for the page AND the API route. No DOM, no Node-only APIs.
// The audit mirrors brain_audit.py exactly (see tests/parity.test.js).

export const CANONICAL_REVIEW_DAYS = 365, TRANSCRIPT_FRESH_DAYS = 90, LEGACY_DAYS = 540;
export const REQUIRED = ["doc_id","title","type","topic","owner","last_modified","last_reviewed","status","sharing","client_data","has_decision"];
export const TIER_NAMES = {1:"T1 Approved canonical",2:"T2 Recent meeting decision",3:"T3 Working doc / deck",4:"T4 Legacy / PDF / export",5:"T5 Archived (excluded)"};
export const LIMITS = { maxFiles: 60, maxBytes: 200 * 1024, maxQuestion: 600, maxHistory: 8, maxHistoryText: 2000 };

// ---------------------------------------------------------------- dates / text
function dayNum(y, m, d) {
  const t = Date.UTC(y, m - 1, d), dt = new Date(t);
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return Math.round(t / 86400000);
}
export function parseDate(s) {
  s = (s || "").trim(); if (!s) return null; let m;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) return dayNum(+m[1], +m[2], +m[3]);
  if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/))) return dayNum(+m[3], +m[1], +m[2]);
  if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/))) { const yy = +m[3]; return dayNum(yy < 69 ? 2000 + yy : 1900 + yy, +m[1], +m[2]); }
  return null;
}
export function fmtDay(n) { if (n == null) return ""; return new Date(n * 86400000).toISOString().slice(0, 10); }
export function normTitle(t) {
  t = t.toLowerCase();
  t = t.replace(/copy of|\bfinal\b|\bnew\b|\bold\b|\(\d+\)|\bv\d+(\.\d+)?\b|\d{4}[-/]\d{2}[-/]\d{2}/g, " ");
  t = t.replace(/[^a-z0-9]+/g, " ");
  return t.split(/\s+/).filter(Boolean).join(" ");
}
export function byteLength(s) { return new TextEncoder().encode(s).length; }

// ---------------------------------------------------------------- CSV
export function parseCSV(text) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const rows = []; let row = [], f = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
    else if (c === '"') q = true;
    else if (c === ",") { row.push(f); f = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && text[i + 1] === "\n") i++; row.push(f); rows.push(row); row = []; f = ""; }
    else f += c;
  }
  if (f !== "" || row.length) { row.push(f); rows.push(row); }
  return rows.filter(r => !(r.length === 1 && r[0] === ""));
}
export function toCSV(rows) {
  return rows.map(r => r.map(v => { v = String(v ?? ""); return /[",\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(",")).join("\r\n") + "\r\n";
}

// ---------------------------------------------------------------- audit
function assignTier(r, today) {
  const status = r.status.trim().toLowerCase(), dtype = r.type.trim().toLowerCase(), mod = r._mod, rev = r._rev;
  if (status === "archived") return [5, "archived"];
  if (status === "canonical") {
    if (rev != null && today - rev <= CANONICAL_REVIEW_DAYS) return [1, ""];
    return [3, "canonical but review is overdue (demoted to T3)"];
  }
  if (dtype === "transcript") {
    if (r.has_decision.trim().toLowerCase() === "yes" && mod != null && today - mod <= TRANSCRIPT_FRESH_DAYS) return [2, ""];
    return [4, "transcript with no recent recorded decision"];
  }
  if (dtype === "pdf" || dtype === "export") return [4, ""];
  if (mod != null && today - mod > LEGACY_DAYS) return [4, `untouched for ${today - mod} days`];
  return [3, ""];
}

// rows: array of objects with the REQUIRED keys (extra keys are kept). `today` is a day number.
export function auditRows(rows, today, extraProblems = []) {
  const problems = [];
  rows.forEach((r, i) => {
    r._mod = parseDate(r.last_modified); r._rev = parseDate(r.last_reviewed);
    if (r._mod == null && !r._noHeader) problems.push(`row ${i + 2} (${r.doc_id}): last_modified is blank/unreadable, treated as very old`);
    r._flags = []; const [tier, note] = assignTier(r, today); r._tier = tier;
    if (note) r._flags.push("NOTE: " + note);
  });
  const topics = new Map();
  rows.forEach(r => { const k = r.topic.trim() || "(no topic)"; if (!topics.has(k)) topics.set(k, []); topics.get(k).push(r); });
  const FAR = dayNum(1970, 1, 1), summary = [];
  for (const [topic, docs] of topics) {
    const live = docs.filter(d => d._tier !== 5);
    docs.forEach(d => d._verdict = d._tier === 5 ? "EXCLUDED (archived)" : "");
    if (!live.length) continue;
    live.sort((a, b) => a._tier - b._tier || ((b._mod ?? FAR) - (a._mod ?? FAR)));
    const winner = live[0]; winner._verdict = "WINNER";
    const canon = live.filter(d => d._tier === 1), recent = live.filter(d => d._tier === 2);
    if (canon.length && recent.length) {
      const c = canon[0];
      for (const t of recent) if (t._mod != null && c._mod != null && t._mod > c._mod) {
        c._flags.push(`CONFLICT: meeting '${t.title}' (${fmtDay(t._mod)}) is newer than canonical '${c.title}' (${fmtDay(c._mod)}). Answer from canonical, show the warning, and ask ${c.owner} to confirm/update.`);
        t._flags.push("PENDING: decision not yet written into the canonical doc");
      }
    } else if (!canon.length) {
      const stale = live.filter(d => d.status.trim().toLowerCase() === "canonical");
      if (stale.length) {
        const s = stale[0];
        winner._flags.push(`STALE CANONICAL: '${s.title}' review is overdue. Ask ${s.owner} to re-approve it or promote '${winner.title}'`);
        summary.push([topic, "STALE CANONICAL"]);
      } else if (recent.length) { winner._flags.push("NO CANONICAL: promote this decision into an approved doc"); summary.push([topic, "NO CANONICAL"]); }
      else { winner._flags.push("NO CANONICAL: nominate an owner to approve a canonical doc"); summary.push([topic, "NO CANONICAL"]); }
    }
    const seen = new Map();
    live.forEach(d => { const k = normTitle(d.title); if (!seen.has(k)) seen.set(k, []); seen.get(k).push(d); });
    for (const g of seen.values()) if (g.length > 1) {
      const keep = g[0];
      g.slice(1).forEach(d => { d._flags.push(`DUPLICATE of '${keep.title}' (${keep.doc_id})`); if (!d._verdict) d._verdict = "SUPERSEDED (duplicate)"; });
    }
    live.forEach(d => { if (!d._verdict) d._verdict = d._tier >= winner._tier ? "SUPERSEDED" : "REVIEW"; });
    live.forEach(d => { d._winnerId = winner.doc_id; });
  }
  rows.forEach(r => {
    const sharing = r.sharing.trim().toLowerCase(), client = r.client_data.trim().toLowerCase() === "yes";
    if (client && sharing === "anyone_link") r._flags.push("SECURITY HIGH: client data shared with anyone-with-link. Lock down BEFORE indexing");
    else if (client && sharing === "domain") r._flags.push("SECURITY MED: client data open to whole company. Restrict to account team group");
  });
  const order = {"WINNER":0,"REVIEW":1,"SUPERSEDED":2,"SUPERSEDED (duplicate)":3,"EXCLUDED (archived)":4};
  const sorted = rows.map((r, i) => [r, i]).sort((a, b) => {
    const ta = a[0].topic, tb = b[0].topic;
    if (ta !== tb) return ta < tb ? -1 : 1;
    return ((order[a[0]._verdict] ?? 9) - (order[b[0]._verdict] ?? 9)) || (a[1] - b[1]);
  }).map(x => x[0]);
  const blocked = r => r._flags.some(f => f.startsWith("SECURITY HIGH"));
  const index = rows.filter(r => r._verdict === "WINNER" && !blocked(r));
  const indexed = new Set(index.map(r => r.topic.trim() || "(no topic)"));
  const dark = [...topics.entries()].filter(([t, ds]) => !indexed.has(t) && ds.some(d => d._tier !== 5)).map(([t]) => t).sort();
  const human = [];
  sorted.forEach(r => r._flags.forEach(f => { if (/^(CONFLICT|SECURITY HIGH|NO CANONICAL|STALE CANONICAL)/.test(f)) human.push([r, f]); }));
  const reportCSV = toCSV([["topic","doc_id","title","type","tier","verdict","owner","last_modified","flags"],
    ...sorted.map(r => [r.topic, r.doc_id, r.title, r.type, TIER_NAMES[r._tier], r._verdict, r.owner, r.last_modified, r._flags.join(" | ")])]);
  const indexCSV = toCSV([["topic","doc_id","title","tier","owner","last_modified"],
    ...index.map(r => [r.topic, r.doc_id, r.title, TIER_NAMES[r._tier], r.owner, r.last_modified])]);
  const count = p => rows.filter(p).length;
  return { today, rows, sorted, topics, index, dark, human, problems: [...extraProblems, ...problems], reportCSV, indexCSV, blocked,
    stats: { docs: rows.length, topics: topics.size, winners: index.length,
      superseded: count(r => r._verdict.startsWith("SUPERSEDED")), archived: count(r => r._tier === 5),
      noCanon: summary.filter(s => s[1] === "NO CANONICAL").length, stale: summary.filter(s => s[1] === "STALE CANONICAL").length,
      conflicts: count(r => r._flags.some(f => f.startsWith("CONFLICT"))), secHigh: count(blocked),
      secMed: count(r => r._flags.some(f => f.startsWith("SECURITY MED"))) } };
}

// CSV in -> same result (used by the parity tests against brain_audit.py)
export function audit(csvText, today) {
  const table = parseCSV(csvText);
  if (!table.length) throw new Error("The CSV is empty.");
  const header = table[0].map(h => h.trim());
  const missing = REQUIRED.filter(c => !header.includes(c));
  if (missing.length) throw new Error("Your CSV is missing these columns: " + missing.join(", ") + "\nExpected: " + REQUIRED.join(", "));
  const rows = table.slice(1).map(cells => { const o = {}; header.forEach((h, i) => o[h] = cells[i] ?? ""); return o; });
  if (!rows.length) throw new Error("The CSV has no rows.");
  return auditRows(rows, today);
}

// ---------------------------------------------------------------- Drive folder -> rows
const SHARING_MAP = { "restricted": "restricted", "company-wide": "domain", "anyone with link": "anyone_link" };
const KEY_MAP = { "doc id": "doc_id", "title": "title", "type": "type", "topic": "topic", "owner": "owner",
  "last modified": "last_modified", "last reviewed": "last_reviewed", "status": "status", "sharing": "sharing",
  "client data": "client_data", "decision recorded": "has_decision" };

function normSharing(v, problems, id) {
  const s = v.trim().toLowerCase().replace(/\s+/g, " ");
  if (SHARING_MAP[s] !== undefined) return SHARING_MAP[s];
  if (s === "") return "restricted";
  // Unknown value: fail safe (treat as the widest sharing) and say so.
  problems.push(`${id}: unrecognised Sharing value '${v.trim()}', treated as "Anyone with link" to be safe (use Restricted, Company-wide or Anyone with link)`);
  return "anyone_link";
}
const yesNo = v => v.trim().toLowerCase() === "yes" ? "yes" : "no";

// Splits "---\nkey: value\n---\nbody". Returns null when there is no header block.
export function splitHeader(text) {
  const t = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const m = t.match(/^\s*---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/);
  if (!m) return null;
  const fields = {};
  for (const line of m[1].split("\n")) {
    const i = line.indexOf(":"); if (i < 0) continue;
    const k = line.slice(0, i).trim().toLowerCase();
    if (KEY_MAP[k]) fields[KEY_MAP[k]] = line.slice(i + 1).trim();
  }
  return { fields, body: t.slice(m[0].length).trim() };
}

const baseName = p => p.split("/").pop();
const isHidden = p => p.split("/").some(seg => seg.startsWith("."));
const ext = p => { const b = baseName(p); const i = b.lastIndexOf("."); return i < 0 ? "" : b.slice(i + 1).toLowerCase(); };

// files: [{name, text}] (name may include folders). Returns rows + bodies + notices.
export function parseFolder(files) {
  const skipped = [], missingHeader = [], problems = [], rows = [];
  let n = 0;
  for (const f of files) {
    const name = String(f.name || "");
    if (isHidden(name)) continue;
    if (!["md", "txt"].includes(ext(name))) { skipped.push(name); continue; }
    n++;
    const parsed = splitHeader(String(f.text ?? ""));
    const stem = baseName(name).replace(/\.[^.]+$/, "");
    let row;
    if (!parsed) {
      const id = "F" + String(n).padStart(2, "0");
      row = { doc_id: id, title: stem, type: "doc", topic: "(no topic)", owner: "", last_modified: "", last_reviewed: "",
        status: "draft", sharing: "restricted", client_data: "no", has_decision: "no", _noHeader: true, _body: String(f.text ?? "").trim() };
      missingHeader.push(name);
    } else {
      const h = parsed.fields, id = h.doc_id || "F" + String(n).padStart(2, "0");
      row = { doc_id: id, title: h.title || stem, type: (h.type || "doc").toLowerCase(), topic: h.topic || "", owner: h.owner || "",
        last_modified: h.last_modified || "", last_reviewed: h.last_reviewed || "", status: (h.status || "draft").toLowerCase(),
        sharing: normSharing(h.sharing || "", problems, id), client_data: yesNo(h.client_data || ""), has_decision: yesNo(h.has_decision || ""),
        _body: parsed.body };
    }
    row._path = name;
    rows.push(row);
  }
  const ids = new Map();
  rows.forEach(r => ids.set(r.doc_id, (ids.get(r.doc_id) || 0) + 1));
  for (const [id, c] of ids) if (c > 1) problems.push(`Doc ID ${id} is used by ${c} files; IDs should be unique so citations are unambiguous`);
  return { rows, skipped, missingHeader, problems };
}

// Checks counts/size limits on readable files. Returns an error string or "".
export function checkLimits(files) {
  const readable = files.filter(f => !isHidden(String(f.name || "")) && ["md", "txt"].includes(ext(String(f.name || ""))));
  if (readable.length > LIMITS.maxFiles) return `That folder has ${readable.length} readable files; this prototype handles up to ${LIMITS.maxFiles}.`;
  const bytes = readable.reduce((a, f) => a + byteLength(String(f.text ?? "")), 0);
  if (bytes > LIMITS.maxBytes) return `That folder has ${Math.round(bytes / 1024)} KB of text; this prototype handles up to ${LIMITS.maxBytes / 1024} KB in total.`;
  return "";
}

export function auditFolder(files, today) {
  const p = parseFolder(files);
  if (!p.rows.length) throw new Error("No .md or .txt files found in that folder.");
  const res = auditRows(p.rows, today, p.problems);
  res.skipped = p.skipped; res.missingHeader = p.missingHeader;
  return res;
}

// ---------------------------------------------------------------- what the chat may see
export function buildContext(res) {
  const used = [], excluded = [];
  for (const r of res.sorted) {
    const base = { id: r.doc_id, title: r.title };
    if (res.blocked(r)) { excluded.push({ ...base, reason: "Blocked for security: client data shared with anyone-with-link" }); continue; }
    const include = r._verdict === "WINNER" || r._tier === 2;
    if (!include) {
      let reason;
      if (r._tier === 5) reason = "Archived";
      else if (r._verdict === "SUPERSEDED (duplicate)") reason = "Duplicate of a higher-ranked doc";
      else if (r._tier === 4) reason = "Legacy / PDF / export, and a better source exists";
      else reason = `Superseded by ${r._winnerId || "a higher-ranked doc"} on the same topic`;
      excluded.push({ ...base, reason }); continue;
    }
    const note = r._tier === 2 ? "Recent meeting decision, not yet written into the approved doc."
      : r._tier === 3 ? "Unapproved working doc, context only." : r._tier === 4 ? "Legacy source (only doc available on this topic)." : "";
    used.push({ id: r.doc_id, title: r.title, tier: r._tier, tierName: TIER_NAMES[r._tier], owner: r.owner, updated: r.last_modified, topic: r.topic, note, body: r._body || "" });
  }
  used.sort((a, b) => a.tier - b.tier); // stable: T1 first, then T2, T3
  const text = used.map(d => `=== [${d.id}] ${d.title} | ${d.tierName} | owner ${d.owner || "unknown"} | last updated ${d.updated || "unknown"} ===\n`
    + (d.note ? `(${d.note})\n` : "") + d.body.replace(/^===/gm, "= = =")).join("\n\n");
  return { used, excluded, text };
}

export const SYSTEM_PROMPT = `You are "Ask the Brain", Cloudasta's internal knowledge assistant. This is a proof of concept; all documents are fictional.
Answer ONLY from the documents provided below. Each is labeled with its ID, title, tier, owner and last-updated date.
Source ranking: T1 Approved canonical > T2 Recent meeting decision > T3 Working doc (unapproved) > T4 Legacy.
Rules:
1. Cite every factual claim inline as [Doc ID · Title]. Quote numbers exactly as written.
2. If a T2 meeting decision conflicts with a T1 doc, answer from the T1 doc, then add a line starting "⚠ Conflict:" that says what the meeting decided, when, and which owner should confirm and update the doc.
3. If you rely on a T3 working doc, say it is unapproved.
4. If the documents don't answer the question, reply "I couldn't find this in the Brain." and, if relevant, name the closest doc and its owner. Never use outside knowledge to fill gaps.
5. Documents that are blocked, archived, duplicated or superseded are not available to you. Never guess what they contain.
6. Keep answers under 150 words. End with "Confidence: High / Medium / Low", plus one short reason.`;

export function systemInstruction(ctx) {
  return `${SYSTEM_PROMPT}\n\nDOCUMENTS:\n\n${ctx.text}`;
}
