// CGP-VOICE-R-019 / CGP-VOICE-D-015 (REQ-CGPV-23 / DES-CGPV-23): which microphone dictation and the voice
// conversation record from. Pure and DOM-free: the host stores the choice, the webview lists and resolves it.
//
// - The choice is kept per computer (the host's globalState), not per seat: the microphone belongs to the PC,
//   and every learner at a shared classroom PC uses the same headset.
// - It holds a device id and the device's label, nothing else. The label is kept only to find the same device
//   again when the browser hands out a new id. A label can name a person ("OO의 AirPods"), so it stays on this
//   computer: never logged, never sent to the Service, never in a problem report.
// - "시스템 기본값" is no record at all.
// - A chosen microphone that is not connected is never replaced silently: the capture does not start, the
//   learner reads why and can record once with the default (REQ-CGPV-23: "falls back only on explicit choice").

export const MIC_INPUT_KEY = "hypeproofChat.micInput";
/** Device ids are opaque hashes (Chromium: 64 hex characters); anything longer is not one. */
export const MIC_ID_MAX = 256;
export const MIC_LABEL_MAX = 200;
/** DES-CGPV-23 마이크 시험: the test listens for at most this long, then closes the microphone. */
export const MIC_TEST_MS = 5_000;
/** The test meter's poll interval. */
export const MIC_TEST_POLL_MS = 120;
/** A peak level (0..1, -60 dB..0 dB) at or above this counts as "heard": about -45 dB, a quiet voice near the mic. */
export const MIC_HEARD_LEVEL = 0.25;

export interface MicChoice { readonly id: string; readonly label: string }
export interface MicDevice { readonly id: string; readonly label: string }

/** Chromium's pseudo-entries for "whatever the OS uses": they are what "시스템 기본값" already means. */
const PSEUDO_IDS = new Set(["default", "communications"]);

function cleanId(id: unknown): string | null {
  if (typeof id !== "string") return null;
  const value = id.trim();
  if (!value || value.length > MIC_ID_MAX || PSEUDO_IDS.has(value)) return null;
  return value;
}
function cleanLabel(label: unknown): string {
  return typeof label === "string" ? label.trim().slice(0, MIC_LABEL_MAX) : "";
}

/** The stored choice, or null (the system default). Junk of any shape reads as the default. */
export function readMicChoice(stored: unknown): MicChoice | null {
  if (typeof stored !== "object" || stored === null || Array.isArray(stored)) return null;
  const id = cleanId((stored as { id?: unknown }).id);
  if (!id) return null;
  return { id, label: cleanLabel((stored as { label?: unknown }).label) };
}

/**
 * What the host writes for a request: a cleaned choice, null for the system default, or undefined when the
 * request is refused (not a choice, not null): nothing changes then.
 */
export function writeMicChoice(input: unknown): MicChoice | null | undefined {
  if (input === null) return null;
  const choice = readMicChoice(input);
  return choice ?? undefined;
}

/**
 * The microphones `enumerateDevices` reports, in its order. Null when the browser hides them: before the
 * microphone permission is granted Chromium lists the inputs with empty ids, and there is nothing to choose
 * from. An empty list means there is no microphone at all.
 */
export function listMicDevices(raw: ArrayLike<{ kind?: unknown; deviceId?: unknown; label?: unknown }> | null | undefined): MicDevice[] | null {
  if (!raw) return null;
  const inputs = Array.from(raw).filter((d) => d && d.kind === "audioinput");
  const out: MicDevice[] = [];
  const seen = new Set<string>();
  let hidden = 0;
  for (const d of inputs) {
    const rawId = typeof d.deviceId === "string" ? d.deviceId.trim() : "";
    if (!rawId) { hidden++; continue; }
    const id = cleanId(rawId);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, label: cleanLabel(d.label) });
  }
  if (out.length === 0 && hidden > 0) return null;
  return out;
}

export type MicResolution =
  | { kind: "default" }
  /** Record from this id (the stored one, or the new id of the same device found by its label). */
  | { kind: "device"; id: string }
  /** The chosen microphone is not connected. */
  | { kind: "missing" };

/**
 * Where to record from. The stored id first; if the browser changed the id, the one device with exactly the
 * stored label; otherwise the choice is missing. When the list is hidden (no permission yet) or unavailable, the
 * stored id is tried as it is: the browser's exact constraint then decides, and its NotFound/Overconstrained
 * answer reads as missing too.
 */
export function resolveMicChoice(choice: MicChoice | null, devices: readonly MicDevice[] | null): MicResolution {
  if (!choice) return { kind: "default" };
  if (devices === null) return { kind: "device", id: choice.id };
  if (devices.some((d) => d.id === choice.id)) return { kind: "device", id: choice.id };
  if (choice.label) {
    const same = devices.filter((d) => d.label === choice.label);
    if (same.length === 1) return { kind: "device", id: same[0].id };
  }
  return { kind: "missing" };
}

export type MicAudioConstraint = true | { deviceId: { exact: string } };
/** The `audio` member of the getUserMedia constraints: the default device, or exactly this one. */
export function micAudioConstraint(id: string | null): MicAudioConstraint {
  return id ? { deviceId: { exact: id } } : true;
}

/** The select's value for a chosen microphone that is not connected (never a real device id: ids hold no spaces). */
export const MIC_MISSING_VALUE = "missing choice";

export interface MicOption { readonly value: string; readonly text: string }
/**
 * The picker's options: "시스템 기본값", each connected microphone by its label (or 마이크 N when the browser
 * gives no label), and, when the chosen one is not connected, "연결되지 않은 마이크". With the list hidden, a stored
 * choice is shown by its stored label.
 */
export function micOptions(devices: readonly MicDevice[] | null, choice: MicChoice | null, copy: { system: string; missing: string; numbered: (n: number) => string; chosen: string }): { options: MicOption[]; value: string } {
  const options: MicOption[] = [{ value: "", text: copy.system }];
  (devices ?? []).forEach((d, i) => options.push({ value: d.id, text: d.label || copy.numbered(i + 1) }));
  if (!choice) return { options, value: "" };
  if (devices === null) {
    options.push({ value: choice.id, text: choice.label || copy.chosen });
    return { options, value: choice.id };
  }
  const resolved = resolveMicChoice(choice, devices);
  if (resolved.kind === "device") return { options, value: resolved.id };
  options.push({ value: MIC_MISSING_VALUE, text: copy.missing });
  return { options, value: MIC_MISSING_VALUE };
}

/** The choice a pick makes: null for "시스템 기본값", undefined for the missing entry (picking it changes nothing). */
export function choiceForPick(value: string, devices: readonly MicDevice[] | null): MicChoice | null | undefined {
  if (value === "") return null;
  if (value === MIC_MISSING_VALUE) return undefined;
  const device = (devices ?? []).find((d) => d.id === value);
  return device ? { id: device.id, label: device.label } : undefined;
}
