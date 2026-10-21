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
.safety-pin {margin:8px 0;padding:10px 12px;border:2px solid #f5c36b;border-radius:8px;background:#151c22;color:#e2e8f0}
.safety-pin[hidden] {display:none}
.safety-pin h3 {margin:0 0 4px;font-size:15px}
.safety-note {margin:0 0 6px;font-size:14px;color:#cbd5e1}
.safety-list {list-style:none;margin:0;padding:0}
.safety-item {display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:6px 0;font-size:14px;line-height:1.5}
.safety-flag {display:inline-flex;align-items:center;gap:4px;padding:3px 7px;border:1px solid #f5c36b;border-radius:6px;background:#17212b;color:#fde68a;font-size:14px;font-weight:600;white-space:nowrap}
.safety-item button {min-height:44px;min-width:44px;margin:0;padding:6px 12px;border:1px solid #94a3b8;border-radius:8px;background:#17212b;color:#e2e8f0;font:inherit;font-size:14px;cursor:pointer}
.safety-item button:focus-visible {outline:2px solid #93c5fd;outline-offset:2px}
@media(forced-colors:active){.safety-pin,.safety-flag,.safety-item button {border-color:CanvasText;color:CanvasText;background:Canvas}.safety-item button:focus-visible{outline-color:Highlight}}
`;

export function renderSafetySignal(html: string): string {
  return html.replace('/* SAFETY_SIGNAL_CSS */', safetySignalCss)
    .replace('// SAFETY_SIGNAL_SCRIPT', safetySignalScript);
}
