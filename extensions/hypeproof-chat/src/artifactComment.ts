// CGP-ART-R-005 / CGP-ART-D-005 — an instructor's comment anchored to one place in this learner's approved artifact
// version (#751 U1b): the pure rules. No `vscode`, no file system, no clock, so the tests load this file directly.
// Contract: docs/requirements/classroom-admin.md "Artifact comments · CGP-ART-R-005" and the Service's
// worker/src/lib/classroom-distribution.ts (`normalizeAnchor`, `normalizeCommentAnswer`); the canonical bytes of both
// sides are pinned in test/artifact-comment.test.mjs and the Service's classroom-artifact-comment.test.mjs.
//
// What the rules protect:
//  - a comment is shown only on a version THIS learner approved on this device: a comment about anybody else's page (a
//    shared PC, a seat handed over, a wrong send) is never drawn;
//  - the instructor's text is plain text: it is never parsed as markup or links, and it is length-capped by the contract;
//  - nothing here reaches the coach: there is no path from a comment to a chat turn or a model request.
import type { SpoolCollectionSource } from "./sessionSpool.ts";

export const INBOX_COMMENT_CAPABILITY = "inbox_comment";
/** Same numbers as the Service. */
export const MAX_COMMENT_CHARS = 500, MAX_ELEMENT_REF_CHARS = 120, MAX_REPLY_CHARS = 500;
const SHA256_RE = /^[a-f0-9]{64}$/;
const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‏‪-‮⁦-⁩﻿]/;

/** Whole permille of the page (0–1000 on each axis): independent of fonts, zoom and window size. */
export interface CommentRect { x: number; y: number; w: number; h: number }
export type CommentAnchor = { artifact_sha256: string; rect: CommentRect } | { artifact_sha256: string; element: string };
/** The learner's whole current state of one comment. Each answer replaces the last. */
export interface CommentAnswer { handled: boolean; reply?: string }

const exactKeys = (o: Record<string, unknown>, keys: string[]) => Object.keys(o).every((k) => keys.includes(k)) && keys.every((k) => k in o);
/** Refused, never repaired: a repaired anchor would no longer hash to what the instructor sent. */
export function validateAnchor(raw: unknown): CommentAnchor | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const a = raw as Record<string, unknown>;
  if (typeof a.artifact_sha256 !== "string" || !SHA256_RE.test(a.artifact_sha256)) return null;
  if (a.rect !== undefined) {
    const r = a.rect as Record<string, unknown> | null;
    if (!exactKeys(a, ["artifact_sha256", "rect"]) || !r || typeof r !== "object" || Array.isArray(r) || !exactKeys(r, ["x", "y", "w", "h"])) return null;
    const int = (v: unknown, lo: number) => Number.isSafeInteger(v) && (v as number) >= lo && (v as number) <= 1000;
    const { x, y, w, h } = r as Record<string, number>;
    if (!int(x, 0) || !int(y, 0) || !int(w, 1) || !int(h, 1) || x + w > 1000 || y + h > 1000) return null;
    return { artifact_sha256: a.artifact_sha256, rect: { x, y, w, h } };
  }
  const el = a.element;
  if (!exactKeys(a, ["artifact_sha256", "element"]) || typeof el !== "string" || !el || el !== el.trim() || [...el].length > MAX_ELEMENT_REF_CHARS || CONTROL_RE.test(el) || /[\r\n\t]/.test(el)) return null;
  return { artifact_sha256: a.artifact_sha256, element: el };
}
/** The sixth element of the content hash, exactly as the Service builds it. */
export const anchorCanonical = (a: CommentAnchor): unknown[] => "rect" in a ? ["rect", a.artifact_sha256, a.rect.x, a.rect.y, a.rect.w, a.rect.h] : ["element", a.artifact_sha256, a.element];

