// Studio voice, the served-profile contract (hps-voice-policy/1): what the `voice` block on
// GET /v1/profile turns on, what counts as "absent", the class-off state, and the disclosure copy.
// Run: node --experimental-strip-types test/voice-served.smoke.mjs
import assert from "node:assert/strict";
import { readServedVoice, voiceAvailability, readsMinorDisclosure } from "../src/voiceServed.ts";
import { disclosureParagraphs, CLASS_OFF, DISCLOSURE_START } from "../src/voiceCopy.ts";

const V1 = "hps-voice-policy/1";
const on = (extra = {}) => ({ voice: { dictation: true, read_aloud: true, policy_version: V1, engine: { dictation: "hosted", read_aloud: "device" }, ...extra } });

// Absent means off: every current seat (no block) renders no voice at all.
for (const [label, profile] of [["undefined", undefined], ["null", null], ["empty profile", {}], ["voice null", { voice: null }], ["voice string", { voice: "on" }], ["voice array", { voice: [] }]]) {
  assert.equal(readServedVoice(profile), null, label);
  assert.deepEqual(voiceAvailability(profile, false, false), { kind: "none" }, `${label}: nothing renders`);
}
// Both halves off, or anything but a literal true, is off.
assert.equal(readServedVoice({ voice: { dictation: false, read_aloud: false, policy_version: V1 } }), null);
assert.equal(readServedVoice({ voice: { dictation: "true", read_aloud: 1, policy_version: V1 } }), null, "truthy is not the Service's answer");
// A policy version this build has no disclosure for fails closed: no copy, no voice.
assert.equal(readServedVoice({ voice: { dictation: true, policy_version: "hps-voice-policy/2" } }), null);
assert.equal(readServedVoice({ voice: { dictation: true } }), null, "no policy_version");
assert.equal(readServedVoice({ voice: { dictation: true, policy_version: 1 } }), null);

// Each half is its own switch.
assert.deepEqual(readServedVoice(on()), { dictation: true, readAloud: true, policyVersion: V1 });
assert.deepEqual(readServedVoice(on({ read_aloud: false })), { dictation: true, readAloud: false, policyVersion: V1 });
assert.deepEqual(readServedVoice(on({ dictation: false })), { dictation: false, readAloud: true, policyVersion: V1 });
assert.equal(voiceAvailability(on(), false, false).kind, "on");

// D-018: served earlier in this window and absent now = the class turned it off; never served = nothing.
assert.deepEqual(voiceAvailability({}, true, false), { kind: "class_off" });
assert.deepEqual(voiceAvailability({}, false, false), { kind: "none" }, "a class that never enabled voice shows no voice buttons");
assert.deepEqual(voiceAvailability(on(), true, true), { kind: "class_off" }, "a Service refusal wins over a stale profile");
assert.deepEqual(voiceAvailability({}, false, true), { kind: "none" }, "a refusal with no voice ever served draws nothing");

// Disclosure: the confirmed Appendix B sentences, nothing added, by audience.
const both = { dictation: true, readAloud: true };
assert.deepEqual(disclosureParagraphs(V1, both, true), [
  "말하면 글자로 바꿔 줘요. 목소리는 글자로 바꾸는 데만 쓰고 저장하지 않아요. 보내기 전에 글을 고칠 수 있어요.",
  "답을 소리로 읽어 줘요. 이 컴퓨터 안에서 읽어서 아무 데도 보내지 않아요.",
]);
assert.deepEqual(disclosureParagraphs(V1, { dictation: true, readAloud: false }, false), ["말한 내용을 글로 바꿔 입력창에 넣어요. 음성은 저장하지 않고, 보낸 글만 이 채팅에 남아요."]);
assert.deepEqual(disclosureParagraphs(V1, { dictation: false, readAloud: true }, false), ["답을 소리로 읽어 줘요. 이 컴퓨터 안에서 읽어서 아무 데도 보내지 않아요."]);
assert.equal(DISCLOSURE_START, "시작하기");
assert.equal(CLASS_OFF, "이 수업에서는 쓸 수 없어요");

// Minor wording fails closed: only the two professional tiers read the adult sentence.
assert.equal(readsMinorDisclosure(null), true);
assert.equal(readsMinorDisclosure({ game: { template_tier: "website" } }), false);
assert.equal(readsMinorDisclosure({ game: { template_tier: "search-webapp" } }), false);
assert.equal(readsMinorDisclosure({ game: { template_tier: "website" }, minor_cohort: true }), true);
assert.equal(readsMinorDisclosure({ game: { template_tier: "kids-quest" } }), true);

console.log("voice-served smoke OK");
