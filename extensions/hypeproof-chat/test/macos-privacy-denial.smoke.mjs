// #3221 part 4 — when macOS's privacy protection (TCC) refuses a file the coach's file tool opens, the step says so in
// Korean with a button to System Settings › Privacy & Security › Files and Folders, instead of the generic
// "이 동작을 마치지 못했어요. 이유를 확인하지 못했어요." The URL is fixed in the host; the webview only asks.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { denialNotice, denialNoticeLabel, denialNoticeView, storedDenialNotice, macPrivacyBlocked, MAC_PRIVACY_FILES_URL, FILE_TOOL_NAMES } from "../src/denialNotice.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const TEXT = "macOS가 이 폴더 접근을 막았어요. 시스템 설정 › 개인정보 보호 및 보안 › 파일 및 폴더에서 HypeProof Studio를 켜 주세요.";

// The CLI's error text for a TCC refusal, and its look-alikes.
assert.equal(macPrivacyBlocked("EPERM: operation not permitted, open '/Users/a/Downloads/x.html'", "darwin"), true);
assert.equal(macPrivacyBlocked("Error: Operation not permitted", "darwin"), true);
assert.equal(macPrivacyBlocked("EPERM: operation not permitted, open 'x'", "win32"), false, "macOS only");
assert.equal(macPrivacyBlocked("EACCES: permission denied, open 'x'", "darwin"), false, "a plain permission problem is not TCC");
assert.equal(macPrivacyBlocked("ENOENT: no such file", "darwin"), false);
assert.equal(macPrivacyBlocked(undefined, "darwin"), false);
assert.ok(FILE_TOOL_NAMES.has("Read") && FILE_TOOL_NAMES.has("Write") && !FILE_TOOL_NAMES.has("Bash"), "a shell's EPERM (kill, chflags) is not read as TCC");

for (const classroom of [false, true]) {
  const d = denialNotice("runtime", classroom, "macos_privacy");
  assert.deepEqual(d, { source: "runtime", classroom, detail: "macos_privacy" });
  const view = denialNoticeView(d);
  assert.equal(view.text, TEXT); assert.equal(view.action, "macOS 설정 열기"); assert.equal(view.settings, true);
  assert.deepEqual(storedDenialNotice(denialNoticeLabel(d)), { source: "runtime", classroom: false, detail: "macos_privacy" }, "the saved step decodes back");
}
// Negative controls: the detail belongs to runtime only; other notices keep 문제 신고하기 and no settings button.
assert.deepEqual(denialNotice("safety", false, "macos_privacy"), { source: "safety", classroom: false });
assert.equal(denialNoticeView(denialNotice("runtime")).action, "문제 신고하기");
assert.equal("settings" in denialNoticeView(denialNotice("safety", false, "outside_folder")), false);
assert.equal(MAC_PRIVACY_FILES_URL, "x-apple.systempreferences:com.apple.preference.security?Privacy_FilesAndFolders");

// Wiring: the host maps only file-tool EPERM to the detail and opens the fixed URL on macOS; the button asks the host.
const host = fs.readFileSync(path.join(here, "../src/chatPanelProvider.ts"), "utf8");
assert.match(host, /fileToolCalls\.has\(a\.id\) && macPrivacyBlocked\(a\.reason, process\.platform\)/);
assert.match(host, /case "openMacPrivacySettings":\s*\n\s*\/\/[^\n]*\n\s*if \(process\.platform === "darwin"\) void vscode\.env\.openExternal\(vscode\.Uri\.parse\(MAC_PRIVACY_FILES_URL\)\);/);
const panel = fs.readFileSync(path.join(here, "../webview-ui/src/ChatPanel.tsx"), "utf8");
assert.match(panel, /'settings' in view \? \(\) => postToHost\(\{ type: "openMacPrivacySettings" \}\) : onReport/);
console.log("macos-privacy-denial: ok");
