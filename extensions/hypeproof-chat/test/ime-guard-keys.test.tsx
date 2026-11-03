// CGP-DS-D-024 / REQ-CGP-DS-30 (CGP-DS-R-027) — compose "안녕", then press each key: Enter,
// Escape, Tab, Arrow-up and Cmd/Ctrl+Enter. None of them may send, queue, close, trap, dismiss or
// reach the VS Code host's keybinding forwarder; each stays with the IME. Every surface also gets a
// positive control (the same key after compositionend acts), so a guard that swallows every key
// fails here too.
// Bundled with esbuild and run with plain Node on fixtures/mini-dom.mjs (loaded first). mini-dom
// propagates document events on to the window, as a browser does; the "host forwarder" below is a
// bubble-phase window keydown listener, which is how VS Code's webview pre/index.html
// (`handleInnerKeydown` → `did-keydown`) sees keys.

import { click, document as doc, mountPoint } from "./fixtures/mini-dom.mjs";
import React, { useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ChatPanel } from "../webview-ui/src/ChatPanel";
import { TaskWorkspaceFrame } from "../webview-ui/src/TaskWorkspace";
import { EditPrompt } from "../webview-ui/src/EditResend";
import { useDialogFocus, type DialogKind } from "../webview-ui/src/dialogFocus";
import type { ChatConfig, ChatMessage } from "../src/protocol";

for (const name of ["Node", "Element"]) (globalThis as Record<string, unknown>)[name] ??= (globalThis.window as unknown as Record<string, unknown>)[name];
(globalThis as Record<string, unknown>).HTMLElement ??= (globalThis.window as unknown as Record<string, unknown>).Element;
const act: (fn: () => unknown) => Promise<void> = (React as unknown as { act: (fn: () => unknown) => Promise<void> }).act;
let fail = 0;
const tests: [string, () => void | Promise<void>][] = [];
const t = (label: string, fn: () => void | Promise<void>) => tests.push([label, fn]);
const ok = (v: unknown, m: string) => { if (!v) throw new Error(m); };
const eq = (a: unknown, b: unknown, m: string) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);

type El = {
  localName: string; textContent: string; value: string; parentNode: El | null;
  getAttribute(n: string): string | null; hasAttribute(n: string): boolean;
  findAll(test: (e: El) => boolean): El[]; dispatchEvent(e: object): boolean; contains(n: unknown): boolean; focus(): void;
};
type Fired = { defaultPrevented: boolean };
const fire = (target: { dispatchEvent(e: object): boolean }, type: string, extra: object = {}): Fired => {
  const event = {
    type, bubbles: true, cancelable: true, defaultPrevented: false, timeStamp: Date.now(), isComposing: false, keyCode: 0,
    shiftKey: false, metaKey: false, ctrlKey: false, altKey: false, repeat: false, data: "", ...extra,
    preventDefault() { (this as { defaultPrevented: boolean }).defaultPrevented = true; }, stopPropagation() { (this as { _stopped: boolean })._stopped = true; },
  };
  target.dispatchEvent(event);
  return event;
};
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 8)); });
const active = () => doc.activeElement as unknown as El;
const cls = (e: El) => (e.getAttribute("class") ?? "").split(/\s+/);
const byClass = (root: El, c: string) => root.findAll((e) => cls(e).includes(c));
const byLabel = (root: El, label: string) => root.findAll((e) => e.getAttribute("aria-label") === label);
const one = <T,>(list: T[], m: string): T => { ok(list.length >= 1, `${m}: not found`); return list[0]; };

