// ux.coach_layout: 'compact' — the per-cohort opt-in layout. With the flag: the two rail panels are gone, "AI가 할 수 있는 일"
// lives in the gear's settings dialog, 자료 actions live in the "+" menu with tags above the composer, a coach-written
// 다음에 해볼 만한 것 block becomes chips. Without the flag (or with any other value): none of it, and the DOM is identical.
// Mounted with react-dom/client on the minimal DOM (fixtures/mini-dom.mjs); the host is played by window messages.

import { click, document as doc, mountPoint } from "./fixtures/mini-dom.mjs";
import React from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { ChatPanel } from "../webview-ui/src/ChatPanel";
import { RunningProcessesPanel } from "../webview-ui/src/RunningProcesses";
import type { MaterialsView } from "../src/activityMaterialsView";
import type { ChatConfig } from "../src/protocol";

const posted = (globalThis as unknown as { __posted: Record<string, unknown>[] }).__posted;
const act: (fn: () => unknown) => Promise<void> = (React as unknown as { act: (fn: () => unknown) => Promise<void> }).act;
let fail = 0;
const tests: [string, () => void | Promise<void>][] = [];
const t = (label: string, fn: () => void | Promise<void>) => tests.push([label, fn]);
const ok = (v: unknown, m: string) => { if (!v) throw new Error(m); };
const eq = (a: unknown, b: unknown, m: string) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);

type El = { localName: string; textContent: string; value: string; getAttribute(n: string): string | null; hasAttribute(n: string): boolean; findAll(test: (e: El) => boolean): El[]; dispatchEvent(e: unknown): boolean };
const all = (test: (e: El) => boolean) => (doc as unknown as { documentElement: El }).documentElement.findAll(test);
const hasClass = (e: El, name: string) => (e.getAttribute("class") ?? "").split(" ").includes(name);
const byClass = (name: string) => all((e) => hasClass(e, name));
const button = (label: string) => all((e) => e.localName === "button" && (e.getAttribute("aria-label") === label || e.textContent === label))[0];
const hostSays = (data: unknown) => act(async () => { (globalThis as unknown as { window: { dispatchEvent(e: unknown): boolean } }).window.dispatchEvent({ type: "message", data, bubbles: false }); });
const ev = (type: string) => ({ type, bubbles: true, cancelable: true, defaultPrevented: false, timeStamp: Date.now(), preventDefault() { this.defaultPrevented = true; }, stopPropagation() {} });
const last = (type: string) => posted.filter((m) => m.type === type).at(-1);

import { H, PROPS as BASE_PROPS, CONVERSATION, config, managed, PROCESSES } from "./fixtures/coach-layout-props";
import { readFileSync } from "node:fs";
const PROPS = { ...BASE_PROPS, onSettings: () => posted.push({ type: "openSettings" }) };
const noop = () => {};
const footerOf = (html: string) => html.slice(html.indexOf('<footer class="hps-input-area">'));
const golden = (name: string) => readFileSync(`test/fixtures/coach-layout-head-${name}.html`, "utf8");
// The host messages a mounted, non-compact panel sent at HEAD 7ea4479f (two of them materialsRequest: the rail card and its composer line).
const HEAD_POSTED = "materialsRequest,materialsRequest,perfTraceStateRequest,memoryNoticeRequest,accuracyEducationRequest,whatsNewRequest,planFirstRequest,queueState,inboxRequest,turnReviewRequest,pageCardsRequest,missingTaskFolderRequest,lowDiskRequest,previewRecoveryRequest,helpRequest";

const item = (over: Partial<MaterialsView["items"][number]>) => ({ kind: "file", detail: "", selected: false, removable: true, origin: "learner", originLabel: "나", ...over }) as MaterialsView["items"][number];
const VIEW: MaterialsView = {
  scope: "[\"a1\",\"task-a\"]", maxSelected: 3,
  items: [
    item({ id: "inbox:obj-1:1", kind: "note", title: "강사 읽기 자료", origin: "instructor", originLabel: "강사", removable: false }),
    item({ id: "me:aaaaaaaaaaaa", title: "메모.md", detail: "자료/메모.md" }),
    item({ id: "me:bbbbbbbbbbbb", kind: "url", title: "example.com", detail: "https://example.com/a", selected: true }),
  ],
};

