// CGP-KNOW-R-028 / DES-KNOW-46 — the two task memory switches as drawn in the chat settings dialog: native
// checkboxes with visible labels, the lock glyph and its reason as text tied to the locked box, each change posted
// as one host message for the open task (the host re-checks it). Minimal DOM, recording post function.
// Run: node scripts/run-tsx-tests.mjs task-memory-switches
import { act as reactAct, createElement } from "react";
import { readFileSync } from "node:fs";
import { click, mountPoint } from "./fixtures/mini-dom.mjs";
import { createRoot } from "react-dom/client";
import { TaskMemorySwitches } from "../webview-ui/src/TaskMemorySwitches";

type El = { tagName?: string; textContent: string; checked?: boolean; getAttribute(n: string): string | null; hasAttribute(n: string): boolean; findAll(f: (e: El) => boolean): El[] };
const act: (fn: () => unknown) => Promise<void> = (reactAct as unknown as (fn: () => unknown) => Promise<void>);
let fail = 0;
const tests: Array<[string, () => Promise<void>]> = [];
const t = (label: string, fn: () => Promise<void>) => tests.push([label, fn]);
const ok = (v: unknown, m: string) => { if (!v) throw new Error(m); };
const eq = (a: unknown, b: unknown, m = "") => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); };

const host = mountPoint() as unknown as El;
const root = createRoot(host as unknown as HTMLElement);
const posts: Array<Record<string, unknown>> = [];
// As a browser does on a press: the box flips, then the click event runs (React reads `checked` from the target).
const toggle = (el: El) => act(() => { const b = el as unknown as { type: string; checked: boolean }; b.type = "checkbox"; b.checked = !b.checked; click(el as never); });
const boxes = () => host.findAll((e) => e.tagName === "INPUT" && e.getAttribute("type") === "checkbox");
const byId = (id: string) => host.findAll((e) => e.getAttribute("id") === id)[0];
const TASK = "0e6bd2f1-7c44-4a39-9d2b-0d7e1a8b5c11";
const render = (view: { use: boolean; keep: boolean; useLocked: boolean }) =>
  act(() => root.render(createElement(TaskMemorySwitches, { view: { taskId: TASK, ...view }, post: (m: Record<string, unknown>) => posts.push(m) } as never)));

t("two labelled native checkboxes, both on by default", async () => {
  await render({ use: true, keep: true, useLocked: false });
  const [use, keep] = boxes();
  eq(boxes().length, 2);
  ok(use.hasAttribute("checked") || use.checked, "use on");
  ok(keep.hasAttribute("checked") || keep.checked, "keep on");
  const labels = host.findAll((e) => e.tagName === "LABEL").map((l) => l.textContent.trim());
  eq(labels, ["이 작업에서 기억 쓰기", "이 작업을 기억에 남기기"], "visible labels");
  ok(host.findAll((e) => e.tagName === "LEGEND")[0]?.textContent === "이 작업의 기억", "grouped under a legend");
  ok(!use.hasAttribute("disabled"), "use is free before the first send");
});

t("each change posts one message for the open task", async () => {
  posts.length = 0;
  await render({ use: true, keep: true, useLocked: false });
  await toggle(boxes()[1]);
  eq(posts, [{ type: "taskMemorySet", taskId: TASK, keep: false }]);
  await toggle(boxes()[0]);
  eq(posts[1], { type: "taskMemorySet", taskId: TASK, use: false });
});

t("locked: the use box is disabled, the lock glyph and reason are text tied to it; keep still works", async () => {
  posts.length = 0;
  await render({ use: true, keep: false, useLocked: true });
  const [use, keep] = boxes();
  ok(use.hasAttribute("disabled"), "use disabled");
  const ids = (use.getAttribute("aria-describedby") ?? "").split(" ");
  const reason = byId(ids[0]);
  ok(reason && reason.textContent.includes("첫 메시지를 보낸 뒤에는 바꿀 수 없어요."), `reason tied to the box: ${reason?.textContent}`);
  eq(reason.findAll((e) => e.tagName === "svg" || e.tagName === "SVG").map((s) => s.getAttribute("data-icon")), ["lock"], "lock glyph");
  ok(!keep.hasAttribute("disabled"), "keep is not locked");
  ok(byId(keep.getAttribute("aria-describedby") ?? "")?.textContent.includes("끄면 이 작업에서는 새 기억을 남기지 않아요."), "keep hint");
});

t("mounted in the personal settings dialog only where the host sends the view", async () => {
  const panel = readFileSync("webview-ui/src/ChatPanel.tsx", "utf8");
  eq(panel.split("{config.taskMemory && <TaskMemorySwitches view={config.taskMemory} post={postToHost} />}").length - 1, 1, "one mount, gated on the host view");
});

t("style floors: 44px rows, the caption step, no physical box properties", async () => {
  const css = readFileSync("webview-ui/src/chatDetails.css", "utf8");
  const start = css.indexOf("/* CGP-KNOW-R-028 / DES-KNOW-46");
  const block = css.slice(start, css.indexOf("/* CGP-SHELL-R-027 / DES-SHELL-26", start));
  ok(start > 0 && block.includes(".hps-task-memory-row {"), "block found");
  ok(/\.hps-task-memory-row \{[^}]*min-block-size: var\(--ds-c-studio-chatdetails-size-8\)/.test(block), "44px rows");
  ok(/\.hps-task-memory \{[^}]*font-size: var\(--hp-font-caption\)/.test(block), "caption step");
  eq(block.match(/(?:^|[\s;{])(?:(?:margin|padding|border)-(?:top|bottom|left|right)(?:-[a-z]+)?|top|bottom|left|right|(?:min-|max-)?(?:width|height))\s*:/gm) ?? [], [], "physical properties");
});

void (async () => {
  for (const [label, fn] of tests) {
    try { await fn(); console.log(`  ok   ${label}`); } catch (e) { console.error(`  FAIL ${label}: ${(e as Error).message}`); fail++; }
  }
  await act(() => root.unmount());
  if (fail) { console.error(`task memory switches render: ${fail} failed`); process.exit(1); }
  console.log(`task memory switches render: ${tests.length} passed`);
  process.exit(0);
})();
