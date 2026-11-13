// CGP-SHELL-R-003 (REQ-SHELL-03) — a cohort's update freeze hides the update banner for its range, says
// "선생님이 업데이트 시점을 정했어요" in the update UI, and never holds a security-critical release.
// Pure rule + the real ChatPanel rendered with react-dom/server + the host wiring read from source.

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { ChatPanel, UpdateFreezeLine } from "../webview-ui/src/ChatPanel";
import {
  SECURITY_CRITICAL_MARKER, chatUpdateOffer, freezeHoldsUpdate, isSecurityCriticalRelease, parseLatestRelease,
  updateFreeze, updateFreezeCopy, UPDATE_FREEZE_COPY,
} from "../src/updateCheckerHelpers";
import type { ChatConfig } from "../src/protocol";

(globalThis as unknown as Record<string, unknown>).window = { acquireVsCodeApi: undefined };

let fail = 0;
const t = (label: string, fn: () => void) => {
  try { fn(); console.log(`  ok   ${label}`); } catch (e) { console.error(`  FAIL ${label}: ${(e as Error).message}`); fail++; }
};
const ok = (v: unknown, m: string) => { if (!v) throw new Error(m); };

// 2026-10-21 00:30 KST; the Service serves `starts_at`/`ends_at` for the Korea calendar days.
const NOW = Date.parse("2026-10-20T15:30:00Z");
const RANGE = { from: "2026-10-21", until: "2026-10-31", starts_at: "2026-10-20T15:00:00.000Z", ends_at: "2026-10-31T15:00:00.000Z" };
const classroom = (update_freeze: unknown) => ({ activity_kind: "classroom", update_freeze });

t("a classroom seat inside the range is frozen until its last day", () => {
  const f = updateFreeze(classroom(RANGE), NOW);
  ok(f?.until === "2026-10-31", JSON.stringify(f));
  ok(updateFreeze(classroom(RANGE), Date.parse("2026-10-31T14:59:59Z"))?.until === "2026-10-31", "the last day counts until midnight KST");
});
t("negative controls: personal, trial and pass seats, past, future, missing and malformed ranges are no freeze", () => {
  for (const p of [{ activity_kind: "personal", update_freeze: RANGE }, { activity_kind: "trial", update_freeze: RANGE }, { activity_kind: "classroom", pass: { ends_at: 1 }, update_freeze: RANGE }])
    ok(updateFreeze(p, NOW) === null, "not a cohort seat: " + JSON.stringify(p));
  ok(updateFreeze(classroom(RANGE), Date.parse("2026-10-31T15:00:00Z")) === null, "after the range");
  ok(updateFreeze(classroom(RANGE), Date.parse("2026-10-20T14:59:59Z")) === null, "before the range");
  for (const bad of [undefined, null, {}, { ...RANGE, until: "10/31" }, { ...RANGE, ends_at: "soon" }, { ...RANGE, starts_at: undefined }, "frozen"])
    ok(updateFreeze(classroom(bad), NOW) === null, "malformed: " + JSON.stringify(bad));
  ok(updateFreeze(null, NOW) === null && updateFreeze(undefined, NOW) === null, "no profile");
});
t("a freeze holds every release except a security-critical one", () => {
  const f = { until: "2026-10-31" };
  ok(freezeHoldsUpdate(f, { version: "9.9.9" } as never) === true, "plain release held");
  ok(freezeHoldsUpdate(f, null) === true, "no release info: held");
  ok(freezeHoldsUpdate(f, { securityCritical: true }) === false, "security-critical overrides");
  ok(freezeHoldsUpdate(null, { version: "9.9.9" } as never) === false, "no freeze holds nothing");
});
t("the security marker is read from the release notes, on its own line, and hidden from the notes", () => {
  ok(SECURITY_CRITICAL_MARKER === "<!-- hps-update: security-critical -->", "marker");
  const release = (body: string) => ({ tag_name: "v9.9.9", draft: false, prerelease: false, html_url: "https://github.com/x", body,
    assets: [{ name: "HypeProof-Studio-darwin-arm64.zip", url: "https://github.com/a", size: 1, digest: "sha256:" + "a".repeat(64) }] });
  const info = parseLatestRelease(release("고친 점\n\n" + SECURITY_CRITICAL_MARKER + "\n") as never, "1.0.0", assets => assets[0]);
  ok(info.available && info.securityCritical === true, "marked release: " + JSON.stringify(info));
  ok(!info.notes.includes("hps-update"), "the marker never reaches the learner's notes: " + info.notes);
  const plain = parseLatestRelease(release("보안 수정 포함") as never, "1.0.0", assets => assets[0]);
  ok(plain.available && plain.securityCritical === undefined && plain.notes === "보안 수정 포함", "words are not the marker; notes unchanged");
  ok(!isSecurityCriticalRelease("see " + SECURITY_CRITICAL_MARKER + " inline") && !isSecurityCriticalRelease(undefined), "line on its own only");
});
t("copy: who decided and until when", () => {
  ok(UPDATE_FREEZE_COPY === "선생님이 업데이트 시점을 정했어요.", UPDATE_FREEZE_COPY);
  ok(updateFreezeCopy({ until: "2026-10-31" }) === "선생님이 업데이트 시점을 정했어요. 10월 31일까지 지금 버전을 써요.", updateFreezeCopy({ until: "2026-10-31" }));
});

