// #4048 Dev 3차 — after the window reopens in the rehearsal folder, the return key and seat record are gone while the
// issuer is gone too. Two invariants fix that: (1) the issuer is removed only after the return key and seat record are
// read back equal, and (2) every clear of the return key or seat records a label line (never a value), so Dev shows
// the path that cleared them.
import assert from "node:assert/strict";
import {
  REHEARSAL_RETURN_KEY, REHEARSAL_SEAT_KEY, ENTER_OPEN_FAILED,
  enterRehearsal, resumeOnActivation, forgetIssuer, endRehearsal,
} from "../src/rehearsalSeat.ts";
import { ISSUER_TOKEN_KEY } from "../src/mintStudentTokenHelpers.ts";

let failed = 0;
async function t(name, fn) {
  try { await fn(); console.log(`  ok   ${name}`); }
  catch (err) { failed++; console.log(`  FAIL ${name}\n       ${err && err.message}`); }
}

const ISSUER = "synthetic-issuer-4048-clear";
const STUDENT = "synthetic-student-4048-clear";
const HOME = "/work/instructor-home";
const FOLDER = "/global/rehearsal-seat/rh-clear";

// `drop` lists keys whose writes are silently lost (a write that never becomes durable).
function store({ drop = [], corruptRead = [] } = {}) {
  const m = new Map();
  const s = {
    m,
    get: async (k) => (corruptRead.includes(k) && m.has(k) ? "synthetic-corrupt" : m.get(k)),
    store: async (k, v) => { if (!drop.includes(k)) m.set(k, v); },
    delete: async (k) => { m.delete(k); },
  };
  return s;
}
function host(secrets, { root = HOME, opened, notified, logged, openFails = false } = {}) {
  let r = root;
  return {
    secrets,
    currentRoot: () => r,
    rehearsalFolderFor: () => FOLDER,
    makeFolder: () => {},
    openFolder: async (f) => { if (openFails) throw new Error("open"); opened.push(f); r = f; },
    bindStudentToken: async () => {},
    releaseStudentBinding: async () => {},
    askResume: async () => undefined,
    notify: (m) => notified.push(m),
    now: () => 1_000_000,
    log: (line) => logged.push(line),
  };
}
const enterInput = { token: STUDENT, expiresAt: 1_000_000 + 3600_000, rehearsalId: "rh-clear" };
const fresh = () => ({ opened: [], notified: [], logged: [] });

await t("enter: the return key and seat read back equal before the issuer is removed, then the folder opens", async () => {
  const s = store();
  s.m.set(ISSUER_TOKEN_KEY, ISSUER);
  const x = fresh();
  await enterRehearsal(host(s, x), enterInput);
  assert.equal(s.m.get(ISSUER_TOKEN_KEY), undefined);
  assert.equal(s.m.get(REHEARSAL_RETURN_KEY), ISSUER);
  assert.deepEqual(x.opened, [FOLDER]);
});

await t("enter: a return key that does not read back equal refuses entry, keeps the issuer, and shows the sentence once", async () => {
  const s = store({ corruptRead: [REHEARSAL_RETURN_KEY] });
  s.m.set(ISSUER_TOKEN_KEY, ISSUER);
  const x = fresh();
  // The sentence is the error text; the bus handler shows it once (the seat module does not show it too).
  await assert.rejects(() => enterRehearsal(host(s, x), enterInput), (e) => e.message === ENTER_OPEN_FAILED);
  assert.equal(x.opened.length, 0, "the folder does not open");
  assert.equal(s.m.get(ISSUER_TOKEN_KEY), ISSUER, "the issuer is kept");
  assert.deepEqual(x.notified, [], "the seat module does not show the sentence itself");
});

await t("enter: a seat record that does not persist refuses entry before the issuer is removed", async () => {
  const s = store({ drop: [REHEARSAL_SEAT_KEY] });
  s.m.set(ISSUER_TOKEN_KEY, ISSUER);
  const x = fresh();
  await assert.rejects(() => enterRehearsal(host(s, x), enterInput), (e) => e.message === ENTER_OPEN_FAILED);
  assert.equal(s.m.get(ISSUER_TOKEN_KEY), ISSUER, "the issuer is kept");
  assert.equal(x.opened.length, 0);
});

await t("every clear of the return key or seat logs a label line, and the line never carries a value", async () => {
  // Return path: the window is in the rehearsal folder with a valid seat and returns home.
  const s = store();
  s.m.set(ISSUER_TOKEN_KEY, ISSUER);
  const x = fresh();
  await enterRehearsal(host(s, x), enterInput);
  // The window is in the rehearsal folder: the return reopens home, then the home activation clears the records.
  await endRehearsal(host(s, { ...x, root: FOLDER, opened: [] }));
  await resumeOnActivation(host(s, { ...x, root: HOME, opened: [] }));
  assert.ok(x.logged.some((l) => /^\[seat\] cleared by (return|restore|finish|forget|no-return)\b/.test(l)), "a clear logs a label");
  for (const line of x.logged) {
    assert.ok(!line.includes(ISSUER) && !line.includes(STUDENT) && !line.includes(FOLDER), `no value in: ${line}`);
  }
});

await t("forgetIssuer logs its clear by label", async () => {
  const s = store();
  s.m.set(ISSUER_TOKEN_KEY, ISSUER);
  s.m.set(REHEARSAL_RETURN_KEY, ISSUER);
  s.m.set(REHEARSAL_SEAT_KEY, JSON.stringify({ phase: "inside", rehearsalId: "rh", expiresAt: 1, homeFolder: HOME, rehearsalFolder: FOLDER }));
  const x = fresh();
  await forgetIssuer(host(s, { ...x, root: HOME }));
  assert.ok(x.logged.some((l) => l === "[seat] cleared by forget"), x.logged.join("|"));
});

await t("a reopened window that finds neither key logs nothing about a clear", async () => {
  const s = store();
  const x = fresh();
  assert.equal(await resumeOnActivation(host(s, { ...x, root: FOLDER })), "none");
  assert.deepEqual(x.logged, []);
});

await t("control: a normal enter and bind logs no clear", async () => {
  const s = store();
  s.m.set(ISSUER_TOKEN_KEY, ISSUER);
  const x = fresh();
  await enterRehearsal(host(s, x), enterInput);
  assert.deepEqual(x.logged.filter((l) => /cleared by/.test(l)), []);
});

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log("\nall rehearsal-seat-clear checks passed");
