import { useContext, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { VoiceConversation, type ConversationView } from '../../src/voiceConversation';
import { base64Of, type StreamLike } from '../../src/voiceDictation';
import { PROVISIONAL_ENDPOINTING, shouldEndTurn } from '../../src/voiceSessionHelpers';
import type { ChatConfig } from '../../src/protocol';
import type { ComposerVoiceTurn } from './composerAddon';
import { DictationEnvContext } from './DictationControl';
import { useServedReadAloud } from './ReadAloudButton';
import { useVoice } from './VoiceProvider';
import { onHostMessage, postToHost } from './vscode';
import { ChatIcon } from './ChatDetails';
import { windowOutputMute } from '../../src/voiceOutputMute';
import { readServedVoice } from '../../src/voiceServed';
import { windowVoiceLiveTask } from '../../src/voiceLiveTask';
import { nativeComposing } from './imeGuard';
import { PTT_GROUP_LABEL, PTT_HOLD, PTT_HOLDING, PTT_MODE_HOLD, PTT_MODE_NEXT, PTT_START_LABEL, RECOVER_USE_DEFAULT } from '../../src/voiceCopy';

export function voiceConversationScope(config: ChatConfig | undefined): string {
  return JSON.stringify([config?.activity?.id, config?.taskWorkspace?.activeTaskId, config?.profile?.profile_id, config?.profile?.access_identity?.scope]);
}

/** Actual time-domain observations from the recorder's stream; never connected to speakers.
 * Thresholds remain PROVISIONAL: this internal pilot is not Korean/noise calibration evidence. */
export function observeVoiceEndpoint(stream: StreamLike, end: () => void, lost: () => void): () => void {
  const context = new AudioContext();
  let source: MediaStreamAudioSourceNode | null = null, timer: ReturnType<typeof setInterval> | null = null;
  let closed = false;
  const tracks = (stream as MediaStream).getAudioTracks();
  const cleanup = () => {
    if (closed) return; closed = true;
    if (timer !== null) clearInterval(timer);
    for (const track of tracks) track.removeEventListener('ended', lost);
    source?.disconnect(); void context.close().catch(() => {});
  };
  try {
    source = context.createMediaStreamSource(stream as MediaStream);
    const analyser = context.createAnalyser(); analyser.fftSize = 2048;
    source.connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    let previous = performance.now(), speechMs = 0, silenceMs = 0, peakDb = -Infinity;
    for (const track of tracks) track.addEventListener('ended', lost, { once: true });
    void context.resume().catch(() => { if (!closed) lost(); });
    timer = setInterval(() => {
      if (closed) return;
      if (context.state !== 'running') return;
      const now = performance.now(), elapsed = Math.min(100, Math.max(0, now - previous)); previous = now;
      analyser.getFloatTimeDomainData(samples);
      const rms = Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
      const db = 20 * Math.log10(Math.max(rms, 1e-10));
      if (db > PROVISIONAL_ENDPOINTING.noiseFloorDb) { speechMs += elapsed; silenceMs = 0; peakDb = Math.max(peakDb, db); }
      else silenceMs += elapsed;
      if (silenceMs >= PROVISIONAL_ENDPOINTING.silenceMs && speechMs < PROVISIONAL_ENDPOINTING.minSpeechMs) { speechMs = 0; peakDb = -Infinity; }
      if (shouldEndTurn({ speechMs, silenceMs, peakDb, playbackActive: false }).end) { cleanup(); end(); }
    }, 50);
    return cleanup;
  } catch (error) { cleanup(); throw error; }
}

export function VoiceConversationControl({ turn, config, onActive }: { turn: ComposerVoiceTurn; config?: ChatConfig; onActive(active: boolean): void }) {
  const voice = useVoice(), speech = useServedReadAloud(), makeRecorder = useContext(DictationEnvContext);
  const latest = useRef({ turn, config, voice, onActive }); latest.current = { turn, config, voice, onActive };
  const loop = useRef<VoiceConversation | null>(null);
  const [view, setView] = useState<ConversationView>({ phase: 'idle', note: '' });
  const served = voice.availability.kind === 'on' && voice.availability.served.dictation && voice.availability.served.readAloud;
  const scope = voiceConversationScope(config);
  const ready = () => {
    const value = latest.current;
    return value.config?.hasToken === true && value.config.activity?.verified === true && !windowOutputMute.getMuted() && value.turn.ready && value.voice.availability.kind === 'on' && value.voice.availability.served.dictation && value.voice.availability.served.readAloud && document.visibilityState !== 'hidden';
  };
  useEffect(() => {
    if (!speech) return;
    const controller = new VoiceConversation({
      // R-019: each listening turn reads the current microphone choice, so a change applies at the next turn.
      recorder: Object.assign(makeRecorder(), { micChoice: () => latest.current.voice.micChoice ?? null }), observe: observeVoiceEndpoint, scope: () => voiceConversationScope(latest.current.config), ready,
      transcribe: (requestId, clip) => postToHost({ type: 'voiceTranscribe', requestId, mime: clip.mime, seconds: clip.seconds, audio: base64Of(clip.bytes) }),
      submit: text => latest.current.turn.submit(text), speech,
      changed: next => {
        const active = !['idle', 'stopped'].includes(next.phase);
        latest.current.onActive(active);
        // CGP-VOICE-R-030 — the task rail's marker: the active task while a session is live and voice is served; null once the
        // session has stopped, which comes after the microphone was released.
        const value = latest.current, served = value.voice.availability.kind === 'on' && value.voice.availability.served.dictation && value.voice.availability.served.readAloud;
        windowVoiceLiveTask.set(active && served ? value.config?.taskWorkspace?.activeTaskId ?? null : null);
        setView(next);
      }, id: () => `v${crypto.randomUUID().replace(/-/g, '')}`,
    });
    loop.current = controller;
    const offSpeech = speech.subscribe(() => controller.playbackChanged());
    const offMute = windowOutputMute.subscribe(() => { if (windowOutputMute.getMuted()) controller.stop('소리를 꺼서 음성 대화를 멈췄어요.'); });
    const off = onHostMessage(message => {
      // Stop synchronously, before React commits a new account/activity/task/profile.
      if (message.type === 'config') {
        const granted = readServedVoice(message.config.profile);
        if (voiceConversationScope(message.config) !== voiceConversationScope(latest.current.config) || !message.config.hasToken || !message.config.activity?.verified || !granted?.dictation || !granted.readAloud) controller.stop();
      }
      if (message.type === 'taskWorkspaceState' && message.view.activeTaskId !== latest.current.config?.taskWorkspace?.activeTaskId) controller.stop();
      controller.host(message);
    });
    const hide = () => controller.stop();
    const visibility = () => { if (document.visibilityState === 'hidden') hide(); };
    const escape = (event: KeyboardEvent) => {
      const isComposing = nativeComposing(event);
      if (event.key === 'Escape' && !isComposing && controller.active) { event.preventDefault(); controller.stop(); }
    };
    document.addEventListener('visibilitychange', visibility); window.addEventListener('pagehide', hide); window.addEventListener('keydown', escape);
    return () => { off(); offSpeech(); offMute(); controller.stop(); windowVoiceLiveTask.set(null); loop.current = null; document.removeEventListener('visibilitychange', visibility); window.removeEventListener('pagehide', hide); window.removeEventListener('keydown', escape); };
  }, [speech, makeRecorder]);
  const active = !['idle', 'stopped'].includes(view.phase);
  // CGP-VOICE-R-026 — the hold. Released by the button, Space, a release anywhere (pointer capture plus a window listener)
  // and the window losing focus, so a hold can never leave the microphone open.
  const holding = useRef(false);
  const endHold = () => { if (!holding.current) return; holding.current = false; loop.current?.release(); };
  const beginHold = () => { if (holding.current) return; holding.current = true; loop.current?.hold(); };
  useEffect(() => {
    const up = () => endHold();
    window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up); window.addEventListener('blur', up);
    return () => { window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); window.removeEventListener('blur', up); };
  }, []);
  useLayoutEffect(() => { loop.current?.stop(); }, [scope]);
  useLayoutEffect(() => { if (!served || turn.interrupted) loop.current?.stop(); }, [served, turn.interrupted]);

  if (!served || !speech) return null;
  // R-026: the stored choice (this computer); automatic end of speech unless push-to-talk was chosen. A running session keeps
  // its own mode, which R-027 may have switched for that session only.
  const stored = config?.voiceConversationMode === 'push_to_talk' ? 'push_to_talk' : 'auto';
  const mode = active ? view.mode ?? 'auto' : stored;
  const ptt = mode === 'push_to_talk';
  const start = (useDefault = false) => {
    const requestedScope = scope;
    voice.gate(() => {
      if (requestedScope === voiceConversationScope(latest.current.config) && ready()) loop.current?.start({ useDefault, mode: stored });
    }, true);
  };
  const startLabel = ptt ? PTT_START_LABEL : '자동 음성 대화 시작';
  const capturing = view.phase === 'starting' || view.phase === 'listening';
  const space = (event: { key: string; code?: string }) => event.key === ' ' || event.code === 'Space';
  return <div className="hps-voice-note" role="group" aria-label={ptt ? PTT_GROUP_LABEL : '자동 음성 대화'}>
    <button type="button" className="hps-voice-primary" aria-label={active ? '음성 대화 중지' : turn.blockedReason ? `${startLabel}, ${turn.blockedReason}` : startLabel} aria-pressed={active}
      data-hp-tooltip={!active && turn.blockedReason ? turn.blockedReason : undefined}
      disabled={!active && (!ready() || !speech.available)} onClick={() => active ? loop.current?.stop() : start()}>
      <ChatIcon kind={active ? 'stop' : 'level'} /> {active ? '중지' : '음성 대화'}
    </button>
    {active && ptt && <button type="button" className="hps-voice-hold" aria-pressed={capturing} disabled={view.phase !== 'ready' && !capturing}
      onPointerDown={(event) => { event.preventDefault(); try { event.currentTarget.setPointerCapture?.(event.pointerId); } catch { /* not capturable */ } beginHold(); }}
      onPointerUp={endHold} onPointerCancel={endHold} onLostPointerCapture={endHold}
      // Space holds only while this button has focus; it is consumed here, so no space reaches any text field.
      onKeyDown={(event) => { if (!space(event)) return; event.preventDefault(); event.stopPropagation(); if (!event.repeat) beginHold(); }}
      onKeyUp={(event) => { if (!space(event)) return; event.preventDefault(); event.stopPropagation(); endHold(); }}
      onClick={(event) => event.preventDefault()}>
      {capturing ? PTT_HOLDING : PTT_HOLD}
    </button>}
    {/* R-026: the choice, per computer. A running session keeps its mode; the change applies to the next one. */}
    <label className="hps-voice-mode" data-hp-tooltip={active ? PTT_MODE_NEXT : undefined}>
      <input type="checkbox" checked={stored === 'push_to_talk'} disabled={active}
        onChange={(event) => postToHost({ type: 'setVoiceConversationMode', mode: event.target.checked ? 'push_to_talk' : 'auto' })} />
      <span>{PTT_MODE_HOLD}</span>
    </label>
    <span role="status">{view.note || (ptt ? '버튼을 누르고 있는 동안 듣고, 손을 떼면 보내요. 중지하면 마이크가 꺼져요.' : '말이 끝나면 자동으로 보내고, 답을 읽은 뒤 다시 들어요. 중지하면 마이크가 꺼져요.')}</span>
    {/* R-019: the chosen microphone is not connected. One press restarts this conversation with the default; the choice stays. */}
    {!active && view.recovery === 'use_default' && <button type="button" className="hps-voice-link" disabled={!ready() || !speech.available} onClick={() => start(true)}>{RECOVER_USE_DEFAULT}</button>}
  </div>;
}
