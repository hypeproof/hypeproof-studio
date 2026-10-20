// REQ-STUDIO-ARTIFACT-PROVENANCE (CGP-KNOW-R-012 / REQ-KNOW-21). vscode-free.
//
// Each file of the work folder gets a provenance label that comes only from recorded events,
// never from what the coach said it did:
//   AI가 만듦   a coach turn added the file (per-turn restore diff, #1915 / turnRestore.ts)
//   AI가 고침   a coach turn changed it
//   내가 올림   the learner attached it (photo attach D-028 or pasted image #421), committed by the host
//   내가 고침   its bytes changed between two observations that were both outside a coach turn
//   기록 없음   nothing recorded explains its current bytes
//
// The ledger is one JSON file per work folder in the extension's storage (beside the restore
// stores, never in the work folder, never uploaded). It holds the last observed state of the
// folder (path -> sha256) and an append-only, bounded list of events. When an observation
// window could not be measured (no restore point, a scan past its cap, a read failure), the
// ledger is marked stale; the next observation then records the differences as `unknown`
// (기록 없음), never as a learner change, because a coach turn may have made them.

import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { PROVENANCE_LABELS, type ArtifactProvenanceEntry, type ArtifactProvenanceView, type ProvenanceEventKind, type ProvenanceLabelKind } from "./artifactProvenanceView.ts";

export { PROVENANCE_LABELS, provenanceHistoryText } from "./artifactProvenanceView.ts";
export type { ArtifactProvenanceEntry, ArtifactProvenanceView, ProvenanceEventKind, ProvenanceLabelKind } from "./artifactProvenanceView.ts";


export interface ProvenanceEvent {
  path: string;
  kind: ProvenanceEventKind;
  /** Observation time (ms), not the time of the edit itself. */
  at: number;
  /** Bytes the event left behind; absent for `removed`. */
  sha256?: string;
  /** The coach turn that made the change (`ai_*` only). */
  turnId?: string;
}

export interface ProvenanceLedger {
  version: 1;
  /** Last observed state of the folder, or null before the first observation. */
  baseline: Record<string, string> | null;
  /** True when a window since `baseline` was not measured. */
  stale: boolean;
  events: ProvenanceEvent[];
}

/** Events kept per folder; the oldest go first (a file whose only event went shows 기록 없음). */
export const PROVENANCE_EVENT_CAP = 2000;
/** Entries the view lists. */
export const PROVENANCE_VIEW_CAP = 100;
/** History steps shown per file. */
export const PROVENANCE_HISTORY_STEPS = 4;

export function emptyLedger(): ProvenanceLedger {
  return { version: 1, baseline: null, stale: false, events: [] };
}

interface FileHash { path: string; sha256: string }

const toMap = (files: readonly FileHash[]) => Object.fromEntries(files.map((f) => [f.path, f.sha256]));

function capEvents(events: ProvenanceEvent[]): ProvenanceEvent[] {
  return events.length > PROVENANCE_EVENT_CAP ? events.slice(events.length - PROVENANCE_EVENT_CAP) : events;
}

/**
 * An observation outside a coach turn: the scan taken just before a turn (the restore point's
 * files) or when the learner opens the list while nothing runs. `uploaded` names the paths the
 * host itself committed from a learner attachment since the last observation.
 */
export function observeOutsideTurn(ledger: ProvenanceLedger, files: readonly FileHash[], opts: { at: number; uploaded?: readonly string[] }): ProvenanceLedger {
  const uploaded = new Set(opts.uploaded ?? []);
  const events = [...ledger.events];
  const base = ledger.baseline;
  for (const f of files) {
    const before = base?.[f.path];
    if (before === f.sha256) continue;
    if (uploaded.has(f.path)) { events.push({ path: f.path, kind: "learner_uploaded", at: opts.at, sha256: f.sha256 }); continue; }
    // First observation ever: what was already there has no recorded origin.
    if (!base) continue;
    if (ledger.stale) { if (before !== undefined || hasHistory(events, f.path)) events.push({ path: f.path, kind: "unknown", at: opts.at, sha256: f.sha256 }); continue; }
    events.push({ path: f.path, kind: "learner_changed", at: opts.at, sha256: f.sha256 });
  }
  if (base) {
    const now = new Set(files.map((f) => f.path));
    for (const p of Object.keys(base)) if (!now.has(p)) events.push({ path: p, kind: "removed", at: opts.at });
  }
  return { version: 1, baseline: toMap(files), stale: false, events: capEvents(events) };
}

function hasHistory(events: readonly ProvenanceEvent[], p: string): boolean {
  for (let i = events.length - 1; i >= 0; i--) if (events[i].path === p) return events[i].kind !== "removed";
  return false;
}

