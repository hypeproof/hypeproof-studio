// REQ-STUDIO-ARTIFACT-PROVENANCE (CGP-KNOW-R-012) — provenance labels from recorded events only.
// Planted answers: synthetic restore manifests and events with a known label per file, then a
// real temp folder driven through the per-turn restore points (turnRestore.ts) and the host
// recorder. In this slice no event attributes a change to the learner: every change a scan merely
// detects (the learner's own edit, a background process, git, a race of any kind) must read 기록 없음,
// and the label set has no "learner changed it" label at all (a lock below).
// Run: node --experimental-strip-types test/artifact-provenance.smoke.mjs

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  ArtifactProvenanceRecorder, PROVENANCE_EVENT_CAP, PROVENANCE_LABELS, PROVENANCE_VIEW_CAP, emptyLedger, loadLedger, markUnobserved,
  noteFolderReplaced, noteHostWrite, observeOutsideTurn, provenanceHistoryText, provenanceLedgerFile, provenanceView, recordCoachTurn, recordHostWrite, recordRevert, setHostWriteSink,
} from "../src/artifactProvenance.ts";
import { diffRestorePoint, scanFolder, takeRestorePoint, turnRestoreStoreDir, TURN_RESTORE_SKIP_DIRS } from "../src/turnRestore.ts";
import { prepareImageEditAsset, saveImageEditOutput } from "../src/imageEditAssets.ts";
import { inspectEditPng, imageBytesHash } from "../src/imageEditPng.ts";
import { writeFiles } from "../src/learningWiki.ts";
import { prepareWorkspaceDirectory } from "../src/workspacePreparation.ts";
import { png } from "./fixtures/image-edit/png.mjs";

let fail = 0;
const t = async (label, fn) => {
  try { await fn(); console.log(`  ok   ${label}`); } catch (e) { console.error(`  FAIL ${label}: ${e?.stack ?? e}`); fail++; }
};
const eq = (a, b, what) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${what}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); };
const h = (c) => c.repeat(64);
const files = (o) => Object.entries(o).map(([p, c]) => ({ path: p, sha256: h(c) }));
const label = (view, p) => { const e = view.entries.find((x) => x.path === p); if (!e) throw new Error(`no entry for ${p}`); return e; };
/** The learner edits a file. In this slice that leaves no event: only a scan later sees the change. */
const save = (l, _o, _at) => l;
const turn = (turnId, at, d) => ({ turnId, at, startedAt: d.startedAt ?? at - 0.5, added: d.added ?? [], changed: d.changed ?? [], deleted: d.deleted ?? [] });

console.log("artifact provenance — pure ledger");

await t("first observation: what was already there reads 기록 없음, with no history", () => {
  const v = provenanceView(observeOutsideTurn(emptyLedger(), files({ "old.txt": "a" }), { at: 1 }));
  eq(v.unobserved, false, "unobserved");
  eq([label(v, "old.txt").kind, label(v, "old.txt").label, label(v, "old.txt").history], ["none", "기록 없음", []], "old.txt");
});

await t("nothing observed yet: no entries, unobserved", () => {
  eq(provenanceView(emptyLedger()), { entries: [], more: 0, unobserved: true, unconfirmed: false }, "view");
});

await t("each label from its own recorded event", () => {
  let l = observeOutsideTurn(emptyLedger(), files({ "keep.txt": "k", "edit.txt": "e" }), { at: 1 });
  // turn 1 starts with a photo the host committed from the learner's attachment
  l = recordHostWrite(l, files({ "images/외관.jpg": "p" }), { at: 1.5, actor: "learner_upload" });
  l = observeOutsideTurn(l, files({ "keep.txt": "k", "edit.txt": "e", "images/외관.jpg": "p" }), { at: 2 });
  l = recordCoachTurn(l, turn("t1", 3, { added: ["index.html"], changed: ["edit.txt"] }), files({ "keep.txt": "k", "edit.txt": "E", "images/외관.jpg": "p", "index.html": "i" }));
  // between turns the learner edits keep.txt in an editor and saves it
  l = save(l, { "keep.txt": "K" }, 4);
  l = observeOutsideTurn(l, files({ "keep.txt": "K", "edit.txt": "E", "images/외관.jpg": "p", "index.html": "i" }), { at: 4.5 });
  const v = provenanceView(l);
  eq(label(v, "index.html").label, "AI가 만듦", "index.html");
  eq(label(v, "edit.txt").label, "AI가 고침", "edit.txt");
  eq(label(v, "images/외관.jpg").label, "내가 올림", "photo");
  eq(label(v, "keep.txt").label, "기록 없음", "keep.txt (the learner's edit has no event)");
  eq(v.entries.map((e) => e.path), ["keep.txt", "edit.txt", "index.html", "images/외관.jpg"], "newest event first, ties by path");
});

await t("a file touched by both shows the latest event with its history, oldest first", () => {
  let l = observeOutsideTurn(emptyLedger(), [], { at: 1 });
  l = recordCoachTurn(l, turn("t1", 2, { added: ["a.html"] }), files({ "a.html": "1" }));
  l = observeOutsideTurn(save(l, { "a.html": "2" }, 3), files({ "a.html": "2" }), { at: 3.5 });
  const e = label(provenanceView(l), "a.html");
  eq([e.label, e.history, provenanceHistoryText(e)], ["기록 없음", ["AI가 만듦", "기록 없음"], "AI가 만듦 → 기록 없음"], "a.html");
  // and back: the coach changes it again
  l = recordCoachTurn(observeOutsideTurn(l, files({ "a.html": "2" }), { at: 4 }), turn("t2", 5, { changed: ["a.html"] }), files({ "a.html": "3" }));
  const e2 = label(provenanceView(l), "a.html");
  eq([e2.label, provenanceHistoryText(e2)], ["AI가 고침", "AI가 만듦 → 기록 없음 → AI가 고침"], "a.html again");
});

