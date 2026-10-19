// AE-15 / CGP-ART-R-002 / CGP-AGENT-R-026 (#673) — per-turn restore points.
// Pure module, real temp folders, planted changes with known answers:
//   a restore point is taken, then files are added / changed / deleted (nested dir, binary),
//   the diff must name exactly those, the revert must put back exact hashes, remove added
//   files, keep the "복구 직전" state recoverable, name over-cap files as not covered,
//   prune old points, and FAIL when a snapshot copy is tampered with (negative control).
// Run: node --experimental-strip-types test/turn-restore.smoke.mjs

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  changeCount, diffRestorePoint, listRestorePoints, loadRestorePoint, pruneRestorePoints, restoreToPoint,
  scanFolder, takeRestorePoint, turnRestoreStoreDir, dropRestorePoint, TURN_RESTORE_SKIP_DIRS,
} from "../src/turnRestore.ts";

let fail = 0;
const t = async (label, fn) => {
  try { await fn(); console.log(`  ok   ${label}`); } catch (e) { console.error(`  FAIL ${label}: ${e?.stack ?? e}`); fail++; }
};
const eq = (a, b, m = "") => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); };
const ok = (v, m) => { if (!v) throw new Error(m); };
const sha = (b) => createHash("sha256").update(b).digest("hex");
const tmp = (tag) => fs.mkdtempSync(path.join(os.tmpdir(), `hps-turn-restore-${tag}-`));
const write = (root, rel, data) => { const p = path.join(root, ...rel.split("/")); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, data); };
const hashOf = (root, rel) => sha(fs.readFileSync(path.join(root, ...rel.split("/"))));
const has = (root, rel) => fs.existsSync(path.join(root, ...rel.split("/")));
const BIN = Buffer.from([0, 255, 1, 254, 0x89, 0x50, 0x4e, 0x47, 0, 0, 13, 10, 26, 10, 7, 7]);

/** A work folder with a page, a nested dir, a binary, and folders that must never be recorded. */
function plant(root) {
  write(root, "index.html", "<!doctype html><h1>안녕</h1>");
  write(root, "css/style.css", "h1{color:red}");
  write(root, "assets/img/logo.png", BIN);
  write(root, "notes.md", "메모");
  write(root, ".git/HEAD", "ref: refs/heads/main");
  write(root, "node_modules/x/index.js", "module.exports=1");
  write(root, ".hypeproof/history/index-20261020-000000.html", "old");
  write(root, "이전 세상/초코.html", "archived world");
}

await t("skip list covers VCS, packages and Studio's own archives", async () => {
  for (const d of [".git", "node_modules", ".hypeproof", "이전 세상"]) ok(TURN_RESTORE_SKIP_DIRS.includes(d), d);
});

await t("store dir is per folder and per task, outside the folder, and sanitises the task key", async () => {
  const a = turnRestoreStoreDir("/base", "/w/one", "task-1");
  ok(a.startsWith(path.join("/base", "turn-restore")), a);
  ok(a !== turnRestoreStoreDir("/base", "/w/two", "task-1"), "folders collide");
  ok(a !== turnRestoreStoreDir("/base", "/w/one", "task-2"), "tasks collide");
  ok(turnRestoreStoreDir("/base", "/w/one", "../evil").endsWith(`${path.sep}default`), "bad task key not sanitised");
});

