// REQ-QUEST-OFFER / REQ-QUEST-LIST (#4283) — the "퀘스트 생성하기" offer card and the quest card render (static markup).
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QuestCard, QuestOfferCard } from "../webview-ui/src/QuestIntake";
import type { QuestIntakeView } from "../src/questIntake";

(globalThis as unknown as Record<string, unknown>).window = { acquireVsCodeApi: undefined };
let fail = 0;
const t = (label: string, fn: () => void) => {
  try { fn(); console.log(`  ok   ${label}`); } catch (e) { console.error(`  FAIL ${label}: ${(e as Error).message}`); fail++; }
};
const ok = (cond: unknown, msg: string) => { if (!cond) throw new Error(msg); };
const buttons = (html: string) => [...html.matchAll(/<button[^>]*>(.*?)<\/button>/g)].map(m => m[1].replace(/<!-- -->/g, ""));

const quest: QuestIntakeView["quest"] = { title: "서류 요청 메일 자동화", revision: 2, steps: [
  { id: "step-1", label: "업무 정리", description: "보낼 메일을 정해요.", status: "succeeded" },
  { id: "step-2", label: "Google 연결", status: "current" },
  { id: "step-3", label: "명단 연결", status: "pending" },
] };

t("the offer shows the understood goal and 퀘스트 생성하기 first", () => {
  const html = renderToStaticMarkup(<QuestOfferCard view={{ phase: "offered", offerId: "o1", summary: "명단의 사람마다 서류 요청 메일 보내기" }} />);
  ok(html.includes('role="region"') && html.includes("목표를 이렇게 이해했어요") && html.includes("명단의 사람마다 서류 요청 메일 보내기"), "summary region");
  ok(JSON.stringify(buttons(html)) === JSON.stringify(["퀘스트 생성하기", "그냥 대화하기"]), buttons(html).join("|"));
});
t("while generating both buttons are disabled and a status line shows; a failure shows its retry line", () => {
  const busy = renderToStaticMarkup(<QuestOfferCard view={{ phase: "generating", offerId: "o1", summary: "s" }} />);
  ok((busy.match(/disabled=""/g) ?? []).length === 2 && busy.includes("퀘스트를 만들고 있어요"), "busy");
  const failed = renderToStaticMarkup(<QuestOfferCard view={{ phase: "offered", offerId: "o1", summary: "s", error: "퀘스트를 만들지 못했어요. 다시 눌러 주세요." }} />);
  ok(failed.includes('role="alert"') && !failed.includes("disabled"), "retry");
});
t("no offer card without an offer", () => {
  ok(renderToStaticMarkup(<QuestOfferCard view={{ phase: "clarifying" }} />) === "", "clarifying");
  ok(renderToStaticMarkup(<QuestOfferCard view={{ phase: null }} />) === "", "none");
});
t("the quest card lists ordered steps, highlights the current one and checks only it", () => {
  const html = renderToStaticMarkup(<QuestCard view={{ phase: "quest", quest }} />);
  ok(html.includes("서류 요청 메일 자동화") && html.includes("1 / 3 완료"), "title and count");
  ok(/data-step-id="step-1"[^>]*>.*?data-icon="check"/.test(html) && /class="hps-quest-step current" data-step-id="step-2" aria-current="step"/.test(html), "done mark and current step");
  ok(html.includes("지금 할 단계"), "current label");
  ok(JSON.stringify(buttons(html)) === JSON.stringify(["「Google 연결」 완료", "퀘스트 지도 보기", "목록 접기"]), buttons(html).join("|"));
});
t("a finished quest has no check button", () => {
  const done = { ...quest!, steps: quest!.steps.map(step => ({ ...step, status: "succeeded" as const })) };
  const html = renderToStaticMarkup(<QuestCard view={{ phase: "quest", quest: done }} />);
  ok(html.includes("모든 단계를 완료했어요") && !buttons(html).some(label => label.endsWith("완료")), "finished");
});
if (fail) process.exit(1);
