// REQ-STUDIO-PAGE-CARD / CGP-ART-R-010 — the card under a coach turn that built or changed a page:
// which rows it lists (pure + real folder), and the host's refusal of anything outside the work folder.
// Each positive case has a negative control beside it (verification.md §2).

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { isPagePath, pageCardRows, PAGE_CARD_COPY, PAGE_CARD_MAX_ROWS } from "../src/pageCard.ts";
import { buildPageCard, handlePageCardAction, pageCardSeam, PageCardRegistry, readPageInFolder, recheckPageInFolder, resolvePageInFolder } from "../src/pageCardHost.ts";

let fail = 0;
const t = async (label, fn) => { try { await fn(); console.log(`  ok   ${label}`); } catch (e) { console.error(`  FAIL ${label}: ${e.message}`); fail++; } };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "hps-page-card-"));
const root = path.join(tmp, "work");
const outside = path.join(tmp, "outside");
fs.mkdirSync(path.join(root, "game"), { recursive: true });
fs.mkdirSync(outside, { recursive: true });
fs.writeFileSync(path.join(root, "index.html"), "<!doctype html><title>a</title>");
fs.writeFileSync(path.join(root, "game", "level.HTM"), "<html></html>");
fs.writeFileSync(path.join(root, "style.css"), "body{}");
fs.writeFileSync(path.join(outside, "secret.html"), "<html>secret</html>");
fs.symlinkSync(path.join(outside, "secret.html"), path.join(root, "escape.html"));
fs.symlinkSync(outside, path.join(root, "linked"));
for (const n of ["a", "b", "c", "d"]) fs.writeFileSync(path.join(root, `${n}.html`), "<html></html>");

const card = (changes) => buildPageCard({ root, turnId: "turn-1", anchorId: "msg-1", changes });

await t("isPagePath: .html/.htm only, relative, no hidden segment, no climb", () => {
  assert.equal(isPagePath("index.html"), true);
  assert.equal(isPagePath("game/level.HTM"), true);
  for (const bad of ["style.css", "notes.md", "html", ".hypeproof/history/index.html", "../x.html", "/abs/x.html", "a\\b.html", "C:/x.html", ""]) {
    assert.equal(isPagePath(bad), false, bad);
  }
});

await t("a page change gives a card with the right rows (added first, then changed)", () => {
  const view = card({ added: ["game/level.HTM"], changed: ["index.html", "style.css"], deleted: [] });
  assert.ok(view);
  assert.equal(view.turnId, "turn-1");
  assert.equal(view.anchorId, "msg-1");
  assert.deepEqual(view.pages, [{ path: "game/level.HTM", kind: "added" }, { path: "index.html", kind: "changed" }]);
});

await t("negative control: a non-HTML change gives no card", () => {
  assert.equal(card({ added: ["notes.md"], changed: ["style.css"], deleted: [] }), null);
});
await t("negative control: a deleted page is not a row (nothing to open)", () => {
  assert.equal(card({ added: [], changed: [], deleted: ["old.html"] }), null);
});
await t("negative control: a listed page that no longer exists is not a row", () => {
  assert.equal(card({ added: ["gone.html"], changed: [], deleted: [] }), null);
});

await t("a symlink escaping the folder gives no row (file link and directory link)", () => {
  const view = card({ added: ["escape.html", "linked/secret.html", "index.html"], changed: [], deleted: [] });
  assert.deepEqual(view.pages.map((p) => p.path), ["index.html"]);
  assert.equal(card({ added: ["escape.html", "linked/secret.html"], changed: [], deleted: [] }), null);
});

await t("up to 3 rows plus 외 N개", () => {
  const view = card({ added: ["a.html", "b.html", "c.html", "d.html", "index.html"], changed: [], deleted: [] });
  const { rows, more } = pageCardRows(view);
  assert.equal(PAGE_CARD_MAX_ROWS, 3);
  assert.deepEqual(rows.map((r) => r.path), ["a.html", "b.html", "c.html"]);
  assert.equal(more, 2);
  assert.equal(PAGE_CARD_COPY.more(more), "외 2개");
  const few = pageCardRows(card({ added: ["a.html"], changed: [], deleted: [] }));
  assert.equal(few.more, 0);
});