(globalThis as unknown as Record<string, unknown>).HTMLElement ??= class {};
// A test that fails mid-way leaves its root mounted; unmount whatever is left before the next one.
const live: { unmount(): void }[] = [];
async function mount(cfg: ChatConfig, messages: unknown[] = CONVERSATION, answer = true) {
  await act(async () => { for (const r of live.splice(0)) r.unmount(); });
  posted.length = 0;
  const root = createRoot(mountPoint() as never);
  live.push(root);
  await act(async () => { root.render(<ChatPanel {...(PROPS as never)} messages={messages as never} config={cfg} instructor={false} />); });
  if (answer) await hostSays({ type: "materialsState", view: VIEW });
  return root;
}
const shell = () => byClass("hps-shell")[0];
const openMenu = async () => { await act(async () => { click(button("도구 열기")); }); };
const menuItem = (name: string) => all((e) => e.getAttribute("role") === "menuitem" && e.textContent.startsWith(name))[0];

// ── Gate: flag absent or any other value is the standard layout ───────────────────────────────
t("flag absent: the standard DOM, and an unrecognised value draws exactly the same markup", () => {
  const render = (layout?: string) => renderToStaticMarkup(<ChatPanel {...(PROPS as never)} messages={CONVERSATION as never} config={config(layout)} instructor={false} />);
  const absent = render();
  eq(render("standard") === absent && render("COMPACT") === absent, true, "any other value changes nothing");
  for (const marker of ["data-coach-layout", "hps-next-step", "materials-tags", "hp-materials-tag"]) ok(!absent.includes(marker), `${marker} must not exist`);
  ok(absent.includes('<details class="hp-rail-lesson hp-ai-can-do">'), "the AI-can-do rail card is still drawn");
  ok(absent.includes("hps-chips-rack") && absent.includes("정적인 이어가기"), "the static follow-up chips are still drawn");
  ok(absent.includes(H) && absent.includes("→ 색을 바꿔 보기"), "the block is not parsed: it stays prose in the bubble");
  // The same props rendered at HEAD 7ea4479f (test/fixtures/coach-layout-head-*.html, captured from a clean checkout of it).
  eq(absent === golden("chatpanel-classroom"), true, "byte-identical to the markup main draws for the same props");
  const managedHtml = renderToStaticMarkup(<ChatPanel {...(PROPS as never)} messages={CONVERSATION as never} config={managed()} instructor={false} />);
  eq(managedHtml === golden("chatpanel-managed"), true, "a cohort-managed model with a usage panel: byte-identical to main");
});
t("flag absent: the same host requests are sent as at HEAD (the rail card and its composer line each ask once)", async () => {
  await mount(config(), CONVERSATION, false);
  eq(posted.map((m) => m.type).join(","), HEAD_POSTED, "request sequence");
});
t("flag absent: the rail's 자료 card, the gear's own action and no menu items for 자료", async () => {
  const root = await mount(config());
  ok(!shell().hasAttribute("data-coach-layout"), "no layout attribute");
  eq(all((e) => e.getAttribute("data-testid") === "materials").length, 1, "the rail card is drawn");
  eq(all((e) => e.getAttribute("data-testid") === "materials-tags").length, 0, "no tags");
  await act(async () => { click(button("설정")); });
  eq(posted.filter((m) => m.type === "openSettings").length, 1, "the gear still opens the app settings");
  eq(byClass("hps-preferences").length, 0, "no in-panel dialog");
  await openMenu();
  ok(!menuItem("파일 넣기") && !menuItem("주소 넣기"), "the + menu has no 자료 entries");
  await act(async () => { root.unmount(); });
});
t("flag absent: a running-process card has its heading, note and state text", () => {
  const entries = [{ id: "live:1", purpose: "미리보기 서버", kind: "preview", folder: "site", address: "127.0.0.1:1", state: "running" }] as never;
  const html = renderToStaticMarkup(<RunningProcessesPanel entries={entries} onStop={noop} />);
  ok(html.includes('<h2 id="hps-running-processes-title">실행 중인 것</h2>') && html.includes("보여 주는 곳: site") && html.includes("꺼도 돼요") && html.includes('<span role="status" class="hps-process-state">실행 중</span>'), html);
  ok(!html.includes("data-coach-layout") && !html.includes("hps-sr-only"), "no compact markup");
  eq(renderToStaticMarkup(<RunningProcessesPanel entries={PROCESSES as never} onStop={noop} />) === golden("running-processes"), true, "byte-identical to main for a preview and a shell card");
});

