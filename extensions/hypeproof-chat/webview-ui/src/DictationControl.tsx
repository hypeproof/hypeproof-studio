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
  DictationRecorder, base64Of, DICTATION_STOP_AT_MS, RETRY_KEEP_MS, type Clip, type DictationEnv, type DictationFailure, type DictationState,
} from "../../src/voiceDictation";
import {
  CLASS_OFF, CLASS_OFF_HINT, CLOSE, DICTATE_CANCEL_LABEL, DICTATE_DONE, DICTATE_ELAPSED, DICTATE_LABEL, DICTATE_LIMIT_NOTE, DICTATE_RECORDING, DICTATE_START_TIP,
  DICTATE_STOP_LABEL, DICTATE_WORKING, GENERIC_UNAVAILABLE, MIC_BUSY, MIC_DENIED_BODY, MIC_DENIED_DISMISS, MIC_DENIED_TITLE, MIC_SETTINGS_BUTTON,
  MIC_SETTINGS_FAILED, NO_MIC, RECOVERED_COPIED, RECOVERED_COPY, RECOVERED_INSERT, RETRY, RETRY_TEXT_LABEL, SOFT_TOO_SHORT, TOO_LARGE, UNSUPPORTED,
} from "../../src/voiceCopy";

type View =
  | { kind: "idle" }
  | { kind: "starting" }
  | { kind: "recording"; seconds: number }
  | { kind: "working" }
  | { kind: "done" }
  | { kind: "notice"; text: string; retry: boolean }
  | { kind: "denied"; settingsFailed: boolean }
  | { kind: "recovered"; text: string; copied: boolean };

export interface DictationController {
  view: View;
  /** The one control action: start, or stop when recording. */
  toggle(): void;
  cancel(): void;
  retry(): void;
  dismiss(): void;
  insertRecovered(): void;
  copyRecovered(): void;
  openSettings(): void;
  busy: boolean;
}

/** Browser objects for the recorder. Tests replace this through `DictationEnvContext`. */
export const browserDictationEnv = (): DictationEnv => ({
  getUserMedia: (c) => navigator.mediaDevices.getUserMedia(c) as Promise<MediaStream>,
  Recorder: (typeof MediaRecorder === "undefined" ? undefined : MediaRecorder) as unknown as DictationEnv["Recorder"],
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as never),
});
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
  const keepTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const afterRetry = useRef(false);
  const mounted = useRef(true);
  const inFlight = useRef<string | null>(null);
  const offInFlight = useRef<(() => void) | null>(null);
  const tick = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dropClip = useCallback(() => {
    clip.current = null; afterRetry.current = false;
    if (keepTimer.current !== null) { clearTimeout(keepTimer.current); keepTimer.current = null; }
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
    if (keepTimer.current !== null) clearTimeout(keepTimer.current);
    // REQ-CGPV-19: a clip kept for a retry is dropped after ten minutes.
    keepTimer.current = setTimeout(() => { clip.current = null; keepTimer.current = null; }, RETRY_KEEP_MS);
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
      set({ kind: "notice", text: m.message, retry: m.retry });
    });
    offInFlight.current = off;
    postToHost({ type: "voiceTranscribe", requestId, mime: kept.mime, seconds: kept.seconds, audio: base64Of(kept.bytes) });
  }, [dropClip, keepForRetry, set, voice]);

  // One recorder for the life of the control. Its callbacks read the latest handlers through a ref, so a
  // re-render (the disclosure being acknowledged, a profile refresh) never swaps the recorder mid-clip.
  const handlers = useRef({ send, set });
  handlers.current = { send, set };
  const [recorder] = useState(() => new DictationRecorder(makeEnv(), {
    onState: (state: DictationState) => {
      stopTick();
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
      handlers.current.set({ kind: "notice", text: FAILURE_TEXT[kind], retry: false });
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

  const toggle = useCallback(() => {
    if (apiRef.current.disabled) return;
    if (recorder.current === "recording") { recorder.stop(); return; }
    if (recorder.current !== "idle" || inFlight.current) return;
    dropClip();
    voice.gate(() => { void recorder.start(); });
  }, [recorder, voice, dropClip]);

  const cancel = useCallback(() => { recorder.cancel(); set({ kind: "idle" }); }, [recorder, set]);
  const dismiss = useCallback(() => { dropClip(); set({ kind: "idle" }); }, [dropClip, set]);
  const retry = useCallback(() => {
    const kept = clip.current;
    if (!kept || inFlight.current) return;
    afterRetry.current = true;
    send(kept);
  }, [send]);
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
  return { view, toggle, cancel, retry, dismiss, insertRecovered, copyRecovered, openSettings, busy };
}

const ControllerContext = createContext<DictationController | null>(null);

/** Holds the one dictation controller so the button and the status area share it. Mounted by the composer addon. */
export function DictationScope({ api, children }: { api: ComposerAddonApi; children: ReactNode }) {
  const controller = useDictation(api);
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
  const label = recording ? DICTATE_STOP_LABEL : DICTATE_LABEL;
  return (
    <button
      ref={ref}
      type="button"
      className={`hps-voice-mic${recording ? " hps-voice-mic-on" : ""}`}
      aria-label={label}
      aria-pressed={recording}
      aria-keyshortcuts="Alt+Shift+M"
      data-hp-tooltip={recording ? `${DICTATE_STOP_LABEL} · ${DICTATION_SHORTCUT_LABEL()}` : `${DICTATE_START_TIP} · ${DICTATION_SHORTCUT_LABEL()}`}
      disabled={view.kind === "starting" || view.kind === "working"}
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
  const { view } = controller;
  switch (view.kind) {
    case "idle": case "starting": return null;
    case "recording":
      return (
        <div className="hps-voice-note hps-voice-recording" role="group" aria-label={DICTATE_RECORDING}>
          <span className="hps-voice-rec-dot" aria-hidden="true" />
          <span role="status">{DICTATE_RECORDING}</span>
          <span className="hps-voice-time" aria-hidden="true">{DICTATE_ELAPSED(view.seconds, Math.round(DICTATION_STOP_AT_MS / 1000))}</span>
          <span className="hps-voice-limit">{DICTATE_LIMIT_NOTE}</span>
          <button type="button" className="hps-voice-link" onClick={controller.cancel}>{DICTATE_CANCEL_LABEL}</button>
        </div>
      );
    case "working": return <p className="hps-voice-note" role="status">{DICTATE_WORKING}</p>;
    case "done": return <p className="hps-voice-note" role="status">{DICTATE_DONE}</p>;
    case "notice":
      return (
        <div className="hps-voice-note" role="status">
          <span>{view.text}</span>
          <span className="hps-voice-btns">
            {view.retry && <button type="button" className="hps-voice-link" onClick={controller.retry}>{RETRY}</button>}
            <button type="button" className="hps-voice-link" onClick={controller.dismiss}>{CLOSE}</button>
          </span>
        </div>
      );
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
