// Read-aloud on a completed answer (REQ-CGPV-24, CGP-CHAT-R-009): "소리로 듣기" in the answer's action
// row. The operating system's own voice reads it, in Korean, on this device: no Service call and no
// network (src/voiceReadAloud.ts calls nothing but `speechSynthesis`). Plays only on a press; one
// answer at a time; the same button stops it. Nothing is stored and nothing is logged.
import { createContext, useContext, useEffect, useState, useSyncExternalStore } from "react";
import { ChatIcon } from "./ChatDetails";
import { useVoice } from "./VoiceProvider";
import { CLASS_OFF, READ_ALOUD_LABEL, READ_ALOUD_PLAYING, READ_ALOUD_STOP, READ_ALOUD_UNAVAILABLE } from "../../src/voiceCopy";
import { ReadAloud, type SpeechEnv } from "../../src/voiceReadAloud";

/** The browser's synthesizer. Tests replace this with a scripted one. */
export function browserSpeechEnv(): SpeechEnv {
  const synth = typeof window !== "undefined" && "speechSynthesis" in window && typeof SpeechSynthesisUtterance === "function" ? window.speechSynthesis : undefined;
  return {
    synth: synth as unknown as SpeechEnv["synth"],
    makeUtterance: (text) => new SpeechSynthesisUtterance(text) as unknown as ReturnType<SpeechEnv["makeUtterance"]>,
  };
}
export const SpeechEnvContext = createContext<() => SpeechEnv>(browserSpeechEnv);

/** One hub for the window, so a second answer stops the first. */
let shared: ReadAloud | null = null;
let sharedFor: (() => SpeechEnv) | null = null;
function hubFor(make: () => SpeechEnv): ReadAloud {
  if (!shared || sharedFor !== make) { shared?.stop(); shared = new ReadAloud(make()); sharedFor = make; }
  return shared;
}

export function ReadAloudButton({ answerId, content }: { answerId: string; content: string }) {
  const voice = useVoice();
  const make = useContext(SpeechEnvContext);
  const hub = hubFor(make);
  const status = useSyncExternalStore(hub.subscribe, hub.getStatus, hub.getStatus);
  const [note, setNote] = useState("");
  const playing = status.kind === "playing" && status.id === answerId;
  // An answer that goes away, or voice that goes off, stops its own reading.
  useEffect(() => () => { const s = hub.getStatus(); if (s.kind === "playing" && s.id === answerId) hub.stop(); }, [hub, answerId]);
  useEffect(() => { if (voice.availability.kind !== "on") hub.stop(); }, [voice.availability.kind, hub]);

  if (voice.availability.kind === "class_off") {
    return <button type="button" className="hps-answer-action hps-voice-listen" disabled aria-label={`${READ_ALOUD_LABEL}, ${CLASS_OFF}`} data-hp-tooltip={CLASS_OFF}><ChatIcon kind="speaker" size={16} /><span>{READ_ALOUD_LABEL}</span></button>;
  }
  if (voice.availability.kind !== "on" || !voice.availability.served.readAloud) return null;
  if (!hub.available) {
    return <button type="button" className="hps-answer-action hps-voice-listen" disabled aria-label={`${READ_ALOUD_LABEL}, ${READ_ALOUD_UNAVAILABLE}`} data-hp-tooltip={READ_ALOUD_UNAVAILABLE}><ChatIcon kind="speaker" size={16} /><span>{READ_ALOUD_LABEL}</span></button>;
  }
  const press = () => {
    if (playing) { hub.stop(); setNote(""); return; }
    voice.gate(() => { const result = hub.play(answerId, content); setNote(result.note ?? ""); });
  };
  return (
    <>
      <button type="button" className="hps-answer-action hps-voice-listen" aria-pressed={playing} onClick={press} data-hp-tooltip={playing ? READ_ALOUD_STOP : READ_ALOUD_LABEL} aria-label={playing ? READ_ALOUD_STOP : READ_ALOUD_LABEL}>
        <ChatIcon kind={playing ? "stop" : "speaker"} size={16} /><span>{playing ? READ_ALOUD_STOP : READ_ALOUD_LABEL}</span>
      </button>
      <span className="hps-sr-only" role="status">{playing ? READ_ALOUD_PLAYING : ""}{note ? ` ${note}` : ""}</span>
      {note && <span className="hps-voice-skipped">{note}</span>}
    </>
  );
}
