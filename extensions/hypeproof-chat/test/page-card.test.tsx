// REQ-STUDIO-PAGE-CARD / CGP-ART-R-010 — the page card under the coach turn that built or changed a
// page. Bundled with esbuild and run with plain Node, like quote-reply. Static markup covers the rows;
// the interactive part mounts ChatPanel on a minimal DOM (fixtures/mini-dom.mjs), sends the host's
// pageCardsState message, presses the real buttons and reads what the webview posted to the host.

import "./fixtures/vscode-api-capture.mjs";
import { click, mountPoint } from "./fixtures/mini-dom.mjs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot, type Root } from "react-dom/client";
import { ChatPanel } from "../webview-ui/src/ChatPanel";
import { PageCard } from "../webview-ui/src/PageCard";
import type { PageCardView } from "../src/pageCard";
import type { ChatConfig, ChatMessage } from "../src/protocol";

const act: (fn: () => unknown) => Promise<void> = (React as unknown as { act: (fn: () => unknown) => Promise<void> }).act;
let fail = 0;
const tests: [string, () => void | Promise<void>][] = [];
const t = (label: string, fn: () => void | Promise<void>) => tests.push([label, fn]);
const ok = (v: unknown, m: string) => { if (!v) throw new Error(m); };
const eq = (a: unknown, b: unknown, m: string) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); };
const posted = () => (globalThis as unknown as { __hpsPosted: { type: string }[] }).__hpsPosted;

