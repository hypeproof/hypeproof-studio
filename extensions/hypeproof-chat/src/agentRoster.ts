// The front-line orchestrator's roster, as the Service serves it (ADR 0011 §1; spec §2.2).
// Pure and vscode-free.
//
// `GET /v1/profile` carries `orchestrator` only for an app that declared
// `x-hps-orchestrator: hps-agent-roster/1`, only for an adult agent-sdk seat that is not
// under a frozen lesson, and only while the cohort's flag is on. Otherwise the key is
// absent, or `{ enabled: false, reason }`. Prompts and output contracts stay in the
// Service; the app receives names, Korean titles, purposes, triggers, declared context
// keys, caps and model labels.
//
// This parser is the app's load-time check of that value. It fails closed:
// - a value that is not a well-formed roster is no roster, with a reason for the log;
// - the fields that decide what leaves the machine or what the coach may do (names,
//   roles, triggers, declared context, caps, `enabled`) must be exactly right, or the
//   whole roster is refused. Nothing is guessed or repaired there;
// - display copy (titles, purposes, the coach brief, model labels) is clipped and
//   cleaned instead, so a long string cannot make the orchestrator inert;
// - unknown check names are dropped (a check this build does not know is not run), and
//   unknown keys are ignored.
//
// Minors are not decided here: orchestratorBindingFor (sdkCoachHelpers.ts) strips the
// roster for minor and unknown tiers whatever this parser says, and so does
// resolveOrchestrator (orchestratorSurfaces.ts).

import { ORCHESTRATOR_FORMAT } from "./sdkCoachHelpers.ts";

export type AgentRole = "coach" | "helper" | "advisor" | "aux";
export type AgentTrigger = "learner" | "coach_consult" | "deterministic_failure" | "cli_background";
/** The only context blocks the host may attach to a helper run (spec §2.1, §3.2). */
export type HostContextKey =
  | "file_excerpt"
  | "site_outline"
  | "site_check"
  | "diff_summary"
  | "failure_evidence"
  | "learner_goal"
  | "lesson_step";
export type RosterCheck = "site_check" | "diff_guard" | "archive_before_overwrite";

export const AGENT_ROLES: readonly AgentRole[] = ["coach", "helper", "advisor", "aux"];
export const AGENT_TRIGGERS: readonly AgentTrigger[] = ["learner", "coach_consult", "deterministic_failure", "cli_background"];
export const HOST_CONTEXT_KEYS: readonly HostContextKey[] = [
  "file_excerpt",
  "site_outline",
  "site_check",
  "diff_summary",
  "failure_evidence",
  "learner_goal",
  "lesson_step",
];
export const ROSTER_CHECKS: readonly RosterCheck[] = ["site_check", "diff_guard", "archive_before_overwrite"];

export interface ServedAgent {
  /** Wire id: the route parameter of `POST /v1/agents/:agent/run`. */
  name: string;
  /** Korean product copy shown to the learner, e.g. 검토 도우미. */
  title: string;
  role: AgentRole;
  /** One line; feeds the consult tool description. Empty when not served. */
  purpose: string;
  /** Null for the coach and aux entries when not served. */
  trigger: AgentTrigger | null;
  /** The only context blocks the host attaches for this agent. */
  context: HostContextKey[];
  caps: { per_turn: number; per_session: number };
  enabled: boolean;
  /** The model the Service resolves for the agent, for the timeline label; null when not served. */
  model: { id: string; label: string } | null;
}

export interface ServedRoster {
  format: typeof ORCHESTRATOR_FORMAT;
  id: string;
  version: string;
  /** Informational: `sha256:<hex>` of the canonical roster JSON, recorded but never recomputed here. */
  digest: string | null;
  /** Korean; rendered into the consult tool description. */
  coach_brief: string;
  checks: RosterCheck[];
  agents: ServedAgent[];
}

export type RosterParse = { ok: true; roster: ServedRoster } | { ok: false; reason: string };

// The roster identity goes into header values (`x-hps-roster: <id>@<version>`), so these
// are the same patterns orchestratorBindingFor applies (sdkCoachHelpers.ts). A test locks
// that the two agree.
const ROSTER_ID = /^[a-z][a-z0-9-]{0,39}$/;
const ROSTER_VERSION = /^\d{1,6}\.\d{1,6}\.\d{1,6}(?:-[0-9A-Za-z.-]{1,32})?$/;
/** Agent names go into a URL path and a header: spec §2.1 `/^[a-z][a-z0-9-]{1,39}$/`. */
const AGENT_NAME = /^[a-z][a-z0-9-]{1,39}$/;
/** A catalogue model id, for the label only; never sent anywhere by the app. */
const MODEL_ID = /^[a-z0-9][a-z0-9._-]{0,79}$/i;
const DIGEST = /^sha256:[0-9a-f]{1,64}$/;