await t("planted turn: diff names exactly the added, changed and deleted files; revert restores exact bytes", async () => {
  const root = tmp("main"); const store = tmp("store");
  plant(root);
  const before = { "index.html": hashOf(root, "index.html"), "css/style.css": hashOf(root, "css/style.css"), "assets/img/logo.png": hashOf(root, "assets/img/logo.png"), "notes.md": hashOf(root, "notes.md") };
  const { point } = await takeRestorePoint({ store, root, id: "turn-1", turnId: "turn-1", kind: "turn", now: 1000 });
  eq(point.files.map((f) => f.path), ["assets/img/logo.png", "css/style.css", "index.html", "notes.md"], "recorded files");
  ok(point.complete, "complete");
  for (const f of point.files) eq(f.sha256, before[f.path], f.path);

  // The planted turn.
  write(root, "index.html", "<!doctype html><h1>바뀜</h1>");                         // changed
  write(root, "assets/img/logo.png", Buffer.concat([BIN, Buffer.from([9])]));        // changed binary
  fs.unlinkSync(path.join(root, "notes.md"));                                         // deleted
  fs.rmSync(path.join(root, "css"), { recursive: true });                             // deleted nested dir
  write(root, "game/levels/one.js", "level()");                                       // added, in new nested dirs
  write(root, "new.bin", BIN);                                                        // added binary
  write(root, ".git/HEAD", "ref: refs/heads/other");                                  // ignored: never reported or reverted
  write(root, "이전 세상/나비.html", "another archive");                               // ignored: host archive

  const changes = diffRestorePoint(point, await scanFolder(root));
  eq(changes.added, ["game/levels/one.js", "new.bin"], "added");
  eq(changes.changed, ["assets/img/logo.png", "index.html"], "changed");
  eq(changes.deleted, ["css/style.css", "notes.md"], "deleted");
  eq(changeCount(changes), 6, "count");

  const postTurn = { "index.html": hashOf(root, "index.html"), "game/levels/one.js": hashOf(root, "game/levels/one.js") };
  const out = await restoreToPoint({ store, root, point, beforeRestoreId: "turn-1-before-restore", now: 2000 });
  ok(out.ok, `revert failed: ${JSON.stringify(out.failed)} ${out.error ?? ""}`);
  for (const [rel, h] of Object.entries(before)) eq(hashOf(root, rel), h, `restored ${rel}`);
  ok(!has(root, "new.bin") && !has(root, "game/levels/one.js"), "added files not removed");
  ok(!has(root, "game"), "directory the turn created is left behind");
  ok(has(root, "assets/img") && has(root, "css"), "pre-turn directories missing");
  eq(fs.readFileSync(path.join(root, ".git/HEAD"), "utf8"), "ref: refs/heads/other", "ignored .git touched");
  ok(has(root, "이전 세상/나비.html"), "host archive removed");
  eq((await scanFolder(root)).digest, point.digest, "folder digest equals the point");
  eq(out.afterDigest, point.digest, "reported digest");
  eq(out.restored.sort(), ["assets/img/logo.png", "css/style.css", "index.html", "notes.md"], "restored list");
  eq(out.removed.sort(), ["game/levels/one.js", "new.bin"], "removed list");

  // AE-15: the state just before the revert is its own point and can itself be restored.
  const pre = await loadRestorePoint(store, "turn-1-before-restore");
  ok(pre && pre.kind === "before_restore", "복구 직전 point missing");
  eq(pre.digest, out.beforeRestore.digest, "before-restore digest");
  const back = await restoreToPoint({ store, root, point: pre, beforeRestoreId: "turn-1-before-restore-2", now: 3000 });
  ok(back.ok, "restoring the 복구 직전 point failed");
  eq(hashOf(root, "index.html"), postTurn["index.html"], "post-turn index.html not recoverable");
  eq(hashOf(root, "game/levels/one.js"), postTurn["game/levels/one.js"], "post-turn added file not recoverable");
  ok(!has(root, "notes.md"), "redo should delete notes.md again");
});

await t("a learner's manual edit inside the turn window is a change like any other", async () => {
  const root = tmp("manual"); const store = tmp("store");
  write(root, "index.html", "a");
  const { point } = await takeRestorePoint({ store, root, id: "m", turnId: "m", kind: "turn" });
  write(root, "index.html", "edited by hand");
  eq(diffRestorePoint(point, await scanFolder(root)).changed, ["index.html"]);
});

await t("over-cap files are named not covered, never claimed restored, never removed", async () => {
  const root = tmp("cap"); const store = tmp("store");
  write(root, "small.txt", "s");
  write(root, "big.bin", Buffer.alloc(2048, 1));
  const limits = { fileMax: 1024 };
  const { point } = await takeRestorePoint({ store, root, id: "c", turnId: "c", kind: "turn", limits });
  eq(point.files.map((f) => f.path), ["small.txt"], "covered");
  eq(point.notCovered, [{ path: "big.bin", reason: "too_large", size: 2048 }], "not covered");
  write(root, "big.bin", Buffer.alloc(4096, 2));        // changed but uncovered
  write(root, "huge-new.bin", Buffer.alloc(4096, 3));   // added and uncovered
  write(root, "small.txt", "S");
  const changes = diffRestorePoint(point, await scanFolder(root, { limits }));
  eq(changes.changed, ["small.txt"], "changed");
  eq(changes.added, [], "uncovered new file is not offered for removal as 'added'");
  eq(changes.notCovered.map((n) => n.path).sort(), ["big.bin", "huge-new.bin"], "named");
  const out = await restoreToPoint({ store, root, point, beforeRestoreId: "c-before", limits });
  ok(out.ok, JSON.stringify(out.failed));
  eq(fs.readFileSync(path.join(root, "small.txt"), "utf8"), "s");
  ok(!out.restored.includes("big.bin"), "big.bin claimed restored");
  eq(fs.statSync(path.join(root, "big.bin")).size, 4096, "uncovered file must stay as it is");
  ok(has(root, "huge-new.bin"), "uncovered added file must not be deleted (no copy of it exists)");
  eq(out.notCovered.map((n) => n.path).sort(), ["big.bin", "huge-new.bin"], "outcome names them");
});

