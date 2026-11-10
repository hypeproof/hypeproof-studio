// DEC-30 step 3 (CGP-KNOW-R-037 learner side, CGP-KNOW-D-037) — the real ChatPanel on the minimal DOM: the served
// starters are chips above the composer, a click inserts into the draft and never sends, a manual draft is kept,
// the chips go once the learner has sent in the task, and a lesson without starters renders byte-identical.
// Bundled with esbuild and run with plain Node (scripts/run-tsx-tests.mjs).

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { click, mountPoint } from "./fixtures/mini-dom.mjs";
import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatPanel } from "../webview-ui/src/ChatPanel";
import { learnerHasSent, servedAssistantRole, servedLessonStarters } from "../src/lessonStarters";
import type { ChatConfig } from "../src/protocol";

const act: (fn: () => unknown) => Promise<void> = (React as unknown as { act: (fn: () => unknown) => Promise<void> }).act;
let fail = 0;
const tests: [string, () => void | Promise<void>][] = [];
const t = (label: string, fn: () => void | Promise<void>) => tests.push([label, fn]);
const ok = (v: unknown, m: string) => { if (!v) throw new Error(m); };
const eq = (a: unknown, b: unknown, m = "") => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); };

const noop = () => {};
const UX = {
  coach: { naming_mode: "fixed" as const, fallback_name: "HypeProof", naming_prompt_md: "", personality_prompt_md: "" },
  suggestions: { initial: [], follow_up: [] },
  hints: { short_input: { enabled: false, min_chars: 0, message_md: "" }, roll_input_button: { enabled: false, label: "", probe_md: "" } },
  retry_button: { enabled: false, show_counter: false },
};
const STARTERS = ["오늘 배울 내용을 쉬운 말로 알려 줘", "내가 이해했는지 질문해 줘", "예시를 하나만 보여 줘"];
const config = (extra: Record<string, unknown> = {}) => ({
  model: "claude-sonnet-5", hasToken: true, proxyUrl: "http://localhost:8787",
  coach: { name: "HypeProof", personality: "", configured: true },
  profile: { profile_id: "class-a", activity_kind: "classroom", observation: null, lesson: null, rehearsal: null, welcome: { greeting_md: "안녕하세요" }, model_selection: null, ux: UX, ...extra },
  activity: { id: "a1", name: "수업", kind: "classroom", workspace: "/tmp/w", verified: true },
}) as unknown as ChatConfig;
const PROPS = {
  messages: [], streaming: false, streamingId: null, error: null, errorRequestId: null, errorRunbookUrl: null, canRetryLast: false,
  pageNotice: null, aiNotice: null, stopNotice: null, openWorldId: null, publish: null, incomingImage: null,
  onSend: noop, onRetry: noop, onRetryLast: noop, onDismissError: noop, onCancel: noop, onClear: noop,
  onSetToken: noop, onSettings: noop, onRunCode: noop, onNamingRitual: noop, onSaveCoach: noop,
  onReportProblem: noop, onInstallUpdate: noop, onDismissUpdate: noop, onPublish: noop,
};
const html = (cfg: ChatConfig, extra: Record<string, unknown> = {}) =>
  renderToStaticMarkup(<ChatPanel {...(PROPS as never)} {...extra} config={cfg} instructor={false} />);
const userMsg = { id: "u1", role: "user", content: "안녕", createdAt: 1 };

