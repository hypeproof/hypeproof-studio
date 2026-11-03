// #3427 — undo on a large work folder: copy on first write (TurnWriteTracker), not a copy of the folder.
// Planted answers on real temp folders:
//   a synthetic folder of 20,000 files does not fit a whole-folder point; a turn edits 2 files and
//   creates 1 (in a new nested directory); undo restores exactly those bytes, removes the created file
//   and its directory, and leaves the other 19,998 files untouched. Only the 2 edited files are copied.
// Also: a deleted file comes back, the first write of a path wins, files past the per-file or per-turn
// byte bound are named (never silently dropped), paths outside the folder are ignored, damaged
// manifests are refused, and the host wiring captures every approved write and names shell steps.
// Run: node --experimental-strip-types test/turn-restore-large.smoke.mjs

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  changeCount, diffRestorePoint, folderFitsRestoreLimits, loadRestorePoint, restoreToPoint, scanForPoint,
  TurnWriteTracker, trackedTooLargeLine, TRACKED_SHELL_NOTICE, listRestorePoints,
} from "../src/turnRestore.ts";

let fail = 0;
const t = async (label, fn) => {
  try { await fn(); console.log(`  ok   ${label}`); } catch (e) { console.error(`  FAIL ${label}: ${e?.stack ?? e}`); fail++; }
};
const eq = (a, b, m = "") => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); };
const ok = (v, m) => { if (!v) throw new Error(m); };
const sha = (b) => createHash("sha256").update(b).digest("hex");
const tmp = (tag) => fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), `hps-turn-restore-large-${tag}-`)));
const abs = (root, rel) => path.join(root, ...rel.split("/"));
const write = (root, rel, data) => { const p = abs(root, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, data); };
const hashOf = (root, rel) => sha(fs.readFileSync(abs(root, rel)));
const has = (root, rel) => fs.existsSync(abs(root, rel));
const blobCount = (store) => {
  const dir = path.join(store, "blobs");
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir).reduce((n, shard) => n + fs.readdirSync(path.join(dir, shard)).length, 0);
};

/** 20,000 files in 200 folders of 100: the shape that turned undo off for a member (#3427). */
function plantLarge(root, n = 20000) {
  for (let d = 0; d < n / 100; d++) {
    const dir = path.join(root, `chapter-${String(d).padStart(3, "0")}`);
    fs.mkdirSync(dir, { recursive: true });
    for (let f = 0; f < 100; f++) fs.writeFileSync(path.join(dir, `note-${f}.md`), `chapter ${d} note ${f}\n`);
  }
}

await t("20k-file folder: a turn edits 2 files and creates 1; undo restores exactly that", async () => {
  const root = tmp("20k"); const store = tmp("store");
  plantLarge(root);
  const a = "chapter-000/note-0.md", b = "chapter-150/note-42.md", created = "새 폴더/깊은/report.html";
  const sample = ["chapter-001/note-1.md", "chapter-199/note-99.md", "chapter-100/note-50.md"];
  const before = Object.fromEntries([a, b, ...sample].map((p) => [p, hashOf(root, p)]));

  let started = Date.now();
  ok(!(await folderFitsRestoreLimits(root)), "a 20k-file folder must not fit a whole-folder point");
  const fitMs = Date.now() - started;

  started = Date.now();
  const tracker = await TurnWriteTracker.start({ store, root, id: "turn-big", turnId: "turn-big", now: 1000 });
  // The host captures after approval and before the tool runs (captureTurnWrite).
  const caps = [
    ...(await tracker.capture([abs(root, a)])),
    ...(await tracker.capture([abs(root, b)])),
    ...(await tracker.capture([abs(root, created)])),
  ];
  eq(caps.map((c) => c.state), ["copied", "copied", "absent"], "capture states");
  const captureMs = Date.now() - started;
  // The turn's writes.
  fs.writeFileSync(abs(root, a), "AI가 고친 1");
  fs.appendFileSync(abs(root, b), "AI가 덧붙임\n");
  write(root, created, "<h1>새 보고서</h1>");
  // A later edit of an already captured file keeps the first (pre-turn) state.
  eq(await tracker.capture([abs(root, a)]), [], "second capture of the same path records nothing");
  eq(blobCount(store), 2, "only the two edited files are copied, never the folder");

  const point = tracker.point();
  eq(point.scope, "tracked");
  eq(point.files.map((f) => f.path), [a, b].sort(), "recorded files");
  eq(point.absent, [created], "recorded absence");
  ok(point.dirs.includes("chapter-000") && !point.dirs.includes("새 폴더"), "pre-existing dirs only");

  const now = await scanForPoint(root, point);
  const changes = diffRestorePoint(point, now);
  eq(changes.changed, [a, b].sort(), "changed");
  eq(changes.added, [created], "added");
  eq(changes.deleted, [], "deleted");
  eq(changeCount(changes), 3);

  started = Date.now();
  const out = await restoreToPoint({ store, root, point, beforeRestoreId: "turn-big-before", expectedDigest: now.digest, now: 2000 });
  const restoreMs = Date.now() - started;
  ok(out.ok, `restore failed: ${JSON.stringify(out.failed)} ${out.error ?? ""}`);
  eq(out.restored.sort(), [a, b].sort(), "restored");
  eq(out.removed, [created], "removed");
  eq(hashOf(root, a), before[a], "a bytes");
  eq(hashOf(root, b), before[b], "b bytes");
  ok(!has(root, created) && !has(root, "새 폴더"), "created file and the directories the turn made are gone");
  for (const p of sample) eq(hashOf(root, p), before[p], `untouched ${p}`);
  let count = 0;
  for (const d of fs.readdirSync(root)) count += fs.readdirSync(path.join(root, d)).length;
  eq(count, 20000, "file count after undo");
  // "복구 직전" holds the turn's bytes, so the undo can itself be undone.
  const kept = await loadRestorePoint(store, "turn-big-before");
  ok(kept && kept.scope === "tracked" && kept.files.some((f) => f.path === created), "before-restore point kept with the created file");
  console.log(`       measured: fit check ${fitMs} ms, 3 captures ${captureMs} ms, undo ${restoreMs} ms, blobs copied 2 (folder of 20,000 files)`);
});

