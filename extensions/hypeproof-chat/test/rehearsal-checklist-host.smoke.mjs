// #4102 — the rehearsal checklist on the host: the stuck list from Chalk is sanitised, kept with the seat record (not in
// the secrets of the student token), survives a reopen, and is removed when the seat ends. The report gets a checklist
// field only when the person marked something; an old report is unchanged.
import assert from "node:assert/strict";
import {
  REHEARSAL_SEAT_KEY, enterRehearsal, resumeOnActivation, forgetIssuer, rehearsalChecklistFor, sanitizeStucks, checklistForReport, rehearsalStucksAt, rehearsalRouteFor,
} from "../src/rehearsalSeat.ts";
import { ISSUER_TOKEN_KEY } from "../src/mintStudentTokenHelpers.ts";
import { rehearsalReport } from "../src/lessonFocus.ts";

let failed = 0;
async function t(name, fn) {
  try { await fn(); console.log(`  ok   ${name}`); }
  catch (err) { failed++; console.log(`  FAIL ${name}\n       ${err && err.message}`); }
}

const ISSUER = "synthetic-issuer-4102";
const STUDENT = "synthetic-student-4102";
const HOME = "/work/instructor-home";
const FOLDER = "/global/rehearsal-seat/rh-4102";
const STUCKS = [
  { id: "stuck-1", expected_stuck: "이 답이 맞는지 모르겠어요." },
  { id: "stuck-2", expected_stuck: "그냥 다시 해 주세요." },
];

function store() {
  const m = new Map();
  return { m, get: async (k) => m.get(k), store: async (k, v) => { m.set(k, v); }, delete: async (k) => { m.delete(k); } };
}
function host(secrets, root, opened = []) {
  let r = root;
  return {
    secrets,
    currentRoot: () => r,
    rehearsalFolderFor: () => FOLDER,
    makeFolder: () => {},
    openFolder: async (f) => { opened.push(f); r = f; },
    bindStudentToken: async () => {},
    releaseStudentBinding: async () => {},
    askResume: async () => undefined,
    notify: () => {},
    now: () => 1_000_000,
    log: () => {},
  };
}
const enterInput = (stucks) => ({ token: STUDENT, expiresAt: 1_000_000 + 3600_000, rehearsalId: "rh-4102", ...(stucks === undefined ? {} : { stucks }) });

await t("sanitize: a missing or malformed list is an empty list", () => {
  assert.deepEqual(sanitizeStucks(undefined), []);
  assert.deepEqual(sanitizeStucks("not a list"), []);
  assert.deepEqual(sanitizeStucks({ id: "x" }), []);
});

await t("sanitize: items without a usable id or text are dropped, and over-long ones too", () => {
  const long = "가".repeat(2001);
  const idLong = "i".repeat(65);
  const out = sanitizeStucks([
    { id: "ok-1", expected_stuck: "좋아요" },
    { id: "", expected_stuck: "빈 id" },
    { id: "no-text" },
    { id: idLong, expected_stuck: "id 가 너무 김" },
    { id: "text-long", expected_stuck: long },
    null,
    "string",
    { id: "ok-2", expected_stuck: "두 번째" },
  ]);
  assert.deepEqual(out, [{ id: "ok-1", expected_stuck: "좋아요" }, { id: "ok-2", expected_stuck: "두 번째" }]);
});

await t("sanitize: the limits are inclusive (64 characters for id, 2000 for text)", () => {
  const out = sanitizeStucks([{ id: "i".repeat(64), expected_stuck: "가".repeat(2000) }]);
  assert.equal(out.length, 1);
});

await t("enter stores the stucks in the seat record, not in a key of their own", async () => {
  const s = store();
  s.m.set(ISSUER_TOKEN_KEY, ISSUER);
  const opened = [];
  await enterRehearsal(host(s, HOME, opened), enterInput(STUCKS));
  const seat = JSON.parse(s.m.get(REHEARSAL_SEAT_KEY));
  assert.deepEqual(seat.stucks, STUCKS);
  const keys = [...s.m.keys()];
  assert.ok(!keys.some((k) => /stuck|checklist/i.test(k)), `no separate key: ${keys.join(",")}`);
});

await t("a reopened window keeps the stucks with the seat", async () => {
  const s = store();
  s.m.set(ISSUER_TOKEN_KEY, ISSUER);
  await enterRehearsal(host(s, HOME), enterInput(STUCKS));
  await resumeOnActivation(host(s, FOLDER));
  assert.deepEqual(await rehearsalChecklistFor(host(s, FOLDER)), STUCKS);
});

await t("missing stucks are an empty checklist, and a seat with no record gives none", async () => {
  const s = store();
  s.m.set(ISSUER_TOKEN_KEY, ISSUER);
  await enterRehearsal(host(s, HOME), enterInput());
  assert.deepEqual(await rehearsalChecklistFor(host(s, FOLDER)), []);
  assert.deepEqual(await rehearsalChecklistFor(host(store(), FOLDER)), []);
});

