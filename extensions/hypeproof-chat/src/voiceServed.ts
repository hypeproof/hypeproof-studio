// Studio voice, the Service side of the contract (hps-voice-policy/1; decision record
// hypeproof/hypeprooflab docs/decisions/2026-11-09-studio-voice-policy.md).
//
// The Service tells Studio whether voice is on for this seat through one `voice` block on
// `GET /v1/profile`. Everything is default off: a seat whose profile has no block, a block with both
// halves off, or a block naming a policy version this build has no copy for gets NO voice UI at all.
// The block is absent when a flag is off, the kill switch is set, the class never opted in, or a minor
// class has no recorded guardian consent, so "absent" and "off" are one state here.
//
// Pure: no DOM, no vscode. The webview, the host and the tests all import it.

/** The policy versions this build can show a disclosure for. Anything else fails closed. */
export const VOICE_POLICY_VERSIONS = ["hps-voice-policy/1"] as const;
export type VoicePolicyVersion = (typeof VOICE_POLICY_VERSIONS)[number];

export interface ServedVoice {
  /** Hosted speech to text through the Service (POST /v1/voice/transcribe). */
  readonly dictation: boolean;
  /** The device's own voice reading an answer. No Service call. */
  readonly readAloud: boolean;
  readonly policyVersion: VoicePolicyVersion;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * What the served profile says about voice, or null for "render nothing". Only a literal `true`
 * turns a half on: a truthy string or a number is not the Service's answer.
 */
export function readServedVoice(profile: { voice?: unknown } | null | undefined): ServedVoice | null {
  const block = profile?.voice;
  if (!isRecord(block)) return null;
  const dictation = block.dictation === true;
  const readAloud = block.read_aloud === true;
  if (!dictation && !readAloud) return null;
  const version = block.policy_version;
  if (typeof version !== "string" || !(VOICE_POLICY_VERSIONS as readonly string[]).includes(version)) return null;
  return { dictation, readAloud, policyVersion: version as VoicePolicyVersion };
}

export type VoiceAvailability =
  | { readonly kind: "none" }
  | { readonly kind: "on"; readonly served: ServedVoice }
  /** Voice was served earlier in this window for this seat and is not any more (D-018). */
  | { readonly kind: "class_off" };

/**
 * Decide what the composer and answers draw. `servedBefore` is whether this window already saw voice
 * on for this seat: the Service omits the block when a class turns voice off mid-session, so "was on,
 * now absent" is the only way Studio can tell a class that switched it off from one that never had it
 * (which shows nothing at all). `refusedOff` is a Service refusal that says the class has it off.
 */
export function voiceAvailability(profile: { voice?: unknown } | null | undefined, servedBefore: boolean, refusedOff: boolean): VoiceAvailability {
  const served = readServedVoice(profile);
  if (served && !refusedOff) return { kind: "on", served };
  if (served && refusedOff) return { kind: "class_off" };
  return servedBefore ? { kind: "class_off" } : { kind: "none" };
}

/**
 * Which disclosure paragraph a seat reads for dictation. Fails closed like `isMinorTier`
 * (sdkCoachHelpers.ts, keep the tier set in sync): only the two professional workshop tiers read the
 * adult sentence; a missing or unknown tier reads the minor one, which is also true for an adult.
 */
export function readsMinorDisclosure(profile: { game?: { template_tier?: string } | null; minor_cohort?: boolean } | null | undefined): boolean {
  if (profile?.minor_cohort === true) return true;
  const tier = profile?.game?.template_tier ?? "";
  return tier !== "search-webapp" && tier !== "website";
}
