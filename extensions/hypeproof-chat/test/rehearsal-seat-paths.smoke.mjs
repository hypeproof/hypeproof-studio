// #4048 Dev 2차 — the rehearsal folder check must hold for the folder spellings a real window reports: a drive-letter
// case difference, backslash and slash, and a trailing separator. The safety net returns a held credential when a
// window ends without a learner connection, once, with the approved sentence. Diagnostic line carries facts only.
import assert from "node:assert/strict";
import {
  REHEARSAL_RETURN_KEY, REHEARSAL_SEAT_KEY, ENTER_OPEN_FAILED, RETURN_FAILED,
  resumeOnActivation, sameFolder, seatFacts, seatLogLine, returnAfterUnsettled,
} from "../src/rehearsalSeat.ts";
import { ISSUER_TOKEN_KEY } from "../src/mintStudentTokenHelpers.ts";

let failed = 0;
async function t(name, fn) {
  try { await fn(); console.log(`  ok   ${name}`); }
  catch (err) { failed++; console.log(`  FAIL ${name}\n       ${err && err.message}`); }
}

const ISSUER = "synthetic-issuer-4048-paths";
const STUDENT = "synthetic-student-4048-paths";
const HOUR = 3600_000;

function memSecrets(m) {
  return { get: async (k) => m.get(k), store: async (k, v) => { m.set(k, v); }, delete: async (k) => { m.delete(k); } };
}
// A window: root is what the host reports for the open folder.
function win(store, root, { bindFails = false, throwOnGet = false, now = 1_000_000 } = {}) {
  const events = { bound: 0, released: 0, opened: [], notified: [] };
  const w = { root, events };
  const base = memSecrets(store);
  w.host = {
    secrets: throwOnGet ? { get: async () => { throw new Error("boom"); }, store: base.store, delete: base.delete } : base,
    currentRoot: () => w.root,
    rehearsalFolderFor: (id) => `/global/rehearsal-seat/${id}`,
    makeFolder: () => {},
    openFolder: async (f) => { events.opened.push(f); w.root = f; },
    bindStudentToken: async (token) => { if (bindFails) throw new Error("bind"); if (token !== STUDENT) throw new Error("token"); events.bound++; },
    releaseStudentBinding: async () => { events.released++; },
    askResume: async () => undefined,
    notify: (m) => events.notified.push(m),
    now: () => now,
  };
  return w;
}
const seatFor = (folder, extra = {}) => JSON.stringify({ phase: "entering", rehearsalId: "rh-1", expiresAt: 1_000_000 + HOUR, homeFolder: "/home/inst", rehearsalFolder: folder, pendingToken: STUDENT, ...extra });

await t("sameFolder: drive-letter case, backslash versus slash, and a trailing separator name the same folder", () => {
  assert.equal(sameFolder("C:\\Users\\me\\rh-1", "c:/Users/me/rh-1/"), true);
  assert.equal(sameFolder("c:\\globalStorage\\rehearsal-seat\\rh-1\\", "C:/globalStorage/rehearsal-seat/rh-1"), true);
  assert.equal(sameFolder("/a/rh-1", "/a/rh-1/"), true);
});

await t("sameFolder: different folders and missing values never match", () => {
  assert.equal(sameFolder("C:\\a\\rh-1", "C:\\a\\rh-2"), false);
  assert.equal(sameFolder("D:\\a\\rh-1", "C:\\a\\rh-1"), false);
  assert.equal(sameFolder(undefined, "C:\\a"), false);
  assert.equal(sameFolder("", ""), false);
});

await t("entering in the rehearsal folder reported with a different spelling still binds the learner token", async () => {
  const folderKey = "C:/globalStorage/rehearsal-seat/rh-1";
  const store = new Map([[REHEARSAL_RETURN_KEY, ISSUER], [REHEARSAL_SEAT_KEY, seatFor(folderKey)]]);
  const w = win(store, "c:\\globalStorage\\rehearsal-seat\\rh-1\\");
  assert.equal(await resumeOnActivation(w.host), "bound");
  assert.equal(w.events.bound, 1);
});

