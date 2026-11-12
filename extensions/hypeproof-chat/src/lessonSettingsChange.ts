// CGP-SHELL-R-024 / CGP-SHELL-D-023 (ADM-11) — when the instructor changes a classroom seat's lesson settings, the
// learner sees what changed in one system line in the chat before the next turn:
// "선생님이 도움 방식을 바꿨어요: <before> → <after>".
//
// Pure: no vscode and no Node built-ins, so the host, the webview and the node tests share it. The host feeds every
// served profile it publishes (postConfig) through `LessonSettingsChangeTracker.observe`, with the seat's REQ-M47
// capability keys, and passes the notices on in the panel config. The webview reports when a line was actually on
// screen (`lessonSettingsChangeSeen`); only then does the persisted baseline move. So a reload does not repeat a line,
// and a change made while Studio was closed, or while the panel was never shown, is told at the next panel open.
//
// Personal seats keep REQ-STUDIO-CAPABILITY-CHANGE (capabilityChange.ts): they have no instructor. This module covers
// the seats that one leaves quiet: a classroom seat, a seat with a served lesson or an enforced lesson binding.

import { AI_CAPABILITY_LABELS, aiCapabilityState, type AiCapabilityKey } from "./aiCapabilities.ts";
import { APPROVAL_PRESET_NAME, servedApprovalPreset } from "./approvalPreset.ts";
import { servedLessonStarters } from "./lessonStarters.ts";
import { PLAN_FIRST_LABEL, planFirstAvailable } from "./planFirst.ts";
import { DICTATE_LABEL, READ_ALOUD_LABEL } from "./voiceCopy.ts";
import { readServedVoice } from "./voiceServed.ts";

/** Learner copy (Korean is the product; see CLAUDE.md §Language). The item names reuse the labels the learner already sees. */
export const LESSON_SETTINGS_CHANGE_COPY = {
  title: "선생님이 도움 방식을 바꿨어요",
  on: "켜짐",
  off: "꺼짐",
  /** No lesson value at all: the app's own default applies. */
  unset: "기본",
  /** A free-text field changed. Its text is never quoted. */
  changed: "바뀜",
  starters: "시작 문장",
  separator: " · ",
} as const;

/** The globalState key that holds one baseline per seat. Values are settings and fingerprints only, never credentials. */
export const LESSON_SETTINGS_BASELINE_KEY = "hps.lessonSettings.baseline";
const MAX_SEATS = 32;
const MAX_LINES_PER_SEAT = 3;

/** What the learner was last told about one seat's lesson settings. */
export interface LessonSettingsSnapshot {
  v: 1;
  /**
   * REQ-M47 keys that are on (and of those, the ones that ask first), and the learner's lasting inputs they were evaluated
   * under (access choice, runtime setting; never the per-session fallback). A change of those inputs alone is not the
   * instructor's change, so it never makes a line.
   */
  caps: { inputs: string; on: AiCapabilityKey[]; asks?: AiCapabilityKey[] };
  /** The served approval preset with the label it was served with; null = no preset (the app default). */
  preset: { id: string; label: string } | null;
  /** The class lets the learner use "계획 먼저" (DEC-10: only an explicit `available: false` turns it off). */
  planFirst: boolean;
  dictation: boolean;
  readAloud: boolean;
  /** A fingerprint of the starter sentences, never their text: the line names the change and never quotes it. */
  starters: string;
}

/** One changed setting. `before`/`after` for a closed set of values; neither for free text (named only). */
export interface LessonSettingsChangeItem { key: string; label: string; before?: string; after?: string }

/** One line, as the panel draws it. */
export interface LessonSettingsNotice {
  id: string;
  text: string;
  items: LessonSettingsChangeItem[];
  /** The line sits right after this message: the last one saved when the change was seen. null = before every message. */
  afterMessageId: string | null;
  /** The task the line belongs to (null when the seat has no task workspace). */
  task: string | null;
  /** The panel reported it on screen; it is drawn without a live region from then on. */
  seen: boolean;
}

