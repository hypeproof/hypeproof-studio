// CGP-SHELL-R-019: the host side of the 팁 보기 preference.
//   node --experimental-strip-types test/lesson-tips-host.smoke.mjs
// - lessonTipsOn: only a stored `false` is off (absent, true, junk are on), so no learner loses tips by accident.
// - The host writes the key only from a boolean `setLessonTips`, into globalState (this device, never synced:
//   no setKeysForSync), and sends it to the chat as config.lessonTips; nothing posts it to the Service.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LESSON_TIPS_KEY, lessonTipsOn } from '../src/lessonTips.ts';

assert.equal(LESSON_TIPS_KEY, 'hypeproofChat.lessonTips');
for (const v of [undefined, null, true, 'false', 0, '', {}]) assert.equal(lessonTipsOn(v), true, `on for ${JSON.stringify(v)}`);
assert.equal(lessonTipsOn(false), false, 'only false is off');

const src = readFileSync(new URL('../src/chatPanelProvider.ts', import.meta.url), 'utf8');
const at = src.indexOf('case "setLessonTips":');
assert.ok(at > 0, 'handler exists');
const body = src.slice(at, src.indexOf('return;', src.indexOf('postConfig', at)) + 7);
assert.match(body, /if \(typeof msg\.on !== "boolean"\) return;/, 'a non-boolean write is refused');
assert.match(body, /this\.context\.globalState\.update\(LESSON_TIPS_KEY, msg\.on\)/, 'written to globalState');
assert.match(src, /lessonTips: lessonTipsOn\(this\.context\.globalState\?\.get\(LESSON_TIPS_KEY\)\)/, 'sent to the chat as config');
const uses = [...src.matchAll(/LESSON_TIPS_KEY/g)].length;
assert.equal(uses, 3, `the key is used only by the import, the write and the read (${uses})`);
assert.ok(!/setKeysForSync\([^)]*LESSON_TIPS_KEY/.test(src), 'never synced');
// Negative control: a planted handler without the boolean guard fails the check above.
assert.doesNotMatch(body.replace('if (typeof msg.on !== "boolean") return;', ''), /if \(typeof msg\.on !== "boolean"\) return;/);
console.log('PASS lesson tips host: only false is off; boolean-only write to globalState; sent as config.lessonTips; never synced');
