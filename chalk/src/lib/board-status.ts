/** Self-contained browser script: stored as text so Worker bundling cannot add closure helpers. */
export const boardStatusScript = `const boardStatus = (function boardStatusUI() {
  const states = {
    working: { label: "작업 중", icon: "play", detail: "최근 활동 또는 AI 실행이 관측됨" },
    blocked: { label: "막힘", icon: "ban", detail: "서버가 장애 또는 긴 대기를 보고함" },
    review: { label: "선생님 확인 필요", icon: "alert", detail: "도움 요청 또는 확인이 필요한 신호" },
    idle: { label: "쉬는 중", icon: "pause", detail: "앱이 AI 대기를 보고함 · 학생의 자리 비움 판단이 아님" },
    done: { label: "끝남", icon: "check", detail: "현재 기준의 단계 제출·검토 기록 · 수업 전체 완료가 아님" },
    unknown: { label: "확인 불가", icon: "help", detail: "현재 상태를 판단할 신호가 부족함" }
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
  // CGP-DS-D-004: 16px stroke icons drawn in currentColor, the same shapes as Studio's ChatIcon
  // (play, ban, alert, pause, check, help), so each state also reads apart in grayscale.
  const paths = {
    play: ["M8 5.5v13l10.5-6.5L8 5.5Z"],
    ban: ["M21 12a9 9 0 1 1-18 0a9 9 0 1 1 18 0Z", "m5.6 5.6 12.8 12.8"],
    alert: ["M10.3 4.2 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z", "M12 9.5v4.5M12 17.2v.01"],
    pause: ["M9 6v12M15 6v12"],
    check: ["m5 12 4 4L19 6"],
    help: ["M21 12a9 9 0 1 1-18 0a9 9 0 1 1 18 0Z", "M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .8-1 1.5v.4M12 16.8v.01"]
  };
  function icon(kind) {
    const ns = "http://www.w3.org/2000/svg", svg = document.createElementNS(ns, "svg");
    for (const [k, v] of [["viewBox", "0 0 24 24"], ["width", "16"], ["height", "16"], ["fill", "none"], ["stroke", "currentColor"], ["stroke-width", "1.7"], ["stroke-linecap", "round"], ["stroke-linejoin", "round"], ["aria-hidden", "true"], ["focusable", "false"], ["class", "cgp-state-icon"], ["data-icon", kind]]) svg.setAttribute(k, v);
    for (const d of paths[kind]) { const path = document.createElementNS(ns, "path"); path.setAttribute("d", d); svg.append(path); }
    return svg;
  }
  function chip(key) {
    const actual = Object.hasOwn(states, key) ? key : "unknown", state = states[actual];
    const el = document.createElement("span");
    el.className = "cgp-state cgp-" + actual;
    el.title = state.detail;
    const label = document.createElement("span");
    label.className = "cgp-state-label";
    label.textContent = state.label;
    el.append(icon(state.icon), label);
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
.cgp-state {display:inline-flex;align-items:center;gap:var(--ds-c-status-chip-gap);min-width:0;max-width:100%;padding:var(--ds-c-chalk-board-status-space-11) var(--ds-c-status-chip-pad-inline);border:var(--ds-c-chalk-board-status-size-3) solid var(--ds-c-chalk-board-status-boundary-90);border-radius:var(--ds-c-status-chip-radius);background:var(--ds-c-chalk-board-status-surface-127);color:var(--ds-c-chalk-board-status-ink-105);font-size:var(--ds-c-status-chip-label);line-height:var(--ds-c-chalk-board-status-typography-5);white-space:normal;word-break:keep-all;overflow-wrap:anywhere}
.cgp-state-icon {flex:none;width:var(--ds-c-status-chip-icon);height:var(--ds-c-status-chip-icon)}
.cgp-working {border-color:var(--ds-c-chalk-board-status-boundary-91);color:var(--ds-c-chalk-board-status-ink-106);background:color-mix(in srgb, var(--ds-c-chalk-board-status-boundary-91) 14%, var(--ds-c-chalk-board-status-surface-127))}
.cgp-blocked {border-color:var(--ds-c-chalk-board-status-boundary-92);color:var(--ds-c-chalk-board-status-ink-107);background:color-mix(in srgb, var(--ds-c-chalk-board-status-boundary-92) 14%, var(--ds-c-chalk-board-status-surface-127))}
.cgp-review {border-color:var(--ds-c-chalk-board-status-boundary-93);color:var(--ds-c-chalk-board-status-ink-108);background:color-mix(in srgb, var(--ds-c-chalk-board-status-boundary-93) 14%, var(--ds-c-chalk-board-status-surface-127))}
.cgp-idle {border-color:var(--ds-c-chalk-board-status-boundary-94);color:var(--ds-c-chalk-board-status-ink-109);background:color-mix(in srgb, var(--ds-c-chalk-board-status-boundary-94) 14%, var(--ds-c-chalk-board-status-surface-127))}
.cgp-done {border-color:var(--ds-c-chalk-board-status-boundary-95);color:var(--ds-c-chalk-board-status-ink-110);background:color-mix(in srgb, var(--ds-c-chalk-board-status-boundary-95) 14%, var(--ds-c-chalk-board-status-surface-127))}
.cgp-unknown {border-style:dashed;border-color:var(--ds-c-chalk-board-status-boundary-96);color:var(--ds-c-chalk-board-status-ink-105);background:color-mix(in srgb, var(--ds-c-chalk-board-status-boundary-96) 10%, var(--ds-c-chalk-board-status-surface-127))}
.cgp-filters {display:flex;flex-wrap:wrap;gap:var(--ds-c-chalk-board-status-space-15);margin:var(--ds-c-chalk-board-status-space-2) 0}
.ops-top > .cgp-filters {grid-column:1 / -1}
.cgp-state-filter {display:inline-flex;align-items:center;gap:var(--ds-c-chalk-board-status-space-13);width:auto;min-height:var(--ds-c-chalk-board-status-size-8);margin:0;padding:var(--ds-c-chalk-board-status-space-16) var(--ds-c-chalk-board-status-space-2);border:var(--ds-c-chalk-board-status-size-3) solid var(--ds-c-chalk-board-status-boundary-90);border-radius:var(--ds-c-chalk-board-status-radius-10);background:var(--ds-c-chalk-board-status-surface-127);color:var(--ds-c-chalk-board-status-ink-105);font:inherit;font-size:var(--ds-c-chalk-board-status-type-17);cursor:pointer}
.cgp-state-filter[aria-pressed="true"] {border-width:var(--ds-c-chalk-board-status-size-15);padding:var(--ds-c-chalk-board-status-space-11) var(--ds-c-chalk-board-status-space-15);border-color:var(--ds-c-chalk-board-status-boundary-97)}
.cgp-state-filter:focus-visible {outline:var(--ds-c-chalk-board-status-size-7) solid var(--ds-c-chalk-board-status-boundary-91);outline-offset:var(--ds-c-chalk-board-status-size-7)}
.cgp-state-filter:has(.cgp-unknown) {border-style:dashed;border-color:var(--ds-c-chalk-board-status-boundary-96);color:var(--ds-c-chalk-board-status-ink-105)}
@media(forced-colors:active){.cgp-state,.cgp-state-filter {border-color:CanvasText;color:CanvasText;background:Canvas}.cgp-state-icon{color:CanvasText}.cgp-state-filter:focus-visible{outline-color:Highlight}}
`;

export function renderBoardStatusPage(html: string): string {
  return html.replace('/* BOARD_STATUS_CSS */',boardStatusCss)
    .replace('// BOARD_STATUS_SCRIPT',boardStatusScript);
}
