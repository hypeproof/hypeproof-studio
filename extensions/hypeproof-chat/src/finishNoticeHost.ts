// Host wiring for REQ-STUDIO-FINISH-NOTICE (CGP-AGENT-R-023). Decisions and coalescing live in
// finishNotice.ts; this file only binds them to VS Code: a non-modal information message and the
// reveal of whichever chat surface exists.

import * as vscode from "vscode";
import { FinishNotifier } from "./finishNotice.ts";

export type ChatSurfaces = {
  view: () => { visible: boolean } | undefined;
  editor: () => { visible: boolean; reveal(column?: vscode.ViewColumn): void } | undefined;
};

/** Is any chat surface on screen? The editor panel counts as much as the sidebar view. */
export function chatVisible(s: ChatSurfaces): boolean {
  return !!s.view()?.visible || !!s.editor()?.visible;
}

export function createFinishNotifier(s: ChatSurfaces, opts?: { now?: () => number; holdMs?: number }): FinishNotifier {
  return new FinishNotifier({
    show: (message, action) => vscode.window.showInformationMessage(message, action),
    reveal: async () => {
      const editor = s.editor();
      if (editor) editor.reveal(vscode.ViewColumn.One);
      else await vscode.commands.executeCommand("hypeproof-chat.panel.focus");
    },
  }, opts);
}

type Watchable =
  | { visible: boolean; onDidChangeVisibility: (fn: () => void) => unknown }
  | { visible: boolean; onDidChangeViewState: (fn: () => void) => unknown };

/**
 * A chat surface that becomes visible means the learner is looking at the chat, however they got
 * there (activity bar, tab, 채팅 열기): the hold on later notices ends. Sidebar views fire
 * `onDidChangeVisibility`, editor panels `onDidChangeViewState`.
 */
export function watchChatSurface(surface: Watchable, notifier: FinishNotifier): void {
  const seen = () => { if (surface.visible) notifier.release(); };
  // Never fails the surface it watches: a missing event only means the timeout releases the hold.
  try {
    if ("onDidChangeVisibility" in surface) surface.onDidChangeVisibility(seen);
    else if ("onDidChangeViewState" in surface) surface.onDidChangeViewState(seen);
  } catch { /* the hold still ends at the next turn start or after the timeout */ }
}
