// Synthetic native diagnosis only: fixed labels/booleans, never activity IDs or content.
export const FOCUS_DIAGNOSTIC_PREFIX = '[hps-native-focus]';
export const FOCUS_DIAGNOSTIC_PHASES = ['command_enter','restore_ready','command_complete','command_failed','editor_absent','editor_revealed','message_send','message_delivery','message_rejected','message_threw'] as const;
export type FocusDiagnosticPhase = typeof FOCUS_DIAGNOSTIC_PHASES[number];
export function focusDiagnosticLine(phase: FocusDiagnosticPhase, flags: {scope_present?:boolean;delivered?:boolean} = {}): string | undefined {
  if (!(FOCUS_DIAGNOSTIC_PHASES as readonly string[]).includes(phase)) return;
  return FOCUS_DIAGNOSTIC_PREFIX + JSON.stringify({phase,...(typeof flags.scope_present==='boolean'?{scope_present:flags.scope_present}:{}),...(typeof flags.delivered==='boolean'?{delivered:flags.delivered}:{})});
}
