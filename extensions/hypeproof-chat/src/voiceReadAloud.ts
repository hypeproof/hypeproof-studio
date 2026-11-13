// Read-aloud: the operating system's own voice reads one completed answer. Policy D1: US$0, nothing
// leaves the device. This file never touches the network: the only browser API it calls is
// `speechSynthesis`, and the tests run it with a fake that fails the test if `fetch` is called.
//
// Pure and DOM-free: the synthesizer and the utterance constructor come in through `SpeechEnv`.
import { READ_ALOUD_CODE_SKIPPED } from "./voiceCopy.ts";
import type { OutputMute } from "./voiceOutputMute.ts";

export const READ_ALOUD_LANG = "ko-KR";
/** One utterance per chunk: long utterances are cut off by some engines. */
const CHUNK_MAX = 180;

export interface VoiceLike { lang: string; localService: boolean; name?: string }
export interface UtteranceLike {
  lang: string; rate: number; voice: VoiceLike | null;
  onend: (() => void) | null; onerror: ((event: { error?: string }) => void) | null;
}
export interface SynthLike {
  speak(utterance: UtteranceLike): void;
  cancel(): void;
  getVoices(): VoiceLike[];
}
export interface SpeechEnv {
  synth: SynthLike | undefined;
  makeUtterance(text: string): UtteranceLike;
}

/**
 * What to say for an answer written in markdown: prose only. Fenced and inline code is not read; if a
 * fenced block was skipped the caller announces that (REQ-CGPV-24: "코드는 건너뛰었어요").
 */
