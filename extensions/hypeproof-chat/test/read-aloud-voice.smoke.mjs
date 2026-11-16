// Read-aloud Korean voice choice (Jay, 2026-11-16). No DOM.
//   node --experimental-strip-types test/read-aloud-voice.smoke.mjs
// Evidence (Jay's Mac, `say -v '?'`, ko_KR): Eddy, Flo, Grandma, Grandpa, Reed, Rocko, Sandy, Shelley (Eloquence) and the
// compact Yuna. Chromium lists them sorted by name, so "the first local Korean voice" was Eddy: the strange voice.
// - ranking by voiceURI: premium > enhanced > compact Yuna > other (Windows Heami) > Eloquence/novelty (last resort);
//   compact and premium Yuna sharing a name never confuse it; the default wins ties, then the voice used last time;
//   a server voice is never chosen;
// - the real ReadAloud reads with the pick and reports it once per change;
// - the host's report check, the one diagnostic line, the per-computer store and the hint rule.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ReadAloud, chooseKoreanVoice, koreanVoiceTier, pickKoreanVoice } from '../src/voiceReadAloud.ts';
import { READ_ALOUD_VOICE_HINT_KEY, READ_ALOUD_VOICE_KEY, acceptVoicePick, readStoredVoiceUri, voicePickLine } from '../src/readAloudVoicePrefs.ts';

const ko = (name, uri, extra = {}) => ({ name, lang: 'ko-KR', localService: true, voiceURI: uri, ...extra });
// Jay's Mac (ko_KR), in Chromium's order (by name); a few English voices around them.
const JAYS_MAC = [
  { name: 'Albert', lang: 'en-US', localService: true, voiceURI: 'com.apple.speech.synthesis.voice.Albert' },
  ...['Eddy', 'Flo', 'Grandma', 'Grandpa', 'Reed', 'Rocko', 'Sandy', 'Shelley'].map((n) => ko(`${n} (Korean (South Korea))`, `com.apple.eloquence.ko-KR.${n}`)),
  { name: 'Samantha', lang: 'en-US', localService: true, voiceURI: 'com.apple.voice.compact.en-US.Samantha', default: true },
  ko('Yuna', 'com.apple.voice.compact.ko-KR.Yuna'),
];

// ---- the evidence: the old rule read with Eddy ----
const oldRule = (voices) => voices.find((v) => v.localService && /^ko([-_]|$)/i.test(v.lang)) ?? null;
assert.equal(oldRule(JAYS_MAC).name, 'Eddy (Korean (South Korea))', 'red: the first local Korean voice on Jay\'s Mac is Eloquence Eddy');
const jay = chooseKoreanVoice(JAYS_MAC);
assert.deepEqual([jay.voice.voiceURI, jay.tier, jay.candidates], ['com.apple.voice.compact.ko-KR.Yuna', 'compact', 9], 'now: the compact Yuna, never an Eloquence voice');

// ---- the shared cases (config/korean-voice-cases.json): the same file the iOS and Android tests read ----
const CASES = JSON.parse(readFileSync(new URL('../../../config/korean-voice-cases.json', import.meta.url), 'utf8'));
assert.equal(CASES.schema, 'hps-korean-voice-cases/1');
assert.ok(CASES.apple.length >= 5, 'control: the Apple cases are there');
for (const c of CASES.apple) {
  const voices = c.voices.map((v) => ({ name: v.name, lang: v.lang, localService: true, voiceURI: v.identifier }));
  const pick = chooseKoreanVoice(voices);
  assert.equal(pick.voice?.voiceURI ?? null, c.expect, `${c.case}: the pick`);
  assert.equal(pick.tier, c.expect_tier, `${c.case}: the tier`);
  if (c.first_match_was) assert.equal(oldRule(voices).voiceURI, c.first_match_was, `${c.case}: the old first-match rule`);
}
for (const name of CASES.novelty_names) assert.equal(koreanVoiceTier(ko(`${name} (Korean (South Korea))`, 'unknown')), 'novelty', `novelty name ${name}`);

