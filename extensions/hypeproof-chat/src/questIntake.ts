// REQ-QUEST-INTAKE-* (#4283) — from a stated work intent to a quest.
//
// The learner states a goal in a new task. The coach asks at most `maxQuestions` key questions (one per turn, with
// numbered suggested answers that ReplyChoices draws), then states the understood goal on a "목표 정리:" line. The
// host turns that line into a card with a "퀘스트 생성하기" button. The click makes ONE structured call that returns
// ordered steps; the host validates them into the existing quest graph (automationQuest.ts) and owns every status
// change after that: only the learner's check on the quest card completes a step.
//
// The cap is enforced here, not by the prompt: a reply on a turn that had no question left always ends in the offer,
// with a summary the host composes when the coach did not write one.
//
// Pure module (no VS Code): the state machine and the parsing are unit tested in test/quest-intake.test.mjs.
import { createQuest, transitionQuest, type AutomationQuestSnapshot, type AutomationQuestStatus } from './automationQuest.ts';
import { extractJsonObject } from './skillView.ts';

export const QUEST_CREATE_LABEL = '퀘스트 생성하기';
export const DEFAULT_MAX_QUESTIONS = 2;
const MAX_QUESTIONS_CEILING = 3;
const TASKS_MAX = 50;
const SUMMARY_MAX = 200;
const INTENT_MAX = 400;
const ANSWER_MAX = 200;

export interface QuestIntakePolicy { enabled: boolean; maxQuestions: number }

/**
 * The served policy (`ux.quest_intake`), with defaults. Absent means on with two questions, so an older Service keeps
 * working. Only an explicit `enabled: false` turns it off; `max_questions` is clamped to 0..3.
 */
export function questIntakePolicy(profile: { ux?: { quest_intake?: unknown } } | null | undefined): QuestIntakePolicy {
  const raw = profile?.ux?.quest_intake;
  const field = raw && typeof raw === 'object' ? raw as { enabled?: unknown; max_questions?: unknown } : {};
  const max = typeof field.max_questions === 'number' && Number.isInteger(field.max_questions)
    ? Math.max(0, Math.min(MAX_QUESTIONS_CEILING, field.max_questions)) : DEFAULT_MAX_QUESTIONS;
  return { enabled: field.enabled !== false, maxQuestions: max };
}

export type QuestIntakePhase = 'clarifying' | 'offered' | 'generating' | 'quest' | 'off';

interface TaskIntake {
  phase: QuestIntakePhase;
  intent: string;
  answers: string[];
  questions: number;
  max: number;
  /** Questions left when the latest coach turn started: 0 means that reply must end in the offer. */
  remaining: number;
  /** The latest reply was counted as a question: a retry of it gives that question back. */
  counted?: boolean;
  summary?: string;
  offerId?: string;
  error?: string;
  quest?: AutomationQuestSnapshot;
}

export interface QuestIntakeSnapshot { tasks: Record<string, TaskIntake> }

export interface QuestStepView { id: string; label: string; description?: string; status: AutomationQuestStatus }
export interface QuestIntakeView {
  phase: Exclude<QuestIntakePhase, 'off'> | null;
  offerId?: string;
  summary?: string;
  error?: string;
  quest?: { title: string; revision: number; steps: QuestStepView[] };
  /** Posted once, right after the quest is made: the webview sends it as the learner's own message. */
  start?: { id: string; text: string };
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();

/** The coach's "목표 정리: …" line (bold or plain), or null. The last one wins. */
export function parseGoalSummary(answer: string): string | null {
  const matches = [...answer.matchAll(/^[ \t>*_-]*(?:\*\*|__)?목표\s*정리(?:\*\*|__)?\s*[:：]\s*(?:\*\*|__)?\s*(.+?)\s*(?:\*\*|__)?\s*$/gm)];
  const value = matches.at(-1)?.[1];
  const text = value ? oneLine(value.replace(/\*\*|__/g, '')) : '';
  return text ? clip(text, SUMMARY_MAX) : null;
}

/** A reply that asks the learner something: numbered options, or a last line ending in a question mark. */
export function looksLikeQuestion(answer: string): boolean {
  const lines = answer.split('\n').map(line => line.trim()).filter(Boolean);
  const numbered = lines.filter(line => /^\d[.)]\s+\S/.test(line)).length;
  return numbered >= 2 || /[?？]\s*$/.test(lines.at(-1) ?? '');
}

const ONE_OFF = '- 단순한 질문이나 한 번에 끝나는 요청이면 이 안내를 따르지 말고 바로 답하세요.';

