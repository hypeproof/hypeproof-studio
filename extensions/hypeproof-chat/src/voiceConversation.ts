// #3686: one explicitly started, half-duplex clip loop. Browser/host effects are injected;
// the ordinary composer still owns submission, recovery, authorization and durable IDs.
import { DictationRecorder, type Clip, type DictationEnv, type StreamLike } from './voiceDictation.ts';
import type { HostMessage } from './protocol.ts';
import type { ReadAloud } from './voiceReadAloud.ts';

export type ConversationPhase = 'idle' | 'starting' | 'listening' | 'transcribing' | 'answering' | 'speaking' | 'stopped';
export interface ConversationView { phase: ConversationPhase; note: string }
export interface VoiceConversationEnv {
  recorder: DictationEnv;
  /** Uses the SAME captured stream. Returns cleanup; never opens a second microphone. */
  observe(stream: StreamLike, end: () => void, lost: () => void): () => void;
  scope(): string;
  ready(): boolean;
  transcribe(id: string, clip: Clip): void;
  /** Returns the ordinary send's durable user ID, or null; never bypass the composer. */
  submit(text: string): string | null;
  speech: ReadAloud;
  changed(view: ConversationView): void;
  id(): string;
}
const ACTIVE = new Set<ConversationPhase>(['starting', 'listening', 'transcribing', 'answering', 'speaking']);
export class VoiceConversation {
  private view: ConversationView = { phase: 'idle', note: '' };
  private generation = 0;
  private scope = '';
  private endpoint = false;
  private stopObservation: (() => void) | null = null;
  private request: string | null = null;
  private user: string | null = null;
  private stream: string | null = null;
  private answer: string | null = null;
  private text = '';
  private ended = false;
  private timer: unknown = null;
  readonly recorder: DictationRecorder;
  private readonly env: VoiceConversationEnv;
  constructor(env: VoiceConversationEnv) {
    this.env = env;
    this.recorder = new DictationRecorder({ ...env.recorder, getUserMedia: async constraints => {
      const generation = this.generation;
      const stream = await env.recorder.getUserMedia(constraints);
      if (!this.current(generation)) { for (const track of stream.getTracks()) track.stop(); throw Object.assign(new Error('stale capture'), { name: 'AbortError' }); }
      try {
        this.stopObservation = env.observe(stream, () => {
          if (!this.current(generation) || this.view.phase !== 'listening') return;
          this.endpoint = true;
          this.recorder.stop();
        }, () => { if (this.current(generation)) this.stop('마이크 연결이 끊어졌어요. 글로 계속할 수 있어요.'); });
      } catch (error) {
        for (const track of stream.getTracks()) track.stop();
        throw error;
      }
      return stream;
    } }, {
      onState: state => {
        if (state === 'stopping' || state === 'idle') this.releaseObservation();
        if (!this.active) return;
        if (state === 'recording') this.set('listening', '듣고 있어요. 말이 끝나면 자동으로 보내요.');
      },
      onClip: clip => {
        if (!this.active) return;
        // The recorder's duration ceiling is a safety stop, never an invented speech endpoint.
        if (!this.endpoint) { this.stop('말끝을 확인하지 못해 보내지 않았어요. 다시 시작하거나 글로 입력해 주세요.'); return; }
        if (!this.valid() || !env.ready()) { this.stop('입력 상태가 바뀌어 음성 대화를 멈췄어요.'); return; }
        this.request = env.id(); this.set('transcribing', '말을 글로 바꾸고 있어요.');
        this.deadline(50_000);
        env.transcribe(this.request, clip);
      },
      onFailure: () => this.stop('녹음을 마치지 못했어요. 마이크 권한을 확인하거나 글로 계속해 주세요.'),
    });
  }
  get active(): boolean { return ACTIVE.has(this.view.phase); }
  get state(): ConversationView { return this.view; }
  private valid(): boolean { return this.scope === this.env.scope(); }
  private current(generation: number): boolean { return generation === this.generation && this.active && this.valid(); }
  private set(phase: ConversationPhase, note: string) { this.view = { phase, note }; this.env.changed(this.view); }
  private releaseObservation() { const stop = this.stopObservation; this.stopObservation = null; stop?.(); }
  private clearDeadline() { if (this.timer !== null) this.env.recorder.clearTimeout(this.timer); this.timer = null; }
  private deadline(ms: number) {
    this.clearDeadline(); const generation = this.generation;
    this.timer = this.env.recorder.setTimeout(() => { if (this.current(generation)) this.stop('응답을 확인하지 못해 멈췄어요. 대화 기록을 확인해 주세요. 자동으로 다시 보내지 않아요.'); }, ms);
  }
  start(): void {
    if (this.active || !this.env.ready() || !this.env.speech.available) return;
    this.generation++; this.scope = this.env.scope();
    this.capture();
  }
  private capture() {
    if (!this.valid() || !this.env.ready()) { this.stop('입력 상태가 바뀌어 음성 대화를 멈췄어요.'); return; }
    // Manual/status playback must not be recorded. It must finish before a new deliberate start.
    if (this.env.speech.getStatus().kind === 'playing') { this.stop('읽어 주기가 끝난 뒤 음성 대화를 시작해 주세요.'); return; }
    this.endpoint = false; this.request = this.user = this.stream = this.answer = null; this.text = ''; this.ended = false;
    this.set('starting', '마이크를 준비하고 있어요.');
    void this.recorder.start();
  }
  /** Cancels only owned audio work. An already submitted text request remains in normal history. */
  stop(note = '음성 대화를 멈췄어요. 글로 계속할 수 있어요.'): void {
    this.generation++; this.clearDeadline(); this.request = this.user = this.stream = null;
    this.recorder.cancel(); this.releaseObservation();
    const answer = this.answer; this.answer = null; this.text = '';
    const status = this.env.speech.getStatus();
    if (answer && status.kind === 'playing' && status.id === answer) this.env.speech.stop();
    this.set('stopped', note);
  }
  playbackChanged(): void {
    const status = this.env.speech.getStatus();
    if (this.active && status.kind === 'playing' && (this.view.phase !== 'speaking' || status.id !== this.answer)) this.stop('다른 읽어 주기가 시작되어 음성 대화를 멈췄어요.');
  }
  host(message: HostMessage): void {
    if (!this.active) return;
    if (!this.valid()) { this.stop(); return; }
    if (message.type === 'inputRejected') { this.stop('보내지 못했어요. 입력창에 보관된 글을 확인해 주세요.'); return; }
    if (message.type === 'history' && this.ended && this.view.phase === 'answering') {
      const user = message.messages.findIndex(item => item.id === this.user && item.role === 'user');
      const answer = message.messages.findIndex(item => item.id === this.answer && item.role === 'assistant');
      if (user >= 0 && answer > user) { this.text = message.messages[answer].content; this.readAnswer(); }
      return;
    }
    if (message.type === 'approvalWait' && message.waiting) { this.stop('화면에서 요청을 확인해 주세요. 음성 대화는 멈췄어요.'); return; }
    if (message.type === 'voiceTranscribeResult' && message.requestId === this.request) {
      this.request = null; this.clearDeadline();
      if (!message.ok) { this.stop(message.message); return; }
      if (!message.text.trim() || !this.env.ready()) { this.stop('입력 상태가 바뀌어 보내지 않았어요.'); return; }
      this.set('answering', '답변을 기다리고 있어요.');
      this.user = this.env.submit(message.text);
      if (!this.user) { this.stop('보내지 못했어요. 입력창의 글을 확인해 주세요.'); return; }
      this.deadline(180_000);
      return;
    }
    if (message.type === 'streamStart') {
      if (message.userMessageId !== this.user || this.view.phase !== 'answering' || this.stream) { this.stop('다른 대화가 시작되어 음성 대화를 멈췄어요.'); return; }
      this.stream = message.streamId; this.answer = message.messageId; return;
    }
    if (message.type === 'streamError' && (!this.stream || message.streamId === this.stream)) { this.stop('응답을 마치지 못했어요. 대화 기록을 확인해 주세요.'); return; }
    if (!('streamId' in message) || message.streamId !== this.stream) return;
    if (message.type === 'streamChunk') { if (this.view.phase === 'answering') this.text += message.delta; return; }
    if (message.type === 'streamStopped') { this.stop(); return; }
    if (message.type !== 'streamEnd' || this.view.phase !== 'answering') return;
    if (message.failed || !this.answer) { this.stop('읽을 답변을 확인하지 못했어요. 대화 기록을 확인해 주세요.'); return; }
    this.ended = true;
    // Personal reflection publishes its saved history AFTER streamEnd, with the bound answer ID.
    if (this.text.trim()) this.readAnswer();
  }
  private readAnswer(): void {
    if (!this.answer || !this.text.trim()) { this.stop('읽을 답변을 확인하지 못했어요.'); return; }
    this.clearDeadline();
    const generation = this.generation;
    this.set('speaking', '답변을 읽고 있어요. 마이크는 꺼져 있어요.');
    this.deadline(180_000);
    const result = this.env.speech.play(this.answer, this.text, outcome => {
      if (!this.current(generation)) return;
      this.clearDeadline();
      if (outcome !== 'completed') { this.stop(); return; }
      // Let the final stream render settle; no queued capture survives Stop or scope change.
      this.timer = this.env.recorder.setTimeout(() => { this.timer = null; if (this.current(generation)) this.capture(); }, 0);
    });
    if (!result.started) this.stop('답변을 읽을 수 없어 멈췄어요. 글로 계속할 수 있어요.');
  }
}
