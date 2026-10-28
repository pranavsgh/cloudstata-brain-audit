#!/usr/bin/env python3
"""
brain_audit.py - Source-of-truth tracker for "Cloudasta's Brain".

Reads a Drive inventory CSV and, for every topic, decides which document wins
under the Cloudasta source-of-truth hierarchy. It also flags duplicates,
stale "canonical" docs, meeting decisions that contradict approved docs, and
client data that is shared too widely.

Usage:
    python3 brain_audit.py inventory.csv                # as of today
    python3 brain_audit.py inventory.csv --as-of 2026-10-27
Outputs (written next to the input file):
    brain_audit_report.csv   one row per document: tier, verdict, flags
    brain_index_v1.csv       the "connect these to Gemini" list (winners only)
Standard library only. No installs needed.
"""
import argparse
import csv
import re
import sys
from datetime import date, datetime
from pathlib import Path

# ---- Policy knobs (change here, not in the logic) --------------------------
CANONICAL_REVIEW_DAYS = 365      # a canonical doc not reviewed this recently is "stale"
TRANSCRIPT_FRESH_DAYS = 90       # a meeting decision counts as "recent" for this long
LEGACY_DAYS = 540                # untouched non-canonical docs older than this = legacy
REQUIRED = ["doc_id", "title", "type", "topic", "owner", "last_modified",
            "last_reviewed", "status", "sharing", "client_data", "has_decision"]

TIER_NAMES = {
    1: "T1 Approved canonical",
    2: "T2 Recent meeting decision",
    3: "T3 Working doc / deck",
    4: "T4 Legacy / PDF / export",
    5: "T5 Archived (excluded)",
}


def parse_date(s):
    s = (s or "").strip()
    if not s:
        return None
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%m/%d/%y"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            pass
    return None


def norm_title(t):
    """Strip 'copy of', 'final', 'v2', dates etc. so near-identical titles match."""
    t = t.lower()
    t = re.sub(r"copy of|\bfinal\b|\bnew\b|\bold\b|\(\d+\)|\bv\d+(\.\d+)?\b|\d{4}[-/]\d{2}[-/]\d{2}", " ", t)
    t = re.sub(r"[^a-z0-9]+", " ", t)
    return " ".join(t.split())