// ── Compact ───────────────────────────────────────────────────────────────────────────────────
t("compact: the shell says so; neither rail panel is drawn", async () => {
  const root = await mount(config("compact"));
  eq(shell().getAttribute("data-coach-layout"), "compact", "attribute on the shell root");
  eq(all((e) => e.getAttribute("data-testid") === "materials").length, 0, "no 자료 rail card");
  eq(byClass("hp-ai-can-do").length, 0, "no AI-can-do rail card");
  eq(posted.filter((m) => m.type === "materialsRequest").length, 1, "one subscription for the whole composer");
  await act(async () => { root.unmount(); });
});
t("compact: the gear opens the in-panel dialog with 'AI가 할 수 있는 일', and 앱 설정 열기 reaches the app settings", async () => {
  // (mini-dom cannot mount a <select>, so the usage panel here is the one with no funding choices.)
  const root = await mount({ ...(config("compact") as unknown as object), access: { status: "unknown" } } as unknown as ChatConfig);
  await act(async () => { click(button("설정")); });
  eq(posted.filter((m) => m.type === "openSettings").length, 0, "the gear no longer jumps straight to the app settings");
  const dialog = byClass("hps-preferences")[0];
  ok(dialog, "dialog drawn");
  ok(dialog.findAll((e) => hasClass(e, "hp-ai-can-do")).length === 1, "the capabilities card is inside the dialog");
  eq(dialog.findAll((e) => e.hasAttribute("data-capability")).length, 6, "every capability row");
  ok(dialog.findAll((e) => hasClass(e, "hps-access")).length === 1, "the usage panel is inside the dialog too");
  await act(async () => { click(button("앱 설정 열기")); });
  eq(posted.filter((m) => m.type === "openSettings").length, 1, "the app settings are one press away");
  await act(async () => { root.unmount(); });
});
t("compact: 자료 are tags above the composer; pressing one asks the host to select it, × removes, nothing is sent", async () => {
  const root = await mount(config("compact"));
  const tags = all((e) => e.getAttribute("data-testid") === "materials-tags")[0];
  ok(tags, "tags drawn");
  eq(tags.findAll((e) => hasClass(e, "hp-materials-tag")).length, 3, "one tag per item");
  ok(tags.textContent.includes("고른 자료만 다음 질문과 함께 AI에게 보내요"), "the rule is said");
  const pressed = tags.findAll((e) => e.localName === "button" && e.getAttribute("aria-pressed") === "true").map((e) => e.getAttribute("aria-label"));
  eq(pressed, ["넣음: example.com"], "only the selected item is pressed");
  await act(async () => { click(button("이번 질문에 넣기: 메모.md")); });
  const sel = last("materialSelect") as { id: string; selected: boolean; scope: string };
  eq([sel.id, sel.selected, sel.scope], ["me:aaaaaaaaaaaa", true, VIEW.scope], "select message");
  await hostSays({ type: "materialsState", view: VIEW, requestId: (last("materialSelect") as { requestId: string }).requestId });
  eq(tags.findAll((e) => e.hasAttribute("data-material-remove")).length, 2, "the instructor's item has no ×");
  await act(async () => { click(button("목록에서 빼기: 메모.md")); });
  eq((last("materialRemove") as { id: string }).id, "me:aaaaaaaaaaaa", "remove message");
  ok(!posted.some((m) => m.type === "sendMessage"), "nothing sent");
  await act(async () => { root.unmount(); });
});
t("compact: the + menu adds 파일 넣기 and 주소 넣기 (https) next to the existing item; each uses the rail card's messages", async () => {
  const root = await mount(config("compact"));
  await openMenu();
  ok(menuItem("작업 폴더 파일 붙이기"), "the existing item stays");
  await act(async () => { click(menuItem("파일 넣기")); });
  const fileReq = last("materialAddFile") as { requestId: string };
  ok(fileReq, "materialAddFile posted");
  await hostSays({ type: "materialsState", view: VIEW, requestId: fileReq.requestId, error: "읽을 수 없는 파일이에요." });
  ok(all((e) => e.getAttribute("role") === "alert" && e.textContent === "읽을 수 없는 파일이에요.").length === 1, "a refusal from the menu press is drawn by the tags");
  await openMenu();
  await act(async () => { click(menuItem("주소 넣기 (https)")); });
  const input = all((e) => e.localName === "input" && e.getAttribute("name") === "material-url")[0];
  ok(input, "the address form opens above the composer");
  (input as unknown as { type: string }).type = input.getAttribute("type")!;
  await act(async () => { input.value = "https://example.org/x"; input.dispatchEvent(ev("input")); });
  await act(async () => { all((e) => e.localName === "form" && hasClass(e, "hp-materials-url"))[0].dispatchEvent(ev("submit")); });
  const urlReq = last("materialAddUrl") as { url: string; requestId: string };
  eq(urlReq.url, "https://example.org/x", "posted as typed; the host decides");
  await hostSays({ type: "materialsState", view: VIEW, requestId: urlReq.requestId });
  eq(all((e) => e.localName === "input" && e.getAttribute("name") === "material-url").length, 0, "the form closes after an accepted address");
  await act(async () => { root.unmount(); });
});
t("compact: the coach's block leaves the bubble and becomes chips under the latest answer; the static chips step aside; a press fills the composer", async () => {
  const root = await mount(config("compact"));
  const body = byClass("hps-msg-assistant")[0].textContent;
  ok(body.includes("설명이에요.") && !body.includes(H) && !body.includes("→"), `bubble: ${body}`);
  eq(byClass("hps-chips-rack").length, 0, "no static follow-up chips");
  const steps = byClass("hps-next-step");
  eq(steps.map((e) => e.textContent), ["색을 바꿔 보기", "제목을 더 크게"], "one pill per step");
  ok(byClass("hps-next-steps-label")[0].textContent === H, "caption");
  await act(async () => { click(steps[0]); });
  eq(all((e) => e.localName === "textarea")[0].value, "색을 바꿔 보기", "the composer is filled");
  ok(!posted.some((m) => m.type === "sendMessage"), "never sent");
  await act(async () => { root.unmount(); });
});
t("compact: no steps for an older answer, none while streaming; a reply without a block keeps the static chips", async () => {
  let root = await mount(config("compact"), [...CONVERSATION, { id: "u2", role: "user", content: "고마워" }, { id: "a2", role: "assistant", content: "천만에요." }]);
  eq(byClass("hps-next-step").length, 0, "only the latest reply offers steps");
  ok(byClass("hps-msg-assistant")[0].textContent.includes(H) && byClass("hps-msg-assistant")[0].textContent.includes("→ 제목을 더 크게"), "an older answer keeps its block as prose");
  eq(byClass("hps-chips-rack").length, 1, "the latest has no block: the static follow-ups return");
  await act(async () => { root.unmount(); });
  posted.length = 0;
  root = createRoot(mountPoint() as never);
  await act(async () => { root.render(<ChatPanel {...(PROPS as never)} messages={[CONVERSATION[0], { id: "a1", role: "assistant", content: `설명\n${H}\n→ 색` }] as never} config={config("compact")} streaming streamingId="a1" instructor={false} />); });
  eq(byClass("hps-next-step").length, 0, "no chips while streaming");
  ok(!byClass("hps-msg-assistant")[0].textContent.includes("→"), "the partial block is hidden as it streams");
  await act(async () => { root.unmount(); });
});
t("compact: a malformed block stays prose and the static chips stay", async () => {
  const root = await mount(config("compact"), [CONVERSATION[0], { id: "a1", role: "assistant", content: `설명\n${H}\n→ 주소 http://x.y` }]);
  ok(byClass("hps-msg-assistant")[0].textContent.includes("→ 주소 http://x.y"), "shown as written");
  eq([byClass("hps-next-step").length, byClass("hps-chips-rack").length], [0, 1], "no dynamic chips, static chips kept");
  await act(async () => { root.unmount(); });
});
t("flag absent: the footer keeps the visible managed-model reason and the 이용권 · 사용량 panel", () => {
  const footer = footerOf(renderToStaticMarkup(<ChatPanel {...(PROPS as never)} messages={CONVERSATION as never} config={managed()} instructor={false} />));
  ok(footer.includes('<small id=') && footer.includes('class="hps-managed-reason"') && !footer.includes("hps-managed-reason hps-sr-only"), "reason drawn as before");
  ok(footer.includes('<details class="hps-access"'), "usage panel in the footer");
});
// A class seat whose ledger is confirmed: the header chip (AccessHeader) is drawn and says what is left.
const CONFIRMED = { status: "ready", selected: "f1", view: { configured: true, required: false, as_of: "2026-11-12T00:00:00Z", choices: [
  { id: "f1", label: "수업 이용권", source_kind: "cohort", state: "ready", available: true, active: true, allowed: { models: [] }, ends_at: "2026-12-31T00:00:00Z", can_request: false,
    resources: [{ meter: "requests:count", limit: 100, remaining: 50, spent: 50, held: 0, unresolved: 0, overrun: 0, shared: true }] }] } };
