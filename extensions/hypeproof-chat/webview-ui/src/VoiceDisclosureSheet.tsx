// CGP-VOICE-D-003 (DES-CGPV-04) — the disclosure sheet shown before the first use of voice, once per
// policy version. The sentences come from voiceCopy.ts, which holds the approved text for each policy
// version. The explicit automatic mode adds its send/Stop behavior without changing the grant.
// Escape and × close the sheet without starting.
import { ChatPreferences } from "./ChatPreferences";
import { DISCLOSURE_CLOSE, DISCLOSURE_START, DISCLOSURE_TITLE, disclosureParagraphs } from "../../src/voiceCopy";
import type { ServedVoice } from "../../src/voiceServed";

export function VoiceDisclosureSheet({ served, minor, automatic = false, onStart, onCancel }: { served: ServedVoice; minor: boolean; automatic?: boolean; onStart(): void; onCancel(): void }) {
  const paragraphs = automatic
    ? ['말이 끝나면 글로 바꿔 자동으로 보내요. 목소리는 글로 바꾸는 데만 쓰고 저장하지 않아요. 보낸 글은 이 대화에 남아요.', ...disclosureParagraphs(served.policyVersion, { dictation: false, readAloud: served.readAloud }, minor), '답을 읽은 뒤 다시 들어요. 중지 버튼이나 Escape를 누르면 마이크와 읽기가 멈춰요. 이미 보낸 요청은 대화 기록에 남아요.']
    : disclosureParagraphs(served.policyVersion, served, minor);
  return (
    <ChatPreferences open onClose={onCancel} title={DISCLOSURE_TITLE} closeLabel={DISCLOSURE_CLOSE} className="hps-voice-disclosure" initialFocus=".hps-voice-disclosure-start">
      <div className="hps-voice-disclosure-body" data-policy-version={served.policyVersion}>
        {paragraphs.map((text, i) => <p key={i}>{text}</p>)}
      </div>
      <div className="hps-voice-disclosure-actions">
        <button type="button" className="hps-voice-disclosure-start" onClick={onStart}>{automatic ? '자동 음성 대화 시작' : DISCLOSURE_START}</button>
      </div>
    </ChatPreferences>
  );
}
