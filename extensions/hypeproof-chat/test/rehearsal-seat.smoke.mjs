// #4048 (chalk#17) — a same-window rehearsal: the instructor credential moves to a return key while the
// learner seat runs, and comes back after an entry, an exit, a restart or a failed return.
// Covers the four failure cases of plan §3 D1 / §8-1, the consumer and leak checks, and the forget rule.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  REHEARSAL_RETURN_KEY,
  REHEARSAL_SEAT_KEY,
  RESUME_QUESTION,
  RETURN_FAILED,
  enterRehearsal,
  resumeOnActivation,
  offerResume,
  endRehearsal,
  forgetIssuer,
  hasReturnIssuer,
  storeIssuerUnlessHeld,
  ISSUER_REPLACE_BLOCKED,
  MINT_BLOCKED,
  ENTER_OPEN_FAILED,
} from "../src/rehearsalSeat.ts";
import { ISSUER_TOKEN_KEY } from "../src/mintStudentTokenHelpers.ts";

let failed = 0;
async function t(name, fn) {
  try { await fn(); console.log(`  ok   ${name}`); }
  catch (err) { failed++; console.log(`  FAIL ${name}\n       ${err && err.message}`); }
}

const ISSUER = "synthetic-issuer-4048-aaaa";
const STUDENT = "synthetic-student-4048-bbbb";
const HOME = "/work/instructor-home";
const HOUR = 3600_000;

// One simulated window (the host). `store` is shared by every window of the same install (SecretStorage).
function makeWindow({ store, root, openFails = 0, now = 1_000_000 }) {
  const writes = [];
  const events = { bound: [], released: [], opened: [], notified: [], asked: 0 };
  let failOpens = openFails;
  const secrets = {
    get: async (k) => store.get(k),
    store: async (k, v) => { writes.push([k, v]); store.set(k, v); },
    delete: async (k) => { writes.push([k, null]); store.delete(k); },
  };
  const host = {
    secrets,
    currentRoot: () => win.root,
    rehearsalFolderFor: (id) => `/global/rehearsal-seat/${id}`,
    makeFolder: () => {},
    openFolder: async (folder) => {
      if (failOpens > 0) { failOpens--; throw new Error("open failed"); }
      events.opened.push(folder);
      win.root = folder; // a reload: the next activation runs in the new folder
    },
    bindStudentToken: async (token) => {
      if (token !== STUDENT) throw new Error("wrong token");
      events.bound.push(win.root);
      store.set("__student_binding__", win.root);
    },
    releaseStudentBinding: async (folder) => {
      events.released.push(folder);
      store.delete("__student_binding__");
    },
    askResume: async () => { events.asked++; return undefined; },
    notify: (m) => events.notified.push(m),
    now: () => now,
  };
  const win = { root, host, events, writes };
  return win;
}

const fresh = (root = HOME, extra = {}) => {
  const store = new Map([[ISSUER_TOKEN_KEY, ISSUER]]);
  return { store, win: makeWindow({ store, root, ...extra }) };
};
const REHEARSAL_ID = "rh-4048";
const folder = `/global/rehearsal-seat/${REHEARSAL_ID}`;
const enterInput = (expiresAt = 1_000_000 + HOUR) => ({ token: STUDENT, expiresAt, rehearsalId: REHEARSAL_ID });

// Enter, then the window reloads into the rehearsal folder and the activation binds the student token.
async function enterAndBind(store, win) {
  await enterRehearsal(win.host, enterInput());
  const r = await resumeOnActivation(win.host); // in the rehearsal folder: binds
  assert.equal(r, "bound", `activation after enter: ${r}`);
}

await t("keys: the return key and the seat record have the agreed names and differ from the issuer key", () => {
  assert.equal(REHEARSAL_RETURN_KEY, "chalk.rehearsal.returnIssuer");
  assert.notEqual(REHEARSAL_SEAT_KEY, ISSUER_TOKEN_KEY);
  assert.notEqual(REHEARSAL_RETURN_KEY, ISSUER_TOKEN_KEY);
});

