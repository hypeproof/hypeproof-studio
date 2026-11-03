// CGP-LEARN-D-001 (DES-CGP-LEARN-01) — the confirmed step's learning block is a collapsible 자료 card in the coach rail,
// under the current step: closed by default with a thumbnail, a title and 열어 보기; opening expands the block in place
// (no dialog, no portal) and the card keys open/closed to the lesson version and step. The real ChatPanel mounts on the minimal DOM
// (fixtures/mini-dom.mjs); steps switch through the mission header's real buttons. Geometry (72px, 48px, 280–480px rail,
// tokens) is measured on the cascade in test/learning-block-card-computed.smoke.mjs. Bundled with esbuild, run with Node.

import { click, mountPoint } from "./fixtures/mini-dom.mjs";
import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { ChatPanel } from "../webview-ui/src/ChatPanel";
import type { ChatConfig, ChatMessage } from "../src/protocol";

const act: (fn: () => unknown) => Promise<void> = (React as unknown as { act: (fn: () => unknown) => Promise<void> }).act;
let fail = 0;
const tests: [string, () => void | Promise<void>][] = [];
const t = (label: string, fn: () => void | Promise<void>) => tests.push([label, fn]);
const ok = (v: unknown, m: string) => { if (!v) throw new Error(m); };
const eq = (a: unknown, b: unknown, m = "") => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); };

const noop = () => {};
const UX = {
  coach: { naming_mode: "fixed" as const, fallback_name: "코치", naming_prompt_md: "", personality_prompt_md: "" },
  suggestions: { initial: [], follow_up: [] },
  hints: { short_input: { enabled: false, min_chars: 0, message_md: "" }, roll_input_button: { enabled: false, label: "", probe_md: "" } },
  retry_button: { enabled: false, show_counter: false },
};
const step = (id: string, title: string, ui?: unknown) => ({ id, title, instructions: `${title} 하기`, hint: "", acceptance: `${title} 확인`, ...(ui === undefined ? {} : { ui }) });
const lessonOf = (version: string, steps: ReturnType<typeof step>[]) => ({
  course_id: "c1", version, sha256: (version.endsWith("2") ? "b" : "a").repeat(64),
  content: { schema: "hps-session-design/1", title: "자료 수업", audience: "초등", duration_minutes: 40, objective: "목표", prerequisites: "", starter: "", steps },
});
/** A confirmed lesson that attaches blocks to s1, s3 and s4; s2 has none. */
const WITH = lessonOf("m2026.10.28-1", [step("s1", "기준 정하기", "criterion_form"), step("s2", "살펴보기"), step("s3", "결정하기", "decision_form"), step("s4", "숫자 보기", "metric_board")]);
/** The same lesson with no `ui` anywhere: no block on any step. */
const WITHOUT = lessonOf("m2026.10.28-2", WITH.content.steps.map(({ id, title }) => step(id, title)));
/** Values the Service would refuse (DEC-19: only the seven `ui` kinds); a hostile or stale profile must still attach nothing. */
const BOGUS = lessonOf("m2026.10.28-3", [step("s1", "가짜 1", "Criterion_Form"), step("s2", "가짜 2", "dashboard"), step("s3", "가짜 3", { kind: "criterion_form" })]);

const seat = (lesson: unknown, kind: "classroom" | "personal" = "classroom") => ({
  model: "claude-sonnet-5", hasToken: true, proxyUrl: "http://localhost:8787",
  coach: { name: "코치", personality: "", configured: true },
  profile: { profile_id: "p", activity_kind: kind, observation: null, lesson, rehearsal: null, welcome: { greeting_md: "안녕하세요" }, model_selection: null, ux: UX },
  activity: kind === "classroom" ? { id: "a1", name: "수업", kind: "classroom", workspace: "/tmp/w", verified: true } : { id: "p1", name: "내 작업", kind: "personal", workspace: "/tmp/p", verified: true },
}) as unknown as ChatConfig;

type El = { getAttribute(n: string): string | null; textContent: string; localName: string; parentNode: El | null; findAll(test: (e: El) => boolean): El[] };
const mounted: Root[] = [];
async function harness(config: ChatConfig, messages: ChatMessage[] = []) {
  const host = mountPoint() as unknown as El;
  const root = createRoot(host as unknown as HTMLElement);
  mounted.push(root);
  const props: Record<string, unknown> = {
    messages, streaming: false, streamingId: null, error: null, errorRequestId: null, errorRunbookUrl: null, canRetryLast: false,
    pageNotice: null, aiNotice: null, stopNotice: null, openWorldId: null, publish: null, incomingImage: null,
    onSend: noop, onRetry: noop, onRetryLast: noop, onDismissError: noop, onCancel: noop, onClear: noop,
    onSetToken: noop, onSettings: noop, onRunCode: noop, onNamingRitual: noop, onSaveCoach: noop,
    onReportProblem: noop, onInstallUpdate: noop, onDismissUpdate: noop, onPublish: noop, onVerdict: noop,
    config, instructor: false,
  };
  await act(async () => { root.render(<ChatPanel {...(props as React.ComponentProps<typeof ChatPanel>)} />); });
  const blocks = () => host.findAll((e) => e.getAttribute("data-hps-material") !== null);
  const shown = () => blocks().map((b) => [b.getAttribute("data-hps-material"), b.getAttribute("data-hps-material-step"), b.getAttribute("data-hps-material-version")]);
  /** Presses the mission header's real button for a step (region A's quiet step buttons). */
  const pick = async (id: string) => {
    const b = host.findAll((e) => e.localName === "button" && e.getAttribute("data-step-id") === id)[0];
    ok(b, `no step button for ${id}`);
    await act(async () => { click(b as unknown as Parameters<typeof click>[0]); });
  };
  const card = () => host.findAll((e) => e.getAttribute("data-block-card") !== null);
  const toggle = () => card()[0]?.findAll((e) => e.localName === "button" && e.getAttribute("data-block-toggle") !== null)[0];
  const body = () => card()[0]?.findAll((e) => (e.getAttribute("class") ?? "").split(/\s+/).includes("hp-block-card-body"))[0];
  const press = async () => { const b = toggle(); ok(b, "no 열어 보기 button on the card"); await act(async () => { click(b as unknown as Parameters<typeof click>[0]); }); };
  return { host, blocks, shown, pick, card, toggle, body, press };
}
const within = (el: El, anc: El) => { for (let n: El | null = el; n; n = n.parentNode) if (n === anc) return true; return false; };
const isOpen = (h: Awaited<ReturnType<typeof harness>>) => h.body()!.getAttribute("hidden") === null;