await t("file-count and total caps are reported, not silent", async () => {
  const root = tmp("count"); const store = tmp("store");
  for (let i = 0; i < 5; i++) write(root, `f${i}.txt`, "x".repeat(10));
  const { point } = await takeRestorePoint({ store, root, id: "n", turnId: "n", kind: "turn", limits: { filesMax: 3, totalMax: 25 } });
  eq(point.files.length, 2, "total cap bites first at 25 bytes");
  eq(point.notCovered.map((n) => n.reason), ["total_cap", "total_cap", "total_cap"]);
  const p2 = (await takeRestorePoint({ store, root, id: "n2", turnId: "n2", kind: "turn", limits: { filesMax: 3 } })).point;
  eq(p2.notCovered.map((n) => n.reason), ["file_cap", "file_cap"]);
});

await t("a walk past the entry cap marks the point incomplete and refuses the revert", async () => {
  const root = tmp("entries"); const store = tmp("store");
  for (let i = 0; i < 6; i++) write(root, `d${i}/f.txt`, "x");
  const limits = { entriesMax: 4 };
  const { point } = await takeRestorePoint({ store, root, id: "e", turnId: "e", kind: "turn", limits });
  ok(!point.complete, "should be incomplete");
  const out = await restoreToPoint({ store, root, point, beforeRestoreId: "e-before", limits });
  ok(!out.ok && out.error === "folder_too_large", JSON.stringify(out));
  for (let i = 0; i < 6; i++) ok(has(root, `d${i}/f.txt`), "an incomplete revert must not delete anything");
});

await t("links are recorded as not covered and never followed", async () => {
  const root = tmp("link"); const store = tmp("store"); const outside = tmp("outside");
  write(outside, "secret.txt", "outside");
  write(root, "a.txt", "a");
  fs.symlinkSync(outside, path.join(root, "out"));
  const { point } = await takeRestorePoint({ store, root, id: "l", turnId: "l", kind: "turn" });
  eq(point.files.map((f) => f.path), ["a.txt"]);
  eq(point.notCovered, [{ path: "out", reason: "link" }]);
});

await t("pruning keeps the newest N points and drops blobs nobody names", async () => {
  const root = tmp("prune"); const store = tmp("store");
  for (let i = 0; i < 12; i++) {
    write(root, "index.html", `v${i}`);
    await takeRestorePoint({ store, root, id: `p${i}`, turnId: `p${i}`, kind: "turn", now: 1000 + i, keep: 10 });
  }
  const ids = (await listRestorePoints(store)).map((p) => p.id);
  eq(ids.length, 10, "kept");
  ok(!ids.includes("p0") && !ids.includes("p1") && ids.includes("p11"), ids.join(","));
  const blobs = fs.readdirSync(path.join(store, "blobs")).flatMap((s) => fs.readdirSync(path.join(store, "blobs", s)));
  eq(blobs.length, 10, "one blob per kept version");
  ok(!blobs.includes(sha("v0")), "blob of a pruned point survives");
  eq(await pruneRestorePoints(store, 3), ["p8", "p7", "p6", "p5", "p4", "p3", "p2"], "prune to 3");
  await dropRestorePoint(store, "p11");
  eq((await listRestorePoints(store)).map((p) => p.id), ["p10", "p9"]);
});

await t("pruning during a revert keeps the target and its 복구 직전 point", async () => {
  const root = tmp("keep2"); const store = tmp("store");
  write(root, "a.txt", "1");
  const { point } = await takeRestorePoint({ store, root, id: "old", turnId: "old", kind: "turn", now: 1 });
  write(root, "a.txt", "2");
  for (let i = 0; i < 3; i++) await takeRestorePoint({ store, root, id: `x${i}`, turnId: `x${i}`, kind: "turn", now: 10 + i, keep: 10 });
  const out = await restoreToPoint({ store, root, point, beforeRestoreId: "old-before", now: 100, keep: 1 });
  ok(out.ok, JSON.stringify(out));
  eq(fs.readFileSync(path.join(root, "a.txt"), "utf8"), "1");
  ok(await loadRestorePoint(store, "old-before"), "복구 직전 point pruned by its own revert");
});

