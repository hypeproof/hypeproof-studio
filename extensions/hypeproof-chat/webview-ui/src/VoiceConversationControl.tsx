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
import { nativeComposing } from './imeGuard';

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
      recorder: makeRecorder(), observe: observeVoiceEndpoint, scope: () => voiceConversationScope(latest.current.config), ready,
      transcribe: (requestId, clip) => postToHost({ type: 'voiceTranscribe', requestId, mime: clip.mime, seconds: clip.seconds, audio: base64Of(clip.bytes) }),
      submit: text => latest.current.turn.submit(text), speech,
      changed: next => { latest.current.onActive(!['idle', 'stopped'].includes(next.phase)); setView(next); }, id: () => `v${crypto.randomUUID().replace(/-/g, '')}`,
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
    return () => { off(); offSpeech(); offMute(); controller.stop(); loop.current = null; document.removeEventListener('visibilitychange', visibility); window.removeEventListener('pagehide', hide); window.removeEventListener('keydown', escape); };
  }, [speech, makeRecorder]);
  const active = !['idle', 'stopped'].includes(view.phase);
  useLayoutEffect(() => { loop.current?.stop(); }, [scope]);
  useLayoutEffect(() => { if (!served || turn.interrupted) loop.current?.stop(); }, [served, turn.interrupted]);

  if (!served || !speech) return null;
  const start = () => {
    const requestedScope = scope;
    voice.gate(() => {
      if (requestedScope === voiceConversationScope(latest.current.config) && ready()) loop.current?.start();
    }, true);
  };
  return <div className="hps-voice-note" role="group" aria-label="자동 음성 대화">
    <button type="button" className="hps-voice-primary" aria-label={active ? '음성 대화 중지' : '자동 음성 대화 시작'} aria-pressed={active}
      disabled={!active && (!ready() || !speech.available)} onClick={() => active ? loop.current?.stop() : start()}>
      <ChatIcon kind={active ? 'stop' : 'level'} /> {active ? '중지' : '음성 대화'}
    </button>
    <span role="status">{view.note || '말이 끝나면 자동으로 보내고, 답을 읽은 뒤 다시 들어요. 중지하면 마이크가 꺼져요.'}</span>
  </div>;
}
