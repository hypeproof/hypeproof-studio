// #4048 (chalk#17) — wiring of the student-panel band, the palette item, and the two leave questions.
// Static checks: the band shows only with the host signal; the question after a report comes only from a sent report;
// the palette item is hidden outside the seat by its when clause. Behaviour is in rehearsal-seat.smoke.mjs.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
let failed = 0;
async function t(name, fn) {
  try { fn(); console.log(`  ok   ${name}`); }
  catch (err) { failed++; console.log(`  FAIL ${name}\n       ${err && err.message}`); }
}

const provider = read('src/chatPanelProvider.ts');
const ext = read('src/extension.ts');
const panel = read('webview-ui/src/ChatPanel.tsx');
const app = read('webview-ui/src/App.tsx');
const pkg = JSON.parse(read('package.json'));

await t('the config carries rehearsalSeat only in a rehearsal seat (absent otherwise)', () => {
  assert.match(provider, /\.\.\.\(seatBand \? \{ rehearsalSeat: true, rehearsalPanel: await this\.rehearsalPanelFor\(profile, local\?\.model\) \} : \{\}\)/);
  assert.match(provider, /const seatBand = await this\.rehearsalSeatBand\(\);/);
});

await t('the palette context key follows the same signal', () => {
  assert.match(provider, /setContext", "hypeproofChat\.rehearsalSeat", seatBand\)/);
});

await t('the leave question after a report comes only after a sent report', () => {
  assert.match(provider, /state: "sent", verdict: j\.verdict, reasons: j\.reasons \?\? \[\] \}\);\s*\/\/ #4048[^\n]*\n\s*await leaveRehearsalAfterReport\(\);/);
  // Not in the error branches: the only call sits after the sent post.
  const calls = provider.match(/leaveRehearsalAfterReport\(\)/g) ?? [];
  assert.equal(calls.length, 1, 'exactly one call site');
});

await t('the band button routes to the host question (rehearsalSeatEnd → leaveRehearsalWithoutReport)', () => {
  assert.match(provider, /case "rehearsalSeatEnd": \{\s*await leaveRehearsalWithoutReport\(\);/);
  assert.match(ext, /registerCommand\("hypeproof-chat\.endRehearsalSeat", \(\) => leaveRehearsalWithoutReport\(\)\)/);
});

await t('the palette item is hidden outside the seat by its when clause and listed as a command', () => {
  const item = pkg.contributes.menus.commandPalette.find((m) => m.command === 'hypeproof-chat.endRehearsalSeat');
  assert.ok(item, 'commandPalette entry exists');
  assert.equal(item.when, 'hypeproofChat.rehearsalSeat');
  assert.ok(pkg.contributes.commands.some((c) => c.command === 'hypeproof-chat.endRehearsalSeat' && c.title === '리허설 끝내고 강사로 돌아가기'));
});

await t('the webview band is drawn only from the config flag and calls the host on its button', () => {
  // The band rides in the banner slot, and only a rehearsal signal puts it there (no new sibling without the signal).
  assert.match(panel, /const updateBanner = config\?\.rehearsalSeat \? \(\n\s*<>\{updateBannerCore\}<RehearsalSeatBand visible onEnd=\{props\.onEndRehearsalSeat \?\? \(\(\) => undefined\)\} panel=\{config\.rehearsalPanel\} onInsertExpected=\{insertExpected\} \/><\/>\n\s*\) : updateBannerCore;/);
  assert.doesNotMatch(panel, /<RehearsalSeatBand visible=\{!!config/, 'no separate sibling band');
  assert.match(app, /onEndRehearsalSeat=\{\(\) => postToHost\(\{ type: "rehearsalSeatEnd" \}\)\}/);
});

await t('the approved band texts are in the component', () => {
  assert.match(panel, /<span className="hps-rehearsal-seat-label">리허설 중<\/span>/);
  assert.match(panel, /끝내고 돌아가기/);
});

if (failed) { console.log(`\n${failed} failed`); process.exit(1); }
console.log('\nall rehearsal-seat-wiring checks passed');
