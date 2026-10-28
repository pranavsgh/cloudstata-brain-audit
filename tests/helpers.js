import { readFileSync, writeFileSync, mkdtempSync, copyFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const tmp = () => mkdtempSync(join(tmpdir(), "brain-test-"));

// Runs brain_audit.py on a CSV in a fresh dir; returns its two output files.
export function runPython(csvPath, asOf) {
  const dir = tmp(), copy = join(dir, "in.csv");
  copyFileSync(csvPath, copy);
  execFileSync("python3", [join(ROOT, "brain_audit.py"), copy, "--as-of", asOf], { stdio: "pipe" });
  return { report: readFileSync(join(dir, "brain_audit_report.csv"), "utf8"), index: readFileSync(join(dir, "brain_index_v1.csv"), "utf8"), dir };
}
export { readFileSync, writeFileSync, join };
