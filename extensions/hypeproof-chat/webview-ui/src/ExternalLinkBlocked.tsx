import "./refusalBanner.css";
import { middleEllipsis } from "../../src/taskActivity";

/** CGP-ART-D-008 — the host is never shortened below this many characters; past it, a middle ellipsis. */
export const BLOCKED_HOST_MAX = 48;

/** The help-draft line "선생님께 알리기" adds. The learner still sees the preview and ticks consent before anything leaves. */
export function blockedLinkHelpText(host: string): string {
  return `수업 중에 이 사이트를 열어야 해요: ${host}`;
}

/**
 * CGP-ART-D-008 — a minor's chat link outside the cohort allowlist did not open (flag `safeLinkAllowlistEnabled`).
 * Drawn inline next to the composer, not inside the browser tab: the native BrowserTab contract has no trusted in-tab
 * surface (decisions.md, CGP-ART-D-008). It never focuses itself or the editor; it reuses the refusal banner's theme pair,
 * so text and surface come from the same theme in light and dark. "선생님께 알리기" appears only while the class help
 * channel is ready and only puts the host into the learner's own help draft.
 */
export function ExternalLinkBlocked(props: { host: string; canAskTeacher: boolean; onAskTeacher: () => void; onDismiss: () => void }) {
  return <section className="hps-refusal-banner" role="alert" data-link-blocked={props.host}>
    <div>
      <strong>이 사이트는 수업에서 열 수 없어요</strong>
      <p><strong data-link-blocked-host="" title={props.host}>{middleEllipsis(props.host, BLOCKED_HOST_MAX)}</strong></p>
      <p>열리지 않았어요. 필요한 사이트라면 선생님께 알려 주세요.</p>
    </div>
    {props.canAskTeacher && <button type="button" data-link-blocked-ask="" onClick={props.onAskTeacher}>선생님께 알리기</button>}
    <button type="button" aria-label="차단 안내 닫기" onClick={props.onDismiss}>닫기</button>
  </section>;
}