await t("a small folder still fits a whole-folder point (shell changes stay detected there)", async () => {
  const root = tmp("small");
  write(root, "index.html", "<h1>hi</h1>");
  write(root, "node_modules/x/index.js", "skipped");
  ok(await folderFitsRestoreLimits(root), "small folder must fit");
  ok(!(await folderFitsRestoreLimits(root, { filesMax: 0 })), "past filesMax must not fit");
  ok(!(await folderFitsRestoreLimits(root, { totalMax: 3 })), "past totalMax must not fit");
});

await t("a deleted file comes back; an edit after a create keeps the absence", async () => {
  const root = tmp("del"); const store = tmp("store");
  write(root, "keep.txt", "원본");
  const h = hashOf(root, "keep.txt");
  const tracker = await TurnWriteTracker.start({ store, root, id: "turn-del", turnId: "turn-del" });
  await tracker.capture([abs(root, "keep.txt"), abs(root, "new.txt")]);
  fs.unlinkSync(abs(root, "keep.txt"));
  write(root, "new.txt", "v1");
  await tracker.capture([abs(root, "new.txt")]); // the Edit after the Write
  write(root, "new.txt", "v2");
  const point = tracker.point();
  eq(point.absent, ["new.txt"]);
  const changes = diffRestorePoint(point, await scanForPoint(root, point));
  eq(changes.deleted, ["keep.txt"]);
  eq(changes.added, ["new.txt"]);
  const out = await restoreToPoint({ store, root, point, beforeRestoreId: "turn-del-before" });
  ok(out.ok, JSON.stringify(out));
  eq(hashOf(root, "keep.txt"), h);
  ok(!has(root, "new.txt"), "created file removed");
});

await t("files past the per-file or per-turn byte bound are named, not silently dropped", async () => {
  const root = tmp("big"); const store = tmp("store");
  write(root, "video.mp4", Buffer.alloc(64, 1));
  write(root, "a.txt", Buffer.alloc(30, 2));
  write(root, "b.txt", Buffer.alloc(30, 3));
  const tracker = await TurnWriteTracker.start({ store, root, id: "turn-cap", turnId: "turn-cap", limits: { fileMax: 50, totalMax: 40 } });
  const caps = await tracker.capture([abs(root, "video.mp4"), abs(root, "a.txt"), abs(root, "b.txt")]);
  eq(caps.map((c) => [c.path, c.state, c.reason ?? null]), [["video.mp4", "not_covered", "too_large"], ["a.txt", "copied", null], ["b.txt", "not_covered", "total_cap"]]);
  fs.writeFileSync(abs(root, "video.mp4"), Buffer.alloc(70, 9));
  fs.writeFileSync(abs(root, "a.txt"), "changed");
  fs.writeFileSync(abs(root, "b.txt"), "changed");
  const point = tracker.point();
  const changes = diffRestorePoint(point, await scanForPoint(root, point, { fileMax: 50 }));
  eq(changes.notCovered.map((n) => n.path).sort(), ["b.txt", "video.mp4"], "named as not covered");
  ok(!changes.added.includes("b.txt") && !changes.added.includes("video.mp4"), "an uncovered path never reads as added");
  const out = await restoreToPoint({ store, root, point, beforeRestoreId: "turn-cap-before", limits: { fileMax: 50 } });
  ok(out.ok, JSON.stringify(out));
  eq(fs.readFileSync(abs(root, "a.txt")), Buffer.alloc(30, 2), "covered file restored");
  eq(fs.readFileSync(abs(root, "b.txt"), "utf8"), "changed", "uncovered file left as it is (never claimed)");
  eq(out.notCovered.map((n) => n.path).sort(), ["b.txt", "video.mp4"]);
  eq(trackedTooLargeLine(["video.mp4"]), "video.mp4: 파일이 너무 커서 이번 요청에서는 되돌릴 수 없어요.");
  eq(trackedTooLargeLine(["a", "b", "c", "d", "e"]), "a, b, c 외 2개: 파일이 너무 커서 이번 요청에서는 되돌릴 수 없어요.");
});