const noop = () => {};
const PROPS = {
  messages: [] as ChatMessage[], streaming: false, streamingId: null, error: null, errorRequestId: null, errorRunbookUrl: null, canRetryLast: false,
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
const classroom = {
  model: "claude-sonnet-5", hasToken: true, proxyUrl: "http://localhost:8787",
  coach: { name: "HypeProof", personality: "", configured: true },
  profile: { profile_id: "class-a", activity_kind: "classroom", observation: null, lesson: null, rehearsal: null, welcome: { greeting_md: "안녕하세요" }, model_selection: null, ux: UX },
  activity: { id: "a1", name: "수업", kind: "classroom", workspace: "/tmp/w", verified: true },
} as unknown as ChatConfig;
const personal = {
  ...classroom, profile: { ...classroom.profile, activity_kind: "personal" }, activity: { id: "p1", name: "내 작업", kind: "personal", workspace: "/tmp/p", verified: true },
} as unknown as ChatConfig;

const u = (id: string, content: string): ChatMessage => ({ id, role: "user", content, createdAt: 1 });
const a = (id: string, content: string): ChatMessage => ({ id, role: "assistant", content, createdAt: 1 });
const tool = (id: string, label: string): ChatMessage => ({ id, role: "tool", content: "", createdAt: 1, tool: { icon: "🔧", label, state: "done" } });
const CONVO = [u("u1", "게임 만들어줘"), a("m1", "만들었어요."), tool("tool-1", "index.html 저장"), u("u2", "고마워"), a("m2", "천만에요.")];

const CARD: PageCardView = { turnId: "turn-1", anchorId: "tool-1", pages: [{ path: "index.html", kind: "added" }, { path: "game/level.html", kind: "changed" }] };
const MANY: PageCardView = { turnId: "turn-2", anchorId: "m2", pages: ["a", "b", "c", "d", "e"].map((n) => ({ path: `${n}.html`, kind: "added" as const })) };

// ---------- Static: the card itself ----------
t("rows: path, kind, two 44px actions each, Korean labels with the path for screen readers", () => {
  const html = renderToStaticMarkup(<PageCard view={CARD} onOpen={noop} onReveal={noop} />);
  ok(html.includes('data-testid="page-card"'), "card");
  ok(html.includes("이번 답에서 바뀐 페이지"), "title");
  ok(html.includes("<code>index.html</code>") && html.includes("<code>game/level.html</code>"), "paths");
  ok(html.includes("새로 만듦") && html.includes("바뀜"), "kinds");
  eq((html.match(/>열기<\/button>/g) ?? []).length, 2, "열기 buttons");
  eq((html.match(/>폴더에서 보기<\/button>/g) ?? []).length, 2, "폴더에서 보기 buttons");
  ok(html.includes('aria-label="index.html 열기"') && html.includes('aria-label="index.html 폴더에서 보기"'), "aria labels");
  ok(!html.includes("외 "), "no more line for two pages");
});
t("more than 3 pages: 3 rows plus 외 N개", () => {
  const html = renderToStaticMarkup(<PageCard view={MANY} onOpen={noop} onReveal={noop} />);
  eq((html.match(/>열기<\/button>/g) ?? []).length, 3, "rows");
  ok(html.includes("외 2개"), "more line");
  ok(!html.includes("d.html"), "fourth page not drawn");
});
t("negative control: no capability label or score words on the card", () => {
  const html = renderToStaticMarkup(<PageCard view={{ ...CARD, notice: "이 페이지를 열 수 없어요. 작업 폴더 안에 그대로 있는지 확인해 주세요." }} onOpen={noop} onReveal={noop} />);
  for (const w of ["FRAMING", "JUDGMENT", "ORCHESTRATE", "VERIFY", "ADAPT", "OWNERSHIP", "점수"]) ok(!html.includes(w), w);
  // F2: the diff also holds Studio's and the learner's writes, so the card never says the AI made them.
  ok(!html.includes("AI"), "the card claims AI authorship");
  ok(html.includes('role="status"') && html.includes("이 페이지를 열 수 없어요"), "notice");
});
t("default chat render draws no card (A5 digests unchanged)", () => {
  const html = renderToStaticMarkup(<ChatPanel {...PROPS} config={classroom} instructor={false} messages={CONVO} />);
  ok(!html.includes("page-card"), "card drawn without a host message");
});

// ---------- Interactive: host message in, button presses out ----------
type El = { localName: string; getAttribute(n: string): string | null; textContent: string; childNodes: El[]; parentNode: El | null; findAll(test: (e: El) => boolean): El[] };
const mounted: Root[] = [];
const fromHost = (data: object) => act(async () => {
  (globalThis.window as unknown as { dispatchEvent(e: object): boolean }).dispatchEvent({ type: "message", data, bubbles: false, cancelable: false, defaultPrevented: false, preventDefault() {}, stopPropagation() {} });
});
async function mount(config: ChatConfig, instructor = false) {
  const host = mountPoint() as unknown as El;
  const root = createRoot(host as unknown as HTMLElement);
  mounted.push(root);
  await act(async () => { root.render(<ChatPanel {...PROPS} config={config} instructor={instructor} messages={CONVO} />); });
  const cards = () => host.findAll((e) => e.getAttribute("data-testid") === "page-card");
  const button = (label: string) => host.findAll((e) => e.localName === "button" && e.getAttribute("aria-label") === label)[0];
  return { host, cards, button, unmount: () => act(async () => root.unmount()) };
}

for (const [name, config] of [["personal", personal], ["classroom", classroom]] as const) {
  t(`${name}: the card asks for its state, renders under its turn, and each button posts the right message`, async () => {
    posted().length = 0;
    const v = await mount(config);
    ok(posted().some((m) => m.type === "pageCardsRequest"), "pageCardsRequest on mount");
    eq(v.cards().length, 0, "no card before the host sends one");
    await fromHost({ type: "pageCardsState", cards: [CARD] });
    eq(v.cards().length, 1, "one card");
    const card = v.cards()[0];
    // Under its turn: right after the anchor row, before the next user message.
    const siblings = card.parentNode!.childNodes;
    const at = siblings.indexOf(card);
    ok(at > 0, "card has a preceding row");
    posted().length = 0;
    click(v.button("index.html 열기") as never);
    click(v.button("game/level.html 폴더에서 보기") as never);
    eq(posted().map((m) => ({ ...m })), [
      { type: "pageCardOpen", turnId: "turn-1", path: "index.html" },
      { type: "pageCardReveal", turnId: "turn-1", path: "game/level.html" },
    ], "posted");
    await v.unmount();
  });
}
t("the card sits after its anchor row and before the next user message", async () => {
  const v = await mount(personal);
  await fromHost({ type: "pageCardsState", cards: [CARD] });
  const text = v.host.textContent;
  const card = text.indexOf("이번 답에서 바뀐 페이지");
  ok(card > text.indexOf("만들었어요."), "after the turn's answer");
  ok(card < text.indexOf("고마워"), "before the next user message");
  await v.unmount();
});
t("negative control: a card whose anchor is not in this transcript is not drawn", async () => {
  const v = await mount(personal);
  await fromHost({ type: "pageCardsState", cards: [{ ...CARD, anchorId: "other-task-row" }] });
  eq(v.cards().length, 0, "card drawn without its turn");
  await fromHost({ type: "pageCardsState", cards: [] });
  eq(v.cards().length, 0, "empty state");
  await v.unmount();
});
t("negative control: the instructor surface draws no card", async () => {
  const v = await mount(classroom, true);
  await fromHost({ type: "pageCardsState", cards: [CARD] });
  eq(v.cards().length, 0, "instructor card");
  await v.unmount();
});

(async () => {
  for (const [label, fn] of tests) {
    try { await fn(); console.log(`  ok   ${label}`); } catch (e) { console.error(`  FAIL ${label}: ${(e as Error).message}`); if (process.env.HPS_TEST_STACK) console.error((e as Error).stack); fail++; }
  }
  for (const root of mounted) { try { root.unmount(); } catch { /* already unmounted */ } }
  if (fail) { console.error(`page-card: ${fail} failed`); process.exit(1); }
  console.log("page-card render OK");
  process.exit(0);
})();