t("closed by default: one card under the current step with a thumbnail, the 자료 title and 열어 보기; the block is inside it, hidden", async () => {
  const h = await harness(seat(WITH));
  eq(h.card().map((c) => c.getAttribute("data-block-card")), ["criterion_form"], "one card for the current step's block");
  const c = h.card()[0];
  ok(within(c, h.host.findAll((e) => e.getAttribute("data-lesson-step-panel") === "s1")[0]), "the card is not in the current step's panel");
  ok(c.findAll((e) => (e.getAttribute("class") ?? "").includes("hp-block-card-thumb"))[0]?.findAll((e) => e.localName === "svg").length === 1, "no thumbnail icon");
  ok(/자료/.test(c.textContent) && /확인 기준 적기/.test(c.textContent), `title: ${c.textContent}`);
  eq(h.toggle()!.textContent, "열어 보기", "closed label");
  eq(h.toggle()!.getAttribute("aria-expanded"), "false", "aria-expanded closed");
  eq(h.toggle()!.getAttribute("aria-controls"), h.body()!.getAttribute("id"), "the button controls the body");
  ok(!isOpen(h), "the block must start closed");
  ok(h.blocks()[0] === c, "the card is not the block region (data-hps-material)");
  const cls = (n: string) => (e: El) => (e.getAttribute("class") ?? "").split(/\s+/).includes(n);
  ok(!within(c.findAll(cls("hp-material-title"))[0], h.body()!), "the block title must stay in the closed card's head");
  for (const part of ["hp-material-help", "hp-surface"]) ok(within(c.findAll(cls(part))[0], h.body()!), `${part} is not in the card body`);
  // R-003's live state line stays in the always-drawn head: never inside the hidden body, polite, one per card.
  const live = c.findAll(cls("hp-material-state"));
  eq(live.length, 1, "one live state line");
  ok(!within(live[0], h.body()!), "the live state line must not sit in the hidden body");
  eq([live[0].getAttribute("role"), live[0].getAttribute("aria-live")], ["status", "polite"], "live state line");
});

t("열어 보기 expands in place (same card, no dialog); 닫기 closes it", async () => {
  const h = await harness(seat(WITH));
  const before = h.card()[0];
  await h.press();
  ok(isOpen(h), "opening must show the body");
  ok(h.card()[0] === before, "the card was replaced instead of expanding in place");
  eq(h.toggle()!.textContent, "닫기"); eq(h.toggle()!.getAttribute("aria-expanded"), "true");
  eq(h.host.findAll((e) => e.localName === "dialog" || e.getAttribute("role") === "dialog" || e.getAttribute("aria-modal") !== null).length, 0, "no dialog or modal appears");
  ok(h.body()!.findAll((e) => e.localName === "textarea").length === 1, "the criterion work form is inside the expanded card");
  await h.press();
  ok(!isOpen(h), "닫기 must hide the body again");
});

t("per step: an opened card does not open the next step's card; each step's card starts closed", async () => {
  const h = await harness(seat(WITH));
  await h.press();
  await h.pick("s2");
  eq(h.card().length, 0, "a step without a block has no card");
  await h.pick("s3");
  eq(h.card().map((c) => c.getAttribute("data-block-card")), ["decision_form"]);
  ok(!isOpen(h), "another step's card must start closed");
  await h.pick("s4");
  eq(h.card().map((c) => c.getAttribute("data-block-card")), ["metric_board"], "an undrawable kind is still a card");
  await h.press();
  ok(/열 수 없습니다/.test(h.body()!.textContent), "its honest notice is the card's content");
});

t("no card where the lesson attaches nothing (no ui, refused values, no lesson)", async () => {
  for (const config of [seat(WITHOUT), seat(BOGUS), seat(null, "personal")]) {
    const h = await harness(config);
    eq(h.card().length, 0, "card without a block");
  }
});

(async () => {
  for (const [label, fn] of tests) {
    try { await fn(); console.log(`  ok   ${label}`); } catch (e) { console.error(`  FAIL ${label}: ${(e as Error).message}`); fail++; }
  }
  for (const r of mounted) await act(async () => r.unmount());
  if (fail) { console.error(`\n${fail} learning-block-card check(s) failed`); process.exit(1); }
  console.log(`\n${tests.length} learning-block-card checks passed`);
  process.exit(0);
})();