await t("repeats fold, the history keeps the last four steps, one step has no history text", () => {
  let l = observeOutsideTurn(emptyLedger(), [], { at: 1 });
  l = recordCoachTurn(l, turn("t1", 2, { added: ["x"] }), files({ x: "1" }));
  eq(provenanceHistoryText(label(provenanceView(l), "x")), "", "single step");
  l = recordCoachTurn(observeOutsideTurn(l, files({ x: "1" }), { at: 3 }), turn("t2", 4, { changed: ["x"] }), files({ x: "2" }));
  l = recordCoachTurn(observeOutsideTurn(l, files({ x: "2" }), { at: 5 }), turn("t3", 6, { changed: ["x"] }), files({ x: "3" }));
  eq(label(provenanceView(l), "x").history, ["AI가 만듦", "AI가 고침"], "folded");
  for (let i = 0; i < 3; i++) {
    l = observeOutsideTurn(save(l, { x: `l${i}` }, 10 + i * 2), files({ x: `l${i}` }), { at: 10.2 + i * 2 });
    l = recordCoachTurn(observeOutsideTurn(l, files({ x: `l${i}` }), { at: 11 + i * 2 }), turn(`u${i}`, 11.5 + i * 2, { changed: ["x"] }), files({ x: `a${i}` }));
  }
  eq(label(provenanceView(l), "x").history, ["기록 없음", "AI가 고침", "기록 없음", "AI가 고침"], "last four");
});

await t("negative control: an unmeasured window never becomes 내가 고침", () => {
  let l = observeOutsideTurn(emptyLedger(), [], { at: 1 });
  l = recordCoachTurn(l, turn("t1", 2, { added: ["a.html"] }), files({ "a.html": "1" }));
  l = markUnobserved(l); // e.g. a turn ran without a restore point
  l = observeOutsideTurn(l, files({ "a.html": "2", "new.txt": "n" }), { at: 3 });
  const v = provenanceView(l);
  eq([label(v, "a.html").label, provenanceHistoryText(label(v, "a.html"))], ["기록 없음", "AI가 만듦 → 기록 없음"], "a.html");
  eq([label(v, "new.txt").label, label(v, "new.txt").history], ["기록 없음", []], "new.txt");
  if (v.entries.some((e) => e.kind === "learner_changed")) throw new Error("a learner label came out of an unmeasured window");
  // a measured window: a scan still only detects the change; the learner's save is what counts
  l = observeOutsideTurn(l, files({ "a.html": "3", "new.txt": "n" }), { at: 4 });
  eq(label(provenanceView(l), "a.html").label, "기록 없음", "measured, no save");
  l = observeOutsideTurn(save(l, { "a.html": "4" }, 5), files({ "a.html": "4", "new.txt": "n" }), { at: 6 });
  eq(label(provenanceView(l), "a.html").label, "기록 없음", "the learner's own edit too, in this slice");
});

await t("negative control: a coach turn over a stale ledger labels nothing AI", () => {
  let l = markUnobserved(observeOutsideTurn(emptyLedger(), files({ "a.txt": "a" }), { at: 1 }));
  l = recordCoachTurn(l, turn("t1", 2, { added: ["b.txt"], changed: ["a.txt"] }), files({ "a.txt": "A", "b.txt": "b" }));
  eq(l.stale, true, "still stale");
  l = observeOutsideTurn(l, files({ "a.txt": "A", "b.txt": "b" }), { at: 3 });
  const v = provenanceView(l);
  if (v.entries.some((e) => e.kind.startsWith("ai_"))) throw new Error("AI label from an unmeasured turn start");
  eq([label(v, "a.txt").label, label(v, "b.txt").label], ["기록 없음", "기록 없음"], "labels");
});

await t("negative control: a coach 'change' the scan does not show records nothing", () => {
  let l = observeOutsideTurn(emptyLedger(), files({ "a.txt": "a" }), { at: 1 });
  l = recordCoachTurn(l, turn("t1", 2, { added: ["ghost.html"] }), files({ "a.txt": "a" }));
  const v = provenanceView(l);
  eq(v.entries.map((e) => [e.path, e.label]), [["a.txt", "기록 없음"]], "only real files, no ghost");
});

await t("negative control: bytes no event left behind never keep the old label", () => {
  let l = observeOutsideTurn(emptyLedger(), [], { at: 1 });
  l = recordCoachTurn(l, turn("t1", 2, { added: ["a.html"] }), files({ "a.html": "1" }));
  // the next turn's diff does not name a.html (e.g. not covered on one side), yet its bytes differ
  l = recordCoachTurn(observeOutsideTurn(l, files({ "a.html": "1" }), { at: 3 }), turn("t2", 4, {}), files({ "a.html": "2" }));
  const e = label(provenanceView(l), "a.html");
  eq([e.label, provenanceHistoryText(e)], ["기록 없음", "AI가 만듦 → 기록 없음"], "a.html");
});

await t("deleted then made again between turns: the old history goes with the old file", () => {
  let l = observeOutsideTurn(emptyLedger(), [], { at: 1 });
  l = recordCoachTurn(l, turn("t1", 2, { added: ["a.html"] }), files({ "a.html": "1" }));
  l = observeOutsideTurn(l, [], { at: 3 });
  eq(provenanceView(l).entries, [], "gone");
  l = observeOutsideTurn(l, files({ "a.html": "9" }), { at: 4 });
  eq([label(provenanceView(l), "a.html").label, label(provenanceView(l), "a.html").history], ["기록 없음", []], "re-created by someone");
  l = observeOutsideTurn(save(l, { "a.html": "10" }, 5), files({ "a.html": "10" }), { at: 6 });
  const e = label(provenanceView(l), "a.html");
  eq([e.label, e.history], ["기록 없음", ["기록 없음"]], "then edited by the learner: still no label");
});

await t("revert: events after the restore point go, the restored file reads as before the turn", () => {
  let l = observeOutsideTurn(emptyLedger(), [], { at: 1 });
  l = recordCoachTurn(l, turn("t1", 2, { added: ["a.html"] }), files({ "a.html": "1" }));
  const pointFiles = files({ "a.html": "1", "images/p.jpg": "p" });
  l = recordHostWrite(l, files({ "images/p.jpg": "p" }), { at: 9.5, actor: "learner_upload" });
  l = observeOutsideTurn(l, pointFiles, { at: 10 }); // turn 2 start = point time
  l = recordCoachTurn(l, turn("t2", 11, { changed: ["a.html"], added: ["b.js"] }), files({ "a.html": "2", "images/p.jpg": "p", "b.js": "b" }));
  l = observeOutsideTurn(l, files({ "a.html": "3", "images/p.jpg": "p", "b.js": "b" }), { at: 12 }); // learner edit before deciding
  l = recordRevert(l, { pointAt: 10, pointFiles, at: 13 }, pointFiles);
  const v = provenanceView(l);
  eq(v.entries.map((e) => [e.path, e.label]), [["images/p.jpg", "내가 올림"], ["a.html", "AI가 만듦"]], "after revert");
  // a file the revert could not put back reads 기록 없음
  const partial = provenanceView(recordRevert(l, { pointAt: 10, pointFiles, at: 14 }, files({ "a.html": "X", "images/p.jpg": "p" })));
  eq(label(partial, "a.html").label, "기록 없음", "not restored");
});

await t("labels: text and a distinct shape per meaning, no score or capability words", () => {
  const shown = ["ai_created", "ai_changed", "studio_created", "studio_changed", "learner_uploaded", "none"].map((k) => PROVENANCE_LABELS[k]);
  eq(shown.map((x) => x.label), ["AI가 만듦", "AI가 고침", "Studio가 만듦", "Studio가 고침", "내가 올림", "기록 없음"], "labels");
  eq(new Set(shown.map((x) => x.symbol)).size, 6, "distinct symbols");
  eq(Object.keys(PROVENANCE_LABELS).sort(), ["ai_changed", "ai_created", "learner_uploaded", "none", "studio_changed", "studio_created", "unknown"], "no other label exists");
  eq(PROVENANCE_LABELS.unknown, PROVENANCE_LABELS.none, "unknown reads as 기록 없음");
  const text = JSON.stringify(PROVENANCE_LABELS);
  for (const bad of ["점", "%", "FRAMING", "JUDGMENT", "OWNERSHIP", "VERIFY", "ADAPT", "ORCHESTRATE"]) if (text.includes(bad)) throw new Error(`label text has ${bad}`);
});

await t("bounds: events capped oldest first, view capped with a count", () => {
  let l = observeOutsideTurn(emptyLedger(), [], { at: 0 });
  const many = Array.from({ length: PROVENANCE_VIEW_CAP + 7 }, (_, i) => ({ path: `f${String(i).padStart(4, "0")}.txt`, sha256: h("a") }));
  l = recordCoachTurn(l, turn("t1", 1, { added: many.map((f) => f.path) }), many);
  const v = provenanceView(l);
  eq([v.entries.length, v.more], [PROVENANCE_VIEW_CAP, 7], "view cap");
  let big = { ...emptyLedger(), baseline: {}, events: [] };
  for (let i = 0; i < PROVENANCE_EVENT_CAP + 5; i++) big = observeOutsideTurn(big, [{ path: "x", sha256: h(String(i % 10)) }], { at: i + 1 });
  eq(big.events.length, PROVENANCE_EVENT_CAP, "event cap");
});

console.log("artifact provenance — storage and the host recorder over a real folder");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hps-provenance-"));
const base = path.join(tmp, "storage");
const root = fs.realpathSync(fs.mkdtempSync(path.join(tmp, "work-")));
const write = (rel, data) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), data); };

await t("damaged ledger: nothing it said is trusted", async () => {
  const file = provenanceLedgerFile(base, path.join(tmp, "other"));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '{"version":1,"baseline":{"a":"not-a-hash"},"stale":false,"events":[]}');
  const l = await loadLedger(file);
  eq([l.baseline, l.stale, l.events.length], [null, true, 0], "loaded");
});

await t("ledger lives in extension storage, never in the work folder", () => {
  const file = provenanceLedgerFile(base, root);
  if (!file.startsWith(base + path.sep) || file.startsWith(root)) throw new Error(file);
});

await t("end to end: two coach turns, an attach, a learner edit, an out-of-turn host write", async () => {
  const rec = new ArtifactProvenanceRecorder(base);
  write("notes.md", "before studio");
  const store = turnRestoreStoreDir(base, root, "task1");
  // the drawer opens before any turn: baseline only
  let v = await rec.view(root, (await scanFolder(root)).files);
  eq(v.entries.map((e) => [e.path, e.label]), [["notes.md", "기록 없음"]], "baseline");

  // turn 1: a photo attached on send, then the coach writes index.html
  write("images/외관.jpg", Buffer.from([0xff, 0xd8, 1, 2]));
  void rec.hostWrote(root, [{ absPath: path.join(root, "images", "외관.jpg") }], "learner_upload");
  const p1 = (await takeRestorePoint({ store, root, id: "s1", turnId: "s1", kind: "turn", now: 1000 })).point;
  await rec.turnStart(root, p1);
  write("index.html", "<h1>v1</h1>");
  let now = await scanFolder(root);
  await rec.turnEnd(root, p1, diffRestorePoint(p1, now), now.files);

  // between turns the learner edits index.html in an editor and saves it
  write("index.html", "<h1>v1 mine</h1>");
  // turn 2: the coach changes notes.md
  const p2 = (await takeRestorePoint({ store, root, id: "s2", turnId: "s2", kind: "turn", now: 2000 })).point;
  await rec.turnStart(root, p2);
  write("notes.md", "coach rewrote");
  now = await scanFolder(root);
  await rec.turnEnd(root, p2, diffRestorePoint(p2, now), now.files);

  v = await rec.view(root, (await scanFolder(root)).files);
  const got = Object.fromEntries(v.entries.map((e) => [e.path, [e.label, provenanceHistoryText(e)]]).sort());
  eq(got, {
    "images/외관.jpg": ["내가 올림", ""],
    "index.html": ["기록 없음", "AI가 만듦 → 기록 없음"],
    "notes.md": ["AI가 고침", ""],
  }, "labels");

  // an unmeasured window: never 내가 고침
  await rec.unobserved(root);
  write("index.html", "<h1>changed unseen</h1>");
  v = await rec.view(root, (await scanFolder(root)).files);
  eq([label(v, "index.html").label, provenanceHistoryText(label(v, "index.html"))], ["기록 없음", "AI가 만듦 → 기록 없음"], "unmeasured");
  if (fs.readdirSync(root).some((n) => n.includes("provenance"))) throw new Error("ledger leaked into the work folder");
});

await t("view without a scan only reads; without any observation it is unobserved", async () => {
  const rec = new ArtifactProvenanceRecorder(base);
  const fresh = fs.realpathSync(fs.mkdtempSync(path.join(tmp, "fresh-")));
  fs.writeFileSync(path.join(fresh, "a.txt"), "a");
  eq((await rec.view(fresh)).unobserved, true, "read only");
  eq((await rec.view(fresh, (await scanFolder(fresh)).files)).entries.map((e) => e.label), ["기록 없음"], "observed");
});

console.log("artifact provenance — verifier findings 1-6, reproduced with the recorder");

let n = 0;
/** A fresh work folder and a recorder session over it; the sink routes noteHostWrite to it. */
async function session(seed = {}) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(tmp, `case${++n}-`)));
  for (const [rel, data] of Object.entries(seed)) { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), data); }
  let clock = 1000 * n;
  const rec = new ArtifactProvenanceRecorder(base, () => ++clock);
  setHostWriteSink({ wrote: (writes, actor) => { void rec.hostWrote(dir, writes, actor); }, replaced: (folder) => { void rec.folderReplaced(folder); } });
  const put = (rel, data) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), data); };
  // As postArtifactProvenance does: the generation is read before the scan and handed to view.
  const list = async () => { const g = rec.generation(); return rec.view(dir, await scanFolder(dir), g); };
  let seq = 0;
  /** One coach turn: restore point, `during()` inside the window, rescan, diff, record. */
  const coachTurn = async (during = async () => {}, afterScan = async () => {}) => {
    const id = `turn${++seq}`;
    const point = (await takeRestorePoint({ store: turnRestoreStoreDir(base, dir, `c${n}`), root: dir, id, turnId: id, kind: "turn", now: ++clock })).point;
    await rec.turnStart(dir, point);
    await during();
    const now = await scanFolder(dir);
    await afterScan();
    await rec.turnEnd(dir, point, diffRestorePoint(point, now), now);
  };
  await list(); // the session's first observation (stale by design: before this, nothing was seen)
  /** The learner edits and saves a file in an editor: in this slice that is only a change a scan sees. */
  const save = (rel, text) => put(rel, text);
  // Every list this session draws must use only the labels this slice has (no "learner changed it").
  const allowed = new Set(["AI가 만듦", "AI가 고침", "Studio가 만듦", "Studio가 고침", "내가 올림", "기록 없음"]);
  const checked = async () => {
    const v = await list();
    for (const e of v?.entries ?? []) {
      if (!allowed.has(e.label)) throw new Error(`label outside this slice: ${e.path}=${e.label}`);
      for (const h of e.history) if (!allowed.has(h)) throw new Error(`history step outside this slice: ${e.path}: ${h}`);
    }
    return v;
  };
  return { dir, rec, put, save, list: checked, coachTurn };
}
const labelOf = async (c, p) => { const e = label(await c.list(), p); return [e.label, provenanceHistoryText(e)]; };

await t("1. a prebuilt world copied in before the restore point reads Studio가 고침, never 내가 고침", async () => {
  const c = await session({ "index.html": "<p>old world</p>" });
  await c.coachTurn(async () => c.put("index.html", "<p>coach v1</p>")); // the coach made it once
  // next send: Studio copies the prebuilt world, then takes the restore point
  c.put("index.html", "<p>prebuilt world</p>");
  noteHostWrite([{ absPath: path.join(c.dir, "index.html"), data: "<p>prebuilt world</p>" }], "studio");
  await c.coachTurn();
  eq(await labelOf(c, "index.html"), ["Studio가 고침", "AI가 고침 → Studio가 고침"], "world copy");
});

await t("1. without a host-write record the same copy reads 기록 없음 (the hook keeps the Studio label; never 내가 고침)", async () => {
  const c = await session({ "index.html": "<p>old world</p>" });
  await c.coachTurn(async () => c.put("index.html", "<p>coach v1</p>"));
  c.put("index.html", "<p>prebuilt world</p>");
  await c.coachTurn();
  eq((await labelOf(c, "index.html"))[0], "기록 없음", "without the hook");
});

await t("1. a world copy written inside the turn window keeps its Studio label (not overwritten by the turn diff)", async () => {
  const c = await session({ "index.html": "<p>old</p>" });
  await c.coachTurn(async () => { c.put("index.html", "<p>prebuilt</p>"); noteHostWrite([{ absPath: path.join(c.dir, "index.html"), data: "<p>prebuilt</p>" }], "studio"); });
  eq((await labelOf(c, "index.html"))[0], "Studio가 고침", "in-turn host write");
});

await t("2. an AI image-edit result saved by saveImageEditOutput reads AI가 만듦", async () => {
  const originalBytes = png();
  const c = await session({ "images/keyboard.png": originalBytes });
  const id = crypto.randomUUID(), output = png(1024, 1024), info = await inspectEditPng(output);
  const job = { schema: "hps-image-edit-result/1", id, state: "succeeded", original_sha256: await imageBytesHash(originalBytes), operation: "remove_background", transparent: true, cancel_requested: false, error_code: null, provider: { name: "openai", model: "synthetic-model", request_id: "p" }, cost: { request_id: "c", recording_state: "recorded", pricing: "unknown", amount: null }, semantic_preservation: "not_verified", output: { sha256: await imageBytesHash(output), ...info, expires_at: Date.now() + 10000 } };
  const saved = await saveImageEditOutput(c.dir, await prepareImageEditAsset(c.dir, "images/keyboard.png"), job, output);
  eq(await labelOf(c, saved.relativePath), ["AI가 만듦", ""], "edit output");
  eq((await labelOf(c, "images/keyboard.png"))[0], "기록 없음", "the original is untouched");
});

await t("2. learning wiki pages and the starter page go through the same hook", async () => {
  const c = await session();
  writeFiles(path.join(c.dir, "wiki"), { "index.md": "# proposal" }, "ai");
  writeFiles(path.join(c.dir, "wiki"), { "log.md": "# 기록" });
  prepareWorkspaceDirectory(c.dir, "html", () => "<p>starter</p>");
  eq([(await labelOf(c, "wiki/index.md"))[0], (await labelOf(c, "wiki/log.md"))[0], (await labelOf(c, "index.html"))[0]], ["AI가 만듦", "Studio가 만듦", "Studio가 만듦"], "labels");
});

await t("3. a reveal that lands after the post-turn scan still reads AI, in either queue order", async () => {
  for (const order of ["write-then-end", "end-then-write"]) {
    const c = await session({ "index.html": "<p>v0</p>" });
    await c.coachTurn(async () => {}, async () => {
      if (order === "write-then-end") { c.put("index.html", "<p>late</p>"); noteHostWrite([{ absPath: path.join(c.dir, "index.html"), data: "<p>late</p>" }], "ai"); }
    });
    if (order === "end-then-write") { c.put("index.html", "<p>late</p>"); noteHostWrite([{ absPath: path.join(c.dir, "index.html"), data: "<p>late</p>" }], "ai"); }
    eq((await labelOf(c, "index.html"))[0], "AI가 고침", order);
  }
});

await t("3. the host waits for pending reveals before its post-turn scan (wiring lock)", () => {
  const src = fs.readFileSync(new URL("../src/chatPanelProvider.ts", import.meta.url), "utf8");
  const wait = src.indexOf("Promise.allSettled(pendingReveals)"), end = src.indexOf("await this.endTurnRestore(turnRestorePoint, streamId, messageId, assistantText)");
  if (wait < 0 || end < 0 || wait > end) throw new Error("pending reveals are not awaited before endTurnRestore");
  if (!src.includes("pendingReveals.push(this.revealBuilt(")) throw new Error("tryReveal's write is not tracked");
  for (const [file, needle] of [["../src/imageEditAssets.ts", "noteHostWrite([{absPath:file,data:bytes}],'ai')"], ["../src/learningWiki.ts", "noteHostWrite("], ["../src/workspacePreparation.ts", "noteHostWrite("], ["../src/previewProvider.ts", "noteHostWrite("]]) {
    if (!fs.readFileSync(new URL(file, import.meta.url), "utf8").includes(needle)) throw new Error(`${file} has no host-write hook`);
  }
  if (/hasActiveStream\(\)\) return; \/\/ inside a turn window/.test(src)) throw new Error("host writes are still gated on hasActiveStream");
});

await t("4. a file skipped by a cap is not 'removed', and when it fits again it reads 기록 없음", async () => {
  const c = await session({ "big.bin": "x".repeat(10), "small.txt": "s" });
  await c.coachTurn(async () => c.put("big.bin", "y".repeat(10)));
  const caps = { limits: { fileMax: 50 } };
  c.put("big.bin", "z".repeat(80)); // too large for this scan
  let v = await c.rec.view(c.dir, await scanFolder(c.dir, caps));
  if (v.entries.some((e) => e.path === "big.bin")) throw new Error("an uncovered file is listed with a stale label");
  c.put("big.bin", "w".repeat(20)); // fits again
  c.save("small.txt", "S");         // the learner's own edit in the same window
  v = await c.rec.view(c.dir, await scanFolder(c.dir, caps));
  eq([label(v, "big.bin").label, provenanceHistoryText(label(v, "big.bin"))], ["기록 없음", "AI가 고침 → 기록 없음"], "big.bin");
  eq(label(v, "small.txt").label, "기록 없음", "small.txt");
});

await t("4. file_cap and total_cap skips are stale too", async () => {
  for (const limits of [{ filesMax: 1 }, { totalMax: 3 }]) {
    const c = await session({ "a.txt": "aa", "b.txt": "bb" });
    c.put("b.txt", "BB");
    await c.rec.view(c.dir, await scanFolder(c.dir, { limits })); // b.txt skipped
    c.put("b.txt", "B2");
    eq((await labelOf(c, "b.txt"))[0], "기록 없음", JSON.stringify(limits));
  }
});

await t("5. a change only a scan sees reads 기록 없음, in a session or across one, the learner's own save included", async () => {
  const c = await session({ "a.txt": "1", "b.txt": "1" });
  c.put("a.txt", "2"); // seen between two scans of this session, but nobody reported it
  eq((await labelOf(c, "a.txt"))[0], "기록 없음", "scan-only change");
  c.save("a.txt", "3");
  eq((await labelOf(c, "a.txt"))[0], "기록 없음", "editor save (no learner label in this slice)");
  // Studio closes; git checkout / another editor changes files; Studio starts again
  c.put("a.txt", "4"); c.put("b.txt", "git");
  const next = new ArtifactProvenanceRecorder(base);
  const v = await next.view(c.dir, await scanFolder(c.dir));
  eq([label(v, "a.txt").label, label(v, "b.txt").label], ["기록 없음", "기록 없음"], "first scan of a new session");
});
await t("6. the list scan reuses hashes of files whose size, mtime and inode did not change", async () => {
  const c = await session({ "a.txt": "aaaa", "b.txt": "bbbb" });
  const cache = c.rec.scanCache(c.dir);
  const pinned = new Date(1_700_000_000_000); // whole seconds, so utimes can put it back exactly
  fs.utimesSync(path.join(c.dir, "a.txt"), pinned, pinned);
  const first = await scanFolder(c.dir, { cache });
  eq(first.files, (await scanFolder(c.dir)).files, "same result as an uncached scan");
  // same size, mtime put back: proves the cached hash is used (the file is not read again)
  fs.writeFileSync(path.join(c.dir, "a.txt"), "AAAA");
  fs.utimesSync(path.join(c.dir, "a.txt"), pinned, pinned);
  const reused = await scanFolder(c.dir, { cache });
  eq(reused.files.find((f) => f.path === "a.txt").sha256, first.files.find((f) => f.path === "a.txt").sha256, "cache hit");
  c.put("b.txt", "bbbbb"); // size changed: hashed again
  const fresh = await scanFolder(c.dir, { cache });
  eq(fresh.files.find((f) => f.path === "b.txt").sha256, (await scanFolder(c.dir)).files.find((f) => f.path === "b.txt").sha256, "rehash on change");
  fs.rmSync(path.join(c.dir, "b.txt"));
  await scanFolder(c.dir, { cache });
  eq([...cache.keys()], ["a.txt"], "gone files leave the cache");
});

console.log("artifact provenance — verify round 2: unmeasured windows, environments, GitHub pulls");

