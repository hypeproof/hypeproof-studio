// Dictation capture, the webview half. Pure and DOM-free: every browser object comes in through
// `DictationEnv`, so the tests run it with a scripted recorder and a fake clock.
//
// What it guarantees (policy hps-voice-policy/1, DEC-05):
//   - the container is Opus in WebM (or Ogg), 32 kbps, never audio/mp4: the Service parses nothing else
//   - one clip at a time, stopped by us before the Service's 60 s line, at most 2 MiB
//   - the audio exists only as in-memory bytes: no file, no Blob URL, no storage, no log line
//   - the microphone is released as soon as the clip ends, on every path
//
// The clip is handed to the caller as bytes; sending it is the host's job (voiceHost.ts), because the
// chat webview's CSP lets it talk to nothing but itself.

export const DICTATION_BITS_PER_SECOND = 32_000;
/** The Service refuses a clip over 60 s, measured from the bytes. */
export const SERVICE_MAX_SECONDS = 60;
export const SERVICE_MAX_BYTES = 2 * 1024 * 1024;
/**
 * We stop 2 s before the Service's line. The encoder flushes a last packet after `stop()`, and a clip
 * the Service measures at 60.1 s is refused whole, which would throw away a minute of speech.
 */
export const DICTATION_STOP_AT_MS = (SERVICE_MAX_SECONDS - 2) * 1000;
/** A clip kept for a retry is discarded after this long (REQ-CGPV-19). */
export const RETRY_KEEP_MS = 10 * 60 * 1000;
/** Shorter than this is "too short", not sent (REQ-CGPV-18). */
export const DICTATION_MIN_MS = 600;
/** The slice the recorder hands over, so a long clip is not one blob at the end. */
const TIMESLICE_MS = 1000;

/** Tried in this order. audio/mp4 and anything AAC is not on the list on purpose. */
export const DICTATION_MIME_CANDIDATES = ["audio/webm;codecs=opus", "audio/ogg;codecs=opus"] as const;

export interface RecorderLike {
  state: string;
  ondataavailable: ((event: { data: BlobLike }) => void) | null;
  onstop: (() => void) | null;
  onerror: ((event: unknown) => void) | null;
  start(timeslice?: number): void;
  stop(): void;
}
export interface BlobLike { size: number; arrayBuffer(): Promise<ArrayBuffer> }
export interface TrackLike { stop(): void }
export interface StreamLike { getTracks(): TrackLike[] }
export interface RecorderCtor {
  new (stream: StreamLike, options: { mimeType: string; audioBitsPerSecond: number }): RecorderLike;
  isTypeSupported(mime: string): boolean;
}
/**
 * CGP-SHELL-R-010: what the browser says about the microphone permission before we ask.
 * `unknown` when it cannot say (no Permissions API, no `microphone` name, a timeout).
 */
export type MicPermission = "granted" | "denied" | "prompt" | "unknown";

/**
 * CGP-SHELL-R-010 / DES-SHELL-09: show Studio's own explainer before `getUserMedia` may raise the OS
 * prompt. Not when the permission is already granted (no prompt comes) or denied (no prompt comes; the
 * denied card explains instead), and once per dictation control: after the learner pressed 허용하기 or
 * 나중에 the next press goes straight on.
 */
export function needsMicExplainer(permission: MicPermission, explainedAlready: boolean): boolean {
  if (explainedAlready) return false;
  return permission === "prompt" || permission === "unknown";
}

