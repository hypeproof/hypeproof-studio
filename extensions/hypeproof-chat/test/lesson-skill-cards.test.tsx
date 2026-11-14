// CGP-AGENT-R-020 (Jay, 2026-11-14) — the real ChatPanel on the minimal DOM: the lesson's learner skill cards are a
// collapsed "이 수업의 스킬" shelf above the composer; each card shows its name and summary; "써 보기" inserts the
// starter prompt into the draft and never sends; a manual draft is kept; the shelf stays after the learner has sent;
// malformed or linked cards are skipped; no install, enable or SKILL.md source control exists; a lesson without
// cards renders byte-identical. Bundled with esbuild and run with plain Node (scripts/run-tsx-tests.mjs).

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { click, mountPoint } from "./fixtures/mini-dom.mjs";
import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatPanel } from "../webview-ui/src/ChatPanel";
import { hasLink, servedSkillCards } from "../src/lessonSkillCards";
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
const CARDS = [
  { name: "요약 스킬", summary: "긴 글을 세 줄로 줄여요", prompt: "아래 글을 세 줄로 요약해 줘." },
  { name: "질문 만들기", summary: "확인 질문 세 개", prompt: "이 내용으로 확인 질문 세 개를 만들어 줘.\n답은 아직 알려 주지 마." },
];
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
const shelfOf = (out: string) => /<details class="hps-skill-shelf"[\s\S]*?<\/details>/.exec(out)?.[0] ?? "";

type El = { getAttribute(n: string): string | null; hasAttribute(n: string): boolean; textContent: string; value: string; localName: string; findAll(test: (e: El) => boolean): El[]; dispatchEvent(e: unknown): boolean };
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
  const tries = () => host.findAll((e) => (e.getAttribute("class") ?? "").split(" ").includes("hps-skill-card-try"));
  return {
    sent, tries,
    draft: () => textarea().value,
    type: async (text: string) => { const ta = textarea(); await act(async () => { ta.value = text; ta.dispatchEvent({ type: "input", bubbles: true, cancelable: true, preventDefault() {}, stopPropagation() {} }); }); },
    press: async (el: El) => act(async () => { click(el); }),
  };
}

t("served cards are a collapsed shelf above the composer: title with count, name, summary and one 써 보기 per card", () => {
  const out = html(config({ skill_cards: CARDS }));
  const shelf = shelfOf(out);
  ok(shelf, "shelf missing");
  ok(!/<details class="hps-skill-shelf"[^>]* open/.test(shelf), "the shelf must start collapsed");
  ok(shelf.includes(">이 수업의 스킬 (2)</summary>"), "title with count");
  ok(out.indexOf("hps-skill-shelf") < out.indexOf("<textarea"), "shelf is not above the composer");
  for (const c of CARDS) { ok(shelf.includes(`>${c.name}</strong>`), `name ${c.name}`); ok(shelf.includes(`>${c.summary}</span>`), `summary ${c.summary}`); }
  eq((shelf.match(/<button type="button" class="hps-skill-card-try"/g) ?? []).length, 2, "one button per card");
  ok(shelf.includes('aria-label="써 보기: 요약 스킬"'), "the button names its card");
  ok(!shelf.includes(CARDS[0].prompt), "the prompt is not drawn on the shelf");
});

t("no install, enable, delete or source control; no SKILL.md", () => {
  const shelf = shelfOf(html(config({ skill_cards: CARDS })));
  const buttons = shelf.match(/<button[^>]*>[^<]*<\/button>/g) ?? [];
  eq(buttons.map((b) => b.replace(/<[^>]+>/g, "")), ["써 보기", "써 보기"], "only 써 보기 buttons");
  ok(!/설치|켜기|끄기|삭제|소스|SKILL\.md|<a /i.test(shelf), "no other control or source");
});

t("써 보기 inserts the prompt into the draft and never sends", async () => {
  const h = await harness(config({ skill_cards: CARDS }));
  eq(h.tries().length, 2, "buttons");
  await h.press(h.tries()[1]);
  eq(h.draft(), CARDS[1].prompt, "inserted");
  eq(h.sent.length, 0, "nothing sent");
});

t("a manual draft is never overwritten", async () => {
  const h = await harness(config({ skill_cards: CARDS }));
  await h.type("내가 쓰던 글");
  await h.press(h.tries()[0]);
  ok(h.draft().startsWith("내가 쓰던 글"), `manual text lost: ${h.draft()}`);
  ok(h.draft().includes(CARDS[0].prompt), "prompt not inserted");
  eq(h.sent.length, 0, "nothing sent");
});

