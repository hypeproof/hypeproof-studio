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

export function createFinishNotifier(s: ChatSurfaces): FinishNotifier {
  return new FinishNotifier({
    show: (message, action) => vscode.window.showInformationMessage(message, action),
    reveal: async () => {
      const editor = s.editor();
      if (editor) editor.reveal(vscode.ViewColumn.One);
      else await vscode.commands.executeCommand("hypeproof-chat.panel.focus");
    },
  });
}
