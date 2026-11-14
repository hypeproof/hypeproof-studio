// #4102 — wiring of the rehearsal checklist. "학생 말 넣기" only fills the composer: its callback never reaches a send.
// The lesson step panel's send carries the marked checklist. The host sends the panel only with the rehearsal signal.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
let failed = 0;
async function t(name, fn) {
  try { fn(); console.log(`  ok   ${name}`); }
  catch (err) { failed++; console.log(`  FAIL ${name}\n       ${err && err.message}`); }
}
const panel = read("webview-ui/src/ChatPanel.tsx");
const lesson = read("webview-ui/src/LessonStepPanel.tsx");
const provider = read("src/chatPanelProvider.ts");
const contract = read("src/chalkContract.ts");

// The body of insertExpected, from its definition to the next statement that starts the banner.
const insertBody = panel.slice(panel.indexOf("const insertExpected = (text: string) => {"), panel.indexOf("const updateBannerCore"));

await t("학생 말 넣기 fills the composer and never sends (no send, no post in its body)", () => {
  assert.match(insertBody, /setDraft\(current => prefillWithTip\(current, text\)\)/);
  assert.doesNotMatch(insertBody, /onSend|handleSend|postToHost|post\(|send\(/);
});

await t("the checklist button calls the insert callback only", () => {
  assert.match(panel, /<button type="button" className="hp-cta-quiet" onClick=\{\(\) => onInsert\?\.\(stuck\.expected_stuck\)\}>\{INSERT_BUTTON\}<\/button>/);
});

await t("the lesson step panel's rehearsal send carries the marked checklist", () => {
  assert.match(lesson, /type: "rehearsalSend", steps: .*checklist: checklistSnapshot\(\) \}/);
});

await t("the host sends the rehearsal panel only with the rehearsal signal", () => {
  assert.match(provider, /\.\.\.\(seatBand \? \{ rehearsalSeat: true, rehearsalPanel: await this\.rehearsalPanelFor\(profile, local\?\.model\) \} : \{\}\)/);
});

await t("the host passes the checklist of the rehearsal send to the report", () => {
  assert.match(provider, /case "rehearsalSend": \{\s*await this\.sendRehearsalReport\(msg\.steps, msg\.mission, msg\.checklist\);/);
  assert.match(provider, /checklistForReport\(checklist, await rehearsalStucksAt/);
  assert.match(provider, /\}, mission, marked\);/);
});

await t("the contract command passes the stucks it sanitises to the seat entry", () => {
  assert.match(contract, /stucks: sanitizeStucks\(a\.stucks\)/);
});

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log("\nall rehearsal-checklist-wiring checks passed");
