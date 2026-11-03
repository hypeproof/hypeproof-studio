// DES-CGP-LEARN-13 / REQ-CGP-LEARN-13 — the instructor side of a safety block on /manage.
//
// Contract (DEC-LEARN-13b): a seat in the Service's `/classroom/runs/:sid/status` answer may carry
// `safety: { category: "self_harm", at: <epoch ms or s> }` when that seat's input was blocked for
// self-harm. Category, time and seat only — never the matched text (REQ-O5). Chalk draws each such
// seat as a pinned item above the seat list: amber + icon + the words "안전 확인 필요" (SX-50).
// It never feeds the status chips, the summary counts, the filters or any ranking/score column.
// An item stays pinned across polls (and across a failed poll) until the instructor presses
// "확인했어요"; a newer block on the same seat pins again. Memory only: nothing is stored.

/** Self-contained browser script: stored as text so Worker bundling cannot add closure helpers. */
export const safetySignalScript = `const safetySignal = (function safetySignalUI() {
  const LABEL = "안전 확인 필요", ICON = "⚠";
  const CATEGORY = { self_harm: "자해·자살 관련 입력이 차단됨" };
  const ID = /^[A-Za-z0-9_.:-]{1,128}$/, MAX = 50;
  let pinned = new Map(), acked = new Set(), run = null;
  function items(seats) {
    const out = [];
    for (const s of Array.isArray(seats) ? seats : []) {
      const f = s && typeof s === "object" ? s.safety : null;
      if (!f || typeof f !== "object" || typeof f.category !== "string" || !Object.hasOwn(CATEGORY, f.category)) continue;
      if (typeof s.seat_id !== "string" || !ID.test(s.seat_id)) continue;
      if (typeof f.at !== "number" || !Number.isFinite(f.at) || f.at <= 0) continue;
      const at = f.at < 1e11 ? f.at * 1000 : f.at;
      if (at > 4102444800000) continue; // past 2100: not a time this page can show
      out.push({ key: s.seat_id + "|" + at, seat_id: s.seat_id, student_id: typeof s.student_id === "string" && ID.test(s.student_id) ? s.student_id : "", category: f.category, at });
    }
    return out;
  }
  function update(runId, seats) {
    if (runId !== run) { pinned = new Map(); acked = new Set(); run = runId; }
    for (const it of items(seats)) if (!acked.has(it.key) && !pinned.has(it.key)) pinned.set(it.key, it);
    return list();
  }
  function list() { return [...pinned.values()].sort((a, b) => b.at - a.at).slice(0, MAX); }
  function ack(key) { if (pinned.delete(key)) acked.add(key); }
  function reset() { pinned = new Map(); acked = new Set(); run = null; }
  function flag() {
    const el = document.createElement("span");
    el.className = "safety-flag";
    const icon = document.createElement("span");
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = ICON;
    el.append(icon, document.createTextNode(" " + LABEL));
    return el;
  }
  function render(region, listEl, opts) {
    const shown = list();
    listEl.replaceChildren();
    for (const it of shown) {
      const li = document.createElement("li");
      li.className = "safety-item";
      li.setAttribute("data-seat", it.seat_id);
      const what = document.createElement("span");
      what.className = "safety-what";
      what.textContent = it.seat_id + (it.student_id ? " · " + it.student_id : "") + " — " + CATEGORY[it.category] + " · " + new Date(it.at).toLocaleTimeString([], { hour12: false });
      li.append(flag(), what);
      if (opts && opts.hasSeat && opts.hasSeat(it.seat_id) && opts.openSeat) {
        const open = document.createElement("button");
        open.type = "button";
        open.textContent = "좌석 상세";
        open.onclick = () => opts.openSeat(it.seat_id);
        li.append(open);
      }
      const done = document.createElement("button");
      done.type = "button";
      done.textContent = "확인했어요";
      done.setAttribute("aria-label", it.seat_id + " 안전 확인 완료");
      done.onclick = () => { ack(it.key); render(region, listEl, opts); if (opts && opts.afterAck) opts.afterAck(); };
      li.append(done);
      listEl.append(li);
    }
    region.hidden = shown.length === 0;
    return shown.length;
  }
  return { LABEL, ICON, CATEGORY, items, update, list, ack, reset, render };
})();`;

