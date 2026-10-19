// NAT-11 clock wording (trial diagnosis 2026-10-18, retro gap (b)2).
// The Service starts a native grant's window in one of two places, chosen by
// HPS_TRIAL_CLOCK_AT_MESSAGE (default off). The requirement must describe both
// states instead of asserting only the flag-off behavior as unconditional.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const doc = readFileSync(new URL('../../docs/requirements/studio-native-trial.md', import.meta.url), 'utf8');

const nat11Row = doc.split('\n').find(line => line.includes('NAT-11 '));
const accessSection = doc.slice(doc.indexOf('## 접근 방식'), doc.indexOf('## Epic'));

test('NAT-11 row names the clock flag and both start points', () => {
  assert.ok(nat11Row, 'NAT-11 row exists');
  assert.match(nat11Row, /HPS_TRIAL_CLOCK_AT_MESSAGE/);
  assert.match(nat11Row, /첫 인증된 요청/);
  assert.match(nat11Row, /첫 모델 요청/);
});

test('access section describes the flag-off default and the flag-on start', () => {
  assert.match(accessSection, /HPS_TRIAL_CLOCK_AT_MESSAGE/);
  // Flag off (default): first authenticated read, i.e. code entry.
  assert.match(accessSection, /플래그가 없거나 값이 `enabled`가 아니면[^.]*첫 인증된 profile\/context\/chat 요청부터/);
  // Flag on: reads do not start it; the first admitted model request does.
  assert.match(accessSection, /정확히 `enabled`이면[^.]*읽기는 창을 시작하지 않고[^.]*첫 모델 요청부터/);
});

test('control: the old unconditional sentence is gone', () => {
  // The pre-flag wording stated the flag-off start as the only behavior.
  assert.doesNotMatch(doc, /유지하고, 첫 인증된 profile\/context\/chat 요청부터 개인별 1시간 창을 시작한다\./);
});
