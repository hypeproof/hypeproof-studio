// CGP-VOICE-R-015 (REQ-CGPV-18): the one recovery action for every dictation cause, over every (retry, clipKept)
// combination. verify-r004 on #4137: a silent or unreadable clip came back retry:true from the host and got
// 다시 보내기, which resends the same silence, fails the same way and spends hosted transcription each time.
// A problem with the clip itself is fixed only by speaking again, whatever the retry flag says.
//   node --experimental-strip-types test/dictation-recovery-table.smoke.mjs
import assert from 'node:assert/strict';
import { recoveryFor } from '../src/dictationRecovery.ts';

// Every cause the webview (voiceDictation.ts DictationFailure) and the host (voiceHost.ts TranscribeKind) can name.
const CLIP_PROBLEM = ['unreadable', 'too_short', 'too_large', 'too_long'];     // the recording itself: speak again
const MICROPHONE = ['no_mic', 'busy', 'failed'];                                // a new recording, or the same clip if the host can retry it
const WRITE = ['unsupported', 'network', 'auth', 'cap', 'unavailable', 'class_off', 'other', 'some_new_code']; // write instead, or resend if retryable

let rows = 0;
for (const retry of [false, true]) for (const clipKept of [false, true]) {
  const resend = retry && clipKept;
  for (const cause of CLIP_PROBLEM) { assert.equal(recoveryFor(cause, retry, clipKept), 'speak_again', `${cause} retry=${retry} kept=${clipKept}: never resend a bad clip`); rows++; }
  for (const cause of MICROPHONE) { assert.equal(recoveryFor(cause, retry, clipKept), resend ? 'resend' : 'speak_again', `${cause} retry=${retry} kept=${clipKept}`); rows++; }
  for (const cause of WRITE) { assert.equal(recoveryFor(cause, retry, clipKept), resend ? 'resend' : 'type', `${cause} retry=${retry} kept=${clipKept}`); rows++; }
}
// Without a kept clip there is never a resend, whatever the flag.
for (const cause of [...CLIP_PROBLEM, ...MICROPHONE, ...WRITE]) assert.notEqual(recoveryFor(cause, true, false), 'resend', `${cause}: no clip, no resend`);
console.log(`PASS dictation recovery table: ${rows} cause x retry x clipKept rows; a clip problem is always 다시 말하기`);