export interface DictationEnv {
  /** CGP-SHELL-R-010. Absent (older test rigs): treated as granted, so no explainer is drawn. */
  micPermission?(): Promise<MicPermission>;
  getUserMedia(constraints: { audio: boolean }): Promise<StreamLike>;
  Recorder: RecorderCtor | undefined;
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface Clip {
  /** Container type to send as content-type, without the codecs parameter. */
  readonly mime: "audio/webm" | "audio/ogg";
  readonly bytes: Uint8Array;
  /** Whole seconds, at least 1 and never more than the Service's limit. */
  readonly seconds: number;
}

export type DictationFailure =
  | "denied"       // the OS or Studio refused the microphone (NotAllowedError, SecurityError)
  | "no_mic"       // NotFoundError, OverconstrainedError
  | "busy"         // NotReadableError, AbortError
  | "unsupported"  // no getUserMedia, no recorder, no webm/ogg opus
  | "too_short"
  | "too_large"
  | "failed";

export type DictationState = "idle" | "starting" | "recording" | "stopping";

export interface DictationCallbacks {
  onState(state: DictationState): void;
  onClip(clip: Clip): void;
  onFailure(kind: DictationFailure): void;
}

/** The first candidate this recorder can write, or null. Never audio/mp4. */
export function pickDictationMime(recorder: Pick<RecorderCtor, "isTypeSupported"> | undefined): (typeof DICTATION_MIME_CANDIDATES)[number] | null {
  if (!recorder || typeof recorder.isTypeSupported !== "function") return null;
  for (const mime of DICTATION_MIME_CANDIDATES) {
    try { if (recorder.isTypeSupported(mime)) return mime; } catch { /* a throwing probe is "no" */ }
  }
  return null;
}

/** Map a getUserMedia rejection to a cause. By name only: the message text can hold device labels. */
export function classifyMediaError(error: unknown): DictationFailure {
  const name = typeof error === "object" && error !== null && "name" in error ? String((error as { name: unknown }).name) : "";
  if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError") return "denied";
  if (name === "NotFoundError" || name === "OverconstrainedError" || name === "DevicesNotFoundError") return "no_mic";
  if (name === "NotReadableError" || name === "AbortError" || name === "TrackStartError") return "busy";
  return "failed";
}

export function base64Of(bytes: Uint8Array): string {
  let out = "";
  const STEP = 0x8000;
  for (let i = 0; i < bytes.length; i += STEP) out += String.fromCharCode(...bytes.subarray(i, i + STEP));
  return btoa(out);
}

/**
 * One dictation recorder. `start()` while anything is already running does nothing: there is one
 * clip at a time. `stop()` ends the clip and delivers it; `cancel()` ends it and drops it.
 */
export class DictationRecorder {
  private state: DictationState = "idle";
  private recorder: RecorderLike | null = null;
  private stream: StreamLike | null = null;
  private chunks: BlobLike[] = [];
  private timer: unknown = null;
  private startedAt = 0;
  private mime: (typeof DICTATION_MIME_CANDIDATES)[number] | null = null;
  private keep = true;
  /** Bumped on every start and cancel so a late callback from an older clip cannot act. */
  private generation = 0;

  private readonly env: DictationEnv;
  private readonly cb: DictationCallbacks;
  constructor(env: DictationEnv, cb: DictationCallbacks) { this.env = env; this.cb = cb; }

  get current(): DictationState { return this.state; }

  private set(state: DictationState) {
    if (this.state === state) return;
    this.state = state;
    this.cb.onState(state);
  }

  private release() {
    if (this.timer !== null) { this.env.clearTimeout(this.timer); this.timer = null; }
    for (const track of this.stream?.getTracks() ?? []) { try { track.stop(); } catch { /* already stopped */ } }
    this.stream = null;
    this.recorder = null;
  }

