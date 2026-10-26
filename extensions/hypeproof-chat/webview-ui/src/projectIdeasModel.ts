/**
 * CGP-SHELL-R-020 (REQ-SHELL-20) — example project ideas, offered only after the learner answers
 * a goal question with "I have no idea". Never on the first screen, never in a lesson or the
 * instructor console. Detection is deliberately narrow and fails closed: when the goal question or
 * the answer is uncertain, nothing is offered and the conversation goes on as before (NAT-03).
 */
import type { ChatMessage } from "../../src/protocol";

export type ProjectIdea = { id: string; title: string; prompt: string };

/** Studio-owned starters. Picking one only prepares an editable draft; the learner still decides. */
export const PROJECT_IDEAS: readonly ProjectIdea[] = [
  { id: "time-log", title: "하루 시간 기록표", prompt: "하루 동안 시간을 어디에 쓰는지 적어 볼 수 있는 간단한 기록표를 만들고 싶어요." },
  { id: "quiz", title: "좋아하는 주제 퀴즈", prompt: "내가 좋아하는 주제로 문제 다섯 개짜리 퀴즈 페이지를 만들고 싶어요." },
  { id: "intro-page", title: "나를 소개하는 한 장", prompt: "나를 소개하는 한 장짜리 웹페이지를 만들고 싶어요." },
  { id: "notice-poster", title: "모임 공지 포스터", prompt: "다음 모임을 알리는 공지 포스터를 만들고 싶어요." },
  { id: "shopping-list", title: "장보기 목록 정리표", prompt: "이번 주 장보기 목록을 종류별로 정리하는 표를 만들고 싶어요." },
  { id: "trip-plan", title: "하루 여행 계획", prompt: "가고 싶은 곳의 하루 여행 계획을 한눈에 보는 페이지로 만들고 싶어요." },
];
export const PROJECT_IDEAS_MAX = 6;
/** A no-idea answer is short; a longer message carries its own content and is left to the coach. */
export const NO_IDEA_MAX_CHARS = 30;
export const PROJECT_IDEAS_STATE_KEY = "projectIdeasDismissed";
export const PROJECT_IDEAS_DISMISS_MAX = 200;
/** Ideas are for STARTING a project: the no-idea answer must be among the learner's first messages. */
export const IDEA_OFFER_MAX_LEARNER_TURNS = 3;

/** Controls, bidi/format characters, line/paragraph separators and Hangul blank fillers. */
const INVISIBLE = /[\p{Cc}\p{Cf}\u2028\u2029\u115f\u1160\u3164\uffa0\u2800]/gu;

/** NFKC (full-width ？ becomes ?), invisible characters removed, whitespace folded to one space. */
export function normalizeTurnText(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.normalize("NFKC").replace(/[\u2028\u2029\r\n\t]/g, " ").replace(INVISIBLE, "").replace(/\s+/g, " ").trim();
}

