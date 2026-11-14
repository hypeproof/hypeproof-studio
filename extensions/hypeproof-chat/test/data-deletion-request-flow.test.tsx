// CGP-SHELL-R-027 — the real, stateful "계정과 데이터 삭제 요청" row, mounted on the minimal DOM with a
// recording webview bridge (`__posted`). It proves the confirm step cannot be skipped: opening it posts
// nothing, 취소 posts nothing, and only 요청 보내기 posts exactly one `submit`, which also locks the buttons.
// It also checks that physical properties never appear in the slice's CSS rules (logical-css.mjs only
// ratchets inline-axis properties, so a `margin-top` would pass it).
// Run: node scripts/run-tsx-tests.mjs data-deletion-request-flow
import { act as reactAct, createElement } from "react";
import { readFileSync } from "node:fs";
import { click, mountPoint } from "./fixtures/mini-dom.mjs";
import { createRoot } from "react-dom/client";
import { DataDeletionRequest } from "../webview-ui/src/DataDeletionRequest";

type El = { tagName?: string; textContent: string; getAttribute(n: string): string | null; hasAttribute(n: string): boolean; findAll(f: (e: El) => boolean): El[] };
const act: (fn: () => unknown) => Promise<void> = (reactAct as unknown as (fn: () => unknown) => Promise<void>);
const g = globalThis as unknown as { __posted: Array<Record<string, unknown>>; window: { dispatchEvent(e: unknown): void } };

let fail = 0;
const tests: Array<[string, () => Promise<void>]> = [];
const t = (label: string, fn: () => Promise<void>) => tests.push([label, fn]);
const ok = (v: unknown, m: string) => { if (!v) throw new Error(m); };
const eq = (a: unknown, b: unknown, m = "") => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); };

const host = mountPoint() as unknown as El;
const root = createRoot(host as unknown as HTMLElement);
const button = (text: string) => host.findAll((e) => e.tagName === "BUTTON" && e.textContent.trim() === text);
const posted = (action: string) => g.__posted.filter((m) => m.type === "dataDeletion" && m.action === action).length;
const hostSays = (data: Record<string, unknown>) => act(() => { g.window.dispatchEvent({ type: "message", data, bubbles: false }); });
const press = (b: El) => act(() => click(b as never));
const ID = "ddr_" + "0123456789abcdef".repeat(2);

async function mount() {
  g.__posted.length = 0;
  await act(() => root.render(createElement(DataDeletionRequest, { key: Math.random() })));
  await hostSays({ type: "dataDeletionState", state: "ready", request: null });
}

t("mounting reads the seat's request once and sends nothing", async () => {
  await mount();
  eq([posted("load"), posted("submit")], [1, 0]);
  eq(button("삭제 요청하기").length, 1);
});

t("opening the confirm step posts nothing; 취소 posts nothing and closes it", async () => {
  await mount();
  await press(button("삭제 요청하기")[0]);
  eq(posted("submit"), 0, "opening never sends");
  eq([button("취소").length, button("요청 보내기").length], [1, 1], "the confirm group is shown");
  await press(button("취소")[0]);
  eq(posted("submit"), 0, "cancel never sends");
  eq([button("요청 보내기").length, button("삭제 요청하기").length], [0, 1], "back to the entry");
});

t("only 요청 보내기 sends, exactly once, and locks the group until the host answers", async () => {
  await mount();
  await press(button("삭제 요청하기")[0]);
  await press(button("요청 보내기")[0]);
  eq(posted("submit"), 1, "one submit");
  const send = button("요청 보내기")[0];
  ok(send && send.hasAttribute("disabled"), "locked while sending");
  await press(send);
  eq(posted("submit"), 1, "a second press while sending sends nothing");
  await hostSays({ type: "dataDeletionState", state: "ready", request: { id: ID, status: "received", createdAt: "2026-11-13T00:00:00.000Z", updatedAt: "2026-11-13T00:00:00.000Z" } });
  eq(host.findAll((e) => (e.getAttribute("class") ?? "").includes("hps-deletion-chip"))[0]?.textContent, "접수", "status shown");
  eq([button("삭제 요청하기").length, button("요청 보내기").length], [0, 0], "an open request has nothing to press");
});

t("style: the slice's rules use no physical box properties", async () => {
  const css = readFileSync("webview-ui/src/chatDetails.css", "utf8");
  const start = css.indexOf("/* CGP-SHELL-R-027 / DES-SHELL-26");
  ok(start > 0, "slice block found");
  const block = css.slice(start, css.indexOf("@media (forced-colors: active) {\n  .hps-deletion-chip", start));
  ok(block.includes(".hps-deletion-confirm"), "the block covers the rules");
  const physical = block.match(/(?:^|[\s;{])(?:(?:margin|padding|border)-(?:top|bottom|left|right)(?:-[a-z]+)?|top|bottom|left|right|(?:min-|max-)?(?:width|height))\s*:/gm) ?? [];
  eq(physical, [], "physical properties");
});

void (async () => {
  for (const [label, fn] of tests) {
    try { await fn(); console.log(`  ok   ${label}`); } catch (e) { console.error(`  FAIL ${label}: ${(e as Error).message}`); fail++; }
  }
  await act(() => root.unmount());
  if (fail) { console.error(`data deletion request flow: ${fail} failed`); process.exit(1); }
  console.log(`data deletion request flow: ${tests.length} passed`);
  process.exit(0);
})();
