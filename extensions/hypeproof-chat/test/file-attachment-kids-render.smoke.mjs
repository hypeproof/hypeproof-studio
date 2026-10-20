// CGP-CHAT-R-011 — a kids classroom seat (REQ-M32: sdk_tools.read on, lesson on) with file attach
// granted renders the real ChatPanel through the SX render instrument: the file-only tool menu
// trigger appears in the classroom composer (no data-expanded, so the 44px classroom rule applies),
// with the chip when a file is queued. Existing A5/SX digests are untouched: they never set fileAttach.
// Run: node --experimental-strip-types test/file-attachment-kids-render.smoke.mjs

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { rendererStatus, renderComponent, visibleText } from "./sx-render.mjs";
import { chatConfig, chatPanelProps, resolvedProfile, noop } from "./sx-screen-fixtures.mjs";

const status = rendererStatus();
if (!status.available) {
  console.log(`NOT RUN file-attachment-kids-render: ${status.detail ?? status.reason}`);
  process.exit(0);
}

const kidsProfile = resolvedProfile(3, { minor_cohort: true, sdk_tools: { read: true, write: true }, coach_runtime: "agent-sdk" });
const kids = (fileAttach) => chatPanelProps({
  config: chatConfig(3, { profile: kidsProfile, ...(fileAttach ? { fileAttach: true } : {}) }),
  instructor: false,
  onAttachFile: noop,
  onRemoveFileAttachment: noop,
});

const granted = await renderComponent("ChatPanel", kids(true));
const trigger = /<button[^>]*class="hps-tool-trigger"[^>]*aria-label="도구 열기"[^>]*>/.exec(granted)?.[0];
assert.ok(trigger, "kids classroom seat with the grant shows the tool trigger");
const input = /<div class="hps-input(?: hps-input-drag)?"[^>]*>/.exec(granted)?.[0] ?? "";
assert.ok(input && !/data-expanded/.test(input), "classroom composer has no data-expanded, so the classroom 44px rule applies");
const css = readFileSync(new URL("../webview-ui/src/styles.css", import.meta.url), "utf8");
assert.match(css, /\.hps-input:not\(\[data-expanded\]\) > \.hps-composer-tools \.hps-tool-trigger \{[^}]*min-width: 44px; min-height: 44px;/, "44px trigger rule");

// Negative control: the same kids seat without the grant has no tool menu.
assert.ok(!(await renderComponent("ChatPanel", kids(false))).includes('aria-label="도구 열기"'), "no grant, no trigger");

const withFile = await renderComponent("ChatPanel", { ...kids(true), fileAttachment: { path: "내 이야기.txt", text: "옛날 옛적에", bytes: 18 } });
const text = visibleText(withFile);
assert.ok(text.includes("파일 · 내 이야기.txt") && text.includes("옛날 옛적에") && text.includes("빼기"), "chip on the kids seat");

console.log("file-attachment-kids-render OK");
