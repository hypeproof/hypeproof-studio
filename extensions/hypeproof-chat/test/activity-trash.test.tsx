// CGP-KNOW-D-013 (DES-KNOW-24) — the webview half of the activity trash: the real ActivityTrashPanel
// on the minimal DOM (fixtures/mini-dom.mjs). The toast reads "휴지통으로 옮겼어요 · 되돌리기" in a polite
// live region for exactly 8 seconds, stays while hovered or focused, and its 되돌리기 asks the host
// to restore; 영구 삭제 opens a dialog naming the file with 취소 focused. The host side is
// test/activity-trash-panel.smoke.mjs; the 44px and type-size rules are test/activity-trash-css.smoke.mjs.

import { click, mountPoint, document } from "./fixtures/mini-dom.mjs";
import React from "react";
import { createRoot } from "react-dom/client";
import { ActivityTrashPanel } from "../webview-ui/src/ActivityTrashPanel";
import { TRASH_TOAST_MS } from "../src/activityTrashView";
import { readFileSync } from "node:fs";
import { staticTokens } from "./lib/expand-design-tokens.mjs";

type Node = { tagName?: string; textContent: string; getAttribute(n: string): string | null; hasAttribute(n: string): boolean; focus(): void; dispatchEvent(e: unknown): boolean; findAll(f: (e: Node) => boolean): Node[] };
const act: (fn: () => unknown) => Promise<void> = (React as unknown as { act: (fn: () => unknown) => Promise<void> }).act;
const posted = () => (globalThis as unknown as { __posted: Array<Record<string, string>> }).__posted;
const host = mountPoint() as unknown as Node;
const root = createRoot(host as unknown as HTMLElement);
let fail = 0;
const tests: [string, () => Promise<void>][] = [];
const t = (label: string, fn: () => Promise<void>) => tests.push([label, fn]);
const ok = (v: unknown, m: string) => { if (!v) throw new Error(m); };
const show = (v: unknown) => { if (v && typeof v === "object" && "tagName" in v) { const n = v as Node; return `<${n.tagName} ${n.getAttribute("aria-label") ?? n.textContent.slice(0, 20)}>`; } return JSON.stringify(v); };
const eq = (a: unknown, b: unknown, m = "") => { if (a !== b) throw new Error(`${m} ${show(a)} !== ${show(b)}`); };

// Only the toast's 8-second timer is virtual; everything else runs on the real clock.
const realSet = globalThis.setTimeout, realClear = globalThis.clearTimeout;
let now = 0, nextId = 1e7;
const timers = new Map<number, { at: number; fn: () => void }>();
const delays: number[] = [];
globalThis.setTimeout = ((fn: () => void, delay?: number, ...rest: unknown[]) => {
  if (delay === TRASH_TOAST_MS) { delays.push(delay); timers.set(++nextId, { at: now + delay, fn }); return nextId; }
  return realSet(fn, delay, ...rest);
}) as typeof setTimeout;
globalThis.clearTimeout = ((id: number) => { if (!timers.delete(id)) realClear(id); }) as typeof clearTimeout;
const advance = async (ms: number) => { now += ms; for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); await act(() => timer.fn()); } };