type SnapshotProfile = Parameters<typeof servedApprovalPreset>[0] & Parameters<typeof planFirstAvailable>[0] & Parameters<typeof readServedVoice>[0] & Parameters<typeof servedLessonStarters>[0];

/**
 * Seats that get the line: a classroom seat, or one with a served lesson or an enforced lesson binding. Never the
 * instructor surface, local mode or a seat Studio cannot place (those get nothing, as with REQ-STUDIO-FINISH-NOTICE).
 */
export function lessonSettingsChangeApplies(profile: { activity_kind?: string | null; lesson?: unknown; lesson_binding?: { enforced?: boolean } | null } | null | undefined, instructor = false, local = false): boolean {
  if (!profile || instructor || local) return false;
  return profile.activity_kind === "classroom" || !!profile.lesson || profile.lesson_binding?.enforced === true;
}

/** FNV-1a (32 bit) over the starter list. Change detection only; collisions would make a change silent, never invent one. */
function fingerprint(values: readonly string[]): string {
  let h = 0x811c9dc5;
  const text = JSON.stringify(values);
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return `${values.length}:${h.toString(16)}`;
}

/** The learner-relevant lesson settings of a served profile, with the REQ-M47 keys the host evaluated for it. */
export function lessonSettingsSnapshot(profile: SnapshotProfile, caps: { inputs: string; on: readonly AiCapabilityKey[]; asks?: readonly AiCapabilityKey[] }): LessonSettingsSnapshot {
  const preset = servedApprovalPreset(profile);
  const voice = readServedVoice(profile);
  const order = Object.keys(AI_CAPABILITY_LABELS) as AiCapabilityKey[];
  return {
    v: 1,
    caps: { inputs: caps.inputs, on: order.filter((k) => caps.on.includes(k)), asks: order.filter((k) => caps.on.includes(k) && (caps.asks ?? []).includes(k)) },
    preset: preset ? { id: preset.id, label: preset.label } : null,
    planFirst: planFirstAvailable(profile),
    dictation: voice?.dictation === true,
    readAloud: voice?.readAloud === true,
    starters: fingerprint(servedLessonStarters(profile)),
  };
}

const C = LESSON_SETTINGS_CHANGE_COPY;
const onOff = (v: boolean): string => (v ? C.on : C.off);
/** The REQ-M47 card's own word for a row: 해요, 물어봐요 or 안 해요. */
const capWord = (caps: LessonSettingsSnapshot["caps"], key: AiCapabilityKey): string => {
  const on = caps.on.includes(key);
  return aiCapabilityState({ key, label: AI_CAPABILITY_LABELS[key], on, ...(on && (caps.asks ?? []).includes(key) ? { asks: true } : {}) });
};

/** What changed from `before` to `after`, in a fixed order. Capabilities only when both sides share the learner's inputs. */
export function diffLessonSettings(before: LessonSettingsSnapshot, after: LessonSettingsSnapshot): LessonSettingsChangeItem[] {
  const items: LessonSettingsChangeItem[] = [];
  if ((before.preset?.id ?? null) !== (after.preset?.id ?? null)) {
    items.push({ key: "approval_preset", label: APPROVAL_PRESET_NAME, before: before.preset?.label ?? C.unset, after: after.preset?.label ?? C.unset });
  }
  if (before.planFirst !== after.planFirst) items.push({ key: "plan_first", label: PLAN_FIRST_LABEL, before: onOff(before.planFirst), after: onOff(after.planFirst) });
  if (before.caps.inputs === after.caps.inputs) {
    for (const key of Object.keys(AI_CAPABILITY_LABELS) as AiCapabilityKey[]) {
      const b = before.caps.on.includes(key), a = after.caps.on.includes(key);
      // A row is listed when the capability turns on or off; asking alone follows the approval preset, which has its own item.
      if (b !== a) items.push({ key: `cap:${key}`, label: AI_CAPABILITY_LABELS[key], before: capWord(before.caps, key), after: capWord(after.caps, key) });
    }
  }
  if (before.dictation !== after.dictation) items.push({ key: "dictation", label: DICTATE_LABEL, before: onOff(before.dictation), after: onOff(after.dictation) });
  if (before.readAloud !== after.readAloud) items.push({ key: "read_aloud", label: READ_ALOUD_LABEL, before: onOff(before.readAloud), after: onOff(after.readAloud) });
  if (before.starters !== after.starters) items.push({ key: "starters", label: C.starters });
  return items;
}

