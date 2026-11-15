// CGP-VOICE-R-019 / D-015 (REQ-CGPV-23 / DES-CGPV-23): the 마이크 row in the chat's settings dialog. A native select
// of the connected microphones ("시스템 기본값" first), the state in words, and 마이크 시험: an explicit press that
// listens for at most 5 s and shows the real input level.
//
// - Drawn only where dictation is served; an unserved seat renders nothing and touches no browser API.
// - Opening it never asks for the microphone: the list comes from enumerateDevices, which the browser hides until
//   the microphone was allowed once. Only 마이크 시험 opens the microphone, behind the voice disclosure and the
//   microphone explainer, like dictation.
// - The test records nothing, sends nothing and keeps no samples: one reused analyser block, then the tracks
//   are stopped and the audio context is closed, on every path (done, 시험 멈추기, the dialog closing, a hide).
// - The choice goes to the host (setMicInput), which keeps it for this computer. Nothing here logs it.
import { useCallback, useContext, useEffect, useId, useRef, useState } from "react";
import { DictationEnvContext } from "./DictationControl";
import { useVoice } from "./VoiceProvider";
import { postToHost } from "./vscode";
import { choiceForPick, micAudioConstraint, micOptions, resolveMicChoice, MIC_HEARD_LEVEL, MIC_TEST_MS, MIC_TEST_POLL_MS, type MicDevice } from "../../src/micInput";
import { classifyMediaError, needsMicExplainer, type DictationEnv, type LevelMeter, type StreamLike } from "../../src/voiceDictation";
import {
  GENERIC_UNAVAILABLE, MIC_BUSY, MIC_CHOSEN, MIC_DENIED_TITLE, MIC_EXPLAIN_ALLOW, MIC_EXPLAIN_BODY, MIC_EXPLAIN_LATER, MIC_MISSING, MIC_NOT_CONNECTED, MIC_NUMBERED,
  MIC_SETTING_HIDDEN, MIC_SETTING_HINT, MIC_SETTING_LABEL, MIC_SETTING_MISSING, MIC_SETTING_NONE, MIC_SYSTEM_DEFAULT, MIC_TEST, MIC_TEST_HEARD, MIC_TEST_LISTENING,
  MIC_TEST_SILENT, MIC_TEST_STOP, NO_MIC,
} from "../../src/voiceCopy";

type Test =
  | { kind: "idle" }
  | { kind: "explain" }
  | { kind: "listening" }
  | { kind: "result"; text: string };

const COPY = { system: MIC_SYSTEM_DEFAULT, missing: MIC_NOT_CONNECTED, numbered: MIC_NUMBERED, chosen: MIC_CHOSEN };

/**
 * `open`: whether the dialog holding the row is open. The personal dialog stays mounted while closed, so the row
 * (and any 마이크 시험 in progress, with its microphone) unmounts when it closes.
 */
export function MicInputSetting({ open = true }: { open?: boolean } = {}) {
  const voice = useVoice();
  const served = voice.availability.kind === "on" && voice.availability.served.dictation;
  if (!served || !open) return null;
  return <MicInputRow />;
}

