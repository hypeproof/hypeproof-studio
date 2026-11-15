import * as path from "node:path";
import * as vscode from "vscode";
import { noteStudioMemorySave } from "./memoryFolderGuard";

/**
 * CGP-KNOW-R-028 follow-up (#4014): the learner's own save of a memory file in the editor is Studio's change, never
 * something a keep-off turn check puts back. Only files directly in `.hypeproof/memory/` are noted, from the bytes on
 * disk (not the editor's text: a byte-order mark or line endings would make the save look foreign).
 *
 * Kept out of chatPanelProvider.ts on purpose: artifact provenance never labels a learner edit, and its lock
 * (test/artifact-provenance.smoke.mjs) keeps save hooks out of the provider. This watcher feeds the memory-folder
 * guard's journal only and records no artifact provenance.
 *
 * A host without the event (the hand-written vscode stubs of the provider smokes) gets no watcher: the call is optional.
 */
export function watchMemoryEditorSaves(): vscode.Disposable | undefined {
  return vscode.workspace.onDidSaveTextDocument?.((document) => {
    const file = document.uri.fsPath;
    if (document.uri.scheme !== "file" || path.basename(path.dirname(file)) !== "memory" || path.basename(path.dirname(path.dirname(file))) !== ".hypeproof") return;
    void noteStudioMemorySave(file);
  });
}
