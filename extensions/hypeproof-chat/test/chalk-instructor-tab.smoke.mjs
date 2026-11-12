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

t("chalk-extension + instructor → the flag is true", () => {
  assert.deepEqual(chalkInstructorTabField("chalk-extension", true), { chalkInstructorTab: true });
});
t("chalk-extension + student → no flag", () => {
  assert.deepEqual(chalkInstructorTabField("chalk-extension", false), {});
});
t("legacy + instructor → no flag", () => {
  assert.deepEqual(chalkInstructorTabField("legacy", true), {});
});
t("unset runtime + instructor → no flag (default is legacy)", () => {
  assert.deepEqual(chalkInstructorTabField(undefined, true), {});
});
t("the command id is the Chalk instructor panel", () => {
  assert.equal(CHALK_INSTRUCTOR_TAB_COMMAND, "hypeproof.chalk.openInstructorPanel");
});
t("byte-identical config when the flag is absent (legacy and student)", () => {
  const base = { classWindow: null, turnTools: { a: 1 }, isInstructor: false };
  for (const [runtime, instructor] of [["legacy", true], ["chalk-extension", false], [undefined, false]]) {
    const withSpread = { ...chalkInstructorTabField(runtime, instructor), ...base };
    assert.equal(JSON.stringify(withSpread), JSON.stringify(base), `runtime=${runtime} instructor=${instructor}`);
  }
});
t("the flag is the only added key when it is true", () => {
  const base = { classWindow: null };
  assert.equal(JSON.stringify({ ...chalkInstructorTabField("chalk-extension", true), ...base }), JSON.stringify({ chalkInstructorTab: true, classWindow: null }));
});

const pkg = JSON.parse(read("package.json"));
const palette = pkg.contributes.menus.commandPalette;
const when = "config.hypeproofChat.instructorRuntime != 'chalk-extension'";
t("the three Studio Chalk commands are hidden in the chalk-extension runtime", () => {
  for (const command of ["hypeproof-chat.chalk.checkPlan", "hypeproof-chat.chalk.openCourse", "hypeproof-chat.chalk.savePlan"]) {
    const entry = palette.find((e) => e.command === command);
    assert.ok(entry, `${command} has a palette entry`);
    assert.equal(entry.when, when, command);
  }
});
t("setInstructorToken keeps its token entry (no when clause)", () => {
  const entry = palette.find((e) => e.command === "hypeproof-chat.chalk.setInstructorToken");
  assert.ok(!entry || entry.when === undefined, "setInstructorToken is not hidden");
});
t("the instructorRuntime default is legacy", () => {
  assert.equal(pkg.contributes.configuration.properties["hypeproofChat.instructorRuntime"].default, "legacy");
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
