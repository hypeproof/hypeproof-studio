// An update must keep every folder's activity. Before canonicalRoot, a window that stayed in its
// open folder committed VS Code's spelling of it (`c:\…`): the binding file is named after that
// spelling and the saved record carries it. The new code spells every root `C:\…`; it must still
// find those bindings (read-only fallback), and a folder taken by another activity under the old
// spelling stays taken. Windows only — elsewhere there is no drive letter and nothing to migrate.
//
// Run: node --experimental-strip-types test/activity-legacy-drive.smoke.mjs

import assert from "node:assert/strict";
import { build } from "esbuild";
import vm from "node:vm";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hps-legacy-drive-"));
if (!/^[a-z]:/i.test(tmp)) {
  console.log("- skipped: no drive letter on this platform");
  process.exit(0);
}
const require = createRequire(import.meta.url);
const bundled = await build({ entryPoints: [fileURLToPath(new URL("../src/activityConnections.ts", import.meta.url))], bundle: true, platform: "node", format: "cjs", write: false });
const mod = { exports: {} };
vm.runInNewContext(bundled.outputFiles[0].text, { module: mod, exports: mod.exports, require, process, URL });
const { ActivityConnections } = mod.exports;

const digest = (s) => crypto.createHash("sha256").update(s).digest("hex");
const lowerDrive = (p) => p[0].toLowerCase() + p.slice(1);
const secrets = new Map();
const context = () => {
  const state = new Map();
  return {
    globalStorageUri: { fsPath: path.join(tmp, "storage") },
    workspaceState: { get: (k, d) => (state.has(k) ? state.get(k) : d), update: async (k, v) => void state.set(k, v) },
    secrets: { keys: async () => [...secrets.keys()], get: async (k) => secrets.get(k), store: async (k, v) => void secrets.set(k, v), delete: async (k) => void secrets.delete(k), onDidChange: () => ({ dispose() {} }) },
  };
};
const service = "https://synthetic.invalid/v1";
const profile = (id) => ({ activity_id: id.repeat(64), display_name: id, activity_kind: "trial" });

try {
  // Not mkdirSync's return value: on Windows it is `\\?\C:\…`, which has no leading drive letter.
  const folder = path.join(fs.realpathSync(tmp), "작업 폴더");
  fs.mkdirSync(folder);
  assert.match(folder, /^[A-Z]:\\/, "the fixture must start with an uppercase drive letter, or nothing is migrated");
  const legacy = lowerDrive(folder);

  // Write a binding with today's code, then turn it into exactly what the old code left behind.
  const writer = new ActivityConnections(context(), () => service, () => folder, async () => profile("a"));
  await writer.commit("synthetic-a", profile("a"), folder);
  const dir = path.join(tmp, "storage", "activity-bindings");
  const fresh = path.join(dir, digest(folder) + ".json");
  assert.ok(fs.existsSync(fresh), "new bindings are written under C:\\");
  fs.renameSync(fresh, path.join(dir, digest(legacy) + ".json"));
  const ref = writer.current.ref;
  secrets.set(ref, JSON.stringify({ ...JSON.parse(secrets.get(ref)), workspace: legacy }));

  // A window reopened on that folder after the update, either spelling.
  for (const root of [legacy, folder]) {
    const reader = new ActivityConnections(context(), () => service, () => root, async () => profile("a"));
    await reader.initialize();
    assert.equal(await reader.token(), "synthetic-a", `the old binding is found from ${root[0]}:`);
    reader.acquire()();
  }
  console.log("✓ a binding saved as c:\\ before the update is found, and the folder is usable");

  // Control: the old binding still protects the folder from another activity.
  const other = new ActivityConnections(context(), () => service, () => folder, async () => profile("b"));
  assert.throws(() => other.prepare(folder, profile("b"), () => assert.fail("must not prepare another activity's folder")), /다른 활동/);
  console.log("✓ control: a folder taken under the old spelling stays taken");

  // Control: an unrelated folder has no binding under either spelling.
  const empty = path.join(tmp, "빈 폴더");
  fs.mkdirSync(empty);
  const none = new ActivityConnections(context(), () => service, () => empty, async () => profile("a"));
  assert.equal(await none.forWorkspace(empty), undefined);
  console.log("✓ control: an unbound folder stays unbound");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
