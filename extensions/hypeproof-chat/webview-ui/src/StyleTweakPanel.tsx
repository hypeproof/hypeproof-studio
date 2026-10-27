import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { StyleTweakView } from '../../src/styleTweak';
import { ChatIcon } from './ChatDetails';
import { imeComposing } from './imeGuard';
import './styleTweak.css';

/**
 * CGP-ART-R-006 / DES-ART-06 — five rows (색, 배경, 글자 크기, 간격, 모서리) for the picked element.
 * Every press asks the host, which validates the value against the offer and previews it in the
 * browser tab only. The send button sends the learner's chosen values as their own message, and
 * only that send carries the structured request (property, old value, new value) after the element
 * block; the exact text is shown under 이 버튼이 보낼 요청 보기.
 * CGP-ART-D-006: the rows open as a compact popover (≤ 280 px) anchored under the element chip's
 * toggle, the trusted surface nearest the picked element (the browser tab has none). Escape closes
 * it and returns focus to the toggle without reaching the panel or workspace handlers above.
 */
export function StyleTweakPanel(props: { view: StyleTweakView; onSet: (prop: string, value: string | null) => void; onSend: (text: string) => void; disabled?: boolean }) {
  const { view } = props;
  const [open, setOpen] = useState(view.changes > 0);
  // A press is in flight until the host's next view arrives: sending then would send the old summary.
  const [pending, setPending] = useState(false);
  useEffect(() => setPending(false), [view]);
  const set = (prop: string, value: string | null) => {
    setPending(true);
    props.onSet(prop, value);
  };
  const panelId = `hps-style-tweak-${view.id}`;
  const toggleRef = useRef<HTMLButtonElement>(null);
  const close = () => { setOpen(false); toggleRef.current?.focus(); };
  return (
    <div className="hps-style-tweak" data-testid="style-tweak">
      <button ref={toggleRef} type="button" className="hps-style-tweak-toggle" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(!open)}>
        <ChatIcon kind="pencil" size={16} /> 스타일 바꿔 보기{view.changes > 0 ? ` · ${view.changes}개 고름` : ''}
      </button>
      {open && (
        <div
          id={panelId}
          className="hps-style-tweak-body"
          role="group"
          aria-label="고른 요소의 스타일 바꿔 보기"
          onKeyDown={(e) => {
            if (e.key !== 'Escape' || imeComposing(e)) return;
            e.preventDefault();
            e.stopPropagation();
            close();
          }}
        >
          <p className="hps-style-tweak-note">미리보기 탭에서만 바뀌어 보여요. 파일은 코치가 고쳐요.</p>
          {view.rows.map((row) => (
            <div key={row.prop} className="hps-style-tweak-row" data-prop={row.prop}>
              <span className="hps-style-tweak-label">{row.label}</span>
              {/* The reset sits on the label line, before the controls, in focus order and on screen. */}
              <button type="button" className="hps-style-tweak-reset" aria-label={`${row.label} 되돌리기`} disabled={props.disabled || row.chosen === null} onClick={() => set(row.prop, null)}>
                <ChatIcon kind="retry" size={16} />
              </button>
              {row.kind === 'color' ? (
                row.options.length ? (
                  <div className="hps-style-tweak-swatches" role="radiogroup" aria-label={`${row.label}: 이 페이지에 쓰인 색`}>
                    {row.options.map((c) => {
                      const selected = (row.chosen ?? row.current) === c;
                      return (
                        <button key={c} type="button" role="radio" aria-checked={selected} className="hps-style-tweak-swatch" aria-label={`${row.label} ${c}${row.current === c ? ' (지금)' : ''}`} title={c} disabled={props.disabled} onClick={() => set(row.prop, c)}>
                          {/* The page colour (host-validated rgb()/rgba()) is data, not a theme value: it rides a custom property. */}
                          <span className="hps-style-tweak-chip" style={{ '--hps-style-tweak-swatch': c } as CSSProperties} />
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <span className="hps-style-tweak-value">이 페이지에서 고를 색을 찾지 못했어요</span>
                )
              ) : (
                <div className="hps-style-tweak-stepper">
                  <button type="button" aria-label={`${row.label} 줄이기`} disabled={props.disabled || !row.prev} onClick={() => row.prev && set(row.prop, row.prev)}>
                    <ChatIcon kind="minus" size={16} />
                  </button>
                  <span className="hps-style-tweak-value" aria-live="polite">{row.chosen ?? row.current}</span>
                  <button type="button" aria-label={`${row.label} 늘리기`} disabled={props.disabled || !row.next} onClick={() => row.next && set(row.prop, row.next)}>
                    <ChatIcon kind="plus" size={16} />
                  </button>
                </div>
              )}
              {row.chosen !== null && <span className="hps-style-tweak-change">{row.current} → {row.chosen}</span>}
            </div>
          ))}
          {view.changes > 0 && view.requestText && (
            <details className="hps-style-tweak-request">
              {/* Exactly what this button sends with the element; another message sends the element alone. */}
              <summary>이 버튼이 보낼 요청 보기</summary>
              <pre data-testid="style-tweak-request">{view.requestText}</pre>
            </details>
          )}
          <button type="button" className="hps-style-tweak-send" disabled={props.disabled || pending || view.changes === 0} onClick={() => props.onSend(view.sendText)}>
            {view.changes}개 바꿔 달라고 하기
          </button>
        </div>
      )}
    </div>
  );
}
