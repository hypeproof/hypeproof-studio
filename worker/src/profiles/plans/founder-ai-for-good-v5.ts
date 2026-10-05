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
      { no: 1, title: "문제·기회", question: "누구의 어떤 어려움인가, 근거는 무엇인가", hint: "당사자의 어려움만 보여 준다(당사자의 말이나 어려움을 겪는 장면, 어려움의 빈도). 해결 결과나 제품 성과는 넣지 않는다." },
      { no: 2, title: "제공 가치", question: "당사자에게 무엇이 나아지나", hint: "당사자에게 나아진 점을 보여 준다(전후 비교나 사용자가 한 말). 기능 목록은 쓰지 않는다." },
      { no: 3, title: "해결 원리", question: "AI가 하는 일, 사람이 확인하는 일, AI가 틀렸을 때의 안전장치", hint: "제품이 어떻게 작동하는지 보여 준다(단계 흐름이나 제품 화면). 무엇을 AI·규칙이 하고 무엇을 사람이 확인하는지, 틀렸을 때 어떻게 막는지." },
      { no: 4, title: "수익 구조와 임팩트", question: "누가 돈을 내고 무엇이 바뀌나", hint: "누가 돈을 내고 무엇이 바뀌는지. 확인하지 않은 지불자는 가정이라고 밝힌다." },
      { no: 5, title: "현장·고객 접근", question: "큰 지출 없이 당사자와 지불자를 어떻게 만나나", hint: "당사자와 지불자를 실제로 어떻게 만났고 만날지(경로, 지금까지 만난 수)." },
      { no: 6, title: "기존 도움과 대안", question: "지금 있는 도움과 무엇이 다른가", hint: "지금 쓰는 도움과 우리 방법의 차이(비교). 경쟁자를 깎아내리지 않는다." },
      { no: 7, title: "재무·임팩트 지표", question: "3년 예측과 임팩트 추정, 실적과 가정 구분", hint: "실적과 가정을 나눠 숫자로. 가정은 가정이라고 쓴다." },
      { no: 8, title: "현재 성과와 다음 계획", question: "지금까지 확인한 것, 다음 일정, 필요한 자원", hint: "지금까지 확인한 것(숫자)과 다음 일정, 필요한 것 하나." },
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