// ── Render: the settings line and the banner ────────────────────────────────────────────────────
t("the settings line: lock icon + the sentence, read-only", () => {
  const html = renderToStaticMarkup(<UpdateFreezeLine until="2026-10-31" />);
  ok(html.includes('class="hps-update-freeze"') && html.includes('role="note"'), html);
  ok(html.includes("선생님이 업데이트 시점을 정했어요. 10월 31일까지 지금 버전을 써요."), html);
  ok(html.includes("<svg") && !html.includes("<button"), "icon + text, nothing to press");
});
const noop = () => {};
const PROPS = {
  messages: [], streaming: false, streamingId: null, error: null, errorRequestId: null, errorRunbookUrl: null, canRetryLast: false,
  pageNotice: null, aiNotice: null, stopNotice: null, openWorldId: null, publish: null, incomingImage: null,
  onSend: noop, onRetry: noop, onRetryLast: noop, onDismissError: noop, onCancel: noop, onClear: noop,
  onSetToken: noop, onSettings: noop, onRunCode: noop, onNamingRitual: noop, onSaveCoach: noop,
  onReportProblem: noop, onInstallUpdate: noop, onDismissUpdate: noop, onPublish: noop,
};
const UX = {
  coach: { naming_mode: "fixed" as const, fallback_name: "HypeProof", naming_prompt_md: "", personality_prompt_md: "" },
  suggestions: { initial: [], follow_up: [] },
  hints: { short_input: { enabled: false, min_chars: 0, message_md: "" }, roll_input_button: { enabled: false, label: "", probe_md: "" } },
  retry_button: { enabled: false, show_counter: false },
};
const config = (update: unknown) => ({
  model: "claude-sonnet-5", hasToken: true, proxyUrl: "http://localhost:8787",
  coach: { name: "HypeProof", personality: "", configured: true },
  profile: { profile_id: "class-a", activity_kind: "classroom", observation: null, lesson: null, rehearsal: null, welcome: { greeting_md: "안녕하세요" }, model_selection: null, ux: UX },
  activity: { id: "a1", name: "수업", kind: "classroom", workspace: "/tmp/w", verified: true },
  update,
  updateFreeze: { until: "2026-10-31" },
}) as unknown as ChatConfig;
const render = (c: ChatConfig) => renderToStaticMarkup(<ChatPanel {...PROPS} config={c} instructor={false} />);
t("frozen (the host sends no offer): no banner and no held line", () => {
  const html = render(config(undefined));
  ok(!html.includes("hps-update-banner") && !html.includes("hps-update-line"), "a banner was drawn inside the freeze");
});
t("security-critical inside the freeze: the class seat's held line, labelled 보안 업데이트", () => {
  const html = render(config({ version: "9.9.9", notes: "", releaseUrl: "https://example.org/r", sizeBytes: 0, heldForClass: true, securityCritical: true }));
  ok(html.includes("보안 업데이트 v9.9.9") && html.includes("수업이 끝나면 설치할 수 있어요."), html.slice(0, 400));
});
t("security-critical outside class: the full banner is labelled 보안 업데이트 and keeps its install", () => {
  const html = render(config({ version: "9.9.9", notes: "", releaseUrl: "https://example.org/r", sizeBytes: 0, heldForClass: false, securityCritical: true }));
  ok(html.includes("보안 업데이트 v9.9.9 나왔어요"), "full banner not labelled");
  ok(html.includes("hps-update-banner-install"), "install button missing");
});
t("the chat offer: hidden inside the freeze, back for a security release with the class hold still on", () => {
  const offer = { version: "9.9.9", notes: "", releaseUrl: "https://example.org/r", sizeBytes: 0 };
  const cls = classroom(RANGE);
  ok(chatUpdateOffer(offer, cls, null, NOW) === undefined, "frozen offer was sent");
  const sec = chatUpdateOffer({ ...offer, securityCritical: true }, cls, null, NOW);
  ok(sec?.securityCritical === true && sec.heldForClass === true, "security release on a class seat must stay held for class: " + JSON.stringify(sec));
  const after = chatUpdateOffer(offer, cls, null, Date.parse("2026-11-01T00:00:00Z"));
  ok(after?.heldForClass === true, "after the range: the ordinary class hold");
  const personal = chatUpdateOffer({ ...offer, securityCritical: true }, { activity_kind: "personal", update_freeze: RANGE }, null, NOW);
  ok(personal?.heldForClass === false, "personal seat: not held");
  ok(chatUpdateOffer(null, cls, null, NOW) === undefined, "no offer");
});
t("positive control: an ordinary offer outside a freeze keeps its wording", () => {
  const html = render(config({ version: "9.9.9", notes: "", releaseUrl: "https://example.org/r", sizeBytes: 0, heldForClass: false }));
  ok(html.includes("새 버전 v9.9.9 나왔어요") && !html.includes("보안 업데이트"), "banner wording changed");
});

