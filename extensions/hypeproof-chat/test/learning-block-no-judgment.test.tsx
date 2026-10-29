// CGP-LEARN-R-002 (REQ-STUDIO-LEARNING-BLOCK-NO-JUDGMENT) — a learning block never sits in the work canvas and never shows
// capability names, scores, grades or "correct/incorrect" judgments. The real ChatPanel and LessonStepPanel mount on the minimal
// DOM (fixtures/mini-dom.mjs) for every one of the seven block kinds, on each seat that draws the lesson rail; the block element
// (the one carrying `data-hps-material`) is placed and its every shown word is audited. Bundled with esbuild, run with Node.
// The host half (a block save records no evidence) is test/learning-block-no-judgment-host.smoke.mjs.

import { click, mountPoint } from "./fixtures/mini-dom.mjs";
import React from "react";
import { createRoot, type Root } from "react-dom/client";
import { CAPABILITY_MODELS } from "@hypeproof/measurement-core/capability-models";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { ChatPanel } from "../webview-ui/src/ChatPanel";
import { LessonStepPanel } from "../webview-ui/src/LessonStepPanel";
import { MATERIAL_KINDS } from "../src/lessonFocus";
import type { ChatConfig, WebviewMessage } from "../src/protocol";

const act: (fn: () => unknown) => Promise<void> = (React as unknown as { act: (fn: () => unknown) => Promise<void> }).act;
let fail = 0;
const tests: [string, () => void | Promise<void>][] = [];
const t = (label: string, fn: () => void | Promise<void>) => tests.push([label, fn]);
const ok = (v: unknown, m: string) => { if (!v) throw new Error(m); };
const eq = (a: unknown, b: unknown, m = "") => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${m} ${JSON.stringify(a)} !== ${JSON.stringify(b)}`); };

/** Capability names in both models the product has used: the keys (FRAMING…OWNERSHIP, TASTE…) and their Korean labels. */
const CAPABILITY_WORDS = [...new Set(CAPABILITY_MODELS.flatMap((m) => m.capabilities.flatMap((c) => [c.key, c.label_ko])))];
/**
 * The SX-35/SX-59 audit instrument (test/sx-audit.mjs), loaded at run time: its fixtures resolve paths from import.meta.url, which a
 * CommonJS bundle does not have. The runner's working directory is the extension root.
 */
type Audit = (text: string) => { findings: { rule: string; match: string }[] };
let auditRegionText: Audit = () => { throw new Error("audit not loaded"); };
/** Verdicts on the learner's work. A block shows the learner's own words and its controls; it never judges them. */
const VERDICTS = /정답|오답|맞았|틀렸|맞아요|틀려요|맞습니다|틀립니다|맞춘|틀린 답|합격|통과|실패|잘했|훌륭|우수|미흡|\b(?:in)?correct\b|\bwrong\b|\bpass(?:ed)?\b|\bfail(?:ed)?\b/i;

/** Every word a block element shows: its text and the attributes a screen reader or tooltip speaks. */
type El = { getAttribute(n: string): string | null; textContent: string; localName: string; parentNode: El | null; findAll(test: (e: El) => boolean): El[] };
const SPOKEN = ["aria-label", "aria-description", "title", "placeholder", "alt"];
const wordsOf = (el: El) => [el.textContent, ...[el, ...el.findAll(() => true)].flatMap((e) => SPOKEN.map((a) => e.getAttribute(a) ?? ""))].filter(Boolean).join("\n");
/** The judgment findings for one block's words. Empty = clean. */
function judgments(words: string): string[] {
  const out: string[] = [];
  for (const f of auditRegionText(words).findings) out.push(`${f.rule}:${f.match}`);
  for (const w of CAPABILITY_WORDS) if (new RegExp(`(?<![A-Za-z])${w}(?![A-Za-z])`).test(words)) out.push(`capability:${w}`);
  const v = words.match(VERDICTS);
  if (v) out.push(`verdict:${v[0]}`);
  return out;
}

const UX = {
  coach: { naming_mode: "fixed" as const, fallback_name: "코치", naming_prompt_md: "", personality_prompt_md: "" },
  suggestions: { initial: [], follow_up: [] },
  hints: { short_input: { enabled: false, min_chars: 0, message_md: "" }, roll_input_button: { enabled: false, label: "", probe_md: "" } },
  retry_button: { enabled: false, show_counter: false },
};
/** One step per block kind, in the Service's order; the step text is the instructor's and is drawn outside the block. */
const STEPS = MATERIAL_KINDS.map((kind, i) => ({ id: `s${i + 1}`, title: `${i + 1}단계`, instructions: "해 보기", hint: "", acceptance: "직접 확인", ui: kind }));
const LESSON = {
  course_id: "c1", version: "m2026.10.28-1", sha256: "a".repeat(64),
  content: { schema: "hps-session-design/1", title: "자료 수업", audience: "초등", duration_minutes: 40, objective: "목표", prerequisites: "", starter: "", steps: STEPS },
};
const REHEARSAL = { version: LESSON.version, judged: false };
/** The learner's own saves on every form block, so the "저장한 …" lines are drawn too. */
const WORK = Object.fromEntries(STEPS.flatMap((s) => s.ui === "criterion_form" ? [[s.id, { kind: "criterion", text: "버튼이 보인다", savedAt: 1 }]]
  : s.ui === "decision_form" ? [[s.id, { kind: "decision", text: "색을 바꾼다", reason: "잘 안 보여서", savedAt: 1 }]] : []));

const seat = (kind: "classroom" | "personal", rehearsal: unknown = null) => ({
  model: "claude-sonnet-5", hasToken: true, proxyUrl: "http://localhost:8787",
  coach: { name: "코치", personality: "", configured: true },
  profile: { profile_id: "p", activity_kind: kind, observation: null, lesson: LESSON, rehearsal, welcome: { greeting_md: "안녕하세요" }, model_selection: null, ux: UX },
  activity: kind === "classroom" ? { id: "a1", name: "수업", kind: "classroom", workspace: "/tmp/w", verified: true } : { id: "p1", name: "내 작업", kind: "personal", workspace: "/tmp/p", verified: true },
}) as unknown as ChatConfig;

const noop = () => {};
const mounted: Root[] = [];
async function mount(node: React.ReactElement) {
  const host = mountPoint() as unknown as El;
  const root = createRoot(host as unknown as HTMLElement);
  mounted.push(root);
  await act(async () => { root.render(node); });
  return host;
}
async function chat(config: ChatConfig, messages: unknown[] = []) {
  const props: Record<string, unknown> = {
    messages, streaming: false, streamingId: null, error: null, errorRequestId: null, errorRunbookUrl: null, canRetryLast: false,
    pageNotice: null, aiNotice: null, stopNotice: null, openWorldId: null, publish: null, incomingImage: null,
    onSend: noop, onRetry: noop, onRetryLast: noop, onDismissError: noop, onCancel: noop, onClear: noop,
    onSetToken: noop, onSettings: noop, onRunCode: noop, onNamingRitual: noop, onSaveCoach: noop,
    onReportProblem: noop, onInstallUpdate: noop, onDismissUpdate: noop, onPublish: noop, onVerdict: noop,
    config, instructor: false,
  };
  const host = await mount(<ChatPanel {...(props as React.ComponentProps<typeof ChatPanel>)} />);
  const pick = async (id: string) => {
    const b = host.findAll((e) => e.localName === "button" && e.getAttribute("data-step-id") === id)[0];
    ok(b, `no step button for ${id}`);
    await act(async () => { click(b as unknown as Parameters<typeof click>[0]); });
  };
  return { host, pick };
}
const blocksIn = (host: El) => host.findAll((e) => e.getAttribute("data-hps-material") !== null);
const classes = (e: El) => (e.getAttribute?.("class") ?? "").split(/\s+/);
/** The class chain from an element up to the mount point. */
const chain = (el: El) => { const out: string[] = []; for (let n: El | null = el; n; n = n.parentNode) out.push(...classes(n)); return out; };
/**
 * Regions of the chat screen that are not the coach rail: the message stream and each message, the mission header (region A), the
 * evidence drawer (region D) and the composer. A block inside any of them is misplaced. The work canvas itself (editor, preview,
 * other editor-area panels) is not this screen; test/learning-block-no-judgment-host.smoke.mjs shows no canvas surface can draw one.
 */
const NOT_RAIL = ["hps-msg", "hps-messages", "hp-mission", "hp-evidence-region", "hps-input-area"];
/** A short exchange, so the stream and its messages are on the screen the placement check walks. */
const EXCHANGE = [
  { id: "u1", role: "user", content: "그림으로 보여줘", createdAt: 1 },
  { id: "a1", role: "assistant", content: "<div data-hps-material=\"criterion_form\">기준</div>", createdAt: 1 },
]

t("controls: the judgment audit catches each banned kind of word, and passes the block copy it will be used on", () => {
  for (const [bad, rule] of [["성장 점수", "growth_score"], ["7자산", "seven_assets"], ["판단", "capability:판단"], ["FRAMING", "capability:FRAMING"], ["정답이에요", "verdict:정답"], ["틀렸어요", "verdict:틀렸"], ["3점", "points"], ["Correct!", "verdict:Correct"]] as const) {
    ok(judgments(`이 단계 ${bad}`).some((f) => f.includes(rule)), `the audit missed ${bad} (${rule})`);
  }
  eq(judgments("이 단계의 확인 기준 — 무엇이 되면 잘 된 것인지 한 줄로 적으세요"), [], "plain block copy");
  ok(CAPABILITY_WORDS.includes("OWNERSHIP") && CAPABILITY_WORDS.includes("주인의식") && CAPABILITY_WORDS.includes("문제 구성"), "both capability models are read");
});

for (const kind of ["classroom", "personal"] as const) {
  t(`(a) ${kind}: every one of the seven blocks is drawn in the coach rail, never in the stream, header, drawer or a work surface`, async () => {
    const h = await chat(seat(kind), EXCHANGE);
    // Control: the regions the check rules out are really on this screen (a renamed class would make it pass vacuously).
    const present = new Set(h.host.findAll(() => true).flatMap(classes));
    eq(NOT_RAIL.filter((c) => c !== "hp-evidence-region" && !present.has(c)), [], "regions missing from the rendered screen");
    for (const [i, s] of STEPS.entries()) {
      if (i > 0) await h.pick(s.id); // the first step is current on mount
      const b = blocksIn(h.host);
      eq(b.map((e) => e.getAttribute("data-hps-material")), [s.ui], `step ${s.id}`);
      const where = chain(b[0]);
      ok(where.includes("hp-step-work"), `${s.ui}: not inside the rail's step panel (${where.join(" ")})`);
      const wrong = NOT_RAIL.filter((c) => where.includes(c));
      eq(wrong, [], `${s.ui}: inside a non-rail region`);
    }
  });
}