type El = {
  getAttribute(n: string): string | null; hasAttribute(n: string): boolean; textContent: string; value: string; localName: string;
  findAll(test: (e: El) => boolean): El[]; dispatchEvent(e: unknown): boolean;
};
const mounted: Root[] = [];
{
  const proto = Object.getPrototypeOf(mountPoint());
  if (!("options" in proto)) Object.defineProperty(proto, "options", { get(this: El) { return this.findAll((e) => e.localName === "option"); } });
}
async function harness(cfg: ChatConfig, extra: Record<string, unknown> = {}) {
  const sent: string[] = [];
  const host = mountPoint() as unknown as El;
  const root = createRoot(host as unknown as HTMLElement);
  mounted.push(root);
  const props = { ...PROPS, onSend: (text: string) => { sent.push(text); }, config: cfg, instructor: false, ...extra };
  await act(async () => { root.render(<ChatPanel {...(props as never)} />); });
  const textarea = () => host.findAll((e) => e.localName === "textarea")[0];
  const chips = () => host.findAll((e) => (e.getAttribute("class") ?? "").split(" ").includes("hps-lesson-starter"));
  return {
    sent, chips,
    group: () => host.findAll((e) => e.hasAttribute("data-lesson-starters"))[0],
    draft: () => textarea().value,
    type: async (text: string) => { const ta = textarea(); await act(async () => { ta.value = text; ta.dispatchEvent({ type: "input", bubbles: true, cancelable: true, preventDefault() {}, stopPropagation() {} }); }); },
    press: async (el: El) => act(async () => { click(el); }),
  };
}

t("served starters are drawn as chips above the composer, in order, as plain keyboard-reachable buttons", () => {
  const out = html(config({ starters: STARTERS }));
  ok(out.includes('data-lesson-starters="3"'), "group missing");
  let last = -1;
  for (const s of STARTERS) { const at = out.indexOf(`>${s}</button>`); ok(at > last, `order of ${s}`); last = at; }
  ok(out.indexOf("hps-lesson-starters") < out.indexOf("<textarea"), "chips are not above the composer");
  const group = /<div class="hps-lesson-starters"[\s\S]*?<\/ul><\/div>/.exec(out)?.[0] ?? "";
  eq((group.match(/<button type="button" class="hps-lesson-starter"/g) ?? []).length, 3, "button count");
  ok(!/tabindex="-1"|role="button"|<a /.test(group), "not a plain button");
});

t("a click inserts the text into the draft and never sends", async () => {
  const h = await harness(config({ starters: STARTERS }));
  eq(h.chips().length, 3, "chips");
  await h.press(h.chips()[1]);
  eq(h.draft(), STARTERS[1], "inserted");
  eq(h.sent.length, 0, "nothing sent");
});

t("a manual draft is never overwritten", async () => {
  const h = await harness(config({ starters: STARTERS }));
  await h.type("내가 쓰던 글");
  await h.press(h.chips()[0]);
  ok(h.draft().startsWith("내가 쓰던 글"), `manual text lost: ${h.draft()}`);
  ok(h.draft().includes(STARTERS[0]), "starter not inserted");
  eq(h.sent.length, 0, "nothing sent");
});

t("a second chip replaces the first chip's text, not the learner's", async () => {
  const h = await harness(config({ starters: STARTERS }));
  await h.press(h.chips()[0]);
  await h.press(h.chips()[2]);
  eq(h.draft(), STARTERS[2], "the second chip replaced the first");
});

t("hidden once the learner has sent a message in the task; shown while only the coach has spoken", async () => {
  const h = await harness(config({ starters: STARTERS }), { messages: [userMsg] });
  eq(h.chips().length, 0, "chips remain after a send");
  eq(h.group(), undefined, "group remains");
  const coachOnly = await harness(config({ starters: STARTERS }), { messages: [{ id: "a1", role: "assistant", content: "안녕하세요", createdAt: 1 }] });
  eq(coachOnly.chips().length, 3, "negative control: coach-only shows chips");
  eq(learnerHasSent([{ role: "assistant" }, { role: "tool" }]), false);
  eq(learnerHasSent([{ role: "user" }]), true);
});

