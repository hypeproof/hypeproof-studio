// REQ-CGP-LEARN-13 / DES-CGP-LEARN-13 — the learner side of a safety block.
//
// The Service screens a minor cohort's latest message before any model call (REQ-O2) and answers
// `400 {error:{type:"moderation_block", message, category?}}`. Until now the panel dropped that
// body and drew the generic red error card, so the Service's calm sentence never reached the child.
//
// This module is pure (no vscode, no fetch) so the copy and the gates are unit-tested:
// - any moderation block becomes a calm inline notice (no alert role, no red, no retry, no sound);
// - the two help lines (109, 1388) are added only when the Service named the category `self_harm`
//   AND the served profile advertises `safety_help_lines: true` (DEC-LEARN-13a, default off until
//   Jay/legal confirm the numbers). Positive evidence only: no category, no help lines.
import type { SeatAudience } from "./seatVocabulary.ts";

/** Categories the Service's moderation screen emits (worker/src/lib/moderation.ts). */
export const MODERATION_CATEGORIES = ["sexual_content", "self_harm", "graphic_violence", "pii_solicitation"] as const;
export type ModerationCategory = (typeof MODERATION_CATEGORIES)[number];

/** Learner copy when the Service sent no usable sentence. Calm, never punitive. */
export const MODERATION_BLOCK_FALLBACK =
  "이 이야기는 여기서 함께 다룰 수 없는 내용이에요. 다른 궁금한 것을 물어봐 줄래요?";
export const SAFETY_NOTICE_TITLE = "잠깐 멈췄어요";
export const SAFETY_HELP_INTRO = "혼자 고민하지 않아도 돼요. 언제든 전화로 이야기할 수 있어요.";
/** The two Korean help lines (REQ-CGP-LEARN-13 (a)). Numbers are shown as text, never as links. */
export const SAFETY_HELP_LINES: ReadonlyArray<{ label: string; number: string }> = [
  { label: "자살예방상담전화", number: "109" },
  { label: "청소년상담", number: "1388" },
];
export const SAFETY_TEACHER_LINE = "선생님께 바로 이야기해도 괜찮아요.";
/** A solo seat has no instructor in the room; it names a nearby adult instead. */
export const SAFETY_ADULT_LINE = "가까운 어른께 바로 이야기해도 괜찮아요.";

export interface ModerationBlock {
  /** The Service's sentence, cleaned; the fallback when absent or unusable. */
  message: string;
  /** Present only when the Service named one of the known categories. */
  category?: ModerationCategory;
}

export interface SafetyNoticeView {
  title: string;
  message: string;
  /** Present only for a self-harm block on a seat whose profile turned help lines on. */
  help?: { intro: string; lines: Array<{ label: string; number: string }>; adultLine: string };
}

const MESSAGE_MAX = 400;
// C0/C1 controls, bidi overrides/isolates, zero-width and line/paragraph separators.
const UNSAFE_CHARS = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/g;

function cleanMessage(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.normalize("NFC").replace(UNSAFE_CHARS, " ").replace(/\s+/g, " ").trim();
  if (!text || text.length > MESSAGE_MAX) return null;
  // Only Korean learner copy is shown verbatim; anything else (raw JSON, English internals) is not ours to show.
  if (!/[가-힣]/.test(text) || /[{}<>]/.test(text)) return null;
  return text;
}

function knownCategory(value: unknown): ModerationCategory | undefined {
  return typeof value === "string" && (MODERATION_CATEGORIES as readonly string[]).includes(value)
    ? (value as ModerationCategory)
    : undefined;
}

/**
 * Read a gateway response as a moderation block. Both Service shapes are accepted:
 * `/v1/chat/completions` → `{error:{type,message,category,request_id}}`,
 * `/v1/messages` → `{type:"error",error:{type,message},request_id}` (no category today).
 * Anything that is not a 400 with `error.type === "moderation_block"` is null.
 */
export function parseModerationBlock(status: number | undefined, bodyText: string): ModerationBlock | null {
  if (status !== 400 || typeof bodyText !== "string" || bodyText.length > 16_384) return null;
  let error: unknown;
  try { error = JSON.parse(bodyText)?.error; } catch { return null; }
  if (!error || typeof error !== "object") return null;
  const e = error as Record<string, unknown>;
  if (e.type !== "moderation_block") return null;
  const category = knownCategory(e.category);
  return { message: cleanMessage(e.message) ?? MODERATION_BLOCK_FALLBACK, ...(category ? { category } : {}) };
}

/** Thrown by the proxy runtime for a moderation block, so the turn handler can draw the calm notice. */
export class ModerationBlockError extends Error {
  readonly block: ModerationBlock;
  requestId?: string;
  constructor(block: ModerationBlock, requestId?: string) {
    super(block.message);
    this.name = "ModerationBlockError";
    this.block = block;
    this.requestId = requestId;
  }
}

/**
 * The block behind a failed turn, from either runtime. The agent-sdk runtime surfaces the CLI's
 * error text with a JSON body (sdkCoachHelpers `cliRefusal` keeps it as `sdkErrorLine`/message);
 * that path carries no category today, so it never yields help lines.
 */
export function moderationBlockOf(err: unknown): ModerationBlock | null {
  if (err instanceof ModerationBlockError) return err.block;
  // Duck-typed: the SDK may throw from another realm, where `instanceof Error` is false.
  if (!err || typeof err !== "object") return null;
  const e = err as { message?: unknown; status?: unknown; sdkErrorLine?: unknown };
  const own = e.status;
  for (const text of [e.message, e.sdkErrorLine]) {
    if (typeof text !== "string") continue;
    // Only a CLI-generated API error line counts (same pattern as sdkCliErrorStatus), never other prose.
    const m = /API Error:\s*(?:Request rejected\s*)?\(?(\d{3})\)?/.exec(text);
    if (!m) continue;
    const status = typeof own === "number" ? own : Number(m[1]);
    const at = text.indexOf("{", m.index);
    if (at < 0) continue;
    const block = parseModerationBlock(status, text.slice(at));
    if (block) return block;
  }
  return null;
}

/** Whether the served profile turned the help lines on. Only the literal `true` counts. */
export function helpLinesEnabled(profile: { safety_help_lines?: unknown } | null | undefined): boolean {
  return profile?.safety_help_lines === true;
}

export function safetyNoticeView(block: ModerationBlock, opts: { helpLines: boolean; audience: SeatAudience }): SafetyNoticeView {
  const view: SafetyNoticeView = { title: SAFETY_NOTICE_TITLE, message: block.message };
  if (block.category === "self_harm" && opts.helpLines) {
    view.help = {
      intro: SAFETY_HELP_INTRO,
      lines: SAFETY_HELP_LINES.map((l) => ({ ...l })),
      adultLine: opts.audience === "solo" ? SAFETY_ADULT_LINE : SAFETY_TEACHER_LINE,
    };
  }
  return view;
}