// ---- tiers ----
assert.equal(koreanVoiceTier(ko('Yuna', 'com.apple.voice.premium.ko-KR.Yuna')), 'premium');
assert.equal(koreanVoiceTier(ko('Yuna', 'com.apple.voice.enhanced.ko-KR.Yuna')), 'enhanced');
assert.equal(koreanVoiceTier(ko('Yuna', 'com.apple.voice.compact.ko-KR.Yuna')), 'compact');
assert.equal(koreanVoiceTier(ko('Eddy', 'com.apple.eloquence.ko-KR.Eddy')), 'novelty');
assert.equal(koreanVoiceTier(ko('Grandma (Korean (South Korea))', 'x-unknown')), 'novelty', 'an Eloquence name without its URI');
assert.equal(koreanVoiceTier(ko('Microsoft Heami - Korean (Korean)', 'Microsoft Heami - Korean (Korean)')), 'other', 'Windows Heami');

// ---- choice ----
const ALL_YUNA = [ko('Yuna', 'com.apple.voice.compact.ko-KR.Yuna'), ko('Yuna', 'com.apple.voice.premium.ko-KR.Yuna'), ko('Yuna', 'com.apple.voice.enhanced.ko-KR.Yuna')];
assert.equal(pickKoreanVoice(ALL_YUNA).voiceURI, 'com.apple.voice.premium.ko-KR.Yuna', 'premium wins although all three are named Yuna');
assert.equal(pickKoreanVoice(ALL_YUNA.filter((v) => !v.voiceURI.includes('premium'))).voiceURI, 'com.apple.voice.enhanced.ko-KR.Yuna', 'then enhanced');
assert.equal(pickKoreanVoice([ko('Microsoft Heami - Korean (Korean)', 'Heami')]).name, 'Microsoft Heami - Korean (Korean)', 'Windows: Heami');
assert.equal(chooseKoreanVoice([ko('Eddy', 'com.apple.eloquence.ko-KR.Eddy')]).tier, 'novelty', 'only Eloquence left: still read, as a last resort');
assert.deepEqual(chooseKoreanVoice([]), { voice: null, tier: null, candidates: 0 }, 'no Korean voice');
assert.equal(pickKoreanVoice([{ ...ko('Yuna', 'com.apple.voice.premium.ko-KR.Yuna'), localService: false }, ko('Yuna', 'c')]).voiceURI, 'c', 'a server voice is never chosen');
const TWO = [ko('A', 'u-a'), ko('B', 'u-b', { default: true })];
assert.equal(pickKoreanVoice(TWO).voiceURI, 'u-b', 'among equals the default wins');
assert.equal(pickKoreanVoice([ko('A', 'u-a'), ko('B', 'u-b')], 'u-b').voiceURI, 'u-b', 'then the voice used last time');
assert.equal(pickKoreanVoice(TWO, 'u-a').voiceURI, 'u-b', 'the default wins over the voice used last time');
assert.equal(pickKoreanVoice([ko('Yuna', 'com.apple.voice.compact.ko-KR.Yuna'), ko('Yuna', 'com.apple.voice.premium.ko-KR.Yuna')], 'com.apple.voice.compact.ko-KR.Yuna').voiceURI, 'com.apple.voice.premium.ko-KR.Yuna', 'a newly downloaded premium voice beats the stored compact one');

