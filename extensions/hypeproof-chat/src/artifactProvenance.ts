// REQ-STUDIO-ARTIFACT-PROVENANCE (CGP-KNOW-R-012 / REQ-KNOW-21). vscode-free.
//
// Each file of the work folder gets a provenance label that comes only from recorded events,
// never from what the coach said it did:
//   AI가 만듦 / AI가 고침          a coach turn's restore diff (#1915 / turnRestore.ts) names it as
//                                  added / changed, or Studio wrote the coach's own output into the
//                                  folder (a revealed page, agent.md, an image-edit result, wiki pages)
//   Studio가 만듦 / Studio가 고침  Studio wrote bytes of its own (a prebuilt world, a starter page,
//                                  a preview action, a wiki template, notes moved into raw/)
//   내가 올림                      Studio committed it from a learner attachment (D-028 photo, #421 paste)
//   기록 없음                      everything else, including the learner's own edits: in this slice
//                                  no event attributes a change to the learner. VS Code's measured
//                                  event order (a change reports isDirty from before it, save
//                                  participants run before onWillSave, Save without Formatting fires
//                                  no onWillSave) cannot tell a learner's save from a formatter's or a
//                                  forced save of the AI's bytes, so no "learner changed it" label exists.
//
// Scans only detect THAT bytes changed; they never attribute a change. Any change no hook explains
// (the learner, a background process, git, another editor, a write landing after a scan, a race of
// any kind) reads 기록 없음.
//
// The ledger is one JSON file per work folder in the extension's storage (beside the restore
// stores, never in the work folder, never uploaded). It holds the last observed state of the
// folder (path -> sha256), the paths whose state is not known (`stalePaths`: not covered by the
// last scan) and an append-only, bounded list of events. A window that was not measured (no
// restore point, a failed scan or save, a new session, a pull) marks the ledger stale; the list
// then confirms no label until the next complete observation.

import { artifactHistoryStore, captureArtifactVersion } from "./turnRestore.ts";
import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { PROVENANCE_LABELS, type ArtifactProvenanceEntry, type ArtifactProvenanceView, type ProvenanceEventKind, type ProvenanceLabelKind } from "./artifactProvenanceView.ts";

export { PROVENANCE_LABELS, provenanceHistoryText } from "./artifactProvenanceView.ts";
export type { ArtifactProvenanceEntry, ArtifactProvenanceView, ProvenanceEventKind, ProvenanceLabelKind } from "./artifactProvenanceView.ts";

export interface ProvenanceEvent {
  path: string;
  kind: ProvenanceEventKind;
  /** Observation or write time (ms), not the time of a manual edit. */
  at: number;
  /** Bytes the event left behind; absent for `removed`. */
  sha256?: string;
  /** The coach turn that made the change (turn-diff `ai_*` only). */
  turnId?: string;
}

export interface ProvenanceLedger {
  version: 1;
  /** Last observed state of the folder, or null before the first observation. */
  baseline: Record<string, string> | null;
  /** True when a window since `baseline` was not measured. */
  stale: boolean;
  /** Paths the last scan saw but could not hash (too large, past a cap, unreadable, a link). */
  stalePaths?: string[];
  events: ProvenanceEvent[];
}

/** Who wrote bytes through Studio itself. */
export type HostWriteActor = "ai" | "studio" | "learner_upload";

/** Events kept per folder; the oldest go first (a file whose only event went shows 기록 없음). */
export const PROVENANCE_EVENT_CAP = 2000;
/** Entries the view lists. */
export const PROVENANCE_VIEW_CAP = 100;
/** History steps shown per file. */
export const PROVENANCE_HISTORY_STEPS = 4;

export function emptyLedger(): ProvenanceLedger {
  return { version: 1, baseline: null, stale: false, stalePaths: [], events: [] };
}

interface FileHash { path: string; sha256: string }

/** CGP-KNOW-R-017: most files and bytes of history captured before one coach turn (REQ-STUDIO-ARTIFACT-HISTORY). */
export const TURN_START_HISTORY_LIMITS = { files: 25, bytes: 4 * 1024 * 1024 } as const;
/** A folder scan (`scanFolder`) or just its files. */
export type ScanLike = readonly FileHash[] | { files: readonly FileHash[]; notCovered?: readonly { path: string }[] };

