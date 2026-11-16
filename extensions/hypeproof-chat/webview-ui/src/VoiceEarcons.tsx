// CGP-VOICE-R-018 (REQ-CGPV-22 / DES-CGPV-22, VO-26): the optional start and end sounds, and their switch.
//
// VoiceEarcons draws nothing. It listens to the two sources (dictation's recording flag and the conversation's live
// task) and plays one short WebAudio glide per change that EarconPairs allows: only with this seat's 시작·끝 소리 on
// and the window's sound not off. The coach's read-aloud is not a source. No asset, no network, nothing stored or
// logged; a missing or failing AudioContext is silent and changes nothing. The visual and ARIA state never depends
// on a sound.

import { useEffect, useRef } from 'react';
import { EARCON_GAIN, EARCON_TONES, EarconPairs, windowDictationRecording, type Earcon, type EarconSource } from '../../src/voiceEarcons';
import { windowVoiceLiveTask } from '../../src/voiceLiveTask';
import { windowOutputMute } from '../../src/voiceOutputMute';
import { VOICE_SOUNDS_SETTING, VOICE_SOUNDS_SETTING_HINT } from '../../src/voiceSounds';
import { useVoice } from './VoiceProvider';

type AudioCtor = new () => AudioContext;
let context: AudioContext | null = null;

function play(sound: Earcon): void {
  try {
    const Ctor = (window as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor }).AudioContext
      ?? (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext;
    if (!Ctor) return;
    context ??= new Ctor();
    if (context.state === 'suspended') void context.resume().catch(() => {});
    const tone = EARCON_TONES[sound], now = context.currentTime, end = now + tone.ms / 1000;
    const osc = context.createOscillator(), gain = context.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(tone.from, now);
    osc.frequency.linearRampToValueAtTime(tone.to, end);
    gain.gain.setValueAtTime(EARCON_GAIN, now);
    gain.gain.linearRampToValueAtTime(0, end);
    osc.connect(gain); gain.connect(context.destination);
    osc.start(now); osc.stop(end);
  } catch { /* silent: a sound is never required */ }
}

export function VoiceEarcons({ on }: { on: boolean }) {
  const allowed = useRef(on); allowed.current = on;
  const pairs = useRef(new EarconPairs()).current;
  useEffect(() => {
    const listen = (source: EarconSource, read: () => boolean) => () => {
      const sound = pairs.change(source, read(), allowed.current && !windowOutputMute.getMuted());
      if (sound) play(sound);
    };
    const dictation = listen('dictation', windowDictationRecording.get);
    const conversation = listen('conversation', () => windowVoiceLiveTask.get() !== null);
    const offs = [windowDictationRecording.subscribe(dictation), windowVoiceLiveTask.subscribe(conversation)];
    return () => offs.forEach(off => off());
  }, [pairs]);
  return null;
}

/** The 시작·끝 소리 내기 row in the chat's settings dialog; only where dictation or the conversation is served. */
export function VoiceSoundsSetting({ on, onChange, open = true }: { on: boolean; onChange: (on: boolean) => void; open?: boolean }) {
  const voice = useVoice();
  if (!open || voice.availability.kind !== 'on' || !voice.availability.served.dictation) return null;
  return (
    <fieldset className="hps-text-size hps-voice-sounds-setting">
      <legend>{VOICE_SOUNDS_SETTING}</legend>
      <label>
        <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} aria-describedby="hps-voice-sounds-setting-hint" />
        <span>{VOICE_SOUNDS_SETTING}</span>
      </label>
      <p id="hps-voice-sounds-setting-hint" className="hps-voice-sounds-setting-hint">{VOICE_SOUNDS_SETTING_HINT}</p>
    </fieldset>
  );
}
