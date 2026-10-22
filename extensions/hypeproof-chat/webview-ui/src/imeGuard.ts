/**
 * CGP-DS-R-027: while an IME composition is open (Korean 2-set, MS IME), keys belong to the IME.
 * Enter commits the syllable and Escape cancels it; neither may send, close a panel or move a
 * menu. `keyCode 229` is the legacy Safari/Chromium signal some IMEs still send instead of
 * `isComposing`.
 */
export function imeComposing(event: { nativeEvent: { isComposing?: boolean; keyCode?: number } }, composing = false): boolean {
  return composing || nativeComposing(event.nativeEvent);
}

/** The same test for a native `KeyboardEvent` (listeners added with addEventListener). */
export function nativeComposing(event: { isComposing?: boolean; keyCode?: number }): boolean {
  return event.isComposing === true || event.keyCode === 229;
}

/**
 * CGP-DS-D-024: VS Code's webview host listens for keydown on the iframe's window and forwards
 * every key it sees to the workbench keybinding dispatcher, without `isComposing`. A composition
 * key (Enter, Escape, Tab, Arrow-up, Cmd/Ctrl+Enter) from any text field in the webview would
 * then reach Studio's own shortcuts. Stop it at the document, after every handler inside the
 * page has run and before the window. Returns the uninstaller.
 */
export function installImeHostBarrier(doc: Pick<Document, 'addEventListener' | 'removeEventListener'>): () => void {
  const stop = (event: Event) => { if (nativeComposing(event as KeyboardEvent)) event.stopPropagation(); };
  doc.addEventListener('keydown', stop);
  return () => doc.removeEventListener('keydown', stop);
}