/** What this device lets a learner send. Normalized exactly as the Service stores it. */
export function validateCommentAnswer(raw: unknown): CommentAnswer | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const a = raw as Record<string, unknown>;
  if (Object.keys(a).some((k) => k !== "handled" && k !== "reply") || typeof a.handled !== "boolean") return null;
  if (a.reply === undefined) return { handled: a.handled };
  if (typeof a.reply !== "string" || !a.reply.trim() || [...a.reply].length > MAX_REPLY_CHARS || CONTROL_RE.test(a.reply)) return null;
  return { handled: a.handled, reply: a.reply.replace(/\r\n?/g, "\n").trim() };
}

/**
 * The versions this learner approved, from their own spool sessions in the class window (the same window an instructor's
 * collection reads). The learner's last word on a version wins, in time order: approve → withdraw → approve again.
 * A line that does not parse is skipped, never guessed at.
 */
export function approvedVersions(src: SpoolCollectionSource | null): Set<string> {
  if (!src) return new Set();
  const texts: string[] = [];
  const dec = (b: Uint8Array) => new TextDecoder().decode(b);
  const events = src.current?.files.find((f) => f.name === "events.jsonl");
  if (events) texts.push(dec(events.data));
  for (const o of src.others) texts.push(dec(o.events));
  const marks: Array<{ ts: string; seq: number; part: number; sha: string; approved: boolean }> = [];
  texts.forEach((text, part) => {
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      let e: Record<string, unknown>; try { e = JSON.parse(line); } catch { continue; }
      if (e?.type !== "artifact_approval" || typeof e.artifact_sha256 !== "string" || !SHA256_RE.test(e.artifact_sha256)) continue;
      marks.push({ ts: typeof e.ts === "string" ? e.ts : "", seq: Number.isSafeInteger(e.seq) ? e.seq as number : 0, part, sha: e.artifact_sha256, approved: e.approved === true });
    }
  });
  marks.sort((a, b) => a.ts.localeCompare(b.ts) || a.part - b.part || a.seq - b.seq);
  const state = new Map<string, boolean>(); for (const m of marks) state.set(m.sha, m.approved);
  return new Set([...state].filter(([, v]) => v).map(([k]) => k));
}

/**
 * Where a comment belongs. `null` = the anchored version is not one this learner approved here, so the comment is NOT
 * shown at all. `current` = the learner's index.html is that version now. `previous` = they have changed it since
 * ("이전 판에 남긴 의견"); an unreadable current page counts as previous: it is not known to be the same version.
 */
export type CommentVersion = "current" | "previous";
export function commentVersion(anchorSha: string, approved: ReadonlySet<string>, currentSha: string | null): CommentVersion | null {
  if (!approved.has(anchorSha)) return null;
  return currentSha === anchorSha ? "current" : "previous";
}

/** The pin's place on the page miniature, in percent of its box (logical: inline start, block start). Null = an element reference. */
export function pinPlace(anchor: CommentAnchor): { inline: number; block: number } | null {
  if (!("rect" in anchor)) return null;
  const { x, y, w, h } = anchor.rect;
  return { inline: Math.round((x + w / 2) / 10), block: Math.round((y + h / 2) / 10) };
}
/** The place in words, so the anchor never depends on seeing the pin (screen readers, high contrast, no miniature). */
export function placeWords(anchor: CommentAnchor): string {
  if (!("rect" in anchor)) return `‘${anchor.element}’ 부분`;
  const p = pinPlace(anchor)!;
  const col = p.inline < 34 ? "왼쪽" : p.inline > 66 ? "오른쪽" : "가운데";
  const row = p.block < 34 ? "위쪽" : p.block > 66 ? "아래쪽" : "가운데";
  return row === "가운데" && col === "가운데" ? "페이지 가운데" : `페이지 ${row} ${col}`;
}
/** The 8-character fingerprint the learner saw when approving ("지문 abcd1234"). */
export const fingerprint = (sha: string) => sha.slice(0, 8);