const files = { entries: [{ path: "작품.html", kind: "unknown" as const, label: "기록 없음", symbol: "○", history: [] }], more: 0, unobserved: false, unconfirmed: false };
const entry = { id: "11111111-1111-4111-8111-111111111111", path: "작품.html", at: Date.UTC(2026, 9, 21) };
const SCOPE = '["a",null]';
const all = (f: (e: Node) => boolean) => host.findAll(f);
const buttons = () => all(e => e.tagName === "BUTTON");
const button = (text: string) => buttons().find(e => e.textContent.trim() === text || e.textContent.includes(text));
const toast = () => all(e => e.getAttribute("data-testid") === "trash-toast")[0];
const event = (target: Node, type: string, extra: Record<string, unknown> = {}) => target.dispatchEvent({ type, bubbles: true, cancelable: true, defaultPrevented: false, preventDefault() { (this as { defaultPrevented: boolean }).defaultPrevented = true; }, stopPropagation() {}, ...extra });
const send = (data: Record<string, unknown>) => act(() => { (globalThis as unknown as { window: { dispatchEvent(e: unknown): boolean } }).window.dispatchEvent({ type: "message", bubbles: false, data: { type: "activityTrashState", ...data } }); });
const view = (entries = [entry], scope = SCOPE) => ({ scope, entries, damaged: 0 });
const lastAction = () => posted().filter(p => p.type === "activityTrashAction").at(-1)!;
const press = (text: string) => act(() => { const b = button(text)!; b.focus(); click(b); });
const render = (scopeKey = "task-a", list: typeof files = files) => act(() => root.render(<ActivityTrashPanel files={list} scopeKey={scopeKey} />));
const row = (path: string) => ({ path, kind: "unknown" as const, label: "기록 없음", symbol: "○", history: [] as never[] });
const fileList = (...paths: string[]) => ({ ...files, entries: paths.map(row) });
const trashed = (path: string, n: number) => ({ id: `${n}`.repeat(8) + "-1111-4111-8111-111111111111", path, at: Date.UTC(2026, 9, 21) });
const moveButton = (path: string) => buttons().find(b => b.getAttribute("aria-label") === `휴지통으로 옮기기: ${path}`)!;
const listButton = (kind: string, path: string) => buttons().find(b => b.getAttribute("aria-label") === `${kind}: ${path}`)!;
const entryButton = () => buttons().find(b => b.textContent.startsWith("휴지통 ·"))!;
const focusOn = (b: Node) => act(() => { b.focus(); event(b, "focusin"); });
const active = () => (document as unknown as { activeElement: Node }).activeElement;
const answerMove = (e: ReturnType<typeof trashed>) => send({ view: view([e]), requestId: lastAction().requestId, result: { action: "move", id: e.id, path: e.path } });
/** Press 휴지통으로 옮기기 and answer as the host does after a confirmed move. */
const move = async () => {
  await press("휴지통으로 옮기기");
  const a = lastAction();
  eq(a.action, "move"); eq(a.target, "작품.html"); eq(a.scope, SCOPE);
  await send({ view: view(), requestId: a.requestId, result: { action: "move", id: entry.id, path: entry.path } });
};

t("the live region is atomic, hidden when empty and shown with a toast", async () => {
  await render("t-live"); await send({ view: view([]) });
  eq(toast().getAttribute("aria-atomic"), "true"); eq(toast().getAttribute("data-shown"), "false");
  await move();
  eq(toast().getAttribute("data-shown"), "true");
  await advance(TRASH_TOAST_MS);
  eq(toast().getAttribute("data-shown"), "false");
});

t("the toast duration constant is 8 seconds", async () => { eq(TRASH_TOAST_MS, 8000); });

t("unavailable (host answers null): no trash entry and no per-file trash press", async () => {
  await render();
  ok(posted().some(p => p.type === "activityTrashRequest"), "the panel asks for the trash");
  await send({ view: null });
  ok(!button("휴지통으로 옮기기"), "no move press without a trash");
  ok(!all(e => e.getAttribute("data-testid") === "activity-trash").length, "no trash entry");
});

t("the trash entry is the last thing in 내 작품, after the file list", async () => {
  await send({ view: view([]) });
  const works = all(e => e.getAttribute("data-testid") === "my-works")[0];
  eq(works.getAttribute("aria-label"), "내 작품");
  const order = works.findAll(e => e.getAttribute("data-testid") === "artifact-provenance" || e.getAttribute("data-testid") === "activity-trash").map(e => e.getAttribute("data-testid"));
  eq(order.join(","), "artifact-provenance,activity-trash");
  ok(button("휴지통 · 0개"), "entry shows the count");
});