await t("resolvePageInFolder: positive control and each refusal", () => {
  const ok = resolvePageInFolder(root, "game/level.HTM");
  assert.equal(ok.ok, true);
  assert.equal(ok.abs, path.join(fs.realpathSync(root), "game", "level.HTM"));
  assert.equal(resolvePageInFolder(root, "../outside/secret.html").ok, false);
  assert.equal(resolvePageInFolder(root, path.join(outside, "secret.html")).ok, false);
  assert.equal(resolvePageInFolder(root, "escape.html").cause, "link");
  assert.equal(resolvePageInFolder(root, "linked/secret.html").cause, "link");
  assert.equal(resolvePageInFolder(root, "style.css").cause, "not-page");
  assert.equal(resolvePageInFolder(root, "missing.html").cause, "missing");
  assert.equal(resolvePageInFolder(path.join(tmp, "nope"), "index.html").ok, false);
});

// Host handler: the action reaches open/reveal only for a row of a card the host issued, inside its folder.
const registry = new PageCardRegistry();
registry.add("task-a", root, card({ added: ["index.html", "game/level.HTM"], changed: [], deleted: [] }));
const calls = [];
const deps = { open: (abs, text) => calls.push(["open", abs, text]), reveal: (abs) => calls.push(["reveal", abs]) };
const act = async (msg, taskKey = "task-a") => handlePageCardAction(registry, taskKey, msg, deps);

await t("열기 and 폴더에서 보기 reach the right host action with the real path", async () => {
  calls.length = 0;
  assert.equal((await act({ type: "pageCardOpen", turnId: "turn-1", path: "index.html" })).ok, true);
  assert.equal((await act({ type: "pageCardReveal", turnId: "turn-1", path: "game/level.HTM" })).ok, true);
  const real = fs.realpathSync(root);
  assert.deepEqual(calls, [["open", path.join(real, "index.html"), "<!doctype html><title>a</title>"], ["reveal", path.join(real, "game", "level.HTM")]]);
});

await t("the host handler refuses a path outside the folder (and a path not on the card)", async () => {
  calls.length = 0;
  for (const p of ["../outside/secret.html", path.join(outside, "secret.html"), "escape.html", "a.html"]) {
    const out = await act({ type: "pageCardOpen", turnId: "turn-1", path: p });
    assert.equal(out.ok, false, p);
    assert.equal((await act({ type: "pageCardReveal", turnId: "turn-1", path: p })).ok, false, p);
  }
  // A card row the host issued, later swapped for a link out of the folder: refused at click time.
  const swap = path.join(root, "game", "level.HTM");
  fs.rmSync(swap);
  fs.symlinkSync(path.join(outside, "secret.html"), swap);
  const out = await act({ type: "pageCardOpen", turnId: "turn-1", path: "game/level.HTM" });
  assert.equal(out.ok, false);
  assert.equal(out.notice, PAGE_CARD_COPY.refused);
  assert.equal(registry.get("task-a", "turn-1").notice, PAGE_CARD_COPY.refused);
  assert.deepEqual(calls, []);
});

await t("a card belongs to its task; an unknown turn is ignored", async () => {
  calls.length = 0;
  assert.equal((await act({ type: "pageCardOpen", turnId: "turn-1", path: "index.html" }, "task-b")).ok, false);
  assert.equal((await act({ type: "pageCardOpen", turnId: "turn-9", path: "index.html" })).ok, false);
  assert.deepEqual(calls, []);
  assert.deepEqual(registry.forTask("task-b"), []);
  assert.equal(registry.forTask("task-a").length, 1);
});

await t("the registry keeps a bounded number of cards", () => {
  const r = new PageCardRegistry(2);
  for (const id of ["t1", "t2", "t3"]) r.add("k", root, { turnId: id, anchorId: id, pages: [{ path: "index.html", kind: "added" }] });
  assert.deepEqual(r.forTask("k").map((c) => c.turnId), ["t2", "t3"]);
});