/**
 * The end of a coach turn: `added` / `changed` / `deleted` from `diffRestorePoint`, `after` the
 * scan they came from. The turn must have started from an observation (`observeOutsideTurn` with
 * the restore point's files); otherwise the ledger is stale and the diff is not trusted.
 */
export function recordCoachTurn(ledger: ProvenanceLedger, turn: { turnId: string; at: number; added: readonly string[]; changed: readonly string[]; deleted: readonly string[] }, after: readonly FileHash[]): ProvenanceLedger {
  if (ledger.stale || !ledger.baseline) return markUnobserved({ ...ledger, baseline: ledger.baseline ?? toMap(after) });
  const hash = toMap(after);
  const events = [...ledger.events];
  for (const p of turn.added) if (hash[p]) events.push({ path: p, kind: "ai_created", at: turn.at, sha256: hash[p], turnId: turn.turnId });
  for (const p of turn.changed) if (hash[p]) events.push({ path: p, kind: "ai_changed", at: turn.at, sha256: hash[p], turnId: turn.turnId });
  for (const p of turn.deleted) events.push({ path: p, kind: "removed", at: turn.at, turnId: turn.turnId });
  return { version: 1, baseline: hash, stale: false, events: capEvents(events) };
}

/** A window that was not measured: the next observation records differences as 기록 없음. */
export function markUnobserved(ledger: ProvenanceLedger): ProvenanceLedger {
  return { ...ledger, stale: true };
}

/**
 * "되돌리기" put the folder back to the restore point taken at `pointAt`. Everything recorded
 * after that moment described bytes the revert discarded, so it goes; the restored folder is then
 * compared with the point's state, and any file the revert could not put back reads 기록 없음.
 */
export function recordRevert(ledger: ProvenanceLedger, revert: { pointAt: number; pointFiles: readonly FileHash[]; at: number }, after: readonly FileHash[]): ProvenanceLedger {
  const events = ledger.events.filter((e) => e.at <= revert.pointAt);
  return observeOutsideTurn({ version: 1, baseline: toMap(revert.pointFiles), stale: true, events }, after, { at: revert.at });
}

/** One entry per file of the last observation; newest recorded event first, then 기록 없음 by path. */
export function provenanceView(ledger: ProvenanceLedger): ArtifactProvenanceView {
  if (!ledger.baseline) return { entries: [], more: 0, unobserved: true };
  const byPath = new Map<string, ProvenanceEvent[]>();
  for (const e of ledger.events) {
    if (e.kind === "removed") { byPath.delete(e.path); continue; }
    const list = byPath.get(e.path) ?? [];
    list.push(e);
    byPath.set(e.path, list);
  }
  const entries: ArtifactProvenanceEntry[] = [];
  for (const [p, sha] of Object.entries(ledger.baseline)) {
    const list = byPath.get(p) ?? [];
    const latest = list.at(-1);
    // An event explains the file only if it left exactly the bytes that are there now.
    if (!latest || latest.sha256 !== sha) {
      const history = foldHistory(list);
      entries.push({ path: p, kind: "none", ...PROVENANCE_LABELS.none, history: history.length ? [...history, PROVENANCE_LABELS.none.label].slice(-PROVENANCE_HISTORY_STEPS) : [] });
      continue;
    }
    const kind = latest.kind as ProvenanceLabelKind;
    entries.push({ path: p, kind, ...PROVENANCE_LABELS[kind], history: foldHistory(list), at: latest.at });
  }
  entries.sort((a, b) => (b.at ?? -1) - (a.at ?? -1) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { entries: entries.slice(0, PROVENANCE_VIEW_CAP), more: Math.max(0, entries.length - PROVENANCE_VIEW_CAP), unobserved: false };
}

function foldHistory(list: readonly ProvenanceEvent[]): string[] {
  const out: string[] = [];
  for (const e of list) {
    const label = PROVENANCE_LABELS[e.kind as ProvenanceLabelKind].label;
    if (out.at(-1) !== label) out.push(label);
  }
  return out.slice(-PROVENANCE_HISTORY_STEPS);
}

// --- storage -------------------------------------------------------------------------------

/** The ledger file of one work folder under `base` (the extension's storage). */
export function provenanceLedgerFile(base: string, folderRealPath: string): string {
  const folder = createHash("sha256").update(path.resolve(folderRealPath)).digest("hex").slice(0, 24);
  return path.join(base, "artifact-provenance", `${folder}.json`);
}

const SHA = /^[a-f0-9]{64}$/;
const KINDS = new Set<ProvenanceEventKind>(["ai_created", "ai_changed", "learner_uploaded", "learner_changed", "unknown", "removed"]);

function validLedger(v: unknown): v is ProvenanceLedger {
  const l = v as ProvenanceLedger;
  if (!l || l.version !== 1 || typeof l.stale !== "boolean" || !Array.isArray(l.events)) return false;
  if (l.baseline !== null && (typeof l.baseline !== "object" || Object.values(l.baseline).some((s) => typeof s !== "string" || !SHA.test(s)))) return false;
  return l.events.every((e) => e && typeof e.path === "string" && KINDS.has(e.kind) && typeof e.at === "number" && (e.sha256 === undefined || SHA.test(e.sha256)));
}

/** A missing file is an empty ledger; a damaged one is an empty, stale ledger (nothing it said is trusted). */
export async function loadLedger(file: string): Promise<ProvenanceLedger> {
  let text: string;
  try { text = await fs.readFile(file, "utf8"); } catch { return emptyLedger(); }
  try { const parsed = JSON.parse(text); if (validLedger(parsed)) return parsed; } catch { /* damaged */ }
  return { ...emptyLedger(), stale: true };
}

export async function saveLedger(file: string, ledger: ProvenanceLedger): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomUUID()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(ledger));
  await fs.rename(tmp, file);
}

