// REQ-STUDIO-SHOW-WHAT-I-MADE (#3794) — run the HyperFrames checker on a composition exactly as Studio writes it.
// Not part of `npm test`: the HyperFrames CLI is not a Studio dependency. Run it on a worker after changing
// showComposition() or the vendored files, and expect 0 errors and 0 warnings (an `audio_none` info is expected).
//
//   HYPERFRAMES_BIN=/path/to/node_modules/.bin/hyperframes \
//   node --experimental-strip-types scripts/check-show-composition.mjs [material.png|jpg] [--keep]
//
// The child runs with HYPERFRAMES_NO_TELEMETRY=1 and HYPERFRAMES_NO_UPDATE_CHECK=1. Exit 0 = clean.

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { SHOW_FOLDER_ASSETS, SHOW_MEDIA_DIR, showComposition } from "../src/showWhatIMade.ts";

const bin = process.env.HYPERFRAMES_BIN;
if (!bin) { console.error("Set HYPERFRAMES_BIN to a pinned hyperframes CLI (0.9.38)."); process.exit(2); }
const args = process.argv.slice(2);
const keep = args.includes("--keep");
const materialArg = args.find((a) => !a.startsWith("--"));
const here = path.dirname(new URL(import.meta.url).pathname);
const media = path.join(here, "..", "media", SHOW_MEDIA_DIR);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hp-show-check-"));
const ext = materialArg ? (path.extname(materialArg).toLowerCase() === ".png" ? "png" : "jpg") : "png";
const material = `material-1.${ext}`;
fs.writeFileSync(path.join(dir, material), materialArg ? fs.readFileSync(materialArg)
  : Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64"));
for (const asset of SHOW_FOLDER_ASSETS) fs.copyFileSync(path.join(media, asset), path.join(dir, asset));
fs.writeFileSync(path.join(dir, "index.html"), showComposition({
  headline: "AI가 답을 먼저 내놓는 시대에, 스스로 판단하며 자라는 법", audience: "우리 반 친구들", materialFile: material,
}));

const run = spawnSync(bin, ["check", "--json"], { cwd: dir, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 300_000,
  env: { ...process.env, HYPERFRAMES_NO_TELEMETRY: "1", HYPERFRAMES_NO_UPDATE_CHECK: "1", HYPERFRAMES_SKIP_SKILLS: "1" } });
let report;
try { report = JSON.parse(run.stdout); } catch { console.error(run.stdout, run.stderr); process.exit(1); }
let errors = 0, warnings = 0;
for (const [name, section] of Object.entries(report)) {
  if (!section || typeof section !== "object" || !("errorCount" in section)) continue;
  errors += section.errorCount; warnings += section.warningCount;
  for (const f of section.findings ?? []) console.log(`${name} ${f.severity} ${f.code}: ${f.message}`);
}
console.log(`hyperframes check: ok=${report.ok} errors=${errors} warnings=${warnings} dir=${dir}`);
if (!keep) fs.rmSync(dir, { recursive: true, force: true });
process.exit(report.ok && errors === 0 && warnings === 0 ? 0 : 1);
