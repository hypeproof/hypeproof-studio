// CGP-VOICE-D-003 (DES-CGPV-04) — the disclosure sheet shown before the first use of voice, once per
// policy version. The sentences come from voiceCopy.ts, which holds the approved text for each policy
// version; this file adds none. One button, 시작하기. Escape and × close the sheet without starting.
import { ChatPreferences } from "./ChatPreferences";
import { DISCLOSURE_CLOSE, DISCLOSURE_START, DISCLOSURE_TITLE, disclosureParagraphs } from "../../src/voiceCopy";
import type { ServedVoice } from "../../src/voiceServed";

export function VoiceDisclosureSheet({ served, minor, onStart, onCancel }: { served: ServedVoice; minor: boolean; onStart(): void; onCancel(): void }) {
  const paragraphs = disclosureParagraphs(served.policyVersion, served, minor);
  return (
    <ChatPreferences open onClose={onCancel} title={DISCLOSURE_TITLE} closeLabel={DISCLOSURE_CLOSE} className="hps-voice-disclosure" initialFocus=".hps-voice-disclosure-start">
      <div className="hps-voice-disclosure-body" data-policy-version={served.policyVersion}>
        {paragraphs.map((text, i) => <p key={i}>{text}</p>)}
      </div>
      <div className="hps-voice-disclosure-actions">
        <button type="button" className="hps-voice-disclosure-start" onClick={onStart}>{DISCLOSURE_START}</button>
      </div>
    </ChatPreferences>
  );
}
