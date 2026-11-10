// Dictation capture (src/voiceDictation.ts) against a scripted recorder and a fake clock: the format
// (Opus in WebM, 32 kbps, never audio/mp4), the hard stop, the 2 MiB bound, one clip at a time, the
// microphone released on every path, and that nothing is persisted.
// Run: node --experimental-strip-types test/voice-dictation.smoke.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DICTATION_BITS_PER_SECOND, DICTATION_STOP_AT_MS, SERVICE_MAX_BYTES, SERVICE_MAX_SECONDS, DictationRecorder, base64Of, classifyMediaError, pickDictationMime,
} from "../src/voiceDictation.ts";

const tick = () => new Promise((resolve) => setImmediate(resolve));

function rig({ supported = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus"], getUserMedia } = {}) {
  const clock = { now: 0, timers: [] };
  const log = { created: [], stopped: 0, tracksStopped: 0 };
  class FakeRecorder {
    static isTypeSupported(mime) { return supported.includes(mime); }
    constructor(stream, options) { this.stream = stream; this.options = options; this.state = "inactive"; log.created.push(this); }
    start(timeslice) { this.state = "recording"; this.timeslice = timeslice; }
    stop() { if (this.state === "inactive") return; this.state = "inactive"; log.stopped++; queueMicrotask(() => this.onstop?.()); }
    emit(bytes) { this.ondataavailable?.({ data: { size: bytes.length, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) } }); }
  }
  const stream = { getTracks: () => [{ stop() { log.tracksStopped++; } }] };
  const env = {
    getUserMedia: getUserMedia ?? (async (c) => { log.constraints = c; return stream; }),
    Recorder: FakeRecorder,
    now: () => clock.now,
    setTimeout: (fn, ms) => { const t = { fn, at: clock.now + ms }; clock.timers.push(t); return t; },
    clearTimeout: (t) => { clock.timers = clock.timers.filter((x) => x !== t); },
  };
  const events = { states: [], clips: [], failures: [] };
  const rec = new DictationRecorder(env, { onState: (s) => events.states.push(s), onClip: (c) => events.clips.push(c), onFailure: (f) => events.failures.push(f) });
  const advance = (ms) => { clock.now += ms; for (const t of [...clock.timers]) if (t.at <= clock.now) { clock.timers = clock.timers.filter((x) => x !== t); t.fn(); } };
  return { rec, log, events, advance, clock };
}

// ── format ──────────────────────────────────────────────────────────────────────────────────
assert.equal(pickDictationMime({ isTypeSupported: (m) => m === "audio/webm;codecs=opus" }), "audio/webm;codecs=opus");
assert.equal(pickDictationMime({ isTypeSupported: (m) => m === "audio/ogg;codecs=opus" }), "audio/ogg;codecs=opus");
assert.equal(pickDictationMime({ isTypeSupported: (m) => m === "audio/mp4" || m === "audio/aac" }), null, "audio/mp4 is never picked: the Service cannot bound it");
assert.equal(pickDictationMime({ isTypeSupported: () => { throw new Error("boom"); } }), null);
assert.equal(pickDictationMime(undefined), null);
assert.equal(DICTATION_BITS_PER_SECOND, 32_000);

{
  const { rec, log, events } = rig();
  await rec.start();
  assert.equal(log.created.length, 1);
  assert.deepEqual(log.created[0].options, { mimeType: "audio/webm;codecs=opus", audioBitsPerSecond: 32_000 }, "webm/opus at 32 kbps");
  assert.deepEqual(log.constraints, { audio: true });
  assert.equal(rec.current, "recording");
  assert.deepEqual(events.states, ["starting", "recording"]);
  // one clip at a time: a second start while recording does nothing
  await rec.start();
  assert.equal(log.created.length, 1, "a second start is ignored");
}