await t("the seat ends and the stucks go with the record", async () => {
  const s = store();
  s.m.set(ISSUER_TOKEN_KEY, ISSUER);
  await enterRehearsal(host(s, HOME), enterInput(STUCKS));
  await resumeOnActivation(host(s, FOLDER));
  await forgetIssuer(host(s, FOLDER));
  assert.equal(s.m.get(REHEARSAL_SEAT_KEY), undefined);
  assert.deepEqual(await rehearsalChecklistFor(host(s, HOME)), []);
});

await t("checklist for the report: only marked items, only known ids, verdicts fits or fix, note optional", () => {
  const marked = checklistForReport(
    [
      { id: "stuck-1", verdict: "fits" },
      { id: "stuck-2", verdict: "fix", note: "문장을 더 짧게" },
      { id: "stuck-9", verdict: "fits" },
      { id: "stuck-1", verdict: "bogus" },
    ],
    STUCKS,
  );
  assert.deepEqual(marked, {
    schema: "hps-rehearsal-checklist/1",
    items: [{ id: "stuck-1", verdict: "fits" }, { id: "stuck-2", verdict: "fix", note: "문장을 더 짧게" }],
  });
});

await t("checklist for the report: nothing marked is no checklist field at all", () => {
  assert.equal(checklistForReport([], STUCKS), undefined);
  assert.equal(checklistForReport([{ id: "stuck-1", verdict: "bogus" }], STUCKS), undefined);
});

await t("report: an old report (no checklist) is unchanged by the new parameter", () => {
  const lesson = { content: { steps: [{ id: "s1" }] } };
  const app = { extension_version: "1", host: "h", runtime: "proxy", os: "darwin", arch: "arm64" };
  const before = rehearsalReport(lesson, [], app);
  const after = rehearsalReport(lesson, [], app, undefined, undefined);
  assert.deepEqual(after, before);
  assert.equal("checklist" in after, false);
});

await t("report: a marked checklist is added with its schema and only the marked items", () => {
  const lesson = { content: { steps: [{ id: "s1" }] } };
  const app = { extension_version: "1", host: "h", runtime: "proxy", os: "darwin", arch: "arm64" };
  const checklist = checklistForReport([{ id: "stuck-1", verdict: "fits" }], STUCKS);
  const report = rehearsalReport(lesson, [], app, undefined, checklist);
  assert.deepEqual(report.checklist, { schema: "hps-rehearsal-checklist/1", items: [{ id: "stuck-1", verdict: "fits" }] });
});

await t("the panel reads the stucks only inside the rehearsal folder, and not elsewhere", async () => {
  const s2 = store();
  s2.m.set(ISSUER_TOKEN_KEY, ISSUER);
  await enterRehearsal(host(s2, HOME), enterInput(STUCKS));
  await resumeOnActivation(host(s2, FOLDER));
  assert.deepEqual(await rehearsalStucksAt(s2, FOLDER), STUCKS);
  assert.deepEqual(await rehearsalStucksAt(s2, HOME), []);
  assert.deepEqual(await rehearsalStucksAt(store(), FOLDER), []);
});

// #4102 — the route band is for the subscription rehearsal only (profile.rehearsal.path === "subscription").
await t("route: a subscription rehearsal gets the route values (model names, minor)", () => {
  const profile = { rehearsal: { id: "r", course_id: "c", version: "v", expires_at: 1, judged: false, path: "subscription" }, model_selection: { default: "lesson-model" }, minor_cohort: true };
  assert.deepEqual(rehearsalRouteFor(profile, "rehearsal-model"), { rehearsalModel: "rehearsal-model", lessonModel: "lesson-model", minor: true });
});

await t("route: a subscription rehearsal with no local runner shows the rehearsal model as unknown (null)", () => {
  const profile = { rehearsal: { id: "r", course_id: "c", version: "v", expires_at: 1, judged: false, path: "subscription" }, model_selection: { default: "lesson-model" } };
  assert.deepEqual(rehearsalRouteFor(profile, undefined), { rehearsalModel: null, lessonModel: "lesson-model", minor: false });
  assert.deepEqual(rehearsalRouteFor(profile, "default"), { rehearsalModel: null, lessonModel: "lesson-model", minor: false });
});

await t("route: a server-path rehearsal (or no path) gets no route band (control)", () => {
  const server = { rehearsal: { id: "r", course_id: "c", version: "v", expires_at: 1, judged: false, path: "server" }, model_selection: { default: "m" } };
  const nopath = { rehearsal: { id: "r", course_id: "c", version: "v", expires_at: 1, judged: false }, model_selection: { default: "m" } };
  assert.equal(rehearsalRouteFor(server, "x"), undefined);
  assert.equal(rehearsalRouteFor(nopath, "x"), undefined);
  assert.equal(rehearsalRouteFor(null, "x"), undefined);
});

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log("\nall rehearsal-checklist-host checks passed");