t("move → polite live toast with the exact copy, and 되돌리기 as a real button", async () => {
  await move();
  const live = toast();
  eq(live.getAttribute("role"), "status"); eq(live.getAttribute("aria-live"), "polite");
  eq(live.textContent, "휴지통으로 옮겼어요 · 되돌리기");
  const undo = button("되돌리기")!;
  eq(undo.tagName, "BUTTON"); ok(!undo.hasAttribute("disabled"), "되돌리기 is pressable");
});

t("the toast lasts exactly 8 seconds", async () => {
  await advance(TRASH_TOAST_MS - 1);
  ok(button("되돌리기"), "still there at 7999ms");
  await advance(1);
  ok(!button("되돌리기"), "gone at 8000ms");
  eq(toast().textContent, "", "the live region is emptied");
});

t("focus inside the toast holds it; leaving starts a fresh 8 seconds", async () => {
  await move();
  await act(() => { const b = button("되돌리기")!; b.focus(); event(b, "focusin"); });
  await advance(30_000);
  ok(button("되돌리기"), "focused toast stays");
  await act(() => event(button("되돌리기")!, "focusout", { relatedTarget: document.body }));
  await advance(TRASH_TOAST_MS - 1); ok(button("되돌리기"), "not cut short after focus leaves");
  await advance(1); ok(!button("되돌리기"), "expires 8s after focus leaves");
});

t("hover holds the toast; leaving starts a fresh 8 seconds", async () => {
  await move();
  await act(() => event(toast(), "mouseover", { relatedTarget: document.body }));
  await advance(30_000);
  ok(button("되돌리기"), "hovered toast stays");
  await act(() => event(toast(), "mouseout", { relatedTarget: document.body }));
  await advance(TRASH_TOAST_MS); ok(!button("되돌리기"), "expires after hover ends");
});

t("되돌리기 asks the host to restore exactly the moved id, and the toast says where it came back", async () => {
  await move();
  // Focus enters the toast the way a keyboard user reaches 되돌리기.
  await act(() => { const b = button("되돌리기")!; b.focus(); event(b, "focusin"); });
  await press("되돌리기");
  const a = lastAction();
  eq(a.action, "restore"); eq(a.target, entry.id); eq(a.scope, SCOPE);
  const pressed = button("되돌리기")!;
  eq(pressed.getAttribute("aria-disabled"), "true", "pending press is marked, not removed from the tab order");
  ok(!pressed.hasAttribute("disabled"), "a focused button is never disabled (that would blur it)");
  eq(active(), pressed, "focus stays on 되돌리기 while the host answers");
  await advance(30_000); ok(button("되돌리기"), "a pending Undo holds the toast");
  await send({ view: view([]), requestId: a.requestId, result: { action: "restore", id: entry.id, path: "작품 (1).html", renamed: true } });
  ok(toast().textContent.includes("“작품 (1).html” 이름으로 복원"), toast().textContent);
  ok(!button("되돌리기"), "no Undo after a restore");
  // The pressed Undo is gone; a later move gets its own 8 seconds even though focus was in the toast.
  await move();
  await advance(TRASH_TOAST_MS);
  ok(!button("되돌리기"), "an old focus does not freeze the next toast");
});

t("a pending Undo holds the toast even without hover or focus", async () => {
  await move();
  await act(() => click(button("되돌리기")!));
  await advance(30_000);
  ok(button("되돌리기"), "still there while the host answers");
  await send({ view: view([]), requestId: lastAction().requestId, result: { action: "restore", id: entry.id, path: entry.path } });
  await advance(TRASH_TOAST_MS);
});