export function speakableText(markdown: string): { text: string; skippedCode: boolean } {
  let skippedCode = false;
  let text = markdown.replace(/```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)/g, () => { skippedCode = true; return "\n"; });
  text = text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/<[^>\n]+>/g, "")
    .replace(/`([^`\n]*)`/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+[.)]\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/^\s*\|?[\s:|-]{3,}\|?\s*$/gm, "")
    .replace(/\|/g, " ")
    .replace(/(\*\*|__|\*|_|~~)/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return { text, skippedCode };
}

/** Sentence-sized pieces no longer than CHUNK_MAX, in order, nothing dropped. */
export function chunkForSpeech(text: string, max = CHUNK_MAX): string[] {
  const out: string[] = [];
  let current = "";
  const push = () => { if (current.trim()) out.push(current.trim()); current = ""; };
  for (const sentence of text.split(/(?<=[.!?。！？])\s+/)) {
    if (sentence.length > max) {
      push();
      for (let i = 0; i < sentence.length; i += max) out.push(sentence.slice(i, i + max).trim());
      continue;
    }
    if (current && current.length + 1 + sentence.length > max) push();
    current = current ? current + " " + sentence : sentence;
  }
  push();
  return out.filter(Boolean);
}

/** A Korean voice that runs on this device. A voice that streams from a server is never chosen. */
export function pickKoreanVoice(voices: readonly VoiceLike[]): VoiceLike | null {
  return voices.find((v) => v.localService && /^ko([-_]|$)/i.test(v.lang)) ?? null;
}

/**
 * `blocked` (CGP-VOICE-R-028): the engine refused to start sound without a user gesture (`not-allowed`,
 * the speech-synthesis form of the media `NotAllowedError`). Nothing is playing, so it is never shown
 * as speaking; `resume` (a press, which is a gesture) reads on from the first chunk that did not finish.
 */
export type ReadAloudStatus =
  | { kind: "idle" } | { kind: "playing"; id: string } | { kind: "error"; id: string } | { kind: "blocked"; id: string };
export interface ReadAloudStartResult { started: boolean; skippedCode: boolean; note: string | null }

/**
 * One playback at a time across every answer. `play` for another answer stops the first; `stop` is
 * immediate. Late events from a stopped playback are ignored (a generation counter).
 *
 * CGP-VOICE-R-002: with an `output` switch, muting it stops a reading in the same call and a muted
 * hub starts nothing. The switch is never written here: the microphone and this hub do not touch it.
 */
export class ReadAloud {
  private status: ReadAloudStatus = { kind: "idle" };
  private generation = 0;
  /** What a blocked reading still has to say: the unfinished chunks, in order. Cleared by stop/play/resume. */
  private pending: { id: string; chunks: string[] } | null = null;
  private listeners = new Set<() => void>();

  private readonly env: SpeechEnv;
  private readonly output: OutputMute | undefined;
  private readonly unsubscribeOutput: () => void;
  constructor(env: SpeechEnv, output?: OutputMute) {
    this.env = env;
    this.output = output;
    this.unsubscribeOutput = output ? output.subscribe(() => { if (output.getMuted()) this.stop(); }) : () => {};
  }

  /** Stop listening to the output switch (a replaced hub must never cancel a newer one's reading). */
  dispose(): void { this.unsubscribeOutput(); }

  get available(): boolean { return !!this.env.synth; }
  getStatus = (): ReadAloudStatus => this.status;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };

  private set(status: ReadAloudStatus) { this.status = status; for (const l of [...this.listeners]) l(); }

  play(id: string, markdown: string): ReadAloudStartResult {
    const synth = this.env.synth;
    if (!synth) return { started: false, skippedCode: false, note: null };
    if (this.output?.getMuted()) return { started: false, skippedCode: false, note: null };
    const { text, skippedCode } = speakableText(markdown);
    const note = skippedCode ? READ_ALOUD_CODE_SKIPPED : null;
    this.stop();
    const chunks = chunkForSpeech(text);
    if (chunks.length === 0) return { started: false, skippedCode, note };
    this.speakChunks(id, chunks);
    return { started: true, skippedCode, note };
  }

  /**
   * CGP-VOICE-R-028: after `blocked`, read on from the first chunk that did not finish. Called from a
   * press, so the engine has its user gesture. False (and nothing spoken) when this answer is not
   * blocked, the synthesizer is gone or the speaker switch is off.
   */
  resume(id: string): boolean {
    const synth = this.env.synth;
    const pending = this.pending;
    if (!synth || this.status.kind !== "blocked" || this.status.id !== id || !pending || pending.id !== id) return false;
    if (this.output?.getMuted()) return false;
    this.pending = null;
    this.speakChunks(id, pending.chunks);
    return true;
  }

  private speakChunks(id: string, chunks: string[]): void {
    const synth = this.env.synth!;
    const generation = ++this.generation;
    const voice = pickKoreanVoice(synth.getVoices());
    const done = new Set<number>();
    this.set({ kind: "playing", id });
    chunks.forEach((chunk, index) => {
      const utterance = this.env.makeUtterance(chunk);
      utterance.lang = READ_ALOUD_LANG;
      utterance.rate = 1;
      utterance.voice = voice;
      const last = index === chunks.length - 1;
      utterance.onend = () => {
        if (generation !== this.generation) return;
        done.add(index);
        if (last) this.set({ kind: "idle" });
      };
      utterance.onerror = (event) => {
        if (generation !== this.generation) return;
        // stop() and a newer play() end the old queue with these; they are not failures.
        if (event?.error === "canceled" || event?.error === "interrupted") return;
        this.generation++;
        try { synth.cancel(); } catch { /* ignore */ }
        if (event?.error === "not-allowed") {
          // Autoplay policy: keep what was not heard, so one press can read on from there.
          this.pending = { id, chunks: chunks.filter((_, i) => !done.has(i)) };
          this.set({ kind: "blocked", id });
          return;
        }
        this.set({ kind: "error", id });
      };
      synth.speak(utterance);
    });
  }

  stop(): void {
    this.generation++;
    this.pending = null;
    // Nothing playing means nothing to cancel: an idle hub never touches the synthesizer.
    if (this.status.kind === "idle") return;
    try { this.env.synth?.cancel(); } catch { /* ignore */ }
    this.set({ kind: "idle" });
  }
}
