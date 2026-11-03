// DES-CGP-DS-23: parse the served stylesheet, not JavaScript/source regexes.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { staticTokens } from '../../extensions/hypeproof-chat/test/lib/expand-design-tokens.mjs';
import '@hypeproof/service-testkit/test/harness/loader.mjs';
const require = createRequire(import.meta.url);
const postcss = require('postcss');
const moduleUrl = process.env.LIST_ROWS_SOURCE ? pathToFileURL(process.env.LIST_ROWS_SOURCE) : new URL('../src/lib/list-rows.ts', import.meta.url);
const {listRowsCss, withListRows} = await import(moduleUrl);
const expand = staticTokens(readFileSync(new URL('../../extensions/hypeproof-chat/webview-ui/src/designTokens.css', import.meta.url),'utf8'));
const tree = postcss.parse(expand(listRowsCss));
function value(selector, prop, media='') {
 let result;
 tree.walkRules(r => {
  if (r.selector !== selector || (r.parent.type === 'atrule' ? r.parent.params : '') !== media) return;
  r.walkDecls(prop, d => { result=d.value; });
 });
 return result;
}
const actions=':is(tbody,#steps>.step,#learning-completion,#retro-sources,#retro-findings,#retro-decisions,#records,#overview,.ledger-card,.ledger-shelf-row,#ops-dist-list,#ops-dist-object,#ops-reports-list,.track,.flow,.flow-more) :is(button,a,summary), li :is(button,summary), .tok-copy, [data-copy-lab]';
const icons=actions.replace(' :is(button,a,summary), li :is(button,summary),', ' :is(button,a)::before, li :is(button,summary)::before,').replace('.tok-copy,','.tok-copy::before,').replace('[data-copy-lab]','[data-copy-lab]::before');
// A forced row height squeezes /manage's responsive grid cards; only non-seat table rows get a floor.
assert.equal(value('tbody tr','height'),undefined,'no forced height on every table row');
assert.equal(value('tbody tr:not(.ops-seat)','min-height'),'44px','static table row floor');
assert.equal(value('li:has(button,summary), #steps>.step, #overview>section>div','min-height'),'44px','list row floor');
assert.equal(value('li','min-height'),undefined,'prose list items are not list rows');
assert.ok(!actions.includes('li a')&&!actions.includes('li,'),'inline prose links in li are not list actions');
assert.equal(value('.ops-seat .seat-open','white-space'),'nowrap','short seat action label never wraps');
assert.equal(value(actions,'min-height'),'44px','every list action target');
const actionRule=tree.nodes.find(r=>r.selector===actions);
assert.equal(actionRule.nodes.find(d=>d.prop==='min-height').important,true,'floor wins over page density rules');
assert.equal(value(actions,'flex-direction'),'row','seat icon stays beside its label');
assert.equal(value(actions,'align-items'),'center');
assert.equal(value(actions,'justify-content'),'flex-start','sidebar icon and title stay together');
assert.equal(value(actions,'white-space'),'normal','short Korean words wrap instead of clipping');
assert.equal(value(actions,'overflow-wrap'),'anywhere','long identifiers wrap');
assert.equal(value(icons,'content'),'""','decorative icon does not alter accessible name');
assert.equal(value(icons,'display'),'inline-block','persistent icon');
assert.equal(value(icons,'width'),'16px');assert.equal(value(icons,'height'),'16px');
assert.equal(value(icons,'background'),'currentColor');
for(const prop of ['mask','-webkit-mask']) {
 const icon=value(icons,prop);assert.ok(icon?.includes('data:image/svg+xml'), 'drawn SVG action icon '+prop);
 assert.ok(decodeURIComponent(icon).includes("M3 8h10M9 4l4 4-4 4"),'arrow path '+prop);
}
for(const prop of ['mask-image','-webkit-mask-image']) {
 assert.equal(value('.side, #ops-seats, .ri-table-wrap, .scroll, #confirm-diff-lines',prop),'linear-gradient(to bottom,transparent,#e1e1e1 16px,#e1e1e1 calc(100% - 32px),transparent)','16px/32px scroll fade '+prop);
 assert.equal(value('.side:focus-within, #ops-seats:focus-within, .ri-table-wrap:focus-within, .scroll:focus-within, #confirm-diff-lines:focus-within',prop),'none','keyboard controls never faded '+prop);
 assert.equal(value('.side, #ops-seats, .ri-table-wrap, .scroll, #confirm-diff-lines',prop,'(forced-colors:active)'),'none','high contrast never faded '+prop);
}
assert.equal(value('.side, #ops-seats, .ri-table-wrap, .scroll, #confirm-diff-lines','padding-block'),'16px 32px','end rows outside faded edges');
assert.equal(value('.side, #ops-seats, .ri-table-wrap, .scroll, #confirm-diff-lines','scroll-padding-block'),'16px 32px');
assert.equal(value(icons,'background','(forced-colors:active)'),'ButtonText');
assert.equal(value(icons,'forced-color-adjust','(forced-colors:active)'),'none');
// No visibility or focusability rewrite, including hidden/pending/disabled controls.
tree.walkDecls(d => assert.ok(!['opacity','visibility','pointer-events','outline','overflow','text-overflow'].includes(d.prop), 'no action concealment: '+d.prop));
assert.equal(value(actions,'display'),undefined,'native hidden state remains authoritative');
assert.equal(value(icons,'margin-inline-end'),'8px','icon does not collide with label');
const {default:app}=await import('../src/index.ts');
for(const route of ['console','start','issuer','board','authoring','manage','budgets','sharing','learn']) {
 const response=await app.fetch(new Request('https://chalk.test/'+route),{ENVIRONMENT:'test'});
 const html=await response.text();
 assert.equal(response.status,200);
 assert.equal(html.split('<style data-list-rows>').length,2,route+' mounts list styling exactly once');
 assert.ok(html.includes(withListRows('').trim()),route+' serves the tested stylesheet');
}
console.log('list rows: row floors, persistent icons, wrapping, fade, focus/HC guards, all nine routes PASS');