  async start(): Promise<void> {
    if (this.state !== "idle") return;
    const mime = pickDictationMime(this.env.Recorder);
    if (!this.env.Recorder || !mime || typeof this.env.getUserMedia !== "function") { this.cb.onFailure("unsupported"); return; }
    const generation = ++this.generation;
    this.set("starting");
    let stream: StreamLike;
    try {
      stream = await this.env.getUserMedia({ audio: true });
    } catch (error) {
      if (generation !== this.generation) return;
      this.set("idle");
      this.cb.onFailure(classifyMediaError(error));
      return;
    }
    // Cancelled while the permission prompt was open: close the microphone we were just given.
    if (generation !== this.generation) { for (const track of stream.getTracks()) { try { track.stop(); } catch { /* ignore */ } } return; }
    let recorder: RecorderLike;
    try {
      recorder = new this.env.Recorder(stream, { mimeType: mime, audioBitsPerSecond: DICTATION_BITS_PER_SECOND });
    } catch {
      for (const track of stream.getTracks()) { try { track.stop(); } catch { /* ignore */ } }
      this.set("idle");
      this.cb.onFailure("unsupported");
      return;
    }
    this.stream = stream;
    this.recorder = recorder;
    this.mime = mime;
    this.chunks = [];
    this.keep = true;
    recorder.ondataavailable = (event) => { if (generation === this.generation && event.data && event.data.size > 0) this.chunks.push(event.data); };
    recorder.onerror = () => { if (generation === this.generation) { this.keep = false; this.finish(generation); } };
    recorder.onstop = () => { void this.deliver(generation); };
    try {
      recorder.start(TIMESLICE_MS);
    } catch {
      this.release();
      this.set("idle");
      this.cb.onFailure("failed");
      return;
    }
    this.startedAt = this.env.now();
    this.set("recording");
    // The hard stop: whatever the learner does, the clip ends before the Service's limit.
    this.timer = this.env.setTimeout(() => { if (generation === this.generation) this.stop(); }, DICTATION_STOP_AT_MS);
  }

  /** Learner pressed stop (or the hard stop fired): end the clip and deliver it. */
  stop(): void {
    if (this.state !== "recording") return;
    this.finish(this.generation);
  }

  /** Learner cancelled: end it, release the microphone, deliver nothing. */
  cancel(): void {
    if (this.state === "idle") return;
    this.keep = false;
    const recorder = this.recorder;
    this.generation++;
    this.chunks = [];
    this.release();
    this.set("idle");
    try { if (recorder && recorder.state !== "inactive") recorder.stop(); } catch { /* ignore */ }
  }

  private finish(generation: number) {
    if (generation !== this.generation || (this.state !== "recording" && this.state !== "stopping")) return;
    this.set("stopping");
    const recorder = this.recorder;
    // The microphone closes now; the recorder still flushes what it has into `onstop`.
    for (const track of this.stream?.getTracks() ?? []) { try { track.stop(); } catch { /* ignore */ } }
    if (this.timer !== null) { this.env.clearTimeout(this.timer); this.timer = null; }
    try {
      if (recorder && recorder.state !== "inactive") recorder.stop();
      else void this.deliver(generation);
    } catch {
      void this.deliver(generation);
    }
  }

  private async deliver(generation: number) {
    if (generation !== this.generation) return;
    const elapsed = Math.max(0, this.env.now() - this.startedAt);
    const chunks = this.chunks, mime = this.mime, keep = this.keep;
    this.chunks = [];
    this.release();
    this.set("idle");
    if (!keep || !mime) { this.cb.onFailure("failed"); return; }
    if (elapsed < DICTATION_MIN_MS || chunks.length === 0) { this.cb.onFailure("too_short"); return; }
    let parts: Uint8Array[];
    try {
      parts = await Promise.all(chunks.map(async (chunk) => new Uint8Array(await chunk.arrayBuffer())));
    } catch { this.cb.onFailure("failed"); return; }
    if (generation !== this.generation) return;
    const total = parts.reduce((n, part) => n + part.length, 0);
    if (total > SERVICE_MAX_BYTES) { this.cb.onFailure("too_large"); return; }
    const bytes = new Uint8Array(total);
    let at = 0;
    for (const part of parts) { bytes.set(part, at); at += part.length; }
    const seconds = Math.min(SERVICE_MAX_SECONDS, Math.max(1, Math.ceil(elapsed / 1000)));
    this.cb.onClip({ mime: mime.startsWith("audio/ogg") ? "audio/ogg" : "audio/webm", bytes, seconds });
  }
}
