// REQ-STUDIO-LONG-STEP-HINT (CGP-ART-R-019, design CGP-ART-D-019). Extends REQ-M26/M27 and #403.
//
// A tool step can run for minutes (a build, a long command, a helper). The tool line then sits
// still with a "…" mark, and a learner reads a still screen as broken (runner.ts, 2026-08-20).
// When one tool step has been running 20 s the chat adds one calm hint that names the step in
// learner words ("명령을 실행하는 중이에요 · 20초째"); at 60 s it says the learner may keep waiting
// or stop. The words come from the SDK tool name (extractSdkActivity → toolActivity.workPhrase),
// carried on the tool line as `step`, with `since` = the host's clock when the step began.
//
// Rules held here, pure (no DOM, no vscode), so ChatPanel and the smoke test share them:
// - one step at a time: the latest running tool line with a step, and only if nothing was spoken
//   after it (streaming text never gets a hint);
// - the stall watchdog (#403, REQ-M26) wins: with its message on screen there is no hint;
// - never the raw tool text (D-027): a step that looks like `Bash(...)` falls back to a neutral line;
// - the announcement changes only at 20 s and at 60 s, not on every tick (DES-ART-19).

/** First hint after one step has run this long. */
export const LONG_STEP_HINT_MS = 20_000;
/** The hint offers stopping after this long. */
export const LONG_STEP_OFFER_MS = 60_000;

const FALLBACK_DOING = "작업하는 중이에요";

export interface LongStepLine {
  id: string;
  role: string;
  content: string;
  tool?: { state: string; step?: string; since?: number };
}

export interface ActiveLongStep {
  id: string;
  step: string;
  since: number;
}

/**
 * The step the hint may speak about: walking back from the newest item, the first running tool
 * line that carries a step. Spoken text or a user message on the way means there is none.
 */
export function activeLongStep(messages: readonly LongStepLine[]): ActiveLongStep | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "user") return null;
    if (m.role === "assistant" && m.content.trim()) return null;
    const t = m.role === "tool" ? m.tool : undefined;
    if (t?.state === "running" && typeof t.step === "string" && t.step && typeof t.since === "number") {
      return { id: m.id, step: t.step, since: t.since };
    }
  }
  return null;
}

/**
 * "홈페이지를 고치는 중…" → "홈페이지를 고치는 중이에요". Anything that does not end in "중"
 * after trimming, or that looks like a raw tool call (ASCII identifiers, parentheses, mcp
 * prefixes), becomes the neutral line: the hint never echoes a tool name or its input.
 */
export function learnerDoing(step: string): string {
  const s = (step ?? "").trim().replace(/(…|\.\.\.)+$/u, "").trim();
  if (!s || /[()]|mcp__|^[\x21-\x7e]+$/.test(s) || !/중$/u.test(s)) return FALLBACK_DOING;
  return `${s}이에요`;
}

export interface LongStepHint {
  phase: "wait" | "offer";
  /** One line: what is happening and for how long. */
  text: string;
  /** The offer sentence (empty before 60 s). */
  choice: string;
  offerStop: boolean;
  /** What the live region says; changes once at 20 s and once at 60 s. */
  announce: string;
}

function duration(ms: number): string {
  const sec = Math.floor(ms / 1000);
  // Seconds before a minute; whole minutes after it, so the line does not tick every second.
  return sec < 60 ? `${sec}초째` : `${Math.floor(sec / 60)}분째`;
}

export function longStepHint(args: {
  step: string;
  since: number;
  now: number;
  streaming: boolean;
  stalled: boolean;
}): LongStepHint | null {
  if (!args.streaming || args.stalled) return null;
  const elapsed = args.now - args.since;
  if (!Number.isFinite(elapsed) || elapsed < LONG_STEP_HINT_MS) return null;
  const doing = learnerDoing(args.step);
  const text = `${doing} · ${duration(elapsed)}`;
  if (elapsed < LONG_STEP_OFFER_MS) {
    return { phase: "wait", text, choice: "", offerStop: false, announce: `${doing}. 조금 오래 걸리고 있어요.` };
  }
  const choice = "더 기다려도 되고, 지금 멈춰도 돼요.";
  return { phase: "offer", text, choice, offerStop: true, announce: `${doing}. 1분 넘게 걸리고 있어요. ${choice}` };
}
