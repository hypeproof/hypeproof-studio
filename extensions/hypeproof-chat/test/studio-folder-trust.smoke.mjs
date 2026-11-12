// REQ-STUDIO-TRUST-OWN-FOLDERS - folders Studio created open trusted; everything else still prompts.
// 1. Extension: only a leaf folder this call made (non-recursive mkdir) is recorded, with real path + creation time.
// 2. Real call site (extension.ts openWorkspaceFolder) uses that result and nothing else.
// 3. Core patch applies to the pristine VS Code 1.116 file; the pure decision AND the patched hook methods
//    (extracted from the patched workspaceTrust.ts and run against stand-ins) behave:
//    created -> trusted; user-opened / other path / child / parent -> prompt; flag off (user-local only),
//    extension disabled, learner "Don't Trust", creation-time mismatch, unreadable inputs -> prompt.
//   node --experimental-strip-types test/studio-folder-trust.smoke.mjs
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import vm from "node:vm";

const here = path.dirname(fileURLToPath(import.meta.url));
const ts = createRequire(import.meta.url)("typescript");
const { STUDIO_FOLDERS_KEY, createStudioFolder, discardStudioFolder, discardStudioFolderAfterFailure, syncStudioFolderRecord, studioFolderRecordOf } = await import("../src/studioFolderTrust.ts");
const { prepareWorkspaceDirectory } = await import("../src/workspacePreparation.ts");
const repo = path.resolve(here, "../../..");
const coreDir = path.join(repo, "scripts/patches/core");
const patch = path.join(coreDir, "hps-studio-folder-trust.patch");
const REL = "src/vs/workbench/services/workspaces/common/workspaceTrust.ts";
const PURE_REL = "src/vs/workbench/services/workspaces/common/hpsStudioFolderTrust.ts";
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const memory = () => { const m = new Map(); return { get: (k) => m.get(k), update: (k, v) => { m.set(k, v); } }; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hps-studio-folder-trust-"));
try {
  // 1. Extension side.
  const home = fs.realpathSync(tmp);
  const created = path.join(home, "HypeProofTrial");
  const preexisting = path.join(home, "MyProject");
  const other = path.join(home, "opened-by-learner");
  await sleep(15); // distinct creation times, so a parent/other folder can never match the record by accident
  fs.mkdirSync(preexisting); fs.mkdirSync(other);
  const store = memory();
  const makes = [];
  for (const dir of [created, preexisting, path.join(home, "deep", "er", "Trial")]) {
    const made = createStudioFolder(dir);
    prepareWorkspaceDirectory(dir, "empty", () => "");
    makes.push(made);
  }
  assert.equal(makes[1], undefined, "a folder that already existed is not Studio's");
  assert.equal(makes[0].path, created);
  assert.equal(makes[0].birth, fs.statSync(created).birthtime.getTime(), "birth is the folder's creation time");
  assert.equal(makes[2].path, path.join(home, "deep", "er", "Trial"), "parents are created, the leaf is recorded");
  for (const m of makes) await syncStudioFolderRecord(store, m);
  const rec = studioFolderRecordOf(store.get(STUDIO_FOLDERS_KEY));
  assert.deepEqual(rec.folders.map((f) => f.path), [created, path.join(home, "deep", "er", "Trial")], "only folders Studio made are recorded");
  await syncStudioFolderRecord(store, undefined);
  assert.equal(studioFolderRecordOf(store.get(STUDIO_FOLDERS_KEY)).folders.length, 2, "nothing created: record unchanged");
  const dangling = path.join(home, "dangling"); fs.symlinkSync(path.join(home, "nowhere"), dangling);
  assert.equal(createStudioFolder(dangling), undefined, "a pre-planted dangling symlink is not recorded");
  // Folder appearing between the caller's decision and our mkdir (TOCTOU): the leaf mkdir fails, nothing is recorded.
  const raced = path.join(home, "raced");
  assert.equal(createStudioFolder(raced) !== undefined, true);
  assert.equal(createStudioFolder(raced), undefined, "second creator of the same leaf records nothing");
  // A leaf under a file (mkdir fails with ENOTDIR) throws and records nothing.
  fs.writeFileSync(path.join(home, "afile"), "x");
  assert.throws(() => createStudioFolder(path.join(home, "afile", "leaf")));
  // Same path re-created by Studio later replaces the entry with the new creation time.
  const again = path.join(home, "again"); const first = createStudioFolder(again);
  await syncStudioFolderRecord(store, first);
  fs.rmdirSync(again); await sleep(30);
  const second = createStudioFolder(again); await syncStudioFolderRecord(store, second);
  assert.notEqual(first.birth, second.birth, "delete + recreate changes the creation time");
  assert.deepEqual(studioFolderRecordOf(store.get(STUDIO_FOLDERS_KEY)).folders.filter((f) => f.path === again), [second]);
  assert.deepEqual(studioFolderRecordOf({ v: 1, enabled: true, folders: ["/a"] }), { v: 2, folders: [] }, "old shape / malformed -> empty");

  // 1b. The real ActivityConnections.prepare creates the folder itself (mkdir recursive), so the extension must
  //     create the leaf first. Run the exact sequence openWorkspaceFolder uses, through the real class.
  {
    const { build } = await import("esbuild");
    const bundle = await build({ stdin: { contents: "export {ActivityConnections, ActivityConnectionError, ActivityFolderInUseError} from './src/activityConnections';", resolveDir: path.join(here, ".."), loader: "ts" }, bundle: true, platform: "node", format: "cjs", external: ["vscode"], write: false, logLevel: "error" });
    const mod = { exports: {} }; new Function("module", "exports", "require", bundle.outputFiles[0].text)(mod, mod.exports, createRequire(import.meta.url));
    const gs = new Map(); const secrets = new Map();
    const rawCtx = { globalStorageUri: { fsPath: path.join(home, "gs") }, globalState: { get: (k) => gs.get(k), update: async (k, v) => { gs.set(k, v); }, keys: () => [...gs.keys()] },
      secrets: { get: async (k) => secrets.get(k), store: async (k, v) => { secrets.set(k, v); }, delete: async (k) => { secrets.delete(k); }, keys: async () => [...secrets.keys()], onDidChange: () => ({ dispose() {} }) } };
    const dir = path.join(home, "ClassFolder");
    const profile = { profile_id: "p", activity_id: "c".repeat(64), activity_kind: "personal", display_name: "x", workspace_start: "empty" };
    const conn = new mod.exports.ActivityConnections(rawCtx, () => "http://127.0.0.1:8787/v1", () => dir, async () => profile);
    const open = async (target, prof = profile) => {   // same order as extension.ts openWorkspaceFolder
      let made;
      try { made = createStudioFolder(target); } catch { made = undefined; }
      try { conn.prepare(target, prof, () => prepareWorkspaceDirectory(target, "empty", () => ""), await conn.folderOwners(target)); }
      catch (error) { discardStudioFolderAfterFailure(made, error); throw error; }
      return made;
    };
    const first = await open(dir);
    assert.ok(first && first.path === dir && fs.existsSync(dir), "class/trial path: the folder Studio makes through ActivityConnections is recorded");
    const reopened = await open(dir);
    assert.equal(reopened, undefined, "reopening the same folder records nothing new");
    const mine = path.join(home, "AlreadyMine"); fs.mkdirSync(mine);
    assert.equal(await open(mine), undefined, "a pre-existing folder opened through ActivityConnections is not recorded");
    // B2: when the parent step fails, the guidance ActivityConnectionError from prepare must still surface.
    const guidance = async (name, target) => {
      let err; try { await open(target); } catch (e) { err = e; }
      assert.ok(err instanceof mod.exports.ActivityConnectionError, `${name}: prepare's guidance error, not a generic one (got ${err && err.constructor.name}: ${err && (err.code ?? err.message)})`);
    };
    fs.writeFileSync(path.join(home, "pfile"), "x");
    assert.throws(() => createStudioFolder(path.join(home, "pfile", "Class")), "(why the guard matters) the raw create throws");
    await guidance("parent is a file", path.join(home, "pfile", "Class"));
    fs.symlinkSync(path.join(home, "gone"), path.join(home, "plink"));
    await guidance("parent is a dangling link", path.join(home, "plink", "Class"));
    const protectedDir = path.join(home, "pro"); fs.mkdirSync(protectedDir);
    if (process.platform === "win32") {
      // Windows chmod cannot model a read-only directory, and the hosted runner is privileged.
      // Inject the filesystem denial for the guidance contract; this is not a native ACL acceptance test.
      const mkdir = fs.mkdirSync;
      fs.mkdirSync = (target, ...args) => {
        if (String(target).startsWith(protectedDir + path.sep)) throw Object.assign(new Error("fixture access denied"), { code: "EACCES" });
        return mkdir(target, ...args);
      };
      try { await guidance("injected write denial", path.join(protectedDir, "Class")); }
      finally { fs.mkdirSync = mkdir; }
    } else {
      fs.chmodSync(protectedDir, 0o500);
      try { if (process.getuid?.() !== 0) await guidance("read-only parent", path.join(protectedDir, "Class")); }
      finally { fs.chmodSync(protectedDir, 0o700); }
    }
    // N9: two windows open the same empty folder; the loser (busy lock or FOLDER_TAKEN) must not remove the winner's folder.
    {
      const race = path.join(home, "RaceFolder");
      const lockFile = conn.bindingPath(race) + ".lock";
      fs.mkdirSync(path.dirname(lockFile), { recursive: true }); fs.writeFileSync(lockFile, "other-window");
      fs.mkdirSync(lockFile + ".recovery", { recursive: true });   // window B holds the lock mid-prepare; A creates the leaf, then loses
      let busyErr; try { await open(race); } catch (e) { busyErr = e; }
      assert.ok(busyErr instanceof mod.exports.ActivityFolderInUseError, "the loser sees the busy error");
      assert.equal(fs.existsSync(race), true, "busy loser does not remove the folder the other window is opening");
      fs.rmSync(lockFile + ".recovery", { recursive: true }); fs.rmSync(lockFile);
      // Live window: the other window holds the lock with a live pid (no recovery dir) - the realistic race.
      const live = path.join(home, "LiveLock");
      const liveLock = conn.bindingPath(live) + ".lock";
      fs.writeFileSync(liveLock, JSON.stringify({ pid: process.ppid, nonce: "window-b" }));
      let liveErr; try { await open(live); } catch (e) { liveErr = e; }
      assert.ok(liveErr instanceof mod.exports.ActivityFolderInUseError, "live-window lock is the in-use error");
      assert.equal(fs.existsSync(live), true, "live-window lock loser keeps the folder");
      // A lock file still being written (empty) is also someone else's.
      const part = path.join(home, "PartialLock");
      fs.writeFileSync(conn.bindingPath(part) + ".lock", "");
      let partErr; try { await open(part); } catch (e) { partErr = e; }
      assert.ok(partErr instanceof mod.exports.ActivityFolderInUseError, "partial lock is the in-use error");
      assert.equal(fs.existsSync(part), true, "partial-lock loser keeps the folder");
      fs.rmSync(liveLock); fs.rmSync(conn.bindingPath(part) + ".lock");
      // #3664: an unreadable or pid-less lock older than the grace period is stale and is cleaned (the lock file only).
      const age = (file, seconds) => { const t = new Date(Date.now() - seconds * 1000); fs.utimesSync(file, t, t); };
      for (const [name, content] of [["empty", ""], ["corrupt", "{not json"], ["invalid pid", JSON.stringify({ pid: "abc", nonce: "n" })], ["pid zero", JSON.stringify({ pid: 0, nonce: "n" })], ["json null", "null"]]) {
        const dirX = path.join(home, "Stale-" + name.replace(" ", "-")); fs.mkdirSync(dirX); fs.writeFileSync(path.join(dirX, "mine.txt"), "keep");
        const lockX = conn.bindingPath(dirX) + ".lock"; fs.writeFileSync(lockX, content);
        let freshErr; try { await open(dirX); } catch (e) { freshErr = e; }
        assert.ok(freshErr instanceof mod.exports.ActivityFolderInUseError, `${name}: within the grace period it is still in use`);
        assert.equal(fs.existsSync(lockX), true, `${name}: a fresh lock is left alone`);
        age(lockX, 30);
        await open(dirX);   // must now succeed
        assert.equal(fs.existsSync(lockX), false, `${name}: the stale lock is gone`);
        assert.equal(fs.readFileSync(path.join(dirX, "mine.txt"), "utf8"), "keep", `${name}: learner files untouched`);
        assert.equal(fs.existsSync(lockX + ".recovery"), false, `${name}: no recovery barrier left behind`);
      }
      // A lock held by a LIVE process is never stale, however old its mtime.
      const liveOld = path.join(home, "LiveOldLock"); fs.mkdirSync(liveOld);
      const liveOldLock = conn.bindingPath(liveOld) + ".lock"; const liveOldText = JSON.stringify({ pid: process.ppid, nonce: "window-b" });
      fs.writeFileSync(liveOldLock, liveOldText); age(liveOldLock, 3600);
      let liveOldErr; try { await open(liveOld); } catch (e) { liveOldErr = e; }
      assert.ok(liveOldErr instanceof mod.exports.ActivityFolderInUseError, "an hour-old lock of a live process is in use");
      assert.equal(fs.readFileSync(liveOldLock, "utf8"), liveOldText, "the live lock is unchanged");
      assert.equal(fs.existsSync(liveOld), true, "the folder is kept");
      fs.rmSync(liveOldLock);
      // The grace period is 10 s: 5 s old unreadable stays in use, 11 s old is cleaned.
      const graceDir = path.join(home, "GraceEdge"); fs.mkdirSync(graceDir);
      const graceLock = conn.bindingPath(graceDir) + ".lock"; fs.writeFileSync(graceLock, "{broken"); age(graceLock, 5);
      let graceErr; try { await open(graceDir); } catch (e) { graceErr = e; }
      assert.ok(graceErr instanceof mod.exports.ActivityFolderInUseError, "5 s old unreadable lock is still in use");
      assert.equal(fs.existsSync(graceLock), true, "5 s old lock is left alone");
      age(graceLock, 11); await open(graceDir);
      assert.equal(fs.existsSync(graceLock), false, "11 s old unreadable lock is cleaned");
      // An aged lock replaced by a new owner between the check and the cleanup is never removed.
      const swap = path.join(home, "StaleSwap"); fs.mkdirSync(swap);
      const swapLock = conn.bindingPath(swap) + ".lock"; fs.writeFileSync(swapLock, ""); age(swapLock, 30);
      const realMkdir = fs.mkdirSync;
      fs.mkdirSync = function (p, ...rest) { const r = realMkdir.call(this, p, ...rest); if (String(p).endsWith(".recovery")) { fs.writeFileSync(swapLock, JSON.stringify({ pid: process.ppid, nonce: "new-owner" })); } return r; };
      let swapErr; try { await open(swap); } catch (e) { swapErr = e; } finally { fs.mkdirSync = realMkdir; }
      assert.ok(swapErr instanceof mod.exports.ActivityFolderInUseError, "a lock re-created by a live window mid-cleanup is in use");
      assert.equal(JSON.parse(fs.readFileSync(swapLock, "utf8")).nonce, "new-owner", "the new owner's lock is not removed");
      fs.rmSync(swapLock);
      // Dead-pid lock: cleaned. Invalid-pid is covered above. Lock lost twice: another dead lock appears right after the first cleanup.
      const dead = path.join(home, "DeadPidTwice"); fs.mkdirSync(dead);
      const deadLock = conn.bindingPath(dead) + ".lock"; const deadContent = JSON.stringify({ pid: 2147483646, nonce: "gone" });
      fs.writeFileSync(deadLock, deadContent);
      const realRmdir = fs.rmdirSync; let rmdirs = 0;
      fs.rmdirSync = function (p, ...rest) { const r = realRmdir.call(this, p, ...rest); if (String(p).endsWith(".recovery") && ++rmdirs === 1) fs.writeFileSync(deadLock, deadContent); return r; };
      let twiceErr; try { await open(dead); } catch (e) { twiceErr = e; } finally { fs.rmdirSync = realRmdir; }
      assert.ok(twiceErr instanceof mod.exports.ActivityFolderInUseError, "lock lost twice is the in-use error: " + twiceErr);
      assert.match(twiceErr.message, /잠금을 얻지 못했습니다/, "lock lost twice says the lock could not be taken, not that another window uses it");
      assert.equal(fs.existsSync(dead), true, "lock-lost-twice loser keeps the folder");
      fs.rmSync(deadLock, { force: true });
      // The shared cleanup still removes for any other error.
      const other = path.join(home, "OtherFail"); const madeOther = createStudioFolder(other);
      discardStudioFolderAfterFailure(madeOther, new Error("x")); assert.equal(fs.existsSync(other), false, "other failures still discard");
      const taken = path.join(home, "TakenFolder");
      fs.writeFileSync(conn.bindingPath(taken), JSON.stringify({ version: 1, id: "another-activity" }), { mode: 0o600 });   // another activity holds this path; the folder itself is gone
      let takenErr; try { await open(taken, profile); } catch (e) { takenErr = e; }
      assert.ok(takenErr instanceof mod.exports.ActivityFolderInUseError, "FOLDER_TAKEN is the in-use error: " + takenErr);
      assert.equal(fs.existsSync(taken), true, "FOLDER_TAKEN loser does not remove the folder");
    }
    // N8: a prepare that rejects after Studio made the folder removes the empty folder (and records nothing).
    const badProfile = { ...profile, activity_id: "not-hex" };
    const failing = path.join(home, "FailingOpen");
    await assert.rejects(() => open(failing, badProfile));
    assert.equal(fs.existsSync(failing), false, "failed prepare: the empty folder Studio just made is removed");
    const keep = path.join(home, "KeepsFiles"); const kept = createStudioFolder(keep); fs.writeFileSync(path.join(keep, "mine.txt"), "x");
    discardStudioFolder(kept); assert.equal(fs.existsSync(path.join(keep, "mine.txt")), true, "a folder with files is never removed");
    const swapped = path.join(home, "Swapped"); const sw = createStudioFolder(swapped); fs.rmdirSync(swapped); await sleep(30); fs.mkdirSync(swapped);
    discardStudioFolder(sw); assert.equal(fs.existsSync(swapped), true, "a different folder at the same path is never removed");
    // The order matters: creating the leaf after prepare finds it already there.
    const late = path.join(home, "LateOrder");
    conn.prepare(late, profile, () => prepareWorkspaceDirectory(late, "empty", () => ""), await conn.folderOwners(late));
    assert.equal(createStudioFolder(late), undefined, "(why the order matters) ActivityConnections.prepare mkdirs first");
  }

  // 2. The real call site.
  const ext = fs.readFileSync(path.join(here, "../src/extension.ts"), "utf8");
  const site = ext.slice(ext.indexOf("async function openWorkspaceFolder("));
  const siteBody = site.slice(0, site.indexOf("\n}\n"));
  assert.ok(siteBody.indexOf("createdFolder = createStudioFolder(dir);") > 0
    && siteBody.indexOf("createdFolder = createStudioFolder(dir);") < siteBody.indexOf("connections.prepare("), "the leaf is created before ActivityConnections.prepare (which mkdirs it)");
  assert.match(siteBody, /try \{ createdFolder = createStudioFolder\(dir\); \} catch \{ createdFolder = undefined; \}/, "a create failure must not replace prepare's guidance");
  // Only a comment may sit between the catch and the shared cleanup (an unconditional discardStudioFolder on that line must not pass).
  assert.match(siteBody, /catch\(error\) \{\n\s*\/\/[^\n]*\n\s+discardStudioFolderAfterFailure\(createdFolder, error\);/, "a failed open goes through the shared cleanup (keeps busy / taken)");
  assert.ok(!/discardStudioFolder\(/.test(siteBody), "no direct discardStudioFolder at the call site");
  assert.equal((siteBody.match(/discardStudioFolder\w*\(/g) ?? []).length, 1, "exactly one discard call at the call site (no second discard after the shared one)");
  assert.equal((ext.match(/discardStudioFolder\w*\(/g) ?? []).length, 1, "exactly one discard call in the extension");
  assert.match(siteBody, /await syncStudioFolderRecord\(context\.globalState, createdFolder\);/, "only createStudioFolder's result is recorded");
  assert.ok(!/absentBefore|directoryIsAbsent/.test(siteBody), "no separate check-then-create");
  assert.equal((ext.match(/syncStudioFolderRecord\(/g) ?? []).length, 1, "one writer of the record");
  assert.ok(!/studioFoldersFlag/.test(ext), "the extension no longer decides trust from the flag");

  // 3. Core patch on a stand-in checkout of the pristine upstream file.
  const tree = path.join(tmp, "vscode");
  fs.mkdirSync(path.dirname(path.join(tree, REL)), { recursive: true });
  fs.copyFileSync(path.join(coreDir, "upstream", REL), path.join(tree, REL));
  run("git", ["init", "-q"], tree); run("git", ["add", "-A"], tree);
  run("git", ["-c", "user.name=t", "-c", "user.email=t@invalid", "commit", "-qm", "upstream"], tree);
  const base = fs.readFileSync(path.join(tree, REL), "utf8");
  assert.ok(!base.includes("hpsIsStudioCreatedFolder"), "red on base: upstream has no Studio-folder decision");
  assert.deepEqual([...fs.readFileSync(patch, "utf8").matchAll(/^diff --git a\/(\S+) /gm)].map((m) => m[1]), [PURE_REL, REL]);
  run("git", ["apply", "--check", "--ignore-whitespace", patch], tree); // prepare_vscode.sh's apply_patch flags
  run("git", ["apply", patch], tree);
  const patched = fs.readFileSync(path.join(tree, REL), "utf8");
  assert.equal(patched.split("this.isHpsStudioCreatedFolder(uri)").length, 2, "one trust hook, inside doGetUriTrustInfo");
  const hookAt = patched.indexOf("this.isHpsStudioCreatedFolder(uri)");
  assert.ok(hookAt > patched.indexOf("private doGetUriTrustInfo(") && hookAt < patched.indexOf("let resultState = false;"));
  assert.ok(patched.includes("if (!this.workspaceTrustEnablementService.isWorkspaceTrustEnabled()) {"));
  assert.equal((patched.match(/isWorkspaceTrustEnabled\(\)/g) ?? []).length, (base.match(/isWorkspaceTrustEnabled\(\)/g) ?? []).length, "trust stays enabled");
  // Wiring: births refreshed before any decision that can use them; learner choice recorded for every set.
  const method = (name) => {
    const at = patched.indexOf(`\tprivate ${name}(`) >= 0 ? patched.indexOf(`\tprivate ${name}(`) : patched.indexOf(`\tprivate async ${name}(`);
    assert.ok(at >= 0, `${name} exists`);
    return patched.slice(at, patched.indexOf("\n\t}\n", at) + 4);
  };
  assert.match(patched.slice(patched.indexOf("private async resolveCanonicalUris"), patched.indexOf("private async resolveCanonicalUris") + 2500), /await this\.refreshHpsStudioBirths\(canonicalWorkspaceFolders\);/);
  assert.match(patched, /await this\.refreshHpsStudioBirths\(\[canonicalUri\]\);\n\t\treturn this\.doGetUriTrustInfo\(canonicalUri\);/);
  assert.match(method("doSetUrisTrust"), /for \(const uri of uris\) \{\n\t\t\tif \(this\.rememberHpsStudioChoice\(uri, trusted\)\) \{\n\t\t\t\tchanged = true;/);

  // The pure module, imported from the patched tree.
  const pureFile = path.join(tree, PURE_REL);
  assert.ok(!/^import /m.test(fs.readFileSync(pureFile, "utf8")), "pure module: no imports");
  const pure = await import(pathToFileURL(pureFile).href);
  assert.equal(pure.HPS_STUDIO_FOLDERS_KEY, STUDIO_FOLDERS_KEY, "core and extension agree on the key");

  // The patched hook methods, transpiled and run against stand-ins for the workbench services.
  const SCOPE = { APPLICATION: -1, PROFILE: 0, WORKSPACE: 1 };
  const URI = { file: (p) => ({ scheme: "file", fsPath: p }) };
  const src = `class C {\n${method("isHpsStudioCreatedFolder")}\n${method("rememberHpsStudioChoice")}\n${method("refreshHpsStudioBirths")}\n}`;
  const js = ts.transpileModule(src, { compilerOptions: { target: "ES2022", module: "None" } }).outputText;
  const Klass = vm.runInNewContext(`${js}\n;C`, {});
  const bind = Object.assign(Object.create(null), pure, { StorageScope: SCOPE, StorageTarget: { MACHINE: 1 }, URI, Schemas: { file: "file" } });
  const names = Object.keys(bind);
  const make = Function(...names, `${js}\n;return C;`)(...names.map((n) => bind[n]));
  const world = (opts = {}) => {
    const values = new Map();
    const put = (scope, key, v) => values.set(`${scope}|${key}`, v);
    const o = new make();
    o._hpsStudioBirths = new Map();
    o.storageService = { get: (k, s) => values.get(`${s}|${k}`), store: (k, v, s) => values.set(`${s}|${k}`, v) };
    o.configurationService = { inspect: () => (opts.inspect ?? { userLocalValue: true }) };
    o.uriIdentityService = { extUri: {
      isEqual: (a, b) => a.fsPath === b.fsPath,
      isEqualOrParent: (a, b) => a.fsPath === b.fsPath || a.fsPath.startsWith(b.fsPath + "/"), // a equals or is inside b (VS Code semantics)
    } };
    o.fileService = { stat: async (u) => { if (opts.statThrows) throw new Error("ENOENT"); return { ctime: fs.statSync(u.fsPath).birthtime.getTime() }; } };
    const record = (folders) => JSON.stringify({ [STUDIO_FOLDERS_KEY]: { v: 2, folders }, unrelated: 1 });
    put(SCOPE.PROFILE, "hypeproof.hypeproof-chat", record(studioFolderRecordOf(store.get(STUDIO_FOLDERS_KEY)).folders));
    return { o, put, record, values };
  };
  const at = (p) => URI.file(p);
  const trusted = async (w, p) => { await w.o.refreshHpsStudioBirths([at(p)]); return w.o.isHpsStudioCreatedFolder(at(p)); };

  let w = world();
  assert.equal(await trusted(w, created), true, "Studio-created folder opens trusted");
  assert.equal(await trusted(w, other), false, "user-opened folder prompts");
  assert.equal(await trusted(w, preexisting), false, "pre-existing folder prompts");
  assert.equal(await trusted(w, path.join(created, "sub")), false, "a child prompts");
  assert.equal(await trusted(w, home), false, "the parent prompts");
  assert.equal(await trusted(w, path.join(home, "elsewhere", "HypeProofTrial")), false, "same name at another path prompts");
  assert.equal(w.o.isHpsStudioCreatedFolder({ scheme: "vscode-remote", fsPath: created }), false, "remote prompts");
  // Path equality must stand on its own, not lean on the creation-time check: give parent and child the same time.
  const createdBirth = fs.statSync(created).birthtime.getTime();
  for (const p of [home, path.join(created, "sub"), path.dirname(home)]) {
    w.o._hpsStudioBirths.set(p, createdBirth);
    assert.equal(w.o.isHpsStudioCreatedFolder(at(p)), false, `${p === home ? "parent" : "child/ancestor"} with an equal creation time still prompts`);
  }
  w.o._hpsStudioBirths.delete(created);
  assert.equal(w.o.isHpsStudioCreatedFolder(at(created)), false, "birth not read yet: prompts");

  // S1: the core reads the user-local value itself.
  for (const [label, inspect] of [["flag unset", {}], ["flag off", { userLocalValue: false }], ["workspace/default value only", { value: true, workspaceValue: true, defaultValue: true, workspaceFolderValue: true }]]) {
    assert.equal(await trusted(world({ inspect }), created), false, `${label}: prompts`);
  }
  w = world(); w.o.configurationService.inspect = () => { throw new Error("no config yet"); };
  assert.equal(await trusted(w, created), false, "config unavailable: prompts");
  w = world(); w.put(SCOPE.PROFILE, "extensionsIdentifiers/disabled", JSON.stringify([{ id: "Hypeproof.Hypeproof-Chat" }]));
  assert.equal(await trusted(w, created), false, "chat extension disabled: the record alone grants nothing");
  w.put(SCOPE.PROFILE, "extensionsIdentifiers/disabled", JSON.stringify([{ id: "some.other" }]));
  assert.equal(await trusted(w, created), true, "another extension disabled: unaffected");
  w.put(SCOPE.PROFILE, "extensionsIdentifiers/disabled", "[]");
  w.put(SCOPE.WORKSPACE, "extensionsIdentifiers/disabled", JSON.stringify([{ id: "hypeproof.hypeproof-chat" }]));
  assert.equal(await trusted(w, created), false, "chat extension disabled for this workspace: prompts");
  w.values.delete(`${SCOPE.WORKSPACE}|extensionsIdentifiers/disabled`);
  w.put(SCOPE.PROFILE, "extensionsIdentifiers/disabled", "{broken");
  assert.equal(await trusted(w, created), false, "unreadable disabled list: prompts");
  // Records: first present record decides (no fall-through to a stale APPLICATION one).
  w = world(); w.put(SCOPE.PROFILE, "hypeproof.hypeproof-chat", w.record([]));
  w.put(SCOPE.APPLICATION, "hypeproof.hypeproof-chat", w.record([{ path: created, birth: fs.statSync(created).birthtime.getTime() }]));
  assert.equal(await trusted(w, created), false, "a present empty PROFILE record is final");
  // Only PROFILE/APPLICATION storage is read: a WORKSPACE-scope record grants nothing.
  w = world(); w.values.clear(); w.put(SCOPE.WORKSPACE, "hypeproof.hypeproof-chat", w.record([{ path: created, birth: fs.statSync(created).birthtime.getTime() }]));
  assert.equal(await trusted(w, created), false, "workspace-scoped record is ignored");
  w = world(); w.values.clear(); w.put(SCOPE.APPLICATION, "hypeproof.hypeproof-chat", w.record([{ path: created, birth: fs.statSync(created).birthtime.getTime() }]));
  assert.equal(await trusted(w, created), true, "APPLICATION-scope record still works");
  // Creation time: a delete + recreate by hand at the same path is not trusted.
  w = world(); fs.rmdirSync(created); await sleep(30); fs.mkdirSync(created);
  assert.equal(await trusted(w, created), false, "recreated at the same path: creation time mismatch prompts");
  w = world({ statThrows: true });
  assert.equal(await trusted(w, path.join(home, "deep", "er", "Trial")), false, "stat failure: prompts");
  // S2: "Don't Trust" wins and is remembered; an explicit Trust lifts it.
  const deepTrial = path.join(home, "deep", "er", "Trial");
  w = world(); assert.equal(await trusted(w, deepTrial), true);
  assert.equal(w.o.rememberHpsStudioChoice(at(deepTrial), false), true, "Don't Trust is recorded (and reported as a change)");
  assert.equal(w.o.isHpsStudioCreatedFolder(at(deepTrial)), false, "Don't Trust wins over the record");
  assert.equal(w.o.rememberHpsStudioChoice({ scheme: "vscode-remote", fsPath: deepTrial }, false), false);
  const fresh = world(); for (const [k, v] of w.values) fresh.values.set(k, v);
  fresh.o.storageService = { get: (k, s) => fresh.values.get(`${s}|${k}`), store: (k, v, s) => fresh.values.set(`${s}|${k}`, v) };
  fresh.o._hpsStudioBirths.set(deepTrial, fs.statSync(deepTrial).birthtime.getTime());
  assert.equal(fresh.o.isHpsStudioCreatedFolder(at(deepTrial)), false, "remembered across sessions (storage)");
  assert.equal(fresh.o.rememberHpsStudioChoice(at(deepTrial), true), false);
  assert.equal(fresh.o.isHpsStudioCreatedFolder(at(deepTrial)), true, "an explicit Trust lifts the refusal");
  w = world(); assert.equal(await trusted(w, deepTrial), true, "control: the folder is trusted before the list is damaged");
  w.put(SCOPE.APPLICATION, "hypeproof.studioFolderTrustDenied", "{bad");
  assert.equal(await trusted(w, deepTrial), false, "unreadable refusal list: prompts");

  // Pure decision edges.
  const same = (a, b) => a === b;
  const input = (over = {}) => ({ flagOn: true, disabledExtensionsRaws: [undefined, undefined], deniedRaw: undefined, uri: { scheme: "file", fsPath: "/f" }, birth: 5, isSamePath: same,
    recordRaws: [JSON.stringify({ [STUDIO_FOLDERS_KEY]: { v: 2, folders: [{ path: "/f", birth: 5 }] } })], ...over });
  assert.equal(pure.hpsIsStudioCreatedFolder(input()), true);
  assert.equal(pure.hpsIsStudioCreatedFolder(input({ flagOn: false })), false, "flag off");
  assert.equal(pure.hpsIsStudioCreatedFolder(input({ birth: 6 })), false, "birth mismatch");
  assert.equal(pure.hpsIsStudioCreatedFolder(input({ birth: undefined })), false);
  assert.equal(pure.hpsIsStudioCreatedFolder(input({ deniedRaw: JSON.stringify(["/f"]) })), false, "refused");
  assert.equal(pure.hpsIsStudioCreatedFolder(input({ recordRaws: [undefined, undefined] })), false, "no record");
  assert.equal(pure.hpsIsStudioCreatedFolder(input({ recordRaws: ["{not json"] })), false, "bad storage");
  assert.equal(pure.hpsIsStudioCreatedFolder(input({ recordRaws: [JSON.stringify({ [STUDIO_FOLDERS_KEY]: { v: 1, enabled: true, folders: ["/f"] } })] })), false, "old record shape");

  // The flag is registered default off, machine scoped.
  const pkg = JSON.parse(fs.readFileSync(path.join(repo, "extensions/hypeproof-chat/package.json"), "utf8"));
  const setting = pkg.contributes.configuration.properties?.["hypeproofChat.trustStudioFolders"]
    ?? [].concat(pkg.contributes.configuration).map((c) => c.properties?.["hypeproofChat.trustStudioFolders"]).find(Boolean);
  assert.equal(setting.default, false);
  assert.equal(setting.scope, "machine");
  assert.equal(pure.HPS_STUDIO_FLAG, "hypeproofChat.trustStudioFolders");

  // stage-core-patches.sh stages it.
  const fake = path.join(tmp, "studio");
  fs.mkdirSync(path.join(fake, "scripts/patches/core"), { recursive: true });
  fs.copyFileSync(path.join(repo, "scripts/stage-core-patches.sh"), path.join(fake, "scripts/stage-core-patches.sh"));
  fs.copyFileSync(patch, path.join(fake, "scripts/patches/core/hps-studio-folder-trust.patch"));
  run("bash", [path.join(fake, "scripts/stage-core-patches.sh")], fake);
  assert.deepEqual(fs.readdirSync(path.join(fake, "vscodium-base/patches/user")), ["99-hps-studio-folder-trust.patch"]);
  console.log("PASS studio folder trust: leaf-only record, call site, patch apply, hook (flag/extension/Don't Trust/birth)");
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }
