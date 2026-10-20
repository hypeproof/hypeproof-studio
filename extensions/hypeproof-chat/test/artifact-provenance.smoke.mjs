// REQ-STUDIO-ARTIFACT-PROVENANCE (CGP-KNOW-R-012) — provenance labels from recorded events only.
// Planted answers: synthetic restore manifests and events with a known label per file, then a
// real temp folder driven through the per-turn restore points (turnRestore.ts) and the host
// recorder. Negative controls: an unmeasured window, a damaged ledger, a coach "change" the scan
// does not show, and a revert, none of which may produce an AI or learner label.
// Run: node --experimental-strip-types test/artifact-provenance.smoke.mjs

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  ArtifactProvenanceRecorder, PROVENANCE_EVENT_CAP, PROVENANCE_LABELS, PROVENANCE_VIEW_CAP, emptyLedger, loadLedger, markUnobserved,
  observeOutsideTurn, provenanceHistoryText, provenanceLedgerFile, provenanceView, recordCoachTurn, recordRevert,
} from "../src/artifactProvenance.ts";
import { diffRestorePoint, scanFolder, takeRestorePoint, turnRestoreStoreDir } from "../src/turnRestore.ts";

let fail = 0;
const t = async (label, fn) => {
  try { await fn(); console.log(`  ok   ${label}`); } catch (e) { console.error(`  FAIL ${label}: ${e?.stack ?? e}`); fail++; }
};
const eq = (a, b, what) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${what}: got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`); };
const h = (c) => c.repeat(64);
const files = (o) => Object.entries(o).map(([p, c]) => ({ path: p, sha256: h(c) }));
const label = (view, p) => { const e = view.entries.find((x) => x.path === p); if (!e) throw new Error(`no entry for ${p}`); return e; };
const turn = (turnId, at, d) => ({ turnId, at, added: d.added ?? [], changed: d.changed ?? [], deleted: d.deleted ?? [] });

console.log("artifact provenance — pure ledger");

await t("first observation: what was already there reads 기록 없음, with no history", () => {
  const v = provenanceView(observeOutsideTurn(emptyLedger(), files({ "old.txt": "a" }), { at: 1 }));
  eq(v.unobserved, false, "unobserved");
  eq([label(v, "old.txt").kind, label(v, "old.txt").label, label(v, "old.txt").history], ["none", "기록 없음", []], "old.txt");
});

await t("nothing observed yet: no entries, unobserved", () => {
  eq(provenanceView(emptyLedger()), { entries: [], more: 0, unobserved: true }, "view");
});

await t("each label from its own recorded event", () => {
  let l = observeOutsideTurn(emptyLedger(), files({ "keep.txt": "k", "edit.txt": "e" }), { at: 1 });
  // turn 1 starts with a photo the host committed from the learner's attachment
  l = observeOutsideTurn(l, files({ "keep.txt": "k", "edit.txt": "e", "images/외관.jpg": "p" }), { at: 2, uploaded: ["images/외관.jpg"] });
  l = recordCoachTurn(l, turn("t1", 3, { added: ["index.html"], changed: ["edit.txt"] }), files({ "keep.txt": "k", "edit.txt": "E", "images/외관.jpg": "p", "index.html": "i" }));
  // between turns the learner changes keep.txt
  l = observeOutsideTurn(l, files({ "keep.txt": "K", "edit.txt": "E", "images/외관.jpg": "p", "index.html": "i" }), { at: 4 });
  const v = provenanceView(l);
  eq(label(v, "index.html").label, "AI가 만듦", "index.html");
  eq(label(v, "edit.txt").label, "AI가 고침", "edit.txt");
  eq(label(v, "images/외관.jpg").label, "내가 올림", "photo");
  eq(label(v, "keep.txt").label, "내가 고침", "keep.txt");
  eq(v.entries.map((e) => e.path), ["keep.txt", "edit.txt", "index.html", "images/외관.jpg"], "newest event first, ties by path");
});

await t("a file touched by both shows the latest event with its history, oldest first", () => {
  let l = observeOutsideTurn(emptyLedger(), [], { at: 1 });
  l = recordCoachTurn(l, turn("t1", 2, { added: ["a.html"] }), files({ "a.html": "1" }));
  l = observeOutsideTurn(l, files({ "a.html": "2" }), { at: 3 });
  const e = label(provenanceView(l), "a.html");
  eq([e.label, e.history, provenanceHistoryText(e)], ["내가 고침", ["AI가 만듦", "내가 고침"], "AI가 만듦 → 내가 고침"], "a.html");
  // and back: the coach changes it again
  l = recordCoachTurn(observeOutsideTurn(l, files({ "a.html": "2" }), { at: 4 }), turn("t2", 5, { changed: ["a.html"] }), files({ "a.html": "3" }));
  const e2 = label(provenanceView(l), "a.html");
  eq([e2.label, provenanceHistoryText(e2)], ["AI가 고침", "AI가 만듦 → 내가 고침 → AI가 고침"], "a.html again");
});

await t("repeats fold, the history keeps the last four steps, one step has no history text", () => {
  let l = observeOutsideTurn(emptyLedger(), [], { at: 1 });
  l = recordCoachTurn(l, turn("t1", 2, { added: ["x"] }), files({ x: "1" }));
  eq(provenanceHistoryText(label(provenanceView(l), "x")), "", "single step");
  l = recordCoachTurn(observeOutsideTurn(l, files({ x: "1" }), { at: 3 }), turn("t2", 4, { changed: ["x"] }), files({ x: "2" }));
  l = recordCoachTurn(observeOutsideTurn(l, files({ x: "2" }), { at: 5 }), turn("t3", 6, { changed: ["x"] }), files({ x: "3" }));
  eq(label(provenanceView(l), "x").history, ["AI가 만듦", "AI가 고침"], "folded");
  for (let i = 0; i < 3; i++) {
    l = observeOutsideTurn(l, files({ x: `l${i}` }), { at: 10 + i * 2 });
    l = recordCoachTurn(observeOutsideTurn(l, files({ x: `l${i}` }), { at: 11 + i * 2 }), turn(`u${i}`, 11.5 + i * 2, { changed: ["x"] }), files({ x: `a${i}` }));
  }
  eq(label(provenanceView(l), "x").history, ["내가 고침", "AI가 고침", "내가 고침", "AI가 고침"], "last four");
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
  // the window after it is measured again
  l = observeOutsideTurn(l, files({ "a.html": "3", "new.txt": "n" }), { at: 4 });
  eq(label(provenanceView(l), "a.html").label, "내가 고침", "measured again");
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
  const e = label(provenanceView(l), "a.html");
  eq([e.label, e.history], ["내가 고침", ["내가 고침"]], "re-created");
});

await t("revert: events after the restore point go, the restored file reads as before the turn", () => {
  let l = observeOutsideTurn(emptyLedger(), [], { at: 1 });
  l = recordCoachTurn(l, turn("t1", 2, { added: ["a.html"] }), files({ "a.html": "1" }));
  const pointFiles = files({ "a.html": "1", "images/p.jpg": "p" });
  l = observeOutsideTurn(l, pointFiles, { at: 10, uploaded: ["images/p.jpg"] }); // turn 2 start = point time
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
  const shown = ["ai_created", "ai_changed", "learner_uploaded", "learner_changed", "none"].map((k) => PROVENANCE_LABELS[k]);
  eq(shown.map((x) => x.label), ["AI가 만듦", "AI가 고침", "내가 올림", "내가 고침", "기록 없음"], "labels");
  eq(new Set(shown.map((x) => x.symbol)).size, 5, "distinct symbols");
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
  rec.noteUploaded(["images/외관.jpg"]);
  const p1 = (await takeRestorePoint({ store, root, id: "s1", turnId: "s1", kind: "turn", now: 1000 })).point;
  await rec.turnStart(root, p1);
  write("index.html", "<h1>v1</h1>");
  let now = await scanFolder(root);
  await rec.turnEnd(root, p1, diffRestorePoint(p1, now), now.files);

  // between turns the learner edits index.html
  write("index.html", "<h1>v1 mine</h1>");
  // turn 2: the coach changes notes.md
  const p2 = (await takeRestorePoint({ store, root, id: "s2", turnId: "s2", kind: "turn", now: 2000 })).point;
  await rec.turnStart(root, p2);
  write("notes.md", "coach rewrote");
  now = await scanFolder(root);
  await rec.turnEnd(root, p2, diffRestorePoint(p2, now), now.files);

  v = await rec.view(root, (await scanFolder(root)).files);
  const got = Object.fromEntries(v.entries.map((e) => [e.path, [e.label, provenanceHistoryText(e)]]));
  eq(got, {
    "notes.md": ["AI가 고침", ""],
    "index.html": ["내가 고침", "AI가 만듦 → 내가 고침"],
    "images/외관.jpg": ["내가 올림", ""],
  }, "labels");

  // Studio itself writes outside a turn (a preview save): never 내가 고침
  await rec.unobserved(root);
  write("index.html", "<h1>studio saved</h1>");
  v = await rec.view(root, (await scanFolder(root)).files);
  eq([label(v, "index.html").label, provenanceHistoryText(label(v, "index.html"))], ["기록 없음", "AI가 만듦 → 내가 고침 → 기록 없음"], "host write");
  if (fs.readdirSync(root).some((n) => n.includes("provenance"))) throw new Error("ledger leaked into the work folder");
});

await t("view without a scan only reads; without any observation it is unobserved", async () => {
  const rec = new ArtifactProvenanceRecorder(base);
  const fresh = fs.realpathSync(fs.mkdtempSync(path.join(tmp, "fresh-")));
  fs.writeFileSync(path.join(fresh, "a.txt"), "a");
  eq((await rec.view(fresh)).unobserved, true, "read only");
  eq((await rec.view(fresh, (await scanFolder(fresh)).files)).entries.map((e) => e.label), ["기록 없음"], "observed");
});

fs.rmSync(tmp, { recursive: true, force: true });
if (fail) { console.error(`${fail} failed`); process.exit(1); }
console.log("all passed");
