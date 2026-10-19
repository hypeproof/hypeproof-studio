import type { TrialEndCardView } from "../../src/protocol";

/**
 * TUX-COND-07 — the inline end-of-trial card (REQ-L12 ①②, CU-13/14).
 * Inline in the chat, not a modal (SX inline progression). Facts first, one Primary, one escape.
 * It does nothing by itself: the purchase view opens only when the Primary is pressed, and the
 * escape only closes the card. No countdown, no scarcity, no pre-selected upsell.
 */
export function TrialEndCard({ card, onPasses, onDismiss }: { card: TrialEndCardView; onPasses: () => void; onDismiss: () => void }) {
  return (
    <section className="hps-trial-end-card" role="status" aria-live="polite" aria-labelledby="hps-trial-end-card-title">
      <h3 id="hps-trial-end-card-title" className="hps-trial-end-card-title">{card.title}</h3>
      {card.facts.map((fact, i) => <p key={i} className="hps-trial-end-card-fact">{fact}</p>)}
      <div className="hps-trial-end-card-actions">
        <button type="button" className="hps-trial-end-card-primary" onClick={onPasses}>{card.primary}</button>
        <button type="button" className="hps-trial-end-card-escape" onClick={onDismiss}>{card.escape}</button>
      </div>
    </section>
  );
}