t("an answer for another request is ignored; a refusal shows, releases the press and offers 다시 확인", async () => {
  await move();
  await press("되돌리기");
  const a = lastAction();
  await send({ view: view(), requestId: "someone-else", result: { action: "restore", path: "x" } });
  eq(button("되돌리기")?.getAttribute("aria-disabled"), "true", "still pending");
  await send({ view: view(), requestId: a.requestId, result: { action: "restore", error: "작업 상태가 바뀌었어요." } });
  ok(host.textContent.includes("작업 상태가 바뀌었어요."), "refusal shown");
  ok(!button("되돌리기")?.hasAttribute("aria-disabled"), "press released");
  const before = posted().filter(p => p.type === "activityTrashRequest").length;
  await press("다시 확인");
  eq(posted().filter(p => p.type === "activityTrashRequest").length, before + 1);
  await advance(TRASH_TOAST_MS);
});

t("a double press sends one request", async () => {
  const before = posted().filter(p => p.type === "activityTrashAction").length;
  await act(() => { click(button("휴지통으로 옮기기")!); click(button("휴지통으로 옮기기")!); });
  eq(posted().filter(p => p.type === "activityTrashAction").length, before + 1);
  await send({ view: view(), requestId: lastAction().requestId, result: { action: "move", cancelled: true } });
  ok(!button("휴지통으로 옮기기")?.hasAttribute("aria-disabled"), "cancel releases");
  eq(toast().textContent, "", "a cancelled confirm shows no toast");
});

t("영구 삭제 opens a dialog naming the file with 취소 focused; Escape closes and returns focus", async () => {
  await press("휴지통 · 1개");
  eq(button("휴지통 · 1개")!.getAttribute("aria-expanded"), "true");
  await press("영구 삭제…");
  const dialog = all(e => e.getAttribute("role") === "dialog")[0];
  ok(dialog, "dialog open"); ok((dialog.getAttribute("class") ?? "").split(" ").includes("hp-modal"), "shared modal geometry"); eq(dialog.getAttribute("aria-modal"), "true");
  ok(dialog.textContent.includes("작품.html"), "names the file");
  eq(document.activeElement, button("취소"), "취소 focused by default");
  let exit!: () => void;
  (dialog as unknown as HTMLElement).getAnimations = () => [{ finished: new Promise<void>(r => { exit = r; }) } as Animation];
  await act(() => event(button("취소")!, "keydown", { key: "Escape" }));
  ok(all(e => e.getAttribute("role") === "dialog").length, "cancel keeps card until exit");
  eq(document.activeElement, button("취소"), "cancel retains focus during exit");
  await act(async () => { exit(); await Promise.resolve(); });
  ok(!all(e => e.getAttribute("role") === "dialog").length, "Escape closes");
  eq(document.activeElement, button("영구 삭제…"), "focus back on the opener");
  eq(posted().filter(p => p.type === "activityTrashAction" && p.action === "purge").length, 0, "nothing sent");
});

t("취소 sends nothing; 영구 삭제 sends a purge of that id; composition blocks the press", async () => {
  await press("영구 삭제…"); await press("취소");
  eq(posted().filter(p => p.action === "purge").length, 0);
  await press("영구 삭제…");
  const confirm = () => buttons().find(b => b.textContent === "영구 삭제")!;
  await act(() => event(confirm(), "compositionstart", { data: "" }));
  await act(() => click(confirm()));
  eq(posted().filter(p => p.action === "purge").length, 0, "no purge mid-composition");
  await act(() => event(confirm(), "compositionend", { data: "ㅎ" }));
  let exit!: () => void;
  const dialog = all(e => e.getAttribute("role") === "dialog")[0] as unknown as HTMLElement;
  dialog.getAnimations = () => [{ finished: new Promise<void>(r => { exit = r; }) } as Animation];
  await act(() => click(confirm()));
  eq(posted().filter(p => p.action === "purge").length, 0, "purge waits for exit");
  await act(async () => { exit(); await Promise.resolve(); });
  const a = lastAction();
  eq(a.action, "purge"); eq(a.target, entry.id);
  await send({ view: view([]), requestId: a.requestId, result: { action: "purge", id: entry.id, path: entry.path } });
  eq(toast().textContent, "영구 삭제했어요.");
  ok(!button("되돌리기"), "permanent delete offers no Undo");
  await advance(TRASH_TOAST_MS);
});