/** A goal question asks WHAT: a question word together with making or doing, or names the goal itself. */
const GOAL_WHAT = /(무엇|뭘|뭐|무슨|어떤|어느)/;
const GOAL_DO = /(만들|만드는|해\s?보고\s?싶|하고\s?싶|해\s?볼|시작해\s?볼)/;
const GOAL_NAMED = /목표(?:가|는|를)?\s?(?:뭐|무엇)/;
/** Trailing emoji, emphasis and closing marks after the question mark do not hide the question. */
const TRAILING_DECORATION = /[\s*_~`"')\]\u201d\u2019\p{Extended_Pictographic}\ufe0f\u200d]+$/u;

/**
 * Detail and choice questions are never goal questions (owner decision, CGP-SHELL-R-020 fix 1):
 * - "...으로/로 만들까요", "...으로/로 할까요" (an option for something already decided);
 * - "더", "부터", "다음에", "어느 쪽", "어떻게" continuations;
 * - a what-word followed by a noun that is not the whole thing ("어떤 색", "어떤 파일 이름"); only
 *   걸/것/거/일/프로젝트/작품/결과물/앱/페이지/사이트/게임/작업/서비스 may follow;
 * - a question that points at an existing thing ("이/그/저/이번/방금/위/아래/여기", "...의", "...에서").
 */
const DETAIL_OPTION = /(?:으로|로)\s?(?:만들|만든|할까|해\s?볼|하면|해도|할래|하실|하고\s?싶)/;
const DETAIL_CONTINUE = /(?:더\s|더\?|부터|다음에|다음엔|어느\s?쪽|어느\s?것|어떻게|마저|계속)/;
const DETAIL_PART_NOUN = /(?:어떤|무슨|어느)\s?(?!(?:걸|것|거|일|프로젝트|작품|결과물|앱|서비스|사이트|웹페이지|웹사이트|페이지|게임|작업|활동)(?:[을를이가은는도]|\s|$))[가-힣]/;
const DETAIL_EXISTING = /(?:^|\s)(?:이|그|저|이번|방금|지금\s?만든|위|아래|여기|해당)(?:\s|에|의|에서)|[가-힣]의\s|[가-힣]에서\s|(?:안에|속에|부분|항목|칸|줄)/;
function isDetailQuestion(q: string): boolean {
  return DETAIL_OPTION.test(q) || DETAIL_CONTINUE.test(q) || DETAIL_PART_NOUN.test(q) || DETAIL_EXISTING.test(q);
}

/**
 * A goal question asks what the learner wants to make or do, as a question. Only the closing
 * part of the coach's text counts, so a long answer that mentions making something earlier and
 * ends with an unrelated question is not one.
 */
export function isGoalQuestion(raw: unknown): boolean {
  // Bound the work before normalizing: only the closing part of a long reply matters.
  const text = normalizeTurnText(typeof raw === "string" ? raw.slice(-1200) : raw).slice(-400).replace(TRAILING_DECORATION, "");
  const questions = text.split(/(?<=[.!?])\s*/).filter((sentence) => sentence.endsWith("?"));
  const closing = questions.slice(-2);
  // A detail or choice question among the closing two settles it: the answer may be about that one.
  if (closing.some(isDetailQuestion)) return false;
  return closing.some((q) => (GOAL_WHAT.test(q) && GOAL_DO.test(q)) || GOAL_NAMED.test(q));
}

/** The answer must END with the no-idea phrase: "모르겠어요 그냥 퀴즈 만들래요" names a goal. */
const NO_IDEA_END = new RegExp(
  "(?:" + [
    "몰라(?:요)?", "모르겠(?:어|어요|습니다|네|네요|다|는데|는데요)?", "모름", "모르는데(?:요)?",
    "생각(?:이)?\\s?안\\s?(?:나|나요|나네요|남|납니다)", "안\\s?떠올라(?:요)?", "떠오르지\\s?않(?:아|아요|네요|습니다)",
    "떠오르는\\s?(?:게|것이|건)\\s?없(?:어|어요|네요|습니다)",
    // "없어요" alone, or after a subject that names ideas or plans; never "시간이 없어요".
    "(?:^|(?:아이디어|생각|계획|정한\\s?(?:게|것)|하고\\s?싶은\\s?(?:게|것)|만들고\\s?싶은\\s?(?:게|것)|떠오르는\\s?(?:게|것)|아무것도|딱히|아직|별로)(?:가|이|은|는|도)?\\s?)없(?:어|어요|습니다|는데|는데요|네|네요)",
    "못\\s?정했(?:어|어요|습니다|는데|는데요)?", "정하지\\s?못했(?:어|어요|습니다)?",
    "추천해\\s?(?:줘|주세요|줄래|줄래요)", "아무거나(?:요)?",
  ].join("|") + ")$",
);

export function isNoIdeaAnswer(raw: unknown): boolean {
  // A long raw message cannot be a no-idea answer; skip normalizing it at all.
  if (typeof raw !== "string" || raw.length > NO_IDEA_MAX_CHARS * 8) return false;
  const text = normalizeTurnText(raw);
  if (!text || [...text].length > NO_IDEA_MAX_CHARS) return false;
  // Trailing punctuation and crying/laughing jamo; NFKC turns ㅠㅜㅎㅋ into their conjoining forms.
  const core = text.replace(/[\s.!?~…,^ㅠㅜㅎㅋ\u1172\u116e\u1112\u110f]+$/u, "");
  return !!core && NO_IDEA_END.test(core);
}

/**
 * The learner message the offer belongs to, or null. Conditions, all required:
 * - the latest learner message is a no-idea answer, followed by at most one coach reply;
 * - the coach text right before it (or, for the first message, the greeting) is a goal question;
 * - the coach reply after it, if any, did not already offer its own reply choices (one picker);
 * - the task is at its start: no work made (taskHasWork) and at most IDEA_OFFER_MAX_LEARNER_TURNS learner messages.
 * The caller adds the seat, turn and lock gates.
 */
export function ideaOfferFor(
  messages: readonly ChatMessage[],
  greeting: string,
  replyHasChoices: (text: string) => boolean,
  artifactExists: boolean,
): { messageId: string } | null {
  // Ideas are for starting a project, never mid-work: no work made yet, and the conversation is early.
  if (taskHasWork(messages, artifactExists)) return null;
  const spoken = messages.filter((m) => m.role === "user" || m.role === "assistant");
  let at = spoken.length - 1;
  if (at >= 0 && spoken[at].role === "assistant") {
    if (!spoken[at].content.trim() || replyHasChoices(spoken[at].content)) return null;
    at--;
  }
  if (spoken.filter((m) => m.role === "user").length > IDEA_OFFER_MAX_LEARNER_TURNS) return null;
  const answer = spoken[at];
  if (!answer || answer.role !== "user" || !isNoIdeaAnswer(answer.content)) return null;
  const asked = at > 0 ? spoken[at - 1] : null;
  if (asked ? asked.role !== "assistant" || !isGoalQuestion(asked.content) : !isGoalQuestion(greeting)) return null;
  return { messageId: answer.id };
}

/** Tool rows that only look or think; every other tool row is work made (writes, previews, commands). */
const LOOK_ONLY_ICONS = new Set(["💭", "…", "📖", "🔍", "🌐"]);

/**
 * Has any work been made in this task? True when a tool row other than a look-only one exists, or an
 * assistant message carries a fenced block (the chat fence opens a preview), or the caller knows an
 * artifact exists (picked surface, open world, publish). Unknown rows count: fail closed.
 */
export function taskHasWork(messages: readonly ChatMessage[], artifactExists: boolean): boolean {
  if (artifactExists) return true;
  return messages.some((m) =>
    (m.role === "tool" && !LOOK_ONLY_ICONS.has(m.tool?.icon ?? "")) ||
    (m.role === "assistant" && m.content.includes("```")));
}

/** Collision-free dismissal key for one offer in one task. */
export function ideaOfferKey(activityId: string | null | undefined, taskId: string | null | undefined, messageId: string): string {
  return JSON.stringify([activityId ?? "", taskId ?? "", messageId]);
}

export function readIdeaDismissals(state: Record<string, unknown>): string[] {
  const list = state[PROJECT_IDEAS_STATE_KEY];
  return Array.isArray(list) ? list.filter((k): k is string => typeof k === "string").slice(-PROJECT_IDEAS_DISMISS_MAX) : [];
}

export function withIdeaDismissal(list: readonly string[], key: string): string[] {
  return [...list.filter((k) => k !== key), key].slice(-PROJECT_IDEAS_DISMISS_MAX);
}
