// Learner-facing Korean copy for dictation and read-aloud. Student-facing UI copy stays Korean; the
// comments stay English.
//
// Confirmed by Jay (2026-11-09, policy record Appendix B, `hps-voice-policy/1`): the three disclosure
// paragraphs, the button, the class-off line and the cap line. Agent-chosen, not confirmed: every other
// string here (decisions.md, CGP-VOICE-D-003 / D-018 / R-003 / R-012 / R-016 entries).
import type { VoicePolicyVersion } from "./voiceServed.ts";

// ---- Disclosure sheet (D-003, REQ-CGPV-04). Rendered only from an approved, versioned policy. ----
export const DISCLOSURE_TITLE = "음성 사용 안내";
export const DISCLOSURE_START = "시작하기";
export const DISCLOSURE_CLOSE = "음성 사용 안내 닫기";

interface DisclosureCopy { dictationMinor: string; dictationAdult: string; readAloud: string }
const DISCLOSURE: Record<VoicePolicyVersion, DisclosureCopy> = {
  "hps-voice-policy/1": {
    dictationMinor: "말하면 글자로 바꿔 줘요. 목소리는 글자로 바꾸는 데만 쓰고 저장하지 않아요. 보내기 전에 글을 고칠 수 있어요.",
    dictationAdult: "말한 내용을 글로 바꿔 입력창에 넣어요. 음성은 저장하지 않고, 보낸 글만 이 채팅에 남아요.",
    readAloud: "답을 소리로 읽어 줘요. 이 컴퓨터 안에서 읽어서 아무 데도 보내지 않아요.",
  },
};

/** The paragraphs of the sheet for what is served: dictation first, then read-aloud. Nothing else is added. */
export function disclosureParagraphs(version: VoicePolicyVersion, served: { dictation: boolean; readAloud: boolean }, minor: boolean): string[] {
  const copy = DISCLOSURE[version];
  const out: string[] = [];
  if (served.dictation) out.push(minor ? copy.dictationMinor : copy.dictationAdult);
  if (served.readAloud) out.push(copy.readAloud);
  return out;
}

// ---- Class off (D-018, REQ-CGPV-33) ----
/** The policy's own line, also what the Service answers with. */
export const CLASS_OFF = "이 수업에서는 쓸 수 없어요";
export const CLASS_OFF_HINT = "글로 이야기하면 돼요.";

// ---- Dictation control ----
export const DICTATE_LABEL = "받아쓰기";
export const DICTATE_START_TIP = "말해서 입력하기";
export const DICTATE_STOP_LABEL = "받아쓰기 끝내기";
export const DICTATE_CANCEL_LABEL = "취소";
export const DICTATE_RECORDING = "듣고 있어요";
export const DICTATE_WORKING = "글로 바꾸는 중이에요";
export const DICTATE_DONE = "입력창에 넣었어요. 고쳐서 보내세요.";
export const DICTATE_ELAPSED = (seconds: number, max: number) => `${seconds}초 / ${max}초`;
export const CLOSE = "닫기";
export const DICTATE_LIMIT_NOTE = "한 번에 1분 안으로 말해 주세요";

// ---- Failures, by cause with a recovery (REQ-CGPV-18). Service refusals are shown as the Service wrote them. ----
export const SOFT_UNREADABLE = "소리가 잘 들리지 않았어요. 다시 말해 볼까요?";
export const SOFT_TOO_SHORT = "너무 짧게 들렸어요. 조금 더 길게 말해 볼까요?";
export const NO_MIC = "마이크를 찾을 수 없어요. 마이크가 연결됐는지 확인해 주세요. 글로는 계속 이야기할 수 있어요.";
export const MIC_BUSY = "마이크를 다른 곳에서 쓰고 있어요. 그쪽을 끄고 다시 해 보세요.";
export const UNSUPPORTED = "이 컴퓨터에서는 받아쓰기를 쓸 수 없어요. 글로 이야기해 주세요.";
export const NETWORK = "인터넷 연결을 확인해 주세요. 글로는 계속 이야기할 수 있어요.";
export const GENERIC_UNAVAILABLE = "지금은 받아쓰기를 할 수 없어요. 글로 이야기해 주세요.";
export const TOO_LARGE = "녹음이 너무 커요. 조금 짧게 말해 주세요.";

// ---- Microphone permission recovery card (R-003) ----
export const MIC_DENIED_TITLE = "마이크를 쓸 수 없어요";
export const MIC_DENIED_BODY = "이 컴퓨터에서 마이크 사용이 허용되지 않았어요. 설정에서 허용한 뒤 받아쓰기를 다시 눌러 주세요. 글로는 계속 이야기할 수 있어요.";
export const MIC_SETTINGS_BUTTON = "마이크 설정 열기";
export const MIC_SETTINGS_FAILED = "설정을 열지 못했어요. 시스템 설정에서 마이크 권한을 확인해 주세요.";
export const MIC_DENIED_DISMISS = "글로 계속하기";

// ---- A failed clip kept in memory for one retry (R-016, REQ-CGPV-19) ----
export const RETRY = "다시 시도";
export const RECOVERED_INSERT = "메시지에 넣기";
export const RECOVERED_COPY = "복사";
export const RECOVERED_COPIED = "복사했어요";
export const RETRY_TEXT_LABEL = "받아쓴 글";

// ---- Read-aloud ----
// The control's two labels are the design row's own copy (CGP-CHAT-D67, decisions.md CGP-CHAT-D-009).
export const READ_ALOUD_LABEL = "읽어 주기";
export const READ_ALOUD_STOP = "그만 읽기";
export const READ_ALOUD_PLAYING = "읽는 중이에요";
export const READ_ALOUD_CODE_SKIPPED = "코드는 건너뛰었어요";
export const READ_ALOUD_UNAVAILABLE = "이 컴퓨터에서는 소리로 읽을 수 없어요";
/** CGP-VOICE-R-028 / DES-CGPV-41: the engine refused sound without a press (autoplay policy). One sentence + one action. */
export const READ_ALOUD_BLOCKED = "소리가 막혔어요.";
export const READ_ALOUD_RESUME = "소리 켜기";
/** CGP-VOICE-R-002: read-aloud is held while the voice panel's 소리 끄기 is on. */
export const READ_ALOUD_OUTPUT_OFF = "소리를 꺼 두었어요. 음성 대화에서 소리를 켜면 들을 수 있어요";

// ---- Microphone and speaker switches (CGP-VOICE-R-002 / CGP-VOICE-D-001) ----
// Two switches, never one. The button names stay the same while pressed (aria-pressed carries the
// state); the state words are written beside them and announced on a change.
export const MIC_MUTE_LABEL = "마이크 끄기";
export const OUTPUT_MUTE_LABEL = "소리 끄기";
export const MIC_OFF = "마이크 꺼짐";
export const MIC_ON = "마이크 켜짐";
export const OUTPUT_OFF = "소리 꺼짐";
export const OUTPUT_ON = "소리 켜짐";
