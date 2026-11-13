// Read-aloud (src/voiceReadAloud.ts): the device's own voice, Korean, no network. `fetch`, XHR,
// WebSocket and EventSource are replaced by tripwires, so any network use fails the test.
// Run: node --experimental-strip-types test/voice-read-aloud.smoke.mjs
import assert from "node:assert/strict";
import { ReadAloud, chunkForSpeech, pickKoreanVoice, speakableText, READ_ALOUD_LANG } from "../src/voiceReadAloud.ts";

const trips = [];
for (const name of ["fetch", "XMLHttpRequest", "WebSocket", "EventSource", "sendBeacon"]) globalThis[name] = function () { trips.push(name); throw new Error(`network: ${name}`); };

function fakeSynth(voices = []) {
  const spoken = [];
  const synth = { spoken, cancelled: 0, speak(u) { spoken.push(u); }, cancel() { this.cancelled++; }, getVoices: () => voices };
  return synth;
}
const env = (synth) => ({ synth, makeUtterance: (text) => ({ text, lang: "", rate: 0, voice: null, onend: null, onerror: null }) });

// speakableText: prose only, code skipped and reported
{
  const md = "# 제목\n\n**굵게** 그리고 [링크](https://x.dev) 입니다.\n\n```js\nconsole.log('hi')\n```\n\n- 하나\n- 둘\n\n`인라인`도 읽어요.";
  const { text, skippedCode } = speakableText(md);
  assert.equal(skippedCode, true);
  assert.ok(!text.includes("console"), "code is not read");
  assert.ok(!/[#*`\[\]]|https?:/.test(text), `markdown symbols and urls are not read: ${text}`);
  assert.ok(text.includes("제목") && text.includes("굵게") && text.includes("링크") && text.includes("하나") && text.includes("인라인"));
  assert.equal(speakableText("그냥 글이에요.").skippedCode, false);
  assert.equal(speakableText("```\nunclosed").skippedCode, true, "an unclosed fence is still code");
}
// chunks: nothing dropped, each short
{
  const long = Array.from({ length: 30 }, (_, i) => `이것은 ${i}번째 문장이에요.`).join(" ");
  const chunks = chunkForSpeech(long, 100);
  assert.ok(chunks.every((c) => c.length <= 100));
  assert.equal(chunks.join(" ").replace(/\s+/g, " "), long);
  assert.deepEqual(chunkForSpeech(""), []);
  const blob = "가".repeat(450);
  assert.equal(chunkForSpeech(blob, 180).join(""), blob, "an unbroken run is split, not lost");
}
// Voice choice: only an on-device Korean voice
{
  assert.equal(pickKoreanVoice([{ lang: "ko-KR", localService: false, name: "net" }, { lang: "en-US", localService: true }]), null, "a streaming voice is never chosen");
  assert.deepEqual(pickKoreanVoice([{ lang: "en-US", localService: true }, { lang: "ko-KR", localService: true, name: "Yuna" }]), { lang: "ko-KR", localService: true, name: "Yuna" });
  assert.equal(pickKoreanVoice([{ lang: "ko_KR", localService: true, name: "u" }])?.name, "u");
}
// Playback: ko-KR, local voice, one answer at a time, stop, no network
{
  const synth = fakeSynth([{ lang: "en-US", localService: true }, { lang: "ko-KR", localService: true, name: "Yuna" }]);
  const hub = new ReadAloud(env(synth));
  const seen = []; hub.subscribe(() => seen.push(hub.getStatus().kind));
  const started = hub.play("a1", "첫 번째 답이에요. 두 번째 문장이에요.");
  assert.equal(started.started, true);
  assert.ok(synth.spoken.length >= 1);
  for (const u of synth.spoken) { assert.equal(u.lang, "ko-KR"); assert.equal(u.lang, READ_ALOUD_LANG); assert.equal(u.voice.name, "Yuna"); }
  assert.deepEqual(hub.getStatus(), { kind: "playing", id: "a1" });
  // another answer stops the first
  hub.play("a2", "다른 답이에요.");
  assert.ok(synth.cancelled >= 1, "the first playback was cancelled");
  assert.deepEqual(hub.getStatus(), { kind: "playing", id: "a2" });
  // a late end event from the stopped playback is ignored
  const lastOfA2 = synth.spoken[synth.spoken.length - 1];
  const staleOfA1 = synth.spoken[0];
  staleOfA1.onend?.();
  assert.deepEqual(hub.getStatus(), { kind: "playing", id: "a2" }, "events of a stopped playback do nothing");
  lastOfA2.onend();
  assert.deepEqual(hub.getStatus(), { kind: "idle" });
  // stop is immediate
  hub.play("a3", "멈출 거예요."); hub.stop();
  assert.deepEqual(hub.getStatus(), { kind: "idle" });
  // an engine error is a quiet error state, a canceled one is not
  hub.play("a4", "오류가 날 거예요.");
  const u4 = synth.spoken[synth.spoken.length - 1];
  u4.onerror({ error: "canceled" });
  assert.equal(hub.getStatus().kind, "playing", "canceled is not a failure");
  u4.onerror({ error: "synthesis-failed" });
  assert.deepEqual(hub.getStatus(), { kind: "error", id: "a4" });
  // code is skipped and announced; an answer that is only code says nothing and starts nothing
  const withCode = hub.play("a5", "설명이에요.\n```\nx=1\n```");
  assert.deepEqual([withCode.started, withCode.skippedCode, withCode.note], [true, true, "코드는 건너뛰었어요"]);
  assert.ok(!synth.spoken.some((u) => u.text.includes("x=1")));
  const onlyCode = hub.play("a6", "```\nx=1\n```");
  assert.deepEqual([onlyCode.started, onlyCode.note], [false, "코드는 건너뛰었어요"]);
  assert.ok(seen.includes("playing") && seen.includes("idle"));
}
// No synthesizer: nothing starts, nothing throws
{
  const hub = new ReadAloud({ synth: undefined, makeUtterance: () => ({}) });
  assert.equal(hub.available, false);
  assert.equal(hub.play("x", "글").started, false);
  hub.stop();
}
// CGP-VOICE-R-002: the speaker switch silences read-aloud in the same call, and a muted hub starts nothing.
{
  const { OutputMute } = await import("../src/voiceOutputMute.ts");
  const output = new OutputMute();
  const synth = fakeSynth([{ lang: "ko-KR", localService: true }]);
  const hub = new ReadAloud(env(synth), output);
  hub.play("m1", "첫 문장이에요. 두 번째 문장이에요.");
  assert.equal(hub.getStatus().kind, "playing");
  output.set(true);
  assert.equal(synth.cancelled, 1, "muting cancels the synthesizer synchronously (well inside 200 ms)");
  assert.deepEqual(hub.getStatus(), { kind: "idle" }, "muting ends the reading");
  const spoken = synth.spoken.length;
  assert.equal(hub.play("m2", "꺼진 동안이에요.").started, false, "a muted hub starts nothing");
  assert.equal(synth.spoken.length, spoken, "nothing reached the synthesizer while muted");
  output.set(false);
  assert.equal(hub.play("m3", "다시 켰어요.").started, true, "unmuted, it reads again");
  // Negative control: without the switch a hub behaves exactly as before.
  const plain = new ReadAloud(env(fakeSynth()));
  assert.equal(plain.play("p1", "그냥 읽어요.").started, true);
  // Disposed hubs stop listening: a stale hub never cancels a newer reading.
  hub.dispose();
  const cancelled = synth.cancelled;
  output.set(true);
  assert.equal(synth.cancelled, cancelled, "a disposed hub no longer reacts to the switch");
}
assert.deepEqual(trips, [], `read-aloud touched the network: ${trips.join(", ")}`);
console.log("voice-read-aloud smoke OK");
