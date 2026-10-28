// CGP-SHELL-R-028 (REQ-SHELL-28): "내 작업 내보내기" — one zip of the work folder and the local
// chat transcript, written to a folder the learner picks. vscode-free so tests drive it on disk.
//
// - Local only: no network, no Service, no token check, so it works offline and after a pass ends (AB-13).
// - The zip holds `작업 폴더/<relative path>` for every regular file, `대화/transcript.json`,
//   `대화/transcript.md` and `내보내기-안내.txt` (what was left out and why).
// - Left out: `.git`, `node_modules`, Studio's own `.hypeproof` records, symlinks (never followed),
//   hard links unless every name of the file is inside the folder, special files, names with control
//   or bidi characters, names with `\` or `:` (a path on Windows), files over FILE_MAX, credential
//   files by name, and any file whose bytes contain a known secret (UTF-8, UTF-16LE/BE or base64) or a
//   credential shape (provider key prefixes, Bearer, JWT, PEM private keys, token/secret/password keys).
// - The transcript keeps only the learner's and the AI's messages; known secrets and credential
//   shapes in them are replaced by "[가림]".
// - Known secrets are every value the extension keeps in SecretStorage (heldSecretValues).
// - Over TOTAL_MAX bytes or FILES_MAX files the export refuses as a whole; it never truncates silently.
// - The zip is created exclusively (`wx`): an existing file is never replaced.

import * as fs from 'node:fs';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { deflateRaw as deflateRawCb } from 'node:zlib';

const deflateRaw = promisify(deflateRawCb);

export const WORK_EXPORT_SKIP_DIRS: readonly string[] = ['.git', 'node_modules', '.hypeproof'];
export const WORK_EXPORT_LIMITS = { fileMax: 50 * 1024 * 1024, totalMax: 300 * 1024 * 1024, filesMax: 20_000 };
export const WORK_EXPORT_FOLDER = '작업 폴더';
export const WORK_EXPORT_REDACTED = '[가림]';

// Credential files by name: dotenv files (`.env`, `.env.local`, `prod.env`, `prod.env.local`), package and
// git credential files, cloud credential files (`.aws/credentials`), SSH keys, certificates and key stores.
const CREDENTIAL_NAME = /^(?:\.env(?:\..*)?|.+\.env(?:\..*)?|\.npmrc|\.netrc|\.pypirc|\.git-credentials|credentials(?:\.json)?|id_(?:rsa|dsa|ecdsa|ed25519)(?:\.pub)?|.*\.(?:pem|key|p12|pfx|keystore|jks))$/i;
// C0/C1 controls, U+2028/2029 and the bidi overrides/isolates.
const UNSAFE_NAME = /[\u0000-\u001f\u007f-\u009f\u2028-\u202e\u2066-\u2069]/u;
// A name another system reads as a path: `\` is a separator for Windows extractors, `:` starts a drive
// letter or an alternate data stream. Such a file is left out rather than renamed, so no zip entry escapes.
const UNSAFE_PATH = /[\\:]/;

