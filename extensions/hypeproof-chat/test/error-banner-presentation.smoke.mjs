// Error banner framing: an ended or spent personal trial is an account state, not a
// lost connection. Positive rows are the exact sentences the host and the Service send
// today; negative controls are real transport failures that must keep the connection frame.
import assert from 'node:assert/strict';
import { errorBannerPresentation } from '../webview-ui/src/errorBannerPresentation.ts';

const TRIAL_END = { icon: '⏳', title: '체험이 끝났어요' };
const CONNECTION = { icon: '🔌', title: '연결이 끊겼어요' };

// Positive: trial expiry / exhaustion copy (proxyClientHelpers.classifyProfileFailure,
// Service chat-gate trial_expired, Service native-trial-budget trial_exhausted).
const trialEnd = [
  '개인 체험 시간이 끝났습니다. 작업 파일은 그대로 남아 있습니다. 다시 체험하려면 코드 발급 담당자에게 새 체험을 요청해 주세요.',
  '개인 체험 시간이 끝났습니다. 작업 파일은 그대로 보존됩니다.',
  '개인 체험의 총 요청 한도에 도달했습니다.',
];
for (const message of trialEnd) {
  assert.deepEqual(errorBannerPresentation(message), TRIAL_END, `trial end is account state: ${message}`);
  assert.notEqual(errorBannerPresentation(message).icon, '🔌', `trial end never reads as connection loss: ${message}`);
}

// Negative controls: real network / timeout failures keep the connection frame.
const connection = [
  '서버에 연결하지 못했어요. 인터넷 연결을 확인해주세요. 🌐',
  '요청 시간이 초과되었어요. 네트워크를 확인하고 다시 보내 주세요.',
  '네트워크 오류: fetch failed',
  'Request timed out',
  'stream interrupted',
];
for (const message of connection) {
  assert.deepEqual(errorBannerPresentation(message), CONNECTION, `network failure keeps connection frame: ${message}`);
}

// Existing frames that must not move.
assert.deepEqual(
  errorBannerPresentation('이용권 기간이 끝났습니다. 만든 파일과 대화는 그대로 보존됩니다.'),
  { icon: '🎟️', title: '이용권을 더 쓸 수 없어요' },
  'a bought pass keeps the pass frame (REQ-L12)',
);
assert.deepEqual(
  errorBannerPresentation('이용권의 AI 요청 횟수를 모두 썼습니다. 만든 파일과 대화는 그대로 남아 있습니다.'),
  { icon: '🎟️', title: '이용권을 더 쓸 수 없어요' },
  'a spent pass keeps the pass frame',
);
assert.deepEqual(
  errorBannerPresentation('참여 코드가 만료되었습니다. 코드 발급 담당자에게 새 코드를 요청해 주세요.'),
  { icon: '🔒', title: '잠시 멈춰요' },
  'an expired participation code stays an authentication notice',
);
// A busy-or-exhausted notice cannot prove the trial ended, so it is not framed as an ending.
assert.notDeepEqual(
  errorBannerPresentation('체험 요청이 진행 중이거나 허용 횟수를 모두 사용했어요.'),
  TRIAL_END,
  'ambiguous busy/exhausted copy is not claimed as trial end',
);
assert.deepEqual(errorBannerPresentation('알 수 없는 오류'), { icon: '⚠️', title: '문제가 생겼어요' });

console.log('error-banner-presentation: ok');
