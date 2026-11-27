// #3563 — the Chalk instructor tab flag. Pure helper checks, the byte-identical config for legacy and
// student seats, the palette `when` clauses, and the host wiring. No vscode module is loaded.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chalkInstructorTabField, CHALK_INSTRUCTOR_TAB_COMMAND } from "../src/chalkInstructorTab.ts";

let failed = 0;
function t(name, fn) {
  try { fn(); console.log(`  ok   ${name}`); }
  catch (err) { failed++; console.log(`  FAIL ${name}\n       ${err && err.message}`); }
}
const root = new URL("..", import.meta.url);
const read = (rel) => readFileSync(new URL(rel, root), "utf8");

t("instructor → the flag is true", () => {
  assert.deepEqual(chalkInstructorTabField(true), { chalkInstructorTab: true });
});
t("student → no flag", () => {
  assert.deepEqual(chalkInstructorTabField(false), {});
});
t("the command id is the Chalk instructor panel", () => {
  assert.equal(CHALK_INSTRUCTOR_TAB_COMMAND, "hypeproof.chalk.openInstructorPanel");
});
t("byte-identical config when the flag is absent (student)", () => {
  const base = { classWindow: null, turnTools: { a: 1 }, isInstructor: false };
  const withSpread = { ...chalkInstructorTabField(false), ...base };
  assert.equal(JSON.stringify(withSpread), JSON.stringify(base));
});
t("the flag is the only added key when it is true", () => {
  const base = { classWindow: null };
  assert.equal(JSON.stringify({ ...chalkInstructorTabField(true), ...base }), JSON.stringify({ chalkInstructorTab: true, classWindow: null }));
});

const pkg = JSON.parse(read("package.json"));
const palette = pkg.contributes.menus.commandPalette;
t("the three Studio Chalk commands are gone (C-5: the Chalk extension owns the instructor screen)", () => {
  for (const command of ["hypeproof-chat.chalk.checkPlan", "hypeproof-chat.chalk.openCourse", "hypeproof-chat.chalk.savePlan"]) {
    assert.equal(palette.find((e) => e.command === command), undefined, command);
  }
});
t("setInstructorToken keeps its token entry (no when clause)", () => {
  const entry = palette.find((e) => e.command === "hypeproof-chat.chalk.setInstructorToken");
  assert.ok(!entry || entry.when === undefined, "setInstructorToken is not hidden");
});
t("the instructorRuntime setting is removed (C-5: one runtime)", () => {
  assert.equal(pkg.contributes.configuration.properties["hypeproofChat.instructorRuntime"], undefined);
});

t("protocol: ChatConfig has the optional flag and the webview message exists", () => {
  const protocol = read("src/protocol.ts");
  assert.match(protocol, /chalkInstructorTab\?: true;/);
  assert.match(protocol, /\{ type: "openChalkInstructorPanel" \}/);
});
t("host: postConfig spreads the flag and the message opens the Chalk tab after a presence check", () => {
  const host = read("src/chatPanelProvider.ts");
  assert.match(host, /\.\.\.chalkInstructorTab,/);
  assert.match(host, /case "openChalkInstructorPanel":/);
  assert.match(host, /getExtension\(CHALK_EXTENSION_ID\)/);
  assert.match(host, /executeCommand\(CHALK_INSTRUCTOR_TAB_COMMAND\)/);
});
t("webview: the notice is shown before the student start screen and only for the flag", () => {
  const panel = read("webview-ui/src/ChatPanel.tsx");
  const notice = panel.indexOf("if (config?.chalkInstructorTab)");
  const start = panel.indexOf("if (!config) return <>{updateBanner}<DisconnectedChat");
  assert.ok(notice > 0 && start > notice, "notice branch precedes the start screen");
});

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log("\nchalk-instructor-tab smoke: all ok");