export const ROSTER_AGENTS_MAX = 12;
export const AGENT_CAP_MAX = 100;
export const TITLE_MAX = 40;
export const PURPOSE_MAX = 200;
export const COACH_BRIEF_MAX = 2000;
export const MODEL_LABEL_MAX = 60;

/** Display copy: control characters out, whitespace collapsed, clipped. */
function copy(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  // eslint-disable-next-line no-control-regex
  const clean = value.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, " ").replace(/\s+/g, " ").trim();
  return clean.length > max ? clean.slice(0, max).trimEnd() : clean;
}

/** Multi-line display copy (the coach brief): control characters out except newlines, clipped. */
function brief(value: unknown): string {
  if (typeof value !== "string") return "";
  const clean = value
    .replace(/\r\n?/g, "\n")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u2028\u2029]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return clean.length > COACH_BRIEF_MAX ? clean.slice(0, COACH_BRIEF_MAX).trimEnd() : clean;
}

function isCap(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= AGENT_CAP_MAX;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

/** One served agent, or the reason it cannot be one. */
function parseAgent(raw: unknown, index: number): { ok: true; agent: ServedAgent } | { ok: false; reason: string } {
  const at = `agents[${index}]`;
  if (!isPlainObject(raw)) return { ok: false, reason: `${at} is not an object` };
  const name = raw.name;
  if (typeof name !== "string" || !AGENT_NAME.test(name)) return { ok: false, reason: `${at}.name is not a wire id` };
  const role = raw.role;
  if (typeof role !== "string" || !(AGENT_ROLES as readonly string[]).includes(role)) {
    return { ok: false, reason: `${at} (${name}) has an unknown role` };
  }
  const title = copy(raw.title, TITLE_MAX) || name;
  const purpose = copy(raw.purpose, PURPOSE_MAX);

  let trigger: AgentTrigger | null = null;
  if (raw.trigger !== undefined) {
    if (typeof raw.trigger !== "string" || !(AGENT_TRIGGERS as readonly string[]).includes(raw.trigger)) {
      return { ok: false, reason: `${at} (${name}) has an unknown trigger` };
    }
    trigger = raw.trigger as AgentTrigger;
  }

  const context: HostContextKey[] = [];
  if (raw.context !== undefined) {
    if (!Array.isArray(raw.context)) return { ok: false, reason: `${at} (${name}).context is not a list` };
    for (const key of raw.context) {
      if (typeof key !== "string" || !(HOST_CONTEXT_KEYS as readonly string[]).includes(key)) {
        // A context block this build cannot assemble: refusing is safer than sending less
        // than the contract asks or guessing what the key means.
        return { ok: false, reason: `${at} (${name}) declares an unknown context key` };
      }
      if (!context.includes(key as HostContextKey)) context.push(key as HostContextKey);
    }
  }

  let caps = { per_turn: 0, per_session: 0 };
  if (raw.caps !== undefined) {
    if (!isPlainObject(raw.caps) || !isCap(raw.caps.per_turn) || !isCap(raw.caps.per_session)) {
      return { ok: false, reason: `${at} (${name}).caps are not counts` };
    }
    caps = { per_turn: raw.caps.per_turn, per_session: raw.caps.per_session };
  }

  if (raw.enabled !== undefined && typeof raw.enabled !== "boolean") {
    return { ok: false, reason: `${at} (${name}).enabled is not a boolean` };
  }
  const enabled = raw.enabled === true;

  let model: ServedAgent["model"] = null;
  if (isPlainObject(raw.model) && typeof raw.model.id === "string" && MODEL_ID.test(raw.model.id)) {
    model = { id: raw.model.id, label: copy(raw.model.label, MODEL_LABEL_MAX) || raw.model.id };
  }

  // Helpers and the advisor are what consult reaches: their trigger and caps must be served.
  if (role === "helper" || role === "advisor") {
    if (trigger !== "coach_consult" && trigger !== "deterministic_failure") {
      return { ok: false, reason: `${at} (${name}): a ${role} needs a coach_consult or deterministic_failure trigger` };
    }
    // Spec §7 and harness `advisor_trigger_not_deterministic`: the advisor runs only after a
    // recorded deterministic failure.
    if (role === "advisor" && trigger !== "deterministic_failure") {
      return { ok: false, reason: `${at} (${name}): the advisor must be triggered by a deterministic failure` };
    }
    if (raw.caps === undefined) return { ok: false, reason: `${at} (${name}): a ${role} needs caps` };
  }
  if (role === "coach" && name !== "coach") return { ok: false, reason: `${at}: the coach must be named coach` };

  return { ok: true, agent: { name, title, role: role as AgentRole, purpose, trigger, context, caps, enabled, model } };
}

/**
 * The served `orchestrator` value → a roster, or the reason there is none. `raw` is the
 * profile's `orchestrator` field as received; absent, null and the disabled form
 * (`{ enabled: false, reason }`) are not rosters.
 */
export function parseServedRoster(raw: unknown): RosterParse {
  if (raw === undefined || raw === null) return { ok: false, reason: "absent" };
  if (!isPlainObject(raw)) return { ok: false, reason: "not an object" };
  if (raw.enabled === false) {
    const why = typeof raw.reason === "string" ? copy(raw.reason, 60) : "";
    return { ok: false, reason: why ? `served off: ${why}` : "served off" };
  }
  if (raw.format !== ORCHESTRATOR_FORMAT) return { ok: false, reason: "unknown format" };
  if (typeof raw.id !== "string" || !ROSTER_ID.test(raw.id)) return { ok: false, reason: "roster id is not header-safe" };
  if (typeof raw.version !== "string" || !ROSTER_VERSION.test(raw.version)) return { ok: false, reason: "roster version is not semver" };
  if (!Array.isArray(raw.agents)) return { ok: false, reason: "agents is not a list" };
  if (raw.agents.length === 0 || raw.agents.length > ROSTER_AGENTS_MAX) return { ok: false, reason: "agents count out of range" };

  const agents: ServedAgent[] = [];
  for (let i = 0; i < raw.agents.length; i++) {
    const parsed = parseAgent(raw.agents[i], i);
    if (!parsed.ok) return { ok: false, reason: parsed.reason };
    if (agents.some((a) => a.name === parsed.agent.name)) return { ok: false, reason: `duplicate agent ${parsed.agent.name}` };
    agents.push(parsed.agent);
  }
  const coaches = agents.filter((a) => a.role === "coach");
  if (coaches.length !== 1) return { ok: false, reason: "exactly one coach is required" };
  if (agents.filter((a) => a.role === "aux").length > 1) return { ok: false, reason: "at most one aux is allowed" };

  const checks: RosterCheck[] = [];
  if (raw.checks !== undefined) {
    if (!Array.isArray(raw.checks)) return { ok: false, reason: "checks is not a list" };
    for (const c of raw.checks) {
      if (typeof c === "string" && (ROSTER_CHECKS as readonly string[]).includes(c) && !checks.includes(c as RosterCheck)) {
        checks.push(c as RosterCheck);
      }
    }
  }

  const digest = typeof raw.digest === "string" && DIGEST.test(raw.digest) ? raw.digest : null;
  return {
    ok: true,
    roster: {
      format: ORCHESTRATOR_FORMAT,
      id: raw.id,
      version: raw.version,
      digest,
      coach_brief: brief(raw.coach_brief),
      checks,
      agents,
    },
  };
}

/** `<id>@<version>`: the `x-hps-roster` value and the session key part. */
export function rosterKey(roster: Pick<ServedRoster, "id" | "version">): string {
  return `${roster.id}@${roster.version}`;
}

/**
 * The agents consult can reach: enabled helpers and advisors with a cap above zero, in
 * served order. The coach and aux are never consultable. Same rule as A2's `consult`
 * grant (orchestratorBindingFor), plus the caps, which A2 does not read.
 */
export function consultableAgents(roster: Pick<ServedRoster, "agents">): ServedAgent[] {
  return roster.agents.filter(
    (a) => (a.role === "helper" || a.role === "advisor") && a.enabled && a.caps.per_turn > 0 && a.caps.per_session > 0,
  );
}

/** The served agent by wire name, or undefined. */
export function rosterAgent(roster: Pick<ServedRoster, "agents">, name: string): ServedAgent | undefined {
  return roster.agents.find((a) => a.name === name);
}

/** `검토 도우미 · Claude Haiku 5.5`, or the title alone without a served model. */
export function agentLabel(agent: Pick<ServedAgent, "title" | "model">): string {
  return agent.model?.label ? `${agent.title} · ${agent.model.label}` : agent.title;
}
