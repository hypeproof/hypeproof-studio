// REQ-H10 (2026-11-03): automatic content-free problem signals are on unless the learner turned them off.
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const { build } = await import("esbuild");
const here = path.dirname(fileURLToPath(import.meta.url));
const dir = mkdtempSync(path.join(tmpdir(), "hps-report-default-"));
writeFileSync(path.join(dir, "vscode.js"), "module.exports = {};");
await build({ entryPoints: [path.join(here, "..", "src", "problemReportHost.ts")], bundle: true, platform: "node", format: "esm", outfile: path.join(dir, "host.mjs"), logLevel: "error", alias: { vscode: path.join(dir, "vscode.js") }, packages: "external" });
const { autoProblemReportEnabled } = await import(path.join(dir, "host.mjs"));
const memento = (stored) => ({ get: (_key, fallback) => (stored === undefined ? fallback : stored) });
assert.equal(autoProblemReportEnabled(memento(undefined)), true, "no stored choice → on");
assert.equal(autoProblemReportEnabled(memento(true)), true, "stored on → on");
assert.equal(autoProblemReportEnabled(memento(false)), false, "stored off → off (negative control)");
assert.equal(autoProblemReportEnabled(undefined), true, "no state (first run) → on");
console.log("problem-report-default PASS");
