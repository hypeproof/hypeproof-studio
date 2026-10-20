/** CGP-KNOW-R-020: shared data-only failures. No parser claims for unsupported documents. */
/** `final`: no retry can help (a count limit); the row only offers removal. */
export interface AttachmentFailure { id: string; name: string; reason: string; final?: boolean }
export const ATTACHMENT_READ_TIMEOUT = 15_000;
export const ATTACHMENT_FAILURE_COPY = {
  empty: '빈 파일이에요. 내용을 저장한 뒤 이 파일만 다시 시도해 주세요.',
  emptyText: '파일에 읽을 글자가 없어요. 글자를 넣어 저장한 뒤 다시 시도해 주세요.',
  timeout: '파일을 읽는 시간이 너무 길어졌어요. 파일이 있는 기기나 연결을 확인한 뒤 다시 시도해 주세요.',
  permission: '파일을 읽을 권한이 없어요. 파일 접근 권한을 확인한 뒤 다시 시도해 주세요.',
  unsupported: '지원하지 않는 파일 형식이에요. 글자는 txt·md 파일로, 사진은 jpg·png 파일로 바꿔 붙여 주세요.',
  unreadable: '파일을 읽지 못했어요. 잠시 뒤 이 파일만 다시 시도하거나, 빼고 다시 붙여 주세요.',
  busy: '파일이 다른 앱에서 쓰이고 있는 것 같아요. 그 앱에서 닫은 뒤 다시 시도해 주세요.',
  count: '이미지는 한 번에 4장까지 붙일 수 있어요. 다른 이미지를 뺀 뒤 다시 시도해 주세요.',
  tooLarge: '붙여 넣은 이미지가 너무 커요. 12MB 이하로 줄이거나 파일로 골라 다시 붙여 주세요.',
  badFormat: '붙여 넣은 이미지를 읽을 수 없는 형식이에요. png·jpg 이미지로 다시 붙여 주세요.',
  unavailable: '지금은 이미지를 붙일 수 없어요. 연결이나 작업 전환이 끝난 뒤 이 파일만 다시 시도해 주세요.',
  missingStage: '사진 준비 기록이 없어요. 이 사진을 빼고 다시 골라 주세요.',
  diskFull: '저장 공간이 부족해서 사진을 저장하지 못했어요. 공간을 비운 뒤 이 파일만 다시 시도해 주세요.',
  quota: '저장 용량 한도에 닿아 사진을 저장하지 못했어요. 용량을 확보한 뒤 이 파일만 다시 시도해 주세요.',
  notFound: '파일을 찾을 수 없어요. 파일이 옮겨지거나 지워졌는지 확인하고, 이 파일을 빼고 다시 골라 주세요.',
  readOnly: '이 폴더는 읽기 전용이라 사진을 저장할 수 없어요. 쓰기 가능한 폴더에서 다시 시도해 주세요.',
  photoChanged: '준비해 둔 사진이 바뀌었어요. 이 사진을 빼고 다시 골라 주세요.',
  destinationChanged: '사진을 저장하는 중에 폴더가 바뀌었어요. 폴더를 확인한 뒤 이 파일만 다시 시도해 주세요.',
  tooMany: '파일이 너무 많아요. 수를 줄여 주세요.',
} as const;
export function attachmentReadFailure(error: unknown): string {
  const e = error as { code?: string; name?: string; message?: string } | null;
  const message = typeof e?.message === 'string' ? e.message : '';
  if (e?.code === 'COUNT') return ATTACHMENT_FAILURE_COPY.count;
  if (e?.code === 'EMPTY') return ATTACHMENT_FAILURE_COPY.empty;
  if (e?.code === 'ETIMEDOUT' || e?.name === 'TimeoutError') return ATTACHMENT_FAILURE_COPY.timeout;
  if (e?.code === 'EACCES' || e?.code === 'EPERM' || e?.name === 'NotAllowedError' || e?.name === 'SecurityError' || e?.name === 'NoPermissions') return ATTACHMENT_FAILURE_COPY.permission;
  if (e?.code === 'ENOSPC') return ATTACHMENT_FAILURE_COPY.diskFull;
  if (e?.code === 'EDQUOT') return ATTACHMENT_FAILURE_COPY.quota;
  if (e?.code === 'ENOENT') return ATTACHMENT_FAILURE_COPY.notFound;
  if (e?.code === 'EROFS') return ATTACHMENT_FAILURE_COPY.readOnly;
  if (e?.code === 'EBUSY' || e?.code === 'ETXTBSY') return ATTACHMENT_FAILURE_COPY.busy;
  if (message === 'attachment_too_large') return ATTACHMENT_FAILURE_COPY.tooLarge;
  if (message === 'attachment_format') return ATTACHMENT_FAILURE_COPY.badFormat;
  if (message === 'attachment_unavailable') return ATTACHMENT_FAILURE_COPY.unavailable;
  if (message === 'missing_stage') return ATTACHMENT_FAILURE_COPY.missingStage;
  if (message === 'Prepared photo changed') return ATTACHMENT_FAILURE_COPY.photoChanged;
  if (message.startsWith('Photo destination')) return ATTACHMENT_FAILURE_COPY.destinationChanged;
  return ATTACHMENT_FAILURE_COPY.unreadable;
}
export function attachmentDisplayName(name: string): string {
  return name.normalize('NFC').replace(/[\x00-\x1f\x7f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g, ' ').slice(0, 160) || '파일';
}
/** Bound an asynchronous preparation operation. A late completion cannot resolve the timed-out attempt. */
export function withAttachmentDeadline<T>(promise: Promise<T>, ms = ATTACHMENT_READ_TIMEOUT): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Object.assign(new Error('attachment timeout'), { name: 'TimeoutError' })), ms);
    promise.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
  });
}