/** The line's words: one line that lists every change, closed values as before → after, free text named only. */
export function lessonSettingsChangeText(items: readonly LessonSettingsChangeItem[]): string {
  const part = (i: LessonSettingsChangeItem) => (i.before !== undefined && i.after !== undefined ? `${i.label} ${i.before} → ${i.after}` : `${i.label} ${C.changed}`);
  return `${C.title}: ${items.map(part).join(C.separator)}`;
}

const sameSnapshot = (a: LessonSettingsSnapshot, b: LessonSettingsSnapshot): boolean => JSON.stringify(a) === JSON.stringify(b);

function validSnapshot(raw: unknown): raw is LessonSettingsSnapshot {
  if (typeof raw !== "object" || raw === null) return false;
  const s = raw as Partial<LessonSettingsSnapshot>;
  const keys = Object.keys(AI_CAPABILITY_LABELS);
  return s.v === 1 && typeof s.caps === "object" && s.caps !== null && typeof s.caps.inputs === "string" && Array.isArray(s.caps.on) && s.caps.on.every((k) => keys.includes(k))
    && (s.caps.asks === undefined || (Array.isArray(s.caps.asks) && s.caps.asks.every((k) => keys.includes(k))))
    && (s.preset === null || (typeof s.preset === "object" && typeof s.preset?.id === "string" && typeof s.preset?.label === "string"))
    && typeof s.planFirst === "boolean" && typeof s.dictation === "boolean" && typeof s.readAloud === "boolean" && typeof s.starters === "string";
}

/** The part of VS Code's Memento this needs (globalState: shared by every window of this app). */
export interface BaselineStore { get(key: string): unknown; update(key: string, value: unknown): PromiseLike<void> }

export interface LessonSettingsObservation {
  /** A stable, credential-free key for the seat (host: a hash of the Service and the activity id or token). */
  seat: string | null;
  /** The served profile; null while it is not resolved. */
  profile: (SnapshotProfile & Parameters<typeof lessonSettingsChangeApplies>[0]) | null;
  /** REQ-M47 keys that are on (and asking) for this profile under the learner's lasting inputs, and a fingerprint of those inputs. */
  caps: { inputs: string; on: readonly AiCapabilityKey[]; asks?: readonly AiCapabilityKey[] };
  instructor?: boolean;
  local?: boolean;
  /** A turn is running. A change it sees waits for the turn to end; the running turn keeps the settings it started with. */
  turnRunning: boolean;
  /** The id of the last saved message, where a new line is placed. */
  lastMessageId: string | null;
  task: string | null;
}

interface HeldNotice extends LessonSettingsNotice { seat: string; after: LessonSettingsSnapshot }

/**
 * Remembers, per seat and across restarts, the settings the learner was last told about, and turns a difference into
 * one line. The first profile of a seat is the silent baseline. A line waits while a turn runs. A change undone before
 * the line was seen clears it; a further change before it was seen replaces it with one line from the old baseline.
 */
export class LessonSettingsChangeTracker {
  private lines: HeldNotice[] = [];
  private seq = 0;

  private readonly store: BaselineStore;
  // A plain field, not a parameter property: node's strip-only TypeScript loader runs this file in the tests.
  constructor(store: BaselineStore) { this.store = store; }

  private record(): Record<string, LessonSettingsSnapshot> {
    const raw = this.store.get(LESSON_SETTINGS_BASELINE_KEY);
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
    const out: Record<string, LessonSettingsSnapshot> = {};
    for (const [seat, snap] of Object.entries(raw as Record<string, unknown>)) if (validSnapshot(snap)) out[seat] = snap;
    return out;
  }

  /** The persisted baseline of a seat, if any. */
  baseline(seat: string): LessonSettingsSnapshot | null { return this.record()[seat] ?? null; }

