// DES-CGP-DS-23: presentation only. Native controls retain their names, handlers and tab order.
export const listRowsCss = `
/* Row height comes from the 44px action targets inside the row. Never force a height on a seat row:
   /manage turns .ops-seat into a grid card below 760px and a fixed height squeezes it.
   Static table rows are not responsive and keep a plain 44px floor.
   Only list rows are scoped: inline prose links (<li><a>..</a>text) keep their inline box (WCAG 2.5.8 inline exception). */
tbody tr:not(.ops-seat) {height:var(--ds-c-chalk-list-row);min-height:var(--ds-c-chalk-list-row)}
li:has(button,summary), #steps>.step, #overview>section>div {min-height:var(--ds-c-chalk-list-row)}
/* The seat row is exactly the 44px target: the 1px divider is drawn by a cell pseudo-element, so it adds no layout height
   (a 44px target + 1px cell border made every row 45px and cost the 8th complete row at 1280x720, e2e/classroom/ops-g1-layout.mjs). */
.ops-seat>td {border-bottom-width:0!important;position:relative}
.ops-seat>td::after {content:"";position:absolute;inset:auto 0 0 0;height:0;border-top:var(--ds-c-chalk-manage-size-3) solid var(--ink-line)}
.ops-seat .seat-open {white-space:nowrap!important;margin-inline:0;padding-inline:var(--ds-c-chalk-list-gap)}
.ops-seat .seat-open::before {margin-inline-end:calc(var(--ds-c-chalk-list-gap) / 2)!important}
:is(tbody,#steps>.step,#learning-completion,#retro-sources,#retro-findings,#retro-decisions,#records,#overview,.ledger-card,.ledger-shelf-row,#ops-dist-list,#ops-dist-object,#ops-reports-list,.track,.flow,.flow-more) :is(button,a,summary), li :is(button,summary), .tok-copy, [data-copy-lab] {
 min-height:var(--ds-c-chalk-list-row)!important;
 flex-direction:row;align-items:center;justify-content:flex-start;
 white-space:normal;overflow-wrap:anywhere;
}
:is(tbody,#steps>.step,#learning-completion,#retro-sources,#retro-findings,#retro-decisions,#records,#overview,.ledger-card,.ledger-shelf-row,#ops-dist-list,#ops-dist-object,#ops-reports-list,.track,.flow,.flow-more) :is(button,a)::before, li :is(button,summary)::before, .tok-copy::before, [data-copy-lab]::before {
 content:"";display:inline-block;flex:none;vertical-align:middle;margin-inline-end:var(--ds-c-chalk-list-gap);width:var(--ds-c-chalk-list-icon-size);height:var(--ds-c-chalk-list-icon-size);
 background:currentColor;mask:var(--ds-c-chalk-list-action-icon) center / contain no-repeat;
 -webkit-mask:var(--ds-c-chalk-list-action-icon) center / contain no-repeat;
}
/* Fade only scrolling lists, not the whole page. Keyboard focus must never be faded. */
.side, #ops-seats, .ri-table-wrap, .scroll, #confirm-diff-lines {
 mask-image:linear-gradient(to bottom,transparent,var(--ds-c-chalk-list-mask-ink) var(--ds-c-chalk-list-icon-size),var(--ds-c-chalk-list-mask-ink) calc(100% - var(--ds-c-chalk-list-fade-bottom)),transparent);
 -webkit-mask-image:linear-gradient(to bottom,transparent,var(--ds-c-chalk-list-mask-ink) var(--ds-c-chalk-list-icon-size),var(--ds-c-chalk-list-mask-ink) calc(100% - var(--ds-c-chalk-list-fade-bottom)),transparent);
 padding-block:var(--ds-c-chalk-list-icon-size) var(--ds-c-chalk-list-fade-bottom);
 scroll-padding-block:var(--ds-c-chalk-list-icon-size) var(--ds-c-chalk-list-fade-bottom);
}
.side:focus-within, #ops-seats:focus-within, .ri-table-wrap:focus-within, .scroll:focus-within, #confirm-diff-lines:focus-within {mask-image:none;-webkit-mask-image:none}
@media (forced-colors:active) {
 .side, #ops-seats, .ri-table-wrap, .scroll, #confirm-diff-lines {mask-image:none;-webkit-mask-image:none}
 :is(tbody,#steps>.step,#learning-completion,#retro-sources,#retro-findings,#retro-decisions,#records,#overview,.ledger-card,.ledger-shelf-row,#ops-dist-list,#ops-dist-object,#ops-reports-list,.track,.flow,.flow-more) :is(button,a)::before, li :is(button,summary)::before, .tok-copy::before, [data-copy-lab]::before {background:ButtonText;forced-color-adjust:none}
}
`;

export function withListRows(html: string): string {
  // Last stylesheet wins over page-local density rules; no DOM or listener rewriting.
  return html + '<style data-list-rows>' + listRowsCss + '</style>';
}
