// CGP-CHAT-D-004 — the "계획 먼저" chip and the plan card render (static markup). Interaction and geometry are in
// plan-first-layout.smoke.mjs.
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PLAN_WAITING_LABEL, PlanCard, PlanFirstChip, planSteps } from "../webview-ui/src/PlanFirst";

(globalThis as unknown as Record<string, unknown>).window = { acquireVsCodeApi: undefined };
let fail = 0;
const t = (label: string, fn: () => void) => {
  try { fn(); console.log(`  ok   ${label}`); } catch (e) { console.error(`  FAIL ${label}: ${(e as Error).message}`); fail++; }
};
const ok = (cond: unknown, msg: string) => { if (!cond) throw new Error(msg); };

t("the chip is a pressed-state button named 계획 먼저, off and on", () => {
  const off = renderToStaticMarkup(<PlanFirstChip on={false} disabled={false} />);
  const on = renderToStaticMarkup(<PlanFirstChip on={true} disabled={false} />);
  ok(off.includes('aria-pressed="false"') && on.includes('aria-pressed="true"'), "aria-pressed");
  ok(off.includes("계획 먼저") && off.includes('type="button"') && off.includes('data-icon="square"') && on.includes('data-icon="check-square"'), "label, type, stroke icon");
  ok(renderToStaticMarkup(<PlanFirstChip on={true} disabled={true} />).includes("disabled"), "disabled while a turn runs");
});
t("the card shows numbered steps and the four actions, approve first", () => {
  const html = renderToStaticMarkup(<PlanCard plan={{ id: "p1", text: "1. 파일 만들기\n2) 눌러 보기\n- 확인하기" }} />);
  ok(html.includes('role="region"') && html.includes("이렇게 해 볼까요?"), "named region");
  ok(/<ol[^>]*>(<li>[^<]+<\/li>){3}<\/ol>/.test(html), "three list items without the numbering text");
  const labels = [...html.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map(m => m[1]);
  ok(JSON.stringify(labels) === JSON.stringify(["이대로 진행", "수정", "다시 계획", "그만두기"]), labels.join("|"));
  ok(html.includes(PLAN_WAITING_LABEL) && html.includes("승인하기 전에는 아무것도 실행하지 않아요"), "waiting note");
});
t("planSteps strips numbering and bullets and keeps prose lines", () => {
  ok(JSON.stringify(planSteps("1. a\n\n2) b\n• c\nplain")) === JSON.stringify(["a", "b", "c", "plain"]), "steps");
});
if (fail) process.exit(1);