/** Load, apply, save. Never throws; returns the new ledger, or null when it could not be saved. */
export async function updateLedger(file: string, fn: (l: ProvenanceLedger) => ProvenanceLedger): Promise<ProvenanceLedger | null> {
  try {
    const next = fn(await loadLedger(file));
    await saveLedger(file, next);
    return next;
  } catch { return null; }
}

// --- host side -----------------------------------------------------------------------------

interface PointLike { createdAt: number; turnId: string; files: readonly FileHash[] }
interface TurnDiff { added: readonly string[]; changed: readonly string[]; deleted: readonly string[] }

/**
 * What the chat host calls around a coach turn. Every method swallows its own failures: a
 * provenance problem never stops a turn, and a write that failed leaves the ledger stale.
 * Calls for one folder are serialized, so a list request cannot interleave with a turn's end.
 */
export class ArtifactProvenanceRecorder {
  private queue: Promise<unknown> = Promise.resolve();
  /** Paths the host committed from a learner attachment, waiting for the next observation. */
  private uploads = new Set<string>();
  private readonly base: string;
  private readonly now: () => number;
  constructor(base: string, now: () => number = Date.now) {
    this.base = base;
    this.now = now;
  }

  private run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.queue.then(fn, fn);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private file(root: string): string { return provenanceLedgerFile(this.base, root); }

  private async apply(root: string, fn: (l: ProvenanceLedger) => ProvenanceLedger): Promise<ProvenanceLedger | null> {
    const next = await updateLedger(this.file(root), fn);
    // A failed save may have lost an event: say so on the next successful write.
    if (!next) await updateLedger(this.file(root), markUnobserved);
    return next;
  }

  /** The host has just written these work-folder paths (posix, relative) from a learner attachment. */
  noteUploaded(paths: readonly string[]): void {
    for (const p of paths) this.uploads.add(p.replace(/\\/g, "/"));
  }

  private takeUploads(): string[] {
    const out = [...this.uploads];
    this.uploads.clear();
    return out;
  }

  /** Before a coach turn, with the restore point just taken (after this send's uploads were committed). */
  turnStart(root: string, point: PointLike): Promise<unknown> {
    return this.run(() => this.apply(root, (l) => observeOutsideTurn(l, point.files, { at: point.createdAt, uploaded: this.takeUploads() })));
  }

  /** After a coach turn whose start was observed. */
  turnEnd(root: string, point: PointLike, diff: TurnDiff, after: readonly FileHash[]): Promise<ProvenanceLedger | null> {
    const at = Math.max(this.now(), point.createdAt + 1);
    return this.run(() => this.apply(root, (l) => recordCoachTurn(l, { turnId: point.turnId, at, ...diff }, after)));
  }

  /** A turn ran (or ended) without a usable measurement. */
  unobserved(root: string): Promise<unknown> {
    this.uploads.clear();
    return this.run(() => updateLedger(this.file(root), markUnobserved));
  }

  /** After "되돌리기" to `point`, with a fresh scan of the folder (or null when none could be taken). */
  reverted(root: string, point: PointLike, after: readonly FileHash[] | null): Promise<unknown> {
    const at = Math.max(this.now(), point.createdAt + 1);
    return this.run(() => this.apply(root, (l) => after
      ? recordRevert(l, { pointAt: point.createdAt, pointFiles: point.files, at }, after)
      : markUnobserved({ ...l, events: l.events.filter((e) => e.at <= point.createdAt) })));
  }

  /**
   * The list for the learner. With `scan` (taken while no turn runs) it is also an observation;
   * without one the ledger is only read.
   */
  view(root: string, scan?: readonly FileHash[]): Promise<ArtifactProvenanceView | null> {
    return this.run(async () => {
      const ledger = scan ? await this.apply(root, (l) => observeOutsideTurn(l, scan, { at: this.now(), uploaded: this.takeUploads() })) : await loadLedger(this.file(root));
      return ledger ? provenanceView(ledger) : null;
    });
  }
}