// The keys the row names, as a physical keyboard sends them.
const KEYS: { name: string; key: string; keyCode: number; metaKey?: boolean; ctrlKey?: boolean }[] = [
  { name: "Enter", key: "Enter", keyCode: 13 },
  { name: "Escape", key: "Escape", keyCode: 27 },
  { name: "Tab", key: "Tab", keyCode: 9 },
  { name: "Arrow-up", key: "ArrowUp", keyCode: 38 },
  { name: "Cmd+Enter", key: "Enter", keyCode: 13, metaKey: true },
  { name: "Ctrl+Enter", key: "Enter", keyCode: 13, ctrlKey: true },
];
// How a browser reports an open composition on keydown: Chromium's isComposing + 229, the legacy
// 229 alone, and isComposing with the real keyCode (Firefox). The composer test also covers a key
// that arrives after compositionstart with neither flag (the component's own composition state).
const SIGNALS = [
  { name: "isComposing/229", flags: (k: typeof KEYS[number]) => ({ isComposing: true, keyCode: 229, key: k.key }) },
  { name: "legacy 229 only", flags: (k: typeof KEYS[number]) => ({ isComposing: false, keyCode: 229, key: k.key }) },
  { name: "isComposing, real keyCode", flags: (k: typeof KEYS[number]) => ({ isComposing: true, keyCode: k.keyCode, key: k.key }) },
] as const;

// The host forwarder: VS Code's webview pre script on the iframe window, bubble phase.
const forwarded: string[] = [];
const forwarder = (event: { key: string; metaKey?: boolean; ctrlKey?: boolean }) => { forwarded.push(`${event.metaKey ? "Cmd+" : event.ctrlKey ? "Ctrl+" : ""}${event.key}`); };
(globalThis.window as unknown as { addEventListener(t: string, l: unknown): void }).addEventListener("keydown", forwarder);

/** Compose "안녕" into a text field: compositionstart, the value, an input event. */
const compose = (field: El, text = "안녕") => act(async () => {
  fire(field, "compositionstart", { data: "" });
  (field as unknown as { value: string }).value = text;
  fire(field, "input", { isComposing: true, data: text });
});
const endComposition = (field: El, text = "안녕") => act(async () => { fire(field, "compositionend", { data: text }); });
const press = async (target: El, k: typeof KEYS[number], flags: object = {}) => {
  let e: Fired = { defaultPrevented: false };
  await act(async () => { e = fire(target, "keydown", { key: k.key, keyCode: k.keyCode, metaKey: !!k.metaKey, ctrlKey: !!k.ctrlKey, ...flags }); });
  await settle();
  return e;
};

// ---------- Fixtures (as dialog-focus.test.tsx) ----------

const noop = () => {};
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
const TASKS = { scope: "s", revision: 1, activeTaskId: "t1", tasks: [{ id: "t1", title: "첫 작업", createdAt: 1, updatedAt: 1, messageCount: 2 }], sourceSelection: null };
const personal = {
  ...classroom, profile: { ...classroom.profile, activity_kind: "personal" }, activity: { id: "p1", name: "내 작업", kind: "personal", workspace: "/tmp/p", verified: true },
  taskWorkspace: TASKS, access: { status: "unknown" },
} as unknown as ChatConfig;
const CITE = [{ url: "https://example.org/water", title: "물의 끓는점", domain: "example.org", tier: 4 }] as unknown as ChatMessage["citations"];
const CONVO: ChatMessage[] = [
  { id: "u1", role: "user", content: "물이 왜 끓어요?", createdAt: 1 } as ChatMessage,
  { id: "a1", role: "assistant", content: "물은 100도에서 끓어요.", createdAt: 1, citations: CITE } as ChatMessage,
];
const mounted: Root[] = [];

