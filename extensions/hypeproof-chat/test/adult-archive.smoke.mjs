// Archive-before-overwrite for adults (orchestrator spec §6.3, FO-10), on a real
// temporary folder: naming, identical content, retention, containment, and the
// adults-only gate.
//
// Run: node --experimental-strip-types test/adult-archive.smoke.mjs

import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const {
  ADULT_ARCHIVE_DIR, ADULT_ARCHIVE_KEEP, adultArchiveApplies, adultArchiveName, parseAdultArchiveName,
  archiveBeforeOverwrite,
} = await import("../src/adultArchive.ts");

// Profiles as the Service serves them: homepage-practice-s1 spreads the
// website-tier director profile; the kids cohorts carry kids tiers.
const adult = { profile_id: "homepage-practice-s1", game: { template_tier: "website" } };
const seat = (profile, orchestrator = true) => ({ profile, orchestrator });
const ADULT = seat(adult);

function workspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hp-archive-"));
  return { root, history: path.join(root, ...ADULT_ARCHIVE_DIR.split("/")) };
}
const listHistory = (w) => (fs.existsSync(w.history) ? fs.readdirSync(w.history).sort() : []);

// ─── Adults on an orchestrator seat only ─────────────────────────────────────
{
  // Positive control.
  assert.equal(adultArchiveApplies(ADULT), true, "an adult homepage seat with the orchestrator");
  // Negative controls: every minor or unknown shape, and adults without the orchestrator.
  const never = {
    "minor flag on a website tier": seat({ ...adult, minor_cohort: true }),
    "kids-quest (worlds archive their own way)": seat({ profile_id: "kids", game: { template_tier: "kids-quest" }, minor_cohort: true }),
    "kids-basic": seat({ profile_id: "k", game: { template_tier: "kids-basic" } }),
    "teen": seat({ profile_id: "t", game: { template_tier: "teen" } }),
    "unknown tier": seat({ profile_id: "x", game: { template_tier: "something-new" } }),
    "no tier": seat({ profile_id: "x" }),
    "adult without the orchestrator": seat(adult, false),
    "no profile": seat(null),
  };
  for (const [label, s] of Object.entries(never)) assert.equal(adultArchiveApplies(s), false, label);

  // On a minor seat nothing is touched: no copy, no .hypeproof folder at all.
  const w = workspace();
  fs.writeFileSync(path.join(w.root, "index.html"), "<h1>아이가 고친 세상</h1>");
  for (const [label, s] of Object.entries(never)) {
    const out = archiveBeforeOverwrite({ seat: s, workspaceRoot: w.root, file: "index.html", nextContent: "<h1>new</h1>" });
    assert.deepEqual([out.archived, out.reason], [false, "not_adult_seat"], label);
  }
  assert.equal(fs.existsSync(path.join(w.root, ".hypeproof")), false, "a minor seat never gets an archive folder");
  console.log(`✓ adults only — 1 adult seat archives, ${Object.keys(never).length} other seats never do`);
}

// ─── Naming ──────────────────────────────────────────────────────────────────
{
  const at = new Date(2026, 9, 14, 15, 30, 12); // local time, as the learner reads it
  assert.equal(adultArchiveName("index.html", at), "index-20261014-153012.html", "spec §6.3 name");
  assert.equal(adultArchiveName("index.html", at, ["INDEX-20261014-153012.html"]), "index-20261014-153012-2.html", "taken, case-insensitively");
  assert.equal(adultArchiveName("pages/about.htm", at), "pages-about-20261014-153012.html", "a page in a folder keeps its folder in the name");
  assert.deepEqual(parseAdultArchiveName("index-20261014-153012-2.html"), { base: "index", stamp: "20261014-153012", seq: 2 });
  assert.equal(parseAdultArchiveName("notes.html"), null, "not an archive name");
  console.log("✓ naming — <name>-<YYYYMMDD-HHmmss>.html, -2 on a same-second clash");
}