function clarifyGuidance(remaining: number, max: number, first: boolean): string {
  if (remaining <= 0) {
    return [
      '[Studio 안내: 질문은 여기까지예요. 더 묻지 마세요]',
      '지금까지 들은 내용으로 학습자의 업무 목표를 짧게 확인하고, 답의 마지막 줄에 "목표 정리: (한두 문장)"을 쓰세요.',
      '질문이나 번호 선택지, 단계 목록은 쓰지 말고 아직 작업을 시작하지 마세요. Studio가 이 줄을 보고 [퀘스트 생성하기] 버튼을 보여 줘요.',
      ...(first ? [ONE_OFF] : []),
    ].join('\n');
  }
  return [
    `[Studio 안내: 업무 목표 파악 · 핵심 질문은 모두 ${max}개까지, 지금 ${remaining}개 남음]`,
    '학습자가 여러 단계로 이뤄지는 업무 목표를 말했다면, 목표를 정확히 이해하는 데 꼭 필요한 핵심 질문만 하세요.',
    '- 한 번에 질문 하나만 하세요. 질문 뒤에 "아래에서 골라 주세요." 한 줄을 쓰고 번호 선택지 2~4개(1. 2. 3.)를 붙이세요. 학습자는 직접 입력할 수도 있어요.',
    '- 목표가 이미 분명하면 질문하지 말고 바로 정리하세요.',
    '- 정리할 때는 답의 마지막 줄에 "목표 정리: (한두 문장)"을 쓰세요. 그러면 Studio가 [퀘스트 생성하기] 버튼을 보여 줘요. 단계 목록은 쓰지 말고 아직 작업을 시작하지 마세요.',
    ...(first ? [ONE_OFF] : []),
  ].join('\n');
}

const OFFERED_GUIDANCE = [
  '[Studio 안내: 목표 확인 중 · 더 묻지 마세요]',
  '학습자가 정리된 목표에 덧붙인 말을 반영해 목표를 다시 짧게 확인하고, 답의 마지막 줄에 "목표 정리: (한두 문장)"을 쓰세요. 질문과 단계 목록은 쓰지 마세요.',
].join('\n');

function questGuidance(quest: AutomationQuestSnapshot): string | null {
  const done = quest.nodes.filter(node => node.status === 'succeeded').length;
  const index = quest.nodes.findIndex(node => node.status !== 'succeeded' && node.status !== 'pending');
  if (index < 0) return null;
  const step = quest.nodes[index]!;
  return [
    `[Studio 퀘스트 진행: 「${quest.title}」 ${done}/${quest.nodes.length} 완료 · 지금 단계 ${index + 1}. ${step.label}${step.description ? ` — ${step.description}` : ''}]`,
    '이 단계를 학습자와 함께 진행하세요. 단계 완료 표시는 학습자가 퀘스트 카드에서 직접 눌러요. 대신 완료 처리하거나 다음 단계로 건너뛰지 마세요.',
  ].join('\n');
}

/** The prompt of the one structured call that turns the understood goal into ordered steps. */
export function questGenerationPrompt(state: { summary: string; intent: string; answers: readonly string[] }): string {
  return [
    '다음 업무 목표를 이루기 위해 학습자가 Studio에서 순서대로 진행할 퀘스트 단계를 만들어 주세요.',
    'JSON 객체 하나만 출력하세요. 다른 글은 쓰지 마세요.',
    '형식: {"title":"퀘스트 이름(30자 이내)","steps":[{"title":"단계 이름(20자 이내)","description":"이 단계에서 할 일(70자 이내)"}]}',
    '규칙: 단계는 3~7개, 실제로 할 순서대로 씁니다. 첫 단계는 지금 바로 시작할 수 있는 일입니다. 이메일 주소·링크·계정·코드·개인정보는 쓰지 마세요.',
    `목표: ${clip(oneLine(state.summary), SUMMARY_MAX)}`,
    `처음 요청: ${clip(oneLine(state.intent), INTENT_MAX)}`,
    ...(state.answers.length ? ['학습자 답:', ...state.answers.map(answer => `- ${clip(oneLine(answer), ANSWER_MAX)}`)] : []),
  ].join('\n');
}