await t("paths outside the folder and links are never recorded or followed", async () => {
  const root = tmp("out"); const store = tmp("store"); const elsewhere = tmp("elsewhere");
  write(elsewhere, "secret.txt", "x");
  fs.symlinkSync(elsewhere, abs(root, "link"));
  const tracker = await TurnWriteTracker.start({ store, root, id: "turn-out", turnId: "turn-out" });
  const caps = await tracker.capture([path.join(elsewhere, "secret.txt"), path.join(root, "..", "up.txt"), abs(root, "link/secret.txt")]);
  eq(caps.map((c) => c.state), ["outside", "outside", "not_covered"]);
  eq(caps[2].reason, "link");
  eq(tracker.point().files, []);
  eq(blobCount(store), 0);
});

await t("tracked manifests round-trip; one naming a path outside the folder is refused", async () => {
  const root = tmp("load"); const store = tmp("store");
  write(root, "a.txt", "a");
  const tracker = await TurnWriteTracker.start({ store, root, id: "turn-load", turnId: "turn-load" });
  await tracker.capture([abs(root, "a.txt"), abs(root, "b.txt")]);
  const loaded = await loadRestorePoint(store, "turn-load");
  eq(loaded?.absent, ["b.txt"]);
  eq(loaded?.files.map((f) => f.path), ["a.txt"]);
  ok((await listRestorePoints(store)).length === 1, "listed");
  fs.writeFileSync(path.join(store, "points", "bad.json"), JSON.stringify({ ...loaded, id: "bad", absent: ["../escape.txt"] }));
  eq(await loadRestorePoint(store, "bad"), null);
  fs.writeFileSync(path.join(store, "points", "bad2.json"), JSON.stringify({ ...loaded, id: "bad2", scope: "everything" }));
  eq(await loadRestorePoint(store, "bad2"), null);
});

await t("host wiring: large folders take a tracked point; every approved write is captured; shell steps are named", async () => {
  const src = fs.readFileSync(new URL("../src/chatPanelProvider.ts", import.meta.url), "utf8");
  ok(!src.includes("작업 폴더에 파일이 너무 많아서 이번 요청은 되돌리기를 쓸 수 없어요."), "the old 'undo off' line is gone");
  const begin = src.slice(src.indexOf("  private async beginTurnRestore("), src.indexOf("  private async beginTrackedTurnRestore("));
  ok(/if \(!\(await folderFitsRestoreLimits\(root\)\)\) return await this\.beginTrackedTurnRestore\(/.test(begin), "fit check before the whole-folder point");
  ok(/if \(!point\.complete\) \{[\s\S]*?return await this\.beginTrackedTurnRestore\(/.test(begin), "an incomplete walk falls back to a tracked point");
  // Each coach runtime's approval callback (instructor, local, agent-sdk) captures after the answer.
  eq((src.match(/await this\.captureTurnWrite\(streamId, ?action, ?approved\);/g) ?? []).length, 3, "captures in approval callbacks");
  ok(/a\.kind === 'approval' && a\.allowed && \(a\.name === 'Bash' \|\| a\.name === 'PowerShell'\)\) this\.turnWriteTrackers\?\.get\(streamId\)\?\.noteShell\(\)/.test(src), "shell steps noted");
  // Every tool's approval runs through captureTurnWrite: a non-write tool must leave before any restore state
  // is read, and nothing in it may throw (a throw there broke WebSearch approvals on main at #3456).
  const capture = src.slice(src.indexOf("  private async captureTurnWrite("), src.indexOf("  /** After a coach turn: compare"));
  ok(/^\s*private async captureTurnWrite\([^)]*\): Promise<void> \{\s*if \(!approved \|\| !isWriteToolName\(action\.toolName\)\) return;\s*try \{/.test(capture), "non-write tools return first; the rest is inside try");
  ok(/\} catch \{ \/\* not covered at the turn's end \*\/ \}\s*\}\s*$/.test(capture), "capture never throws into the approval callback");
  const end = src.slice(src.indexOf("  private async endTurnRestore("), src.indexOf("  private async refuseSendWhileRestoring("));
  ok(end.includes("label: TRACKED_SHELL_NOTICE"), "shell notice posted at the turn's end");
  ok(end.includes("await scanForPoint(handle.root, handle.point)"), "tracked turn compares only its paths");
  ok(TRACKED_SHELL_NOTICE.includes("명령 실행으로 바뀐 파일은 되돌릴 수 없어요"), "the notice never claims shell changes can be undone");
  const review = src.slice(src.indexOf("  private async handleTurnReviewMessage("), src.indexOf("  attachChalkContract("));
  ok(!/scanFolder\(review\.root\)\.digest|const now = await scanFolder\(review\.root\)/.test(review), "review paths scan by the point's scope");
});

if (fail) { console.error(`turn-restore-large: ${fail} failed`); process.exit(1); }
console.log("turn-restore-large OK");
