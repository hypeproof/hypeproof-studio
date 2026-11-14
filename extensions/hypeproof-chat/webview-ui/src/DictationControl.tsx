// Dictation in the composer (REQ-CGPV-17/18/19, CGP-VOICE-R-003/R-012/R-016). One mic button in the
// composer's button row and one status area above the text box. The learner presses, speaks, presses
// again; the transcript lands in the draft for them to edit and send. It never sends by itself.
//
// Audio exists only inside this file's refs as in-memory bytes: no file, no Blob URL, no storage, no
// log. The finished clip goes to the host (the webview's CSP allows no network). After a failure the
// clip is kept in memory for ten minutes for one retry, then dropped; dismissing drops it at once.
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { ChatIcon } from "./ChatDetails";
import { useVoice } from "./VoiceProvider";
import { onHostMessage, postToHost } from "./vscode";
import type { ComposerAddonApi } from "./composerAddon";
import {
  DictationRecorder, base64Of, levelOf, needsMicExplainer, DICTATION_STOP_AT_MS, RETRY_KEEP_MS, type Clip, type DictationEnv, type DictationFailure, type DictationState, type LevelMeter, type MicPermission,
} from "../../src/voiceDictation";
import { autoDismissMs, recoveryFor, type DictationRecovery } from "../../src/dictationRecovery";
import { DICTATE_STARTING, RECOVER_RESEND, RECOVER_SPEAK_AGAIN, RECOVER_TYPE } from "../../src/voiceCopy";
import {
  CLASS_OFF, CLASS_OFF_HINT, CLOSE, DICTATE_CANCEL_LABEL, DICTATE_DONE, DICTATE_ELAPSED, DICTATE_LABEL, DICTATE_LIMIT_NOTE, DICTATE_RECORDING, DICTATE_START_TIP,
  DICTATE_STOP_LABEL, DICTATE_WORKING, GENERIC_UNAVAILABLE, MIC_BUSY, MIC_DENIED_BODY, MIC_DENIED_DISMISS, MIC_DENIED_TITLE, MIC_SETTINGS_BUTTON,
  MIC_EXPLAIN_ALLOW, MIC_EXPLAIN_BODY, MIC_EXPLAIN_LATER, MIC_EXPLAIN_TITLE, MIC_SETTINGS_FAILED, NO_MIC, RECOVERED_COPIED, RECOVERED_COPY, RECOVERED_INSERT, RETRY_TEXT_LABEL, SOFT_TOO_SHORT, TOO_LARGE, UNSUPPORTED,
} from "../../src/voiceCopy";

export type DictationView =
  | { kind: "idle" }
  | { kind: "starting" }
  | { kind: "recording"; seconds: number }
  | { kind: "working" }
  | { kind: "done" }
  /** R-015: a failure line with its cause and its one recovery action (null: a refusal with nothing to do but read). */
  | { kind: "notice"; text: string; cause: string; recovery: DictationRecovery | null }
  | { kind: "denied"; settingsFailed: boolean }
  /** CGP-SHELL-R-010: Studio's own explainer, before the OS microphone prompt can appear. */
  | { kind: "explain" }
  | { kind: "recovered"; text: string; copied: boolean };

type View = DictationView;

export interface DictationController {
  view: View;
  /** The one control action: start, or stop when recording. */
  toggle(): void;
  cancel(): void;
  retry(): void;
  /** R-015: run the notice's recovery action (다시 보내기 / 다시 말하기 / 글로 쓰기). */
  recover(): void;
  dismiss(): void;
  insertRecovered(): void;
  copyRecovered(): void;
  openSettings(): void;
  /** CGP-SHELL-R-010: 허용하기 starts the recording (the OS may ask now); 나중에 goes back to idle. */
  allowMic(): void;
  laterMic(): void;
  busy: boolean;
  disabled: boolean;
  /** R-014: why the control is off (another control holds the microphone), or null. */
  disabledReason: string | null;
  /** D-010: the recording's current input level (0..1), or null with no meter. */
  level(): number | null;
  /** R-015 / policy 3: whether a clip is held in memory for 다시 보내기 right now (read-only; never the bytes). */
  hasKeptClip(): boolean;
}

