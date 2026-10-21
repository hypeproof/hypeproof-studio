/** Self-contained browser script: stored as text so Worker bundling cannot add closure helpers. */
export const boardStatusScript = `const boardStatus = (function boardStatusUI() {
  const states = {
    working: { label: "작업 중", icon: "▶", detail: "최근 활동 또는 AI 실행이 관측됨" },
    blocked: { label: "막힘", icon: "×", detail: "서버가 장애 또는 긴 대기를 보고함" },
    review: { label: "선생님 확인 필요", icon: "!", detail: "도움 요청 또는 확인이 필요한 신호" },
    idle: { label: "쉬는 중", icon: "Ⅱ", detail: "앱이 AI 대기를 보고함 · 학생의 자리 비움 판단이 아님" },
    done: { label: "끝남", icon: "✓", detail: "현재 기준의 단계 제출·검토 기록 · 수업 전체 완료가 아님" },
    unknown: { label: "확인 불가", icon: "?", detail: "현재 상태를 판단할 신호가 부족함" }
  };
  function legacy(s) {
    const map = { ok: "working", failing: "blocked", stuck: "blocked", slowing: "review" };
    return Object.hasOwn(map, s?.state) ? map[s.state] : "unknown";
  }
  function ops(s, help = false) {
    if (s?.signal !== "fresh" || s?.attention === "unknown") return "unknown";
    const runtime = typeof s.sample?.received_at === "number" && (typeof s.runtime?.received_at !== "number" || s.sample.received_at > s.runtime.received_at) ? s.sample.runtime_status : s.runtime?.status;
    if (s.attention === "blocked" || runtime === "error") return "blocked";
    if (help || s.attention === "caution") return "review";
    if (runtime === "running") return "working";
    if (runtime === "waiting_approval" || runtime === "waiting_user") return "unknown";
    if (s.step?.basis === "current" && ["submitted", "reviewed"].includes(s.step?.status)) return "done";
    if (runtime === "idle") return "idle";
    return "unknown";
  }
  function chip(key) {
    const actual = Object.hasOwn(states, key) ? key : "unknown", state = states[actual];
    const el = document.createElement("span");
    el.className = "cgp-state cgp-" + actual;
    el.title = state.detail;
    const icon = document.createElement("span");
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = state.icon;
    el.append(icon, document.createTextNode(" " + state.label));
    return el;
  }
  function filters(container, keys, selected, change) {
    const focused = container.contains(document.activeElement) ? document.activeElement?.getAttribute("data-state") : null;
    container.replaceChildren();
    container.setAttribute("aria-label", "활동 상태 필터");
    for (const key of ["all", ...Object.keys(states)]) {
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("data-state", key);
      button.className = "cgp-state-filter";
      button.setAttribute("aria-pressed", String(selected === key));
      if (key === "all") button.append(document.createTextNode("전체"));
      else button.append(chip(key));
      button.append(document.createTextNode(" " + (key === "all" ? keys.length : keys.filter((x) => x === key).length)));
      button.onclick = () => change(selected === key ? "all" : key);
      container.append(button);
    }
    if (focused) container.querySelector('[data-state="' + focused + '"]')?.focus();
  }
  return { states, legacy, ops, chip, filters };
})();`;

export const boardStatusCss = `
.cgp-state {display:inline-flex;align-items:center;gap:var(--ds-c-chalk-board-status-space-13);padding:var(--ds-c-chalk-board-status-space-11) var(--ds-c-chalk-board-status-space-12);border:var(--ds-c-chalk-board-status-size-3) solid var(--ds-c-chalk-board-status-boundary-90);border-radius:var(--ds-c-chalk-board-status-radius-3);background:var(--ds-c-chalk-board-status-surface-127);color:var(--ds-c-chalk-board-status-ink-105);font-size:var(--ds-c-chalk-board-status-type-17);line-height:var(--ds-c-chalk-board-status-typography-5);white-space:normal}
.cgp-working {border-color:var(--ds-c-chalk-board-status-boundary-91);color:var(--ds-c-chalk-board-status-ink-106)}
.cgp-blocked {border-color:var(--ds-c-chalk-board-status-boundary-92);color:var(--ds-c-chalk-board-status-ink-107)}
.cgp-review {border-color:var(--ds-c-chalk-board-status-boundary-93);color:var(--ds-c-chalk-board-status-ink-108)}
.cgp-idle {border-color:var(--ds-c-chalk-board-status-boundary-94);color:var(--ds-c-chalk-board-status-ink-109)}
.cgp-done {border-color:var(--ds-c-chalk-board-status-boundary-95);color:var(--ds-c-chalk-board-status-ink-110)}
.cgp-unknown {border-style:dashed;border-color:var(--ds-c-chalk-board-status-boundary-96);color:var(--ds-c-chalk-board-status-ink-105);background:var(--ds-c-chalk-board-status-surface-127)}
.cgp-filters {display:flex;flex-wrap:wrap;gap:var(--ds-c-chalk-board-status-space-15);margin:var(--ds-c-chalk-board-status-space-2) 0}
.ops-top > .cgp-filters {grid-column:1 / -1}
.cgp-state-filter {display:inline-flex;align-items:center;gap:var(--ds-c-chalk-board-status-space-13);width:auto;min-height:var(--ds-c-chalk-board-status-size-8);margin:0;padding:var(--ds-c-chalk-board-status-space-16) var(--ds-c-chalk-board-status-space-2);border:var(--ds-c-chalk-board-status-size-3) solid var(--ds-c-chalk-board-status-boundary-90);border-radius:var(--ds-c-chalk-board-status-radius-10);background:var(--ds-c-chalk-board-status-surface-127);color:var(--ds-c-chalk-board-status-ink-105);font:inherit;font-size:var(--ds-c-chalk-board-status-type-17);cursor:pointer}
.cgp-state-filter[aria-pressed="true"] {border-width:var(--ds-c-chalk-board-status-size-15);padding:var(--ds-c-chalk-board-status-space-11) var(--ds-c-chalk-board-status-space-15);border-color:var(--ds-c-chalk-board-status-boundary-97)}
.cgp-state-filter:focus-visible {outline:var(--ds-c-chalk-board-status-size-7) solid var(--ds-c-chalk-board-status-boundary-91);outline-offset:var(--ds-c-chalk-board-status-size-7)}
.cgp-state-filter:has(.cgp-unknown) {border-style:dashed;border-color:var(--ds-c-chalk-board-status-boundary-96);color:var(--ds-c-chalk-board-status-ink-105)}
@media(forced-colors:active){.cgp-state,.cgp-state-filter {border-color:CanvasText;color:CanvasText;background:Canvas}.cgp-state-filter:focus-visible{outline-color:Highlight}}
`;

export function renderBoardStatusPage(html: string): string {
  return html.replace('/* BOARD_STATUS_CSS */',boardStatusCss)
    .replace('// BOARD_STATUS_SCRIPT',boardStatusScript);
}