// ── Host wiring (src): the gates sit on the real paths ─────────────────────────────────────────
const provider = readFileSync("src/chatPanelProvider.ts", "utf8") /* npm runs this from extensions/hypeproof-chat */;
const ext = readFileSync("src/extension.ts", "utf8");
const start = readFileSync("src/startPage.ts", "utf8");
t("the chat config drops the offer inside the freeze unless security-critical, and sends the freeze for the settings line", () => {
  ok(provider.includes("update: local ? undefined : chatUpdateOffer(this.availableUpdate, profile, activity),"), "config gate missing");
  ok(/updateFreeze: updateFreeze\(profile\)!/.test(provider), "freeze not sent");
});
t("the manual check and the install command say who decided; staging is held too", () => {
  const check = ext.slice(ext.indexOf('registerCommand("hypeproof-chat.checkForUpdates"'), ext.indexOf('registerCommand("hypeproof-chat.installUpdate"'));
  ok(check.includes("provider.isUpdateFrozen(info)") && check.includes("updateFreezeCopy(freeze)"), "manual check");
  const install = ext.slice(ext.indexOf('registerCommand("hypeproof-chat.installUpdate"'));
  ok(install.indexOf("provider.isUpdateFrozen(info)") > -1 && install.indexOf("provider.isUpdateFrozen(info)") < install.indexOf("await runUpdate("), "install not held before runUpdate");
  ok(install.indexOf("updateFreezeCopy(freeze) : CLASS_UPDATE_HOLD_COPY") > -1 && install.indexOf("updateFreezeCopy(freeze) : CLASS_UPDATE_HOLD_COPY") < install.indexOf("checkForUpdates("), "a held class seat inside the freeze is told who decided, before any check");
  ok(/classHeld: \(info\) => provider\.isClassUpdateHeld\(\) \|\| provider\.isUpdateFrozen\(info \?\? null\)/.test(ext), "staging not held");
  ok(start.includes("this.chat.isUpdateFrozen?.(offer)"), "start page notice");
});

if (fail) { console.error(`cohort-update-freeze: ${fail} failed`); process.exit(1); }
console.log("cohort-update-freeze OK");