/** Browser objects for the recorder. Tests replace this through `DictationEnvContext`. */
/** CGP-SHELL-R-010: the Permissions API's answer for the microphone, or `unknown` (never throws, 1 s at most). */
async function browserMicPermission(): Promise<MicPermission> {
  try {
    const query = navigator.permissions?.query({ name: "microphone" as PermissionName });
    if (!query) return "unknown";
    const state = await Promise.race([query.then((r) => r.state), new Promise<null>((r) => setTimeout(() => r(null), 1000))]);
    return state === "granted" || state === "denied" || state === "prompt" ? state : "unknown";
  } catch {
    return "unknown";
  }
}

export const browserDictationEnv = (): DictationEnv => ({
  micPermission: browserMicPermission,
  getUserMedia: (c) => navigator.mediaDevices.getUserMedia(c) as Promise<MediaStream>,
  Recorder: (typeof MediaRecorder === "undefined" ? undefined : MediaRecorder) as unknown as DictationEnv["Recorder"],
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as never),
  levelMeter: browserLevelMeter,
});

/**
 * CGP-VOICE-D-010: the recording's input level, decorative. An AnalyserNode on the same stream, never connected
 * to the speakers; `read` overwrites one reused block (no samples are kept) and `close` disconnects everything.
 */
function browserLevelMeter(stream: unknown): LevelMeter | null {
  const Ctx = typeof window === "undefined" ? undefined : (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
  if (!Ctx) return null;
  const context = new Ctx();
  const source = context.createMediaStreamSource(stream as MediaStream);
  const analyser = context.createAnalyser();
  analyser.fftSize = 1024;
  source.connect(analyser);
  const block = new Float32Array(analyser.fftSize);
  return {
    read: () => { analyser.getFloatTimeDomainData(block); return levelOf(block); },
    close: () => {
      try { source.disconnect(); } catch { /* ignore */ }
      try { analyser.disconnect(); } catch { /* ignore */ }
      void context.close().catch(() => {});
    },
  };
}
export const DictationEnvContext = createContext<() => DictationEnv>(browserDictationEnv);

const FAILURE_TEXT: Record<Exclude<DictationFailure, "denied">, string> = {
  no_mic: NO_MIC, busy: MIC_BUSY, unsupported: UNSUPPORTED, too_short: SOFT_TOO_SHORT, too_large: TOO_LARGE, failed: GENERIC_UNAVAILABLE,
};

function newRequestId(): string { return `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`; }

function useDictation(api: ComposerAddonApi): DictationController {
  const voice = useVoice();
  const makeEnv = useContext(DictationEnvContext);
  const [view, setView] = useState<View>({ kind: "idle" });
  const apiRef = useRef(api); apiRef.current = api;
  const clip = useRef<Clip | null>(null);
  // The browser objects for this control, made once. The retry keep-timer runs on the same clock (tests drive it).
  const [env] = useState(makeEnv);
  const envRef = useRef(env);
  const keepTimer = useRef<unknown>(null);
  const afterRetry = useRef(false);
  const mounted = useRef(true);
  const inFlight = useRef<string | null>(null);
  const offInFlight = useRef<(() => void) | null>(null);
  const tick = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dropClip = useCallback(() => {
    clip.current = null; afterRetry.current = false;
    if (keepTimer.current !== null) { envRef.current.clearTimeout(keepTimer.current); keepTimer.current = null; }
  }, []);
  // Forgets the clip being transcribed: stops listening for its answer, so a late reply can neither keep it
  // for a retry nor insert text.
  const forgetInFlight = () => {
    offInFlight.current?.(); offInFlight.current = null;
    inFlight.current = null;
  };
  const stopTick = () => { if (tick.current !== null) { clearInterval(tick.current); tick.current = null; } };
  const set = useCallback((next: View) => { if (mounted.current) setView(next); }, []);

  const keepForRetry = useCallback((kept: Clip) => {
    clip.current = kept;
    if (keepTimer.current !== null) envRef.current.clearTimeout(keepTimer.current);
    // REQ-CGPV-19: a clip kept for a retry is dropped after ten minutes.
    keepTimer.current = envRef.current.setTimeout(() => { clip.current = null; keepTimer.current = null; }, RETRY_KEEP_MS);
  }, []);

  const send = useCallback((kept: Clip) => {
    const requestId = newRequestId();
    inFlight.current = requestId;
    set({ kind: "working" });
    const off = onHostMessage((m) => {
      if (m.type !== "voiceTranscribeResult" || m.requestId !== requestId) return;
      off();
      offInFlight.current = null;
      if (inFlight.current !== requestId) return;
      inFlight.current = null;
      if (m.ok) {
        const wasRetry = afterRetry.current;
        dropClip();
        if (wasRetry) { set({ kind: "recovered", text: m.text, copied: false }); return; }
        // Direct insert: never a send. If the draft cannot take it, hand it over as recovered text.
        if (apiRef.current.insert(m.text)) { set({ kind: "done" }); return; }
        set({ kind: "recovered", text: m.text, copied: false });
        return;
      }
      if (m.kind === "class_off") { dropClip(); voice.markClassOff(); set({ kind: "idle" }); return; }
      if (m.retry) keepForRetry(kept); else dropClip();
      set({ kind: "notice", text: m.message, cause: m.kind, recovery: recoveryFor(m.kind, m.retry, m.retry) });
    });
    offInFlight.current = off;
    postToHost({ type: "voiceTranscribe", requestId, mime: kept.mime, seconds: kept.seconds, audio: base64Of(kept.bytes) });
  }, [dropClip, keepForRetry, set, voice]);

  // One recorder for the life of the control. Its callbacks read the latest handlers through a ref, so a
  // re-render (the disclosure being acknowledged, a profile refresh) never swaps the recorder mid-clip.
  const handlers = useRef({ send, set });
  handlers.current = { send, set };
  const [recorder] = useState(() => new DictationRecorder(env, {
    onState: (state: DictationState) => {
      stopTick();
      apiRef.current.onDictationBusy?.(state !== "idle");
      if (state === "starting") handlers.current.set({ kind: "starting" });
      if (state === "recording") {
        handlers.current.set({ kind: "recording", seconds: 0 });
        const started = Date.now();
        tick.current = setInterval(() => handlers.current.set({ kind: "recording", seconds: Math.floor((Date.now() - started) / 1000) }), 1000);
      }
    },
    onClip: (c) => { afterRetry.current = false; handlers.current.send(c); },
    onFailure: (kind) => {
      if (kind === "denied") { handlers.current.set({ kind: "denied", settingsFailed: false }); return; }
      handlers.current.set({ kind: "notice", text: FAILURE_TEXT[kind], cause: kind, recovery: recoveryFor(kind, false, false) });
    },
  }));

  useEffect(() => {
    mounted.current = true;   // a dev-mode remount runs this cleanup and then this setup again
    return () => {
      mounted.current = false;
      stopTick();
      recorder.cancel();     // closes the microphone
      dropClip();            // and drops any kept audio (window close, panel gone)
      forgetInFlight();
    };
  }, [recorder, dropClip]);

  // The chat view keeps its webview alive while hidden (retainContextWhenHidden), so a hidden window would
  // keep the microphone open. Hiding stops the recording and drops the clip, any kept retry copy and a clip still being transcribed.
  useEffect(() => {
    const hide = () => {
      recorder.cancel();
      dropClip();
      forgetInFlight();   // a clip still being transcribed is dropped too: no retry copy outlives the hide
      stopTick();
      handlers.current.set({ kind: "idle" });
    };
    const onVisibility = () => { if (document.visibilityState === "hidden") hide(); };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", hide);
    return () => { document.removeEventListener("visibilitychange", onVisibility); window.removeEventListener("pagehide", hide); };
  }, [recorder, dropClip]);

  // CGP-SHELL-R-010: whether this control already showed the microphone explainer (one per control).
  const explained = useRef(false);
  const toggle = useCallback(() => {
    if (apiRef.current.disabled) {
      // R-014: refused with a message, not silently, when another control holds the microphone.
      const reason = apiRef.current.disabledReason;
      if (reason && recorder.current === "idle" && !inFlight.current) set({ kind: "notice", text: reason, cause: "blocked", recovery: null });
      return;
    }
    // CGP-SHELL-R-010: the microphone is never asked for (no card, no query, no getUserMedia) unless
    // dictation itself is served. The composer mounts this control only then, and the Alt+Shift+M
    // listener lives in the button whatever it draws, so the press checks it too.
    if (voice.availability.kind !== "on" || !voice.availability.served.dictation) return;
    if (recorder.current === "recording") { recorder.stop(); return; }
    if (recorder.current !== "idle" || inFlight.current) return;
    dropClip();
    voice.gate(() => {
      const ask = envRef.current.micPermission;
      if (!ask || explained.current) { void recorder.start(); return; }
      void ask().then((permission) => {
        if (recorder.current !== "idle" || inFlight.current) return;
        if (needsMicExplainer(permission, explained.current)) { set({ kind: "explain" }); return; }
        void recorder.start();
      });
    });
  }, [recorder, voice, dropClip, set]);
  const allowMic = useCallback(() => {
    if (view.kind !== "explain") return;
    explained.current = true;
    set({ kind: "idle" });
    void recorder.start();   // the OS asks now, right after the learner read why
  }, [view, recorder, set]);
  const laterMic = useCallback(() => {
    if (view.kind !== "explain") return;
    explained.current = true;
    set({ kind: "idle" });
  }, [view, set]);

  const cancel = useCallback(() => { recorder.cancel(); set({ kind: "idle" }); }, [recorder, set]);
  const dismiss = useCallback(() => { dropClip(); set({ kind: "idle" }); }, [dropClip, set]);
  const retry = useCallback(() => {
    const kept = clip.current;
    if (!kept || inFlight.current) return;
    afterRetry.current = true;
    send(kept);
  }, [send]);
  const recover = useCallback(() => {
    if (view.kind !== "notice" || !view.recovery) return;
    if (view.recovery === "resend") {
      if (clip.current && !inFlight.current) { retry(); return; }
      // The kept clip is gone (10 minutes, a hide): the only honest fallback is a new recording.
    }
    if (view.recovery === "type") { dismiss(); apiRef.current.focusComposer?.(); return; }
    dismiss();
    toggle();
  }, [view, retry, dismiss, toggle]);
  const insertRecovered = useCallback(() => {
    if (view.kind !== "recovered") return;
    if (apiRef.current.insert(view.text)) set({ kind: "done" });
  }, [view, set]);
  const copyRecovered = useCallback(() => {
    if (view.kind !== "recovered") return;
    const text = view.text;
    void navigator.clipboard?.writeText(text).then(() => set({ kind: "recovered", text, copied: true }), () => {});
  }, [view, set]);
  const openSettings = useCallback(() => {
    const off = onHostMessage((m) => {
      if (m.type !== "voiceMicSettingsResult") return;
      off();
      if (!m.ok) set({ kind: "denied", settingsFailed: true });
    });
    postToHost({ type: "voiceOpenMicSettings" });
  }, [set]);

  const busy = view.kind === "starting" || view.kind === "recording" || view.kind === "working";
  const level = useCallback(() => recorder.level(), [recorder]);
  const hasKeptClip = useCallback(() => clip.current !== null, []);
  return { view, toggle, cancel, retry, recover, dismiss, level, insertRecovered, copyRecovered, openSettings, allowMic, laterMic, busy, disabled: api.disabled, disabledReason: api.disabled ? api.disabledReason ?? null : null, hasKeptClip };
}

const ControllerContext = createContext<DictationController | null>(null);
/** The dictation controller of the enclosing scope, or null (tests read its state through it). */
export const useDictationController = (): DictationController | null => useContext(ControllerContext);

/** Holds the one dictation controller so the button and the status area share it. Mounted by the composer addon. */
export function DictationScope({ api, children }: { api: ComposerAddonApi; children: ReactNode }) {
  const controller = useDictation(api);
  useEffect(() => { api.onDictationBusy?.(controller.busy); return () => api.onDictationBusy?.(false); }, [controller.busy, api.onDictationBusy]);
  return <ControllerContext.Provider value={controller}>{children}</ControllerContext.Provider>;
}

const isMac = () => /mac|iphone|ipad/i.test(typeof navigator === "undefined" ? "" : navigator.platform || navigator.userAgent);
/** In-app only (REQ-CGPV-25): a key this webview binds while it has focus, never a global shortcut. */
export const DICTATION_SHORTCUT_LABEL = () => (isMac() ? "⌥ Option + ⇧ Shift + M" : "Alt + Shift + M");

export function DictationButton() {
  const controller = useContext(ControllerContext);
  const voice = useVoice();
  const ref = useRef<HTMLButtonElement | null>(null);
  const view = controller?.view;
  useEffect(() => {
    if (!controller) return;
    const onKey = (event: KeyboardEvent) => {
      const composing = event.isComposing || event.keyCode === 229;
      if (composing) return;
      // Alt+Shift+M: the physical M key (macOS Option changes event.key), so match on the code too.
      if (event.altKey && event.shiftKey && !event.ctrlKey && !event.metaKey && (event.code === "KeyM" || event.key.toLowerCase() === "m") && !event.repeat) {
        event.preventDefault();
        controller.toggle();
        return;
      }
      if (event.key === "Escape" && controller.view.kind === "recording") {
        event.preventDefault(); event.stopPropagation();
        controller.cancel();
        ref.current?.focus({ preventScroll: true });
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [controller]);
  if (voice.availability.kind === "class_off") {
    return <button type="button" className="hps-voice-mic" disabled aria-label={`${DICTATE_LABEL}, ${CLASS_OFF}`} data-hp-tooltip={CLASS_OFF}><ChatIcon kind="mic" /></button>;
  }
  if (voice.availability.kind !== "on" || !voice.availability.served.dictation || !controller || !view) return null;
  const recording = view.kind === "recording";
  // R-014: when another control holds the microphone the button says why, in its name and its tooltip.
  const reason = controller.disabledReason;
  const label = recording ? DICTATE_STOP_LABEL : reason ? `${DICTATE_LABEL}, ${reason}` : DICTATE_LABEL;
  return (
    <button
      ref={ref}
      type="button"
      className={`hps-voice-mic${recording ? " hps-voice-mic-on" : ""}`}
      aria-label={label}
      aria-pressed={recording}
      aria-keyshortcuts="Alt+Shift+M"
      data-hp-tooltip={recording ? `${DICTATE_STOP_LABEL} · ${DICTATION_SHORTCUT_LABEL()}` : reason ?? `${DICTATE_START_TIP} · ${DICTATION_SHORTCUT_LABEL()}`}
      disabled={controller.disabled || view.kind === "starting" || view.kind === "working"}
      onClick={() => controller.toggle()}
    >
      <ChatIcon kind={recording ? "stop" : "mic"} />
    </button>
  );
}

/** The status and recovery area above the text box. Draws nothing while idle. */
export function DictationNotice() {
  const controller = useContext(ControllerContext);
  const voice = useVoice();
  if (voice.availability.kind === "class_off") {
    // D-018: the reason is text, not only a greyed button; the text flow is unchanged.
    return <p className="hps-voice-note hps-voice-classoff" role="status">{CLASS_OFF}. {CLASS_OFF_HINT}</p>;
  }
  if (!controller || voice.availability.kind !== "on") return null;
  return <DictationNoticeView view={controller.view} controller={controller} />;
}

/** The notice for one dictation state (exported so tests read the real markup, e.g. chat-keys' microphone-card guard). */
export function DictationNoticeView({ view, controller }: { view: View; controller: DictationController }) {
  switch (view.kind) {
    case "idle": return null;
    case "starting":
      // D-010: the start in words (the OS prompt may be open), never a spinner; 취소 stops it.
      return (
        <div className="hps-voice-note hps-voice-starting" role="group" aria-label={DICTATE_STARTING}>
          <span role="status">{DICTATE_STARTING}</span>
          <button type="button" className="hps-voice-link" onClick={controller.cancel}>{DICTATE_CANCEL_LABEL}</button>
        </div>
      );
    case "recording":
      return (
        <div className="hps-voice-note hps-voice-recording" role="group" aria-label={DICTATE_RECORDING}>
          <span className="hps-voice-rec-dot" aria-hidden="true" />
          <span role="status">{DICTATE_RECORDING}</span>
          <LevelBar level={controller.level} />
          <span className="hps-voice-time" aria-hidden="true">{DICTATE_ELAPSED(view.seconds, Math.round(DICTATION_STOP_AT_MS / 1000))}</span>
          <span className="hps-voice-limit">{DICTATE_LIMIT_NOTE}</span>
          <button type="button" className="hps-voice-link" onClick={controller.cancel}>{DICTATE_CANCEL_LABEL}</button>
        </div>
      );
    case "working": return <p className="hps-voice-note" role="status">{DICTATE_WORKING}</p>;
    case "done": return <p className="hps-voice-note" role="status">{DICTATE_DONE}</p>;
    case "notice":
      return <FailureNotice view={view} controller={controller} />;
    case "denied":
      return (
        <div className="hps-voice-note hps-voice-card" role="group" aria-labelledby="hps-voice-denied-title">
          <strong id="hps-voice-denied-title">{MIC_DENIED_TITLE}</strong>
          <span>{MIC_DENIED_BODY}</span>
          {view.settingsFailed && <span role="status">{MIC_SETTINGS_FAILED}</span>}
          <span className="hps-voice-btns">
            <button type="button" className="hps-voice-primary" onClick={controller.openSettings}>{MIC_SETTINGS_BUTTON}</button>
            <button type="button" className="hps-voice-link" onClick={controller.dismiss}>{MIC_DENIED_DISMISS}</button>
          </span>
        </div>
      );
    case "explain":
      // CGP-SHELL-R-010 / DES-SHELL-09: an inline card in the chat, not a modal. The OS prompt comes only after 허용하기.
      return (
        <div className="hps-voice-note hps-voice-card hps-voice-explain" role="group" aria-labelledby="hps-voice-explain-title">
          <strong id="hps-voice-explain-title"><ChatIcon kind="mic" size={20} /><span>{MIC_EXPLAIN_TITLE}</span></strong>
          <span>{MIC_EXPLAIN_BODY}</span>
          <span className="hps-voice-btns">
            <button type="button" className="hps-voice-primary" autoFocus onClick={controller.allowMic}>{MIC_EXPLAIN_ALLOW}</button>
            <button type="button" className="hps-voice-link" onClick={controller.laterMic}>{MIC_EXPLAIN_LATER}</button>
          </span>
        </div>
      );
    case "recovered":
      return (
        <div className="hps-voice-note hps-voice-card" role="group" aria-label={RETRY_TEXT_LABEL}>
          <strong>{RETRY_TEXT_LABEL}</strong>
          <span className="hps-voice-recovered">{view.text}</span>
          <span className="hps-voice-btns">
            <button type="button" className="hps-voice-primary" onClick={controller.insertRecovered}>{RECOVERED_INSERT}</button>
            <button type="button" className="hps-voice-link" onClick={controller.copyRecovered}>{view.copied ? RECOVERED_COPIED : RECOVERED_COPY}</button>
            <button type="button" className="hps-voice-link" onClick={controller.dismiss}>{CLOSE}</button>
          </span>
        </div>
      );
  }
}

const RECOVERY_LABEL: Record<DictationRecovery, string> = { resend: RECOVER_RESEND, speak_again: RECOVER_SPEAK_AGAIN, type: RECOVER_TYPE };

/**
 * D-012 / R-015: one failure line: the alert icon, the cause's one sentence and its one recovery action, with
 * 닫기 as the quiet way out. Only "too short" goes away on its own (8 s), and not while focus is inside it.
 */
function FailureNotice({ view, controller }: { view: Extract<View, { kind: "notice" }>; controller: DictationController }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const ms = autoDismissMs(view.cause);
    if (ms === null) return;
    const timer = setTimeout(() => {
      if (ref.current && ref.current.contains(document.activeElement)) return;
      controller.dismiss();
    }, ms);
    return () => clearTimeout(timer);
  }, [view, controller]);
  return (
    <div ref={ref} className="hps-voice-note hps-voice-failure" role="status" data-cause={view.cause}>
      <ChatIcon kind="alert" size={20} />
      <span className="hps-voice-failure-text">{view.text}</span>
      <span className="hps-voice-btns">
        {view.recovery && <button type="button" className="hps-voice-primary" data-recovery={view.recovery} onClick={controller.recover}>{RECOVERY_LABEL[view.recovery]}</button>}
        <button type="button" className="hps-voice-link" onClick={controller.dismiss}>{CLOSE}</button>
      </span>
    </div>
  );
}

/**
 * D-010: the recording's input level, decorative (aria-hidden; the words carry the state). It follows the real
 * RMS a few times a second; with reduced motion it is not drawn at all, so nothing moves.
 */
function LevelBar({ level }: { level: () => number | null }) {
  const reduced = typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const [value, setValue] = useState<number | null>(() => (reduced ? null : level()));
  useEffect(() => {
    if (reduced) return;
    const timer = setInterval(() => setValue(level()), 120);
    return () => clearInterval(timer);
  }, [level, reduced]);
  if (reduced || value === null) return null;
  return <span className="hps-voice-level" aria-hidden="true" data-level={value.toFixed(2)} style={{ ["--hps-voice-level" as string]: value.toFixed(2) }}><span /></span>;
}