const toMap = (files: readonly FileHash[]) => Object.fromEntries(files.map((f) => [f.path, f.sha256]));
const filesOf = (s: ScanLike): readonly FileHash[] => (Array.isArray(s) ? s : (s as { files: readonly FileHash[] }).files);
const uncoveredOf = (s: ScanLike): Set<string> => new Set(Array.isArray(s) ? [] : ((s as { notCovered?: readonly { path: string }[] }).notCovered ?? []).map((n) => n.path));

function capEvents(events: ProvenanceEvent[]): ProvenanceEvent[] {
  return events.length > PROVENANCE_EVENT_CAP ? events.slice(events.length - PROVENANCE_EVENT_CAP) : events;
}

/** The newest event of `p` since it last went away, or null. */
function latestLive(events: readonly ProvenanceEvent[], p: string): ProvenanceEvent | null {
  for (let i = events.length - 1; i >= 0; i--) if (events[i].path === p) return events[i].kind === "removed" ? null : events[i];
  return null;
}

/** Paths a scan could not hash become unknown; paths it hashed are known again. */
function nextStalePaths(prev: readonly string[] | undefined, files: readonly FileHash[], uncovered: Set<string>): string[] {
  const out = new Set(prev ?? []);
  for (const f of files) out.delete(f.path);
  for (const p of uncovered) out.add(p);
  return [...out].sort();
}

/**
 * An observation outside a coach turn: the scan taken just before a turn (the restore point) or
 * when the learner opens the list while nothing runs.
 */
export function observeOutsideTurn(ledger: ProvenanceLedger, scan: ScanLike, opts: { at: number }): ProvenanceLedger {
  const files = filesOf(scan);
  const uncovered = uncoveredOf(scan);
  const stalePaths = new Set(ledger.stalePaths ?? []);
  const events = [...ledger.events];
  const base = ledger.baseline;
  for (const f of files) {
    const before = base?.[f.path];
    if (before === f.sha256) continue;
    const latest = latestLive(events, f.path);
    // A recorded event (a host write, whatever its timing) left exactly these bytes.
    if (latest?.sha256 === f.sha256) continue;
    // First observation ever: what was already there has no recorded origin.
    if (!base) continue;
    // A scan only sees THAT the bytes changed, never who changed them (a learner's save is its own
    // event): a known file reads 기록 없음 from here; a new file has no event at all.
    if (before !== undefined || latest || stalePaths.has(f.path)) events.push({ path: f.path, kind: "unknown", at: opts.at, sha256: f.sha256 });
  }
  if (base) {
    const now = new Set(files.map((f) => f.path));
    // A file the scan saw but could not hash did not go away.
    for (const p of Object.keys(base)) if (!now.has(p) && !uncovered.has(p)) events.push({ path: p, kind: "removed", at: opts.at });
  }
  return { version: 1, baseline: toMap(files), stale: false, stalePaths: nextStalePaths(ledger.stalePaths, files, uncovered), events: capEvents(events) };
}

/**
 * Studio itself wrote these bytes (`writes`: posix paths relative to the folder, sha256 of what
 * was written). Recorded at once, inside or outside a turn, so a later observation finds them
 * explained instead of reading them as the learner's.
 */
export function recordHostWrite(ledger: ProvenanceLedger, writes: readonly FileHash[], opts: { at: number; actor: HostWriteActor }): ProvenanceLedger {
  const events = [...ledger.events];
  const baseline = ledger.baseline ? { ...ledger.baseline } : null;
  const stalePaths = new Set(ledger.stalePaths ?? []);
  for (const w of writes) {
    const live = latestLive(events, w.path);
    const existed = (baseline?.[w.path] !== undefined) || !!live;
    const kind: ProvenanceEventKind = opts.actor === "learner_upload" ? "learner_uploaded"
      : opts.actor === "ai" ? (existed ? "ai_changed" : "ai_created")
      : (existed ? "studio_changed" : "studio_created");
    events.push({ path: w.path, kind, at: opts.at, sha256: w.sha256 });
    if (baseline) baseline[w.path] = w.sha256;
    stalePaths.delete(w.path);
  }
  return { ...ledger, baseline, stalePaths: [...stalePaths].sort(), events: capEvents(events) };
}

/**
 * The end of a coach turn: `added` / `changed` / `deleted` from `diffRestorePoint`, `after` the
 * scan they came from, `startedAt` the restore point's time. The turn must have started from an
 * observation (`observeOutsideTurn` with the restore point); otherwise the ledger is stale and the
 * diff is not trusted.
 */