t("a task switch drops the toast and ignores answers from the old task", async () => {
  await send({ view: view() });
  await move();
  const old = lastAction().requestId;
  await render("task-b");
  ok(!button("되돌리기"), "old toast gone");
  await send({ view: view(), requestId: old, result: { action: "move", id: entry.id } });
  ok(!button("되돌리기"), "old answer ignored");
});

t("a list for another scope drops an open Undo", async () => {
  await send({ view: view() });
  await move();
  await send({ view: view([entry], '["b",null]') });
  ok(!button("되돌리기"), "Undo from the other scope is gone");
});

t("되돌리기 restores the moved file even when it is not the newest entry", async () => {
  await render("t-undo-id", fileList("a.html", "b.html")); await send({ view: view([]) });
  const older = trashed("b.html", 2), newer = trashed("a.html", 3);
  await act(() => click(moveButton("b.html")));
  const a = lastAction();
  await send({ view: view([newer, older]), requestId: a.requestId, result: { action: "move", id: older.id, path: older.path } });
  await press("되돌리기");
  eq(lastAction().target, older.id, "restores the id the move reported, not entries[0]");
  await send({ view: view([newer]), requestId: lastAction().requestId, result: { action: "restore", id: older.id, path: older.path } });
  await advance(TRASH_TOAST_MS);
});

// ── Focus: every action that removes the pressed control leaves focus on a sensible next control ──
t("focus: Undo restores → focus lands on the restored file's row, not <body>", async () => {
  await render("t-f-undo", fileList("작품.html")); await send({ view: view([]) });
  await move();
  await focusOn(button("되돌리기")!);
  await act(() => click(button("되돌리기")!));
  await send({ view: view([]), requestId: lastAction().requestId, result: { action: "restore", id: entry.id, path: "작품.html" } });
  eq(active(), moveButton("작품.html"), "restored row's 휴지통으로 옮기기");
  await advance(TRASH_TOAST_MS);
});

t("focus: Undo restores a file the list does not show yet → focus lands on 휴지통 entry", async () => {
  await render("t-f-undo2", fileList("작품.html")); await send({ view: view([]) });
  await move();
  await focusOn(button("되돌리기")!);
  await act(() => click(button("되돌리기")!));
  await send({ view: view([]), requestId: lastAction().requestId, result: { action: "restore", id: entry.id, path: "없는.html" } });
  eq(active(), entryButton(), "휴지통 entry");
  await advance(TRASH_TOAST_MS);
});

t("focus: a pending 복원 keeps focus on its own button (aria-disabled, not disabled)", async () => {
  const e1 = trashed("a.html", 4);
  await render("t-f-rest-pend", fileList()); await send({ view: view([e1]) });
  await press("휴지통 · 1개");
  const b = listButton("복원", "a.html");
  await focusOn(b); await act(() => click(b));
  ok(!b.hasAttribute("disabled"), "not disabled"); eq(b.getAttribute("aria-disabled"), "true");
  eq(active(), b, "focus kept while pending");
  await send({ view: view([e1]), requestId: lastAction().requestId, result: { action: "restore", cancelled: true } });
});

t("focus: a pending move keeps focus on its own button (aria-disabled, not disabled)", async () => {
  await render("t-f-pend", fileList("a.html", "b.html")); await send({ view: view([]) });
  const b = moveButton("a.html");
  await focusOn(b); await act(() => click(b));
  ok(!b.hasAttribute("disabled"), "not disabled"); eq(b.getAttribute("aria-disabled"), "true");
  eq(active(), b, "focus kept while pending");
  const sent = posted().filter(p => p.type === "activityTrashAction").length;
  await act(() => click(moveButton("b.html")));
  eq(posted().filter(p => p.type === "activityTrashAction").length, sent, "a second press while pending sends nothing");
  await send({ view: view([]), requestId: lastAction().requestId, result: { action: "move", cancelled: true } });
  eq(active(), b, "a cancelled confirm leaves focus where it was");
});