await t("negative control: a tampered snapshot copy makes the revert report failure and claims nothing", async () => {
  const root = tmp("tamper"); const store = tmp("store");
  write(root, "index.html", "original");
  write(root, "other.txt", "keep me");
  const { point } = await takeRestorePoint({ store, root, id: "tt", turnId: "tt", kind: "turn" });
  write(root, "index.html", "turn output");
  write(root, "other.txt", "turn other");
  const h = sha("original");
  fs.writeFileSync(path.join(store, "blobs", h.slice(0, 2), h), "tampered");
  const out = await restoreToPoint({ store, root, point, beforeRestoreId: "tt-before" });
  ok(!out.ok, "a revert with a damaged copy must not succeed");
  eq(out.failed, [{ path: "index.html", reason: "snapshot_damaged" }], "failure names the file");
  ok(!out.restored.includes("index.html"), "damaged file claimed restored");
  eq(fs.readFileSync(path.join(root, "index.html"), "utf8"), "turn output", "damaged bytes must not be written over the learner's file");
  eq(fs.readFileSync(path.join(root, "other.txt"), "utf8"), "keep me", "undamaged file still restored");
});

await t("negative control: a manifest that lies about a hash is caught before anything is written", async () => {
  const root = tmp("verify"); const store = tmp("store");
  write(root, "a.txt", "one");
  const { point } = await takeRestorePoint({ store, root, id: "v", turnId: "v", kind: "turn" });
  // A manifest that lies about the hash: the copy then fails its own check, so the planted lie is caught before writing.
  const lie = { ...point, files: point.files.map((f) => ({ ...f, sha256: sha("something else") })) };
  write(root, "a.txt", "two");
  const out = await restoreToPoint({ store, root, point: lie, beforeRestoreId: "v-before" });
  ok(!out.ok && out.failed.some((f) => f.path === "a.txt"), JSON.stringify(out));
});

await t("positive control: an unchanged folder restores trivially with nothing to do", async () => {
  const root = tmp("noop"); const store = tmp("store");
  write(root, "a.txt", "same");
  const { point } = await takeRestorePoint({ store, root, id: "z", turnId: "z", kind: "turn" });
  eq(changeCount(diffRestorePoint(point, await scanFolder(root))), 0);
  const out = await restoreToPoint({ store, root, point, beforeRestoreId: "z-before" });
  ok(out.ok && out.restored.length === 0 && out.removed.length === 0 && out.failed.length === 0, JSON.stringify(out));
});

await t("manifests with paths that leave the folder are refused on load", async () => {
  const store = tmp("store");
  fs.mkdirSync(path.join(store, "points"), { recursive: true });
  fs.writeFileSync(path.join(store, "points", "bad.json"), JSON.stringify({ version: 1, id: "bad", kind: "turn", turnId: "bad", createdAt: 1, files: [{ path: "../escape.txt", size: 1, sha256: sha("x") }], dirs: [], notCovered: [], complete: true, digest: "" }));
  eq(await loadRestorePoint(store, "bad"), null);
});

await t("host wiring: one restore point before every runtime, one review after it (proxy, agent-sdk, local)", async () => {
  const src = fs.readFileSync(new URL("../src/chatPanelProvider.ts", import.meta.url), "utf8");
  const send = src.slice(src.indexOf("  private async handleSend("), src.indexOf("  private async runBrowserLoop("));
  ok(send.length > 1000, "handleSend not found");
  const begin = send.indexOf("const turnRestorePoint = await this.beginTurnRestore(streamId);");
  ok(begin > 0, "beginTurnRestore not awaited in handleSend");
  ok(begin > send.indexOf("streamStart"), "restore point taken before the turn's stream exists (its failure line needs the timeline)");
  for (const runtime of ["runSdkCoach({", "await runProxyRuntime();", "runLocalCoach({"]) {
    const at = send.indexOf(runtime);
    ok(at > begin, `${runtime} can run before the restore point is taken`);
  }
  const end = send.indexOf("await this.endTurnRestore(turnRestorePoint, streamId);");
  ok(end > send.indexOf("this.spool?.recordTurnEnd({"), "review not computed in the turn's finally");
  ok(end < send.indexOf("this.turnTimelines.delete(streamId);", end), "review computed after the timeline is gone");
  ok(/case "turnRevert":\s*case "turnKeep":\s*case "turnReviewClose":\s*await this\.handleTurnReviewMessage\(msg\);/.test(src), "webview messages not routed");
  ok(/recordWorkflow\(\{ turnId: review\.point\.turnId, event: "turn_review_keep"/.test(src), "keep not recorded");
  ok(/event: "turn_review_revert"/.test(src), "revert not recorded");
  eq((src.match(/if \(this\.turnRestoreBusy\) \{ await this\.refuseSendWhileRestoring\([^)]*\); return; \}\s*await this\.handleSend\(/g) ?? []).length, 2, "send and retry must wait for a running revert");
});

if (fail) { console.error(`turn-restore: ${fail} failed`); process.exit(1); }
console.log("turn-restore OK");