const compactFooter = (cfg: ChatConfig) => footerOf(renderToStaticMarkup(<ChatPanel {...(PROPS as never)} messages={CONVERSATION as never} config={cfg} instructor={false} />));
t("compact: the managed-model reason is screen-reader only (still the select's description); the usage panel leaves the footer once the header chip carries it", () => {
  const html = renderToStaticMarkup(<ChatPanel {...(PROPS as never)} messages={CONVERSATION as never} config={managed("compact", CONFIRMED)} instructor={false} />);
  ok(html.includes("hps-access-chip"), "control: the header chip is drawn");
  const footer = footerOf(html);
  const id = /<select[^>]*aria-describedby="([^"]+)"/.exec(footer)?.[1];
  ok(id && footer.includes(`<small id="${id}" class="hps-managed-reason hps-sr-only">`), "the description element is kept and visually hidden");
  ok(footer.includes("선생님이 정한 설정이에요"), "its words stay in the DOM");
  ok(!footer.includes("hps-access"), "no usage panel in the footer");
});
t("compact: the usage panel is hidden from the footer on every activity, chip or no chip", () => {
  const none = (cfg: ChatConfig, why: string) => ok(!compactFooter(cfg).includes("hps-access"), `no usage panel: ${why}`);
  none(managed("compact"), "status unknown (the default fixture)");
  const free = managed("compact", CONFIRMED) as unknown as { activity: object };
  none({ ...free, activity: { ...free.activity, free: true } } as unknown as ChatConfig, "a free activity has no chip");
  none(managed("compact", { ...CONFIRMED, selected: null }), "no funding chosen");
  const base = managed("compact", CONFIRMED) as unknown as { profile: object };
  const automation = { ...base, profile: { ...base.profile, automations: { enabled: true } } } as unknown as ChatConfig;
  const html = renderToStaticMarkup(<ChatPanel {...(PROPS as never)} messages={CONVERSATION as never} config={automation} instructor={false} />);
  ok(!footerOf(html).includes("hps-access"), "an automation seat: no panel");
  ok(footerOf(html).includes("<summary>대화 설정</summary>") && !footerOf(html).includes("대화 설정 · 이용권"), "and the summary no longer promises it");
});
t("flag absent: the automation seat keeps the panel and the \"대화 설정 · 이용권\" summary", () => {
  const base = managed(undefined, CONFIRMED) as unknown as { profile: object };
  const automation = { ...base, profile: { ...base.profile, automations: { enabled: true } } } as unknown as ChatConfig;
  const footer = footerOf(renderToStaticMarkup(<ChatPanel {...(PROPS as never)} messages={CONVERSATION as never} config={automation} instructor={false} />));
  ok(footer.includes("hps-access") && footer.includes("<summary>대화 설정 · 이용권</summary>"), "unchanged");
});
t("compact: a usage panel the learner must act on (이용권 not chosen yet) stays in the footer", () => {
  const required = { status: "ready", selected: null, view: { configured: true, required: true, choices: [], as_of: "2026-11-12T00:00:00Z" } };
  const footer = footerOf(renderToStaticMarkup(<ChatPanel {...(PROPS as never)} messages={CONVERSATION as never} config={managed("compact", required)} instructor={false} />));
  ok(footer.includes('<details class="hps-access"'), "still drawn, as the funding choice blocks sending");
});
t("compact: a stopped turn makes no chips and keeps its (possibly cut-off) last line in the bubble", async () => {
  const cut = `설명\n${H}\n→ 제목을 더 크`;
  const stopped = { anchorId: "a1", ms: 1000, outcome: "stopped" };
  let root = await mount(config("compact"), [CONVERSATION[0], { id: "a1", role: "assistant", content: cut, elapsedTurn: stopped }]);
  eq(byClass("hps-next-step").length, 0, "no chip from a stopped turn");
  ok(byClass("hps-msg-assistant")[0].textContent.includes("→ 제목을 더 크"), "the cut-off line stays visible");
  eq(byClass("hps-chips-rack").length, 1, "the static follow-ups behave as before");
  // The receipt may sit on a separate row after the answer: the answer is then no longer the last thing said, and keeps its block.
  root = await mount(config("compact"), [CONVERSATION[0], { id: "a1", role: "assistant", content: cut }, { id: "a1#elapsed", role: "system", content: "", createdAt: 1, elapsedTurn: { ...stopped, anchorId: "a1#elapsed" } }]);
  eq(byClass("hps-next-step").length, 0, "no chip with the receipt on its own row");
  ok(byClass("hps-msg-assistant")[0].textContent.includes("→ 제목을 더 크"), "block kept");
  // Control: the same text after a turn that finished is a chip.
  root = await mount(config("compact"), [CONVERSATION[0], { id: "a1", role: "assistant", content: cut, elapsedTurn: { ...stopped, outcome: "done" } }]);
  eq(byClass("hps-next-step").map((e) => e.textContent), ["제목을 더 크"], "control: a finished turn offers it");
});
t("compact: after an error nothing is stripped and no chip is made", async () => {
  await act(async () => { for (const r of live.splice(0)) r.unmount(); });
  const root = createRoot(mountPoint() as never);
  live.push(root);
  await act(async () => { root.render(<ChatPanel {...(PROPS as never)} messages={CONVERSATION as never} config={config("compact")} error="연결이 끊겼어요" instructor={false} />); });
  eq(byClass("hps-next-step").length, 0, "no chips with an error showing");
  ok(byClass("hps-msg-assistant").some((e) => e.textContent.includes("→ 색을 바꿔 보기")), "the block stays in the bubble");
});
t("compact: a reply that is only the block keeps it in the bubble (an empty bubble would hide what the coach said), chips still offered", async () => {
  await mount(config("compact"), [CONVERSATION[0], { id: "a1", role: "assistant", content: `${H}\n→ 하나만` }]);
  ok(byClass("hps-msg-assistant")[0].textContent.includes("→ 하나만"), "block kept");
  eq(byClass("hps-next-step").map((e) => e.textContent), ["하나만"], "and offered as a chip");
});
t("compact: the + menu offers 파일 넣기 and 주소 넣기 only once the host has sent the list", async () => {
  await mount(config("compact"), CONVERSATION, false);
  await openMenu();
  ok(menuItem("작업 폴더 파일 붙이기") && !menuItem("파일 넣기") && !menuItem("주소 넣기"), "no entries without a list: a press could show nothing");
  await hostSays({ type: "materialsState", view: VIEW });
  ok(menuItem("파일 넣기") && menuItem("주소 넣기 (https)"), "entries appear with the list");
});
t("compact: the address form keeps the typed address through other 자료 requests, closes only on its own accepted answer, and returns focus", async () => {
  await mount(config("compact"));
  await openMenu();
  await act(async () => { click(menuItem("주소 넣기 (https)")); });
  const input = () => all((e) => e.localName === "input" && e.getAttribute("name") === "material-url")[0];
  (input() as unknown as { type: string }).type = "url";
  await act(async () => { input().value = "https://example.org/x"; input().dispatchEvent(ev("input")); });
  // An unrelated press (selecting a tag) is answered: the form and its text stay.
  await act(async () => { click(button("이번 질문에 넣기: 메모.md")); });
  await hostSays({ type: "materialsState", view: VIEW, requestId: (last("materialSelect") as { requestId: string }).requestId });
  ok(input() && input().value === "https://example.org/x", "an unrelated accepted request does not close the form");
  const form = () => all((e) => e.localName === "form" && hasClass(e, "hp-materials-url"))[0];
  // Its own request, refused: it stays, address intact.
  await act(async () => { form().dispatchEvent(ev("submit")); });
  await hostSays({ type: "materialsState", view: VIEW, requestId: (last("materialAddUrl") as { requestId: string }).requestId, error: "https:// 로 시작하는 주소만 넣을 수 있어요." });
  ok(input() && input().value === "https://example.org/x", "a refusal keeps the form and the address");
  // Its own request, accepted: it closes and focus goes back to the "+" button.
  await act(async () => { form().dispatchEvent(ev("submit")); });
  await hostSays({ type: "materialsState", view: VIEW, requestId: (last("materialAddUrl") as { requestId: string }).requestId });
  eq(all((e) => e.localName === "input" && e.getAttribute("name") === "material-url").length, 0, "closed on its own answer");
  await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
  const active = (doc as unknown as { activeElement?: El }).activeElement;
  ok(active && hasClass(active, "hps-tool-trigger"), "focus returned to the + button");
});
t("compact: Escape and 닫기 close the address form and return focus too", async () => {
  await mount(config("compact"));
  for (const how of ["escape", "close"]) {
    await openMenu();
    await act(async () => { click(menuItem("주소 넣기 (https)")); });
    const input = all((e) => e.localName === "input" && e.getAttribute("name") === "material-url")[0];
    ok(input, `${how}: form open`);
    if (how === "escape") await act(async () => { input.dispatchEvent({ ...ev("keydown"), key: "Escape" }); });
    else await act(async () => { click(button("닫기")); });
    eq(all((e) => e.localName === "input" && e.getAttribute("name") === "material-url").length, 0, `${how}: closed`);
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    const active = (doc as unknown as { activeElement?: El }).activeElement;
    ok(active && hasClass(active, "hps-tool-trigger"), `${how}: focus on the + button`);
  }
});
t("compact: a running-process card with a folder and no address still names the place; a long title can shorten", () => {
  const html = renderToStaticMarkup(<RunningProcessesPanel entries={[{ id: "live:1", purpose: "미리보기 서버", kind: "preview", folder: "site", state: "running" }] as never} onStop={noop} compact />);
  ok(html.includes('<span class="hps-sr-only">보여 주는 곳: </span>site'), html);
  const css = readFileSync("webview-ui/src/chatDetails.css", "utf8");
  ok(/\.hps-running-processes\[data-coach-layout="compact"\] \.hps-shell-purpose \{[^}]*min-width: 0;[^}]*overflow: hidden;[^}]*text-overflow: ellipsis;/.test(css), "the purpose ellipsizes");
  ok(/\.hps-running-processes\[data-coach-layout="compact"\] \.hps-process-title \{[^}]*min-width: 0;/.test(css), "the title can shrink");
});
t("compact: the instructor console never takes the layout", () => {
  const html = renderToStaticMarkup(<ChatPanel {...(PROPS as never)} messages={CONVERSATION as never} config={config("compact")} instructor={true} />);
  ok(!html.includes("data-coach-layout"), "no layout attribute");
});
t("compact: a running-process card is one row; the heading and state stay for screen readers", () => {
  const entries = [{ id: "live:1", purpose: "미리보기 서버", kind: "preview", folder: "site", address: "127.0.0.1:1", state: "running" }] as never;
  const html = renderToStaticMarkup(<RunningProcessesPanel entries={entries} onStop={noop} compact />);
  ok(html.includes('data-coach-layout="compact"') && html.includes('<h2 id="hps-running-processes-title" class="hps-sr-only">실행 중인 것</h2>'), "heading is screen-reader only");
  ok(!html.includes("보여 주는 곳") && !html.includes("꺼도 돼요"), "no served-place line or note");
  ok(html.includes('<span class="hps-sr-only">주소: </span>127.0.0.1:1') && html.includes('class="hps-process-state hps-sr-only"'), "address inline; state kept for assistive tech");
  ok(html.includes(">끄기</button>") && html.includes("미리보기 서버 실행 중"), "title and stop button");
});

(async () => {
  for (const [label, fn] of tests) {
    try { await fn(); console.log(`  ok   ${label}`); } catch (e) { console.error(`  FAIL ${label}: ${(e as Error).stack ?? e}`); fail++; }
  }
  if (fail) { console.error(`coach-layout-compact: ${fail} failed`); process.exit(1); }
  console.log("coach-layout-compact OK");
  process.exit(0);
})();