export const safetySignalCss = `
.safety-pin {margin:var(--ds-c-chalk-safety-signal-space-2) 0;padding:var(--ds-c-chalk-safety-signal-space-7) var(--ds-c-chalk-safety-signal-space-1);border:var(--ds-c-chalk-safety-signal-size-7) solid var(--ds-c-chalk-safety-signal-boundary-98);border-radius:var(--ds-c-chalk-safety-signal-radius-10);background:var(--ds-c-chalk-safety-signal-surface-88);color:var(--ds-c-chalk-safety-signal-ink-105)}
.safety-pin[hidden] {display:none}
.safety-pin h3 {margin:0 0 var(--ds-c-chalk-safety-signal-space-13);font-size:var(--ds-c-chalk-safety-signal-type-2)}
.safety-note {margin:0 0 var(--ds-c-chalk-safety-signal-space-15);font-size:var(--ds-c-chalk-safety-signal-type-17);color:var(--ds-c-chalk-safety-signal-ink-111)}
.safety-list {list-style:none;margin:0;padding:0}
.safety-item {display:flex;flex-wrap:wrap;align-items:center;gap:var(--ds-c-chalk-safety-signal-space-2);padding:var(--ds-c-chalk-safety-signal-space-15) 0;font-size:var(--ds-c-chalk-safety-signal-type-17);line-height:var(--ds-c-chalk-safety-signal-typography-5)}
.safety-flag {display:inline-flex;align-items:center;gap:var(--ds-c-chalk-safety-signal-space-13);padding:var(--ds-c-chalk-safety-signal-space-11) var(--ds-c-chalk-safety-signal-space-12);border:var(--ds-c-chalk-safety-signal-size-3) solid var(--ds-c-chalk-safety-signal-boundary-98);border-radius:var(--ds-c-chalk-safety-signal-radius-3);background:var(--ds-c-chalk-safety-signal-surface-127);color:var(--ds-c-chalk-safety-signal-ink-108);font-size:var(--ds-c-chalk-safety-signal-type-17);font-weight:var(--ds-c-chalk-safety-signal-typography-7);white-space:nowrap}
.safety-item button {min-height:var(--ds-c-chalk-safety-signal-size-8);min-width:var(--ds-c-chalk-safety-signal-size-8);margin:0;padding:var(--ds-c-chalk-safety-signal-space-15) var(--ds-c-chalk-safety-signal-space-1);border:var(--ds-c-chalk-safety-signal-size-3) solid var(--ds-c-chalk-safety-signal-boundary-90);border-radius:var(--ds-c-chalk-safety-signal-radius-10);background:var(--ds-c-chalk-safety-signal-surface-127);color:var(--ds-c-chalk-safety-signal-ink-105);font:inherit;font-size:var(--ds-c-chalk-safety-signal-type-17);cursor:pointer}
.safety-item button:focus-visible {outline:var(--ds-c-chalk-safety-signal-size-7) solid var(--ds-c-chalk-safety-signal-boundary-91);outline-offset:var(--ds-c-chalk-safety-signal-size-7)}
@media(forced-colors:active){.safety-pin,.safety-flag,.safety-item button {border-color:CanvasText;color:CanvasText;background:Canvas}.safety-item button:focus-visible{outline-color:Highlight}}
`;

export function renderSafetySignal(html: string): string {
  return html.replace('/* SAFETY_SIGNAL_CSS */', safetySignalCss)
    .replace('// SAFETY_SIGNAL_SCRIPT', safetySignalScript);
}