await t("enter: the issuer leaves its own key, the return key holds it, and the rehearsal folder opens", async () => {
  const { store, win } = fresh();
  await enterRehearsal(win.host, enterInput());
  assert.equal(store.get(ISSUER_TOKEN_KEY), undefined, "the issuer key is empty during the rehearsal");
  assert.equal(store.get(REHEARSAL_RETURN_KEY), ISSUER);
  assert.deepEqual(win.events.opened, [folder]);
  assert.equal(await hasReturnIssuer(win.host), true);
});

await t("control: before enter the issuer key is readable (a consumer sees the credential)", async () => {
  const { store } = fresh();
  assert.equal(store.get(ISSUER_TOKEN_KEY), ISSUER);
});

await t("enter then activation in the rehearsal folder binds the student token once and goes to 'inside'", async () => {
  const { store, win } = fresh();
  await enterAndBind(store, win);
  assert.deepEqual(win.events.bound, [folder]);
  assert.equal(JSON.parse(store.get(REHEARSAL_SEAT_KEY)).phase, "inside");
  assert.equal(JSON.parse(store.get(REHEARSAL_SEAT_KEY)).pendingToken, undefined, "the pending token leaves the record once bound");
});

await t("rehearsal consumers cannot read the issuer while the seat runs (the key is empty)", async () => {
  const { store, win } = fresh();
  await enterAndBind(store, win);
  // The five readers of the issuer key all go through the same secret. None sees a credential.
  for (const reader of ["chalk-tools", "chalk-contract", "cr-director", "mint", "classroom-ops"]) {
    assert.equal(await win.host.secrets.get(ISSUER_TOKEN_KEY), undefined, `${reader} must not read the issuer`);
  }
});

await t("case 1: closed window, valid token → the question is asked; 'resume' keeps the seat", async () => {
  const { store, win } = fresh();
  await enterAndBind(store, win);
  const restart = makeWindow({ store, root: folder });
  assert.equal(await resumeOnActivation(restart.host), "ask");
  assert.equal(JSON.parse(store.get(REHEARSAL_SEAT_KEY)).phase, "inside");
  assert.equal(await offerResume({ ...restart.host, askResume: async () => "resume" }), "inside");
  assert.equal(store.get(ISSUER_TOKEN_KEY), undefined, "resume does not return the credential");
  assert.equal(RESUME_QUESTION, "리허설 중에 앱이 닫혔습니다. 리허설을 이어갈까요, 끝내고 강사로 돌아갈까요?");
});

await t("case 1b: closed window, valid token → 'return' goes back to the home folder with the credential", async () => {
  const { store, win } = fresh();
  await enterAndBind(store, win);
  const restart = makeWindow({ store, root: folder });
  assert.equal(await resumeOnActivation(restart.host), "ask");
  const r = await offerResume({ ...restart.host, askResume: async () => "return" });
  assert.equal(r, "reloading");
  assert.equal(store.get(ISSUER_TOKEN_KEY), ISSUER);
  assert.equal(restart.events.released.length, 1, "the rehearsal binding is released");
});

await t("case 2: closed window, expired token → no question, goes back to the home folder", async () => {
  const { store, win } = fresh(HOME, { now: 1_000_000 });
  await enterRehearsal(win.host, enterInput(1_000_000 + HOUR));
  await resumeOnActivation(win.host);
  // Later: the token has expired.
  const later = makeWindow({ store, root: folder, now: 1_000_000 + 2 * HOUR });
  assert.equal(await resumeOnActivation(later.host), "reloading");
  assert.equal(later.events.asked, 0, "an expired seat never asks");
  assert.equal(store.get(ISSUER_TOKEN_KEY), ISSUER);
  // Home activation finishes the return.
  const home = makeWindow({ store, root: HOME, now: 1_000_000 + 2 * HOUR });
  assert.equal(await resumeOnActivation(home.host), "done");
  assert.equal(store.get(REHEARSAL_RETURN_KEY), undefined);
  assert.equal(store.get(REHEARSAL_SEAT_KEY), undefined);
});

