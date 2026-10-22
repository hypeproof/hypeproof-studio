#!/usr/bin/env node
// Runs the webview render tests (test/*.test.tsx).
//
// Each test is bundled with esbuild into a private temp directory and run with node,
// one after another. The first failure stops the run and names the test.
//
//   node scripts/run-tsx-tests.mjs              # every test/*.test.tsx, sorted
//   node scripts/run-tsx-tests.mjs quote-reply  # only test/quote-reply.test.tsx
//
// New render test: add test/<name>.test.tsx. No package.json edit is needed.
// The bundles go to a fresh mkdtemp directory, so parallel runs from different
// worktrees cannot overwrite each other's output.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const extRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const testDir = path.join(extRoot, "test");
const esbuildBin = path.join(extRoot, "node_modules", ".bin", "esbuild");

// Default window stub: no VS Code API in the webview.
const BANNER_NO_API = "globalThis.window = globalThis.window ?? { acquireVsCodeApi: undefined };";
// Window stub that records postMessage calls in globalThis.__posted.
const BANNER_POSTED =
  "globalThis.__posted = []; globalThis.window = globalThis.window ?? {}; globalThis.window.acquireVsCodeApi = () => ({ postMessage: (m) => globalThis.__posted.push(m), getState() {}, setState() {} });";
const BANNER_POSTED_ARROW =
  "globalThis.__posted = []; globalThis.window = globalThis.window ?? {}; globalThis.window.acquireVsCodeApi = () => ({ postMessage: (m) => globalThis.__posted.push(m), getState: () => undefined, setState: () => {} });";

// Per-test differences from the default flags, kept exactly as the old
// per-test package.json scripts had them.
//   banner:   the --banner:js value
//   logLevel: the --log-level value; null means esbuild's default (flag omitted)
const OVERRIDES = {
  "goal-status": { banner: BANNER_POSTED },
  "activity-trash": { banner: BANNER_POSTED },
  "write-approval-dialog": { banner: BANNER_POSTED },
  "outbound-dialog-app": { banner: BANNER_POSTED },
  "refusal-banner": { banner: BANNER_POSTED },
  "attachment-error-design": { banner: BANNER_POSTED },
  "instructor-render": { logLevel: null },
  "missing-task-folder": { banner: BANNER_POSTED },
  "preview-recovery": { banner: BANNER_POSTED },
  "ask-about-file": { banner: BANNER_POSTED_ARROW },
  "activity-materials": { banner: BANNER_POSTED_ARROW },
  "attachment-failure-ui": { banner: BANNER_POSTED_ARROW },
  "trial-end-card-dismiss": { banner: BANNER_POSTED },
  "activity-status-chatpanel": { banner: BANNER_POSTED },
  "quit-guard-queue": { banner: BANNER_POSTED },
};

// Tests in test/ that this runner must skip, because they have their own build step
// and their own entry in the `npm test` chain.
const EXCLUDED = new Set([
  "panel-boundary", // built by test/panel-boundary.build.mjs (test:panel-boundary)
]);

function discover() {
  return fs
    .readdirSync(testDir)
    .filter((f) => f.endsWith(".test.tsx"))
    .map((f) => f.slice(0, -".test.tsx".length))
    .filter((name) => !EXCLUDED.has(name))
    .sort();
}

function esbuildArgs(name, outfile) {
  const o = OVERRIDES[name] ?? {};
  const logLevel = "logLevel" in o ? o.logLevel : "error";
  const args = [
    `test/${name}.test.tsx`,
    "--bundle",
    "--alias:react=./webview-ui/node_modules/react",
    "--alias:react-dom=./webview-ui/node_modules/react-dom",
    "--platform=node",
    "--format=cjs",
    "--loader:.css=empty",
    "--loader:.svg=empty",
    "--jsx=automatic",
    "--external:vscode",
  ];
  if (logLevel) args.push(`--log-level=${logLevel}`);
  args.push(`--banner:js=${o.banner ?? BANNER_NO_API}`, `--outfile=${outfile}`);
  return args;
}

const all = discover();
const filter = process.argv.slice(2);
const unknown = filter.filter((n) => !all.includes(n));
if (unknown.length) {
  console.error(`run-tsx-tests: no test/<name>.test.tsx for: ${unknown.join(", ")}`);
  console.error(`available: ${all.join(" ")}`);
  process.exit(2);
}
const selected = filter.length ? all.filter((n) => filter.includes(n)) : all;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hps-tsx-"));
const cleanup = () => fs.rmSync(tmp, { recursive: true, force: true });
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    cleanup();
    process.exit(130);
  });
}

const env = { ...process.env, NODE_PATH: path.join(extRoot, "webview-ui", "node_modules") };
let code = 0;
try {
  for (const name of selected) {
    console.log(`— test/${name}.test.tsx`);
    const outfile = path.join(tmp, `${name}.test.cjs`);
    const built = spawnSync(esbuildBin, esbuildArgs(name, outfile), { cwd: extRoot, env, stdio: "inherit" });
    if (built.status !== 0) {
      console.error(`run-tsx-tests: FAILED to bundle test/${name}.test.tsx (esbuild exit ${built.status ?? built.signal})`);
      code = 1;
      break;
    }
    const ran = spawnSync(process.execPath, [outfile], { cwd: extRoot, env, stdio: "inherit" });
    if (ran.status !== 0) {
      console.error(`run-tsx-tests: FAILED test/${name}.test.tsx (exit ${ran.status ?? ran.signal})`);
      code = 1;
      break;
    }
  }
} finally {
  cleanup();
}
if (code === 0) console.log(`run-tsx-tests: ${selected.length} render test(s) passed`);
process.exit(code);
