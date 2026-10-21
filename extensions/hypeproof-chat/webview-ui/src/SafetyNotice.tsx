import type { SafetyNoticeView } from "../../src/safetyNotice";

/**
 * REQ-CGP-LEARN-13 / DES-CGP-LEARN-13 — a moderation block, drawn in the chat column instead of the red
 * error card. Calm on purpose: a polite status (never an alert), the panel's own surface colours, no
 * icon, no motion, no retry and no sound. The help-line numbers are plain, selectable text: a desktop
 * has no phone to dial, and a link would leave the safe session.
 */
export function SafetyNotice({ view, onDismiss }: { view: SafetyNoticeView; onDismiss: () => void }) {
  return (
    <section className="hps-safety-notice" role="status" aria-live="polite" aria-labelledby="hps-safety-title">
      <p id="hps-safety-title" className="hps-safety-title">{view.title}</p>
      <p className="hps-safety-msg">{view.message}</p>
      {view.help && (
        <div className="hps-safety-help">
          <p className="hps-safety-intro">{view.help.intro}</p>
          <ul className="hps-safety-lines" aria-label="상담 전화">
            {view.help.lines.map((line) => (
              <li key={line.number}>
                <span className="hps-safety-line-label">{line.label}</span>{" "}
                <span className="hps-safety-number">{line.number}</span>
              </li>
            ))}
          </ul>
          <p className="hps-safety-adult">{view.help.adultLine}</p>
        </div>
      )}
      <button type="button" className="hps-safety-dismiss" onClick={onDismiss}>닫기</button>
    </section>
  );
}