await t("case 3: both keys present (start interrupted) → the student condition is released and the return key is deleted", async () => {
  const store = new Map([[ISSUER_TOKEN_KEY, ISSUER], [REHEARSAL_RETURN_KEY, ISSUER], [REHEARSAL_SEAT_KEY, JSON.stringify({ phase: "entering", rehearsalId: REHEARSAL_ID, expiresAt: 1_000_000 + HOUR, homeFolder: HOME, rehearsalFolder: folder, pendingToken: STUDENT })], ["__student_binding__", folder]]);
  const inRehearsal = makeWindow({ store, root: folder });
  assert.equal(await resumeOnActivation(inRehearsal.host), "reloading", "first leaves the rehearsal folder");
  assert.equal(inRehearsal.events.released.length, 1, "the student binding is released in the rehearsal folder");
  const home = makeWindow({ store, root: HOME });
  assert.equal(await resumeOnActivation(home.host), "done");
  assert.equal(store.get(REHEARSAL_RETURN_KEY), undefined);
  assert.equal(store.get(REHEARSAL_SEAT_KEY), undefined);
  assert.equal(store.get(ISSUER_TOKEN_KEY), ISSUER, "the credential stays where it belongs");
});

await t("case 3b: both keys present in the home folder → the return key is deleted without reopening", async () => {
  const store = new Map([[ISSUER_TOKEN_KEY, ISSUER], [REHEARSAL_RETURN_KEY, ISSUER], [REHEARSAL_SEAT_KEY, JSON.stringify({ phase: "entering", rehearsalId: REHEARSAL_ID, expiresAt: 1, homeFolder: HOME, rehearsalFolder: folder })]]);
  const home = makeWindow({ store, root: HOME });
  assert.equal(await resumeOnActivation(home.host), "done");
  assert.equal(home.events.opened.length, 0);
  assert.equal(store.get(REHEARSAL_RETURN_KEY), undefined);
});

await t("case 4: the return fails → the return key is kept and the failure is shown; a restart retries and the credential comes back", async () => {
  const { store, win } = fresh();
  await enterAndBind(store, win);
  const failing = makeWindow({ store, root: folder, openFails: 1 });
  assert.equal(await offerResume({ ...failing.host, askResume: async () => "return" }), "failed");
  assert.equal(failing.events.notified.at(-1), RETURN_FAILED);
  assert.equal(store.get(REHEARSAL_RETURN_KEY), ISSUER, "the return key survives a failed return");
  // The app is started again: the window opens in the rehearsal folder, both keys are there.
  const restart = makeWindow({ store, root: folder });
  assert.equal(await resumeOnActivation(restart.host), "reloading", "the restart retries the return");
  const home = makeWindow({ store, root: HOME });
  assert.equal(await resumeOnActivation(home.host), "done");
  assert.equal(store.get(ISSUER_TOKEN_KEY), ISSUER, "the instructor credential is back");
  assert.equal(store.get(REHEARSAL_RETURN_KEY), undefined);
});

await t("enter failure: a folder that will not open rolls the credential back and leaves no seat", async () => {
  const { store, win } = fresh(HOME, { openFails: 1 });
  await assert.rejects(() => enterRehearsal(win.host, enterInput()));
  assert.equal(store.get(ISSUER_TOKEN_KEY), ISSUER);
  assert.equal(store.get(REHEARSAL_RETURN_KEY), undefined);
  assert.equal(store.get(REHEARSAL_SEAT_KEY), undefined);
});

await t("no credential written to any state or notice: the issuer string appears in no recorded write, notice or thrown message", async () => {
  const { store, win } = fresh();
  await enterAndBind(store, win);
  const restart = makeWindow({ store, root: folder });
  await offerResume({ ...restart.host, askResume: async () => "return" });
  const home = makeWindow({ store, root: HOME });
  await resumeOnActivation(home.host);
  for (const w of [win, restart, home]) {
    for (const [k, v] of w.writes) if (String(v).includes(ISSUER)) assert.ok([ISSUER_TOKEN_KEY, REHEARSAL_RETURN_KEY].includes(k), `credential written to ${k}`);
    for (const m of w.events.notified) assert.ok(!m.includes(ISSUER));
  }
  // The only places the credential may sit are the issuer key and the return key.
  for (const [k, v] of store) if (String(v).includes(ISSUER)) assert.ok([ISSUER_TOKEN_KEY, REHEARSAL_RETURN_KEY].includes(k), `unexpected key ${k}`);
});