await t("F1. a folder over the entry cap: an AI rewrite after a learner edit confirms no label", async () => {
  const c = await session({ "index.html": "v0", "z.txt": "z" });
  c.save("index.html", "learner v1");
  eq((await labelOf(c, "index.html"))[0], "기록 없음", "learner save");
  await c.rec.unobserved(c.dir); // the next turn's restore point was incomplete
  c.put("index.html", "AI rewrote it");
  const partial = await scanFolder(c.dir, { limits: { entriesMax: 1 } });
  eq(partial.complete, false, "scan stopped at the cap");
  const v = await c.rec.view(c.dir, partial);
  eq([v.unconfirmed, label(v, "index.html").label, label(v, "z.txt").label], [true, "기록 없음", "기록 없음"], "nothing confirmed");
  if (v.entries.some((e) => e.kind !== "none")) throw new Error("a confident label over unmeasured bytes");
});

await t("F1. the other direction: AI가 만듦 then a learner edit in an unmeasured window reads 기록 없음", async () => {
  const c = await session();
  await c.coachTurn(async () => c.put("a.html", "ai"));
  eq((await labelOf(c, "a.html"))[0], "AI가 만듦", "measured");
  c.save("a.html", "learner");
  c.put("a.html", "someone else after");
  const v = await c.rec.view(c.dir, await scanFolder(c.dir, { limits: { entriesMax: 0 } }));
  eq([v.unconfirmed, label(v, "a.html").label, provenanceHistoryText(label(v, "a.html"))], [true, "기록 없음", "AI가 만듦 → 기록 없음"], "a.html");
});

await t("F1. a read-only list over a stale ledger shows 기록 없음; a later complete scan confirms again", async () => {
  const c = await session({ "keep.txt": "k" });
  await c.coachTurn(async () => { c.put("a.html", "ai"); });
  await c.rec.unobserved(c.dir);
  const ro = await c.rec.view(c.dir); // no scan: a turn was running
  eq([ro.unconfirmed, label(ro, "a.html").label], [true, "기록 없음"], "read-only");
  c.put("keep.txt", "changed unseen");
  const v = await c.list(); // the folder fits again: a complete observation
  eq([v.unconfirmed, label(v, "a.html").label, label(v, "keep.txt").label], [false, "AI가 만듦", "기록 없음"], "confirmed again (unchanged bytes keep their label, unseen changes stay 기록 없음)");
});

await t("F1. Python environments and caches are skipped, so a .venv does not push the folder past the cap", async () => {
  for (const d of [".venv", "venv", "__pycache__", ".pytest_cache", ".mypy_cache", ".tox"]) if (!TURN_RESTORE_SKIP_DIRS.includes(d)) throw new Error(`${d} not skipped`);
  const c = await session({ "analysis.py": "print(1)" });
  for (let i = 0; i < 30; i++) c.put(`.venv/lib/site-packages/pkg${i}.py`, String(i));
  for (let i = 0; i < 5; i++) c.put(`__pycache__/m${i}.pyc`, String(i));
  const scan = await scanFolder(c.dir, { limits: { entriesMax: 10 } });
  eq([scan.complete, scan.files.map((f) => f.path)], [true, ["analysis.py"]], "only the work is scanned");
  // negative control: the same tree under a name that is not skipped does pass the cap
  c.put("vendor/a.txt", "a"); for (let i = 0; i < 12; i++) c.put(`vendor/p${i}.txt`, String(i));
  eq((await scanFolder(c.dir, { limits: { entriesMax: 10 } })).complete, false, "vendor counts");
});

await t("F2. a GitHub pull or clone into the open folder: its files read 기록 없음, never 내가 고침", async () => {
  const c = await session({ "index.html": "mine", "style.css": "a" });
  await c.coachTurn(async () => c.put("style.css", "ai"));
  // GitHub에서 이어하기 pulls a teammate's commit into the same folder; the window does not reload
  c.put("index.html", "teammate on github"); c.put("new.js", "from github");
  noteFolderReplaced(c.dir);
  const v = await c.list();
  eq([label(v, "index.html").label, label(v, "new.js").label, label(v, "style.css").label], ["기록 없음", "기록 없음", "AI가 고침"], "after the pull");
  if (v.entries.some((e) => e.kind === "learner_changed")) throw new Error("pulled bytes read as the learner's");
});

await t("F2. without the hook the same pull still reads 기록 없음 (a scan never claims 내가 고침)", async () => {
  const c = await session({ "index.html": "mine" });
  c.put("index.html", "teammate on github");
  eq((await labelOf(c, "index.html"))[0], "기록 없음", "unhooked");
});

console.log("artifact provenance — verify round 3: writes after the end scan and races around the list scan");

await t("N1. a background child writing after the end scan reads 기록 없음, with no mark of any kind", async () => {
  const c = await session({ "index.html": "v0", "style.css": "a{}" });
  await c.coachTurn(async () => c.put("index.html", "AI v1"));
  eq((await labelOf(c, "index.html"))[0], "AI가 고침", "the turn's own change stays AI");
  c.put("style.css", "a{color:red} /* tailwind --watch, after the turn */");
  eq((await labelOf(c, "style.css"))[0], "기록 없음", "late child write");
  for (let i = 0; i < 3; i++) await c.list();
  c.put("server.log", "GET / 200"); c.put("style.css", "a{color:blue}");
  const v = await c.list();
  eq([label(v, "style.css").label, label(v, "server.log").label], ["기록 없음", "기록 없음"], "still not the learner's");
  c.save("style.css", "a{color:green}");
  eq((await labelOf(c, "style.css"))[0], "기록 없음", "the learner's own save reads the same in this slice");
});

await t("N1. a stopped turn's leftover write reads 기록 없음, and so does a later learner save", async () => {
  const c = await session({ "index.html": "v0" });
  await c.coachTurn(async () => c.put("index.html", "AI partial"));
  c.put("index.html", "AI's Write landing after the stop");
  eq((await labelOf(c, "index.html"))[0], "기록 없음", "leftover write");
  c.save("index.html", "learner fixes it");
  eq((await labelOf(c, "index.html"))[0], "기록 없음", "learner save");
});

