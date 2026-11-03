// REQ-STUDIO-QUIT-GUARD (CGP-SHELL-R-004 / REQ-SHELL-04, CGP-SHELL-D-003 / DES-SHELL-03).
// Pure, vscode-free: what the quit dialog says, given what would stop.
//
// The VS Code core patch (scripts/patches/core/hps-quit-guard.patch) calls
// QUIT_GUARD_COMMAND when a window closes or the app quits. An answer of null means
// nothing would stop and the shutdown goes ahead with no dialog. The core owns the
// dialog's shape: the continue button first, and Enter = Esc = continue.

/** Must equal HPS_QUIT_GUARD_COMMAND in the core patch (test/quit-guard.smoke.mjs checks it). */
export const QUIT_GUARD_COMMAND = "_hypeproof.quitGuard.prompt";

export interface QuitGuardActivity {
  /** A coach turn is streaming, settling, or waiting on an approval (provider.hasActiveStream). */
  turnRunning: boolean;
  /** A chat surface holds a queued message that has not been sent. */
  queuedUnsent: boolean;
}

export interface QuitGuardPrompt {
  message: string;
  detail: string;
  continueLabel: string;
  quitLabel: string;
}

/** Shown instead of starting an update install while a turn runs. The install quits Studio; the
 *  quit guard would then ask, and 계속하기 would leave the spawned installer to give up silently. */
export const UPDATE_DURING_TURN_COPY = "AI가 대답하고 있어서 지금은 업데이트하지 않았어요. 대답이 끝난 뒤 다시 눌러 주세요.";

export function quitGuardPrompt(activity: QuitGuardActivity): QuitGuardPrompt | null {
  let detail: string;
  if (activity.turnRunning && activity.queuedUnsent) detail = "지금 하고 있는 대답이 멈춰요.\n보내려던 메시지도 보내지 않아요.";
  else if (activity.turnRunning) detail = "지금 하고 있는 대답이 멈춰요.\n만든 파일은 그대로 남아요.";
  else if (activity.queuedUnsent) detail = "보내지 않은 메시지가 있어요.\n끝내면 이 메시지는 보내지 않아요.";
  else return null;
  return { message: "Studio를 끝낼까요?", detail, continueLabel: "계속하기", quitLabel: "끝내기" };
}
