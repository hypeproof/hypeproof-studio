// #3582: time spent waiting for a person does not spend the 180 s turn budget, and a turn that ends
// while a person is answering denies that answer, so a late approval cannot run the write.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { localTurnBudget } from "../src/localRuntime/emailTools.ts";
import { answerUnlessTurnEnds, confirmUnlessTurnEnds, createHumanWait } from "../src/localRuntime/humanWait.ts";
import { workspaceTools } from "../src/localRuntime/tools.ts";
import { INSTRUCTOR_TOOL_PROFILE } from "../src/chalk/instructorTurn.ts";

let failed = 0;
async function work(dir) { const { writeFile } = await import("node:fs/promises"); await writeFile(path.join(dir, "course.html"), "new course"); }
async function t(name, fn) {
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failed++;
    console.log(`  FAIL ${name}\n       ${err && err.message}`);
  }
}
const flush = () => new Promise((resolve) => setImmediate(resolve));

// A fake clock: each advance moves time in 1 s steps and runs the budget's interval, so no real waiting.
function fakeClock() {
  let t = 0;
  let tick = null;
  return {
    now: () => t,
    setInterval: (fn) => { tick = fn; return 1; },
    clearInterval: () => { tick = null; },
    advance(ms) {
      for (let i = 0; i < ms / 1000; i++) { t += 1000; tick?.(); }
    },
  };
}

console.log("=== turn budget with a person waiting (#3582) ===");
await t("a 200 s wait for a person does not stop the turn", async () => {
  const clock = fakeClock();
  const humanWait = createHumanWait();
  const budget = localTurnBudget(() => humanWait.active(), 180000, clock);
  let release;
  humanWait.track(() => new Promise((resolve) => { release = resolve; }));
  clock.advance(200000);
  assert.equal(budget.signal.aborted, false, "the wait is not charged");
  release();
  await flush();
  budget.dispose();
});

await t("active time after the answer still spends the budget", async () => {
  const clock = fakeClock();
  const humanWait = createHumanWait();
  const budget = localTurnBudget(() => humanWait.active(), 180000, clock);
  let release;
  humanWait.track(() => new Promise((resolve) => { release = resolve; }));
  clock.advance(200000);
  release();
  await flush();
  clock.advance(179000);
  assert.equal(budget.signal.aborted, false);
  clock.advance(2000);
  assert.equal(budget.signal.aborted, true, "180 s of active time ends the turn");
  budget.dispose();
});

await t("the email question wait keeps pausing the budget as before", async () => {
  const clock = fakeClock();
  let emailWaiting = true;
  const budget = localTurnBudget(() => emailWaiting, 180000, clock);
  clock.advance(200000);
  assert.equal(budget.signal.aborted, false);
  emailWaiting = false;
  clock.advance(181000);
  assert.equal(budget.signal.aborted, true);
  budget.dispose();
});

console.log("=== answers after the turn ends (#3582) ===");
await t("an answer given while the turn is open is used", async () => {
  const ctrl = new AbortController();
  assert.equal(await answerUnlessTurnEnds(Promise.resolve(true), ctrl.signal, false), true);
});

await t("a turn that ends first denies the answer that comes later", async () => {
  const ctrl = new AbortController();
  let answer;
  const pending = new Promise((resolve) => { answer = resolve; });
  const result = answerUnlessTurnEnds(pending, ctrl.signal, false);
  ctrl.abort();
  answer(true);
  assert.equal(await result, false);
});

await t("a confirmation picked after the turn ended is not a yes (the overwrite does not run)", async () => {
  const ctrl = new AbortController();
  let pick;
  const dialog = new Promise((resolve) => { pick = resolve; });
  const decided = confirmUnlessTurnEnds(dialog, ctrl.signal, "계속");
  ctrl.abort();
  pick("계속");
  assert.equal(await decided, false);
  assert.equal(await confirmUnlessTurnEnds(Promise.resolve("계속"), new AbortController().signal, "계속"), true);
  assert.equal(await confirmUnlessTurnEnds(Promise.resolve("취소"), new AbortController().signal, "계속"), false);
});

await t("a late approval never writes the file after the turn ended", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "hps-human-wait-"));
  try {
    const ctrl = new AbortController();
    const humanWait = createHumanWait();
    let answer;
    const pending = new Promise((resolve) => { answer = resolve; });
    const work = workspaceTools({
      cwd: dir,
      profile: INSTRUCTOR_TOOL_PROFILE,
      signal: ctrl.signal,
      approve: (a) => humanWait.track(() => answerUnlessTurnEnds(pending, ctrl.signal, false)),
    });
    const writing = work.call("Write", { file_path: "course.html", content: "new course" }).then(() => "wrote", () => "refused");
    await flush();
    assert.equal(humanWait.active(), true, "the approval wait is counted while the person answers");
    ctrl.abort();
    answer(true);
    assert.equal(await writing, "refused");
    assert.equal(existsSync(path.join(dir, "course.html")), false, "the write did not run");
    assert.equal(humanWait.active(), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

await t("a dialog left open when the turn fails (not aborted by the user) is denied when answered later", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "hps-human-wait-err-"));
  try {
    // ctrl is the user's stop button: it stays open here. The turn ends by an error, which aborts turnEnded.
    const ctrl = new AbortController();
    const turnEnded = new AbortController();
    let pick;
    const dialog = new Promise((resolve) => { pick = resolve; });
    const decided = confirmUnlessTurnEnds(dialog, AbortSignal.any([ctrl.signal, turnEnded.signal]), "계속");
    try {
      throw new Error("runner exited");
    } catch {
      // the turn fails here
    } finally {
      turnEnded.abort();
    }
    pick("계속");
    const yes = await decided;
    if (yes) await work(dir);
    assert.equal(ctrl.signal.aborted, false, "the user never pressed stop");
    assert.equal(yes, false, "a late 계속 after the turn failed is not a yes");
    assert.equal(existsSync(path.join(dir, "course.html")), false, "the overwrite did not run");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

await t("an approval during an open turn still writes the file", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "hps-human-wait-ok-"));
  try {
    const ctrl = new AbortController();
    const humanWait = createHumanWait();
    const work = workspaceTools({
      cwd: dir,
      profile: INSTRUCTOR_TOOL_PROFILE,
      signal: ctrl.signal,
      approve: (a) => humanWait.track(() => answerUnlessTurnEnds(Promise.resolve(true), ctrl.signal, false)),
    });
    await work.call("Write", { file_path: "course.html", content: "new course" });
    assert.equal(existsSync(path.join(dir, "course.html")), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

if (failed > 0) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nall human-wait checks passed");
