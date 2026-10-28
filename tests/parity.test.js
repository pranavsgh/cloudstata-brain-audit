// brain.js must produce byte-identical report + index CSVs to brain_audit.py.
import test from "node:test";
import assert from "node:assert/strict";
import { audit, parseDate } from "../brain.js";
import { ROOT, runPython, readFileSync, join } from "./helpers.js";

const cases = [
  ["sample_inventory.csv", "2026-10-27"], ["sample_inventory.csv", "2027-04-01"], ["sample_inventory.csv", "2028-06-15"],
  ["reference/edge.csv", "2026-10-27"], ["reference/folder_inventory.csv", "2026-10-28"],
];
for (const [file, asOf] of cases) {
  test(`parity: ${file} as of ${asOf}`, () => {
    const path = join(ROOT, file), py = runPython(path, asOf);
    const js = audit(readFileSync(path, "utf8"), parseDate(asOf));
    assert.equal(js.reportCSV, py.report);
    assert.equal(js.indexCSV, py.index);
  });
}
