// studio-funnel-events — App-side funnel events for the open trial (design
// docs/design/open-trial-conversion.md §8.1, diagnosis fix card studio-funnel-events).
//
// Why not /v1/trace/event: that route sits behind the active-class session and roster gate,
// and a trial grant has no cohort session, so it answers 403 `session_inactive`. Funnel events
// go to the grant-scoped route the Service owns (hypeproof-service fix card ot-funnel-events,
// worker/src/routes/trial-events.ts + lib/trial-funnel.ts). The Service keys rows by a keyed
// hash of the grant or account id. The App never sends an id, a name, a path or message text.
//
// Wire contract (must match the Service exactly; locked by test/funnel-events.smoke.mjs against
// test/fixtures/service-contracts/trial-funnel.json, captured from the Service parser):
//   Discovery  GET  <Service origin>/v1/trial/events
//              200 { schema: "hps-trial-funnel/1", events: [<type>, ...] } → on
//              anything else (404 while the Service flag HPS_OPEN_TRIAL is off) → off
//   Send       POST <Service origin>/v1/trial/events
//              authorization: Bearer <native trial grant token>
//              body: { "type": <type>, "fields": { ...allowed fields } }   (no other top-level key)
//
// Default off: nothing is probed for a seat whose token is not a native trial grant, and
// nothing is sent unless the probe answers with the expected schema. Only types the Service
// lists are sent. Pure, no `vscode`: the host (chatPanelProvider.ts / startPage.ts) supplies I/O.

export const TRACE_EVENT_ROUTE = "/v1/trace/event";
export const TRIAL_EVENTS_ROUTE = "/v1/trial/events";
export const TRIAL_FUNNEL_SCHEMA = "hps-trial-funnel/1";

export const ENTRY_OUTCOMES = ["granted", "reused", "signed_in"] as const;
export const TOOL_RESULT_KINDS = ["write", "edit", "preview", "publish"] as const;
export const OFFER_SURFACES = ["end_card", "start_page"] as const;
export const FUNNEL_OS = ["darwin", "win32", "linux"] as const;
/** Same bound as the Service (`VERSION_RE` in lib/trial-funnel.ts). */
export const APP_VERSION_RE = /^\d{1,3}\.\d{1,3}\.\d{1,5}(?:-[0-9A-Za-z.]{1,16})?$/;

export type EntryOutcome = (typeof ENTRY_OUTCOMES)[number];
export type ToolResultKind = (typeof TOOL_RESULT_KINDS)[number];
export type OfferSurface = (typeof OFFER_SURFACES)[number];
export type FunnelOs = (typeof FUNNEL_OS)[number];

export type FunnelEvent =
  | { type: "trial_entry"; fields: { outcome: EntryOutcome; app_version?: string; os?: FunnelOs } }
  | { type: "trial_tool_result"; fields: { kind: ToolResultKind; ok: boolean } }
  | { type: "offer_viewed" | "offer_clicked" | "offer_dismissed"; fields: { surface: OfferSurface } };

export type FunnelEventType = FunnelEvent["type"];

/** Every field a type may carry. Anything else in the input is dropped, never forwarded. */
export const FUNNEL_EVENT_FIELDS: Record<FunnelEventType, readonly string[]> = {
  trial_entry: ["outcome", "app_version", "os"],
  trial_tool_result: ["kind", "ok"],
  offer_viewed: ["surface"],
  offer_clicked: ["surface"],
  offer_dismissed: ["surface"],
};

const oneOf = <T extends string>(list: readonly T[], v: unknown): v is T => typeof v === "string" && (list as readonly string[]).includes(v);

/**
 * Validates and whitelists one event into the Service body `{type, fields}`.
 * Input is flat (`{type, ...fields}`) so callers cannot smuggle extra top-level keys.
 * Unknown types, missing or out-of-range values → null. An optional field with a bad value is dropped.
 */
export function buildFunnelEvent(input: unknown): FunnelEvent | null {
  if (!input || typeof input !== "object") return null;
  const o = input as Record<string, unknown>;
  switch (o.type) {
    case "trial_entry": {
      if (!oneOf(ENTRY_OUTCOMES, o.outcome)) return null;
      const fields: { outcome: EntryOutcome; app_version?: string; os?: FunnelOs } = { outcome: o.outcome };
      if (typeof o.app_version === "string" && APP_VERSION_RE.test(o.app_version)) fields.app_version = o.app_version;
      if (oneOf(FUNNEL_OS, o.os)) fields.os = o.os;
      return { type: "trial_entry", fields };
    }
    case "trial_tool_result":
      return oneOf(TOOL_RESULT_KINDS, o.kind) && typeof o.ok === "boolean" ? { type: o.type, fields: { kind: o.kind, ok: o.ok } } : null;
    case "offer_viewed":
    case "offer_clicked":
    case "offer_dismissed":
      return oneOf(OFFER_SURFACES, o.surface) ? { type: o.type, fields: { surface: o.surface } } : null;
    default:
      return null;
  }
}

/** `process.platform` as the Service enum, or undefined (the field is optional). */
export function funnelOs(platform: string): FunnelOs | undefined {
  return oneOf(FUNNEL_OS, platform) ? platform : undefined;
}

/** The funnel kind of an SDK tool call, or null when the call is not a result the funnel counts. */
export function funnelToolKind(name: string): ToolResultKind | null {
  if (name === "Write") return "write";
  if (name === "Edit" || name === "MultiEdit") return "edit";
  const bare = name.replace(/^mcp__.+?__/, "");
  if (bare === "live_preview_start") return "preview";
  if (bare === "publish_site") return "publish";
  return null;
}

