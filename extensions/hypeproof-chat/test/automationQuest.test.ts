import test from "node:test";
import assert from "node:assert/strict";
import { createQuest, renderQuestHtml, transitionQuest, validateQuestPlan } from "../src/automationQuest.ts";

const plan = {
  title: "자료 요청 자동화",
  nodes: [
    { id: "review", label: "내용 확인", dependsOn: ["sheet", "draft"] },
    { id: "goal", label: "업무 정하기", description: "필요한 자료와 마감일을 대화로 정해요.", dependsOn: [] },
    { id: "sheet", label: "시트 연결", dependsOn: ["goal"] },
    { id: "draft", label: "메일 초안", dependsOn: ["goal"] },
  ],
};

test("a branching plan starts with no invented completions and waits for both prerequisites", () => {
  const initial = createQuest(plan);
  assert.equal(initial.nodes.filter((node) => node.status === "current").length, 1);
  assert.equal(initial.nodes.find((node) => node.id === "goal")?.status, "current");
  assert.throws(() => transitionQuest(initial, "review", "running"));
  assert.throws(() => transitionQuest(initial, "goal", "succeeded"));
  let next = transitionQuest(transitionQuest(initial, "goal", "running"), "goal", "succeeded");
  next = transitionQuest(transitionQuest(next, "sheet", "running"), "sheet", "succeeded");
  assert.throws(() => transitionQuest(next, "review", "running"));
  next = transitionQuest(transitionQuest(next, "draft", "running"), "draft", "succeeded");
  assert.equal(next.nodes.find((node) => node.id === "review")?.status, "current");
  assert.equal(initial.nodes.find((node) => node.id === "goal")?.status, "current");
  assert.equal(plan.nodes[0].id, "review", "validation must not reorder caller data");
});

test("failures and blocked setup retain incomplete progress, and a retry needs a real run", () => {
  let quest = createQuest({ title: "구글 연결", nodes: [{ id: "connect", label: "연결 확인", dependsOn: [] }] });
  quest = transitionQuest(quest, "connect", "blocked");
  assert.throws(() => transitionQuest(quest, "connect", "succeeded"));
  quest = transitionQuest(transitionQuest(quest, "connect", "running"), "connect", "failed");
  assert.match(renderQuestHtml(quest), /0 \/ 1 완료/);
  quest = transitionQuest(transitionQuest(quest, "connect", "running"), "connect", "succeeded");
  assert.match(renderQuestHtml(quest), /1 \/ 1 완료/);
  assert.throws(() => transitionQuest(quest, "connect", "running"));
});

test("cycles, disconnected steps, unknown dependencies and AI-authored statuses fail closed", () => {
  for (const nodes of [
    [{ id: "a", label: "단계", dependsOn: ["b"] }, { id: "b", label: "단계", dependsOn: ["a"] }],
    [{ id: "a", label: "단계", dependsOn: [] }, { id: "b", label: "단계", dependsOn: [] }],
    [{ id: "a", label: "단계", dependsOn: ["missing"] }],
    [{ id: "a", label: "단계", dependsOn: [], status: "succeeded" }],
    Array.from({ length: 13 }, (_, index) => ({ id: `step${index}`, label: "단계", dependsOn: index ? [`step${index - 1}`] : [] })),
  ]) assert.throws(() => validateQuestPlan({ title: "흐름", nodes }));
});

test("graph descriptions reject identifying content without echoing it, and HTML stays inert", () => {
  for (const title of ["<script>alert(1)</script>", "sample@example.invalid", "https://example.invalid/private", "key_" + "x".repeat(45), "function run() {}"])
    assert.throws(() => createQuest({ ...plan, title }), (error: Error) => !error.message.includes(title));
  const html = renderQuestHtml(createQuest({ ...plan, title: '검토 & "확인"' }));
  assert.match(html, /검토 &amp; &quot;확인&quot;/);
  assert.match(html, /script-src 'none'/);
  assert.doesNotMatch(html, /<script|\sonclick=|\ssrc=/i);
  assert.equal((html.match(/class="edge /g) ?? []).length, 4, "every dependency is visible as an edge");
  assert.match(html, /aria-current="step"/);
  assert.match(html, /aria-valuenow="0"/);
});

// A plan with no result must never announce completion, even with no active node.
test("the renderer distinguishes a draft from evidence and pending-only progress", () => {
  const initial = createQuest(plan);
  assert.match(renderQuestHtml(initial), /설계한 흐름 · 실행 전/);
  const pending = { ...initial, nodes: initial.nodes.map(node => ({ ...node, status: "pending" as const })) };
  assert.doesNotMatch(renderQuestHtml(pending), /모든 단계의 결과를 확인했습니다/);
  assert.match(renderQuestHtml(pending), /아직 완료되지 않은 단계/);
  const partiallyDone = transitionQuest(transitionQuest(initial, "goal", "running"), "goal", "succeeded");
  const html = renderQuestHtml(partiallyDone);
  assert.match(html, /실제 진행 상황/);
  assert.match(html, /앞선 2단계 모두 필요 · 0\/2 확인/);
  assert.match(html, /data-from="sheet" data-to="review"/);
  assert.match(html, /data-from="draft" data-to="review"/);
});
