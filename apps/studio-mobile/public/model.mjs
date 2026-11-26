export const KEY = "hp-studio-mobile/v1";
export function fresh() {
  return { version: 1, projects: [], active: null };
}
export function createProject(
  text,
  id = crypto.randomUUID(),
  now = new Date().toISOString(),
) {
  text = text.trim();
  if (!text || text.length > 4000)
    throw Error("생각을 1~4,000자로 적어 주세요.");
  return {
    id,
    title: text.slice(0, 32),
    createdAt: now,
    updatedAt: now,
    messages: [{ id: crypto.randomUUID(), role: "user", content: text }],
    revisions: [],
    draft: "",
  };
}
export function confirmIntent(project, text, now = new Date().toISOString()) {
  text = text.trim();
  if (!text || text.length > 4000)
    throw Error("의도를 1~4,000자로 적어 주세요.");
  return {
    ...project,
    updatedAt: now,
    revisions: [
      ...project.revisions,
      {
        revision: project.revisions.length + 1,
        text,
        confirmedAt: now,
        author: "user",
      },
    ],
  };
}
export function restore(raw) {
  if (raw === null) return fresh();
  const s = JSON.parse(raw);
  if (s?.version !== 1 || !Array.isArray(s.projects) || s.projects.length > 100)
    throw Error("저장 형식을 읽을 수 없어요.");
  const ids = new Set();
  for (const p of s.projects) {
    if (
      typeof p.id !== "string" ||
      ids.has(p.id) ||
      typeof p.title !== "string" ||
      typeof p.draft !== "string" ||
      !Array.isArray(p.messages) ||
      !Array.isArray(p.revisions)
    )
      throw Error("기록 형식을 확인해 주세요.");
    ids.add(p.id);
    if (
      !p.messages.every(
        (m) =>
          ["user", "assistant"].includes(m.role) &&
          typeof m.content === "string",
      )
    )
      throw Error("대화 형식 오류");
    if (
      !p.revisions.every(
        (r, i) =>
          r.revision === i + 1 &&
          r.author === "user" &&
          typeof r.text === "string",
      )
    )
      throw Error("의도 형식 오류");
  }
  if (s.active !== null && !ids.has(s.active))
    throw Error("프로젝트 연결 오류");
  return s;
}
export function save(storage, state) {
  storage.setItem(KEY, JSON.stringify(state));
}
export function conversation(project) {
  const intent = project.revisions.at(-1);
  // Guidance is a visible client request, not a substitute for Service-owned policy.
  const context =
    "HP Studio 모바일에서 내 생각을 구체화하고 싶습니다. 공감하되 과장하지 말고, 관찰한 사실과 내 추측을 구분하고, 다른 사람의 관점을 살피고, 작은 실천 뒤 생각을 수정하도록 도와주세요. 이는 철학에서 착안한 설계 가설이지 검증된 성장 진단이 아닙니다. 한 번에 짧은 질문 하나 또는 작은 다음 행동을 제안해 주세요. 목적이 충분히 분명하면 질문을 반복하지 말고 바로 예시나 실행 가능한 다음 행동을 제시해 주세요. 내가 요청하면 먼저 예시를 보여 주세요. 사람의 가치나 성장을 점수화하지 마세요. 도구 실행이나 배포를 했다고 주장하지 마세요." +
    (intent ? "\n내가 현재 확인한 의도: " + intent.text : "");
  return [
    { role: "user", content: context },
    ...project.messages
      .slice(-20)
      .map(({ role, content }) => ({ role, content })),
  ];
}
export const firstQuestion =
  "누구의 어떤 불편함을 바꾸고 싶나요? 아직 모르겠다면 가장 최근에 눈에 들어온 장면 하나부터 이야기해도 좋아요.";
export function friendlyError(code, status, refillsAt) {
  if (code === "trial_busy")
    return "앞선 요청을 마무리하고 있어요. 잠시 뒤 다시 시도해 주세요.";
  if (code === "trial_input_limit")
    return "대화가 길어졌어요. 현재 의도를 기록하고 새 생각으로 이어가 주세요.";
  if (status === 403)
    return "연결 권한을 다시 확인해야 해요. 무료 AI 연결을 다시 눌러 주세요.";
  if (status === 401) return "무료 사용 연결이 만료됐어요. 다시 연결해 주세요.";
  if (status === 429)
    return (
      "지금은 무료 사용 한도에 도달했어요. 기록은 그대로 남아 있어요." +
      (Number.isFinite(refillsAt)
        ? " " +
          new Date(refillsAt).toLocaleString("ko-KR") +
          " 이후 다시 연결해 주세요."
        : " 나중에 다시 연결해 주세요.")
    );
  if (code === "under_14") return "현재 무료 시작은 만 14세 이상에게 제공돼요.";
  if (code === "app_too_old") return "앱을 새로고침한 뒤 다시 연결해 주세요.";
  return "AI에 연결하지 못했어요. 작성한 내용은 유지돼요. 다시 시도하거나 혼자 의도를 정리할 수 있어요.";
}
