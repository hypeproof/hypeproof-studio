import {
  KEY,
  fresh,
  createProject,
  confirmIntent,
  restore,
  save,
  conversation,
  firstQuestion,
  friendlyError,
} from "./model.mjs";
const $ = (id) => document.getElementById(id);
let state = fresh(),
  session = null,
  controller = null,
  generation = 0,
  storageFailed = false,
  corruptRaw = null,
  storageUnreadable = false,
  claimController = null,
  claimSequence = 0,
  toastTimer;
try {
  corruptRaw = localStorage.getItem(KEY);
  state = restore(corruptRaw);
  corruptRaw = null;
} catch {
  storageFailed = true;
  storageUnreadable = true;
  notify(
    "저장된 기록을 읽지 못했어요. 기존 데이터를 덮어쓰지 않아요. 설정에서 내보내 주세요.",
  );
}
function notify(text) {
  $("toast").textContent = text;
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("toast").hidden = true), 7000);
}
function persist(candidate = state) {
  if (storageUnreadable) {
    $("saveState").textContent = "저장 불가 · 내보내기 필요";
    return false;
  }
  try {
    save(localStorage, candidate);
    storageFailed = false;
    $("saveState").textContent = "이 기기에 저장됨";
    return true;
  } catch {
    storageFailed = true;
    $("saveState").textContent = "저장 실패 · 내보내기 필요";
    notify(
      "기기 저장 공간을 확인해 주세요. 지금 기록은 내보내기로 보관할 수 있어요.",
    );
    return false;
  }
}
function current() {
  return state.projects.find((p) => p.id === state.active);
}
function element(tag, text, cls) {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (cls) e.className = cls;
  return e;
}
function cancelClaim() {
  claimSequence++;
  claimController?.abort();
  claimController = null;
}
function stop() {
  cancelClaim();
  generation++;
  controller?.abort();
  controller = null;
  setBusy(false);
}
function setBusy(b) {
  $("busy").hidden = !b;
  $("cancel").hidden = !b;
  $("send").disabled = b;
  $("example").disabled = b;
  $("reflect").disabled = b;
  $("experiment").disabled = b;
}
function date(value) {
  return new Date(value).toLocaleDateString("ko-KR", {
    month: "long",
    day: "numeric",
  });
}
function connection() {
  const ready = session && session.expires > Date.now();
  if (!ready) session = null;
  $("connectionStatus").textContent = ready
    ? "AI 연결됨 · 기존 무료 사용 한도 적용"
    : "혼자 생각 정리 중";
  $("connect").textContent = ready ? "연결 안내" : "무료 AI 연결";
}
function render() {
  const p = current();
  $("home").hidden = !!p;
  $("workspace").hidden = !p;
  connection();
  $("projects").replaceChildren();
  $("projectCount").textContent = state.projects.length + "개";
  if (!state.projects.length)
    $("projects").append(
      element("p", "첫 생각을 남기면 여기서 이어갈 수 있어요.", "empty"),
    );
  for (const project of [...state.projects].reverse()) {
    const button = element("button", undefined, "project-card"),
      wrap = element("span");
    wrap.append(
      element("b", project.title),
      element(
        "small",
        date(project.updatedAt) +
          (project.revisions.length
            ? " · 의도 " + project.revisions.length + "번째 기록"
            : " · 탐색 중"),
      ),
    );
    button.append(wrap, element("span", "↗"));
    button.onclick = () => open(project.id);
    $("projects").append(button);
  }
  if (!p) return;
  $("projectTitle").textContent = p.title;
  $("messages").replaceChildren();
  for (const m of p.messages) {
    const bubble = element("div", undefined, "bubble " + m.role);
    bubble.append(
      element("small", m.role === "user" ? "나" : "AI"),
      element("span", m.content),
    );
    $("messages").append(bubble);
  }
  if (!p.messages.some((m) => m.role === "assistant"))
    $("messages").append(element("p", firstQuestion, "prompt"));
  $("message").value = p.draft;
  $("intentText").value = p.intentDraft ?? p.revisions.at(-1)?.text ?? "";
  $("intentHistory").replaceChildren();
  for (const revision of [...p.revisions].reverse()) {
    const row = element("div", undefined, "revision");
    row.append(
      element(
        "small",
        "내가 확인한 의도 " +
          revision.revision +
          " · " +
          date(revision.confirmedAt),
      ),
      element("p", revision.text),
    );
    $("intentHistory").append(row);
  }
  $("saveState").textContent = storageFailed
    ? "저장 불가 · 내보내기 필요"
    : "이 기기에 저장됨";
}
function tab(name) {
  for (const t of ["chat", "intent"]) {
    $(t + "Tab").setAttribute("aria-selected", String(t === name));
    $(t + "Panel").hidden = t !== name;
  }
}
function open(id) {
  stop();
  state.active = id;
  persist();
  $("chatError").hidden = true;
  $("retry").hidden = true;
  tab("chat");
  render();
  window.scrollTo(0, 0);
}
$("newForm").onsubmit = (e) => {
  e.preventDefault();
  try {
    if (state.projects.length >= 100)
      throw Error("기록을 내보내고 오래된 생각을 정리해 주세요.");
    const p = createProject($("newIdea").value);
    state.projects.push(p);
    $("newIdea").value = "";
    open(p.id);
  } catch (e) {
    notify(e.message);
  }
};
for (const b of document.querySelectorAll("[data-example]"))
  b.onclick = () => {
    $("newIdea").value = b.dataset.example;
    $("newIdea").focus();
  };
