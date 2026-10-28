"""Writes the fake 'Cloudasta Drive' folder (15 fictional docs) + sample-drive.js + zip.
Every doc starts with a header block (the Task 1 'owner / last reviewed / status' header),
which is how the site gets the metadata real Drive would give it via the Drive API."""
import json, zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "sample-drive"
OUT.mkdir(exist_ok=True)

DOCS = [
 dict(id="D01", file="Pricing/Pricing Framework 2026.md", title="Pricing Framework 2026", type="Doc", topic="Pricing", owner="ceo@cloudasta.com",
      mod="2026-03-02", rev="2026-03-02", status="Canonical", sharing="Company-wide", client="No", decision="No", body="""
# Pricing Framework 2026
Approved by the CEO. Applies to all new statements of work signed in 2026.

## Google Workspace migration (per seat)
| Seats | Price per seat |
| --- | --- |
| 1–249 | $18 |
| 250–999 | $15 |
| 1,000+ | Custom quote (CEO approval) |

## Enablement services
- Gemini Enterprise enablement workshop: $2,500 per session (up to 25 attendees).
- Office hours retainer: $1,200 per month (two 30-minute sessions).

## Rules
- Minimum engagement: $5,000 per statement of work.
- Discounts: no standard discounts. Any exception needs written CEO approval.
"""),
 dict(id="D02", file="Pricing/Copy of Pricing Framework 2026.md", title="Copy of Pricing Framework 2026", type="Doc", topic="Pricing", owner="sales1@cloudasta.com",
      mod="2026-04-11", rev="", status="Draft", sharing="Company-wide", client="No", decision="No", body="""
# Copy of Pricing Framework 2026 (sales working copy)
Same tiers as the approved framework: $18 / $15 / custom per seat; workshop $2,500; office hours $1,200/month; $5,000 minimum.

DRAFT IDEA (not approved): offer nonprofits a 10% discount to win more deals?
"""),
 dict(id="D03", file="Pricing/Pricing Framework 2024 FINAL.md", title="Pricing Framework 2024 FINAL", type="PDF", topic="Pricing", owner="ceo@cloudasta.com",
      mod="2024-01-15", rev="", status="Legacy", sharing="Company-wide", client="No", decision="No", body="""
# Pricing Framework 2024 (exported PDF)
- Workspace migration: $12 per seat, flat.
- Gemini workshop: $1,500 per session.
- No minimum engagement.
"""),
 dict(id="D04", file="Meet Recordings/Leadership sync - pricing change (Meet transcript).md", title="Leadership sync - pricing change (Meet transcript)", type="Transcript", topic="Pricing", owner="ops@cloudasta.com",
      mod="2026-10-14", rev="", status="Draft", sharing="Restricted", client="No", decision="Yes", body="""
# Leadership sync – Oct 14, 2026 (Meet transcript, excerpt)
CEO: Costs went up with the archive-heavy migrations. I want new prices starting January 1, 2027.
Ops: For which tiers?
CEO: 1 to 249 seats goes from $18 to $20 per seat. 250 to 999 goes from $15 to $16. And the enablement workshop goes to $3,000.
Ops: Minimum engagement stays $5,000?
CEO: Yes, unchanged.
DECISION: New per-seat prices ($20 / $16) and $3,000 workshop, effective January 1, 2027.
ACTION: CEO to update the Pricing Framework doc by November 1.
"""),
 dict(id="D05", file="Delivery SOPs/GE Migration SOP.md", title="GE Migration SOP", type="Doc", topic="Migration SOP", owner="eng-lead@cloudasta.com",
      mod="2025-06-10", rev="2025-06-10", status="Canonical", sharing="Company-wide", client="No", decision="No", body="""
# Gemini Enterprise Migration SOP (2025)
1. Kickoff call with client IT.
2. Turn on Gemini for all users.
3. Run one training session.
4. Send a user guide.
5. Close the project.
"""),
 dict(id="D06", file="Delivery SOPs/GE Migration SOP v2 (working).md", title="GE Migration SOP v2 (working)", type="Doc", topic="Migration SOP", owner="eng2@cloudasta.com",
      mod="2026-09-20", rev="", status="Draft", sharing="Company-wide", client="No", decision="No", body="""
# Gemini Enterprise Migration SOP v2 (WORKING DRAFT – not yet approved)
1. Kickoff with client IT and a business sponsor; agree on 3 workflows to improve.
2. Access audit: find files shared "anyone with link" or company-wide that hold sensitive data, and restrict them BEFORE turning anything on.
3. Pilot with 10–20 users from the chosen workflows.
4. Two office hours sessions during the pilot, using real tasks.
5. Measure weekly active use of the Gemini app (not just licenses assigned).
6. Expand to all users once pilot weekly use is above 60%.
7. Hand over a prompt library and the adoption scorecard.
"""),
 dict(id="D07", file="Clients/Acme Corp/Acme Corp QBR notes Q3.md", title="Acme Corp QBR notes Q3", type="Doc", topic="Acme QBR", owner="am1@cloudasta.com",
      mod="2026-09-30", rev="2026-09-30", status="Canonical", sharing="Anyone with link", client="Yes", decision="No", body="""
# Acme Corp – Q3 QBR notes (CONFIDENTIAL client notes)
- Acme is considering cutting 40 seats at renewal in February.
- Their internal champion is leaving in December; renewal is at risk.
- They asked for a 15% discount to renew for two years.
"""),
 dict(id="D08", file="Clients/Acme Corp/Acme Corp QBR deck Q3.md", title="Acme Corp QBR deck Q3", type="Slides", topic="Acme QBR", owner="am1@cloudasta.com",
      mod="2026-09-28", rev="", status="Draft", sharing="Company-wide", client="Yes", decision="No", body="""
# Acme Corp Q3 QBR (slide text)
Slide 1: Q3 adoption: 61% weekly active users.
Slide 2: Top workflows: meeting follow-ups, proposal drafts.
Slide 3: Next quarter: expand Gemini to the finance team.
"""),
 dict(id="D09", file="Sales/Proposal template - Workspace migration.md", title="Proposal template - Workspace migration", type="Slides", topic="Proposal template", owner="sales1@cloudasta.com",
      mod="2026-07-01", rev="", status="Draft", sharing="Company-wide", client="No", decision="No", body="""
# Proposal template – Workspace migration
1. Client goals (3 bullets, in their words)
2. Current setup and pain points
3. Our approach (link the Migration SOP)
4. Timeline (pilot, then full rollout)
5. Investment (pull prices from the current Pricing Framework)
6. Why Cloudasta (Google Premier Partner, case study)
"""),
 dict(id="D10", file="Sales/Proposal template - Workspace migration (1).md", title="Proposal template - Workspace migration (1)", type="Slides", topic="Proposal template", owner="sales2@cloudasta.com",
      mod="2026-05-12", rev="", status="Draft", sharing="Company-wide", client="No", decision="No", body="""
# Proposal template – Workspace migration (older copy)
1. Client goals
2. Our approach
3. Investment
"""),
 dict(id="D11", file="HR/Archive/Onboarding checklist 2023.md", title="Onboarding checklist 2023", type="Doc", topic="Onboarding", owner="hr@cloudasta.com",
      mod="2023-02-01", rev="", status="Archived", sharing="Company-wide", client="No", decision="No", body="""
# Onboarding checklist (2023 – archived)
- Get a laptop from the office manager.
- Read the 2023 pricing sheet.
"""),
 dict(id="D12", file="HR/Onboarding checklist.md", title="Onboarding checklist", type="Doc", topic="Onboarding", owner="hr@cloudasta.com",
      mod="2026-08-15", rev="2026-08-15", status="Canonical", sharing="Company-wide", client="No", decision="No", body="""
# New hire onboarding checklist
## Day 1
- Workspace account, 2-step verification, laptop setup.
- Join the #ask-the-brain Chat space.
## Week 1
- Shadow two client calls.
- Complete the Google Workspace and Gemini Enterprise fundamentals courses.
## Week 2
- Build your first proposal draft with the Proposal Starter Skill and review it with your manager.
"""),
 dict(id="D13", file="Meet Recordings/All-hands Meet transcript Sept.md", title="All-hands Meet transcript Sept", type="Transcript", topic="Onboarding", owner="ceo@cloudasta.com",
      mod="2026-09-05", rev="", status="Draft", sharing="Company-wide", client="No", decision="No", body="""
# September all-hands (Meet transcript, excerpt)
CEO: Welcome to our two new hires. Q3 was our best quarter for Gemini projects.
Ops: Reminder to log your hours on Fridays.
(No decisions recorded.)
"""),
 dict(id="D14", file="Client Enablement/Office Hours Playbook.md", title="Office Hours Playbook", type="Doc", topic="Office hours", owner="enablement@cloudasta.com",
      mod="2026-09-12", rev="2026-09-12", status="Canonical", sharing="Company-wide", client="No", decision="No", body="""
# Client Office Hours Playbook
- Length: 30 minutes, virtual.
- Agenda: 4-min hook, two 3-minute live demos, 12 minutes hands-on, 4 minutes Q&A, 2-minute close.
- Max 40 attendees per session.
- Always end with a 7-day challenge and send the IT lead a usage report.
"""),
 dict(id="D15", file="Meet Recordings/Office hours retro (Meet transcript).md", title="Office hours retro (Meet transcript)", type="Transcript", topic="Office hours", owner="enablement@cloudasta.com",
      mod="2026-10-22", rev="", status="Draft", sharing="Company-wide", client="No", decision="Yes", body="""
# Office hours retro – Oct 22, 2026 (Meet transcript, excerpt)
Enablement lead: Hands-on keeps running over. People need more time.
CEO: Then let's make sessions 45 minutes and cap them at 25 people.
DECISION: Office hours become 45 minutes, max 25 attendees, starting November.
ACTION: Enablement lead to update the playbook.
"""),
]

