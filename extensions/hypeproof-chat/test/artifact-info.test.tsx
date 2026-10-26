// CGP-KNOW-D-016 (DES-KNOW-29) — the webview half of the file info popover: the real TaskWorkspace on
// the minimal DOM (fixtures/mini-dom.mjs). Each work-folder row has 정보; it asks the host once per
// opening and shows only its own answer: 종류, 크기, 만든 대화, 마지막으로 바꾼 대화. A turn link opens
// that task (the same jump as a search result); a gone turn is plain text, never a button. Escape and
// 닫기 close the popover and return focus to 정보. The host side is test/artifact-info.smoke.mjs; the
// computed size, underline and contrast checks are test/artifact-info-computed.smoke.mjs.

import { click, document as doc, mountPoint } from "./fixtures/mini-dom.mjs";
import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { TaskWorkspace } from "../webview-ui/src/TaskWorkspace";
import type { ArtifactInfo, ArtifactProvenanceView } from "../src/artifactProvenanceView";

(globalThis as unknown as { HTMLElement?: unknown }).HTMLElement ??= (globalThis as unknown as { window: { Element: unknown } }).window.Element;
const posted = (globalThis as unknown as { __posted: Record<string, string>[] }).__posted;
const act: (fn: () => unknown) => Promise<void> = (React as unknown as { act: (fn: () => unknown) => Promise<void> }).act;
let fail = 0;
const tests: [string, () => Promise<void>][] = [];
const t = (label: string, fn: () => Promise<void>) => tests.push([label, fn]);
const ok = (v: unknown, m: string) => { if (!v) throw new Error(m); };
const eq = (a: unknown, b: unknown, m: string) => ok(JSON.stringify(a) === JSON.stringify(b), `${m}: ${JSON.stringify(a)} !== ${JSON.stringify(b)}`);

type El = { localName: string; textContent: string; getAttribute(n: string): string | null; hasAttribute(n: string): boolean; dispatchEvent(e: unknown): boolean; findAll(test: (e: El) => boolean): El[] };
const all = (test: (e: El) => boolean) => (doc as unknown as { documentElement: El }).documentElement.findAll(test);
const buttons = (text: string) => all((e) => e.localName === "button" && e.textContent === text);
const popovers = () => all((e) => e.hasAttribute("data-artifact-info"));
const hostSays = (data: unknown) => act(async () => { (globalThis as unknown as { window: { dispatchEvent(e: unknown): boolean } }).window.dispatchEvent({ type: "message", data, bubbles: false }); });
const key = (target: El, k: string) => act(() => { target.dispatchEvent({ type: "keydown", key: k, bubbles: true, cancelable: true, defaultPrevented: false, preventDefault() { (this as { defaultPrevented: boolean }).defaultPrevented = true; }, stopPropagation() { (this as { _stopped?: boolean })._stopped = true; } }); });
const lastRequest = () => posted.filter((m) => m.type === "artifactInfoRequest").at(-1)!;

const VIEW: ArtifactProvenanceView = {
  entries: [
    { path: "index.html", kind: "ai_changed", label: "AI가 고침", symbol: "↻", history: ["AI가 만듦", "AI가 고침"], at: 3 },
    { path: "notes.md", kind: "none", label: "기록 없음", symbol: "○", history: [] },
  ],
  more: 0, unobserved: false, unconfirmed: false,
};
const WS = { scope: "s", revision: 1, activeTaskId: "a", tasks: [{ id: "a", title: "첫 작업", createdAt: 1, updatedAt: 2, messageCount: 0 }, { id: "b", title: "홈페이지", createdAt: 1, updatedAt: 1, messageCount: 2 }], sourceSelection: null };
const INFO: ArtifactInfo = {
  path: "index.html", type: "웹페이지 (HTML)", size: "2KB",
  created: { kind: "turn", taskId: "b", messageId: "m1", taskTitle: "홈페이지" },
  changed: { kind: "text", text: "대화를 찾을 수 없어요. 대화 기록이 지워졌거나 다른 곳으로 옮겨졌을 수 있어요." },
};

async function mount(): Promise<Root> {
  const root = createRoot(mountPoint() as never);
  await act(async () => { root.render(<TaskWorkspace view={WS as never} messages={[]} busy={false} error={null} onDismissError={() => {}}><textarea aria-label="메시지" /></TaskWorkspace>); });
  const toggle = all((e) => e.localName === "button" && (e.getAttribute("class") ?? "").includes("tw-sources-toggle"))[0];
  await act(async () => { click(toggle); });
  await hostSays({ type: "artifactProvenance", view: VIEW });
  return root;
}