/** Only a native trial grant token may write to the grant-scoped route (cohort seats get 403). */
export function isTrialGrantToken(payload: Record<string, unknown> | null | undefined): boolean {
  return payload?.native_trial === true;
}

/**
 * Entry outcome as the App saw it: a personal-account credential is `signed_in`; a grant that was
 * already stored when this process started is `reused`; one stored during this process is `granted`.
 */
export function entryOutcome(o: { account: boolean; token: string; startupToken: string | null | undefined }): EntryOutcome {
  if (o.account) return "signed_in";
  return o.startupToken === o.token ? "reused" : "granted";
}

/** `proxyUrl` is the configured Service base (…/v1); the route is absolute from the Service root. */
export function trialEventsUrl(proxyUrl: string): string {
  return proxyUrl.replace(/\/+$/, "").replace(/\/v1$/, "") + TRIAL_EVENTS_ROUTE;
}

/** Parses the discovery answer. Wrong status, schema or shape → null (off). */
export function parseTrialEventsProbe(status: number, body: unknown): { events: FunnelEventType[] } | null {
  if (status !== 200 || !body || typeof body !== "object") return null;
  const b = body as { schema?: unknown; events?: unknown };
  if (b.schema !== TRIAL_FUNNEL_SCHEMA || !Array.isArray(b.events)) return null;
  const known = Object.keys(FUNNEL_EVENT_FIELDS) as FunnelEventType[];
  return { events: known.filter((t) => (b.events as unknown[]).includes(t)) };
}

/**
 * Whether this seat may post liveness to the session-only /v1/trace/event. A trial grant whose
 * funnel route is on does not: the trace route refuses it, and the heartbeat would retry a 403
 * for the life of the seat. With the Service flag off nothing changes.
 */
export function usesTraceRoute(funnelOn: boolean, tokenPayload: Record<string, unknown> | null | undefined): boolean {
  return !(funnelOn && isTrialGrantToken(tokenPayload));
}

/** Events reported once per grant (entry, first view, first result per kind/outcome). */
function dedupeKey(ev: FunnelEvent): string | null {
  if (ev.type === "trial_entry") return ev.type;
  if (ev.type === "trial_tool_result") return `${ev.type}:${ev.fields.kind}:${ev.fields.ok}`;
  if (ev.type === "offer_viewed") return `${ev.type}:${ev.fields.surface}`;
  return null;
}

export interface FunnelTarget { url: string; token: string; events: readonly FunnelEventType[] }
export interface FunnelReporterDeps {
  /** One POST of `body` as JSON. May throw; the reporter swallows it. Returns the HTTP status. */
  send(url: string, token: string, body: FunnelEvent): Promise<number>;
  maxQueue?: number;
  log?(line: string): void;
}

/**
 * Fire-and-forget sender. Telemetry must never interrupt a learner, so nothing here throws.
 *   setTarget(undefined)  — not known yet (no grant, or probe pending): events wait in a small memory queue.
 *   setTarget(null)       — not a trial grant, or the Service route is off: queue dropped, nothing sent.
 *   setTarget({url,token,events}) — queue flushed, later events sent directly; types the Service
 *                           does not list are dropped.
 * The queue exists because the start page (offer views and clicks) is drawn before a grant exists.
 */
export class FunnelReporter {
  private target: FunnelTarget | null | undefined = undefined;
  private queue: FunnelEvent[] = [];
  private readonly seen = new Set<string>();
  private readonly maxQueue: number;
  private readonly deps: FunnelReporterDeps;

  constructor(deps: FunnelReporterDeps) {
    this.deps = deps;
    this.maxQueue = deps.maxQueue ?? 16;
  }

  get queued(): number {
    return this.queue.length;
  }

  get active(): boolean {
    return !!this.target;
  }

  setTarget(target: FunnelTarget | null | undefined): void {
    if (target && this.target && target.token !== this.target.token) this.seen.clear();
    this.target = target;
    if (target === null) { this.queue = []; return; }
    if (!target) return;
    const pending = this.queue;
    this.queue = [];
    for (const ev of pending) this.deliver(target, ev);
  }

  emit(input: unknown): void {
    const ev = buildFunnelEvent(input);
    if (!ev || this.target === null) return;
    if (this.target) { this.deliver(this.target, ev); return; }
    // Once-per-grant events are deduplicated here too: the start page re-emits offer_viewed on
    // every refresh, and undeduplicated copies would fill the bounded queue and push out the
    // offer_clicked this queue exists to keep.
    const d = dedupeKey(ev);
    if (d && this.queue.some((q) => dedupeKey(q) === d)) return;
    if (this.queue.length < this.maxQueue) this.queue.push(ev);
  }

  private deliver(target: FunnelTarget, ev: FunnelEvent): void {
    if (!target.events.includes(ev.type)) return;
    const d = dedupeKey(ev);
    if (d) {
      if (this.seen.has(d)) return;
      this.seen.add(d);
    }
    void Promise.resolve()
      .then(() => this.deps.send(target.url, target.token, ev))
      .then((status) => { if (status < 200 || status >= 300) this.deps.log?.(`[funnel] ${ev.type} → ${status}`); })
      .catch(() => this.deps.log?.(`[funnel] ${ev.type} not sent`));
  }
}
