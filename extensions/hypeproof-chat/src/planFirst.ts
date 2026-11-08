// CGP-CHAT-R-004 / CGP-CHAT-D-004 — "먼저 계획 보기".
//
// With the mode on, the coach answers a message with a short plan and runs nothing: no file write, shell,
// browser, publish, remember, or any other tool. The learner reads the plan, may edit it, and only the
// "이대로 진행" press lets the next turn use tools, under the same profile grants and approval modals as any
// other turn. The refusal is enforced here on the host, per turn, on every runtime that runs tools
// (Agent SDK canUseTool, the local CLI tool server, the proxy browser loop). A prompt line asks the model to
// write the plan, but the prompt is never what stops a tool.
//
// The mode can only make a turn stricter. It never grants a tool, never widens an approval preset and never
// replaces an approval modal: an approved turn is an ordinary turn.
//
// Pure module (no VS Code): the state machine and the gate are unit tested in test/plan-first.test.mjs.

/** What the host does with one turn. `approved` is an ordinary turn that consumed a learner approval. */
export type PlanFirstTurn = 'off' | 'planning' | 'approved';

export const PLAN_FIRST_REFUSAL =
  '먼저 계획을 보여 드려요. 계획을 확인하고 "이대로 진행"을 누르기 전에는 파일, 명령, 브라우저, 게시, 기억 저장을 실행하지 않아요. 번호 붙인 계획만 말씀해 주세요.';

/** Present only on a planning turn: every runtime asks it before any tool runs. */
export interface PlanFirstGate {
  /** The text that goes back to the model in place of the tool's result. */
  refusal(toolName?: string): string;
}
export const PLANNING_GATE: PlanFirstGate = Object.freeze({ refusal: () => PLAN_FIRST_REFUSAL });

/** The tool result a refused call returns on the proxy browser loop (same shape as BrowserControl.execute). */
export function planFirstToolResult(gate: PlanFirstGate, toolName?: string): { isError: true; content: [{ type: 'text'; text: string }] } {
  return { isError: true, content: [{ type: 'text', text: gate.refusal(toolName) }] };
}

/**
 * The model-facing line for a planning turn. Host guidance only: the Service may serve better plan wording later
 * (follow-up), and nothing here is a grant.
 */
export function planFirstTurnText(text: string): string {
  return `${text}\n\n[이번 요청: 먼저 계획 보기]\n지금은 도구를 쓰지 말고, 하려는 일을 번호 붙인 짧은 단계(최대 7개)로만 알려 주세요. 학습자가 계획을 확인하고 "이대로 진행"을 누른 뒤에야 파일, 명령, 브라우저를 쓸 수 있어요. 이미 만들었거나 고친 것처럼 말하지 마세요.`;
}

/** SDK permitted sets for a planning turn: nothing is advertised, nothing is registered. */
export function withoutTools<T extends { permittedTools: string[]; permittedMcpTools: string[]; permittedAgentTools: string[]; orchestrator?: unknown }>(agent: T): T {
  return { ...agent, permittedTools: [], permittedMcpTools: [], permittedAgentTools: [], orchestrator: undefined };
}

export const PLAN_TEXT_MAX = 6000;
const TASKS_MAX = 50;

export interface PlanFirstView {
  on: boolean;
  /** The plan waiting for the learner, or null. */
  plan: { id: string; text: string } | null;
}
export interface ApprovedPlan {
  planId: string;
  /** 1 for the plan as the coach wrote it; 2 when the learner edited it before approving. */
  revision: number;
  text: string;
  edited: boolean;
  at: number;
}
export interface PlanFirstSnapshot {
  on: Record<string, true>;
  approved: Record<string, ApprovedPlan>;
}
export interface PlanFirstTurnHandle {
  mode: PlanFirstTurn;
  /** Defined only on a planning turn. */
  gate?: PlanFirstGate;
  /** The planning turn finished with this answer: it becomes the plan awaiting approval. Null when it no longer applies. */
  ready(answer: string): PlanFirstView | null;
}
export type PlanFirstAction =
  | { ok: true; sendText: string; view: PlanFirstView }
  | { ok: false; reason: 'no_plan' | 'empty' | 'too_long' };

const keyOf = (task: string | null | undefined): string => task || '-';
const clean = (text: unknown): string => (typeof text === 'string' ? text.replace(/\r\n?/g, '\n').trim() : '');

export class PlanFirstSession {
  private readonly on = new Set<string>();
  private readonly plans = new Map<string, { id: string; text: string }>();
  private readonly approvedPlans = new Map<string, ApprovedPlan>();
  private readonly tokens = new Map<string, string>();
  private readonly serial = new Map<string, number>();
  private counter = 0;

  private readonly options: { newId?: () => string; now?: () => number; onChange?: (snapshot: PlanFirstSnapshot) => void; restore?: Partial<PlanFirstSnapshot> | null };

