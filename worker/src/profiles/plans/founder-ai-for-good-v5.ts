import type { LearningWikiPlan } from "../types";

// AI for Good founder course, curriculum v5 (hypeproof_main venture/curriculum-v5-ai-for-good.md):
// high-school teams build a working product from week 1, and each week's lens fills one or two of
// the eight IR deck slides. This is the cohort's specialization of the generic learning wiki and
// deck generator skills; a founder cohort profile sets `learning_wiki: { enabled: true, plan: FOUNDER_AI_FOR_GOOD_V5 }`.
export const FOUNDER_AI_FOR_GOOD_V5: LearningWikiPlan = {
  dir: "venture",
  audience: "고등학생 창업 팀",
  session_label: "주차",
  deck: {
    title: "IR 덱 8장",
    slides: [
      { no: 1, title: "문제·기회", question: "누구의 어떤 어려움인가, 근거는 무엇인가" },
      { no: 2, title: "제공 가치", question: "당사자에게 무엇이 나아지나" },
      { no: 3, title: "해결 원리", question: "AI가 하는 일, 사람이 확인하는 일, AI가 틀렸을 때의 안전장치" },
      { no: 4, title: "수익 구조와 임팩트", question: "누가 돈을 내고 무엇이 바뀌나" },
      { no: 5, title: "현장·고객 접근", question: "큰 지출 없이 당사자와 지불자를 어떻게 만나나" },
      { no: 6, title: "기존 도움과 대안", question: "지금 있는 도움과 무엇이 다른가" },
      { no: 7, title: "재무·임팩트 지표", question: "3년 예측과 임팩트 추정, 실적과 가정 구분" },
      { no: 8, title: "현재 성과와 다음 계획", question: "지금까지 확인한 것, 다음 일정, 필요한 자원" },
    ],
  },
  sessions: [
    { session: 1, focus: [1], question: "이 문제를 겪는 사람은 누구이고, 언제 무엇 때문에 힘든가?" },
    { session: 2, focus: [2, 3], question: "지금 있는 도움보다 무엇이 나아지고, AI가 틀리면 누가 곤란해지나?" },
    { session: 3, focus: [4, 5], question: "도움을 받는 사람과 돈을 내는 사람이 같은가? 바뀐 것을 어떻게 세나?" },
    { session: 4, focus: [6], question: "당사자가 지금의 도움 대신 이걸 고를 이유는?" },
    { session: 5, focus: [7, 8], question: "지금까지 실제로 확인한 것은 무엇이고, 다음에 무엇이 필요한가?" },
    { session: 6, focus: [], question: "만든 제품과 바뀐 판단을 어떻게 보여 줄까?" },
  ],
};
