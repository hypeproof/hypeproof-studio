import { readDesignFile as readFileSync } from "./lib/design-token-values.mjs";
// CGP-DS-R-027 / CGP-DS-R-028 — Korean input and reading comfort in the chat webview.
//   node --experimental-strip-types test/korean-input.smoke.mjs
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";

const { imeComposing } = await import("../webview-ui/src/imeGuard.ts");
const ev = (nativeEvent) => ({ nativeEvent });

// Positive: every composition signal counts.
assert.equal(imeComposing(ev({ isComposing: true, keyCode: 13 })), true);
assert.equal(imeComposing(ev({ isComposing: false, keyCode: 229 })), true, "legacy 229 signal");
assert.equal(imeComposing(ev({ keyCode: 27 }), true), true, "compositionstart state");
// Negative control: a plain Enter/Escape is not composition.
assert.equal(imeComposing(ev({ isComposing: false, keyCode: 13 })), false);
assert.equal(imeComposing(ev({ keyCode: 27 })), false);

// Every Enter/Escape handler in the chat webview's composer, menus, dialogs and panels checks
// composition first. A handler without the guard would send, close or dismiss mid-syllable.
// Scan every webview component, not a hand-picked list: a missed file is how a gap slips in.
// Handlers on controls with no text entry (menu buttons, voice controls) cannot see composition.
const NO_TEXT_ENTRY = { "ComposerTools.tsx": "tool menu buttons only", "VoicePanel.tsx": "voice controls only" };
const files = readdirSync(new URL("../webview-ui/src/", import.meta.url)).filter((f) => f.endsWith(".tsx") && !(f in NO_TEXT_ENTRY));
assert.ok(files.includes("InstructorChatPanel.tsx") && files.includes("ChatPanel.tsx"), "scan covers the chat panels");
for (const f of files) {
  const src = readFileSync(new URL(`../webview-ui/src/${f}`, import.meta.url), "utf8");
  const lines = src.split("\n");
  lines.forEach((line, i) => {
    if (!/key [!=]== ['"](Escape|Enter)['"]/.test(line)) return;
    const window = lines.slice(Math.max(0, i - 12), i + 1).join("\n");
    assert.match(window, /imeComposing\(|isComposing\b/, `${f}:${i + 1} handles ${line.trim().slice(0, 60)} without an IME guard`);
  });
}
const panel = readFileSync(new URL("../webview-ui/src/ChatPanel.tsx", import.meta.url), "utf8");
assert.match(panel, /if \(isComposing\) \{ e\.stopPropagation\(\); return; \}/, "composer keeps composition keys from ancestor handlers");
assert.doesNotMatch(panel, /nativeEvent\.isComposing\)/, "no handler checks isComposing without the 229 fallback");

// Korean prose breaks between eojeol, not mid-word, and long tokens still wrap.
const css = readFileSync(new URL("../webview-ui/src/styles.css", import.meta.url), "utf8");
const rule = /\.hps-msg-body, \.hps-prose[^{]*\{\s*word-break: keep-all;\s*overflow-wrap: anywhere;\s*\}/.exec(css);
assert.ok(rule, "prose rule with keep-all + overflow-wrap");
const details = readFileSync(new URL("../webview-ui/src/chatDetails.css", import.meta.url), "utf8");
assert.match(details, /data-chat-detail="personal"\] \.hps-msg-body \{ word-break: keep-all; \}/, "personal prose too");

console.log("korean-input smoke OK");
