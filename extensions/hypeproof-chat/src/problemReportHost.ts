import * as vscode from "vscode";
import type { FailureFacts } from "./problemReport";

/**
 * REQ-STUDIO-PROBLEM-REPORT — the host side of automatic problem reports.
 *
 * Failures outside the chat turn (workspace preparation, update install) call noteAppProblem(); the chat panel
 * registers itself as the sink, so this module has no import of the panel and callers need no reference to it.
 * Before a sink exists the call is dropped: a missed signal is never an error.
 */
type Sink = (facts: FailureFacts) => void;
let sink: Sink | undefined;

export function setProblemSink(next: Sink): { dispose(): void } {
  sink = next;
  return { dispose: () => { if (sink === next) sink = undefined; } };
}

export function noteAppProblem(facts: FailureFacts): void {
  try { sink?.(facts); } catch { /* reporting never breaks the failing path */ }
}

/**
 * Level 1 switch, kept per machine in globalState and changed only from the report form's own toggle (its text says
 * what is sent). Not a native setting: a hypeproofChat.* setting needs a Korean label in the shell's core patch,
 * which forces a full Mac base build. Default off: the privacy policy does not yet list error diagnostics.
 */
export const AUTO_PROBLEM_REPORT_KEY = "hypeproof.autoProblemReport";
export function autoProblemReportEnabled(state: vscode.Memento | undefined): boolean {
  return state?.get<boolean>(AUTO_PROBLEM_REPORT_KEY, false) === true;
}