def header(d):
    rows = [("Doc ID", d["id"]), ("Title", d["title"]), ("Type", d["type"]), ("Topic", d["topic"]), ("Owner", d["owner"]),
            ("Last modified", d["mod"]), ("Last reviewed", d["rev"]), ("Status", d["status"]), ("Sharing", d["sharing"]),
            ("Client data", d["client"]), ("Decision recorded", d["decision"])]
    return "---\n" + "\n".join(f"{k}: {v}" for k, v in rows) + "\n---\n"

files = []
for d in DOCS:
    text = header(d) + d["body"].strip() + "\n"
    p = OUT / d["file"]
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text, encoding="utf-8")
    files.append({"name": "Cloudasta Drive (fake)/" + d["file"], "text": text})

(ROOT / "sample-drive.js").write_text(
    "// Generated by tools/make_drive.py. Fictional sample Drive folder.\nexport const SAMPLE_FILES = " + json.dumps(files, indent=1) + ";\n",
    encoding="utf-8")
with zipfile.ZipFile(ROOT / "cloudasta-drive-sample.zip", "w", zipfile.ZIP_DEFLATED) as z:
    for d in DOCS:
        z.write(OUT / d["file"], "Cloudasta Drive (fake)/" + d["file"])
print(len(files), "docs,", sum(len(f["text"]) for f in files), "chars")
