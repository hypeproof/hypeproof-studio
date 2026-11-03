// CGP-KNOW-R-035: explicit, local, copy-only takeaway. No activity credentials or runtime state.
import * as fs from 'node:fs';
import { createHash } from 'node:crypto';
import type { ProvenanceLedger } from './artifactProvenance';
import * as path from 'node:path';
import { outboundLabel, memoryOutboundPath } from './outboundConsent.ts';

export interface TakeawayItem {
  label: string;
  category: '파일' | '작업' | '팀 브레인' | '남는 것';
  bytes?: Buffer;
  extension?: string;
  relativePath?: string;
  reason: string;
}
export interface TakeawayResult { label: string; status: '옮김' | '실패' | '제외'; reason: string }
export const TAKEAWAY_EXCLUSIONS: TakeawayItem[] = ['수업 자료', '강사 메모', '수업 기억', '참여 코드·로그인 정보·AI 실행 세션'].map(label => ({
  label, category: '남는 것', reason: '이 활동에만 속하는 정보라 가져가지 않아요.',
}));
const MAX_BYTES = 10 * 1024 * 1024;
const forbidden = /(^|[/\\])(?:[.]|node_modules(?:$|[/\\])|materials?(?:$|[/\\])|instructor[^/\\]*|class[-_ ]?memory[^/\\]*|수업 자료|강사 메모|수업 기억)|(?:credential|secret|token|password|id_rsa|id_ed25519)/i;
const safeExtension = /[.](?:txt|md|html|css|js|ts|tsx|jsx|csv|svg|png|jpg|jpeg|webp|gif|pdf)$/i;

/** Refuse unclassified configuration and links; capture exactly the bytes the preview names. */
export function takeawayFile(root: string, file: string, wikiDirectory = 'wiki', secrets: readonly string[] = [], owned: Readonly<Record<string, string>> = {}): TakeawayItem {
  const relative = path.relative(root, file);
  const label = outboundLabel(relative);
  const category = relative.split(path.sep)[0] === wikiDirectory ? '팀 브레인' : '파일';
  const excluded = (reason: string): TakeawayItem => ({ label, category, reason });
  const normalized = relative.normalize('NFKC');
  if (!relative || path.isAbsolute(relative) || relative === '..' || relative.startsWith('..' + path.sep)
      || /[\u0000-\u001f\u007f-\u009f\u2028-\u202e\u2066-\u2069]/u.test(relative)
      || forbidden.test(normalized) || (category !== '팀 브레인' && memoryOutboundPath(normalized)) || !safeExtension.test(normalized)) return excluded('가져갈 수 없는 경로나 파일 종류예요.');
  try {
    let current = root;
    if (fs.realpathSync(root) !== path.resolve(root)) return excluded('폴더 연결을 확인해 주세요.');
    for (const segment of relative.split(path.sep)) {
      current = path.join(current, segment);
      if (fs.lstatSync(current).isSymbolicLink()) return excluded('연결 파일은 가져가지 않아요.');
    }
    const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      const stat = fs.fstatSync(fd);
      if (!stat.isFile() || stat.size > MAX_BYTES) return excluded('일반 파일 10MB 이하만 가져갈 수 있어요.');
      const bytes = fs.readFileSync(fd);
      if (owned[relative.split(path.sep).join('/')] !== createHash('sha256').update(bytes).digest('hex')) return excluded('내 작업에서 만든 파일인지 확인되지 않아 가져가지 않아요.');
      if (bytes.length > MAX_BYTES || containsCredentials(bytes, secrets)) return excluded('자격 정보가 있을 수 있어 가져가지 않아요.');
      return { label, category, bytes, extension: path.extname(file).toLowerCase(), relativePath: relative, reason: '선택한 파일의 사본을 만들어요. 원본은 그대로 남아요.' };
    } finally { fs.closeSync(fd); }
  } catch { return excluded('파일을 읽을 수 없어요. 원본 위치와 권한을 확인해 주세요.'); }
}

