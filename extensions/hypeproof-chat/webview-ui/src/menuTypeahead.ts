import { useEffect, useRef } from 'react';
import type { KeyboardEvent, CompositionEvent } from 'react';
import { imeComposing } from './imeGuard';

const labelOf = (item: HTMLButtonElement) => {
  const copy = item.cloneNode(true) as HTMLElement;
  copy.querySelectorAll('small,svg,[aria-hidden="true"]').forEach(n => n.remove());
  return (item.getAttribute('aria-label') || copy.textContent || '').trim().normalize('NFC').toLocaleLowerCase();
};

/** Prefix search moves focus only. IME text and activation keys keep their own behavior. */
export function useMenuTypeahead(open: boolean) {
  const composing = useRef(false);
  const buffer = useRef({ text: '', at: 0 });
  const reset = () => { buffer.current = { text: '', at: 0 }; };
  useEffect(() => { reset(); composing.current = false; }, [open]);
  const move = (input: string, items: HTMLButtonElement[]) => {
    const now = Date.now(), key = input.normalize('NFC').toLocaleLowerCase();
    const previous = now - buffer.current.at <= 700 ? buffer.current.text : '';
    const text = previous + key;
    buffer.current = { text, at: now };
    const prefix = [...text].every(c => c === key) ? key : text;
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    // A growing prefix may retain its current match; repeated letters cycle from the next item.
    const start = prefix.length > key.length ? Math.max(at, 0) : at + 1;
    for (let offset = 0; offset < items.length; offset++) {
      const item = items[(start + offset) % items.length];
      if (!item.disabled && labelOf(item).startsWith(prefix)) {
        item.focus({ preventScroll: true }); return true;
      }
    }
    return false;
  };
  return {
    composing, reset,
    onCompositionStart: () => { composing.current = true; },
    onCompositionEnd(event: CompositionEvent, items: HTMLButtonElement[]) {
      composing.current = false;
      // Korean IMEs commit text here, not as a printable keydown. Cancellation does not move focus.
      if (!event.data) { reset(); return; }
      if (open) move(event.data, items);
    },
    search(event: KeyboardEvent, items: HTMLButtonElement[]) {
      if (!open || event.defaultPrevented || imeComposing(event, composing.current) || event.ctrlKey || event.metaKey || event.altKey || event.key === ' ' || [...event.key].length !== 1) return;
      if (move(event.key, items)) event.preventDefault();
    },
  };
}