await t("an external process writing into the folder (echo > file) reads 기록 없음", async () => {
  const { execFileSync } = await import("node:child_process");
  const c = await session({ "notes.txt": "mine" });
  c.save("notes.txt", "mine, saved");
  execFileSync("/bin/sh", ["-c", "echo outside > notes.txt && echo new > made.txt"], { cwd: c.dir });
  const v = await c.list();
  eq([label(v, "notes.txt").label, provenanceHistoryText(label(v, "notes.txt")), label(v, "made.txt").label], ["기록 없음", "", "기록 없음"], "external writes");
});

await t("documented limit: a learner's edit inside a coach turn's window counts as the turn's (AI), never as the learner's", async () => {
  const c = await session({ "a.txt": "0" });
  await c.coachTurn(async () => { c.put("a.txt", "AI"); c.save("a.txt", "learner during the turn"); });
  eq((await labelOf(c, "a.txt"))[0], "AI가 고침", "turn window");
});
await t("NEW-A. ▶ run landing during the turn-end scan never reads 내가 고침", async () => {
  const c = await session({ "index.html": "v0" });
  await c.coachTurn(async () => c.put("index.html", "AI v1"), async () => {
    c.put("index.html", "run page"); noteHostWrite([{ absPath: path.join(c.dir, "index.html"), data: "run page" }], "studio");
  });
  for (let i = 0; i < 2; i++) if ((await labelOf(c, "index.html"))[0] === "내가 고침") throw new Error("false 내가 고침");
});

await t("NEW2. a Studio write during the restore-point scan, then 되돌리기: never 내가 고침", async () => {
  const c = await session({ "index.html": "v0" });
  await c.coachTurn(async () => c.put("index.html", "AI v1"));
  const store = turnRestoreStoreDir(base, c.dir, "new2");
  const point = (await takeRestorePoint({ store, root: c.dir, id: "p2", turnId: "p2", kind: "turn" })).point;
  c.put("index.html", "studio save"); noteHostWrite([{ absPath: path.join(c.dir, "index.html"), data: "studio save" }], "studio");
  await c.rec.turnStart(c.dir, point);
  c.put("index.html", "AI v2");
  let now = await scanFolder(c.dir);
  await c.rec.turnEnd(c.dir, point, diffRestorePoint(point, now), now);
  const { restoreToPoint } = await import("../src/turnRestore.ts");
  const out = await restoreToPoint({ store, root: c.dir, point, beforeRestoreId: "p2-before" });
  now = await scanFolder(c.dir);
  await c.rec.reverted(c.dir, point, now);
  eq(fs.readFileSync(path.join(c.dir, "index.html"), "utf8"), "AI v1", `restored (${out.ok})`);
  for (let i = 0; i < 2; i++) if ((await labelOf(c, "index.html"))[0] === "내가 고침") throw new Error("false 내가 고침 after the revert");
});

await t("NEW3. a background child surviving a restart never reads 내가 고침", async () => {
  const c = await session({ "server.log": "start" });
  const next = new ArtifactProvenanceRecorder(base); // Studio restarted
  await next.view(c.dir, await scanFolder(c.dir)); await next.view(c.dir, await scanFolder(c.dir));
  c.put("server.log", "GET / 200");
  eq(label(await next.view(c.dir, await scanFolder(c.dir)), "server.log").label, "기록 없음", "child write");
});

await t("N2. a Studio write that lands during a list scan keeps its Studio label (the old-bytes scan is not applied)", async () => {
  const c = await session({ "index.html": "v0" });
  const g = c.rec.generation();
  const old = await scanFolder(c.dir); // the list scan has read the old bytes
  c.put("index.html", "STUDIO append_artifact bytes");
  noteHostWrite([{ absPath: path.join(c.dir, "index.html"), data: "STUDIO append_artifact bytes" }], "studio");
  eq(label(await c.rec.view(c.dir, old, g), "index.html").label, "Studio가 고침", "this list");
  eq((await labelOf(c, "index.html"))[0], "Studio가 고침", "next list");
});

await t("N2. without the generation check the Studio label is lost to 기록 없음 (never 내가 고침)", async () => {
  const c = await session({ "index.html": "v0" });
  const old = await scanFolder(c.dir);
  c.put("index.html", "STUDIO bytes");
  noteHostWrite([{ absPath: path.join(c.dir, "index.html"), data: "STUDIO bytes" }], "studio");
  eq(label(await c.rec.view(c.dir, old), "index.html").label, "기록 없음", "unguarded");
});

await t("N3. a GitHub pull overlapping a list scan never reads 내가 고침, whichever starts first", async () => {
  for (const order of ["scan-first", "pull-first"]) {
    const c = await session({ "index.html": "mine", "about.html": "mine too" });
    let g;
    if (order === "scan-first") g = c.rec.generation();
    noteFolderReplaced(c.dir); // publishHost: before the copy
    if (order === "pull-first") g = c.rec.generation();
    c.put("index.html", "GITHUB teammate bytes"); // pullInto, first file
    const mid = await scanFolder(c.dir);
    const shown = c.rec.view(c.dir, mid, g);
    c.put("about.html", "GITHUB teammate bytes 2");
    noteFolderReplaced(c.dir); // publishHost: after the copy
    const v = await shown;
    if (v.entries.some((e) => e.kind === "learner_changed")) throw new Error(`${order}: pulled bytes read as the learner's`);
    for (let i = 0; i < 2; i++) {
      const next = await c.list();
      eq([label(next, "index.html").label, label(next, "about.html").label], ["기록 없음", "기록 없음"], `${order}, list ${i + 1}`);
    }
  }
});

await t("N3. marked only after the pull, an overlapping scan still reads 기록 없음", async () => {
  const c = await session({ "index.html": "mine" });
  c.put("index.html", "GITHUB teammate bytes");
  const shown = await c.list(); // the scan ran during the copy, before any mark
  noteFolderReplaced(c.dir);
  await c.list();
  eq([label(shown, "index.html").label, (await labelOf(c, "index.html"))[0]], ["기록 없음", "기록 없음"], "after-only");
});

await t("N4. a whole turn inside one list scan: the AI's bytes stay AI", async () => {
  const c = await session({ "index.html": "v0" });
  const g = c.rec.generation();
  const old = await scanFolder(c.dir);
  await c.coachTurn(async () => c.put("index.html", "AI v1"));
  eq(label(await c.rec.view(c.dir, old, g), "index.html").label, "AI가 고침", "this list");
  eq((await labelOf(c, "index.html"))[0], "AI가 고침", "next list");
});

