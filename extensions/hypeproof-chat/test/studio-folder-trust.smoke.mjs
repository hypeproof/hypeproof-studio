// REQ-STUDIO-TRUST-OWN-FOLDERS - folders Studio created open trusted; everything else still prompts.
// 1. The extension records a folder only when Studio made it (absent before prepare), keyed by real path.
// 2. The core patch applies to the pristine VS Code 1.116 files and adds a pure decision the workbench uses.
// 3. Decision: Studio-created -> trusted; user-opened -> prompt; same path not in the record -> prompt;
//    flag off -> prompt; trust is not disabled globally.
//   node --experimental-strip-types test/studio-folder-trust.smoke.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const { studioFoldersFlag, STUDIO_FOLDERS_KEY, directoryIsAbsent, syncStudioFolderRecord, studioFolderRecordOf } = await import("../src/studioFolderTrust.ts");
const { prepareWorkspaceDirectory } = await import("../src/workspacePreparation.ts");
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const coreDir = path.join(repo, "scripts/patches/core");
const patch = path.join(coreDir, "hps-studio-folder-trust.patch");
const REL = "src/vs/workbench/services/workspaces/common/workspaceTrust.ts";
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const memory = () => { const m = new Map(); return { get: (k) => m.get(k), update: (k, v) => { m.set(k, v); } }; };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hps-studio-folder-trust-"));
try {
  // 1. Extension side: the creation record.
  const home = fs.realpathSync(tmp);
  const created = path.join(home, "HypeProofTrial");           // Studio makes it
  const preexisting = path.join(home, "MyProject");            // the learner already had it
  const other = path.join(home, "opened-by-learner");          // opened by the learner, never prepared
  fs.mkdirSync(preexisting); fs.mkdirSync(other);
  const store = memory();
  for (const dir of [created, preexisting]) {
    const absent = directoryIsAbsent(dir);
    prepareWorkspaceDirectory(dir, "empty", () => "");
    await syncStudioFolderRecord(store, true, dir, absent);
  }
  const rec = studioFolderRecordOf(store.get(STUDIO_FOLDERS_KEY));
  assert.deepEqual(rec, { v: 1, enabled: true, folders: [created] }, "only the folder Studio made is recorded");
  await syncStudioFolderRecord(store, true, created, false); // a later open of an already recorded folder keeps it
  assert.deepEqual(studioFolderRecordOf(store.get(STUDIO_FOLDERS_KEY)).folders, [created]);
  await syncStudioFolderRecord(store, false);                // flag off keeps the list but disables it
  assert.deepEqual(studioFolderRecordOf(store.get(STUDIO_FOLDERS_KEY)), { v: 1, enabled: false, folders: [created] });
  await syncStudioFolderRecord(store, true);
  assert.deepEqual(studioFolderRecordOf({ folders: [1, "", "/a"], enabled: "yes" }), { v: 1, enabled: false, folders: ["/a"] }, "malformed -> disabled");

  assert.equal(studioFoldersFlag(() => { throw new TypeError("getConfiguration is not a function"); }), false, "API unavailable: fail closed");
  assert.equal(studioFoldersFlag(() => undefined), false);
  assert.equal(studioFoldersFlag(() => ({ get: (_k, d) => d })), false, "default off");
  assert.equal(studioFoldersFlag(() => ({ get: () => true })), true);

  // 2. Core patch on a stand-in checkout of the pristine upstream file.
  const tree = path.join(tmp, "vscode");
  fs.mkdirSync(path.dirname(path.join(tree, REL)), { recursive: true });
  fs.copyFileSync(path.join(coreDir, "upstream", REL), path.join(tree, REL));
  run("git", ["init", "-q"], tree); run("git", ["add", "-A"], tree);
  run("git", ["-c", "user.name=t", "-c", "user.email=t@invalid", "commit", "-qm", "upstream"], tree);
  const base = fs.readFileSync(path.join(tree, REL), "utf8");
  assert.ok(!base.includes("hpsIsStudioCreatedFolder"), "red on base: upstream has no Studio-folder decision");
  assert.deepEqual([...fs.readFileSync(patch, "utf8").matchAll(/^diff --git a\/(\S+) /gm)].map((m) => m[1]),
    ["src/vs/workbench/services/workspaces/common/hpsStudioFolderTrust.ts", REL]);
  run("git", ["apply", "--check", "--ignore-whitespace", patch], tree); // prepare_vscode.sh's apply_patch flags
  run("git", ["apply", patch], tree);
  const patched = fs.readFileSync(path.join(tree, REL), "utf8");
  assert.equal(patched.split("this.isHpsStudioCreatedFolder(uri)").length, 2, "one hook, inside doGetUriTrustInfo");
  const hookAt = patched.indexOf("this.isHpsStudioCreatedFolder(uri)");
  assert.ok(hookAt > patched.indexOf("private doGetUriTrustInfo(") && hookAt < patched.indexOf("let resultState = false;"));
  // Trust is not turned off or defaulted anywhere: the enablement checks are untouched.
  assert.ok(patched.includes("if (!this.workspaceTrustEnablementService.isWorkspaceTrustEnabled()) {"));
  assert.equal((patched.match(/isWorkspaceTrustEnabled\(\)/g) ?? []).length, (base.match(/isWorkspaceTrustEnabled\(\)/g) ?? []).length);

  // 3. The decision function, run from the patched tree, fed the extension's real record.
  const pureFile = path.join(tree, "src/vs/workbench/services/workspaces/common/hpsStudioFolderTrust.ts");
  assert.ok(!/^import /m.test(fs.readFileSync(pureFile, "utf8")), "pure module: no imports");
  const { hpsStudioFolderRecordOf, hpsIsStudioCreatedFolder, HPS_STUDIO_FOLDERS_KEY } = await import(pathToFileURL(pureFile).href);
  assert.equal(HPS_STUDIO_FOLDERS_KEY, STUDIO_FOLDERS_KEY, "core and extension agree on the key");
  const same = (a, b) => a === b;
  const stored = (r) => JSON.stringify({ [STUDIO_FOLDERS_KEY]: r, unrelated: 1 });   // the extension's globalState blob
  const file = (p) => ({ scheme: "file", fsPath: p });
  const on = hpsStudioFolderRecordOf(stored(store.get(STUDIO_FOLDERS_KEY)));
  assert.equal(hpsIsStudioCreatedFolder(on, file(created), same), true, "Studio-created folder opens trusted");
  assert.equal(hpsIsStudioCreatedFolder(on, file(other), same), false, "user-opened folder prompts");
  assert.equal(hpsIsStudioCreatedFolder(on, file(preexisting), same), false, "same kind of name, not created by Studio, prompts");
  assert.equal(hpsIsStudioCreatedFolder(on, file(path.join(home, "elsewhere", "HypeProofTrial")), same), false, "same name at another path prompts");
  assert.equal(hpsIsStudioCreatedFolder(on, file(path.join(created, "sub")), same), false, "a child is not the folder");
  assert.equal(hpsIsStudioCreatedFolder(on, file(home), same), false, "the parent is not the folder");
  assert.equal(hpsIsStudioCreatedFolder(on, { scheme: "vscode-remote", fsPath: created }, same), false, "remote prompts");
  const off = hpsStudioFolderRecordOf(stored({ v: 1, enabled: false, folders: [created] }));
  assert.equal(off, undefined);
  assert.equal(hpsIsStudioCreatedFolder(off, file(created), same), false, "flag off: prompts");
  assert.equal(hpsIsStudioCreatedFolder(hpsStudioFolderRecordOf(undefined), file(created), same), false, "no record: prompts");
  assert.equal(hpsIsStudioCreatedFolder(hpsStudioFolderRecordOf("{not json"), file(created), same), false, "bad storage: prompts");

  // The flag is registered default off, machine scoped.
  const pkg = JSON.parse(fs.readFileSync(path.join(repo, "extensions/hypeproof-chat/package.json"), "utf8"));
  const setting = pkg.contributes.configuration.properties?.["hypeproofChat.trustStudioFolders"]
    ?? [].concat(pkg.contributes.configuration).map((c) => c.properties?.["hypeproofChat.trustStudioFolders"]).find(Boolean);
  assert.equal(setting.default, false);
  assert.equal(setting.scope, "machine");

  // stage-core-patches.sh stages it.
  const fake = path.join(tmp, "studio");
  fs.mkdirSync(path.join(fake, "scripts/patches/core"), { recursive: true });
  fs.copyFileSync(path.join(repo, "scripts/stage-core-patches.sh"), path.join(fake, "scripts/stage-core-patches.sh"));
  fs.copyFileSync(patch, path.join(fake, "scripts/patches/core/hps-studio-folder-trust.patch"));
  run("bash", [path.join(fake, "scripts/stage-core-patches.sh")], fake);
  assert.deepEqual(fs.readdirSync(path.join(fake, "vscodium-base/patches/user")), ["99-hps-studio-folder-trust.patch"]);
  console.log("PASS studio folder trust: record, patch apply, decision (created/user-opened/same-path/flag off)");
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
