// REQ-STUDIO-FOCUS-RESTORE (CGP-DS-R-023, extends SX-52) — every webview dialog, popover, menu and
// closable inline surface returns focus to its opener when it closes (Escape, close button,
// outside press), falls back to the composer when the opener is gone, and never leaves focus on
// <body>. A modal keeps Tab inside; a popover lets Tab leave and closes.
// Bundled with esbuild and run with plain Node on fixtures/mini-dom.mjs (loaded first). mini-dom
// drops focus to <body> when the focused element is removed, as a browser does; the negative
// control below proves that, so a surface that forgets to restore focus fails here.

import { click, document as doc, mountPoint } from "./fixtures/mini-dom.mjs";
import React, { useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ChatPanel } from "../webview-ui/src/ChatPanel";
import { TaskWorkspaceFrame } from "../webview-ui/src/TaskWorkspace";
import { VerifyPanel } from "../webview-ui/src/VerifyPanel";
import { useDialogFocus, type DialogKind } from "../webview-ui/src/dialogFocus";
import type { ChatConfig, ChatMessage } from "../src/protocol";

// mini-dom exposes its classes on window only; the surfaces use instanceof Node / Element / HTMLElement.
for (const name of ["Node", "Element"]) (globalThis as Record<string, unknown>)[name] ??= (globalThis.window as unknown as Record<string, unknown>)[name];
(globalThis as Record<string, unknown>).HTMLElement ??= (globalThis.window as unknown as Record<string, unknown>).Element;
const act: (fn: () => unknown) => Promise<void> = (React as unknown as { act: (fn: () => unknown) => Promise<void> }).act;
let fail = 0;
const tests: [string, () => void | Promise<void>][] = [];
const t = (label: string, fn: () => void | Promise<void>) => tests.push([label, fn]);
const ok = (v: unknown, m: string) => { if (!v) throw new Error(m); };
const eq = (a: unknown, b: unknown, m: string) => ok(a === b, `${m}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);

type El = {
  localName: string; textContent: string; value: string; nodeType: number; parentNode: El | null; isConnected: boolean;
  getAttribute(n: string): string | null; hasAttribute(n: string): boolean; setAttribute(n: string, v: string): void;
  findAll(test: (e: El) => boolean): El[]; dispatchEvent(e: object): boolean; contains(n: unknown): boolean; focus(): void;
  getBoundingClientRect(): { left: number; right: number; top: number; bottom: number; width: number; height: number };
};
const fire = (target: { dispatchEvent(e: object): boolean }, type: string, extra: object = {}) => {
  const event = {
    type, bubbles: true, cancelable: true, defaultPrevented: false, timeStamp: Date.now(), isComposing: false, keyCode: 0, shiftKey: false, ...extra,
    preventDefault() { (this as { defaultPrevented: boolean }).defaultPrevented = true; }, stopPropagation() { (this as { _stopped: boolean })._stopped = true; },
  };
  target.dispatchEvent(event);
  return event;
};
// React's act() returns a thenable that does not chain, so await it and return the event after.
const key = async (target: El, k: string, extra: object = {}) => { let e = { defaultPrevented: false }; await act(async () => { e = fire(target, "keydown", { key: k, keyCode: k === "Escape" ? 27 : k === "Tab" ? 9 : 0, ...extra }); }); return e; };
/**
 * A pointer press on something that cannot take focus: the outside-close listeners run on
 * pointerdown, then (same task, before any frame) the browser's mousedown moves focus to <body>.
 */
const pressAt = (target: El, extra: object = {}) => act(async () => { fire(target, "pointerdown", extra); doc.body.focus(); });
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 8)); });
const press = async (el: El) => { el.focus(); await act(async () => { click(el); }); await settle(); };
const active = () => doc.activeElement as unknown as El;
const describe = (e: El | null) => !e ? "null" : e === (doc.body as unknown) ? "<body>" : `<${e.localName} class="${e.getAttribute("class") ?? ""}" aria-label="${e.getAttribute("aria-label") ?? ""}">${e.textContent.slice(0, 30)}`;
const focusIs = (e: El | null | undefined, m: string) => ok(e && active() === e, `${m}: focus on ${describe(active())}, wanted ${describe(e ?? null)}`);
const notBody = (m: string) => ok(active() !== (doc.body as unknown), `${m}: focus fell to <body>`);
const cls = (e: El) => (e.getAttribute("class") ?? "").split(/\s+/);
const byClass = (root: El, c: string) => root.findAll((e) => cls(e).includes(c));
const byLabel = (root: El, label: string) => root.findAll((e) => e.getAttribute("aria-label") === label);
const byText = (root: El, tag: string, text: string) => root.findAll((e) => e.localName === tag && e.textContent.trim() === text);
const one = <T,>(list: T[], m: string): T => { ok(list.length >= 1, `${m}: not found`); return list[0]; };

// ---------- Fixtures ----------

const noop = () => {};
const PROPS = {
  streaming: false, streamingId: null, error: null, errorRequestId: null, errorRunbookUrl: null, canRetryLast: false,
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
  profile: { profile_id: "class-a", activity_kind: "classroom", observation: null, lesson: null, rehearsal: null, welcome: { greeting_md: "안녕하세요" }, model_selection: null, ux: UX, input: { image_paste: true } },
  activity: { id: "a1", name: "수업", kind: "classroom", workspace: "/tmp/w", verified: true },
} as unknown as ChatConfig;
const TASKS = { scope: "s", revision: 1, activeTaskId: "t1", tasks: [{ id: "t1", title: "첫 작업", createdAt: 1, updatedAt: 1, messageCount: 2 }, { id: "t2", title: "둘째 작업", createdAt: 1, updatedAt: 1, messageCount: 0 }], sourceSelection: null };
const personal = {
  ...classroom, profile: { ...classroom.profile, activity_kind: "personal" }, activity: { id: "p1", name: "내 작업", kind: "personal", workspace: "/tmp/p", verified: true },
  taskWorkspace: TASKS, access: { status: "unknown" },
} as unknown as ChatConfig;
const CHANGE = { id: "chg-1", added: ["명령 실행하기"], removed: [] };

const u = (id: string, content: string): ChatMessage => ({ id, role: "user", content, createdAt: 1 });
const a = (id: string, content: string, citations?: ChatMessage["citations"]): ChatMessage => ({ id, role: "assistant", content, createdAt: 1, ...(citations ? { citations } : {}) });
const CITE = [{ url: "https://example.org/water", title: "물의 끓는점", domain: "example.org", tier: 4 }] as unknown as ChatMessage["citations"];
const CONVO = [u("u1", "물이 왜 끓어요?"), a("a1", "물은 100도에서 끓어요.", CITE), u("u2", "더 알려줘"), a("a2", "높은 산에서는 더 낮은 온도에서 끓어요.")];

const mounted: Root[] = [];
const setWidth = (w: number) => act(async () => { (globalThis.window as unknown as { innerWidth: number }).innerWidth = w; fire(globalThis.window as unknown as El, "resize", { bubbles: false }); });

/** ChatPanel inside the personal task workspace (as App mounts it), or a bare classroom ChatPanel. */
async function mountChat(config: ChatConfig, opts: { messages?: ChatMessage[]; workspace?: boolean; extra?: object } = {}) {
  const host = mountPoint() as unknown as El;
  const root = createRoot(host as unknown as HTMLElement);
  mounted.push(root);
  let messages = opts.messages ?? CONVO;
  let cfg = config;
  const draw = () => {
    const panel = <ChatPanel {...PROPS} onEditResend={() => true} {...opts.extra} config={cfg} instructor={false} messages={messages} />;
    return opts.workspace === false || !(cfg as { taskWorkspace?: unknown }).taskWorkspace ? panel
      : <TaskWorkspaceFrame view={(cfg as unknown as { taskWorkspace: typeof TASKS }).taskWorkspace as never} messages={messages} busy={false} error={null} onDismissError={noop}>{panel}</TaskWorkspaceFrame>;
  };
  await act(async () => { root.render(draw()); });
  await settle();
  const composer = () => one(host.findAll((e) => e.localName === "textarea" && cls(e.parentNode!).includes("hps-input")), "composer");
  return {
    host, composer,
    rerender: async (next: { messages?: ChatMessage[]; config?: ChatConfig }) => { messages = next.messages ?? messages; cfg = next.config ?? cfg; await act(async () => { root.render(draw()); }); await settle(); },
    unmount: () => act(async () => root.unmount()),
  };
}

// ---------- The shared hook, on a plain harness ----------

function Harness({ kind, hook = true, initialFocus }: { kind: DialogKind; hook?: boolean; initialFocus?: string | false }) {
  const [open, setOpen] = useState(false);
  const [opener, setOpener] = useState(true);
  const box = useRef<HTMLDivElement>(null);
  const Dialog = hook ? HookedBox : PlainBox;
  return <div className="hps-input">
    {opener && <button type="button" className="h-opener" onClick={() => setOpen(true)}>열기</button>}
    <button type="button" className="h-drop-opener" onClick={() => setOpener(false)}>열기 버튼 없애기</button>
    <p className="h-outside">바깥</p>
    <textarea className="h-composer" />
    {open && <Dialog kind={kind} box={box} initialFocus={initialFocus} onClose={() => setOpen(false)} />}
  </div>;
}
function HookedBox({ kind, box, onClose, initialFocus }: { kind: DialogKind; box: React.RefObject<HTMLDivElement | null>; onClose: () => void; initialFocus?: string | false }) {
  useDialogFocus(box, { open: true, kind, onDismiss: onClose, initialFocus });
  return <PlainBox kind={kind} box={box} onClose={onClose} />;
}
function PlainBox({ box, onClose }: { kind: DialogKind; box: React.RefObject<HTMLDivElement | null>; onClose: () => void; initialFocus?: string | false }) {
  return <div ref={box} className="h-box" role="dialog" aria-label="상자" tabIndex={-1}>
    <h2>상자</h2>
    <button type="button" className="h-first">첫째</button>
    <button type="button" className="h-second">둘째</button>
    <button type="button" className="h-close" aria-label="닫기" onClick={onClose}>×</button>
  </div>;
}
async function mountHarness(kind: DialogKind, hook = true, initialFocus?: string | false) {
  const host = mountPoint() as unknown as El;
  const root = createRoot(host as unknown as HTMLElement);
  mounted.push(root);
  await act(async () => { root.render(<Harness kind={kind} hook={hook} initialFocus={initialFocus} />); });
  const get = (c: string) => byClass(host, c)[0];
  const open = async () => { await press(get("h-opener")); ok(get("h-box"), "harness did not open"); };
  return { host, get, open, unmount: () => act(async () => root.unmount()) };
}

t("negative control: a surface without the hook leaves focus on <body> when it closes (mini-dom models focus loss)", async () => {
  const h = await mountHarness("modal", false);
  await h.open();
  h.get("h-first").focus();
  await press(h.get("h-close"));
  ok(!h.get("h-box"), "did not close");
  ok(active() === (doc.body as unknown), `control did not reproduce the bug: focus on ${describe(active())}`);
  await h.unmount();
});

for (const kind of ["modal", "popover"] as const) {
  t(`hook (${kind}): open moves focus to the first actionable element; Escape, close button and outside press each return it to the opener`, async () => {
    const h = await mountHarness(kind);
    await h.open();
    focusIs(h.get("h-first"), "after open");
    await key(h.get("h-first"), "Escape");
    ok(!h.get("h-box"), "Escape did not close");
    focusIs(h.get("h-opener"), "after Escape");
    await h.open();
    await press(h.get("h-close"));
    ok(!h.get("h-box"), "close button did not close");
    focusIs(h.get("h-opener"), "after close button");
    await h.open();
    await pressAt(h.get("h-outside"));
    await settle();
    ok(!h.get("h-box"), "outside press did not close");
    focusIs(h.get("h-opener"), "after outside press");
    await h.unmount();
  });
  t(`hook (${kind}): an IME composition Escape does not close`, async () => {
    const h = await mountHarness(kind);
    await h.open();
    await key(h.get("h-first"), "Escape", { isComposing: true, keyCode: 229 });
    ok(h.get("h-box"), "closed during composition");
    await h.unmount();
  });
  t(`hook (${kind}): opener removed while open → focus goes to the composer, not <body>`, async () => {
    const h = await mountHarness(kind);
    await h.open();
    await act(async () => { click(h.get("h-drop-opener")); });
    ok(!h.get("h-opener"), "opener still there");
    h.get("h-first").focus();
    await press(h.get("h-close"));
    focusIs(h.get("h-composer"), "after close without opener");
    await h.unmount();
  });
}
t("hook (modal): Tab wraps at both ends and never leaves", async () => {
  const h = await mountHarness("modal");
  await h.open();
  h.get("h-close").focus();
  const forward = await key(h.get("h-close"), "Tab");
  ok(forward.defaultPrevented, "Tab on the last element was not held");
  focusIs(h.get("h-first"), "Tab from last");
  const back = await key(h.get("h-first"), "Tab", { shiftKey: true });
  ok(back.defaultPrevented, "Shift+Tab on the first element was not held");
  focusIs(h.get("h-close"), "Shift+Tab from first");
  h.get("h-first").focus();
  const middle = await key(h.get("h-first"), "Tab");
  ok(!middle.defaultPrevented, "Tab inside the cycle must stay native");
  ok(h.get("h-box"), "modal closed on Tab");
  await h.unmount();
});
t("hook (popover): Tab closes it and leaves from the opener (browser Tab continues from there)", async () => {
  const h = await mountHarness("popover");
  await h.open();
  const e = await key(h.get("h-first"), "Tab");
  ok(!e.defaultPrevented, "popover must let Tab leave");
  ok(!h.get("h-box"), "popover stayed open");
  focusIs(h.get("h-opener"), "Tab out");
  await settle();
  focusIs(h.get("h-opener"), "after frame");
  await h.unmount();
});
t("hook: initialFocus selector wins over the first actionable element; false leaves focus where it is", async () => {
  const h = await mountHarness("modal", true, ".h-second");
  await h.open();
  focusIs(h.get("h-second"), "selector");
  await h.unmount();
  const k = await mountHarness("modal", true, false);
  await k.open();
  focusIs(k.get("h-opener"), "initialFocus false");
  await k.unmount();
});

// ---------- Surfaces ----------

for (const [mode, config] of [["personal", personal], ["classroom", classroom]] as const) {
  t(`${mode}: tools menu — opens on its first item; Escape, outside press and Tab return to 도구 열기`, async () => {
    // A classroom seat gets the menu (file item only) where the profile turns file attach on.
    const v = await mountChat(mode === "classroom" ? { ...config, fileAttach: true } as unknown as ChatConfig : config, { extra: mode === "classroom" ? { onAttachFile: noop } : {} });
    const trigger = () => one(byLabel(v.host, "도구 열기"), "tools trigger");
    const menu = () => byClass(v.host, "hps-tools-menu")[0];
    await press(trigger());
    ok(menu(), "menu did not open");
    focusIs(menu().findAll((e) => e.localName === "button")[0], "first item");
    await key(active(), "Escape");
    ok(!menu(), "Escape did not close");
    focusIs(trigger(), "after Escape");
    await press(trigger());
    await pressAt(one(byClass(v.host, "hps-messages"), "messages"));
    await settle();
    ok(!menu(), "outside press did not close");
    focusIs(trigger(), "after outside press");
    await press(trigger());
    const tab = await key(active(), "Tab");
    ok(!menu(), "Tab did not close");
    ok(!tab.defaultPrevented, "Tab must leave the menu natively");
    focusIs(trigger(), "Tab leaves from the trigger (next stop: the composer)");
    await v.unmount();
  });
}

t("personal: task menu (대화 메뉴) — Escape, outside press and Tab return to its toggle", async () => {
  const v = await mountChat(personal);
  const toggle = () => one(byLabel(v.host, "대화 메뉴").filter((e) => e.localName === "button"), "menu toggle");
  const panel = () => byClass(v.host, "tw-chat-menu-panel")[0];
  await press(toggle());
  ok(panel(), "menu did not open");
  focusIs(panel().findAll((e) => e.getAttribute("role") === "menuitem")[0], "first item");
  await key(active(), "Escape");
  ok(!panel(), "Escape did not close");
  focusIs(toggle(), "after Escape");
  await press(toggle());
  await pressAt(one(byClass(v.host, "hps-messages"), "messages"));
  await settle();
  ok(!panel(), "outside press did not close");
  focusIs(toggle(), "after outside press");
  await press(toggle());
  const tab = await key(active(), "Tab");
  ok(!panel(), "Tab did not close");
  ok(!tab.defaultPrevented, "Tab must leave natively");
  focusIs(toggle(), "Tab leaves from the toggle");
  await v.unmount();
});

t("personal: settings dialog — focus inside on open; Escape, × and a backdrop press return to the menu toggle; Tab is trapped", async () => {
  const v = await mountChat(personal);
  const toggle = () => one(byLabel(v.host, "대화 메뉴").filter((e) => e.localName === "button"), "menu toggle");
  const dialog = () => one(byClass(v.host, "hps-preferences"), "settings dialog") as El & { open?: boolean };
  const openSettings = async () => {
    await press(toggle());
    const item = one(byText(v.host, "button", "설정").filter((e) => e.getAttribute("role") === "menuitem"), "설정 item");
    await press(item);
    ok(dialog().open, "dialog did not open");
  };
  await openSettings();
  ok(dialog().contains(active()), `focus not inside the dialog: ${describe(active())}`);
  await key(active(), "Escape");
  await settle();
  ok(!dialog().open, "Escape did not close");
  focusIs(toggle(), "after Escape");
  await openSettings();
  await press(one(byLabel(v.host, "대화 설정 닫기"), "close button"));
  ok(!dialog().open, "× did not close");
  focusIs(toggle(), "after ×");
  await openSettings();
  const d = dialog();
  d.getBoundingClientRect = () => ({ left: 100, right: 500, top: 100, bottom: 400, width: 400, height: 300 });
  await pressAt(d, { clientX: 20, clientY: 20 });
  await settle();
  ok(!dialog().open, "backdrop press did not close");
  focusIs(toggle(), "after backdrop press");
  await openSettings();
  const inside = dialog().findAll((e) => (e.localName === "button" || e.localName === "summary" || e.localName === "input" || e.localName === "select") && !e.hasAttribute("disabled"));
  const last = inside[inside.length - 1];
  last.focus();
  const wrap = await key(last, "Tab");
  ok(wrap.defaultPrevented, "Tab from the last control left the dialog");
  focusIs(inside[0], "Tab wraps to the first control");
  await key(active(), "Escape");
  await settle();
  await v.unmount();
});

t("personal (narrow, 1024px): sources dialog — Escape, × and backdrop return to 자료; from a citation, to that citation; citation gone → 자료", async () => {
  await setWidth(1024);
  const v = await mountChat(personal);
  const toggle = () => one(v.host.findAll((e) => cls(e).includes("tw-sources-toggle")), "자료 toggle");
  const panel = () => one(v.host.findAll((e) => e.getAttribute("id") === "task-sources"), "sources panel");
  const isOpen = () => !panel().hasAttribute("hidden");
  for (const how of ["Escape", "close", "backdrop"] as const) {
    await press(toggle());
    ok(isOpen(), `${how}: did not open`);
    ok(panel().contains(active()), `${how}: focus not inside: ${describe(active())}`);
    if (how === "Escape") await key(active(), "Escape");
    else if (how === "close") await act(async () => { click(one(byClass(v.host, "tw-source-close"), "close")); });
    else await act(async () => { click(one(byClass(v.host, "tw-source-backdrop"), "backdrop")); });
    await settle();
    ok(!isOpen(), `${how}: did not close`);
    focusIs(toggle(), `${how}: back on 자료`);
  }
  const citation = () => one(byClass(v.host, "cp-citation"), "citation");
  await press(citation());
  ok(isOpen(), "citation did not open the panel");
  await key(active(), "Escape");
  await settle();
  focusIs(citation(), "back on the citation");
  await press(citation());
  ok(isOpen(), "citation did not open the panel again");
  // The answer holding the citation goes away (e.g. replaced) while the panel is open.
  await v.rerender({ messages: [u("u9", "새 질문"), a("a9", "새 답", CITE)] });
  await key(active(), "Escape");
  await settle();
  ok(!isOpen(), "did not close");
  notBody("citation gone");
  ok(active() === toggle() || active() === v.composer(), `citation gone: focus on ${describe(active())}`);
  // Tab stays in the narrow dialog.
  await press(toggle());
  const items = panel().findAll((e) => (e.localName === "button" || e.localName === "a") && !e.hasAttribute("disabled"));
  items[items.length - 1].focus();
  const wrap = await key(items[items.length - 1], "Tab");
  ok(wrap.defaultPrevented, "Tab left the sources dialog");
  focusIs(items[0], "Tab wraps");
  await key(active(), "Escape");
  await settle();
  await v.unmount();
});

t("personal (phone, 600px): task list dialog — Escape, 작업 목록 닫기 and an outside press return to the list toggle", async () => {
  await setWidth(600);
  const v = await mountChat(personal);
  const toggle = () => one(byClass(v.host, "tw-rail-toggle"), "rail toggle");
  const rail = () => one(byClass(v.host, "tw-rail"), "rail");
  const isDialog = () => rail().getAttribute("role") === "dialog";
  for (const how of ["Escape", "close", "outside"] as const) {
    await press(toggle());
    ok(isDialog(), `${how}: rail did not open as a dialog`);
    ok(rail().contains(active()), `${how}: focus not inside: ${describe(active())}`);
    // From a control that stays mounted after the close (React would put focus back on it).
    if (how === "Escape") { one(byClass(v.host, "tw-new"), "새 작업").focus(); await key(active(), "Escape"); }
    else if (how === "close") await act(async () => { click(one(byClass(v.host, "tw-rail-close"), "close")); });
    else await pressAt(doc.body as unknown as El);
    await settle();
    ok(!isDialog(), `${how}: did not close`);
    focusIs(toggle(), `${how}: back on the toggle`);
  }
  await v.unmount();
  await setWidth(1024);
});

t("personal: edit box — Escape and 취소 return to 수정 on the same message", async () => {
  await setWidth(1420);
  const v = await mountChat(personal);
  const edit = () => one(byClass(v.host, "hps-edit-prompt"), "수정");
  for (const how of ["Escape", "cancel"] as const) {
    await press(edit());
    const box = one(byClass(v.host, "hps-edit-box"), "edit box");
    focusIs(box.findAll((e) => e.localName === "textarea")[0], `${how}: editor focused`);
    if (how === "Escape") await key(active(), "Escape");
    else await act(async () => { click(one(byText(box, "button", "취소"), "취소")); });
    await settle();
    ok(!byClass(v.host, "hps-edit-box").length, `${how}: did not close`);
    focusIs(edit(), `${how}: back on 수정`);
  }
  await v.unmount();
});

t("personal: rename — Escape and 취소 return to the task title", async () => {
  const v = await mountChat(personal);
  const title = () => one(byClass(v.host, "tw-title-button"), "title button");
  for (const how of ["Escape", "cancel"] as const) {
    await press(title());
    const input = one(byLabel(v.host, "작업 이름"), "name input");
    focusIs(input, `${how}: name input focused`);
    if (how === "Escape") await key(input, "Escape");
    else await act(async () => { click(one(byText(one(byClass(v.host, "tw-rename"), "form"), "button", "취소"), "취소")); });
    await settle();
    ok(!byClass(v.host, "tw-rename").length, `${how}: did not close`);
    focusIs(title(), `${how}: back on the title`);
  }
  await v.unmount();
});

for (const [mode, config] of [["personal", personal], ["classroom", classroom]] as const) {
  t(`${mode}: capability-change card — 알겠어요 removes it and focus goes to the composer (it has no opener)`, async () => {
    const v = await mountChat({ ...config, capabilityChange: CHANGE } as unknown as ChatConfig);
    const dismiss = one(byText(v.host, "button", "알겠어요"), "알겠어요");
    dismiss.focus();
    await act(async () => { click(dismiss); });
    // The host clears the change and sends a new config.
    await v.rerender({ config });
    ok(!byClass(v.host, "hps-capability-change").length, "card still there");
    focusIs(v.composer(), "after 알겠어요");
    await v.unmount();
  });
}

// ---------- Verify panel (inline, opened by the host) ----------

const VIEW = { available: true, reason: null, version: `sha256:${"a".repeat(64)}`, verification: { state: "not_verified", open: [] }, report: null, held: [], run: null, proposals: [], running: false, notice: null };
function VerifyHost({ show, opener }: { show: boolean; opener: boolean }) {
  return <div className="hps-input">
    {opener && <button type="button" className="v-opener">테스트 열기</button>}
    <textarea className="v-composer" />
    {show && <VerifyPanel view={VIEW as never} error={null} busy={false} onStart={noop} onRetest={noop} onFix={noop} onClose={noop} />}
  </div>;
}
t("verify panel: opened while nothing has focus → focus moves in; closing returns it to the opener, or to the composer", async () => {
  const host = mountPoint() as unknown as El;
  const root = createRoot(host as unknown as HTMLElement);
  mounted.push(root);
  await act(async () => { root.render(<VerifyHost show={false} opener={true} />); });
  doc.body.focus();
  await act(async () => { root.render(<VerifyHost show={true} opener={true} />); });
  const panel = one(byClass(host, "hps-verify"), "verify panel");
  ok(panel.contains(active()), `focus not moved in: ${describe(active())}`);
  await act(async () => { root.render(<VerifyHost show={false} opener={true} />); });
  await settle();
  focusIs(byClass(host, "v-composer")[0], "no opener → composer");
  byClass(host, "v-opener")[0].focus();
  await act(async () => { root.render(<VerifyHost show={true} opener={true} />); });
  focusIs(byClass(host, "v-opener")[0], "a focused opener keeps focus while the host opens the panel");
  one(byLabel(host, "테스트 창 닫기"), "close").focus();
  await act(async () => { root.render(<VerifyHost show={false} opener={true} />); });
  await settle();
  focusIs(byClass(host, "v-opener")[0], "back on the opener");
  await act(async () => { root.unmount(); });
});

(async () => {
  for (const [label, fn] of tests) {
    try { await fn(); console.log(`  ok   ${label}`); } catch (e) { console.error(`  FAIL ${label}: ${(e as Error).message}`); if (process.env.HPS_TEST_STACK) console.error((e as Error).stack); fail++; }
    // A failed test must not leave a mounted surface whose document listeners act on the next one.
    for (const root of mounted.splice(0)) { try { await act(async () => root.unmount()); } catch { /* already unmounted */ } }
    for (const node of [...(doc.body as unknown as { childNodes: El[] }).childNodes]) (node as unknown as { remove(): void }).remove();
    doc.body.focus();
  }
  for (const root of mounted) { try { root.unmount(); } catch { /* already unmounted */ } }
  if (fail) { console.error(`dialog-focus: ${fail} failed`); process.exit(1); }
  console.log("dialog-focus OK");
  process.exit(0);
})();