// ── a clip: delivered as bytes, mic released, never auto-anything ───────────────────────────
{
  const { rec, log, events, advance } = rig();
  await rec.start();
  const rc = log.created[0];
  rc.emit(new Uint8Array([1, 2, 3]));
  advance(2500);
  rc.emit(new Uint8Array([4, 5]));
  rec.stop();
  await tick(); await tick();
  assert.equal(events.clips.length, 1);
  const clip = events.clips[0];
  assert.equal(clip.mime, "audio/webm");
  assert.deepEqual([...clip.bytes], [1, 2, 3, 4, 5]);
  assert.equal(clip.seconds, 3, "whole seconds, rounded up");
  assert.equal(rec.current, "idle");
  assert.ok(log.tracksStopped >= 1, "the microphone is released");
  assert.equal(base64Of(clip.bytes), Buffer.from([1, 2, 3, 4, 5]).toString("base64"));
}

// ── ogg falls back, and is sent as audio/ogg ────────────────────────────────────────────────
{
  const { rec, log, events, advance } = rig({ supported: ["audio/ogg;codecs=opus"] });
  await rec.start();
  assert.equal(log.created[0].options.mimeType, "audio/ogg;codecs=opus");
  log.created[0].emit(new Uint8Array(10)); advance(1500); rec.stop(); await tick(); await tick();
  assert.equal(events.clips[0].mime, "audio/ogg");
}

// ── the hard stop ───────────────────────────────────────────────────────────────────────────
{
  const { rec, log, events, advance } = rig();
  await rec.start();
  const rc = log.created[0];
  rc.emit(new Uint8Array(100));
  advance(DICTATION_STOP_AT_MS - 1);
  assert.equal(rec.current, "recording", "still recording just before the stop");
  advance(1);
  await tick(); await tick();
  assert.equal(rc.state, "inactive", "stopped by the timer, nobody pressed stop");
  assert.equal(events.clips.length, 1);
  assert.ok(DICTATION_STOP_AT_MS <= SERVICE_MAX_SECONDS * 1000, "never later than the Service's 60 s line");
  assert.ok(events.clips[0].seconds <= SERVICE_MAX_SECONDS, "declared seconds never pass the Service's limit");
  assert.equal(events.clips[0].seconds, 58);
}

// ── size bound ──────────────────────────────────────────────────────────────────────────────
{
  const { rec, log, events, advance } = rig();
  await rec.start();
  log.created[0].emit(new Uint8Array(SERVICE_MAX_BYTES + 1));
  advance(5000); rec.stop(); await tick(); await tick();
  assert.deepEqual(events.failures, ["too_large"]);
  assert.equal(events.clips.length, 0, "an over-size clip is not delivered");
  // exactly at the bound is fine
  const second = rig();
  await second.rec.start();
  second.log.created[0].emit(new Uint8Array(SERVICE_MAX_BYTES)); second.advance(5000); second.rec.stop(); await tick(); await tick();
  assert.equal(second.events.clips.length, 1);
}

// ── too short ───────────────────────────────────────────────────────────────────────────────
{
  const { rec, log, events, advance } = rig();
  await rec.start();
  log.created[0].emit(new Uint8Array(4)); advance(100); rec.stop(); await tick(); await tick();
  assert.deepEqual(events.failures, ["too_short"]);
}

// ── cancel: nothing delivered, mic released ─────────────────────────────────────────────────
{
  const { rec, log, events, advance } = rig();
  await rec.start();
  log.created[0].emit(new Uint8Array(100)); advance(3000);
  rec.cancel(); await tick(); await tick();
  assert.equal(events.clips.length, 0);
  assert.deepEqual(events.failures, []);
  assert.ok(log.tracksStopped >= 1);
  assert.equal(rec.current, "idle");
}
// cancel while the permission prompt is open: the late microphone is closed, nothing records
{
  let release;
  const gate = new Promise((r) => { release = r; });
  let stopped = 0;
  const { rec, log } = rig({ getUserMedia: async () => { await gate; return { getTracks: () => [{ stop() { stopped++; } }] }; } });
  const started = rec.start();
  rec.cancel();
  release(); await started;
  assert.equal(stopped, 1, "the microphone handed over after cancel is closed at once");
  assert.equal(log.created.length, 0);
}