// --- credential shapes ----------------------------------------------------------------------------
// Owner decision (fix 2): scan broadly and fail closed. Every file is searched, binaries included, and a
// match leaves the whole file out (listed in the notice). False positives are accepted; they are listed,
// never dropped silently. Raw shapes are replaced whole in the transcript.
const RAW_CREDENTIALS: readonly RegExp[] = [
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/g,
  /\bsk-ant-[A-Za-z0-9_-]{8,}/g,
  /\bsk-(?:proj-|svcacct-|admin-|live-|test-)?(?=[A-Za-z0-9_-]*\d)[A-Za-z0-9_-]{16,}/g,
  /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}(?![A-Za-z0-9])/g,
  /\bxox[abpsr]-[A-Za-z0-9-]{10,}/g,
  /\bAIza[0-9A-Za-z_-]{35}/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]*/g,
  // Studio's own token shapes (hps_…, hpa_…): a digit is required so identifiers like hps_request_id stay.
  /\bhp[a-z]_(?=[A-Za-z0-9_]*\d)[A-Za-z0-9_]{12,}/g,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  // URL userinfo: scheme://user:password@host.
  /\b[A-Za-z][A-Za-z0-9+.-]{1,20}:\/\/[^\s/:@"'<>]+:[^\s/@"'<>]+@/g,
  // An Authorization or Proxy-Authorization header, any scheme, to the end of the value.
  /(?<![A-Za-z0-9_-])(?:proxy-)?authorization["']?\s*[:=]\s*["']?(?:Basic|Bearer|Token|Digest|Negotiate|NTLM|ApiKey|AWS4-HMAC-SHA256)\s+[^\s"']{4,}[^\r\n"']*/gi,
  // Basic credentials outside a header: a base64 run with a digit, `+`, `/` or `=` ("Basic examples" stays).
  /\bBasic\s+(?=[A-Za-z0-9+/]*[0-9+/=])[A-Za-z0-9+/]{8,}={0,2}/g,
  // Cookie and Set-Cookie header values, to the end of the line.
  /(?<![A-Za-z0-9_.-])(?:set-)?cookie["']?\s*:\s*[^\r\n]{4,}/gi,
];

// Key/value pairs in env, JSON, YAML, INI and header form whose KEY contains secret, token, pass(wd|word),
// api_key/apikey/api-key, `_key`/`-key`, credential, cookie, session, auth or private (any case), ends in
// a camel-case `…Key`, or is `key` itself: `AWS_SECRET_ACCESS_KEY=…`, `aws_secret_access_key = …`,
// `{"OPENAI_KEY": "…"}`, `X-Api-Key: …`, `"token": "…"`. The key stays in the transcript; the value goes.
// Plain-code positive controls: `max_tokens: 1024` (a number under a count key), `type="password"` (the key
// is `type`), `password = input.value` and `token = getToken()` (a member access or a call is not a value),
// `apiKey = null`. Known false positives (left out and listed): `"author": "…"`-like keys are exempt, but
// e.g. `"session": "morning"` or `auth: AuthConfig` in a learner file count as credentials.
const SECRET_KEY_WORD = /secret|token|pass|api[_-]?key|[_-]key|credential|cookie|session|auth|private/i;
const NOT_SECRET_KEY = /^(?:author(?:s|[_-]?name|[_-]?email|[_-]?url)?|authorName|authorEmail)$/i;
const COUNT_KEY = /(?:tokens|count|max|min|limit|len|length|size|ttl|timeout|expires?(?:[_-]?in|[_-]?at)?|age|index|idx|port|version)$/i;
const VALUE_CHAR = String.raw`[^\s"'\x60,;{}\[\]()<>]`;
const VALUE_NO_DOT = String.raw`[^\s"'\x60,;{}\[\]()<>.]`;
const KEY_VALUE = new RegExp(
  String.raw`(?<![A-Za-z0-9_.-])(["']?)([A-Za-z_][A-Za-z0-9_.-]{0,63})\1[ \t]*[:=][ \t]*` +
  String.raw`("(?:[^"\\\r\n]|\\.){4,}"|'(?:[^'\\\r\n]|\\.){4,}'|\x60[^\x60\r\n]{4,}\x60|` +
  String.raw`(?!(?:null|true|false|undefined|none)(?![A-Za-z0-9_]))(?:(?=${VALUE_CHAR}*\d)${VALUE_CHAR}{6,}|${VALUE_NO_DOT}{8,})(?!${VALUE_CHAR})(?!\s*\())`, 'g');

function isSecretKey(key: string, value: string): boolean {
  if (NOT_SECRET_KEY.test(key)) return false;
  if (/^\d+$/.test(value) && COUNT_KEY.test(key)) return false;
  return /^key$/i.test(key) || SECRET_KEY_WORD.test(key) || /[a-z0-9]Key$/.test(key);
}

/** Every key/value credential in the text: [value start, value end] pairs. */
function keyValueHits(text: string): Array<[number, number]> {
  const hits: Array<[number, number]> = [];
  const re = new RegExp(KEY_VALUE.source, 'g');
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const value = m[3]!, start = m.index + m[0].length - value.length;
    if (isSecretKey(m[2]!, value.replace(/^["'\x60]|["'\x60]$/g, ''))) hits.push([start, start + value.length]);
    // Rescan from the value: `note: token=abc123def` hides a pair inside a value.
    else re.lastIndex = start;
  }
  return hits;
}

export type SkipReason = 'credential' | 'secret_name' | 'too_large' | 'symlink' | 'hardlink' | 'special' | 'unsafe_name' | 'unsafe_path' | 'unreadable';
export interface WorkExportFile { name: string; bytes: Buffer; mtime: Date }
export interface WorkExportCollection { files: WorkExportFile[]; skipped: { path: string; reason: SkipReason }[]; skippedDirs: string[] }
export interface TranscriptMessage { role: string; content: string; createdAt?: number }
export interface TranscriptTask { title: string; messages: readonly TranscriptMessage[] }
export class WorkExportTooLarge extends Error { constructor() { super('work_export_too_large'); } }

function usableSecrets(secrets: readonly string[]): string[] {
  // A very short value would match ordinary text; the tokens Studio holds are long.
  return [...new Set(secrets.filter(s => typeof s === 'string' && s.trim().length >= 8))];
}

/**
 * The base64 spellings of a secret that appear inside a longer base64 text, at each of the three byte
 * alignments: only the characters that depend on the secret's bytes alone are kept.
 */
export function base64Forms(secret: string): string[] {
  const bytes = Buffer.from(secret, 'utf8'), out = new Set<string>();
  for (let shift = 0; shift < 3; shift++) {
    const encoded = Buffer.concat([Buffer.alloc(shift), bytes]).toString('base64').replace(/=+$/, '');
    const head = shift === 0 ? 0 : shift + 1;
    const tail = (shift + bytes.length) % 3 === 0 ? 0 : 1;
    const stable = encoded.slice(head, encoded.length - tail);
    if (stable.length >= 8) { out.add(stable); out.add(stable.replace(/\+/g, '-').replace(/\//g, '_')); }
  }
  return [...out];
}

function utf16be(text: string): Buffer { const le = Buffer.from(text, 'utf16le'); return Buffer.from(le).swap16(); }

/** Byte spellings of each known secret matched in a file: UTF-8, UTF-16LE/BE and base64 (hex: knownPatterns). */
function secretNeedles(secrets: readonly string[]): Buffer[] {
  return usableSecrets(secrets).flatMap(secret => [Buffer.from(secret, 'utf8'), Buffer.from(secret, 'utf16le'), utf16be(secret),
    ...base64Forms(secret).map(form => Buffer.from(form, 'ascii'))]);
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');

/**
 * One pattern for all known secrets that also matches them split by whitespace or line breaks and with any
 * character percent-encoded (either case), and one for their hex spelling with whitespace allowed.
 */
const knownCache = new WeakMap<readonly string[], { plain?: RegExp; hex?: RegExp }>();
function knownPatterns(secrets: readonly string[]): { plain?: RegExp; hex?: RegExp } {
  const cached = knownCache.get(secrets);
  if (cached) return cached;
  const built = buildKnownPatterns(secrets);
  knownCache.set(secrets, built);
  return built;
}
function buildKnownPatterns(secrets: readonly string[]): { plain?: RegExp; hex?: RegExp } {
  const list = usableSecrets(secrets).sort((a, b) => b.length - a.length);
  if (!list.length) return {};
  const plain = list.map(secret => [...secret].map(ch => {
    const pct = [...Buffer.from(ch, 'utf8')].map(b => '%' + b.toString(16).padStart(2, '0').split('').map(d => /[a-f]/.test(d) ? `[${d}${d.toUpperCase()}]` : d).join('')).join('');
    return `(?:${escapeRe(ch)}|${pct})`;
  }).join(String.raw`\s*`)).join('|');
  const hex = list.map(secret => Buffer.from(secret, 'utf8').toString('hex').match(/../g)!.join(String.raw`\s*`)).join('|');
  return { plain: new RegExp(plain, 'g'), hex: new RegExp(hex, 'gi') };
}

function looksText(bytes: Buffer): boolean {
  return !bytes.subarray(0, 8192).includes(0);
}

function percentDecode(text: string): string {
  return text.replace(/(?:%[0-9A-Fa-f]{2})+/g, run => Buffer.from(run.replace(/%/g, ''), 'hex').toString('latin1'));
}
function hexRuns(text: string): string[] { return (text.match(/(?:[0-9A-Fa-f]{2}){8,}/g) ?? []).map(run => Buffer.from(run, 'hex').toString('latin1')); }
function base64Runs(text: string): string[] {
  return (text.match(/[A-Za-z0-9+/_-]{24,}={0,2}/g) ?? []).map(run => Buffer.from(run.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('latin1'));
}

function matchesRawShape(text: string): boolean {
  for (const re of RAW_CREDENTIALS) { re.lastIndex = 0; const hit = re.test(text); re.lastIndex = 0; if (hit) return true; }
  return false;
}
function matchesShapeOnce(text: string): boolean { return matchesRawShape(text) || keyValueHits(text).length > 0; }

/** A shape in the text itself, or in its percent-decoded, hex-decoded or base64-decoded runs. */
function matchesShape(text: string): boolean {
  if (matchesShapeOnce(text)) return true;
  if (/%[0-9A-Fa-f]{2}/.test(text) && matchesShapeOnce(percentDecode(text))) return true;
  return [...hexRuns(text), ...base64Runs(text)].some(matchesShapeOnce);
}

/**
 * The text views every file is searched in: UTF-8 for text; for bytes with a NUL (any binary: SQLite,
 * images, archives) latin1, so ASCII runs read as `strings` reads them, plus UTF-16 in both byte orders.
 */
function textViews(bytes: Buffer): string[] {
  if (looksText(bytes)) return [bytes.toString('utf8')];
  const even = bytes.subarray(0, bytes.length - (bytes.length % 2));
  return [bytes.toString('latin1'), even.toString('utf16le'), Buffer.from(even).swap16().toString('utf16le')];
}

function viewHasKnown(view: string, known: { plain?: RegExp; hex?: RegExp }): boolean {
  for (const re of [known.plain, known.hex]) { if (!re) continue; re.lastIndex = 0; const hit = re.test(view); re.lastIndex = 0; if (hit) return true; }
  return false;
}

/**
 * True when the bytes carry a known secret (UTF-8, UTF-16LE/BE, base64, hex, split by whitespace or
 * percent-encoded) or a credential shape in any text view of the bytes.
 */
export function carriesCredential(bytes: Buffer, secrets: readonly string[]): boolean {
  if (secretNeedles(secrets).some(needle => bytes.includes(needle))) return true;
  const known = knownPatterns(secrets);
  return textViews(bytes).some(view => viewHasKnown(view, known) || matchesShape(view));
}

/** A file or folder name that carries a known secret or a credential shape. */
export function nameCarriesCredential(name: string, secrets: readonly string[]): boolean {
  return carriesCredential(Buffer.from(name, 'utf8'), secrets);
}

export function redactCredentials(text: string, secrets: readonly string[]): string {
  let out = text;
  const known = knownPatterns(secrets);
  if (known.plain) out = out.replace(known.plain, WORK_EXPORT_REDACTED);
  if (known.hex) out = out.replace(known.hex, WORK_EXPORT_REDACTED);
  const forms = usableSecrets(secrets).flatMap(secret => base64Forms(secret));
  for (const form of [...new Set(forms)].sort((a, b) => b.length - a.length)) out = out.split(form).join(WORK_EXPORT_REDACTED);
  for (const re of RAW_CREDENTIALS) out = out.replace(re, WORK_EXPORT_REDACTED);
  // Encoded shapes: a percent-encoded, hex or base64 run whose decoding carries a credential.
  out = out.replace(/(?:%[0-9A-Fa-f]{2}|[A-Za-z0-9._~-])*%[0-9A-Fa-f]{2}(?:%[0-9A-Fa-f]{2}|[A-Za-z0-9._~-])*/g, run => matchesShapeOnce(percentDecode(run)) ? WORK_EXPORT_REDACTED : run);
  out = out.replace(/(?:[0-9A-Fa-f]{2}){8,}/g, run => matchesShapeOnce(Buffer.from(run, 'hex').toString('latin1')) ? WORK_EXPORT_REDACTED : run);
  out = out.replace(/[A-Za-z0-9+/_-]{24,}={0,2}/g, run => matchesShapeOnce(Buffer.from(run.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('latin1')) ? WORK_EXPORT_REDACTED : run);
  const hits = keyValueHits(out);
  for (let i = hits.length - 1; i >= 0; i--) { const [start, end] = hits[i]!; out = out.slice(0, start) + WORK_EXPORT_REDACTED + out.slice(end); }
  return out;
}

// --- what Studio holds ---------------------------------------------------------------------------

/** The part of VS Code's SecretStorage this module reads. */
export interface SecretReader { get(key: string): PromiseLike<string | undefined>; keys?(): PromiseLike<readonly string[]> }
const SECRET_FIELD = /token|secret|credential|password|passwd|key|auth|session|cookie|code|checkout/i;

/**
 * The values inside one stored secret: the value itself, and for a JSON record every string under a
 * credential-like field (an activity record's `token`, the account session's `accessToken` and
 * `refreshToken`, a pending order's `secret`). Names, paths and service addresses are not secrets.
 */
export function secretParts(value: string): string[] {
  const out = [value];
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { return out; }
  if (typeof parsed === 'string') { out.push(parsed); return out; }
  const visit = (node: unknown, field: string, depth: number): void => {
    if (depth > 8) return;
    if (typeof node === 'string') { if (SECRET_FIELD.test(field)) out.push(node); return; }
    if (Array.isArray(node)) { for (const item of node) visit(item, field, depth + 1); return; }
    if (node && typeof node === 'object') for (const [key, item] of Object.entries(node)) visit(item, key, depth + 1);
  };
  visit(parsed, '', 0);
  return out;
}

/**
 * Every secret value the extension holds: each named key plus every key SecretStorage lists (all
 * activity records, the personal account session, classroom-ops credentials, pending orders …).
 * A storage that cannot list its keys still yields the named ones.
 */
export async function heldSecretValues(readers: readonly SecretReader[], named: readonly string[]): Promise<string[]> {
  const out: string[] = [];
  for (const reader of readers) {
    const keys = new Set(named);
    try { if (reader.keys) for (const key of await reader.keys()) keys.add(key); } catch { /* the named keys still count */ }
    for (const key of keys) {
      let value: string | undefined;
      try { value = await reader.get(key); } catch { continue; }
      if (typeof value === 'string' && value) out.push(...secretParts(value));
    }
  }
  return [...new Set(out)];
}

/** A zip entry name no extractor can resolve outside its folder: relative, `/`-separated, no `.`/`..`, no `\` or drive. */
export function safeEntryName(name: string): boolean {
  if (!name || name.startsWith('/') || UNSAFE_PATH.test(name) || UNSAFE_NAME.test(name)) return false;
  return name.split('/').every(part => part !== '' && part !== '.' && part !== '..');
}

/**
 * Walk the work folder without following links. Returns what goes in the zip and what was left out.
 * Throws WorkExportTooLarge before reading past the limits.
 */
export async function collectWorkFolder(root: string, secrets: readonly string[], limits = WORK_EXPORT_LIMITS,
  onFile?: (count: number) => void): Promise<WorkExportCollection> {
  const base = await fs.promises.realpath(root);
  const files: WorkExportFile[] = [], skipped: WorkExportCollection['skipped'] = [], skippedDirs: string[] = [];
  const candidates: { rel: string; full: string; stat: fs.Stats }[] = [];
  // How many names of each multiply-linked inode the walk saw inside the folder.
  const linksInside = new Map<string, number>();
  const inode = (stat: fs.Stats) => `${stat.dev}:${stat.ino}`;
  let planned = 0, seen = 0;
  const walk = async (relDir: string): Promise<void> => {
    const entries = await fs.promises.readdir(path.join(base, relDir), { withFileTypes: true });
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (UNSAFE_NAME.test(entry.name)) { skipped.push({ path: rel, reason: 'unsafe_name' }); continue; }
      // A name that carries a secret is left out (a folder with everything in it) and listed without the name.
      if (nameCarriesCredential(entry.name, secrets)) { skipped.push({ path: rel, reason: 'secret_name' }); continue; }
      if (UNSAFE_PATH.test(entry.name)) { skipped.push({ path: rel, reason: 'unsafe_path' }); continue; }
      const full = path.join(base, rel);
      let stat: fs.Stats;
      try { stat = await fs.promises.lstat(full); } catch { skipped.push({ path: rel, reason: 'unreadable' }); continue; }
      if (stat.isSymbolicLink()) { skipped.push({ path: rel, reason: 'symlink' }); continue; }
      if (stat.isDirectory()) {
        if (WORK_EXPORT_SKIP_DIRS.includes(entry.name)) { skippedDirs.push(rel); continue; }
        await walk(rel);
        continue;
      }
      if (!stat.isFile()) { skipped.push({ path: rel, reason: 'special' }); continue; }
      if (stat.nlink > 1) linksInside.set(inode(stat), (linksInside.get(inode(stat)) ?? 0) + 1);
      if (CREDENTIAL_NAME.test(entry.name)) { skipped.push({ path: rel, reason: 'credential' }); continue; }
      if (stat.size > limits.fileMax) { skipped.push({ path: rel, reason: 'too_large' }); continue; }
      if (++seen > limits.filesMax || planned + stat.size > limits.totalMax) throw new WorkExportTooLarge();
      planned += stat.size;
      candidates.push({ rel, full, stat });
    }
  };
  await walk('');
  let total = 0;
  for (const { rel, full, stat } of candidates) {
    // A hard link is a second name for the same bytes. Unless every name of that file is inside this
    // folder (and not in a left-out folder), the bytes may belong somewhere else: leave it out.
    if (stat.nlink > 1 && linksInside.get(inode(stat)) !== stat.nlink) { skipped.push({ path: rel, reason: 'hardlink' }); continue; }
    let bytes: Buffer;
    try {
      // O_NOFOLLOW: a file swapped for a link after lstat is not read through the link.
      const handle = await fs.promises.open(full, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
      try {
        const now = await handle.stat();
        if (!now.isFile() || now.size > limits.fileMax) { skipped.push({ path: rel, reason: now.isFile() ? 'too_large' : 'special' }); continue; }
        // Swapped for another file, or linked from elsewhere since the walk: not the file that was counted.
        if (now.ino !== stat.ino || now.dev !== stat.dev) { skipped.push({ path: rel, reason: 'unreadable' }); continue; }
        if (now.nlink !== stat.nlink) { skipped.push({ path: rel, reason: 'hardlink' }); continue; }
        bytes = await handle.readFile();
      } finally { await handle.close(); }
    } catch { skipped.push({ path: rel, reason: 'unreadable' }); continue; }
    if (total + bytes.length > limits.totalMax) throw new WorkExportTooLarge();
    if (carriesCredential(bytes, secrets)) { skipped.push({ path: rel, reason: 'credential' }); continue; }
    total += bytes.length;
    files.push({ name: rel, bytes, mtime: stat.mtime });
    onFile?.(files.length);
  }
  return { files, skipped, skippedDirs };
}

function chatOnly(task: TranscriptTask, secrets: readonly string[]) {
  return {
    title: redactCredentials(String(task.title ?? ''), secrets),
    messages: task.messages.filter(m => m.role === 'user' || m.role === 'assistant').map(m => ({
      role: m.role as 'user' | 'assistant',
      content: redactCredentials(String(m.content ?? ''), secrets),
      ...(typeof m.createdAt === 'number' && Number.isFinite(m.createdAt) ? { createdAt: new Date(m.createdAt).toISOString() } : {}),
    })),
  };
}

/** `대화/transcript.json` and `대화/transcript.md`: the learner's and the AI's messages only. */
export function transcriptFiles(tasks: readonly TranscriptTask[], secrets: readonly string[], now: Date): WorkExportFile[] {
  const clean = tasks.map(task => chatOnly(task, secrets));
  const json = JSON.stringify({ format: 'hypeproof-studio-transcript/1', exportedAt: now.toISOString(), tasks: clean }, null, 2);
  const md = ['# 대화 기록', '', ...clean.flatMap(task => [
    `## ${task.title.replace(/[\r\n]+/g, ' ') || '이름 없는 작업'}`, '',
    ...(task.messages.length ? task.messages.flatMap(m => [`**${m.role === 'user' ? '나' : 'AI'}**${m.createdAt ? ` · ${m.createdAt}` : ''}`, '', m.content, '']) : ['(대화 없음)', '']),
  ])].join('\n');
  return [
    { name: '대화/transcript.json', bytes: Buffer.from(json + '\n', 'utf8'), mtime: now },
    { name: '대화/transcript.md', bytes: Buffer.from(md, 'utf8'), mtime: now },
  ];
}

const REASON: Record<SkipReason, string> = {
  credential: '비밀번호·토큰 같은 정보가 있을 수 있어요',
  too_large: '파일 하나가 50MB보다 커요',
  symlink: '다른 위치를 가리키는 연결 파일이에요',
  special: '일반 파일이 아니에요',
  unsafe_name: '이름에 보이지 않는 문자가 있어요',
  secret_name: '이름에 비밀번호·토큰 같은 정보가 있을 수 있어요',
  unsafe_path: '이름에 \\ 또는 : 가 있어서 다른 컴퓨터에서 풀면 폴더 밖으로 나갈 수 있어요',
  hardlink: '작업 폴더 밖의 파일과 이어진 파일이에요',
  unreadable: '읽을 수 없었어요',
};

/** Plain-text notice inside the zip. Paths are JSON-quoted so a hostile name cannot fake a line. */
export function exportNotice(collection: WorkExportCollection, taskCount: number, now: Date): WorkExportFile {
  const lines = [
    'HypeProof Studio · 내 작업 내보내기', `만든 시각: ${now.toISOString()}`, '',
    `${WORK_EXPORT_FOLDER}/ 에 작업 폴더의 파일 ${collection.files.length}개가 들어 있어요.`,
    `대화/ 에 대화 ${taskCount}개의 기록이 들어 있어요 (transcript.json, transcript.md). 비밀 정보로 보이는 부분은 ${WORK_EXPORT_REDACTED}로 바꿨어요.`,
    '', '넣지 않은 것:', `- 폴더: ${WORK_EXPORT_SKIP_DIRS.join(', ')} (버전 기록, 설치된 패키지, Studio 내부 기록)`,
  ];
  for (const item of collection.skipped.slice(0, 500)) {
    lines.push(`- ${item.reason === 'unsafe_name' || item.reason === 'secret_name' ? '(이름을 표시하지 않음)' : JSON.stringify(item.path)}: ${REASON[item.reason]}`);
  }
  if (collection.skipped.length > 500) lines.push(`- 그 밖에 ${collection.skipped.length - 500}개`);
  lines.push('', '원본 파일은 그대로 있어요.');
  return { name: '내보내기-안내.txt', bytes: Buffer.from(lines.join('\n') + '\n', 'utf8'), mtime: now };
}

// --- zip (PKZIP 2.0, deflate or store, UTF-8 names) -----------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; }
  return table;
})();
export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function dosTime(d: Date): { time: number; date: number } {
  const year = Math.min(Math.max(d.getFullYear(), 1980), 2107);
  return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() };
}

export async function buildZip(files: readonly WorkExportFile[]): Promise<Buffer> {
  if (files.length > 0xffff) throw new WorkExportTooLarge();
  const locals: Buffer[] = [], centrals: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    // Last guard: every entry name stays inside the folder it is unzipped into, on any system.
    if (!safeEntryName(file.name.normalize('NFC'))) throw new Error('work_export_unsafe_name');
    const name = Buffer.from(file.name.normalize('NFC'), 'utf8');
    const crc = crc32(file.bytes);
    const packed = await deflateRaw(file.bytes);
    const method = packed.length < file.bytes.length ? 8 : 0;
    const data = method === 8 ? packed : file.bytes;
    const { time, date } = dosTime(file.mtime);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10); local.writeUInt16LE(date, 12); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18); local.writeUInt32LE(file.bytes.length, 22); local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(0x0314, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10); central.writeUInt16LE(time, 12); central.writeUInt16LE(date, 14); central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20); central.writeUInt32LE(file.bytes.length, 24); central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE((0o100644 << 16) >>> 0, 38); central.writeUInt32LE(offset, 42);
    locals.push(local, name, data);
    centrals.push(central, name);
    offset += local.length + name.length + data.length;
    if (offset > 0xffffffff) throw new WorkExportTooLarge();
  }
  const dir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}

// --- destination ------------------------------------------------------------------------------

function two(n: number): string { return String(n).padStart(2, '0'); }

/** `내-작업-<folder>-20261026-153012.zip`; the folder part is cleaned and capped. It is also shown in the export
 *  result line (DES-SHELL-27), so bidi marks and zero-width characters go with the controls. */
export function workExportName(root: string, now: Date, secrets: readonly string[] = []): string {
  // A folder name that carries a secret does not go into the zip's file name.
  const base = nameCarriesCredential(path.basename(root), secrets) ? '' : path.basename(root);
  const folder = base.normalize('NFKC').replace(/[\u0000-\u001f\u007f-\u009f\u061c\u200b\u200e\u200f\u2028-\u202e\u2060\u2066-\u2069\ufeff]/gu, '')
    .replace(/[\\/:*?"<>|]+/g, '-').replace(/^[.\s-]+|[.\s-]+$/g, '').slice(0, 40);
  const stamp = `${now.getFullYear()}${two(now.getMonth() + 1)}${two(now.getDate())}-${two(now.getHours())}${two(now.getMinutes())}${two(now.getSeconds())}`;
  return ['내-작업', folder, stamp].filter(Boolean).join('-') + '.zip';
}

/** Kernel-resolved containment: is `inner` the same as or below `outer`? */
export function isInside(outer: string, inner: string): boolean {
  const rel = path.relative(outer, inner);
  return !rel || (rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel));
}

/** Write without ever replacing a file: `name.zip`, then `name-2.zip` … Returns the path written. */
export async function writeExclusive(directory: string, name: string, bytes: Buffer): Promise<string> {
  const ext = path.extname(name), stem = name.slice(0, name.length - ext.length);
  for (let n = 1; n <= 50; n++) {
    const target = path.join(directory, n === 1 ? name : `${stem}-${n}${ext}`);
    let handle: fs.promises.FileHandle;
    try { handle = await fs.promises.open(target, 'wx'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue; throw error; }
    try { await handle.writeFile(bytes); await handle.close(); return target; }
    catch (error) { await handle.close().catch(() => undefined); await fs.promises.unlink(target).catch(() => undefined); throw error; }
  }
  throw new Error('work_export_name_taken');
}

export interface WorkExportResult { file: string; files: number; tasks: number; skipped: number }

/** Collect, zip and write. `current()` is checked after the slow part, before anything is written. */
export async function exportWork(input: { root: string; destination: string; secrets: readonly string[]; tasks: readonly TranscriptTask[];
  now?: Date; limits?: typeof WORK_EXPORT_LIMITS; current?: () => boolean; onFile?: (count: number) => void }): Promise<WorkExportResult | 'stale'> {
  const now = input.now ?? new Date();
  const root = await fs.promises.realpath(input.root), destination = await fs.promises.realpath(input.destination);
  if (isInside(root, destination)) throw new Error('work_export_destination_inside');
  const collection = await collectWorkFolder(root, input.secrets, input.limits, input.onFile);
  const entries = [
    ...collection.files.map(file => ({ ...file, name: `${WORK_EXPORT_FOLDER}/${file.name}` })),
    ...transcriptFiles(input.tasks, input.secrets, now),
    exportNotice(collection, input.tasks.length, now),
  ];
  const zip = await buildZip(entries);
  if (input.current && !input.current()) return 'stale';
  if (await fs.promises.realpath(input.destination) !== destination) return 'stale';
  const file = await writeExclusive(destination, workExportName(root, now, input.secrets), zip);
  return { file, files: collection.files.length, tasks: input.tasks.length, skipped: collection.skipped.length };
}
