import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { readWorkspaceTextFile, FILE_ATTACH_MAX_BYTES, FILE_ATTACH_MAX_CHARS } from '../src/fileAttachment.ts';
import { FILE_REFUSAL_COPY } from '../src/fileAttachment.ts';
import { attachmentReadFailure, attachmentDisplayName, withAttachmentDeadline, ATTACHMENT_FAILURE_COPY } from '../src/attachmentFailure.ts';
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'attachment-failure-'));
try {
  const read = (name, bytes) => { const file = path.join(root, name); fs.writeFileSync(file, bytes); return readWorkspaceTextFile(root, file); };
  const empty = read('empty.txt', '');
  const blank = read('blank.txt', ' \n\t');
  assert.equal(empty.cause, 'empty'); assert.equal(blank.cause, 'empty-text');
  assert.notEqual(empty.reason, blank.reason);
  assert.equal(read('large.txt', 'x'.repeat(FILE_ATTACH_MAX_BYTES + 1)).cause, 'too-large');
  assert.equal(read('long.txt', 'x'.repeat(FILE_ATTACH_MAX_CHARS + 1)).cause, 'too-many-chars');
  assert.equal(read('unsupported.bin', Buffer.from([0, 255])).cause, 'binary');
  assert.equal(attachmentReadFailure({ code: 'EACCES' }), ATTACHMENT_FAILURE_COPY.permission);
  assert.equal(attachmentReadFailure({ name: 'SecurityError' }), ATTACHMENT_FAILURE_COPY.permission);
  assert.equal(attachmentReadFailure({ code: 'ETIMEDOUT' }), ATTACHMENT_FAILURE_COPY.timeout);
  // Exact learner copy per cause (literal strings on purpose: a swapped or generic message must fail).
  const copy = (e) => attachmentReadFailure(e);
  assert.equal(copy({ code: 'COUNT' }), '이미지는 한 번에 4장까지 붙일 수 있어요. 다른 이미지를 뺀 뒤 다시 시도해 주세요.');
  assert.equal(copy({ code: 'EMPTY' }), '빈 파일이에요. 내용을 저장한 뒤 이 파일만 다시 시도해 주세요.');
  assert.equal(copy({ code: 'ETIMEDOUT' }), '파일을 읽는 시간이 너무 길어졌어요. 파일이 있는 기기나 연결을 확인한 뒤 다시 시도해 주세요.');
  assert.equal(copy({ code: 'EACCES' }), '파일을 읽을 권한이 없어요. 파일 접근 권한을 확인한 뒤 다시 시도해 주세요.');
  assert.equal(copy(new Error('attachment_too_large')), '붙여 넣은 이미지가 너무 커요. 12MB 이하로 줄이거나 파일로 골라 다시 붙여 주세요.');
  assert.equal(copy(new Error('attachment_format')), '붙여 넣은 이미지를 읽을 수 없는 형식이에요. png·jpg 이미지로 다시 붙여 주세요.');
  assert.equal(copy(new Error('attachment_unavailable')), '지금은 이미지를 붙일 수 없어요. 연결이나 작업 전환이 끝난 뒤 이 파일만 다시 시도해 주세요.');
  assert.equal(copy(new Error('missing_stage')), '사진 준비 기록이 없어요. 이 사진을 빼고 다시 골라 주세요.');
  assert.equal(copy({ code: 'ENOSPC' }), '저장 공간이 부족해서 사진을 저장하지 못했어요. 공간을 비운 뒤 이 파일만 다시 시도해 주세요.');
  assert.equal(copy({ code: 'EDQUOT' }), '저장 용량 한도에 닿아 사진을 저장하지 못했어요. 용량을 확보한 뒤 이 파일만 다시 시도해 주세요.');
  assert.equal(copy({ code: 'ENOENT' }), '파일을 찾을 수 없어요. 파일이 옮겨지거나 지워졌는지 확인하고, 이 파일을 빼고 다시 골라 주세요.');
  assert.equal(copy({ code: 'EROFS' }), '이 폴더는 읽기 전용이라 사진을 저장할 수 없어요. 쓰기 가능한 폴더에서 다시 시도해 주세요.');
  assert.equal(copy({ code: 'EBUSY' }), '파일이 다른 앱에서 쓰이고 있는 것 같아요. 그 앱에서 닫은 뒤 다시 시도해 주세요.');
  assert.equal(copy(new Error('Prepared photo changed')), '준비해 둔 사진이 바뀌었어요. 이 사진을 빼고 다시 골라 주세요.');
  assert.equal(copy(new Error('Photo destination changed during commit')), '사진을 저장하는 중에 폴더가 바뀌었어요. 폴더를 확인한 뒤 이 파일만 다시 시도해 주세요.');
  assert.equal(copy(new Error('boom')), '파일을 읽지 못했어요. 잠시 뒤 이 파일만 다시 시도하거나, 빼고 다시 붙여 주세요.');
  // The "open it in another app" advice is true only for a busy file.
  const all = [{ code: 'COUNT' }, { code: 'EMPTY' }, { code: 'ETIMEDOUT' }, { code: 'EACCES' }, { code: 'ENOSPC' }, { code: 'EDQUOT' }, { code: 'ENOENT' }, { code: 'EROFS' }, new Error('attachment_too_large'), new Error('attachment_format'), new Error('attachment_unavailable'), new Error('missing_stage'), new Error('Prepared photo changed'), new Error('Photo destination changed during commit'), new Error('boom')];
  for (const e of all) assert.ok(!copy(e).includes('다른 앱'), 'only a busy file mentions another app: ' + JSON.stringify(e));
  assert.equal(new Set([...all, { code: 'EBUSY' }].map(copy)).size, all.length + 1, 'every cause has its own message');
  // Unsupported format and too-large for text files keep their own copy.
  assert.equal(ATTACHMENT_FAILURE_COPY.unsupported, '지원하지 않는 파일 형식이에요. 글자는 txt·md 파일로, 사진은 jpg·png 파일로 바꿔 붙여 주세요.');
  assert.equal(ATTACHMENT_FAILURE_COPY.emptyText, '파일에 읽을 글자가 없어요. 글자를 넣어 저장한 뒤 다시 시도해 주세요.');
  assert.equal(FILE_REFUSAL_COPY['too-large'], '파일이 너무 커요(100KB까지). 필요한 부분만 새 파일로 나눠서 붙여 주세요.');
  assert.equal(FILE_REFUSAL_COPY['too-many-chars'], `글자가 너무 많아요(${FILE_ATTACH_MAX_CHARS.toLocaleString('en-US')}자까지). 필요한 부분만 새 파일로 나눠서 붙여 주세요.`);
  assert.equal(FILE_REFUSAL_COPY.empty, '빈 파일이에요. 내용을 저장한 뒤 이 파일만 다시 시도해 주세요.');
  assert.equal(FILE_REFUSAL_COPY.timeout, '파일을 읽는 시간이 너무 길어졌어요. 파일이 있는 기기나 연결을 확인한 뒤 다시 시도해 주세요.');
  assert.equal(read('unsupported.bin', Buffer.from([0, 255])).reason, '글자로 된 파일(.txt, .md, .html 같은 파일)만 붙일 수 있어요. 사진은 이미지 첨부로 보내 주세요.');
  assert.equal(read('large.txt', 'x'.repeat(FILE_ATTACH_MAX_BYTES + 1)).reason, FILE_REFUSAL_COPY['too-large']);
  await assert.rejects(withAttachmentDeadline(new Promise(() => {}), 5), { name: 'TimeoutError' });
  assert.equal(await withAttachmentDeadline(Promise.resolve('success'), 100), 'success');
  assert.equal(attachmentDisplayName('\u202Ebad\nname'), ' bad name');
  assert.ok(attachmentDisplayName('a'.repeat(500)).length <= 160);
  console.log('attachment failure: distinct causes, actual timeout, safe name and success PASS');
} finally { fs.rmSync(root, { recursive:true, force:true }); }