async function mountChat(config: ChatConfig, streaming = false) {
  const host = mountPoint() as unknown as El;
  const root = createRoot(host as unknown as HTMLElement);
  mounted.push(root);
  const sent: string[] = [];
  const panel = <ChatPanel streaming={streaming} streamingId={streaming ? "s1" : null} error={null} errorRequestId={null} errorRunbookUrl={null} canRetryLast={false}
    pageNotice={null} aiNotice={null} stopNotice={null} openWorldId={null} publish={null} incomingImage={null}
    onSend={(text: string) => { sent.push(text); }} onRetry={noop} onRetryLast={noop} onDismissError={noop} onCancel={noop} onClear={noop}
    onSetToken={noop} onSettings={noop} onRunCode={noop} onNamingRitual={noop} onSaveCoach={noop}
    onReportProblem={noop} onInstallUpdate={noop} onDismissUpdate={noop} onPublish={noop} onEditResend={() => true}
    config={config} instructor={false} messages={CONVO} />;
  const tree = (config as { taskWorkspace?: unknown }).taskWorkspace
    ? <TaskWorkspaceFrame view={TASKS as never} messages={CONVO} busy={false} error={null} onDismissError={noop}>{panel}</TaskWorkspaceFrame>
    : panel;
  await act(async () => { root.render(tree); });
  await settle();
  const composer = () => one(host.findAll((e) => e.localName === "textarea" && cls(e.parentNode!).includes("hps-input")), "composer");
  return { host, sent, composer };
}

// ---------- The webview entry installs the host barrier ----------
// Runs first on purpose: importing main.tsx installs the barrier on the shared document, as the real
// webview does before any surface mounts. The later tests' `forwarded` checks rely on it.

t("main.tsx: the webview entry stops composition keydowns before the host forwarder, and only those", async () => {
  const root = doc.createElement("div") as unknown as El & { setAttribute(n: string, v: string): void };
  root.setAttribute("id", "root");
  (doc.body as unknown as { appendChild(n: unknown): void }).appendChild(root);
  await act(async () => { await import("../webview-ui/src/main"); });
  await settle();
  const field = doc.createElement("input") as unknown as El;
  (doc.body as unknown as { appendChild(n: unknown): void }).appendChild(field);
  for (const k of KEYS) {
    for (const s of SIGNALS) {
      forwarded.length = 0;
      await press(field, k, s.flags(k));
      eq(forwarded, [], `${k.name} (${s.name}) from a plain field reached the host forwarder`);
    }
    forwarded.length = 0;
    await press(field, k);
    eq(forwarded.length, 1, `positive control: a plain ${k.name} must still reach the host`);
  }
});

// ---------- The composer, personal workspace and classroom ----------

for (const [mode, config] of [["personal", personal], ["classroom", classroom]] as const) {
  for (const streaming of [false, true]) {
    t(`${mode}${streaming ? " (mid-turn)" : ""}: composer — each key while composing 안녕 neither sends, queues, clears nor reaches the host`, async () => {
      const v = await mountChat(config, streaming);
      const field = v.composer();
      field.focus();
      // Any ancestor outside the React root (as the workspace's native listeners are): the composer
      // keeps composition keys from reaching it, independent of each ancestor's own guard.
      const ancestor: string[] = [];
      const spy = (event: { key: string }) => { ancestor.push(event.key); };
      (doc.body as unknown as { addEventListener(t: string, l: unknown): void }).addEventListener("keydown", spy);
      for (const k of KEYS) {
        for (const s of SIGNALS) {
          await compose(field);
          forwarded.length = 0;
          ancestor.length = 0;
          const e = await press(field, k, s.flags(k));
          eq(ancestor, [], `${k.name} (${s.name}) reached an ancestor of the composer`);
          eq(v.sent, [], `${k.name} (${s.name}) sent`);
          eq(v.composer().value, "안녕", `${k.name} (${s.name}) changed the draft`);
          ok(!byClass(v.host, "hps-queued").length, `${k.name} (${s.name}) queued the draft`);
          ok(!e.defaultPrevented, `${k.name} (${s.name}) was taken from the IME (preventDefault)`);
          eq(forwarded, [], `${k.name} (${s.name}) reached the host forwarder`);
          await endComposition(field);
        }
      }
      // The composer's own state: a key after compositionstart and before compositionend, with no flag.
      for (const k of KEYS) {
        await compose(field);
        ancestor.length = 0;
        await press(field, k);
        eq(v.sent, [], `${k.name} after compositionstart (no isComposing flag) sent`);
        eq(ancestor, [], `${k.name} after compositionstart (no isComposing flag) reached an ancestor`);
        await endComposition(field);
      }
      // Positive control for the spy: a plain Arrow-up after compositionend reaches the ancestor.
      ancestor.length = 0;
      await press(field, KEYS[3]);
      eq(ancestor, ["ArrowUp"], "positive control: a plain Arrow-up must reach an ancestor");
      (doc.body as unknown as { removeEventListener(t: string, l: unknown): void }).removeEventListener("keydown", spy);
      // Positive control: Enter and Cmd/Ctrl+Enter after compositionend act.
      if (!streaming) {
        for (const k of KEYS.filter((x) => x.key === "Enter")) {
          await compose(field);
          await endComposition(field);
          await press(field, k);
          eq(v.sent, ["안녕"], `positive control: ${k.name} after compositionend did not send`);
          v.sent.length = 0;
        }
      } else {
        await compose(field);
        await endComposition(field);
        await press(field, KEYS[0]);
        ok(byClass(v.host, "hps-queued").length && v.composer().value === "", "positive control: a plain mid-turn Enter did not queue the draft");
      }
    });
  }
}