await t("N4. without the guard the AI label is lost to 기록 없음 (never 내가 고침)", async () => {
  const c = await session({ "index.html": "v0" });
  const old = await scanFolder(c.dir);
  await c.coachTurn(async () => c.put("index.html", "AI v1"));
  eq(label(await c.rec.view(c.dir, old), "index.html").label, "기록 없음", "unguarded");
});

await t("generation: every recording call moves it, a read-only view does not", async () => {
  const c = await session({ "a.txt": "a" });
  const steps = [
    () => c.rec.hostWrote(c.dir, [{ absPath: path.join(c.dir, "a.txt"), data: "a" }], "studio"),
    () => c.rec.folderReplaced(c.dir), () => c.rec.unobserved(c.dir),
  ];
  for (const step of steps) { const g = c.rec.generation(); void step(); if (c.rec.generation() === g) throw new Error(`${step} did not move the generation`); }
  const point = (await takeRestorePoint({ store: turnRestoreStoreDir(base, c.dir, "gen"), root: c.dir, id: "g1", turnId: "g1", kind: "turn" })).point;
  let g0 = c.rec.generation(); void c.rec.turnStart(c.dir, point); if (c.rec.generation() === g0) throw new Error("turnStart did not move the generation");
  const now = await scanFolder(c.dir);
  g0 = c.rec.generation(); await c.rec.turnEnd(c.dir, point, diffRestorePoint(point, now), now); if (c.rec.generation() === g0) throw new Error("turnEnd did not move the generation");
  g0 = c.rec.generation(); await c.rec.reverted(c.dir, point, now); if (c.rec.generation() === g0) throw new Error("reverted did not move the generation");
  const g = c.rec.generation();
  await c.rec.view(c.dir);
  eq(c.rec.generation(), g, "read-only view");
});

console.log("artifact provenance — round 6: no code path can produce a learner-change label");

await t("lock: the label table, the event kinds and the host-write actors have no learner-change entry", () => {
  for (const file of ["../src/artifactProvenance.ts", "../src/artifactProvenanceView.ts", "../src/chatPanelProvider.ts", "../webview-ui/src/ArtifactProvenanceList.tsx", "../webview-ui/src/TaskWorkspace.tsx"]) {
    const src = fs.readFileSync(new URL(file, import.meta.url), "utf8");
    for (const banned of ["내가 고침", "learner_changed", "learner_save", "LearnerEditTracker", "onDidSaveTextDocument", "onWillSaveTextDocument"]) {
      if (src.includes(banned)) throw new Error(`${file} still contains ${banned}`);
    }
  }
  if (Object.values(PROVENANCE_LABELS).some((x) => x.label === "내가 고침")) throw new Error("a 내가 고침 label exists");
});

await t("behavior lock: a ledger file carrying a learner-change event is not trusted (it reads as damaged and stale)", async () => {
  const file = provenanceLedgerFile(base, path.join(tmp, "legacy"));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ version: 1, baseline: { "a.txt": h("a") }, stale: false, events: [{ path: "a.txt", kind: "learner_changed", at: 1, sha256: h("a") }] }));
  const l = await loadLedger(file);
  eq([l.stale, l.events.length], [true, 0], "rejected");
});

await t("replay of the shipped app's real editor-event logs: only AI/Studio/올림/기록 없음 appear; the AI label holds while the AI's bytes stay", async () => {
  const dir = new URL("./fixtures/artifact-provenance/", import.meta.url);
  let cases = 0;
  for (const name of ["vscode-events-1.jsonl", "vscode-events-2.jsonl"]) {
    const groups = [];
    for (const o of fs.readFileSync(new URL(name, dir), "utf8").trim().split("\n").map((x) => JSON.parse(x))) {
      if (o.case) groups.push({ name: o.case, events: [] }); else groups.at(-1)?.events.push(o);
    }
    for (const g of groups) {
      cases++;
      const c = await session();
      const aiBytes = new Map();
      for (const o of g.events) {
        if (!o.f || o.scheme !== "file") continue;
        if (!aiBytes.has(o.f)) {
          // The AI wrote the file in a coach turn before the editor events (its first known text).
          const initial = o.text ?? "<p>AI page</p>";
          await c.coachTurn(async () => c.put(o.f, initial));
          aiBytes.set(o.f, initial);
          eq((await labelOf(c, o.f))[0], "AI가 만듦", `${g.name}: the AI's file`);
        }
        if (o.ev === "didSave") c.put(o.f, o.text); // the save writes the editor's text; nothing else is recorded
      }
      const v = await c.list(); // throws on any label outside the slice
      for (const [f, bytes] of aiBytes) {
        const e = label(v, f);
        const want = fs.readFileSync(path.join(c.dir, f), "utf8") === bytes ? "AI가 만듦" : "기록 없음";
        eq(e.label, want, `${g.name}: ${f}`);
      }
    }
  }
  if (cases < 10) throw new Error(`only ${cases} cases replayed`);
});

await t("hooked AI, Studio and upload writes still label correctly around the learner's edits", async () => {
  const c = await session({ "index.html": "v0" });
  await c.coachTurn(async () => c.put("index.html", "AI v1"));
  c.save("index.html", "learner pasted a block");
  eq((await labelOf(c, "index.html"))[0], "기록 없음", "the learner's edit");
  c.put("index.html", "run page"); noteHostWrite([{ absPath: path.join(c.dir, "index.html"), data: "run page" }], "studio");
  eq(await labelOf(c, "index.html"), ["Studio가 고침", "AI가 고침 → 기록 없음 → Studio가 고침"], "Studio write");
  await c.coachTurn(async () => c.put("index.html", "AI v2"));
  eq((await labelOf(c, "index.html"))[0], "AI가 고침", "AI write");
  c.put("images/p.png", "photo"); noteHostWrite([{ absPath: path.join(c.dir, "images", "p.png"), data: "photo" }], "learner_upload");
  eq((await labelOf(c, "images/p.png"))[0], "내가 올림", "upload through Studio");
});

setHostWriteSink(null);

fs.rmSync(tmp, { recursive: true, force: true });
if (fail) { console.error(`${fail} failed`); process.exit(1); }
console.log("all passed");
