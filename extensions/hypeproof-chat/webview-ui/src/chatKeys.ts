// CGP-CHAT-R-030 — two chat keys the shortcut sheet now lists: Esc stops an answer, Alt+Shift+K puts the cursor
// in the message box. In-app only (bound while this webview has focus), never global.
//
// Esc belongs to many owners before it belongs to "stop": an IME composition, a modal, a menu or list, the find bar,
// the voice panel and voice conversation, dictation, the quote action, a text field's own Escape. So the stop runs
// only while an answer streams, only for an unhandled Escape with no modifier, only from the composer's text box or
// a non-text place in the chat, and the decision waits until every other listener has had the event: a listener
// that handles Escape calls preventDefault, and then nothing is stopped.
//
// Alt+Shift+K (the K key by physical code, so macOS Option layouts work): no VS Code default and no OS default on
// macOS or Windows for Alt/Option+Shift+K, beside the chat's existing Alt+Shift+J and Alt+Shift+M.
import { useEffect, useRef } from 'react';
import { nativeComposing } from './imeGuard';

const TEXT_ENTRY = 'input, textarea, select, [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"], [role="textbox"], [role="combobox"]';
/** Places that own their keys: a dialog, a menu or list, the find bar, the voice panel, an open popover. */
const OWNERS = 'dialog[open], [aria-modal="true"], [role="dialog"], [role="menu"], [role="listbox"], .hps-find, .hps-voice-panel';
/** The composer's own text box: Esc there stops the answer (it has no Escape of its own). */
const COMPOSER = '.hps-input textarea';

type KeyLike = Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey' | 'repeat' | 'defaultPrevented' | 'isComposing' | 'keyCode' | 'target'>;

/** Could this Escape stop the answer (before the other listeners have spoken)? */
export function mayStopAnswer(event: KeyLike, doc: Document, streaming: boolean): boolean {
  if (!streaming || event.key !== 'Escape' || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.repeat || event.defaultPrevented) return false;
  if (nativeComposing(event)) return false;
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest(OWNERS)) return false;
  if (target?.closest(TEXT_ENTRY) && !target.closest(COMPOSER)) return false;
  // Anything modal or menu-like open elsewhere (focus may sit on <body> under it) keeps the keyboard.
  if (doc.querySelector('dialog[open], [aria-modal="true"], [role="menu"]:not([hidden]), [role="listbox"]:not([hidden])')) return false;
  // Dictation recording or the microphone explainer card own Escape while they are drawn.
  if (doc.querySelector('.hps-voice-recording, .hps-voice-explain')) return false;
  return true;
}

/** Alt+Shift+K, outside an IME composition and any open dialog. */
export function focusesComposer(event: KeyLike, doc: Document): boolean {
  if (event.code !== 'KeyK' || !event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey || event.repeat || event.defaultPrevented) return false;
  if (nativeComposing(event)) return false;
  if (doc.querySelector('dialog[open], [aria-modal="true"]')) return false;
  return true;
}

/**
 * Binds both keys on the window. `stop` runs after the event's dispatch has finished (a task later), and only if no
 * other listener handled the Escape meanwhile and the answer still streams.
 */
export function useChatKeys(opts: { streaming: boolean; stop: () => void; focusComposer: () => boolean }): void {
  const latest = useRef(opts);
  latest.current = opts;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (focusesComposer(event, document)) {
        if (latest.current.focusComposer()) event.preventDefault();
        return;
      }
      if (!mayStopAnswer(event, document, latest.current.streaming)) return;
      setTimeout(() => {
        if (event.defaultPrevented || !latest.current.streaming) return;
        latest.current.stop();
      }, 0);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
