// CGP-CHAT-R-024 (REQ-STUDIO-COPY-CONVERSATION) — the learner's own task conversation as plain
// Markdown text for the clipboard. Pure and dependency-free apart from the shared secret scrubber,
// so the webview builds it and the smoke tests run it in Node.
//
// Included: the learner's and the coach's visible message text, in transcript order.
// Excluded (AE-39): tool lines (raw tool payloads and the hidden-reasoning "think" lines are both
// `role: "tool"`), system/notice lines, image bytes (data URLs), citation records, credentials
// (scrubbed by the same patterns the host uses before text reaches the model), and control or
// bidirectional-override characters that could make pasted text read differently than it is.
import type { ChatMessage } from "./protocol";
import { redactText } from "@hypeproof/measurement-core/local-record";
import { scrubSecrets } from "./shellPolicy.ts";

export const COPY_CONVERSATION_LABEL = "대화 내용 복사";
export const COPY_CONVERSATION_DONE = "대화 내용을 복사했습니다";
export const COPY_CONVERSATION_FAILED = "대화 내용을 복사하지 못했습니다. 다시 시도해 주세요.";
/** Success stays as long as answer copy (CGP-DS-R-025); a failure stays until the next action. */
export const COPY_CONVERSATION_CONFIRM_MS = 4000;

const LEARNER_HEADING = "나";
const FALLBACK_COACH = "AI";
const NAME_MAX = 40;

// Token families neither the host scrubber nor the shared measurement redactor (MC-30, which covers
// model-provider keys, GitHub/AWS keys, private keys, the measurement token and bearer headers) name:
// payment keys (Stripe, Toss), Slack and Google API keys. Over-masking is acceptable; a pasted live
// key is not.
const EXTRA_SECRETS: readonly { re: RegExp; label: string }[] = [
  { re: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}/g, label: "PAYMENT_KEY" },
  { re: /\b(?:live|test)_(?:sk|gsk|ck|gck)_[A-Za-z0-9]{16,}/g, label: "PAYMENT_KEY" },
  { re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g, label: "SLACK_TOKEN" },
  { re: /\bAIza[0-9A-Za-z_-]{35}\b/g, label: "GOOGLE_KEY" },
];

/** Line separators become newlines; other control, bidi override/isolate, invisible-width and BOM
 * characters go (an invisible character inside a token would otherwise slip past the scrubber).
 * U+200D (zero-width joiner) stays: emoji sequences need it. */
export function plainText(input: string): string {
  return input
    .replace(/\r\n?|[\u2028\u2029\u0085]/g, "\n")
    // C0 except tab/newline, DEL and C1, bidi embeddings/overrides/isolates/marks, BOM.
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069\uFEFF\u200B\u200C\u2060\u00AD]/g, "");
}

export function scrubCredentials(input: string): string {
  let out = redactText(scrubSecrets(input)).text;
  for (const { re, label } of EXTRA_SECRETS) out = out.replace(re, `«${label} 가려짐»`);
  return out;
}

/** A one-line heading: no newlines, no Markdown heading/emphasis characters that would change its level. */
function headingText(input: string | undefined, fallback: string): string {
  const flat = plainText(input ?? "").replace(/[#*_`[\]<>]/g, "").replace(/\s+/g, " ").trim();
  return (flat ? [...flat].slice(0, NAME_MAX).join("") : fallback);
}

export interface ConversationCopyInput {
  messages: readonly ChatMessage[];
  /** The task's title from the host task view; omitted when unknown. */
  title?: string;
  /** The live coach name, used only for answers saved before names were stored (AE-08). */
  coachName?: string;
}

/**
 * Speaker sections are level-2 headings, so a heading inside a message body moves down two levels
 * (# -> ###, ## -> ####): nothing in a message can read as a new speaker. Fenced code is left as is.
 */
export function nestHeadings(body: string): string {
  let fence: string | null = null;
  return body.split("\n").map(line => {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      if (fence === null) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = null;
      return line;
    }
    return fence === null ? line.replace(/^( {0,3})(#{1,6})(?=[ \t]|$)/, (_m, pad: string, hashes: string) => pad + "#".repeat(Math.min(6, hashes.length + 2))) : line;
  }).join("\n");
}

/** Messages that carry the learner's or the coach's visible words. */
export function copyableMessages(messages: readonly ChatMessage[]): ChatMessage[] {
  return messages.filter(m => (m.role === "user" || m.role === "assistant")
    && (plainText(m.content ?? "").trim().length > 0 || (m.role === "user" && (m.images?.length ?? 0) > 0)));
}

/** Simple Markdown, in transcript order. Returns "" when there is nothing to copy. */
export function conversationMarkdown({ messages, title, coachName }: ConversationCopyInput): string {
  const turns = copyableMessages(messages);
  if (!turns.length) return "";
  const parts: string[] = [`# ${headingText(title, "대화")}`];
  for (const m of turns) {
    const who = m.role === "user" ? LEARNER_HEADING : headingText(m.assistantName ?? coachName, FALLBACK_COACH);
    const body = nestHeadings(scrubCredentials(plainText(m.content ?? "")).trim());
    const images = m.role === "user" ? (m.images?.length ?? 0) : 0;
    const lines = [`## ${who}`];
    if (body) lines.push(body);
    if (images) lines.push(`(이미지 ${images}장 첨부, 이미지는 복사하지 않았어요)`);
    parts.push(lines.join("\n\n"));
  }
  return parts.join("\n\n") + "\n";
}
