// CGP-CHAT-D-002 — the real ChatPanel around the in-place editor: the composer is blocked while the
// editor is open (the ChatPanel call site of composerBlockedByEdit), Escape cancels and focus returns
// to that message's 수정, and opening scrolls the editor into view. Bundled with esbuild, run on mini-dom.

import { click, document as doc, mountPoint } from "./fixtures/mini-dom.mjs";
import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { ChatPanel } from "../webview-ui/src/ChatPanel";
import { EDIT_OPEN_NOTE } from "../src/editResend";
import type { ChatConfig, ChatMessage } from "../src/protocol";

for (const name of ["Node", "Element"]) (globalThis as Record<string, unknown>)[name] ??= (globalThis.window as unknown as Record<string, unknown>)[name];
(globalThis as Record<string, unknown>).HTMLElement ??= (globalThis.window as unknown as Record<string, unknown>).Element;
const act: (fn: () => unknown) => Promise<void> = (React as unknown as { act: (fn: () => unknown) => Promise<void> }).act;
let fail = 0;
const tests: [string, () => void | Promise<void>][] = [];
const t = (label: string, fn: () => void | Promise<void>) => tests.push([label, fn]);
const ok = (v: unknown, m: string) => { if (!v) throw new Error(m); };
const eq = (a: unknown, b: unknown, m: string) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);

type El = { localName: string; textContent: string; getAttribute(n: string): string | null; findAll(test: (e: El) => boolean): El[]; dispatchEvent(e: object): boolean; focus(): void };
const fireKey = async (target: El, k: string, extra: object = {}) => {
  const ev: Record<string, unknown> = { type: "keydown", key: k, bubbles: true, cancelable: true, defaultPrevented: false, timeStamp: Date.now(), isComposing: false, keyCode: k === "Escape" ? 27 : 0, shiftKey: false, ...extra,
    preventDefault() { ev.defaultPrevented = true; }, stopPropagation() { ev._stopped = true; } };
  await act(async () => { target.dispatchEvent(ev); });
  return ev;
};
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 8)); });
const cls = (e: El) => (e.getAttribute("class") ?? "").split(/\s+/);
const byClass = (root: El, c: string) => root.findAll((e) => cls(e).includes(c));

const noop = () => {};
const UX = {
  coach: { naming_mode: "fixed" as const, fallback_name: "HypeProof", naming_prompt_md: "", personality_prompt_md: "" },
  suggestions: { initial: [], follow_up: [] },
  hints: { short_input: { enabled: false, min_chars: 0, message_md: "" }, roll_input_button: { enabled: false, label: "", probe_md: "" } },
  retry_button: { enabled: false, show_counter: false },
};
const config = (kind: "personal" | "classroom") => ({
  model: "claude-sonnet-5", hasToken: true, proxyUrl: "http://localhost:8787",
  coach: { name: "HypeProof", personality: "", configured: true },
  profile: { profile_id: "p", activity_kind: kind, observation: null, lesson: null, rehearsal: null, welcome: { greeting_md: "안녕하세요" }, model_selection: null, ux: UX },
  activity: { id: "a1", name: "작업", kind, workspace: "/tmp/w", verified: true },
  activityDraft: { text: "초안 메시지", images: [] },
  ...(kind === "personal" ? { taskWorkspace: { scope: "s", revision: 1, activeTaskId: "t1", tasks: [{ id: "t1", title: "작업", createdAt: 1, updatedAt: 1, messageCount: 2 }], sourceSelection: null } } : {}),
}) as unknown as ChatConfig;
const u = (id: string, content: string): ChatMessage => ({ id, role: "user", content, createdAt: 1 });
const a = (id: string, content: string): ChatMessage => ({ id, role: "assistant", content, createdAt: 1 });
const CONVO = [u("u1", "첫 질문"), a("a1", "첫 답"), u("u2", "고양이 그려 줘"), a("a2", "고양이 답")];