t("each listed file has 정보; opening asks the host once for that path and shows only that answer", async () => {
  posted.length = 0;
  const root = await mount();
  const infos = all((e) => e.hasAttribute("data-artifact-info-open"));
  eq(infos.map((b) => b.getAttribute("aria-label")), ["정보: index.html", "정보: notes.md"], "one 정보 per row, named by file");
  ok(infos.every((b) => b.getAttribute("type") === "button" && b.getAttribute("aria-haspopup") === "dialog" && b.getAttribute("aria-expanded") === "false"), "closed disclosure");
  await act(async () => { click(infos[0]); });
  const request = lastRequest();
  eq([request.path, posted.filter((m) => m.type === "artifactInfoRequest").length], ["index.html", 1], "one request for the row's path");
  eq(infos[0].getAttribute("aria-expanded"), "true", "expanded");
  ok(popovers()[0].textContent.includes("불러오는 중"), "loading until answered");
  ok(doc.activeElement === (popovers()[0] as unknown), "focus moves into the popover");
  // An answer to another request (an earlier opening, another file) is not shown.
  await hostSays({ type: "artifactInfo", requestId: "info-other", info: { ...INFO, size: "999KB" } });
  ok(popovers()[0].textContent.includes("불러오는 중"), "foreign answer ignored");
  await hostSays({ type: "artifactInfo", requestId: request.requestId, info: INFO });
  const rows = all((e) => e.hasAttribute("data-artifact-info-row"));
  eq(rows.map((r) => r.getAttribute("data-artifact-info-row")), ["종류", "크기", "만든 대화", "마지막으로 바꾼 대화"], "four rows in order");
  eq(rows.map((r) => all((e) => e.localName === "dd" && r.findAll((x) => x === e).length > 0)[0]?.textContent), ["웹페이지 (HTML)", "2KB", "‘홈페이지’ 대화로 가기", INFO.changed.kind === "text" ? INFO.changed.text : ""], "values");
  eq(buttons("‘홈페이지’ 대화로 가기").length, 1, "a recorded turn is a link button");
  eq(all((e) => e.hasAttribute("data-artifact-info-link")).length, 1, "the gone turn is not a link");
  ok(all((e) => e.hasAttribute("data-artifact-info-text"))[0].textContent.startsWith("대화를 찾을 수 없어요"), "it says why in plain text");
  await act(async () => { root.unmount(); });
});

t("Escape closes and returns focus to 정보; 닫기 does too", async () => {
  const root = await mount();
  const opener = all((e) => e.getAttribute("data-artifact-info-open") === "index.html")[0];
  await act(async () => { click(opener); });
  await hostSays({ type: "artifactInfo", requestId: lastRequest().requestId, info: INFO });
  await key(buttons("‘홈페이지’ 대화로 가기")[0], "Escape");
  eq(popovers().length, 0, "Escape closes");
  const panel = all((e) => e.localName === "aside" && e.getAttribute("id") === "task-sources")[0];
  ok(panel.getAttribute("role") === "dialog" && !panel.hasAttribute("hidden"), "only the popover closes, not the narrow 작업 자료 dialog around it");
  ok(doc.activeElement === (opener as unknown), "focus back on 정보");
  eq(opener.getAttribute("aria-expanded"), "false", "collapsed");
  await act(async () => { click(opener); });
  await act(async () => { click(buttons("닫기").at(-1)!); });
  eq(popovers().length, 0, "닫기 closes");
  ok(doc.activeElement === (opener as unknown), "focus back on 정보 after 닫기");
  await act(async () => { root.unmount(); });
});

t("at most one popover; a new list closes it", async () => {
  const root = await mount();
  const [a, b] = all((e) => e.hasAttribute("data-artifact-info-open"));
  await act(async () => { click(a); });
  await act(async () => { click(b); });
  eq(popovers().length, 1, "one at a time");
  eq([a.getAttribute("aria-expanded"), b.getAttribute("aria-expanded")], ["false", "true"], "the second replaced the first");
  await hostSays({ type: "artifactProvenance", view: { ...VIEW } });
  eq(popovers().length, 0, "a refreshed list closes it");
  await act(async () => { root.unmount(); });
});

t("a turn link opens that task and asks for the jump; the same task is not re-selected", async () => {
  posted.length = 0;
  const root = await mount();
  await act(async () => { click(all((e) => e.getAttribute("data-artifact-info-open") === "index.html")[0]); });
  await hostSays({ type: "artifactInfo", requestId: lastRequest().requestId, info: INFO });
  await act(async () => { click(buttons("‘홈페이지’ 대화로 가기")[0]); });
  eq(posted.filter((m) => m.type === "taskSelect").map((m) => m.id), ["b"], "switches to the turn's task");
  eq(popovers().length, 0, "the popover closes");
  const panel = all((e) => e.localName === "aside" && e.getAttribute("id") === "task-sources")[0];
  ok(panel.hasAttribute("hidden"), "the narrow 작업 자료 dialog closes so the transcript shows");
  await act(async () => { root.unmount(); });
  posted.length = 0;
  const again = await mount();
  await act(async () => { click(all((e) => e.getAttribute("data-artifact-info-open") === "index.html")[0]); });
  await hostSays({ type: "artifactInfo", requestId: lastRequest().requestId, info: { ...INFO, created: { kind: "turn", taskId: "a", messageId: "m0", taskTitle: "첫 작업" } } });
  await act(async () => { click(buttons("‘첫 작업’ 대화로 가기")[0]); });
  eq(posted.filter((m) => m.type === "taskSelect").length, 0, "already open: scroll only");
  await act(async () => { again.unmount(); });
});

t("an answer the host could not give says so; a mismatched path is not shown", async () => {
  const root = await mount();
  await act(async () => { click(all((e) => e.getAttribute("data-artifact-info-open") === "notes.md")[0]); });
  await hostSays({ type: "artifactInfo", requestId: lastRequest().requestId, info: INFO });
  ok(popovers()[0].textContent.includes("파일 정보를 불러오지 못했어요"), "another file's info is refused");
  eq(all((e) => e.hasAttribute("data-artifact-info-row")).length, 0, "no rows");
  await act(async () => { root.unmount(); });
});

(async () => {
  for (const [label, fn] of tests) {
    try { await fn(); console.log(`  ok   ${label}`); } catch (e) { console.error(`  FAIL ${label}: ${(e as Error).message}`); if (process.env.HPS_TEST_STACK) console.error((e as Error).stack); fail++; }
  }
  if (fail) { console.error(`artifact-info: ${fail} failed`); process.exit(1); }
  console.log("artifact-info OK");
  process.exit(0);
})();
