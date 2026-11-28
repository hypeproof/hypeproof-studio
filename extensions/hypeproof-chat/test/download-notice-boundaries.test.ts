import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  displayFileName,
  formatBytes,
  downloadDoneNotice,
  downloadFailedNotice,
  isDownloadNoticeLabel,
  downloadLineView,
} from '../src/browserDownloadNotice.ts';

test('test_tc_0214_display_file_name_cuts_at_80_and_falls_back', () => {
  assert.equal(displayFileName('a'.repeat(81)), 'a'.repeat(79) + '…');
  assert.equal(displayFileName('a'.repeat(80)), 'a'.repeat(80));
  assert.equal(displayFileName('‮\u0000 '), '이름 없는 파일');
  assert.equal(displayFileName(123), '이름 없는 파일');
  assert.equal(displayFileName('a‮b\u0000c'), 'abc');
});

test('test_tc_0215_format_bytes_switches_units_at_1024', () => {
  assert.equal(formatBytes(1023), '1023B');
  assert.equal(formatBytes(1024), '1.0KB');
  assert.equal(formatBytes(1048576), '1.0MB');
  assert.equal(formatBytes(1073741824), '1.0GB');
  assert.equal(formatBytes(-1), '크기 모름');
  assert.equal(formatBytes(Number.NaN), '크기 모름');
  assert.equal(formatBytes(Number.POSITIVE_INFINITY), '크기 모름');
});

test('test_tc_0216_failed_notice_prefix_follows_cause', () => {
  const blocked = downloadFailedNotice('a.txt', 'safe-session');
  const failed = downloadFailedNotice('a.txt', 'interrupted');
  assert.equal(blocked.state, 'error');
  assert.equal(failed.state, 'error');
  assert.ok(blocked.label.startsWith('다운로드 막힘: '));
  assert.ok(failed.label.startsWith('다운로드 실패: '));
  assert.ok(blocked.label.includes(' — 수업용 안전 브라우저'));
  assert.ok(failed.label.includes(' — 받는 중에 멈췄어요'));
});

test('test_tc_0217_notice_label_check_rejects_bad_lines', () => {
  const long = `다운로드 완료: downloads/${'a'.repeat(401)} (1B)`;
  assert.equal(isDownloadNoticeLabel(long, 'done'), false);
  assert.equal(isDownloadNoticeLabel('다운로드 완료: downloads/a\nb (1B)', 'done'), false);
  assert.equal(isDownloadNoticeLabel('다운로드 실패: x — y', 'done'), false);
  assert.equal(isDownloadNoticeLabel('다운로드 완료: downloads/x (1B)', 'error'), false);
  const ok = downloadDoneNotice('a.txt', 10);
  assert.equal(isDownloadNoticeLabel(ok.label, ok.state), true);
  const bad = downloadFailedNotice('a.txt', 'interrupted');
  assert.equal(isDownloadNoticeLabel(bad.label, bad.state), true);
});

test('test_tc_0218_line_view_splits_done_and_blocked_lines', () => {
  const done = downloadDoneNotice('a (1).txt', 2048);
  assert.deepEqual(downloadLineView(done.label, done.state), {
    kind: 'done',
    status: '다운로드 완료',
    name: 'a (1).txt',
    detail: '2.0KB',
  });
  const blocked = downloadFailedNotice('a.txt', 'safe-session');
  const view = downloadLineView(blocked.label, blocked.state);
  assert.equal(view?.kind, 'blocked');
  assert.equal(view?.name, 'a.txt');
  assert.equal(downloadLineView('다운로드 완료: downloads/a.txt', 'done'), null);
  assert.equal(downloadLineView('아무 줄', 'done'), null);
});