t("personal: composer — Escape while composing leaves the sources panel open; a plain Escape closes it", async () => {
  (globalThis.window as unknown as { innerWidth: number }).innerWidth = 1420;
  const v = await mountChat(personal);
  const toggle = one(v.host.findAll((e) => cls(e).includes("tw-sources-toggle")), "자료 toggle");
  const panel = () => one(v.host.findAll((e) => e.getAttribute("id") === "task-sources"), "sources panel");
  await act(async () => { click(toggle); });
  await settle();
  ok(!panel().hasAttribute("hidden"), "sources did not open");
  const field = v.composer();
  field.focus();
  for (const k of KEYS) {
    for (const s of SIGNALS) {
      await compose(field);
      await press(field, k, s.flags(k));
      ok(!panel().hasAttribute("hidden"), `${k.name} (${s.name}) closed the sources panel`);
      await endComposition(field);
    }
  }
  await compose(field);
  await endComposition(field);
  forwarded.length = 0;
  await press(field, KEYS[1]);
  ok(panel().hasAttribute("hidden"), "positive control: a plain Escape did not close the sources panel");
  (globalThis.window as unknown as { innerWidth: number }).innerWidth = 1024;
});

// ---------- Other text fields: task rename and the edit box ----------

t("personal: task rename — each key while composing keeps the rename and the sources panel open and away from the host", async () => {
  (globalThis.window as unknown as { innerWidth: number }).innerWidth = 1420;
  const v = await mountChat(personal);
  // The rename field does not stop propagation: the workspace's own Escape (close sources) must check composition.
  await act(async () => { click(one(v.host.findAll((e) => cls(e).includes("tw-sources-toggle")), "자료 toggle")); });
  await settle();
  const sources = () => one(v.host.findAll((e) => e.getAttribute("id") === "task-sources"), "sources panel");
  ok(!sources().hasAttribute("hidden"), "sources did not open");
  await act(async () => { click(one(byClass(v.host, "tw-title-button"), "title button")); });
  await settle();
  const input = () => one(byLabel(v.host, "작업 이름"), "name input");
  for (const k of KEYS) {
    for (const s of SIGNALS) {
      await compose(input());
      forwarded.length = 0;
      await press(input(), k, s.flags(k));
      ok(byClass(v.host, "tw-rename").length, `${k.name} (${s.name}) closed the rename`);
      ok(!sources().hasAttribute("hidden"), `${k.name} (${s.name}) closed the sources panel`);
      eq(forwarded, [], `${k.name} (${s.name}) reached the host forwarder`);
      await endComposition(input());
    }
  }
  forwarded.length = 0;
  await press(input(), KEYS[1]);
  ok(!byClass(v.host, "tw-rename").length, "positive control: a plain Escape did not close the rename");
  // (The workspace consumes that Escape for the sources panel; the plain-key host control is the main.tsx test.)
  ok(sources().hasAttribute("hidden"), "positive control: a plain Escape from the rename field did not reach the workspace");
  (globalThis.window as unknown as { innerWidth: number }).innerWidth = 1024;
});

