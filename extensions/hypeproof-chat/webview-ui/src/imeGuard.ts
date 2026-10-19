/**
 * CGP-DS-R-027: while an IME composition is open (Korean 2-set, MS IME), keys belong to the IME.
 * Enter commits the syllable and Escape cancels it; neither may send, close a panel or move a
 * menu. `keyCode 229` is the legacy Safari/Chromium signal some IMEs still send instead of
 * `isComposing`.
 */
export function imeComposing(event: { nativeEvent: { isComposing?: boolean; keyCode?: number } }, composing = false): boolean {
  return composing || event.nativeEvent.isComposing === true || event.nativeEvent.keyCode === 229;
}