export function recordCoachTurn(ledger: ProvenanceLedger, turn: { turnId: string; at: number; startedAt: number; added: readonly string[]; changed: readonly string[]; deleted: readonly string[] }, after: ScanLike): ProvenanceLedger {
  const files = filesOf(after);
  const uncovered = uncoveredOf(after);
  if (ledger.stale || !ledger.baseline) return markUnobserved({ ...ledger, baseline: ledger.baseline ?? toMap(files), stalePaths: nextStalePaths(ledger.stalePaths, files, uncovered) });
  const hash = toMap(files);
  const events = [...ledger.events];
  const record = (p: string, kind: ProvenanceEventKind) => {
    if (!hash[p]) return;
    const latest = latestLive(events, p);
    // Studio recorded these exact bytes during this turn (a host write): that record names its writer.
    if (latest && latest.sha256 === hash[p] && latest.at >= turn.startedAt) return;
    events.push({ path: p, kind, at: turn.at, sha256: hash[p], turnId: turn.turnId });
  };
  for (const p of turn.added) record(p, "ai_created");
  for (const p of turn.changed) record(p, "ai_changed");
  for (const p of turn.deleted) if (!uncovered.has(p)) events.push({ path: p, kind: "removed", at: turn.at, turnId: turn.turnId });
  return { version: 1, baseline: hash, stale: false, stalePaths: nextStalePaths(ledger.stalePaths, files, uncovered), events: capEvents(events) };
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
export function recordRevert(ledger: ProvenanceLedger, revert: { pointAt: number; pointFiles: readonly FileHash[]; at: number }, after: ScanLike): ProvenanceLedger {
  const events = ledger.events.filter((e) => e.at <= revert.pointAt);
  return observeOutsideTurn({ version: 1, baseline: toMap(revert.pointFiles), stale: true, stalePaths: ledger.stalePaths ?? [], events }, after, { at: revert.at });
}

/** One entry per file of the last observation; newest recorded event first, then 기록 없음 by path. */
export function provenanceView(ledger: ProvenanceLedger): ArtifactProvenanceView {
  if (!ledger.baseline) return { entries: [], more: 0, unobserved: true, unconfirmed: false };
  // A window that was not measured: no current bytes can be confirmed, so no label is claimed.
  const unconfirmed = ledger.stale;
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
    // An event explains the file only if it left exactly the bytes that are there now, and only
    // when the last observation was measured.
    if (unconfirmed || !latest || latest.sha256 !== sha) {
      const history = foldHistory(list);
      entries.push({ path: p, kind: "none", ...PROVENANCE_LABELS.none, history: history.length ? [...history, PROVENANCE_LABELS.none.label].slice(-PROVENANCE_HISTORY_STEPS) : [] });
      continue;
    }
    const kind = latest.kind as ProvenanceLabelKind;
    entries.push({ path: p, kind, ...PROVENANCE_LABELS[kind], history: foldHistory(list), at: latest.at });
  }
  entries.sort((a, b) => (b.at ?? -1) - (a.at ?? -1) || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { entries: entries.slice(0, PROVENANCE_VIEW_CAP), more: Math.max(0, entries.length - PROVENANCE_VIEW_CAP), unobserved: false, unconfirmed };
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
const KINDS = new Set<ProvenanceEventKind>(["ai_created", "ai_changed", "studio_created", "studio_changed", "learner_uploaded", "unknown", "removed"]);

function validLedger(v: unknown): v is ProvenanceLedger {
  const l = v as ProvenanceLedger;
  if (!l || l.version !== 1 || typeof l.stale !== "boolean" || !Array.isArray(l.events)) return false;
  if (l.stalePaths !== undefined && (!Array.isArray(l.stalePaths) || l.stalePaths.some((p) => typeof p !== "string"))) return false;
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

interface PointLike { createdAt: number; turnId: string; files: readonly FileHash[]; notCovered?: readonly { path: string }[] }
interface TurnDiff { added: readonly string[]; changed: readonly string[]; deleted: readonly string[] }
export interface HostWrite { absPath: string; data?: Uint8Array | string }

const sha256Of = (data: Uint8Array | string) => createHash("sha256").update(data).digest("hex");

/** A posix path of `abs` under `root`, or null when it leaves the folder. */
async function relInside(root: string, abs: string): Promise<string | null> {
  let dir: string;
  try { dir = await fs.realpath(path.dirname(path.resolve(abs))); } catch { return null; }
  const rel = path.relative(root, path.join(dir, path.basename(abs)));
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join("/");
}

/**
 * What the chat host calls around a coach turn and at every host write. Every method swallows its
 * own failures: a provenance problem never stops a turn, and a write that failed leaves the ledger
 * stale. Calls are serialized in call order, so a host write recorded before a restore point is
 * taken is applied before that turn's start, and a list request cannot interleave with a turn's end.
 */
export class ArtifactProvenanceRecorder {
  private queue: Promise<unknown> = Promise.resolve();
  /** Folders touched in this session; the first touch marks the ledger stale (changes made while Studio was closed). */
  private readonly session = new Set<string>();
  private readonly hashCaches = new Map<string, Map<string, unknown>>();
  /**
   * Bumped synchronously by every call that records or invalidates something (a host write, a
   * folder replace, a learner save, a turn's start and end, an unmeasured window, a revert). A list
   * scan read before a bump may hold bytes from before that event, so it is never applied: that keeps
   * a Studio or AI label from being lost to 기록 없음 by an older scan.
   */
  private gen = 0;
  private readonly base: string;
  private readonly now: () => number;
  private readonly historyEnabled: () => boolean;
  constructor(base: string, now: () => number = Date.now, historyEnabled: () => boolean = () => false) {
    this.historyEnabled = historyEnabled;
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
    const first = !this.session.has(root);
    this.session.add(root);
    // Whatever happened to the folder before this session (Studio closed, git, other tools) was not observed.
    const next = await updateLedger(this.file(root), (l) => fn(first ? markUnobserved(l) : l));
    // A failed save may have lost an event: say so on the next successful write.
    if (!next) await updateLedger(this.file(root), markUnobserved);
    return next;
  }

  /** The current generation; read it before a list scan and pass it to `view`. */
  generation(): number { return this.gen; }

  private bump(): void { this.gen++; }

  private observe(root: string, scan: ScanLike, at: number): Promise<ProvenanceLedger | null> {
    return this.apply(root, (l) => observeOutsideTurn(l, scan, { at }));
  }

  /** A per-folder hash cache for `scanFolder({ cache })` on the list path (mtime + size + inode). */
  scanCache<T>(root: string): Map<string, T> {
    let c = this.hashCaches.get(root);
    if (!c) { c = new Map(); this.hashCaches.set(root, c); }
    return c as Map<string, T>;
  }

  /**
   * Studio wrote these files into the folder of `cwd`. Call it synchronously right after the
   * write: the bytes are hashed now when given, and the record is queued in call order.
   */
  hostWrote(cwd: string, writes: readonly HostWrite[], actor: HostWriteActor): Promise<unknown> {
    this.bump();
    const at = this.now();
    const hashed = writes.map((w) => ({ absPath: w.absPath, sha256: w.data !== undefined ? sha256Of(w.data) : undefined }));
    return this.run(async () => {
      let root: string;
      try { root = await fs.realpath(cwd); } catch { return null; }
      const out: FileHash[] = [];
      for (const w of hashed) {
        const rel = await relInside(root, w.absPath);
        if (!rel) continue;
        let sha = w.sha256;
        if (!sha) { try { sha = sha256Of(await fs.readFile(w.absPath)); } catch { continue; } }
        out.push({ path: rel, sha256: sha });
        if (this.historyEnabled()) await captureArtifactVersion(artifactHistoryStore(this.base, root, rel), root, rel, actor === "ai" ? "ai" : actor === "learner_upload" ? "learner" : "unknown", sha, this.historyEnabled).catch(() => null);
      }
      if (!out.length) return null;
      return this.apply(root, (l) => recordHostWrite(l, out, { at, actor }));
    });
  }

  /** Before a coach turn, with the restore point just taken. */
  turnStart(root: string, point: PointLike): Promise<unknown> {
    this.bump();
    return this.run(async () => {
      // Bounded: a restore point can list hundreds of files; capture at most N files / M bytes per turn start.
      let files = 0, bytes = 0;
      for (const f of point.files) {
        if (!this.historyEnabled() || files >= TURN_START_HISTORY_LIMITS.files) break;
        const size = await fs.stat(path.join(root, f.path)).then((st) => st.size, () => -1);
        if (size < 0 || bytes + size > TURN_START_HISTORY_LIMITS.bytes) continue;
        files++; bytes += size;
        await captureArtifactVersion(artifactHistoryStore(this.base, root, f.path), root, f.path, "unknown", f.sha256, this.historyEnabled).catch(() => null);
      }
      return this.observe(root, point, point.createdAt);
    });
  }

  /** After a coach turn whose start was observed; `after` is the scan the diff came from. */
  turnEnd(root: string, point: PointLike, diff: TurnDiff, after: ScanLike): Promise<ProvenanceLedger | null> {
    this.bump();
    const at = Math.max(this.now(), point.createdAt + 1);
    return this.run(async () => {
      for (const f of filesOf(after)) if (this.historyEnabled() && (diff.added.includes(f.path) || diff.changed.includes(f.path))) await captureArtifactVersion(artifactHistoryStore(this.base, root, f.path), root, f.path, "ai", f.sha256, this.historyEnabled).catch(() => null);
      return this.apply(root, (l) => recordCoachTurn(l, { turnId: point.turnId, at, startedAt: point.createdAt, ...diff }, after));
    });
  }

  /** Studio replaced files of `folder` wholesale (a GitHub pull or clone): nothing in it is confirmed until observed again. */
  folderReplaced(folder: string): Promise<unknown> {
    this.bump();
    return this.run(async () => {
      let root: string;
      try { root = await fs.realpath(folder); } catch { return null; }
      return this.apply(root, markUnobserved);
    });
  }

  /** A turn ran (or ended) without a usable measurement. */
  unobserved(root: string): Promise<unknown> {
    this.bump();
    return this.run(() => this.apply(root, markUnobserved));
  }

  /** After "되돌리기" to `point`, with a fresh scan of the folder (or null when none could be taken). */
  reverted(root: string, point: PointLike, after: ScanLike | null): Promise<unknown> {
    this.bump();
    const at = Math.max(this.now(), point.createdAt + 1);
    return this.run(() => this.apply(root, (l) => after
      ? recordRevert(l, { pointAt: point.createdAt, pointFiles: point.files, at }, after)
      : markUnobserved({ ...l, events: l.events.filter((e) => e.at <= point.createdAt) })));
  }

  /**
   * The list for the learner. With `scan` (taken while no turn runs) it is also an observation;
   * without one the ledger is only read. `scannedAt` is `generation()` read before the scan began:
   * if anything was recorded since, the scan may hold older bytes and is not applied (read only).
   */
  view(root: string, scan?: ScanLike & { complete?: boolean }, scannedAt?: number): Promise<ArtifactProvenanceView | null> {
    return this.run(async () => {
      const moved = scannedAt !== undefined && scannedAt !== this.gen;
      const usable = moved ? undefined : scan;
      // A scan that stopped at the entry cap saw only part of the folder: the window is unmeasured.
      const incomplete = !!usable && !Array.isArray(usable) && (usable as { complete?: boolean }).complete === false;
      const ledger = incomplete ? await this.apply(root, markUnobserved)
        : usable ? await this.observe(root, usable, this.now()) : await loadLedger(this.file(root));
      return ledger ? provenanceView(ledger) : null;
    });
  }
}

// --- the one host-write hook -------------------------------------------------------------------

export interface HostWriteSink {
  wrote(writes: readonly HostWrite[], actor: HostWriteActor): void;
  replaced(folder: string): void;
}
let hostWriteSink: HostWriteSink | null = null;

/** The chat host installs where host writes go (its recorder and current work folder); null removes it. */
export function setHostWriteSink(sink: HostWriteSink | null): void {
  hostWriteSink = sink;
}

/**
 * Every place Studio writes into the work folder calls this right after the write, with the
 * absolute path and, when at hand, the bytes. `ai` when the bytes are the coach's output,
 * `studio` when they are Studio's own, `learner_upload` for an attachment. Never throws.
 */
export function noteHostWrite(writes: readonly HostWrite[], actor: HostWriteActor): void {
  try { hostWriteSink?.wrote(writes, actor); } catch { /* provenance never breaks a write */ }
}

/**
 * Studio brought a whole folder up to another copy (a GitHub pull, a clone into a registered
 * folder) without knowing file by file what changed: its files read 기록 없음 until observed again.
 */
export function noteFolderReplaced(folder: string): void {
  try { hostWriteSink?.replaced(folder); } catch { /* provenance never breaks a write */ }
}