$("back").onclick = () => {
  stop();
  state.active = null;
  persist();
  render();
};
$("chatTab").onclick = () => tab("chat");
$("intentTab").onclick = () => tab("intent");
$("message").oninput = () => {
  const p = current();
  if (p) {
    p.draft = $("message").value;
    persist();
  }
};
$("intentText").oninput = () => {
  const p = current();
  if (p) {
    p.intentDraft = $("intentText").value;
    persist();
  }
};
$("intentForm").onsubmit = (e) => {
  e.preventDefault();
  const p = current();
  if (!p) return;
  try {
    const next = confirmIntent(p, $("intentText").value);
    delete next.intentDraft;
    state.projects = state.projects.map((x) => (x.id === p.id ? next : x));
    const saved = persist();
    render();
    notify(
      saved
        ? "내가 선택한 의도를 기록했어요."
        : "의도는 현재 화면에 남아 있지만 기기에 저장하지 못했어요.",
    );
  } catch (e) {
    notify(e.message);
  }
};
async function call(action, body, bearer, signal) {
  const res = await fetch("/api/service?action=" + action, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(bearer ? { Authorization: "Bearer " + bearer } : {}),
    },
    body: JSON.stringify(body),
    signal,
  });
  let data;
  try {
    data = await res.json();
  } catch {
    throw Error("서버 응답을 읽지 못했어요.");
  }
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      session = null;
      connection();
    }
    throw Error(
      friendlyError(data?.error?.code, res.status, data?.error?.refills_at),
    );
  }
  return data;
}
async function answer() {
  const p = current();
  if (!p || controller) return;
  connection();
  if (!session) {
    $("connectDialog").showModal();
    return;
  }
  const id = p.id,
    attempt = ++generation;
  controller = new AbortController();
  const activeController = controller;
  const timeout = setTimeout(() => activeController.abort(), 50000);
  setBusy(true);
  $("chatError").hidden = true;
  $("retry").hidden = true;
  try {
    const lastUser = p.messages.findLast((m) => m.role === "user");
    if (!lastUser) throw Error("먼저 생각을 남겨 주세요.");
    lastUser.id ??= crypto.randomUUID();
    persist();
    const data = await call(
      "chat",
      { messages: conversation(p), turn_id: lastUser.id },
      session.code,
      controller.signal,
    );
    const text = data.content;
    if (typeof text !== "string" || !text.trim())
      throw Error("AI 응답이 비어 있어요. 다시 시도해 주세요.");
    if (generation !== attempt || current()?.id !== id) return;
    const latest = current();
    latest.messages.push({ role: "assistant", content: text });
    latest.updatedAt = new Date().toISOString();
    persist();
    render();
    if (data.truncated)
      notify(
        "답변이 길어 일부만 도착했어요. 이어서 설명해 달라고 요청할 수 있어요.",
      );
  } catch (e) {
    if (generation !== attempt) return;
    $("chatError").textContent =
      e.name === "AbortError"
        ? "응답 대기 시간이 길어 중단했어요. 기록은 유지돼요."
        : e.message;
    $("chatError").hidden = false;
    $("retry").hidden = false;
  } finally {
    clearTimeout(timeout);
    if (generation === attempt) {
      controller = null;
      setBusy(false);
    }
  }
}
function send(text) {
  const p = current();
  text = text.trim();
  if (!p || !text || text.length > 4000 || controller) return;
  if (p.messages.length >= 200) {
    notify("대화가 길어졌어요. 의도를 기록하고 새 생각으로 이어가 주세요.");
    return;
  }
  p.messages.push({ id: crypto.randomUUID(), role: "user", content: text });
  p.draft = "";
  p.updatedAt = new Date().toISOString();
  persist();
  render();
  answer();
}
$("messageForm").onsubmit = (e) => {
  e.preventDefault();
  send($("message").value);
};
$("retry").onclick = answer;
$("cancel").onclick = () => {
  stop();
  $("chatError").textContent =
    "응답을 중단했어요. 입력은 남아 있어요. 서버에서 이미 처리한 사용량은 발생할 수 있어요.";
  $("chatError").hidden = false;
  $("retry").hidden = false;
};
$("example").onclick = () =>
  send(
    "내 생각을 확인할 수 있는 작은 예시 하나를 보여 줘. 아직 실제 제작이나 배포를 하지 말고 설명해 줘.",
  );
$("reflect").onclick = () =>
  send("내가 놓친 다른 사람의 관점에서 짧은 질문 하나를 해 줘.");
