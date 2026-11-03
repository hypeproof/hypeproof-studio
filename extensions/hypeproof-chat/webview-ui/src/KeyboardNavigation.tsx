import { canFocus, composer } from './dialogFocus';
import { imeComposing } from './imeGuard';
import { clampPanel, KEY_STEP, KEY_STEP_LARGE, type PanelName } from './panelSizes';
import './keyboardNavigation.css';

/** First in every chat frame, including classroom and instructor frames without a rail. */
export function SkipToInput() {
  return <a className="hps-skip-input" href="#chat-composer" onClick={event => {
    event.preventDefault();
    const target = composer();
    if (canFocus(target)) target.focus();
  }}>입력창으로 바로 가기</a>;
}

/** A vertical separator changes the width of the panel it names, in CSS pixels: Arrow keys or a drag. */
export function KeyboardSplitter({ panel, label, controls, value, onChange }: {
  panel: PanelName; label: string; controls: string; value: number; onChange: (value: number) => void;
}) {
  const growth = panel === 'rail' ? 1 : -1; // moving right grows the rail and shrinks the sources panel
  const limits = { min: clampPanel(panel, -Infinity), max: clampPanel(panel, Infinity) };
  return <div className={`tw-splitter tw-splitter-${panel}`} role="separator" tabIndex={0}
    aria-label={label} aria-controls={controls} aria-orientation="vertical"
    aria-valuemin={limits.min} aria-valuemax={limits.max} aria-valuenow={value} aria-valuetext={`${value} 픽셀`}
    onKeyDown={event => {
      if (imeComposing(event) || event.altKey || event.ctrlKey || event.metaKey || event.defaultPrevented) return;
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      onChange(clampPanel(panel, value + (event.key === 'ArrowRight' ? 1 : -1) * growth * (event.shiftKey ? KEY_STEP_LARGE : KEY_STEP)));
    }}
    onPointerDown={event => {
      if (event.button !== 0 || !event.isPrimary) return;
      const handle = event.currentTarget, pointer = event.pointerId, startX = event.clientX, startValue = value;
      // Window listeners, not pointer capture: the drag keeps working when the pointer leaves the strip or the webview.
      const move = (e: PointerEvent) => { if (e.pointerId === pointer) onChange(clampPanel(panel, startValue + growth * (e.clientX - startX))); };
      const stop = (e: PointerEvent) => {
        if (e.pointerId !== pointer) return;
        window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); window.removeEventListener('pointercancel', stop);
      };
      window.addEventListener('pointermove', move); window.addEventListener('pointerup', stop); window.addEventListener('pointercancel', stop);
      handle.focus({ preventScroll: true });
      event.preventDefault();
    }} />;
}
