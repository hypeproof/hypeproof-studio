import { useEffect, useState } from "react";
import type { TrialEndCardView, TrialEndNotifyView } from "../../src/protocol";
import { postToHost } from "./vscode";

/**
 * TUX-COND-07 — the inline end-of-trial card (REQ-L12 ①②, CU-13/14).
 * Inline in the chat, not a modal (SX inline progression). Facts first, one Primary, one escape.
 * It does nothing by itself: the purchase view opens only when the Primary is pressed, and the
 * escape only closes the card. No countdown, no scarcity, no pre-selected upsell.
 */
export function TrialEndCard({ card, onPasses, onDismiss, continuationDraft = "", allowPersonalClaude = false }: { card: TrialEndCardView; onPasses: () => void; onDismiss: () => void; continuationDraft?: string; allowPersonalClaude?: boolean }) {
  return (
    <section className="hps-trial-end-card" role="status" aria-live="polite" aria-labelledby="hps-trial-end-card-title">
      <h3 id="hps-trial-end-card-title" className="hps-trial-end-card-title">{card.title}</h3>
      {card.facts.map((fact, i) => <p key={i} className="hps-trial-end-card-fact">{fact}</p>)}
      <div className="hps-trial-end-card-actions">
        <button type="button" className="hps-trial-end-card-primary" onClick={onPasses}>{card.primary}</button>
        {allowPersonalClaude && <button type="button" className="hps-trial-end-card-personal" onClick={() => postToHost({ type: "trialEndCardClaude", draft: continuationDraft })}>개인 Claude Code로 이어하기</button>}
        <button type="button" className="hps-trial-end-card-escape" onClick={onDismiss}>{card.escape}</button>
      </div>
      {card.notify ? <NotifyOptin notify={card.notify} /> : null}
    </section>
  );
}

type NotifyState = "form" | "sending" | "subscribed" | "withdrawing" | "withdrawn";

/**
 * TUX-COND-08 — optional "이메일로 소식 받기", quiet and below the pass offer (CU-13: no pressure).
 * Explicit opt-in: no pre-checked box; pressing 받기 is the agreement, with the items shown above it.
 * The address is held only in this field's state and posted to the host; it is never saved here.
 */
function NotifyOptin({ notify }: { notify: TrialEndNotifyView }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<NotifyState>(notify.submitted ? "subscribed" : "form");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const listener = (event: MessageEvent<{ type?: string; state?: string; message?: string }>) => {
      const m = event.data;
      if (m?.type !== "notifyOptinResult") return;
      if (m.state === "subscribed") { setState("subscribed"); setEmail(""); setError(null); }
      else if (m.state === "withdrawn") { setState("withdrawn"); setError(null); }
      else { setState((s) => (s === "withdrawing" ? "subscribed" : "form")); setError(typeof m.message === "string" ? m.message : null); }
    };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, []);
  if (state === "subscribed" || state === "withdrawing") {
    return (
      <div className="hps-notify-optin" data-testid="notify-optin">
        <p className="hps-notify-optin-done">
          {notify.done}{" "}
          <button type="button" className="hps-notify-optin-withdraw" disabled={state === "withdrawing"}
            onClick={() => { setState("withdrawing"); setError(null); postToHost({ type: "notifyOptinWithdraw" }); }}>
            {notify.withdraw}
          </button>
        </p>
        {error ? <p className="hps-notify-optin-error" role="alert">{error}</p> : null}
      </div>
    );
  }
  if (state === "withdrawn") {
    return <div className="hps-notify-optin" data-testid="notify-optin"><p className="hps-notify-optin-done">{notify.withdrawn}</p></div>;
  }
  return (
    <form className="hps-notify-optin" data-testid="notify-optin" noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (!email.trim() || state === "sending") return;
        setState("sending"); setError(null);
        postToHost({ type: "notifyOptinSubmit", email: email.trim() });
      }}>
      <p className="hps-notify-optin-prompt" id="hps-notify-optin-prompt">{notify.prompt}</p>
      <div className="hps-notify-optin-row">
        <input type="email" className="hps-notify-optin-input" aria-label={notify.label} aria-describedby="hps-notify-optin-prompt hps-notify-optin-consent"
          placeholder={notify.placeholder} autoComplete="email" maxLength={254} value={email} disabled={state === "sending"}
          onChange={(e) => setEmail(e.target.value)} />
        <button type="submit" className="hps-notify-optin-submit" disabled={state === "sending" || !email.trim()}>{notify.button}</button>
      </div>
      <p className="hps-notify-optin-consent" id="hps-notify-optin-consent">{notify.consent}</p>
      {error ? <p className="hps-notify-optin-error" role="alert">{error}</p> : null}
    </form>
  );
}