$("experiment").onclick = () => {
  tab("chat");
  send(
    "내가 확인한 의도를 검증하기 위해 실제 사람에게 해볼 가장 작은 실험 하나를 함께 정해 줘.",
  );
};
$("connect").onclick = () => $("connectDialog").showModal();
$("claim").onclick = async () => {
  if (!$("age").checked) {
    $("claimStatus").textContent = "연령과 전송 안내를 확인해 주세요.";
    return;
  }
  $("claim").disabled = true;
  $("claimStatus").textContent = "기존 무료 사용량을 확인하고 있어요…";
  const attempt = ++claimSequence;
  claimController = new AbortController();
  const activeClaim = claimController;
  const claimTimer = setTimeout(() => activeClaim.abort(), 20000);
  try {
    let id = localStorage.getItem("hp-mobile-install");
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem("hp-mobile-install", id);
    }
    const data = await call(
      "claim",
      { install_id: id, age_ok: true, app_version: "2026.1109.0" },
      null,
      activeClaim.signal,
    );
    if (typeof data.code !== "string")
      throw Error("무료 연결 정보를 확인하지 못했어요.");
    if (attempt !== claimSequence) return;
    session = { code: data.code, expires: Number(data.expires_at) };
    if (session.expires < 1e12) session.expires *= 1000;
    if (!Number.isFinite(session.expires) || session.expires <= Date.now()) {
      session = null;
      throw Error("무료 연결 유효기간을 확인하지 못했어요.");
    }
    claimController = null;
    $("connectDialog").close();
    $("claimStatus").textContent = "";
    connection();
    if (current()?.messages.at(-1)?.role === "user") answer();
  } catch (e) {
    if (attempt !== claimSequence) return;
    $("claimStatus").textContent =
      e.name === "AbortError"
        ? "연결 시간이 길어졌어요. 다시 시도해 주세요."
        : e.message;
  } finally {
    clearTimeout(claimTimer);
    if (claimController === activeClaim) claimController = null;
    $("claim").disabled = false;
  }
};
function download(value, name) {
  const url = URL.createObjectURL(
    new Blob(
      [typeof value === "string" ? value : JSON.stringify(value, null, 2)],
      { type: "application/json" },
    ),
  );
  const a = element("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
$("exportProject").onclick = () => download(current(), "hp-intent.json");
$("exportAll").onclick = () => {
  if (corruptRaw !== null)
    download(
      { unreadableStoredData: corruptRaw, currentRecords: state },
      "hp-records-recovery.json",
    );
  else download(state, "hp-studio-records.json");
};
$("deleteProject").onclick = () => {
  if (!confirm("이 생각의 대화와 의도 기록을 이 기기에서 삭제할까요?")) return;
  stop();
  const candidate = {
    ...state,
    projects: state.projects.filter((p) => p.id !== state.active),
    active: null,
  };
  if (persist(candidate)) {
    state = candidate;
    render();
  } else
    notify(
      "기록을 삭제하지 못했어요. 내보내기로 보관한 뒤 설정에서 전체 삭제를 시도해 주세요.",
    );
};
$("eraseAll").onclick = () => {
  if (
    !confirm(
      "이 기기에 저장된 모든 대화와 의도를 삭제할까요? 이 작업은 되돌릴 수 없어요.",
    )
  )
    return;
  stop();
  session = null;
  try {
    localStorage.removeItem(KEY);
    storageFailed = false;
    storageUnreadable = false;
    corruptRaw = null;
    state = fresh();
    $("settings").close();
    render();
    notify("이 기기의 기록을 삭제했어요.");
  } catch {
    notify(
      "삭제하지 못했어요. 브라우저 설정에서 사이트 데이터를 확인해 주세요.",
    );
  }
};
$("disconnect").onclick = () => {
  stop();
  session = null;
  connection();
  notify("현재 앱의 AI 연결을 끊었어요.");
};
$("connectDialog").addEventListener("cancel", cancelClaim);
$("connectDialog").addEventListener("close", () => {
  if (claimController) {
    cancelClaim();
    $("claimStatus").textContent =
      "연결을 취소했어요. 생각을 전송하지 않았어요.";
  }
});
$("settingsOpen").onclick = () => $("settings").showModal();
for (const b of document.querySelectorAll("[data-close]"))
  b.onclick = () => {
    if (b.dataset.close === "connectDialog") cancelClaim();
    $(b.dataset.close).close();
  };
window.addEventListener("storage", (e) => {
  if (e.key !== KEY) return;
  stop();
  try {
    state = restore(e.newValue);
    storageFailed = false;
    storageUnreadable = false;
    corruptRaw = null;
    render();
    notify("다른 창에서 변경한 기록을 반영했어요.");
  } catch {
    storageFailed = true;
    storageUnreadable = true;
    corruptRaw = e.newValue;
    notify("다른 창의 기록을 읽지 못했어요.");
  }
});
render();
if ("serviceWorker" in navigator)
  navigator.serviceWorker.register("/sw.js").catch(() => {});
