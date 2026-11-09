// The host half of dictation (src/voiceHost.ts): the one place audio reaches the Service. A scripted
// fetch stands in for POST /v1/voice/transcribe; nothing here reaches a network.
// Run: node --experimental-strip-types test/voice-host.smoke.mjs
import assert from "node:assert/strict";
import { transcribeClip, micSettingsUri, readAcknowledged, withAcknowledged } from "../src/voiceHost.ts";
import { SOFT_UNREADABLE, NETWORK, GENERIC_UNAVAILABLE } from "../src/voiceCopy.ts";

const audio = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4]).toString("base64");
const req = (extra = {}) => ({ mime: "audio/webm", seconds: 5, audio, ...extra });
const json = (status, body) => async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const refusal = (status, code, message, extra = {}) => json(status, { error: { type: "voice", code, message, ...extra } });
const run = (fetchImpl, request = req()) => transcribeClip({ proxyUrl: "https://api.example/v1/", token: "tok-123", request, fetchImpl });

// A real call: the seat token, the container type, the declared seconds, the bytes as the body.
{
  const seen = [];
  const result = await run(async (url, init) => { seen.push({ url, init }); return Response.json({ text: " 안녕하세요 ", duration_s: 5, cost_micro: 250, price_revision: "x" }); });
  assert.deepEqual(result, { ok: true, text: "안녕하세요" });
  const { url, init } = seen[0];
  assert.equal(url, "https://api.example/v1/voice/transcribe");
  assert.equal(init.method, "POST");
  assert.equal(init.headers.authorization, "Bearer tok-123");
  assert.equal(init.headers["content-type"], "audio/webm");
  assert.equal(init.headers["x-hps-audio-seconds"], "5");
  assert.deepEqual([...init.body], [0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4], "the raw bytes, not base64 and not JSON");
}

// Service refusals: shown as the Service wrote them where they are already calm.
{
  const cap = "오늘 쓸 수 있는 음성 받아쓰기를 다 썼어요. 글로는 계속 이야기할 수 있어요.";
  const r = await run(refusal(429, "voice_cap_reached", cap, { cap: "seat_day", retry: false }));
  assert.deepEqual(r, { ok: false, kind: "cap", message: cap, retry: false }, "cap: verbatim, no retry");
  const busy = await run(refusal(429, "voice_busy", "잠시만요", { retry: false }));
  assert.equal(busy.kind, "busy"); assert.equal(busy.message, "잠시만요"); assert.equal(busy.retry, false);
  const off = await run(refusal(403, "voice_off", "이 수업에서는 쓸 수 없어요."));
  assert.deepEqual([off.kind, off.message, off.retry], ["class_off", "이 수업에서는 쓸 수 없어요.", false]);
  assert.equal((await run(refusal(403, "voice_consent_required", "이 수업에서는 쓸 수 없어요."))).kind, "class_off");
  const minors = await run(refusal(403, "voice_minors_disabled", "지금은 음성을 쓸 수 없어요. 글로 이야기해 주세요."));
  assert.deepEqual([minors.kind, minors.message], ["unavailable", "지금은 음성을 쓸 수 없어요. 글로 이야기해 주세요."]);
  assert.equal((await run(refusal(404, "not_found", "endpoint not found"))).kind, "unavailable");
  assert.equal((await run(refusal(404, "not_found", "endpoint not found"))).message, "endpoint not found", "sanity: the Service text is passed through when it sent one");
  const long = await run(refusal(413, "voice_too_long", "한 번에 60초까지만 말할 수 있어요."));
  assert.deepEqual([long.kind, long.message], ["too_long", "한 번에 60초까지만 말할 수 있어요."]);
  assert.equal((await run(refusal(502, "voice_provider_unavailable", "지금은 받아쓰기를 할 수 없어요. 글로 이야기해 주세요."))).retry, true, "a provider outage may be retried");
}
// Unreadable and silent get the softer line, whatever the Service called them.
for (const code of ["voice_unreadable", "voice_empty", "voice_type_mismatch"]) {
  const r = await run(refusal(415, code, "이 녹음을 읽을 수 없어요."));
  assert.deepEqual([r.kind, r.message, r.retry], ["unreadable", SOFT_UNREADABLE, true], code);
}
assert.equal(SOFT_UNREADABLE, "소리가 잘 들리지 않았어요. 다시 말해 볼까요?");
{
  const r = await run(json(200, { text: "   " }));
  assert.deepEqual([r.ok, r.kind, r.message], [false, "unreadable", SOFT_UNREADABLE], "a silent clip returns no words");
}
// Other failures stay calm and name no internals.
{
  assert.deepEqual(await run(async () => { throw new TypeError("fetch failed: ECONNRESET api.example"); }), { ok: false, kind: "network", message: NETWORK, retry: true });
  const html = await run(async () => new Response("<html>502</html>", { status: 502 }));
  assert.deepEqual([html.kind, html.message, html.retry], ["other", GENERIC_UNAVAILABLE, true]);
  assert.equal((await run(async () => new Response("", { status: 401 }))).kind, "auth");
  const weird = await run(refusal(500, "Z" + "x".repeat(60), "stack trace"));
  assert.equal(weird.message, GENERIC_UNAVAILABLE, "an unknown code never shows its text");
}
// Bad requests are refused before any fetch.
{
  let called = 0;
  const spy = async () => { called++; return Response.json({ text: "x" }); };
  for (const bad of [{ mime: "audio/mp4" }, { mime: "audio/webm;codecs=opus" }, { mime: 5 }, { seconds: 0 }, { seconds: 61 }, { seconds: 1.5 }, { seconds: "5" }, { audio: "" }, { audio: 5 }, { audio: "not base64!" }, { audio: "A".repeat(3 * 1024 * 1024) }]) {
    const r = await run(spy, req(bad));
    assert.equal(r.ok, false, JSON.stringify(bad).slice(0, 40));
  }
  assert.equal(called, 0, "nothing was sent for a request the Service would refuse");
}
// The OS pane is chosen from the platform, never from the webview.
assert.equal(micSettingsUri("darwin"), "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone");
assert.equal(micSettingsUri("win32"), "ms-settings:privacy-microphone");
assert.equal(micSettingsUri("linux"), null);
// Disclosure acknowledgements: metadata, bounded, only well-formed versions.
assert.deepEqual(readAcknowledged(["hps-voice-policy/1", 5, "<script>", "x"]), ["hps-voice-policy/1"]);
assert.deepEqual(readAcknowledged(undefined), []);
assert.deepEqual(withAcknowledged([], "hps-voice-policy/1"), ["hps-voice-policy/1"]);
assert.deepEqual(withAcknowledged(["hps-voice-policy/1"], "hps-voice-policy/1"), ["hps-voice-policy/1"]);

// The audio and the transcript are never logged: run a clip through while console and stdout are watched.
{
  const heard = [];
  const keep = { log: console.log, info: console.info, warn: console.warn, error: console.error, debug: console.debug };
  for (const k of Object.keys(keep)) console[k] = (...a) => heard.push(a.join(" "));
  await run(async () => Response.json({ text: "비밀 문장" }));
  await run(refusal(500, "voice_provider_unavailable", "x"));
  Object.assign(console, keep);
  assert.deepEqual(heard, [], "no log line from the host client");
}
console.log("voice-host smoke OK");