t("absent or empty starters render byte-identical to a lesson that never had them", () => {
  const base = html(config());
  eq(html(config({ starters: [] })) === base, true, "empty array differs");
  eq(html(config({ starters: undefined })) === base, true, "undefined differs");
  eq(html(config({ starters: ["", "  ", 5, null, "줄\n바꿈"] })) === base, true, "malformed starters differ");
  ok(!base.includes("hps-lesson-starter"), "markup without starters");
  ok(html(config({ starters: STARTERS })) !== base, "positive control: starters change the markup");
  // Starters are the only thing the new code reads: role and tone alone draw nothing.
  eq(html(config({ assistant_style: { role: "수학 도우미", tone: { id: "calm", label: "차분하게" } } })) === base, true, "assistant_style alone changed the UI");
});

t("a minor seat behaves the same: the chips come from the served starters, with no tone change", () => {
  const minor = html(config({ starters: STARTERS, minor_cohort: true, assistant_style: { tone_clamped: true } }));
  ok(minor.includes('data-lesson-starters="3"'), "minor seat lost the chips");
  const adult = html(config({ starters: STARTERS }));
  eq(/<div class="hps-lesson-starters"[\s\S]*?<\/ul><\/div>/.exec(minor)?.[0], /<div class="hps-lesson-starters"[\s\S]*?<\/ul><\/div>/.exec(adult)?.[0], "group differs by seat");
});

t("an instructor console draws no chips", () => {
  const out = renderToStaticMarkup(<ChatPanel {...(PROPS as never)} config={config({ starters: STARTERS })} instructor />);
  ok(!out.includes("hps-lesson-starter"), "instructor saw learner chips");
});

t("servedLessonStarters keeps at most four safe, distinct single lines", () => {
  eq(servedLessonStarters({ starters: ["가", " 가 ", "A", "ａ", "나", "다", "라", "마"] }), ["가", "A", "나", "다"], "dedupe NFKC/case, cap 4");
  eq(servedLessonStarters({ starters: ["x".repeat(81), "‮evil", "ok"] }), ["ok"], "length and bidi");
  eq(servedLessonStarters({ starters: "nope" }), [], "non-array");
  eq(servedLessonStarters(null), [], "null profile");
});

t("role comes from assistant_style only, never from the lesson content", () => {
  eq(servedAssistantRole({ assistant_style: { role: "수학 도우미" } }), "수학 도우미");
  eq(servedAssistantRole({ lesson: { content: { assistant: { role: "raw" } } } } as never), null, "raw lesson role read");
  eq(servedAssistantRole({ assistant_style: { role: "a\nb" } }), null, "multi-line role");
});

t("CSS: 44px targets, 14px floor and tokens only", () => {
  const css = readFileSync(resolve(process.cwd(), "webview-ui/src/styles.css"), "utf8");
  const rules = css.split("\n").filter((l) => l.startsWith(".hps-lesson-starter"));
  ok(rules.length > 5, "rules missing");
  const block = css.slice(css.indexOf(".hps-lesson-starters {"));
  const own = block.split("\n").filter((l) => /^\.hps-lesson-starter/.test(l) || /^  /.test(l)).join("\n");
  ok(/min-height: var\(--hp-control-min\)/.test(own) && /min-width: var\(--hp-control-min\)/.test(own), "44px token missing");
  ok(/font-size: var\(--hp-font-caption\)/.test(own), "14px caption token missing");
  ok(/flex-wrap: wrap/.test(own) && /overflow-wrap: anywhere/.test(own), "does not wrap");
  ok(!/\d(px|rem|em)\b|#[0-9a-f]{3,8}\b|rgba?\(/i.test(own.replace(/0\.6/, "")), `literal in:\n${own}`);
});

(async () => {
  for (const [label, fn] of tests) {
    try { await fn(); console.log(`  ok   ${label}`); } catch (e) { console.error(`  FAIL ${label}: ${(e as Error).message}`); fail++; }
  }
  for (const r of mounted) await act(async () => r.unmount());
  if (fail) { console.error(`\n${fail} lesson-starters check(s) failed`); process.exit(1); }
  console.log(`\n${tests.length} lesson-starters checks passed`);
  process.exit(0);
})();