  constructor(options: { newId?: () => string; now?: () => number; onChange?: (snapshot: PlanFirstSnapshot) => void; restore?: Partial<PlanFirstSnapshot> | null } = {}) {
    this.options = options;
    for (const key of Object.keys(options.restore?.on ?? {}).slice(0, TASKS_MAX)) this.on.add(key);
    for (const [key, value] of Object.entries(options.restore?.approved ?? {}).slice(0, TASKS_MAX)) {
      if (value && typeof value.text === 'string' && typeof value.planId === 'string') this.approvedPlans.set(key, value);
    }
  }

  private id(): string { return this.options.newId ? this.options.newId() : `plan-${++this.counter}`; }
  private changed(): void {
    const on: Record<string, true> = {};
    for (const key of [...this.on].slice(-TASKS_MAX)) on[key] = true;
    this.options.onChange?.({ on, approved: Object.fromEntries([...this.approvedPlans].slice(-TASKS_MAX)) });
  }

  view(task: string | null | undefined): PlanFirstView {
    const key = keyOf(task);
    const plan = this.plans.get(key);
    return { on: this.on.has(key), plan: plan ? { ...plan } : null };
  }

  /** The last plan the learner approved in this task (kept with the task as evidence of their judgment). */
  approvedFor(task: string | null | undefined): ApprovedPlan | null {
    return this.approvedPlans.get(keyOf(task)) ?? null;
  }

  setOn(task: string | null | undefined, on: boolean): PlanFirstView {
    const key = keyOf(task);
    if (on) this.on.add(key);
    else {
      this.on.delete(key);
      this.plans.delete(key);
      this.tokens.delete(key);
    }
    this.bump(key);
    this.changed();
    return this.view(task);
  }

  private bump(key: string): number {
    const next = (this.serial.get(key) ?? 0) + 1;
    this.serial.set(key, next);
    return next;
  }

  /**
   * Called once at the start of every turn, before any await. With the mode off the turn is untouched. With it on,
   * the turn is a planning turn unless it is exactly the send an approval minted (single use, text bound).
   * A pending plan is superseded by any new turn: the learner asked for something else.
   */
  beginTurn(task: string | null | undefined, text: string): PlanFirstTurnHandle {
    const key = keyOf(task);
    const token = this.tokens.get(key);
    this.tokens.delete(key);
    const mine = this.bump(key);
    if (!this.on.has(key)) return { mode: 'off', ready: () => null };
    this.plans.delete(key);
    if (token !== undefined && token === text) return { mode: 'approved', ready: () => null };
    return {
      mode: 'planning',
      gate: PLANNING_GATE,
      ready: (answer: string) => {
        const plan = clean(answer);
        if (!plan || this.serial.get(key) !== mine || !this.on.has(key)) return null;
        this.plans.set(key, { id: this.id(), text: plan.slice(0, PLAN_TEXT_MAX) });
        return this.view(task);
      },
    };
  }

  /** The learner pressed "이대로 진행" (with or without edits). Mints a one-time approval for exactly the returned send. */
  approve(task: string | null | undefined, planId: string, text: unknown): PlanFirstAction {
    const key = keyOf(task);
    const plan = this.plans.get(key);
    if (!plan || plan.id !== planId || !this.on.has(key)) return { ok: false, reason: 'no_plan' };
    const body = clean(text);
    if (!body) return { ok: false, reason: 'empty' };
    if (body.length > PLAN_TEXT_MAX) return { ok: false, reason: 'too_long' };
    const edited = body !== plan.text;
    const sendText = `계획대로 진행해 주세요.\n\n${body}`;
    this.approvedPlans.set(key, { planId, revision: edited ? 2 : 1, text: body, edited, at: (this.options.now ?? Date.now)() });
    this.plans.delete(key);
    this.tokens.set(key, sendText);
    this.changed();
    return { ok: true, sendText, view: this.view(task) };
  }

  /** "다시 계획": the plan is dropped and the next turn is another planning turn. An edit is passed along as direction. */
  redo(task: string | null | undefined, planId: string, text: unknown): PlanFirstAction {
    const key = keyOf(task);
    const plan = this.plans.get(key);
    if (!plan || plan.id !== planId || !this.on.has(key)) return { ok: false, reason: 'no_plan' };
    const body = clean(text).slice(0, PLAN_TEXT_MAX);
    this.plans.delete(key);
    return { ok: true, sendText: body && body !== plan.text ? `계획을 다시 세워 주세요.\n\n제가 고친 방향:\n${body}` : '계획을 다시 세워 주세요.', view: this.view(task) };
  }

  /** "그만두기": nothing runs and nothing is sent. The mode stays on for the next message. */
  decline(task: string | null | undefined, planId: string): PlanFirstView {
    const key = keyOf(task);
    if (this.plans.get(key)?.id === planId) this.plans.delete(key);
    return this.view(task);
  }
}