t("focus: a moved row disappears → focus goes to the next row's press, the previous one for the last row", async () => {
  await render("t-f-move", fileList("a.html", "b.html", "c.html", "d.html")); await send({ view: view([]) });
  await focusOn(moveButton("b.html")); await act(() => click(moveButton("b.html")));
  await answerMove(trashed("b.html", 4));
  eq(active(), moveButton("b.html"), "still waiting while the row is listed");
  await render("t-f-move", fileList("a.html", "c.html", "d.html"));
  eq(active(), moveButton("c.html"), "next row (not the one after it)");
  await advance(TRASH_TOAST_MS);
  await focusOn(moveButton("c.html")); await act(() => click(moveButton("c.html")));
  await answerMove(trashed("c.html", 5));
  await render("t-f-move", fileList("a.html", "d.html"));
  eq(active(), moveButton("d.html"), "next row");
  await advance(TRASH_TOAST_MS);
  await focusOn(moveButton("d.html")); await act(() => click(moveButton("d.html")));
  await answerMove(trashed("d.html", 5));
  await render("t-f-move", fileList("a.html"));
  eq(active(), moveButton("a.html"), "last row falls back to the previous one");
  await advance(TRASH_TOAST_MS);
});

t("focus: the only row moved → focus goes to 휴지통 entry", async () => {
  await render("t-f-move1", fileList("a.html")); await send({ view: view([]) });
  await focusOn(moveButton("a.html")); await act(() => click(moveButton("a.html")));
  await render("t-f-move1", fileList());   // the list refreshed first: focus is already lost when the answer lands
  await answerMove(trashed("a.html", 6));
  eq(active(), entryButton(), "휴지통 entry");
  await advance(TRASH_TOAST_MS);
});

t("focus: 복원 in the trash list → focus goes to the next entry's 복원, else 휴지통 entry", async () => {
  const e1 = trashed("a.html", 7), e2 = trashed("b.html", 8);
  await render("t-f-restore", fileList()); await send({ view: view([e1, e2]) });
  await press("휴지통 · 2개");
  await focusOn(listButton("복원", "a.html")); await act(() => click(listButton("복원", "a.html")));
  await send({ view: view([e2]), requestId: lastAction().requestId, result: { action: "restore", id: e1.id, path: e1.path } });
  eq(active(), listButton("복원", "b.html"), "next entry's 복원");
  await advance(TRASH_TOAST_MS);
  await focusOn(listButton("복원", "b.html")); await act(() => click(listButton("복원", "b.html")));
  await send({ view: view([]), requestId: lastAction().requestId, result: { action: "restore", id: e2.id, path: e2.path } });
  eq(active(), entryButton(), "last entry falls back to 휴지통 entry");
  await advance(TRASH_TOAST_MS);
});

t("focus: 영구 삭제 → focus goes to the next entry's 복원, else 휴지통 entry (never <body> or the composer)", async () => {
  const e1 = trashed("a.html", 9), e2 = trashed("b.html", 1);
  await render("t-f-purge", fileList()); await send({ view: view([e1, e2]) });
  await press("휴지통 · 2개");
  await focusOn(listButton("영구 삭제", "a.html")); await act(() => click(listButton("영구 삭제", "a.html")));
  await act(() => click(buttons().find(b => b.textContent === "영구 삭제")!));
  await send({ view: view([e2]), requestId: lastAction().requestId, result: { action: "purge", id: e1.id, path: e1.path } });
  eq(active(), listButton("복원", "b.html"), "next entry's 복원");
  await advance(TRASH_TOAST_MS);
  await focusOn(listButton("영구 삭제", "b.html")); await act(() => click(listButton("영구 삭제", "b.html")));
  await act(() => click(buttons().find(b => b.textContent === "영구 삭제")!));
  await send({ view: view([]), requestId: lastAction().requestId, result: { action: "purge", id: e2.id, path: e2.path } });
  eq(active(), entryButton(), "휴지통 entry");
  await advance(TRASH_TOAST_MS);
});