// ---- the real ReadAloud ----
{
  const spoken = [], reports = [];
  let voices = JAYS_MAC;
  const env = {
    synth: { getVoices: () => voices, cancel() {}, speak: (u) => spoken.push(u) },
    makeUtterance: (text) => ({ text, onend: null, onerror: null, lang: '', rate: 1, voice: null }),
    preferredVoiceUri: () => null,
    onVoicePicked: (p) => reports.push([p.voice?.voiceURI, p.tier, p.candidates]),
  };
  const r = new ReadAloud(env);
  r.play('a1', '안녕하세요.');
  assert.equal(spoken[0].voice.voiceURI, 'com.apple.voice.compact.ko-KR.Yuna', 'it reads with Yuna');
  assert.equal(spoken[0].lang, 'ko-KR');
  assert.deepEqual(r.lastPick.tier, 'compact');
  r.stop(); r.play('a2', '두 번째 답이에요.'); r.stop();
  assert.deepEqual(reports, [['com.apple.voice.compact.ko-KR.Yuna', 'compact', 9]], 'reported once while the pick is the same');
  voices = [...JAYS_MAC, ko('Yuna', 'com.apple.voice.premium.ko-KR.Yuna')];
  r.play('a3', '세 번째.'); r.stop();
  assert.deepEqual(reports.at(-1), ['com.apple.voice.premium.ko-KR.Yuna', 'premium', 10], 'a new pick is reported again');
}

// ---- the host half ----
assert.equal(readStoredVoiceUri('com.apple.voice.premium.ko-KR.Yuna'), 'com.apple.voice.premium.ko-KR.Yuna');
for (const junk of [undefined, null, 3, '', 'x'.repeat(300)]) assert.equal(readStoredVoiceUri(junk), null, `junk ${String(junk).slice(0, 10)}`);
assert.deepEqual(acceptVoicePick({ uri: 'com.apple.voice.compact.ko-KR.Yuna', name: 'Yuna', tier: 'compact', candidates: 9 }), { uri: 'com.apple.voice.compact.ko-KR.Yuna', name: 'Yuna', tier: 'compact', candidates: 9 });
assert.equal(acceptVoicePick({ uri: null, name: '', tier: null, candidates: 0 }).tier, 'none');
for (const junk of [{}, { tier: 'great', candidates: 1 }, { tier: 'compact', candidates: -1 }, { tier: 'compact', candidates: 1.5 }]) assert.equal(acceptVoicePick(junk), null, JSON.stringify(junk));
assert.equal(acceptVoicePick({ uri: 'u', name: 'Yu\nna\u202e', tier: 'compact', candidates: 1 }).name, 'Yu na', 'control and bidi characters never reach the log');
assert.equal(voicePickLine({ uri: 'u', name: 'Yuna', tier: 'compact', candidates: 9 }), '[voice] read-aloud voice: compact "Yuna", 9 Korean voices on this device');
assert.equal(voicePickLine({ uri: null, name: '', tier: 'none', candidates: 0 }), '[voice] read-aloud: no Korean voice on this device (0 of 0)');
assert.equal(READ_ALOUD_VOICE_KEY, 'hypeproofChat.readAloudVoice');
assert.equal(READ_ALOUD_VOICE_HINT_KEY, 'hypeproofChat.readAloudVoiceHint');
const src = readFileSync(new URL('../src/chatPanelProvider.ts', import.meta.url), 'utf8');
const at = src.indexOf('case "readAloudVoicePicked":');
assert.ok(at > 0, 'the provider handles the report');
const body = src.slice(at, src.indexOf('case "readAloudVoiceHintShown":', at));
assert.match(body, /const pick = acceptVoicePick\(msg\);\s*if \(!pick\) return;/, 'junk is dropped');
assert.match(body, /this\.coachLine\(voicePickLine\(pick\)\)/, 'one diagnostic line, kept for a problem report');
assert.match(body, /globalState\.update\(READ_ALOUD_VOICE_KEY, pick\.uri\)/, 'kept per computer');
assert.match(src, /\.\.\.\(readAloudVoice \? \{ readAloudVoice \} : \{\}\)/, 'the config carries it only once set');
assert.doesNotMatch(src, /setKeysForSync\s*(\?\.)?\s*\([^)]*READ_ALOUD_VOICE/, 'never synced');
console.log('PASS: Korean voice ranking (Jay\'s Mac evidence), ReadAloud pick and report, host store and diagnostic line');