function MicInputRow() {
  const voice = useVoice();
  const makeEnv = useContext(DictationEnvContext);
  const [env] = useState<DictationEnv>(makeEnv);
  const choice = voice.micChoice ?? null;
  // undefined: not read yet; null: hidden by the browser (no permission yet); []: no microphone at all.
  const [devices, setDevices] = useState<MicDevice[] | null | undefined>(undefined);
  const [test, setTest] = useState<Test>({ kind: "idle" });
  const mounted = useRef(true);
  const explained = useRef(false);
  const id = useId();
  const selectId = `${id}-mic`, hintId = `${id}-mic-hint`, legendId = `${id}-mic-legend`;

  const refresh = useCallback(() => {
    const list = env.listMics;
    if (!list) { setDevices(null); return; }
    void list().then((d) => { if (mounted.current) setDevices(d); }, () => { if (mounted.current) setDevices(null); });
  }, [env]);
  useEffect(() => {
    mounted.current = true;
    refresh();
    const off = env.onDeviceChange?.(refresh);
    return () => { mounted.current = false; off?.(); };
  }, [env, refresh]);

  // ---- 마이크 시험 ----
  const run = useRef<{ stream: StreamLike | null; meter: LevelMeter | null; timer: unknown; end: number; peak: number; generation: number }>({ stream: null, meter: null, timer: null, end: 0, peak: 0, generation: 0 });
  const [level, setLevel] = useState<number | null>(null);
  const release = useCallback(() => {
    const r = run.current;
    if (r.timer !== null) { env.clearTimeout(r.timer); r.timer = null; }
    const meter = r.meter; r.meter = null;
    try { meter?.close(); } catch { /* already closed */ }
    for (const track of r.stream?.getTracks() ?? []) { try { track.stop(); } catch { /* already stopped */ } }
    r.stream = null;
  }, [env]);
  const finish = useCallback((generation: number) => {
    const r = run.current;
    if (generation !== r.generation) return;
    r.generation++;
    const heard = r.peak >= MIC_HEARD_LEVEL;
    release();
    if (!mounted.current) return;
    setLevel(null);
    setTest({ kind: "result", text: heard ? MIC_TEST_HEARD : MIC_TEST_SILENT });
    refresh();   // labels appear once the microphone was allowed
  }, [release, refresh]);
  const listen = useCallback(async () => {
    const r = run.current;
    const generation = ++r.generation;
    setTest({ kind: "listening" });
    let deviceId: string | null = null;
    if (choice) {
      let list: MicDevice[] | null = null;
      try { list = (await env.listMics?.()) ?? null; } catch { list = null; }
      if (generation !== r.generation) return;
      const resolved = resolveMicChoice(choice, list);
      if (resolved.kind === "missing") { r.generation++; setTest({ kind: "result", text: MIC_MISSING }); return; }
      deviceId = resolved.kind === "device" ? resolved.id : null;
    }
    let stream: StreamLike;
    try {
      stream = await env.getUserMedia({ audio: micAudioConstraint(deviceId) });
    } catch (error) {
      if (generation !== r.generation) return;
      r.generation++;
      const kind = classifyMediaError(error);
      const text = kind === "denied" ? MIC_DENIED_TITLE : kind === "no_mic" ? (deviceId ? MIC_MISSING : NO_MIC) : kind === "busy" ? MIC_BUSY : GENERIC_UNAVAILABLE;
      if (mounted.current) setTest({ kind: "result", text });
      return;
    }
    if (generation !== r.generation || !mounted.current) { for (const track of stream.getTracks()) { try { track.stop(); } catch { /* ignore */ } } return; }
    r.stream = stream; r.peak = 0; r.end = env.now() + MIC_TEST_MS;
    try { r.meter = env.levelMeter?.(stream) ?? null; } catch { r.meter = null; }
    const poll = () => {
      if (generation !== r.generation) return;
      let value: number | null = null;
      try { value = r.meter ? r.meter.read() : null; } catch { value = null; }
      if (value !== null) { r.peak = Math.max(r.peak, value); setLevel(value); }
      if (env.now() >= r.end) { finish(generation); return; }
      r.timer = env.setTimeout(poll, MIC_TEST_POLL_MS);
    };
    poll();
  }, [choice, env, finish]);
  // The dialog closing (unmount) or the window hiding ends a test at once.
  useEffect(() => {
    const hide = () => { if (run.current.stream || run.current.timer !== null) { run.current.generation++; release(); setLevel(null); setTest({ kind: "idle" }); } };
    const onVisibility = () => { if (document.visibilityState === "hidden") hide(); };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", hide);
    return () => { document.removeEventListener("visibilitychange", onVisibility); window.removeEventListener("pagehide", hide); run.current.generation++; release(); };
  }, [release]);

  const press = () => {
    if (test.kind === "listening") { finish(run.current.generation); return; }
    voice.gate(() => {
      const ask = env.micPermission;
      if (!ask || explained.current) { void listen(); return; }
      void ask().then((permission) => {
        if (!mounted.current) return;
        if (needsMicExplainer(permission, explained.current)) { setTest({ kind: "explain" }); return; }
        void listen();
      });
    });
  };
  const allow = () => { explained.current = true; void listen(); };
  const later = () => { explained.current = true; setTest({ kind: "idle" }); };

  const { options, value } = micOptions(devices ?? null, choice, COPY);
  const missing = value !== "" && devices != null && resolveMicChoice(choice, devices).kind === "missing";
  const hint = devices === undefined ? MIC_SETTING_HINT
    : missing ? MIC_SETTING_MISSING
    : devices === null ? MIC_SETTING_HIDDEN
    : devices.length === 0 ? MIC_SETTING_NONE
    : MIC_SETTING_HINT;
  const reduced = typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const onPick = (picked: string) => {
    const next = choiceForPick(picked, devices ?? null);
    if (next === undefined) return;
    postToHost({ type: "setMicInput", choice: next });
  };

  return (
    <fieldset className="hps-text-size hps-mic-setting">
      <legend id={legendId}>{MIC_SETTING_LABEL}</legend>
      <select id={selectId} className="hps-mic-select" value={value} aria-labelledby={legendId} aria-describedby={hintId} data-state={missing ? "missing" : devices === null ? "hidden" : devices?.length === 0 ? "none" : "listed"}
        onChange={(e) => onPick(e.target.value)}>
        {options.map((o) => <option key={o.value || "default"} value={o.value}>{o.text}</option>)}
      </select>
      <p id={hintId} className="hps-mic-hint">{hint}</p>
      {test.kind === "explain" ? (
        <div className="hps-mic-explain" role="group" aria-label={MIC_TEST}>
          <span>{MIC_EXPLAIN_BODY}</span>
          <span className="hps-voice-btns">
            <button type="button" className="hps-voice-primary" autoFocus onClick={allow}>{MIC_EXPLAIN_ALLOW}</button>
            <button type="button" className="hps-voice-link" onClick={later}>{MIC_EXPLAIN_LATER}</button>
          </span>
        </div>
      ) : (
        <span className="hps-mic-test-row">
          <button type="button" className="hps-mic-test" aria-pressed={test.kind === "listening"} onClick={press}>{test.kind === "listening" ? MIC_TEST_STOP : MIC_TEST}</button>
          {test.kind === "listening" && !reduced && level !== null && (
            <span className="hps-voice-level" aria-hidden="true" data-level={level.toFixed(2)} style={{ ["--hps-voice-level" as string]: level.toFixed(2) }}><span /></span>
          )}
        </span>
      )}
      <p className="hps-mic-test-result" role="status">{test.kind === "listening" ? MIC_TEST_LISTENING : test.kind === "result" ? test.text : ""}</p>
    </fieldset>
  );
}
