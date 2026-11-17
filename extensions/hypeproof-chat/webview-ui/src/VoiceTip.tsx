// CGP-VOICE-R-029 (REQ-CGPV-42 / DES-CGPV-42) — the voice discoverability tip, at most once per seat. It sits right
// under the voice control's 음성 대화 button (in the flow, with a pointer toward it), only while the learner can
// actually start voice and the current task has no messages; the host decides whether this seat is due. It is not
// modal, never takes focus and has no animation. Drawing it, or closing it, tells the host this seat has seen it.

import { useEffect, useId, useRef, useState } from 'react';
import type { ChatConfig } from '../../src/protocol';
import { VOICE_TIP_CLOSE, VOICE_TIP_TEXT } from '../../src/voiceTip';
import { ChatIcon } from './ChatDetails';
import { useServedReadAloud } from './ReadAloudButton';
import { useVoice } from './VoiceProvider';
import { onHostMessage, postToHost } from './vscode';

export function VoiceTip({ config, taskEmpty }: { config?: ChatConfig; taskEmpty: boolean }) {
  const voice = useVoice(), speech = useServedReadAloud(), id = useId(), serial = useRef(0);
  // The same condition as VoiceConversationControl's: the 음성 대화 button is there.
  const served = voice.availability.kind === 'on' && voice.availability.served.dictation && voice.availability.served.readAloud && !!speech;
  // "No messages" means something only once this task's history has arrived: the host posts config first and the
  // history right after, so until then an old task with messages looks empty. A new activity or task waits again.
  const scope = `${config?.activity?.id ?? ''}:${config?.taskWorkspace?.activeTaskId ?? ''}`;
  const scopeRef = useRef(scope); scopeRef.current = scope;
  const [historyFor, setHistoryFor] = useState<string | null>(null);
  useEffect(() => onHostMessage(message => { if (message.type === 'history') setHistoryFor(scopeRef.current); }), []);
  const eligible = served && taskEmpty && historyFor === scope && config?.hasToken === true && config.activity?.verified === true;
  const [due, setDue] = useState(false);
  const [closed, setClosed] = useState(false);
  useEffect(() => {
    if (!eligible || closed) { setDue(false); return; }
    const requestId = `${id}-${++serial.current}`;
    const off = onHostMessage(message => { if (message.type === 'voiceTip' && message.requestId === requestId) setDue(message.show === true); });
    postToHost({ type: 'voiceTipRequest', requestId, taskEmpty: true });
    return off;
  }, [eligible, closed, config?.activity?.id, config?.profile?.profile_id]);
  const show = eligible && due && !closed;
  // Drawn: from now on this seat has seen it, even if the window closes before 닫기. Once drawn, any hide (닫기,
  // the first message of the task, voice going away) closes it for good; a panel remount (unmount) does not.
  const drawn = useRef(false);
  useEffect(() => {
    if (show) { drawn.current = true; postToHost({ type: 'voiceTipShown' }); }
    else if (drawn.current) { drawn.current = false; postToHost({ type: 'voiceTipDismiss' }); }
  }, [show]);
  if (!show) return null;
  return <div className="hps-voice-tip" role="note" aria-label="음성 대화 팁" data-testid="voice-tip">
    <span className="hps-voice-tip-text">{VOICE_TIP_TEXT}</span>
    <button type="button" className="hps-voice-tip-close" aria-label={VOICE_TIP_CLOSE} data-hp-tooltip={VOICE_TIP_CLOSE} onClick={() => setClosed(true)}>
      <ChatIcon kind="close" size={20} />
    </button>
  </div>;
}