t("edit box — each key while composing neither saves nor cancels; plain Enter saves", async () => {
  const host = mountPoint() as unknown as El;
  const root = createRoot(host as unknown as HTMLElement);
  mounted.push(root);
  const calls: string[] = [];
  await act(async () => { root.render(<EditPrompt text="물이 왜 끓어요?" images={[]} revertNote={false} onSave={(text: string) => { calls.push(`save:${text}`); }} onCancel={() => { calls.push("cancel"); }} />); });
  const area = one(byLabel(host, "고칠 메시지"), "edit area");
  for (const k of KEYS) {
    for (const s of SIGNALS) {
      await compose(area);
      forwarded.length = 0;
      await press(area, k, s.flags(k));
      eq(calls, [], `${k.name} (${s.name}) saved or cancelled`);
      eq(forwarded, [], `${k.name} (${s.name}) reached the host forwarder`);
      await endComposition(area);
    }
  }
  await press(area, KEYS[0]);
  eq(calls, ["save:안녕"], "positive control: a plain Enter did not save");
});

// ---------- Tab inside a modal and a popover that hold a text field ----------

function Surface({ kind }: { kind: DialogKind }) {
  const [open, setOpen] = useState(true);
  const box = useRef<HTMLDivElement>(null);
  return <div>
    <button type="button" className="s-opener">열기</button>
    {open && <Inner kind={kind} box={box} onClose={() => setOpen(false)} />}
  </div>;
}
function Inner({ kind, box, onClose }: { kind: DialogKind; box: React.RefObject<HTMLDivElement | null>; onClose: () => void }) {
  useDialogFocus(box, { open: true, kind, onDismiss: onClose });
  return <div ref={box} className="s-box" role="dialog" aria-label="상자" tabIndex={-1}>
    <button type="button" className="s-first">첫째</button>
    <input className="s-field" aria-label="이름" />
  </div>;
}
for (const kind of ["modal", "popover"] as const) {
  t(`${kind}: Tab while composing in its last field neither wraps, moves focus nor ${kind === "modal" ? "is held" : "dismisses"}; a plain Tab does`, async () => {
    const host = mountPoint() as unknown as El;
    const root = createRoot(host as unknown as HTMLElement);
    mounted.push(root);
    await act(async () => { root.render(<Surface kind={kind} />); });
    await settle();
    const field = one(byClass(host, "s-field"), "field");
    field.focus();
    for (const s of SIGNALS) {
      await compose(field);
      const e = await press(field, KEYS[2], s.flags(KEYS[2]));
      ok(byClass(host, "s-box").length, `Tab (${s.name}) closed the ${kind}`);
      ok(active() === field, `Tab (${s.name}) moved focus`);
      ok(!e.defaultPrevented, `Tab (${s.name}) was taken from the IME`);
      await endComposition(field);
    }
    const plain = await press(field, KEYS[2]);
    if (kind === "modal") {
      ok(plain.defaultPrevented && active() === one(byClass(host, "s-first"), "first"), "positive control: a plain Tab did not wrap");
    } else {
      ok(!byClass(host, "s-box").length, "positive control: a plain Tab did not dismiss the popover");
    }
  });
}

(async () => {
  for (const [label, fn] of tests) {
    try { await fn(); console.log(`  ok   ${label}`); } catch (e) { console.error(`  FAIL ${label}: ${(e as Error).message}`); if (process.env.HPS_TEST_STACK) console.error((e as Error).stack); fail++; }
    for (const root of mounted.splice(0)) { try { await act(async () => root.unmount()); } catch { /* already unmounted */ } }
    doc.body.focus();
  }
  if (fail) { console.error(`ime-guard-keys: ${fail} failed`); process.exit(1); }
  console.log("ime-guard-keys OK");
  process.exit(0);
})();