await t("forget: forgetIssuer deletes the issuer, the return key and the seat; in the rehearsal folder it releases the binding", async () => {
  const { store, win } = fresh();
  await enterAndBind(store, win);
  const inRehearsal = makeWindow({ store, root: folder });
  await forgetIssuer(inRehearsal.host);
  assert.equal(store.get(ISSUER_TOKEN_KEY), undefined);
  assert.equal(store.get(REHEARSAL_RETURN_KEY), undefined);
  assert.equal(store.get(REHEARSAL_SEAT_KEY), undefined);
  assert.equal(inRehearsal.events.released.length, 1);
});

await t("end: endRehearsal from the chalk button goes home with the credential", async () => {
  const { store, win } = fresh();
  await enterAndBind(store, win);
  const inRehearsal = makeWindow({ store, root: folder });
  assert.equal(await endRehearsal(inRehearsal.host), "reloading");
  assert.equal(store.get(ISSUER_TOKEN_KEY), ISSUER);
});

await t("a return key without a seat record is restored at once and the key is deleted", async () => {
  const store = new Map([[REHEARSAL_RETURN_KEY, ISSUER]]);
  const win = makeWindow({ store, root: HOME });
  assert.equal(await resumeOnActivation(win.host), "done");
  assert.equal(store.get(ISSUER_TOKEN_KEY), ISSUER);
  assert.equal(store.get(REHEARSAL_RETURN_KEY), undefined);
});

await t("guard setInstructorToken: a held return → nothing is stored and the approved sentence is shown", async () => {
  const store = new Map([[REHEARSAL_RETURN_KEY, ISSUER]]);
  const secrets = { get: async (k) => store.get(k), store: async (k, v) => { store.set(k, v); }, delete: async (k) => { store.delete(k); } };
  const shown = [];
  const stored = await storeIssuerUnlessHeld(secrets, "synthetic-typed", (m) => shown.push(m));
  assert.equal(stored, false);
  assert.equal(store.get(ISSUER_TOKEN_KEY), undefined, "the typed credential is not stored");
  assert.deepEqual(shown, ["리허설을 끝낸 뒤에 강사 토큰을 바꾸세요."]);
});

await t("guard setInstructorToken control: no return held → the typed credential is stored and nothing is shown", async () => {
  const store = new Map();
  const secrets = { get: async (k) => store.get(k), store: async (k, v) => { store.set(k, v); }, delete: async (k) => { store.delete(k); } };
  const shown = [];
  const stored = await storeIssuerUnlessHeld(secrets, "synthetic-typed", (m) => shown.push(m));
  assert.equal(stored, true);
  assert.equal(store.get(ISSUER_TOKEN_KEY), "synthetic-typed");
  assert.deepEqual(shown, []);
});

await t("approved copy: the three sentences match the chalk-po wording exactly", () => {
  assert.equal(ISSUER_REPLACE_BLOCKED, "리허설을 끝낸 뒤에 강사 토큰을 바꾸세요.");
  assert.equal(MINT_BLOCKED, "리허설을 끝낸 뒤에 학생 토큰을 발급하세요.");
  assert.equal(ENTER_OPEN_FAILED, "리허설 창을 열지 못했습니다. 강사 자격은 그대로입니다.");
});

await t("static: the mask list hides both new keys, and the forget command and mint paths also clear the return key", () => {
  const provider = readFileSync(new URL("../src/chatPanelProvider.ts", import.meta.url), "utf8");
  assert.match(provider, /\[TOKEN_KEY, ISSUER_TOKEN_KEY, [^\]]*REHEARSAL_RETURN_KEY[^\]]*REHEARSAL_SEAT_KEY/, "mask list has the return and seat keys");
  const ext = readFileSync(new URL("../src/extension.ts", import.meta.url), "utf8");
  assert.match(ext, /forgetIssuerToken", async \(\) => \{\s*await forgetIssuer\(/, "forgetIssuerToken clears the return key too");
  assert.match(ext, /onIssuerAutoRejected = \(\) => \{\s*void forgetIssuer\(/, "a rejected issuer clears the return key too");
  const mint = readFileSync(new URL("../src/mintStudentToken.ts", import.meta.url), "utf8");
  assert.match(mint, /status === 401 \|\| status === 403\) \{\s*await context\.secrets\.delete\(ISSUER_TOKEN_KEY\);\s*await context\.secrets\.delete\(REHEARSAL_RETURN_KEY\)/, "a rejected issuer in mint clears the return key");
});

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log("\nall rehearsal-seat checks passed");