function containsCredentials(bytes: Buffer, secrets: readonly string[]): boolean {
  const text = bytes.toString('utf8');
  return secrets.some(secret => secret.length > 0 && text.includes(secret))
    || /(?:Bearer\s+[A-Za-z0-9._~-]+|-----BEGIN [A-Z ]*PRIVATE KEY-----|(?:api[_-]?key|access[_-]?token|password)[\"\']?\s*[=:]\s*\S+)/i.test(text);
}

/** A readable task copy, never system/tool instructions, SDK state or credentials. */
export function takeawayTask(title: string, messages: readonly { role: string; content: string }[], secrets: readonly string[] = []): TakeawayItem {
  const label = outboundLabel(title);
  const bytes = Buffer.from(messages.filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => `${m.role === 'user' ? '나' : 'AI'}\n${m.content}`).join('\n\n'), 'utf8');
  if (!bytes.length || bytes.length > MAX_BYTES || containsCredentials(bytes, secrets))
    return { label, category: '작업', reason: '비어 있거나 너무 크거나 자격 정보가 있을 수 있어 가져가지 않아요.' };
  return { label, category: '작업', bytes, extension: '.txt', reason: '대화를 읽을 수 있는 사본으로 가져가요. AI 실행 세션은 이어지지 않아요.' };
}

export function takeawayPreview(items: readonly TakeawayItem[]): string {
  return ['가져가는 것 (사본):', ...items.filter(i => i.bytes).map(i => `${i.category} · ${i.label} · ${i.bytes!.length}바이트 — ${i.reason}`),
    '', '남는 것:', ...items.filter(i => !i.bytes).map(i => `${i.label} — ${i.reason}`),
    '', '원본은 삭제하지 않아요. 가져간 작업은 읽기용 사본이며 AI 이용 권한은 옮겨지지 않아요.'].join('\n');
}

/** One fresh directory per invocation; exclusive writes cannot replace another window's files. */
export function writeTakeaway(destination: string, items: readonly TakeawayItem[], current: () => boolean): { directory: string; results: TakeawayResult[] } {
  let directory: string;
  try { directory = fs.mkdtempSync(path.join(fs.realpathSync(destination), '내-작업-')); }
  catch { return { directory: destination, results: items.map(item => ({ label: item.label, status: item.bytes ? '실패' : '제외', reason: item.bytes ? '사본 폴더를 만들지 못했어요. 원본은 그대로 있어요.' : item.reason })) }; }
  const results = items.map((item, index): TakeawayResult => {
    if (!item.bytes) return { label: item.label, status: '제외', reason: item.reason };
    try {
      if (!current()) throw new Error('activity_changed');
      const output = item.relativePath ?? path.join('작업-기록', `${index + 1}${item.extension ?? '.txt'}`);
      const target = path.join(directory, output);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, item.bytes, { flag: 'wx', mode: 0o600 });
      return { label: item.label, status: '옮김', reason: `${outboundLabel(output)}에 사본을 저장했어요. 원본은 그대로 있어요.` };
    } catch { return { label: item.label, status: '실패', reason: '사본을 저장하지 못했어요. 원본은 그대로 있어요. 위치와 권한을 확인하고 다시 시도해 주세요.' }; }
  });
  return { directory, results };
}

/** Origin must be an observed learner upload or AI creation, never an imported class resource. */
export function takeawayOwnedFiles(ledger: ProvenanceLedger): Record<string, string> {
  if (ledger.stale) return {};
  const origins = new Map<string, boolean>();
  const latest = new Map<string, string>();
  for (const event of ledger.events) {
    if (event.kind === 'removed') { origins.delete(event.path); latest.delete(event.path); continue; }
    if (!origins.has(event.path)) origins.set(event.path, event.kind === 'ai_created' || event.kind === 'learner_uploaded');
    if (!['ai_created', 'ai_changed', 'learner_uploaded'].includes(event.kind)) origins.set(event.path, false);
    if (event.sha256) latest.set(event.path, event.sha256);
  }
  return Object.fromEntries([...latest].filter(([file]) => origins.get(file) && !ledger.stalePaths?.includes(file)));
}