t("focus: a pending 영구 삭제 opener stays focusable (aria-disabled)", async () => {
  const e1 = trashed("a.html", 2);
  await render("t-f-purge-pend", fileList()); await send({ view: view([e1]) });
  await press("휴지통 · 1개");
  const opener = listButton("영구 삭제", "a.html");
  await focusOn(opener); await act(() => click(opener));
  await act(() => click(buttons().find(b => b.textContent === "영구 삭제")!));
  ok(!opener.hasAttribute("disabled"), "opener not disabled"); eq(opener.getAttribute("aria-disabled"), "true");
  eq(active(), opener, "focus returned to the opener while the host answers");
  await send({ view: view([]), requestId: lastAction().requestId, result: { action: "purge", cancelled: true } });
  await advance(TRASH_TOAST_MS);
});

// ── 44px: the rendered controls, matched against the real stylesheet (the ui-polish-1 pattern) ──
t("every rendered trash control gets min-height 44px from the real stylesheet; 되돌리기 also min-width 44px", async () => {
  const css = staticTokens(readFileSync("webview-ui/src/designTokens.css", "utf8"))(readFileSync(new URL("../webview-ui/src/taskWorkspace.css", `file://${process.cwd()}/test/x`), "utf8")).replace(/\/\*[\s\S]*?\*\//g, "");
  const declared: { sel: string; decls: Record<string, string> }[] = [];
  const top = css.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "");   // forced-colours only restyles borders
  for (const m of top.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const decls: Record<string, string> = {};
    for (const d of m[2].split(";")) { const k = d.indexOf(":"); if (k > 0) decls[d.slice(0, k).trim()] = d.slice(k + 1).trim(); }
    for (const sel of m[1].split(",")) declared.push({ sel: sel.trim().replace(/\s+/g, " "), decls });
  }
  const applied = (el: Node, prop: string) => {
    let v: string | undefined;
    for (const r of declared) { let hit = false; try { hit = !r.sel.includes(":") && (el as unknown as { matches(s: string): boolean }).matches(r.sel); } catch { /* unsupported selector */ } if (hit && r.decls[prop] !== undefined) v = r.decls[prop]; }
    return v;
  };
  const e1 = trashed("a.html", 3);
  await render("t-css", fileList("작품.html")); await send({ view: view([e1]) });
  await press("휴지통 · 1개"); await press("영구 삭제…");
  await act(() => { /* dialog open */ });
  const names = ["휴지통으로 옮기기", "휴지통 · 1개", "복원", "영구 삭제…", "취소", "영구 삭제"];
  for (const name of names) {
    const el = buttons().find(b => b.textContent.trim() === name);
    ok(el, `${name} rendered`);
    eq(applied(el!, "min-height"), "44px", `${name} min-height`);
  }
  await act(() => click(button("취소")!));
  await move();   // answers for the first file; shows the toast
  const undo = button("되돌리기")!;
  ok(undo.getAttribute("class")?.includes("tw-trash-undo"), "되돌리기 carries the class the stylesheet styles");
  eq(applied(undo, "min-height"), "44px", "되돌리기 min-height"); eq(applied(undo, "min-width"), "44px", "되돌리기 min-width");
  await advance(TRASH_TOAST_MS);
});

(async () => {
  for (const [label, fn] of tests) {
    try { await fn(); console.log(`  ok   ${label}`); }
    catch (e) { fail++; console.error(`  FAIL ${label}: ${(e as Error).message}`); }
  }
  await act(() => root.unmount());
  if (fail) { console.error(`activity-trash UI: ${fail} FAILED`); process.exit(1); }
  console.log(`activity-trash UI: ${tests.length} checks PASS (8s toast, hold on hover/focus, polite Undo, dialog focus)`);
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