// ─── Archive, skip identical, keep the newest 20 ────────────────────────────
{
  const w = workspace();
  const file = path.join(w.root, "index.html");
  fs.writeFileSync(file, "<h1>v1</h1>");
  const t0 = new Date(2026, 9, 14, 9, 0, 0);

  const first = archiveBeforeOverwrite({ seat: ADULT, workspaceRoot: w.root, file: "index.html", nextContent: "<h1>v2</h1>", now: t0 });
  assert.equal(first.archived, true);
  assert.equal(first.path, `${ADULT_ARCHIVE_DIR}/index-20261014-090000.html`);
  assert.equal(fs.readFileSync(path.join(w.root, first.path), "utf8"), "<h1>v1</h1>", "the copy is the old content");
  assert.equal(fs.readFileSync(file, "utf8"), "<h1>v1</h1>", "the page itself is not touched");
  assert.equal(first.timeline, "🗂 이전 버전 보관 (.hypeproof/history) — index-20261014-090000.html", "spec §5.2 line");

  // Writing the same content again is not a change to protect.
  const same = archiveBeforeOverwrite({ seat: ADULT, workspaceRoot: w.root, file, nextContent: "  <h1>v1</h1>\n", now: t0 });
  assert.deepEqual([same.archived, same.reason], [false, "identical"]);
  // The page has not changed since its last copy: point at that copy, do not make another.
  const again = archiveBeforeOverwrite({ seat: ADULT, workspaceRoot: w.root, file, nextContent: "<h1>v3</h1>", now: new Date(t0.getTime() + 5000) });
  assert.deepEqual([again.archived, again.reason, again.path], [false, "already_archived", first.path]);
  assert.equal(listHistory(w).length, 1);

  // Same second, different content: both kept.
  fs.writeFileSync(file, "<h1>v2</h1>");
  const clash = archiveBeforeOverwrite({ seat: ADULT, workspaceRoot: w.root, file, nextContent: "<h1>v3</h1>", now: t0 });
  assert.equal(clash.path, `${ADULT_ARCHIVE_DIR}/index-20261014-090000-2.html`);

  // Retention: 30 more saves leave the newest 20 copies of this page, and
  // nothing else in the folder is touched.
  fs.writeFileSync(path.join(w.history, "notes.txt"), "learner's own note");
  fs.writeFileSync(path.join(w.history, "about-20200101-000000.html"), "another page's copy");
  for (let i = 1; i <= 30; i++) {
    fs.writeFileSync(file, `<h1>v${i + 2}</h1>`);
    archiveBeforeOverwrite({ seat: ADULT, workspaceRoot: w.root, file, nextContent: `<h1>v${i + 3}</h1>`, now: new Date(t0.getTime() + i * 60_000) });
  }
  const kept = listHistory(w).filter((n) => n.startsWith("index-"));
  assert.equal(kept.length, ADULT_ARCHIVE_KEEP, "the newest 20 copies of the page");
  assert.equal(kept.at(-1), "index-20261014-093000.html", "the newest is kept");
  assert.equal(kept[0], "index-20261014-091100.html", "the oldest kept is the 20th newest");
  assert.ok(listHistory(w).includes("notes.txt") && listHistory(w).includes("about-20200101-000000.html"), "other files survive retention");
  console.log(`✓ archive — old content copied, identical skipped, same-second kept, ${ADULT_ARCHIVE_KEEP} newest retained`);
}

// ─── Nothing to archive, or not the learner's page ──────────────────────────
{
  const w = workspace();
  const run = (file, nextContent = "<p>new</p>") => archiveBeforeOverwrite({ seat: ADULT, workspaceRoot: w.root, file, nextContent });
  assert.equal(run("index.html").reason, "missing", "a new file has nothing to keep");
  fs.writeFileSync(path.join(w.root, "blank.html"), "  \n");
  assert.equal(run("blank.html").reason, "empty");
  fs.writeFileSync(path.join(w.root, "style.css"), "body{}");
  assert.equal(run("style.css").reason, "not_html");
  assert.equal(run("../outside.html").reason, "outside_workspace");
  assert.equal(run(path.join(os.tmpdir(), "elsewhere.html")).reason, "outside_workspace");
  fs.mkdirSync(w.history, { recursive: true });
  fs.writeFileSync(path.join(w.history, "index-20261014-090000.html"), "<p>old</p>");
  assert.equal(run(`${ADULT_ARCHIVE_DIR}/index-20261014-090000.html`).reason, "in_history", "a copy is not archived again");

  // A .hypeproof that links out of the workspace gets no copy written through it.
  const v = workspace();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "hp-outside-"));
  fs.writeFileSync(path.join(v.root, "index.html"), "<p>mine</p>");
  let linked = true;
  try { fs.symlinkSync(outside, path.join(v.root, ".hypeproof"), "dir"); } catch { linked = false; } // Windows without the privilege
  if (linked) {
    const out = archiveBeforeOverwrite({ seat: ADULT, workspaceRoot: v.root, file: "index.html", nextContent: "<p>new</p>" });
    assert.equal(out.reason, "outside_workspace");
    assert.deepEqual(fs.readdirSync(outside), [], "nothing created or written outside");
  }
  console.log(`✓ skips — missing, empty, not html, outside, in history${linked ? ", linked out" : ""}; never throws`);
}