  private async save(seat: string, snap: LessonSettingsSnapshot): Promise<void> {
    const rec = this.record();
    delete rec[seat];
    rec[seat] = snap;
    const seats = Object.keys(rec);
    for (const old of seats.slice(0, Math.max(0, seats.length - MAX_SEATS))) delete rec[old];
    await this.store.update(LESSON_SETTINGS_BASELINE_KEY, rec);
  }

  private visible(seat: string | null): LessonSettingsNotice[] {
    return this.lines.filter((l) => l.seat === seat).map(({ seat: _s, after: _a, ...line }) => ({ ...line, items: line.items.map((i) => ({ ...i })) }));
  }

  /** Feed one served profile. `deferred` = a change waits for the running turn to end: observe again then. */
  async observe(o: LessonSettingsObservation): Promise<{ notices: LessonSettingsNotice[]; deferred: boolean }> {
    if (!o.seat || !lessonSettingsChangeApplies(o.profile, o.instructor === true, o.local === true)) return { notices: [], deferred: false };
    if (!o.profile) return { notices: this.visible(o.seat), deferred: false };
    const now = lessonSettingsSnapshot(o.profile, o.caps);
    const base = this.baseline(o.seat);
    if (!base) { await this.save(o.seat, now); return { notices: this.visible(o.seat), deferred: false }; }
    const items = diffLessonSettings(base, now);
    const unseen = this.lines.find((l) => l.seat === o.seat && !l.seen);
    if (!items.length) {
      // Back to what the learner was told, or only the learner's own inputs moved: nothing to tell.
      if (unseen) this.lines = this.lines.filter((l) => l !== unseen);
      if (!sameSnapshot(base, now)) await this.save(o.seat, now);
      return { notices: this.visible(o.seat), deferred: false };
    }
    if (o.turnRunning) return { notices: this.visible(o.seat), deferred: true };
    if (unseen && sameSnapshot(unseen.after, now)) return { notices: this.visible(o.seat), deferred: false };
    if (unseen) this.lines = this.lines.filter((l) => l !== unseen);
    this.lines.push({ id: `lsc-${++this.seq}`, seat: o.seat, text: lessonSettingsChangeText(items), items, afterMessageId: o.lastMessageId, task: o.task, seen: false, after: now });
    const mine = this.lines.filter((l) => l.seat === o.seat);
    if (mine.length > MAX_LINES_PER_SEAT) { const drop = new Set(mine.slice(0, mine.length - MAX_LINES_PER_SEAT)); this.lines = this.lines.filter((l) => !drop.has(l)); }
    return { notices: this.visible(o.seat), deferred: false };
  }

  /** The panel showed line `id`: what it says is now what the learner was told. Unknown or replaced ids do nothing. */
  async seen(id: string): Promise<boolean> {
    const line = this.lines.find((l) => l.id === id);
    if (!line || line.seen) return false;
    line.seen = true;
    // A line can only be seen while it is the newest for its seat; the baseline then becomes what it described.
    await this.save(line.seat, line.after);
    return true;
  }
}

/** Where the panel draws each line among the messages it shows. A seen line whose place is gone is not drawn again. */
export function placeLessonSettingsLines(lines: readonly LessonSettingsNotice[] | undefined, shownIds: readonly string[], task: string | null): { top: LessonSettingsNotice[]; after: Map<string, LessonSettingsNotice[]>; bottom: LessonSettingsNotice[] } {
  const out = { top: [] as LessonSettingsNotice[], after: new Map<string, LessonSettingsNotice[]>(), bottom: [] as LessonSettingsNotice[] };
  const ids = new Set(shownIds);
  for (const line of lines ?? []) {
    if (line.afterMessageId !== null && ids.has(line.afterMessageId)) out.after.set(line.afterMessageId, [...(out.after.get(line.afterMessageId) ?? []), line]);
    else if (line.afterMessageId === null && line.task === task) out.top.push(line);
    else if (!line.seen) out.bottom.push(line);
  }
  return out;
}
