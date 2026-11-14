// CGP-SHELL-R-019: the host side of the 팁 보기 choice, kept per seat (classroom PCs are shared).
//   node --experimental-strip-types test/lesson-tips-host.smoke.mjs
// Drives the exact class the provider uses (LessonTipsPreference) over a fake globalState, in the order the
// provider calls it (forSeat on each config build, write on a press, on for the config):
// - learner A turns tips off; learner B on the same window still sees tips; A signing in again still has them off;
// - an empty seat keeps its choice in memory only (nothing stored) and loses it on any seat switch;
// - a junk stored value never turns tips off; the list is bounded;
// - the provider wires it that way (source), the seat id is the collapsed-blocks seat, nothing is synced.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LESSON_TIPS_KEY, LESSON_TIPS_SEATS_MAX, LessonTipsPreference, lessonTipsOn, lessonTipsStore, withLessonTips } from '../src/lessonTips.ts';
import { collapseSeat } from '../src/lessonFocus.ts';

const A = collapseSeat({ activityId: 'a'.repeat(64) }), B = collapseSeat({ activityId: 'b'.repeat(64) }), NONE = collapseSeat({});
assert.ok(A && B && A !== B && NONE === '', 'seat ids from the same function the collapse state uses');

// A fake globalState and the provider's call order.
const store = new Map();
const pref = new LessonTipsPreference();
const config = (seat) => { pref.forSeat(seat); return pref.on(store.get(LESSON_TIPS_KEY)); };
const press = (on) => { const next = pref.write(store.get(LESSON_TIPS_KEY), on); if (next) store.set(LESSON_TIPS_KEY, next); };

assert.equal(config(A), true, 'A starts with tips on');
press(false);
assert.equal(config(A), false, 'A turned tips off');
assert.equal(config(B), true, 'learner B on the same window still sees tips');
assert.equal(config(A), false, 'A signing in again still has them off');
press(true);
assert.equal(config(A), true, 'A turned them back on');
assert.deepEqual(store.get(LESSON_TIPS_KEY), { off: [] }, 'stored: no seat off');

// An empty seat: memory only, never stored, gone on a seat switch.
config(B); press(false);
const before = JSON.stringify(store.get(LESSON_TIPS_KEY));
assert.equal(config(NONE), true, 'an empty seat does not inherit B');
press(false);
assert.equal(config(NONE), false, 'the empty seat turned tips off in memory');
assert.equal(JSON.stringify(store.get(LESSON_TIPS_KEY)), before, 'nothing stored for the empty seat');
assert.equal(config(A), true, 'another seat is unaffected');
assert.equal(config(NONE), true, 'and the in-memory choice did not survive the switch');
assert.equal(config(B), false, 'B is still off');

// Defensive reads and bounds.
for (const junk of [undefined, null, false, true, 'off', { off: 'x' }, { off: [1, null, {}] }, []]) assert.equal(lessonTipsOn(junk, A), true, `junk ${JSON.stringify(junk)} is on`);
let s = {};
for (let i = 0; i < LESSON_TIPS_SEATS_MAX + 5; i++) s = withLessonTips(s, `seat:${i}`, false);
assert.equal(lessonTipsStore(s).off.length, LESSON_TIPS_SEATS_MAX, 'bounded');
assert.equal(lessonTipsOn(s, 'seat:0'), true, 'the oldest seat drops off first (it sees tips again)');
assert.equal(lessonTipsOn(s, `seat:${LESSON_TIPS_SEATS_MAX + 4}`), false);
assert.deepEqual(withLessonTips({ off: [A, A, B] }, A, false).off, [B, A], 'de-duplicated, newest last');

// The provider wires the class this way.
const src = readFileSync(new URL('../src/chatPanelProvider.ts', import.meta.url), 'utf8');
const at = src.indexOf('case "setLessonTips":');
const body = src.slice(at, src.indexOf('return;', src.indexOf('postConfig', at)) + 7);
assert.match(body, /if \(typeof msg\.on !== "boolean"\) return;/, 'a non-boolean write is refused');
assert.match(body, /await this\.setLessonTips\(msg\.on\);/, 'the press goes through setLessonTips');
const setAt = src.indexOf('async setLessonTips(on: boolean)');
const setBody = src.slice(setAt, src.indexOf('\n  }', setAt));
assert.match(setBody, /this\.lessonTips\.write\(this\.context\.globalState\.get\(LESSON_TIPS_KEY\), on === true\)/, 'through the class');
assert.match(setBody, /if \(next\) await this\.context\.globalState\.update\(LESSON_TIPS_KEY, next\)/, 'only a seat stores anything');
assert.match(src, /lessonTipsState\(\): \{ on: boolean; seat: string \} \{\s*return \{ on: this\.lessonTips\.on\(this\.context\.globalState\?\.get\(LESSON_TIPS_KEY\)\), seat: this\.lessonTips\.currentSeat \};/, 'the start page reads the same seat and state');
{ const p = new LessonTipsPreference(); p.forSeat(A); assert.equal(p.currentSeat, A, 'currentSeat is the seat of the last config'); }
assert.match(src, /const tipsSeat = collapseSeat\(\{ activityId: profile\?\.activity_id, entryId, localActivityId: activity\?\.id \}\);\s*this\.lessonTips\.forSeat\(tipsSeat\);/, 'the seat is the collapsed-blocks seat, set on every config build');
assert.match(src, /lessonTips: this\.lessonTips\.on\(this\.context\.globalState\?\.get\(LESSON_TIPS_KEY\)\)/, 'config reads the seat\'s choice');
assert.ok(!/setKeysForSync\([^)]*LESSON_TIPS_KEY/.test(src), 'never synced');
// Negative control: a preference that ignores the seat (the device-wide design this replaced) fails the A/B check.
class DeviceWide extends LessonTipsPreference { forSeat() { super.forSeat('device'); } }
{
  const st = new Map(), p = new DeviceWide();
  const cfg = (seat) => { p.forSeat(seat); return p.on(st.get(LESSON_TIPS_KEY)); };
  cfg(A); const n = p.write(st.get(LESSON_TIPS_KEY), false); if (n) st.set(LESSON_TIPS_KEY, n);
  assert.equal(cfg(B), false, 'control: device-wide storage hides B\'s tips, which the A/B assertion above rejects');
}
console.log('PASS lesson tips host: per seat (A off, B on, A again off), empty seat memory-only and reset on switch, junk is on, bounded, wired through LessonTipsPreference with the collapse seat, never synced');
