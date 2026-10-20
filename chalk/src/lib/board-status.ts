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
.cgp-state {display:inline-flex;align-items:center;gap:4px;padding:3px 7px;border:1px solid #94a3b8;border-radius:6px;background:#17212b;color:#e2e8f0;font-size:14px;line-height:1.5;white-space:normal}
.cgp-working {border-color:#93c5fd;color:#bfdbfe}
.cgp-blocked {border-color:#fca5a5;color:#fecaca}
.cgp-review {border-color:#fcd34d;color:#fde68a}
.cgp-idle {border-color:#c4b5fd;color:#ddd6fe}
.cgp-done {border-color:#6ee7b7;color:#a7f3d0}
.cgp-unknown {border-style:dashed;border-color:#cbd5e1;color:#e2e8f0;background:#17212b}
.cgp-filters {display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}
.ops-top > .cgp-filters {grid-column:1 / -1}
.cgp-state-filter {display:inline-flex;align-items:center;gap:4px;width:auto;min-height:44px;margin:0;padding:5px 8px;border:1px solid #94a3b8;border-radius:8px;background:#17212b;color:#e2e8f0;font:inherit;font-size:14px;cursor:pointer}
.cgp-state-filter[aria-pressed="true"] {border-width:3px;padding:3px 6px;border-color:#e2e8f0}
.cgp-state-filter:focus-visible {outline:2px solid #93c5fd;outline-offset:2px}
.cgp-state-filter:has(.cgp-unknown) {border-style:dashed;border-color:#cbd5e1;color:#e2e8f0}
@media(forced-colors:active){.cgp-state,.cgp-state-filter {border-color:CanvasText;color:CanvasText;background:Canvas}.cgp-state-filter:focus-visible{outline-color:Highlight}}
`;

export function renderBoardStatusPage(html: string): string {
  return html.replace('/* BOARD_STATUS_CSS */',boardStatusCss)
    .replace('// BOARD_STATUS_SCRIPT',boardStatusScript);
}
