/** Shared surface-only hints. No host bridge, permissions, or persisted state.
 * Self-contained so Chalk can embed the same implementation without a module loader.
 */
export function installTooltips(doc: Document): () => void {
  // Render tests use a document without a defaultView; fall back to the global timers.
  const win = (doc.defaultView ?? globalThis) as unknown as Window;
  const tip = doc.createElement('div');
  tip.className = 'hp-tooltip';
  // Hints repeat or supplement an independently named control, never its accessible name.
  tip.setAttribute('aria-hidden', 'true');
  tip.hidden = true;
  doc.body.appendChild(tip);
  let timer: number | undefined;
  let active: HTMLElement | null = null;
  let focused: HTMLElement | null = null;
  let hovered: HTMLElement | null = null;
  const target = (event: Event) => {
    const node = event.target as HTMLElement | null;
    return node?.closest?.<HTMLElement>('[data-hp-tooltip]') ?? null;
  };
  const cancel = () => { win.clearTimeout(timer); timer = undefined; };
  const hide = () => { cancel(); active = null; tip.hidden = true; tip.textContent = ''; };
  const show = (el: HTMLElement) => {
    cancel();
    if (!el.isConnected || !el.getAttribute('data-hp-tooltip')) { hide(); return; }
    active = el;
    const layer = el.closest('dialog[open]') ?? doc.body;
    if (tip.parentElement !== layer) layer.appendChild(tip);
    const label = el.getAttribute('data-hp-tooltip')!;
    const shortcut = el.getAttribute('aria-keyshortcuts');
    tip.textContent = shortcut && !label.includes(shortcut) ? `${label} (${shortcut})` : label;
    tip.hidden = false;
    // Fixed positioning escapes scroll containers; clamp to the viewport on both axes.
    const rect = el.getBoundingClientRect();
    const box = tip.getBoundingClientRect();
    let x = Math.max(8, Math.min(rect.left, win.innerWidth - box.width - 8));
    const below = rect.bottom + 4;
    let y = below + box.height <= win.innerHeight - 8 ? below : Math.max(8, rect.top - box.height - 4);
    // A menu item's hint goes beside the menu, never over the next item; when neither side has
    // room (a narrow panel), it goes below or above the whole menu.
    const menu = el.getAttribute('role') === 'menuitem' ? el.closest('[role="menu"]') : null;
    if (menu) {
      const m = menu.getBoundingClientRect();
      const side = m.left - box.width - 4 >= 8 ? m.left - box.width - 4 : m.right + 4 + box.width <= win.innerWidth - 8 ? m.right + 4 : null;
      if (side !== null) {
        x = side;
        y = Math.max(8, Math.min(rect.top + (rect.height - box.height) / 2, win.innerHeight - box.height - 8));
      } else {
        y = m.bottom + 4 + box.height <= win.innerHeight - 8 ? m.bottom + 4 : Math.max(8, m.top - box.height - 4);
      }
    }
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
  };
  const over = (event: Event) => {
    const el = target(event);
    if (el === hovered) return;
    hovered = el;
    if (el && el === focused) { if (active !== el) show(el); return; }
    // The pointer moving onto plain content must not take the focused control's hint away.
    if (!el && focused?.isConnected) { show(focused); return; }
    hide();
    if (el) timer = win.setTimeout(() => show(el), 500);
  };
  const out = (event: Event) => {
    const next = (event as MouseEvent).relatedTarget as Node | null;
    if (hovered?.contains(next)) return;
    hovered = null;
    if (focused?.isConnected) show(focused);
    else hide();
  };
  // Keyboard focus scrolls the control into view and the browser fires `scroll` right after
  // focusin. That scroll is not the user leaving the control, so the focused hint stays and is
  // re-placed; a wheel/touch/key scroll, or any scroll once the window lapses, still dismisses.
  const GUARD_MS = 300, GUARD_CAP_MS = 1500;
  let guardUntil = 0, guardCap = 0;
  const now = () => win.performance.now();
  const focus = (event: Event) => {
    focused = target(event);
    hide();
    if (focused) { show(focused); guardUntil = now() + GUARD_MS; guardCap = now() + GUARD_CAP_MS; }
  };
  const scrolled = () => {
    const t = now();
    if (active && active === focused && active.isConnected && t < guardUntil) {
      guardUntil = Math.min(guardCap, t + 100);
      show(active);
    } else dismiss();
  };
  const userScroll = () => { guardUntil = 0; };
  const blur = () => { focused = null; hide(); };
  const dismiss = () => { hovered = null; focused = null; hide(); };
  const key = (event: Event) => {
    const e = event as KeyboardEvent;
    if (e.key === 'Escape' && !e.isComposing) dismiss();
    else if (e.key !== 'Tab' && e.key !== 'Shift') userScroll();
  };
  const handlers: [string, EventListener][] = [
    ['mouseover', over], ['mouseout', out], ['focusin', focus], ['focusout', blur],
    ['keydown', key], ['pointerdown', dismiss], ['scroll', scrolled], ['wheel', userScroll], ['touchmove', userScroll],
  ];
  for (const [type, handler] of handlers) doc.addEventListener(type, handler, true);
  win.addEventListener?.('resize', dismiss);
  win.addEventListener?.('blur', dismiss);
  // React rerenders and Chalk's row replacement must not leave a stale hint over another task.
  const observer = new MutationObserver(() => {
    if (active && (!active.isConnected || !active.getAttribute('data-hp-tooltip'))) dismiss();
    else if (active) {
      const label = active.getAttribute('data-hp-tooltip')!;
      const shortcut = active.getAttribute('aria-keyshortcuts');
      const text = shortcut && !label.includes(shortcut) ? `${label} (${shortcut})` : label;
      if (tip.textContent !== text) show(active);
    }
  });
  observer.observe(doc.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-hp-tooltip', 'aria-keyshortcuts'] });
  return () => {
    dismiss(); observer.disconnect(); tip.remove();
    for (const [type, handler] of handlers) doc.removeEventListener(type, handler, true);
    win.removeEventListener?.('resize', dismiss); win.removeEventListener?.('blur', dismiss);
  };
}