// The quest graph refuses links, addresses, long numbers, tokens and markup. Drop them from model text instead of
// failing the learner's one click on a stray character.
function safeText(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  const text = oneLine(value
    .replace(/(?:https?:|mailto:)\S*|www\.\S+/gi, '')
    .replace(/[\w.+-]+@[\w.-]+/g, '')
    .replace(/\d{7,}/g, '')
    .replace(/[A-Za-z0-9_-]{40,}/g, '')
    .replace(/[<>`{}\u0000-\u001f\u007f]/g, ' ')
    .replace(/\*\*|__/g, ''));
  return clip(text, max);
}

/** The structured answer as a quest with stable ids `step-1`… in order, or null when it holds no usable step. */
export function questFromModel(text: string, fallbackTitle: string): AutomationQuestSnapshot | null {
  const json = extractJsonObject(text);
  const rawSteps = Array.isArray(json?.steps) ? json!.steps as unknown[] : [];
  const steps = rawSteps.slice(0, 12).flatMap(step => {
    if (!step || typeof step !== 'object') return [];
    const s = step as Record<string, unknown>;
    const label = safeText(s.title ?? s.label, 48);
    const description = safeText(s.description, 160);
    return label ? [{ label, ...(description ? { description } : {}) }] : [];
  });
  if (!steps.length) return null;
  const title = safeText(json?.title, 80) || safeText(fallbackTitle, 80) || '나의 퀘스트';
  try {
    return createQuest({ title, nodes: steps.map((step, index) => ({ id: `step-${index + 1}`, ...step, dependsOn: index ? [`step-${index}`] : [] })) });
  } catch {
    return null;
  }
}

/** While the offer waits (or the quest is being made) the numbered-answer UI is not drawn: no question is left. */
export function questChoicesAllowed(view: Pick<QuestIntakeView, 'phase'>): boolean {
  return view.phase !== 'offered' && view.phase !== 'generating';
}

export interface QuestIntakePorts {
  newId(): string;
  restore?: Partial<QuestIntakeSnapshot> | null;
  onChange?(snapshot: QuestIntakeSnapshot): void;
}

const PHASES: readonly QuestIntakePhase[] = ['clarifying', 'offered', 'generating', 'quest', 'off'];

export class QuestIntakeSession {
  private tasks: Record<string, TaskIntake> = {};
  private readonly ports: QuestIntakePorts;
  constructor(ports: QuestIntakePorts) {
    this.ports = ports;
    const restored = ports.restore?.tasks;
    if (restored && typeof restored === 'object') {
      for (const [task, value] of Object.entries(restored)) {
        if (!value || typeof value !== 'object' || !PHASES.includes(value.phase)) continue;
        // A click in flight when the window closed made no quest: offer it again.
        this.tasks[task] = { ...value, phase: value.phase === 'generating' ? 'offered' : value.phase, answers: Array.isArray(value.answers) ? [...value.answers] : [] };
      }
    }
  }

  private save(): void {
    const keys = Object.keys(this.tasks);
    for (const key of keys.slice(0, Math.max(0, keys.length - TASKS_MAX))) delete this.tasks[key];
    try { this.ports.onChange?.({ tasks: this.tasks }); } catch { /* the flow simply starts fresh next time */ }
  }

  /**
   * Called as a coach turn starts. Returns the model-only guidance to append to the learner's text, or null.
   * `fresh` is false for a retry or an edited resend: the text is not a new answer and nothing is recorded.
   */
  beginTurn(task: string | null, text: string, ctx: { eligible: boolean; firstTurn: boolean; fresh: boolean; edited?: boolean; maxQuestions: number }): string | null {
    if (!task || !ctx.eligible) return null;
    let state = this.tasks[task];
    if (!state) {
      if (!ctx.firstTurn || !ctx.fresh) return null;
      state = this.tasks[task] = { phase: 'clarifying', intent: clip(text.trim(), INTENT_MAX), answers: [], questions: 0, max: ctx.maxQuestions, remaining: ctx.maxQuestions };
      this.save();
      return clarifyGuidance(state.remaining, state.max, true);
    }
    if (state.phase === 'clarifying') {
      // A retry or edit replaces the latest reply: the question it counted is given back.
      if (!ctx.fresh && state.counted) { state.questions = Math.max(0, state.questions - 1); state.counted = false; }
      if (ctx.edited) this.replaceLatest(state, text);
      else if (ctx.fresh && state.questions > 0) state.answers.push(clip(text.trim(), ANSWER_MAX));
      state.remaining = Math.max(0, state.max - state.questions);
      this.save();
      return clarifyGuidance(state.remaining, state.max, state.questions === 0);
    }
    if (state.phase === 'offered') {
      state.remaining = 0;
      if (ctx.edited) this.replaceLatest(state, text);
      else if (ctx.fresh) state.answers.push(clip(text.trim(), ANSWER_MAX));
      this.save();
      return OFFERED_GUIDANCE;
    }
    if (state.phase === 'quest' && state.quest) return questGuidance(state.quest);
    return null;
  }

  /** An edited resend of the learner's latest message: the generation prompt uses the edited words. */
  private replaceLatest(state: TaskIntake, text: string): void {
    if (state.answers.length) state.answers[state.answers.length - 1] = clip(text.trim(), ANSWER_MAX);
    else state.intent = clip(text.trim(), INTENT_MAX);
  }

  /** Called with the finished coach answer of a turn that `beginTurn` guided. True when the view changed. */
  afterReply(task: string | null, answer: string): boolean {
    const state = task ? this.tasks[task] : undefined;
    if (!state) return false;
    const summary = parseGoalSummary(answer);
    if (state.phase === 'offered') {
      if (!summary || summary === state.summary) return false;
      state.summary = summary;
      this.save();
      return true;
    }
    if (state.phase !== 'clarifying') return false;
    // The first reply of a task that neither asked nor summarised answered an ordinary request, even with no question allowed.
    const ordinaryFirst = !summary && state.questions === 0 && state.answers.length === 0 && !looksLikeQuestion(answer);
    if (!summary && (state.remaining > 0 || ordinaryFirst)) {
      if (looksLikeQuestion(answer)) { state.questions++; state.counted = true; this.save(); return false; }
      // The coach neither asked nor summarised: an ordinary request, answered. Leave the task alone.
      state.phase = 'off';
      this.save();
      return false;
    }
    // A summary, or a reply on a turn with no question left (whatever it says), ends in the offer.
    state.counted = false;
    state.phase = 'offered';
    state.offerId = this.ports.newId();
    state.summary = summary ?? clip(oneLine([state.intent, ...state.answers].join(' · ')), SUMMARY_MAX);
    delete state.error;
    this.save();
    return true;
  }

  /** The "퀘스트 생성하기" click: the prompt of the one structured call, or null for a stale or repeated click. */
  startGeneration(task: string | null, offerId: string): string | null {
    const state = task ? this.tasks[task] : undefined;
    if (!state || state.phase !== 'offered' || state.offerId !== offerId || !state.summary) return null;
    state.phase = 'generating';
    delete state.error;
    this.save();
    return questGenerationPrompt({ summary: state.summary, intent: state.intent, answers: state.answers });
  }

  /** The structured answer arrived. On a usable quest the first step is returned; otherwise the offer comes back with the reason. */
  finishGeneration(task: string | null, offerId: string, text: string | null): { quest: AutomationQuestSnapshot; first: string } | null {
    const state = task ? this.tasks[task] : undefined;
    if (!state || state.phase !== 'generating' || state.offerId !== offerId) return null;
    const quest = text === null ? null : questFromModel(text, state.summary ?? state.intent);
    if (!quest) {
      state.phase = 'offered';
      state.error = '퀘스트를 만들지 못했어요. 다시 눌러 주세요.';
      this.save();
      return null;
    }
    state.phase = 'quest';
    state.quest = quest;
    this.save();
    return { quest, first: quest.nodes[0]!.label };
  }

  /** The learner checked the current step: the only way a step completes. Returns the new quest, or null. */
  completeStep(task: string | null, stepId: string): AutomationQuestSnapshot | null {
    const state = task ? this.tasks[task] : undefined;
    const node = state?.quest?.nodes.find(entry => entry.id === stepId);
    if (!state?.quest || !node || node.status !== 'current') return null;
    try {
      state.quest = transitionQuest(transitionQuest(state.quest, stepId, 'running'), stepId, 'succeeded');
    } catch {
      return null;
    }
    this.save();
    return state.quest;
  }

  /** "그냥 대화하기": the learner keeps chatting without a quest. */
  dismiss(task: string | null, offerId: string): boolean {
    const state = task ? this.tasks[task] : undefined;
    if (!state || state.phase !== 'offered' || state.offerId !== offerId) return false;
    state.phase = 'off';
    this.save();
    return true;
  }

  questFor(task: string | null): AutomationQuestSnapshot | undefined {
    return task ? this.tasks[task]?.quest : undefined;
  }

  viewFor(task: string | null): QuestIntakeView {
    const state = task ? this.tasks[task] : undefined;
    if (!state || state.phase === 'off') return { phase: null };
    return {
      phase: state.phase,
      ...(state.offerId ? { offerId: state.offerId } : {}),
      ...(state.summary ? { summary: state.summary } : {}),
      ...(state.error ? { error: state.error } : {}),
      ...(state.quest ? { quest: { title: state.quest.title, revision: state.quest.revision, steps: state.quest.nodes.map(({ id, label, description, status }) => ({ id, label, ...(description ? { description } : {}), status })) } } : {}),
    };
  }
}
