// Read-aloud: the operating system's own voice reads one completed answer. Policy D1: US$0, nothing
// leaves the device. This file never touches the network: the only browser API it calls is
// `speechSynthesis`, and the tests run it with a fake that fails the test if `fetch` is called.
//
// Pure and DOM-free: the synthesizer and the utterance constructor come in through `SpeechEnv`.
import { READ_ALOUD_CODE_SKIPPED } from "./voiceCopy.ts";

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

export type ReadAloudStatus = { kind: "idle" } | { kind: "playing"; id: string } | { kind: "error"; id: string };
export interface ReadAloudStartResult { started: boolean; skippedCode: boolean; note: string | null }

/**
 * One playback at a time across every answer. `play` for another answer stops the first; `stop` is
 * immediate. Late events from a stopped playback are ignored (a generation counter).
 */
export class ReadAloud {
  private status: ReadAloudStatus = { kind: "idle" };
  private generation = 0;
  private listeners = new Set<() => void>();

  private readonly env: SpeechEnv;
  constructor(env: SpeechEnv) { this.env = env; }

  get available(): boolean { return !!this.env.synth; }
  getStatus = (): ReadAloudStatus => this.status;
  subscribe = (listener: () => void): (() => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };

  private set(status: ReadAloudStatus) { this.status = status; for (const l of [...this.listeners]) l(); }

  play(id: string, markdown: string): ReadAloudStartResult {
    const synth = this.env.synth;
    if (!synth) return { started: false, skippedCode: false, note: null };
    const { text, skippedCode } = speakableText(markdown);
    const note = skippedCode ? READ_ALOUD_CODE_SKIPPED : null;
    this.stop();
    const chunks = chunkForSpeech(text);
    if (chunks.length === 0) return { started: false, skippedCode, note };
    const generation = ++this.generation;
    const voice = pickKoreanVoice(synth.getVoices());
    this.set({ kind: "playing", id });
    chunks.forEach((chunk, index) => {
      const utterance = this.env.makeUtterance(chunk);
      utterance.lang = READ_ALOUD_LANG;
      utterance.rate = 1;
      utterance.voice = voice;
      const last = index === chunks.length - 1;
      utterance.onend = () => { if (generation === this.generation && last) this.set({ kind: "idle" }); };
      utterance.onerror = (event) => {
        if (generation !== this.generation) return;
        // stop() and a newer play() end the old queue with these; they are not failures.
        if (event?.error === "canceled" || event?.error === "interrupted") return;
        this.generation++;
        try { synth.cancel(); } catch { /* ignore */ }
        this.set({ kind: "error", id });
      };
      synth.speak(utterance);
    });
    return { started: true, skippedCode, note };
  }

  stop(): void {
    this.generation++;
    // Nothing playing means nothing to cancel: an idle hub never touches the synthesizer.
    if (this.status.kind === "idle") return;
    try { this.env.synth?.cancel(); } catch { /* ignore */ }
    this.set({ kind: "idle" });
  }
}