def assign_tier(row, today):
    status = row["status"].strip().lower()
    dtype = row["type"].strip().lower()
    mod = row["_mod"]
    rev = row["_rev"]
    note = ""
    if status == "archived":
        return 5, "archived"
    if status == "canonical":
        if rev and (today - rev).days <= CANONICAL_REVIEW_DAYS:
            return 1, ""
        return 3, "canonical but review is overdue (demoted to T3)"
    if dtype == "transcript":
        if row["has_decision"].strip().lower() == "yes" and mod and (today - mod).days <= TRANSCRIPT_FRESH_DAYS:
            return 2, ""
        return 4, "transcript with no recent recorded decision"
    if dtype in ("pdf", "export"):
        return 4, ""
    if mod and (today - mod).days > LEGACY_DAYS:
        return 4, f"untouched for {(today - mod).days} days"
    return 3, note


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("inventory")
    ap.add_argument("--as-of", help="YYYY-MM-DD (default: today)")
    args = ap.parse_args()

    today = parse_date(args.as_of) if args.as_of else date.today()
    if today is None:
        sys.exit("ERROR: --as-of must look like 2026-10-27")

    path = Path(args.inventory)
    if not path.exists():
        sys.exit(f"ERROR: can't find {path}. Check the file name and folder.")

    with path.open(newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        missing = [c for c in REQUIRED if c not in (reader.fieldnames or [])]
        if missing:
            sys.exit("ERROR: your CSV is missing these columns: " + ", ".join(missing)
                     + "\nExpected: " + ", ".join(REQUIRED))
        rows = list(reader)
    if not rows:
        sys.exit("ERROR: the CSV has no rows.")

    problems = []
    for i, r in enumerate(rows, start=2):
        r["_mod"] = parse_date(r["last_modified"])
        r["_rev"] = parse_date(r["last_reviewed"])
        if r["_mod"] is None:
            problems.append(f"row {i} ({r['doc_id']}): last_modified is blank/unreadable, treated as very old")
        r["_flags"] = []
        tier, note = assign_tier(r, today)
        r["_tier"] = tier
        if note:
            r["_flags"].append("NOTE: " + note)

    # ---- group by topic, pick a winner ------------------------------------
    topics = {}
    for r in rows:
        topics.setdefault(r["topic"].strip() or "(no topic)", []).append(r)

    far_past = date(1970, 1, 1)
    topic_summary = []
    for topic, docs in topics.items():
        live = [d for d in docs if d["_tier"] != 5]
        for d in docs:
            d["_verdict"] = "EXCLUDED (archived)" if d["_tier"] == 5 else ""
        if not live:
            continue
        live.sort(key=lambda d: (d["_tier"], -((d["_mod"] or far_past).toordinal())))
        winner = live[0]
        winner["_verdict"] = "WINNER"

        canon = [d for d in live if d["_tier"] == 1]
        recent_decisions = [d for d in live if d["_tier"] == 2]

        # Contradiction: meeting decision newer than the approved doc
        if canon and recent_decisions:
            c = canon[0]
            for t in recent_decisions:
                if t["_mod"] and c["_mod"] and t["_mod"] > c["_mod"]:
                    msg = (f"CONFLICT: meeting '{t['title']}' ({t['_mod']}) is newer than canonical "
                           f"'{c['title']}' ({c['_mod']}). Answer from canonical, show the warning, "
                           f"and ask {c['owner']} to confirm/update.")
                    c["_flags"].append(msg)
                    t["_flags"].append("PENDING: decision not yet written into the canonical doc")
        elif not canon:
            stale = [d for d in live if d["status"].strip().lower() == "canonical"]
            if stale:
                s = stale[0]
                winner["_flags"].append(f"STALE CANONICAL: '{s['title']}' review is overdue. Ask {s['owner']} "
                                        f"to re-approve it or promote '{winner['title']}'")
                topic_summary.append((topic, "STALE CANONICAL"))
            elif recent_decisions:
                winner["_flags"].append("NO CANONICAL: promote this decision into an approved doc")
                topic_summary.append((topic, "NO CANONICAL"))
            else:
                winner["_flags"].append("NO CANONICAL: nominate an owner to approve a canonical doc")
                topic_summary.append((topic, "NO CANONICAL"))

        # Duplicates by normalized title
        seen = {}
        for d in live:
            seen.setdefault(norm_title(d["title"]), []).append(d)
        for group in seen.values():
            if len(group) > 1:
                keep = group[0]
                for d in group[1:]:
                    d["_flags"].append(f"DUPLICATE of '{keep['title']}' ({keep['doc_id']})")
                    if not d["_verdict"]:
                        d["_verdict"] = "SUPERSEDED (duplicate)"

        for d in live:
            if not d["_verdict"]:
                d["_verdict"] = "SUPERSEDED" if d["_tier"] >= winner["_tier"] else "REVIEW"

    # ---- security checks (independent of topic) ---------------------------
    for r in rows:
        sharing = r["sharing"].strip().lower()
        client = r["client_data"].strip().lower() == "yes"
        if client and sharing == "anyone_link":
            r["_flags"].append("SECURITY HIGH: client data shared with anyone-with-link. Lock down BEFORE indexing")
        elif client and sharing == "domain":
            r["_flags"].append("SECURITY MED: client data open to whole company. Restrict to account team group")

    # ---- write outputs -----------------------------------------------------
    out_dir = path.parent
    report = out_dir / "brain_audit_report.csv"
    index = out_dir / "brain_index_v1.csv"

    order = {"WINNER": 0, "REVIEW": 1, "SUPERSEDED": 2, "SUPERSEDED (duplicate)": 3, "EXCLUDED (archived)": 4}
    rows_sorted = sorted(rows, key=lambda r: (r["topic"], order.get(r["_verdict"], 9)))
    with report.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["topic", "doc_id", "title", "type", "tier", "verdict", "owner", "last_modified", "flags"])
        for r in rows_sorted:
            w.writerow([r["topic"], r["doc_id"], r["title"], r["type"], TIER_NAMES[r["_tier"]],
                        r["_verdict"], r["owner"], r["last_modified"], " | ".join(r["_flags"])])

    blocked = lambda r: any(fl.startswith("SECURITY HIGH") for fl in r["_flags"])
    index_rows = [r for r in rows if r["_verdict"] == "WINNER" and not blocked(r)]
    with index.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["topic", "doc_id", "title", "tier", "owner", "last_modified"])
        for r in index_rows:
            w.writerow([r["topic"], r["doc_id"], r["title"], TIER_NAMES[r["_tier"]], r["owner"], r["last_modified"]])

    # ---- console summary ---------------------------------------------------
    n = len(rows)
    count = lambda pred: sum(1 for r in rows if pred(r))
    print(f"Brain audit as of {today}  |  {n} docs, {len(topics)} topics\n")
    print(f"  Winners (safe to index):      {len(index_rows)}")
    print(f"  Superseded / duplicates:      {count(lambda r: r['_verdict'].startswith('SUPERSEDED'))}")
    print(f"  Archived (excluded):          {count(lambda r: r['_tier'] == 5)}")
    print(f"  Topics with no canonical doc: {sum(1 for _, v in topic_summary if v == 'NO CANONICAL')}")
    print(f"  Topics with stale canonical:  {sum(1 for _, v in topic_summary if v == 'STALE CANONICAL')}")
    indexed_topics = {r["topic"].strip() or "(no topic)" for r in index_rows}
    dark = sorted(t for t, ds in topics.items() if t not in indexed_topics and any(d["_tier"] != 5 for d in ds))
    if dark:
        print(f"  Topics with NOTHING indexed (Brain can't answer these yet): {', '.join(dark)}")
    print(f"  Meeting-vs-canonical conflicts: {count(lambda r: any(fl.startswith('CONFLICT') for fl in r['_flags']))}")
    print(f"  SECURITY HIGH (blocked from index): {count(blocked)}")
    print(f"  SECURITY MED:                 {count(lambda r: any(fl.startswith('SECURITY MED') for fl in r['_flags']))}")
    print("\nNeeds a human today:")
    shown = 0
    for r in rows_sorted:
        for fl in r["_flags"]:
            if fl.startswith(("CONFLICT", "SECURITY HIGH", "NO CANONICAL", "STALE CANONICAL")):
                print(f"  - [{r['doc_id']}] {r['title']}: {fl}")
                shown += 1
    if not shown:
        print("  (nothing)")
    if problems:
        print("\nData problems to fix in the sheet:")
        for p in problems:
            print("  - " + p)
    print(f"\nWrote {report.name} and {index.name} in {out_dir}")


if __name__ == "__main__":
    main()