t("the shelf stays after the learner has sent (unlike starters)", async () => {
  const h = await harness(config({ skill_cards: CARDS }), { messages: [{ id: "u1", role: "user", content: "안녕", createdAt: 1 }] });
  eq(h.tries().length, 2, "shelf gone after a send");
});

t("absent, empty or malformed cards render byte-identical to a lesson that never had them", () => {
  const base = html(config());
  eq(html(config({ skill_cards: [] })) === base, true, "empty array differs");
  eq(html(config({ skill_cards: undefined })) === base, true, "undefined differs");
  eq(html(config({ skill_cards: [{ name: "x" }, null, 5, { name: "", summary: "s", prompt: "p" }] })) === base, true, "malformed cards differ");
  ok(!base.includes("hps-skill-shelf"), "markup without cards");
  ok(html(config({ skill_cards: CARDS })) !== base, "positive control: cards change the markup");
});

t("the reader re-validates: links, unsafe text, over-long fields, too many lines, duplicates and the 6-card cap", () => {
  const good = CARDS[0];
  eq(servedSkillCards({ skill_cards: CARDS }), CARDS, "valid cards pass unchanged");
  for (const bad of [
    { ...good, prompt: "https://x.example 보기" }, { ...good, summary: "ｈｔｔｐｓ://x" }, { ...good, name: "һttps://x" },
    { ...good, prompt: "www.x.example" }, { ...good, name: "a‮b" }, { ...good, summary: "두\n줄" },
    { ...good, name: "a".repeat(31) }, { ...good, summary: "가".repeat(81) }, { ...good, prompt: "나".repeat(301) },
    { ...good, prompt: "1\n2\n3\n4\n5\n6\n7" }, { ...good, prompt: 7 },
  ]) eq(servedSkillCards({ skill_cards: [bad] }), [], `refused: ${JSON.stringify(bad)}`);
  eq(servedSkillCards({ skill_cards: [good, { ...good, name: "요약 스킬".toUpperCase() }] }).length, 1, "a duplicate name is skipped");
  eq(servedSkillCards({ skill_cards: Array.from({ length: 8 }, (_, i) => ({ ...good, name: `스킬 ${i}` })) }).length, 6, "at most six");
  eq(servedSkillCards(null), [], "null profile");
  eq(hasLink("시간: 10분"), false, "positive control: Korean colon");
});

t("a card that looks like HTML renders as text, never as an element", () => {
  const shelf = shelfOf(html(config({ skill_cards: [{ name: "<b>굵게</b>", summary: "<img src=x onerror=alert(1)>", prompt: "p" }] })));
  ok(shelf.includes("&lt;img src=x onerror=alert(1)&gt;") && shelf.includes("&lt;b&gt;굵게&lt;/b&gt;"), "not escaped as text");
  ok(!/<img|<b>/.test(shelf), "an element was created from card text");
});

t("the instructor surface draws no shelf", () => {
  const out = renderToStaticMarkup(<ChatPanel {...(PROPS as never)} config={config({ skill_cards: CARDS })} instructor={true} />);
  ok(!out.includes("hps-skill-shelf"), "instructor sees the learner shelf");
});

t("CSS: 44px targets, 14px floor and tokens only", () => {
  const css = readFileSync(resolve(process.cwd(), "webview-ui/src/styles.css"), "utf8");
  const own = css.split("\n").filter((l) => l.startsWith(".hps-skill-")).join("\n");
  ok(own.split("\n").length > 8, "rules missing");
  ok(/\.hps-skill-card-try \{[^}]*min-height: var\(--hp-control-min\)[^}]*min-width: var\(--hp-control-min\)/.test(own), "44px try button");
  ok(/\.hps-skill-shelf-summary \{[^}]*min-height: var\(--hp-control-min\)/.test(own), "44px summary");
  ok(/font-size: var\(--hp-font-caption\)/.test(own), "14px caption token");
  ok(!/\d(px|rem|em)\b|#[0-9a-f]{3,8}\b|rgba?\(/i.test(own.replace(/0\.6/, "")), `literal in:\n${own}`);
});

(async () => {
  for (const [label, fn] of tests) {
    try { await fn(); console.log(`  ok   ${label}`); } catch (e) { console.error(`  FAIL ${label}: ${(e as Error).message}`); fail++; }
  }
  for (const r of mounted) await act(async () => r.unmount());
  if (fail) { console.error(`\n${fail} lesson-skill-cards check(s) failed`); process.exit(1); }
  console.log(`\n${tests.length} lesson-skill-cards checks passed`);
  process.exit(0);
})();
