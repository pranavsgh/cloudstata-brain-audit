#!/usr/bin/env python3
"""Turns a folder of docs with header blocks into an inventory CSV for brain_audit.py.
Used by tests/folder.test.js as an independent check of the JavaScript header parser.
Usage: python3 tools/folder_to_inventory.py sample-drive out.csv"""
import csv, sys
from pathlib import Path

SHARING = {"restricted": "restricted", "company-wide": "domain", "anyone with link": "anyone_link"}
COLS = ["doc_id", "title", "type", "topic", "owner", "last_modified", "last_reviewed", "status", "sharing", "client_data", "has_decision"]
KEYS = {"doc id": "doc_id", "title": "title", "type": "type", "topic": "topic", "owner": "owner", "last modified": "last_modified",
        "last reviewed": "last_reviewed", "status": "status", "sharing": "sharing", "client data": "client_data",
        "decision recorded": "has_decision"}

def read_header(path):
    lines = path.read_text(encoding="utf-8").split("\n")
    assert lines[0].strip() == "---", f"{path} has no header"
    end = lines.index("---", 1)
    out = {}
    for ln in lines[1:end]:
        k, _, v = ln.partition(":")
        if k.strip().lower() in KEYS:
            out[KEYS[k.strip().lower()]] = v.strip()
    return out

def main(folder, dest):
    rows = []
    for p in sorted(Path(folder).rglob("*.md")):
        h = read_header(p)
        rows.append([h["doc_id"], h["title"], h["type"].lower(), h["topic"], h["owner"], h["last_modified"], h["last_reviewed"],
                     h["status"].lower(), SHARING[h["sharing"].lower()], h["client_data"].lower(), h["has_decision"].lower()])
    rows.sort(key=lambda r: r[0])
    with open(dest, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f); w.writerow(COLS); w.writerows(rows)

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
