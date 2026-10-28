// Folder of docs -> same result as the Python script on an equivalent inventory CSV.
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { auditFolder, parseFolder, checkLimits, parseDate } from "../brain.js";
import { SAMPLE_FILES } from "../sample-drive.js";
import { ROOT, tmp, runPython, readFileSync, join } from "./helpers.js";

function walk(dir, base = dir) {
  return readdirSync(dir).flatMap(n => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p, base) : [p]; });
}

test("sample-drive.js matches the files in sample-drive/", () => {
  const disk = walk(join(ROOT, "sample-drive")).filter(p => p.endsWith(".md"));
  assert.equal(SAMPLE_FILES.length, disk.length);
  for (const f of SAMPLE_FILES) {
    const hit = disk.find(p => p.endsWith("/" + f.name.split("/").slice(1).join("/")));
    assert.ok(hit, f.name);
    assert.equal(readFileSync(hit, "utf8"), f.text);
  }
});

for (const asOf of ["2026-10-28", "2027-03-01", "2028-01-01"]) {
  test(`folder parse == Python on header-derived inventory (as of ${asOf})`, () => {
    const csv = join(tmp(), "inv.csv");
    execFileSync("python3", [join(ROOT, "tools/folder_to_inventory.py"), join(ROOT, "sample-drive"), csv]);
    const py = runPython(csv, asOf);
    const js = auditFolder(SAMPLE_FILES, parseDate(asOf));
    assert.equal(js.reportCSV, py.report);
    assert.equal(js.indexCSV, py.index);
  });
}

test("files without a header are kept as unapproved drafts and listed", () => {
  const p = parseFolder([{ name: "Notes/Random thing.txt", text: "just words" }, { name: ".DS_Store", text: "x" }, { name: "a.pdf", text: "x" }]);
  assert.equal(p.rows.length, 1);
  assert.deepEqual([p.rows[0].title, p.rows[0].status, p.rows[0].topic, p.rows[0].type], ["Random thing", "draft", "(no topic)", "doc"]);
  assert.deepEqual(p.missingHeader, ["Notes/Random thing.txt"]);
  assert.deepEqual(p.skipped, ["a.pdf"]);
});

test("unknown Sharing value fails safe (blocks client data)", () => {
  const text = "---\nDoc ID: X1\nTitle: T\nType: Doc\nTopic: A\nOwner: o\nLast modified: 2026-10-01\nLast reviewed: 2026-10-01\nStatus: Canonical\nSharing: Public on the web\nClient data: Yes\nDecision recorded: No\n---\nsecret";
  const res = auditFolder([{ name: "x.md", text }], parseDate("2026-10-28"));
  assert.equal(res.stats.secHigh, 1);
});

test("limits: size and count", () => {
  assert.match(checkLimits([{ name: "a.md", text: "x".repeat(201 * 1024) }]), /KB/);
  assert.match(checkLimits(Array.from({ length: 61 }, (_, i) => ({ name: `${i}.md`, text: "x" }))), /60/);
  assert.equal(checkLimits([{ name: "a.md", text: "x" }]), "");
});
