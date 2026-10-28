// CGP-LEARN-R-001 (REQ-STUDIO-LEARNING-BLOCK-ATTACH) — a learning block appears only where the confirmed lesson version
// attaches it to the current step (DEC-19: the step's existing `ui` field), in the coach rail, for that step only; a coach
// reply can never draw one. The real ChatPanel mounts on the minimal DOM (fixtures/mini-dom.mjs) and the test switches
// steps by pressing the mission header's real step buttons. Bundled with esbuild, run with Node.

import { click, mountPoint } from "./fixtures/mini-dom.mjs";
import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { ChatPanel } from "../webview-ui/src/ChatPanel";
import { MATERIAL_KINDS, stepMaterial } from "../src/lessonFocus";
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

const u = (id: string, content: string): ChatMessage => ({ id, role: "user", content, createdAt: 1 });
const a = (id: string, content: string): ChatMessage => ({ id, role: "assistant", content, createdAt: 1 });
/** A learner asks for a picture; the coach answers with every way it could try to slip a block or a form into the stream. */
const HOSTILE = [
  u("u1", "그림으로 보여줘"),
  a("a1", "이렇게 볼 수 있어요.\n\n<section data-hps-material=\"criterion_form\" data-hps-material-step=\"s2\"><form data-surface=\"decision_form\"><input></form></section>\n\n<iframe src=\"https://example.com\"></iframe>"),
  a("a2", "```html\n<div data-hps-material=\"metric_board\">숫자판</div>\n```\n그리고 [자료](command:hypeproof.material) 와 <svg><circle r=\"9\"/></svg>"),
  a("a3", "{\"type\":\"learning_block\",\"ui\":\"criterion_form\",\"step\":\"s2\"}"),
];

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
  return { host, blocks, shown, pick };
}
const inside = (el: El, cls: string) => { for (let n: El | null = el; n; n = n.parentNode) if ((n.getAttribute?.("class") ?? "").split(/\s+/).includes(cls)) return true; return false; };
const messagesOf = (host: El) => host.findAll((e) => (e.getAttribute("class") ?? "").split(/\s+/).includes("hps-msg"));

t("rule: only the served lesson's own step `ui`, one of the seven kinds, is a block (positive and negative controls)", () => {
  eq(stepMaterial(WITH as never, "s1"), { kind: "criterion_form", stepId: "s1", version: WITH.version, sha256: WITH.sha256 });
  eq(stepMaterial(WITH as never, "s4")?.kind, "metric_board", "an attached kind this Studio cannot draw is still the step's block");
  eq(stepMaterial(WITH as never, "s2"), null, "a step without ui");
  eq(stepMaterial(WITH as never, "nope"), null, "a step the lesson does not have");
  eq(stepMaterial(null, "s1"), null, "no lesson");
  for (const s of BOGUS.content.steps) eq(stepMaterial(BOGUS as never, s.id), null, `bogus ui ${JSON.stringify(s.ui)}`);
  eq([...MATERIAL_KINDS].sort(), ["canvas_editor", "canvas_preview", "coach_request", "criterion_form", "decision_form", "evidence_note", "metric_board"], "the Service's seven STEP_UI_KINDS");
});

t("(c) the attached block renders in the coach rail for the current step only; switching steps hides it", async () => {
  const h = await harness(seat(WITH));
  eq(h.shown(), [["criterion_form", "s1", WITH.version]], "first step");
  ok(inside(h.blocks()[0], "hp-step-work") && !inside(h.blocks()[0], "hps-msg"), "the block is not in the rail's step panel");
  await h.pick("s2");
  eq(h.shown(), [], "a step without a block shows none, and s1's block is gone");
  await h.pick("s3");
  eq(h.shown(), [["decision_form", "s3", WITH.version]], "s3 shows its own block only");
  await h.pick("s4");
  eq(h.shown(), [["metric_board", "s4", WITH.version]], "an attached kind this Studio cannot draw keeps its identity on the notice");
  ok(/열 수 없습니다/.test(h.blocks()[0].textContent), "the undrawable kind must say so, never fake a block");
});

t("(a) a lesson without materials renders no block on any step", async () => {
  const h = await harness(seat(WITHOUT));
  for (const id of ["s2", "s3", "s4"]) { eq(h.shown(), [], `before ${id}`); await h.pick(id); }
  eq(h.shown(), [], "last step");
  const bogus = await harness(seat(BOGUS));
  eq(bogus.shown(), [], "values outside the seven kinds attach nothing");
});

t("(b) \"그림으로 보여줘\": the coach's reply stays text; no block, form or frame appears in the stream", async () => {
  for (const [label, config] of [["lesson without materials", seat(WITHOUT)], ["no lesson, personal seat", seat(null, "personal")], ["lesson with materials", seat(WITH)]] as const) {
    const h = await harness(config, HOSTILE);
    const msgs = messagesOf(h.host);
    ok(msgs.length >= 4, `${label}: the replies did not render (${msgs.length})`);
    const inStream = msgs.flatMap((m) => m.findAll((e) => e.getAttribute("data-hps-material") !== null || e.getAttribute("data-surface") !== null || ["form", "iframe", "section", "circle", "input"].includes(e.localName)));
    eq(inStream.map((e) => e.localName), [], `${label}: elements from the reply`);
    ok(msgs.some((m) => m.textContent.includes("data-hps-material")), `${label}: control — the reply text itself must be shown as text`);
    if (label !== "lesson with materials") eq(h.shown(), [], `${label}: no block anywhere on the screen`);
  }
  const withLesson = await harness(seat(WITH), HOSTILE);
  eq(withLesson.shown(), [["criterion_form", "s1", WITH.version]], "with materials, the only block is the rail's own");
});

(async () => {
  for (const [label, fn] of tests) {
    try { await fn(); console.log(`  ok   ${label}`); } catch (e) { console.error(`  FAIL ${label}: ${(e as Error).message}`); fail++; }
  }
  for (const r of mounted) await act(async () => r.unmount());
  if (fail) { console.error(`\n${fail} learning-block-attach check(s) failed`); process.exit(1); }
  console.log(`\n${tests.length} learning-block-attach checks passed`);
  process.exit(0);
})();