await t("control: the same folder spelled identically binds", async () => {
  const folder = "/global/rehearsal-seat/rh-1";
  const store = new Map([[REHEARSAL_RETURN_KEY, ISSUER], [REHEARSAL_SEAT_KEY, seatFor(folder)]]);
  const w = win(store, folder);
  assert.equal(await resumeOnActivation(w.host), "bound");
});

await t("the diagnostic line carries outcome, phase and the four facts, and no path, token or cohort", async () => {
  const folder = "/global/rehearsal-seat/rh-1";
  const store = new Map([[REHEARSAL_RETURN_KEY, ISSUER], [REHEARSAL_SEAT_KEY, seatFor(folder)]]);
  const w = win(store, folder);
  const facts = await seatFacts(w.host);
  assert.deepEqual(facts, { phase: "entering", rootMatch: true, retHeld: true, issuerHeld: false });
  const line = seatLogLine("bound", facts);
  assert.equal(line, "[seat] outcome=bound phase=entering rootMatch=true retHeld=true issuerHeld=false");
  for (const leak of [folder, STUDENT, ISSUER, "rh-1", "global", "/home"]) assert.ok(!line.includes(leak), `no ${leak} in the line`);
});

await t("safety net: the activation check throws with a held return → the approved sentence once, and the credential returns", async () => {
  const store = new Map([[REHEARSAL_RETURN_KEY, ISSUER], [REHEARSAL_SEAT_KEY, seatFor("/global/rehearsal-seat/rh-1", { phase: "inside", pendingToken: undefined })]]);
  const w = win(store, "/global/rehearsal-seat/rh-1");
  const r = await returnAfterUnsettled(w.host, "threw");
  assert.equal(r, "reloading");
  assert.deepEqual(w.events.notified, [ENTER_OPEN_FAILED], "the sentence once");
  assert.equal(store.get(ISSUER_TOKEN_KEY), ISSUER, "the credential returns");
  assert.equal(w.events.released, 1, "the student binding is released");
});

await t("safety net: a settled outcome (bound, ask, reloading, done, failed) shows nothing and does nothing", async () => {
  for (const outcome of ["bound", "ask", "inside", "reloading", "done", "failed"]) {
    const store = new Map([[REHEARSAL_RETURN_KEY, ISSUER]]);
    const w = win(store, "/global/rehearsal-seat/rh-1");
    assert.equal(await returnAfterUnsettled(w.host, outcome), "none", outcome);
    assert.deepEqual(w.events.notified, [], outcome);
    assert.equal(store.get(ISSUER_TOKEN_KEY), undefined, `${outcome}: no credential restored`);
  }
});

await t("safety net: no held return → nothing, even for an unsettled outcome", async () => {
  const store = new Map();
  const w = win(store, "/global/rehearsal-seat/rh-1");
  assert.equal(await returnAfterUnsettled(w.host, "none"), "none");
  assert.deepEqual(w.events.notified, []);
});

await t("the rehearsal folder with no binding (bind fails) returns once with the return failure path, not twice", async () => {
  const store = new Map([[REHEARSAL_RETURN_KEY, ISSUER], [REHEARSAL_SEAT_KEY, seatFor("/global/rehearsal-seat/rh-1")]]);
  const w = win(store, "/global/rehearsal-seat/rh-1", { bindFails: true });
  const outcome = await resumeOnActivation(w.host);
  assert.notEqual(outcome, "bound");
  assert.equal(await returnAfterUnsettled(w.host, outcome), "none", "an already-returning outcome is not returned twice");
});

await t("constant text: the return failure sentence is unchanged", () => {
  assert.equal(RETURN_FAILED, "강사 자격으로 돌아가지 못했습니다. 앱을 다시 켜면 다시 시도합니다.");
});

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log("\nall rehearsal-seat-paths checks passed");