t("(b) every block, empty and with the learner's saves, on a learner and an instructor-rehearsal seat, shows no capability, score, grade or verdict", async () => {
  for (const rehearsal of [null, REHEARSAL]) {
    for (const s of STEPS) {
      for (const work of [{}, WORK]) {
        const posts: WebviewMessage[] = [];
        // The rehearsal panel's own verdict ("통과 …") is the instructor's report, drawn outside the block: it is the control.
        const state = rehearsal ? { state: "sent" as const, verdict: "passed" } : null;
        const host = await mount(<LessonStepPanel lesson={LESSON as never} step={s as never} rehearsal={rehearsal as never} work={work as never}
          rehearsalState={state} busy={false} post={(m) => posts.push(m)} />);
        const b = blocksIn(host);
        eq(b.length, 1, `${s.ui}: one block`);
        const found = judgments(wordsOf(b[0]));
        eq(found, [], `${s.ui}${rehearsal ? " (rehearsal)" : ""}${Object.keys(work).length ? " (saved)" : ""}`);
        if (rehearsal) ok(judgments(wordsOf(host)).some((f) => f.startsWith("verdict:")), `${s.ui}: control — the panel around the block does draw the rehearsal verdict`);
      }
    }
  }
});

(async () => {
  auditRegionText = ((await import(pathToFileURL(resolve("test/sx-audit.mjs")).href)) as { auditRegionText: Audit }).auditRegionText;
  for (const [label, fn] of tests) {
    try { await fn(); console.log(`  ok   ${label}`); } catch (e) { console.error(`  FAIL ${label}: ${(e as Error).message}`); fail++; }
  }
  for (const r of mounted) await act(async () => r.unmount());
  if (fail) { console.error(`\n${fail} learning-block-no-judgment check(s) failed`); process.exit(1); }
  console.log(`\n${tests.length} learning-block-no-judgment checks passed`);
  process.exit(0);
})();
