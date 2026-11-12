// The composer addon for dictation: the one static definition App hands the composer when voice is on
// or was on earlier in this window (composerAddon.ts). Static so its components keep their identity.
import type { ComposerAddon } from "./composerAddon";
import type { VoiceAvailability } from "../../src/voiceServed";
import { DictationButton, DictationNotice, DictationScope } from "./DictationControl";

export const DICTATION_ADDON: ComposerAddon = { Scope: DictationScope, Control: DictationButton, Notice: DictationNotice };

/** The addon only where the composer will draw something: dictation served, or the class turned voice off (D-018). */
export function dictationAddonFor(availability: VoiceAvailability): ComposerAddon | undefined {
  if (availability.kind === "class_off") return DICTATION_ADDON;
  return availability.kind === "on" && availability.served.dictation ? DICTATION_ADDON : undefined;
}