// ── failures by cause ───────────────────────────────────────────────────────────────────────
for (const [name, kind] of [["NotAllowedError", "denied"], ["SecurityError", "denied"], ["NotFoundError", "no_mic"], ["OverconstrainedError", "no_mic"], ["NotReadableError", "busy"], ["AbortError", "busy"], ["Weird", "failed"]]) {
  assert.equal(classifyMediaError({ name, message: "Device label: secret mic" }), kind, name);
  const { rec, events } = rig({ getUserMedia: async () => { throw Object.assign(new Error("x"), { name }); } });
  await rec.start();
  assert.deepEqual(events.failures, [kind], name);
  assert.equal(rec.current, "idle");
}
{
  const { rec, events } = rig({ supported: [] });
  await rec.start();
  assert.deepEqual(events.failures, ["unsupported"], "no webm/ogg opus: unsupported, and never falls back to mp4");
}

// ── nothing persisted ───────────────────────────────────────────────────────────────────────
// The recorder, the control and the host client may not write audio anywhere. A scan of the source
// (with a planted positive control, so a broken scanner cannot pass) for every way a webview or
// extension host could keep bytes.
const PERSIST = /createObjectURL|indexedDB|localStorage|sessionStorage|writeFile|createWriteStream|appendFile|globalState|workspaceState|secrets\.store|FileSystem|\bfs\.|patchWebviewState|\bsetState\b|console\.(log|info|warn|error|debug)|appendLine|postMessage\(\{[^}]*audio/;
assert.match("const u = URL.createObjectURL(blob);", PERSIST, "positive control");
assert.match("localStorage.setItem('clip', b64)", PERSIST, "positive control");
assert.match("fs.writeFileSync(p, bytes)", PERSIST, "positive control");
assert.match("patchWebviewState({ voiceClip: base64 })", PERSIST, "positive control: webview state (mutant M2b)");
assert.match("api.setState({ clip })", PERSIST, "positive control: setState");
assert.match("await this.context.globalState.update('hps.voice.last', msg.audio)", PERSIST, "positive control: host globalState (mutant M2c)");
assert.match("this.context.workspaceState.update('k', audio)", PERSIST, "positive control: workspaceState");
assert.match("await this.context.secrets.store('k', audio)", PERSIST, "positive control: SecretStorage");
assert.doesNotMatch("const x = clip.bytes.length;", PERSIST, "negative control");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\s)\/\/.*$/gm, "");
for (const f of ["src/voiceDictation.ts", "src/voiceHost.ts", "src/voiceMicSettings.ts", "webview-ui/src/DictationControl.tsx", "webview-ui/src/ReadAloudButton.tsx", "src/voiceReadAloud.ts"]) {
  const code = strip(readFileSync(new URL(`../${f}`, import.meta.url), "utf8"));
  assert.ok(code.length > 300, `${f}: scanned the real file`);
  assert.doesNotMatch(code, PERSIST, `${f} keeps or logs something it must not`);
}
// voiceHost.ts legitimately names the disclosure key (metadata); its words are checked separately above only for the
// storage verbs, so make sure it never touches the audio argument with them: it has no store call at all.
// The host handler that receives the audio lives in chatPanelProvider.ts: scan exactly that region.
{
  const host = readFileSync(new URL("../src/chatPanelProvider.ts", import.meta.url), "utf8");
  const from = host.indexOf("// ── Dictation (hps-voice-policy/1)"), to = host.indexOf("private async postShowThis(", from);
  assert.ok(from > 0 && to > from, "found the host dictation region");
  const region = strip(host.slice(from, to));
  assert.ok(region.includes("transcribeClip(") && region.includes("msg.audio"), "the region is the one that receives the audio");
  assert.doesNotMatch(region, PERSIST, "the host handler that receives the audio stores or logs something");
  // The only host storage voice uses is the disclosure record: it is written in its own case arms and never sees audio.
  for (const arm of ['case "voiceDisclosureRead":', 'case "voiceDisclosureAck":']) {
    const at = host.indexOf(arm); assert.ok(at > 0, arm);
    const end = host.indexOf("\n      case ", at + arm.length);
    assert.doesNotMatch(host.slice(at, end), /audio/i, `${arm} must not touch audio`);
  }
  const uses = [...host.matchAll(/globalState\.update\(VOICE_DISCLOSURE_KEY/g)].length;
  assert.equal(uses, 1, "exactly one voice write to globalState, the disclosure record");
  assert.equal((host.match(/hps\.voice\./g) ?? []).length, 0, "no other voice storage key in the provider");
}

console.log("voice-dictation smoke OK");