const mounted: Root[] = [];
async function mountChat(kind: "personal" | "classroom") {
  const sent: unknown[][] = [];
  const host = mountPoint() as unknown as El;
  const root = createRoot(host as unknown as HTMLElement);
  mounted.push(root);
  const props = {
    messages: CONVO, streaming: false, streamingId: null, error: null, errorRequestId: null, errorRunbookUrl: null, canRetryLast: false,
    pageNotice: null, aiNotice: null, stopNotice: null, openWorldId: null, publish: null, incomingImage: null,
    onSend: (...args: unknown[]) => { sent.push(args); }, onRetry: noop, onRetryLast: noop, onDismissError: noop, onCancel: noop, onClear: noop,
    onSetToken: noop, onSettings: noop, onRunCode: noop, onNamingRitual: noop, onSaveCoach: noop,
    onReportProblem: noop, onInstallUpdate: noop, onDismissUpdate: noop, onPublish: noop,
    onEditResend: () => true, config: config(kind), instructor: false,
  };
  await act(async () => { root.render(<ChatPanel {...(props as unknown as React.ComponentProps<typeof ChatPanel>)} />); });
  await settle();
  const editButton = () => byClass(host, "hps-edit-prompt")[0];
  const box = () => byClass(host, "hps-edit-box")[0];
  const composer = () => host.findAll((e) => e.localName === "textarea" && cls((e as unknown as { parentNode: El }).parentNode).includes("hps-input"))[0];
  const open = async () => { editButton().focus(); await act(async () => { click(editButton()); }); await settle(); ok(box(), "editor did not open"); };
  return { host, sent, editButton, box, composer, open };
}

for (const kind of ["personal", "classroom"] as const) {
  t(`${kind}: control: with no editor open the composer sends the draft`, async () => {
    const v = await mountChat(kind);
    // Positive control: with the editor closed the same Enter on the same draft sends it.
    await fireKey(v.composer(), "Enter");
    eq(v.sent.length, 1, "control: Enter sends the draft when no editor is open");
    eq(v.sent[0][0], "초안 메시지", "control: payload");
  });
  t(`${kind}: with the editor open, Enter in the composer sends nothing and shows the note`, async () => {
    const v = await mountChat(kind);
    await v.open();
    await fireKey(v.composer(), "Enter");
    eq(v.sent.length, 0, "composer sent while editing");
    ok(v.host.textContent.includes(EDIT_OPEN_NOTE), "blocked-send note not shown");
    ok(v.box(), "editor closed by the blocked send");
    // Closing the editor unblocks the composer, and the draft is still there.
    await fireKey(v.box().findAll((e) => e.localName === "textarea")[0], "Escape");
    await settle();
    ok(!v.box(), "Escape did not close the editor");
    await fireKey(v.composer(), "Enter");
    eq(v.sent.length, 1, "after cancel the draft sends");
    eq(v.sent[0][0], "초안 메시지", "draft kept through the edit");
  });
  t(`${kind}: Escape cancels the editor and focus returns to 수정 on the same message`, async () => {
    const v = await mountChat(kind);
    await v.open();
    const area = v.box().findAll((e) => e.localName === "textarea")[0];
    ok(doc.activeElement === (area as unknown), "editor textarea not focused on open");
    await fireKey(area, "Escape");
    await settle();
    ok(!v.box(), "editor still open after Escape");
    ok(doc.activeElement === (v.editButton() as unknown), `focus not on 수정: ${(doc.activeElement as unknown as El)?.localName}`);
  });
}

t("opening the editor scrolls it into view with block nearest", async () => {
  const v = await mountChat("classroom");
  const proto = Object.getPrototypeOf(v.host);
  const orig = proto.scrollIntoView;
  const calls: unknown[][] = [];
  proto.scrollIntoView = function (this: El, ...args: unknown[]) { calls.push([this, ...args]); };
  try { await v.open(); } finally { proto.scrollIntoView = orig; }
  const hit = calls.filter((c) => cls(c[0] as El).includes("hps-edit-box"));
  eq(hit.length, 1, "scrollIntoView on the edit box");
  eq(hit[0][1], { block: "nearest" }, "scroll options");
});

(async () => {
  for (const [label, fn] of tests) {
    try { await fn(); console.log(`  ok   ${label}`); } catch (e) { console.error(`  FAIL ${label}: ${(e as Error).message}`); fail++; }
    for (const root of mounted.splice(0)) { try { await act(async () => root.unmount()); } catch { /* already unmounted */ } }
    for (const node of [...(doc.body as unknown as { childNodes: El[] }).childNodes]) (node as unknown as { remove(): void }).remove();
    doc.body.focus();
  }
  if (fail) { console.error(`edit-in-place-panel: ${fail} failed`); process.exit(1); }
  console.log("edit-in-place-panel OK");
  process.exit(0);
})();