// F1 — check-then-use: the seam swaps the checked file (or a directory on its path) for a link to an
// outside page between the check and the use. A by-name read would return OUTSIDE-SECRET.
const race = path.join(tmp, "race");
const raceOut = path.join(tmp, "race-outside");
const resetRace = () => {
  fs.rmSync(race, { recursive: true, force: true });
  fs.mkdirSync(path.join(race, "sub"), { recursive: true });
  fs.mkdirSync(path.join(raceOut, "sub"), { recursive: true });
  fs.writeFileSync(path.join(race, "page.html"), "INSIDE");
  fs.writeFileSync(path.join(race, "sub", "deep.html"), "INSIDE-DEEP");
  fs.writeFileSync(path.join(raceOut, "secret.html"), "OUTSIDE-SECRET");
  fs.writeFileSync(path.join(raceOut, "sub", "deep.html"), "OUTSIDE-SECRET");
};
const swapFile = (abs) => { fs.rmSync(abs); fs.symlinkSync(path.join(raceOut, "secret.html"), abs); };
const swapDir = () => { fs.rmSync(path.join(race, "sub"), { recursive: true }); fs.symlinkSync(path.join(raceOut, "sub"), path.join(race, "sub")); };
const withSeam = (fn, body) => { pageCardSeam.afterCheck = fn; try { return body(); } finally { pageCardSeam.afterCheck = null; } };

await t("positive control: the handle-based read returns the checked bytes", () => {
  resetRace();
  const r = readPageInFolder(race, "page.html");
  assert.equal(r.ok, true);
  assert.equal(r.text, "INSIDE");
});
await t("F1: the file swapped for a link between check and read is refused, never read", () => {
  resetRace();
  const r = withSeam((abs) => swapFile(abs), () => readPageInFolder(race, "page.html"));
  assert.equal(r.ok, false);
  assert.equal(r.text, undefined);
});
await t("F1: a directory on the path swapped for a link between check and read is refused (dev+ino)", () => {
  resetRace();
  const r = withSeam(() => swapDir(), () => readPageInFolder(race, "sub/deep.html"));
  assert.equal(r.ok, false);
  assert.equal(r.cause, "changed");
});
await t("F1: 폴더에서 보기 walks again right before the OS call and refuses a swapped file or directory", () => {
  resetRace();
  assert.equal(recheckPageInFolder(race, "page.html").ok, true);
  assert.equal(withSeam((abs) => swapFile(abs), () => recheckPageInFolder(race, "page.html")).ok, false);
  resetRace();
  assert.equal(withSeam(() => swapDir(), () => recheckPageInFolder(race, "sub/deep.html")).ok, false);
});
await t("F1: through the gate, a swap at the seam reaches neither open nor reveal, and reload re-checks", async () => {
  resetRace();
  const reg = new PageCardRegistry();
  reg.add("k", race, { turnId: "r1", anchorId: "a", pages: [{ path: "page.html", kind: "changed" }] });
  const got = [];
  let reload;
  const d = { open: (abs, text, again) => { got.push(["open", text]); reload = again; }, reveal: (abs) => got.push(["reveal", abs]) };
  assert.equal((await withSeam((abs) => swapFile(abs), () => handlePageCardAction(reg, "k", { type: "pageCardOpen", turnId: "r1", path: "page.html" }, d))).ok, false);
  resetRace();
  assert.equal((await withSeam((abs) => swapFile(abs), () => handlePageCardAction(reg, "k", { type: "pageCardReveal", turnId: "r1", path: "page.html" }, d))).ok, false);
  assert.deepEqual(got, []);
  resetRace();
  assert.equal((await handlePageCardAction(reg, "k", { type: "pageCardOpen", turnId: "r1", path: "page.html" }, d)).ok, true);
  assert.deepEqual(got, [["open", "INSIDE"]]);
  assert.equal(reload(), "INSIDE");
  swapFile(path.join(race, "page.html"));
  assert.equal(reload(), null, "a reload after a swap must not read the link target");
});

fs.rmSync(tmp, { recursive: true, force: true });
if (fail) { console.error(`page-card: ${fail} failed`); process.exit(1); }
console.log("page-card OK");
