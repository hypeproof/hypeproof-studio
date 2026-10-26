// CGP-SHELL-R-028 (REQ-SHELL-28): "내 작업 내보내기" writes one zip of the work folder and the local
// transcript to a folder the learner picks. Real disk fixtures, a real zip read back by an independent
// reader in this file (central directory → local header → inflate → CRC), and the real provider.
// Checked: .git / node_modules / .hypeproof left out at any depth, credential files and files carrying a
// known secret left out, symlinks never followed, hostile names not listed, transcript keeps only the
// learner's and the AI's messages with secrets redacted (grep over every inflated byte), works with the
// network gone and no token, never replaces an existing file, refuses a destination inside the work
// folder, refuses past the size cap without writing, refuses while a turn runs, and stops when the turn
// scope changes before writing.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
import { exportWork, collectWorkFolder, WorkExportTooLarge, WORK_EXPORT_LIMITS, workExportName, buildZip, heldSecretValues, redactCredentials, base64Forms } from '../src/workExport.ts';
import { createTaskHarness } from './task-workspace-harness.mjs';

const require = createRequire(import.meta.url);
const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'work-export-')));
const TOKEN = 'hps_student_token_9f8e7d6c5b4a';
const ACTIVITY_TOKEN = 'hps_activity_token_1a2b3c4d5e';

/** Independent zip reader: EOCD → central directory → local headers; inflates and checks CRC-32. */
function readZip(file) {
  const buf = fs.readFileSync(file);
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(eocd >= 0, 'end of central directory');
  const count = buf.readUInt16LE(eocd + 10), size = buf.readUInt32LE(eocd + 12), offset = buf.readUInt32LE(eocd + 16);
  assert.equal(offset + size, eocd, 'central directory ends at EOCD');
  const entries = new Map();
  let p = offset;
  for (let i = 0; i < count; i++) {
    assert.equal(buf.readUInt32LE(p), 0x02014b50, 'central header');
    const flags = buf.readUInt16LE(p + 8), method = buf.readUInt16LE(p + 10), crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24), nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nlen).toString('utf8');
    assert.ok(flags & 0x0800, 'UTF-8 name flag for ' + name);
    assert.equal(buf.readUInt32LE(local), 0x04034b50, 'local header');
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + csize);
    const bytes = method === 8 ? zlib.inflateRawSync(raw) : method === 0 ? Buffer.from(raw) : assert.fail('method ' + method);
    assert.equal(bytes.length, usize, 'size of ' + name);
    assert.equal(zlib.crc32(bytes), crc, 'crc of ' + name);
    assert.ok(!name.startsWith('/') && !name.split('/').includes('..'), 'no escaping name: ' + name);
    entries.set(name, bytes);
    p += 46 + nlen + xlen + clen;
  }
  return entries;
}
const put = (root, rel, content) => { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, content); };
function fixture(name) {
  const root = path.join(base, name);
  put(root, 'index.html', '<!doctype html><title>꽃집</title><input type="password" name="pw">');
  put(root, 'style.css', 'body{color:red}');
  put(root, '한글 이름.txt', '안녕하세요');
  put(root, 'sub/dir/app.js', 'console.log(1)');
  put(root, 'images/logo.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 1, 2, 3]));
  put(root, '.git/config', '[core] git-internal');
  put(root, 'node_modules/pkg/index.js', 'module.exports = "installed";');
  put(root, 'sub/node_modules/deep.js', 'nested-installed');
  put(root, '.hypeproof/history/index-20261026-101010.html', 'studio-internal-record');
  put(root, '.env', 'OPENAI_KEY=abc');
  put(root, 'certs/server.pem', 'pem-bytes');
  put(root, 'notes/leak.txt', 'my token is ' + TOKEN);
  put(root, 'notes/activity.txt', 'activity ' + ACTIVITY_TOKEN);
  put(root, 'config.js', "const api_key = 'sk-live-xyzw1234';");
  put(root, 'evil\u202etxt.html', 'bidi-name');
  put(base, 'outside/secret.txt', 'outside-the-folder');
  fs.symlinkSync(path.join(base, 'outside/secret.txt'), path.join(root, 'link.txt'));
  fs.symlinkSync(path.join(base, 'outside'), path.join(root, 'linkdir'));
  return root;
}
const EXPECTED_FILES = ['작업 폴더/config.js', '작업 폴더/images/logo.png', '작업 폴더/index.html', '작업 폴더/style.css', '작업 폴더/sub/dir/app.js', '작업 폴더/한글 이름.txt'];
const TASKS = [
  { title: '꽃집 홈페이지', messages: [
    { role: 'user', content: '꽃집 홈페이지를 만들어줘', createdAt: Date.UTC(2026, 9, 26, 1, 0, 0) },
    { role: 'system', content: 'class-secret-instruction' },
    { role: 'tool', content: 'Write(index.html) ✓ tool-line' },
    { role: 'assistant', content: '만들었어요. 토큰은 ' + TOKEN + ' 이고 Authorization: Bearer abcdefghijklmnop 예요.' },
  ] },
  { title: '두 번째 작업', messages: [] },
];

try {
  // --- core -------------------------------------------------------------------------------------
  const root = fixture('source');
  const dest = path.join(base, 'dest'); fs.mkdirSync(dest);
  const realFetch = globalThis.fetch;
  globalThis.fetch = () => { throw Error('network is off'); };
  const now = new Date(2026, 9, 26, 15, 30, 12);
  let result;
  try { result = await exportWork({ root, destination: dest, secrets: [TOKEN, ACTIVITY_TOKEN], tasks: TASKS, now }); }
  finally { globalThis.fetch = realFetch; }
  assert.equal(path.basename(result.file), '내-작업-source-20261026-153012.zip');
  assert.equal(path.dirname(result.file), dest);
  const entries = readZip(result.file);
  const names = [...entries.keys()].sort();
  assert.deepEqual(names.filter(n => n.startsWith('작업 폴더/')), EXPECTED_FILES.slice().sort().filter(n => n !== '작업 폴더/config.js'),
    'workspace files only; .git, node_modules (any depth), .hypeproof, credentials, links and bidi names left out');
  assert.ok(entries.has('대화/transcript.json') && entries.has('대화/transcript.md') && entries.has('내보내기-안내.txt'));
  assert.equal(entries.get('작업 폴더/한글 이름.txt').toString('utf8'), '안녕하세요', 'Korean names and bytes round-trip');
  assert.deepEqual([...entries.get('작업 폴더/images/logo.png')], [0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0, 1, 2, 3], 'binary bytes round-trip');
  assert.match(entries.get('작업 폴더/index.html').toString(), /type="password"/, 'positive control: an ordinary password field is not a credential');
  // The grep test: no secret, internal record or system instruction in any inflated byte.
  const all = Buffer.concat([...entries.values()]).toString('utf8');
  for (const needle of [TOKEN, ACTIVITY_TOKEN, 'sk-live-xyzw1234', 'abcdefghijklmnop', 'OPENAI_KEY', 'pem-bytes', 'git-internal', 'installed', 'studio-internal-record',
    'outside-the-folder', 'bidi-name', 'class-secret-instruction', 'tool-line', '\u202e']) assert.ok(!all.includes(needle), 'zip carries no ' + JSON.stringify(needle));
  const transcript = JSON.parse(entries.get('대화/transcript.json').toString('utf8'));
  assert.equal(transcript.format, 'hypeproof-studio-transcript/1');
  assert.deepEqual(transcript.tasks.map(t => t.title), ['꽃집 홈페이지', '두 번째 작업']);
  assert.deepEqual(transcript.tasks[0].messages.map(m => m.role), ['user', 'assistant'], 'only the learner and the AI');
  assert.equal(transcript.tasks[0].messages[0].createdAt, '2026-10-26T01:00:00.000Z');
  assert.match(transcript.tasks[0].messages[1].content, /토큰은 \[가림\] 이고 Authorization: \[가림\] 예요/, 'secrets redacted, the rest kept');
  const md = entries.get('대화/transcript.md').toString('utf8');
  assert.match(md, /## 꽃집 홈페이지/); assert.match(md, /\*\*나\*\*/); assert.match(md, /꽃집 홈페이지를 만들어줘/); assert.match(md, /\(대화 없음\)/);
  const notice = entries.get('내보내기-안내.txt').toString('utf8');
  for (const listed of ['".env"', '"certs/server.pem"', '"notes/leak.txt"', '"notes/activity.txt"', '"config.js"', '"link.txt"', '"linkdir"']) assert.ok(notice.includes(listed), 'notice lists ' + listed);
  assert.match(notice, /\(이름을 표시하지 않음\)/); assert.ok(!notice.includes('evil'), 'a hostile name is not echoed');
  assert.match(notice, /\.git, node_modules, \.hypeproof/);
  assert.equal(result.files, 5); assert.equal(result.tasks, 2);
  assert.ok(!fs.readdirSync(base).includes('outside') || fs.readFileSync(path.join(base, 'outside/secret.txt'), 'utf8') === 'outside-the-folder');

  // Never replaces: a second export in the same second gets -2; the first is byte-identical.
  const firstBytes = fs.readFileSync(result.file);
  const second = await exportWork({ root, destination: dest, secrets: [TOKEN], tasks: TASKS, now });
  assert.equal(path.basename(second.file), '내-작업-source-20261026-153012-2.zip');
  assert.deepEqual(fs.readFileSync(result.file), firstBytes, 'first zip untouched');
  // Source files are never changed.
  assert.equal(fs.readFileSync(path.join(root, 'index.html'), 'utf8').includes('꽃집'), true);

  // Destination inside the work folder (also through a link) is refused, nothing written.
  fs.symlinkSync(path.join(root, 'sub'), path.join(base, 'into-source'));
  for (const inside of [root, path.join(root, 'sub'), path.join(base, 'into-source')]) {
    const before = fs.readdirSync(path.join(root, 'sub'));
    await assert.rejects(exportWork({ root, destination: inside, secrets: [], tasks: [], now }), /destination_inside/);
    assert.deepEqual(fs.readdirSync(path.join(root, 'sub')), before);
  }
  // Size caps refuse the whole export; nothing is written.
  const destCount = fs.readdirSync(dest).length;
  await assert.rejects(exportWork({ root, destination: dest, secrets: [], tasks: [], now, limits: { ...WORK_EXPORT_LIMITS, totalMax: 40 } }), WorkExportTooLarge);
  await assert.rejects(exportWork({ root, destination: dest, secrets: [], tasks: [], now, limits: { ...WORK_EXPORT_LIMITS, filesMax: 2 } }), WorkExportTooLarge);
  assert.equal(fs.readdirSync(dest).length, destCount, 'over the cap writes nothing');
  // An oversized single file is skipped and listed, not fatal.
  const capped = await collectWorkFolder(root, [], { ...WORK_EXPORT_LIMITS, fileMax: 20 });
  assert.ok(capped.skipped.some(s => s.path === 'index.html' && s.reason === 'too_large'));
  assert.ok(capped.files.some(f => f.name === 'style.css'), 'positive control: small files stay');
  // A changed scope before writing stops with nothing written.
  assert.equal(await exportWork({ root, destination: dest, secrets: [], tasks: [], now, current: () => false }), 'stale');
  assert.equal(fs.readdirSync(dest).length, destCount);
  // File name: controls, bidi and separators removed from the folder part.
  assert.equal(workExportName('/x/a\u202eb/c:d', now), '내-작업-c-d-20261026-153012.zip');
  assert.equal(workExportName('/x/..', now), '내-작업-20261026-153012.zip');

  // --- fix1: every probe case of the FAIL verify (planted fake values only) ----------------------
  {
    const KNOWN = 'known-held-value-QQwwEErrTT';           // held by Studio, matches no generic shape
    const ANT = 'sk-ant-api03-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789';
    const GHP = 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', GHO = 'gho_ZYXWVUTSRQPONMLKJIHG0123456789', GPAT = 'github_pat_11ABCDEFG0123456789_abcdefghij';
    const ANT_NODIGIT = 'sk-ant-AbCdEfGhIjKlMnOp';
    const AWS = 'AKIAIOSFODNN7EXAMPLE', ASIA = 'ASIAJEXAMPLEXEG2JICE';
    const OAI = 'sk-proj-ZYXWVUTSRQPONMLK9876543210', SK = 'sk-Abc123Def456Ghi789Jkl0';
    const SLACK = 'xoxb-1234567890-abcdefghij', GOOG = 'AIzaSyA1234567890abcdefghijklmnopqrstuv';
    const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    const CLASSMATE = 'hps_student_token_CLASSMATE999', ACCOUNT = 'hpa_acc_7c1d2e3f4a5b6c7d8e9f';
    const SECRETVAL = 'yaml-client-secret-value', PWVAL = 'p4ssw0rd-planted', AUTHVAL = 'authz-planted-0042';
    const r = path.join(base, 'probe'), pd = path.join(base, 'probe-dest'); fs.mkdirSync(pd);
    put(r, 'index.html', '<p>hi</p><input type="password">');
    put(r, 'raw-ant.txt', 'my key ' + ANT);
    put(r, 'notes.md', 'github ' + GHP + ' aws ' + AWS);
    put(r, 'more.md', [GHO, GPAT, ASIA, SK, SLACK, GOOG].join('\n'));
    put(r, 'ant-nodigit.txt', 'key ' + ANT_NODIGIT);
    put(r, 'oai.txt', 'openai ' + OAI);
    put(r, 'jwt.txt', 'session ' + JWT);
    put(r, 'token-only.json', JSON.stringify({ token: CLASSMATE }));
    put(r, 'account.json', JSON.stringify({ service: 'x', accessToken: ACCOUNT }));
    put(r, 'cfg.yaml', 'client_secret: ' + SECRETVAL + '\ndb_password: "' + PWVAL + '"\n');
    put(r, 'headers.txt', 'Authorization = ' + AUTHVAL + '\n');
    put(r, 'ssh.txt', '-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n');
    put(r, 'utf8-known.txt', 'held ' + KNOWN);
    put(r, 'utf16le.txt', Buffer.from('tok ' + KNOWN, 'utf16le'));
    put(r, 'utf16be.txt', Buffer.from('tok ' + KNOWN, 'utf16le').swap16());
    put(r, 'utf16-shape.txt', Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('key ' + ANT, 'utf16le')]));
    for (const [i, pre] of ['', 'a', 'ab'].entries()) put(r, `b64-${i}.txt`, 'data:' + Buffer.from(pre + KNOWN + 'tail').toString('base64'));
    put(r, 'b64url.txt', Buffer.from('~~' + KNOWN + '??>>').toString('base64url'));
    put(r, '..\\..\\evil.txt', 'zip-slip-for-windows');
    put(r, 'C:evil.txt', 'drive-letter-name');
    put(base, 'probe-outside/real-secret.txt', 'outside-hardlinked-content');
    fs.linkSync(path.join(base, 'probe-outside/real-secret.txt'), path.join(r, 'hard.txt'));
    // Positive controls: ordinary code and data stay.
    put(r, 'api.js', "const body = { max_tokens: 1024, model: 'x' };\nconst password = input.value;\nconst token = getToken(1);\nlet apiKey = null;\n");
    put(r, 'pair/a.txt', 'two-names-both-inside'); fs.linkSync(path.join(r, 'pair/a.txt'), path.join(r, 'pair/b.txt'));
    put(r, 'pic.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 1, 2, 3]));
    put(r, 'notes/plain.txt', 'tasks: risk-assessment-for-the-project-2026, hps_request_id, sk-learn-tutorial');
    const tasks = [{ title: 't ' + GHP, messages: [
      { role: 'user', content: `keys: ${ANT} | ${GHP} | ${AWS} | ${OAI} | classmate ${CLASSMATE} | account ${ACCOUNT} | known ${KNOWN} | Bearer abcdefghijklmnopq | token: ${CLASSMATE}` },
      { role: 'assistant', content: `more ${ANT_NODIGIT} ${GHO} ${GPAT} ${ASIA} ${SK} ${SLACK} ${GOOG} ${JWT} b64 ${Buffer.from('x' + KNOWN).toString('base64')} {"refresh_token": "${'r-' + 'planted-refresh'}"} client_secret: ${SECRETVAL}\n-----BEGIN RSA PRIVATE KEY-----\nMIIEplanted\n-----END RSA PRIVATE KEY-----\nmax_tokens: 1024 그대로` },
    ] }];
    const res = await exportWork({ root: r, destination: pd, secrets: [KNOWN], tasks, now });
    const z = readZip(res.file);
    const work = [...z.keys()].filter(n => n.startsWith('작업 폴더/')).sort();
    assert.deepEqual(work, ['작업 폴더/api.js', '작업 폴더/index.html', '작업 폴더/notes/plain.txt', '작업 폴더/pair/a.txt', '작업 폴더/pair/b.txt', '작업 폴더/pic.png'],
      'only files without a credential, a path-like name or an outside hard link: ' + JSON.stringify(work));
    const every = Buffer.concat([...z.values()]);
    const text = every.toString('utf8');
    for (const [label, v] of Object.entries({ ANT, ANT_NODIGIT, GHP, GHO, GPAT, AWS, ASIA, OAI, SK, SLACK, GOOG, JWT, CLASSMATE, ACCOUNT, KNOWN, SECRETVAL, PWVAL, AUTHVAL,
      refresh: 'r-planted-refresh', pem: 'MIIEplanted', ssh: 'OPENSSH', hard: 'outside-hardlinked-content', slip: 'zip-slip', drive: 'drive-letter-name' }))
      assert.ok(!text.includes(v), 'zip carries no ' + label);
    for (const v of [KNOWN, ANT]) for (const enc of ['utf16le']) {
      assert.ok(!every.includes(Buffer.from(v, enc)) && !every.includes(Buffer.from(v, enc).swap16()), 'no UTF-16 copy of ' + v.slice(0, 6));
    }
    for (const form of base64Forms(KNOWN)) assert.ok(!text.includes(form), 'no base64 spelling of a held value in the zip: ' + form.slice(0, 4));
    for (const n of z.keys()) assert.ok(!n.includes('\\') && !/(^|\/)[A-Za-z]:/.test(n), 'no path-like entry name: ' + n);
    const msgs = JSON.parse(z.get('대화/transcript.json').toString('utf8')).tasks[0];
    assert.equal(msgs.messages[0].content, 'keys: [가림] | [가림] | [가림] | [가림] | classmate [가림] | account [가림] | known [가림] | [가림] | token: [가림]');
    assert.match(msgs.messages[1].content, /^more \[가림\] \[가림\] \[가림\] \[가림\] \[가림\] \[가림\] \[가림\] \[가림\] b64 /);
    assert.match(msgs.messages[1].content, /"refresh_token": \[가림\]\} client_secret: \[가림\]\n\[가림\]\nmax_tokens: 1024 그대로$/, 'key kept, value hidden; positive control kept');
    assert.equal(msgs.title, 't [가림]');
    assert.equal(redactCredentials('ok risk-assessment-for-the-project-2026 hps_request_id max_tokens: 4096 type="password"', []),
      'ok risk-assessment-for-the-project-2026 hps_request_id max_tokens: 4096 type="password"', 'positive control: ordinary text is untouched');
    const notice = z.get('내보내기-안내.txt').toString('utf8');
    for (const listed of ['"raw-ant.txt"', '"ant-nodigit.txt"', '"notes.md"', '"more.md"', '"oai.txt"', '"jwt.txt"', '"token-only.json"', '"account.json"', '"cfg.yaml"', '"headers.txt"', '"ssh.txt"',
      '"utf8-known.txt"', '"utf16le.txt"', '"utf16be.txt"', '"utf16-shape.txt"', '"b64-0.txt"', '"b64-1.txt"', '"b64-2.txt"', '"b64url.txt"', JSON.stringify('..\\..\\evil.txt'), '"C:evil.txt"', '"hard.txt"'])
      assert.ok(notice.includes(listed), 'notice lists ' + listed);
    assert.match(notice, /"hard.txt": 작업 폴더 밖의 파일과 이어진 파일이에요/);
    assert.match(notice, /"C:evil.txt": 이름에 \\ 또는 : 가 있어서/);
    // The zip writer refuses an escaping name even if a caller hands one in.
    for (const bad of ['../x', 'a/../../x', '/abs', 'a\\b', 'C:x', 'a//b', './x', ''])
      await assert.rejects(buildZip([{ name: bad, bytes: Buffer.from('x'), mtime: now }]), /work_export_unsafe_name/, 'refused: ' + JSON.stringify(bad));
    assert.ok((await buildZip([{ name: '작업 폴더/a b/c.txt', bytes: Buffer.from('x'), mtime: now }])).length > 0, 'positive control: a plain nested name');
    // Held secrets: every SecretStorage key, JSON records reduced to their credential fields.
    const store = new Map([['hypeproofChat.personalAccount.v1', JSON.stringify({ service: 'https://api.example.test', accessToken: 'acct-access-ZZqq', refreshToken: 'acct-refresh-WWee', sessionId: 'sess-planted-01', expiresAt: 1 })],
      ['hps.activity.credential.other', JSON.stringify({ version: 1, name: '다른 활동', workspace: '/Users/x/다른', token: 'other-activity-tok' })],
      ['hypeproof.classroomOps.credential', 'ops-credential-planted'], ['some.future.key', 'future-secret-planted']]);
    const reader = { get: async k => store.get(k), keys: async () => [...store.keys()] };
    const held = await heldSecretValues([reader], ['hypeproofChat.workshopToken']);
    for (const v of ['acct-access-ZZqq', 'acct-refresh-WWee', 'sess-planted-01', 'other-activity-tok', 'ops-credential-planted', 'future-secret-planted']) assert.ok(held.includes(v), 'held: ' + v);
    for (const v of ['https://api.example.test', '다른 활동', '/Users/x/다른']) assert.ok(!held.includes(v), 'not a secret: ' + v);
    const noKeys = await heldSecretValues([{ get: reader.get, keys: async () => { throw Error('no keys'); } }], ['hypeproof.classroomOps.credential']);
    assert.deepEqual(noKeys, ['ops-credential-planted'], 'named keys still read when keys() fails');
  }

  // --- fix2: every probe2 case of the re-verify, broad scan, fail closed (planted fakes only) -------
  {
    const KNOWN = 'hps_student_token_KNOWN12345';
    const ANT = 'sk-ant-api03-FAKEFAKEFAKE0123456789abcdef';
    const GHP = 'ghp_FAKEFAKEFAKEFAKEFAKE0123456789abcd';
    const AWSSECRET = 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYFAKEKEY1234';
    const HELD2 = 'plain-held-VALUEqq'; // held by Studio, matches no shape: only the exact-value rules find it
    const pct = v => [...v].map(c => '%' + c.charCodeAt(0).toString(16)).join('');
    const r = path.join(base, 'probe2-' + GHP), pd = path.join(base, 'probe2-dest'); fs.mkdirSync(pd);
    const planted = {};
    const plant = (rel, content, needle) => { put(r, rel, content); planted[rel] = needle; };
    plant('split.txt', 'key part one: hps_student_token_KNO\nWN12345 done', 'WN12345');
    plant('urlenc.txt', 'u=' + pct(KNOWN), '%68%70%73');
    plant('urlenc-upper.txt', 'u=' + pct(KNOWN).toUpperCase(), '%68%70%73'.toUpperCase());
    plant('hex.txt', 'h=' + Buffer.from(KNOWN).toString('hex'), Buffer.from(KNOWN).toString('hex'));
    plant('hex-upper.txt', 'h=' + Buffer.from(KNOWN).toString('hex').toUpperCase(), Buffer.from(KNOWN).toString('hex').toUpperCase());
    plant('hex-spaced.txt', 'h=' + Buffer.from(HELD2).toString('hex').match(/../g).join(' '), Buffer.from(HELD2).toString('hex').slice(0, 12));
    plant('urlenc2.txt', 'u=' + pct(HELD2), pct(HELD2).slice(0, 12));
    plant('nested.txt', 'flags: token=FAKEnestedVALUE77\n', 'FAKEnestedVALUE77');
    plant('staging.env', 'MODE=demo-plain\n', 'demo-plain');
    plant('basic-bare.txt', 'curl -H Basic ZmFrZTpmYWtlcGFzc3dvcmQxMjM=\n', 'ZmFrZTpmYWtlcGFzc3dvcmQxMjM=');
    plant('hex-ant.txt', 'h=' + Buffer.from(ANT).toString('hex'), Buffer.from(ANT).toString('hex'));
    plant('db.sqlite', Buffer.concat([Buffer.from('SQLite format 3\0'), Buffer.alloc(100), Buffer.from('ghtoken' + GHP), Buffer.alloc(50), Buffer.from(ANT)]), GHP);
    plant('db-known.sqlite', Buffer.concat([Buffer.from('SQLite format 3\0'), Buffer.alloc(100), Buffer.from(KNOWN)]), KNOWN);
    plant('shot.png', Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(13), Buffer.from('tEXtComment\0Bearer FAKEbearerTOKEN12345678'), Buffer.alloc(8)]), 'FAKEbearerTOKEN12345678');
    plant('.env.example', 'API_KEY=changeme\n', 'changeme');
    plant('prod.env', 'AWS_SECRET_ACCESS_KEY=' + AWSSECRET + '\n', AWSSECRET);
    plant('aws.ini', '[default]\naws_secret_access_key = ' + AWSSECRET + '\n', AWSSECRET);
    plant('db.txt', 'DATABASE_URL=postgres://admin:FakePassw0rdXYZ@db.example.com/app\n', 'FakePassw0rdXYZ');
    plant('openai.json', JSON.stringify({ OPENAI_KEY: 'fakeOpenAIValueNoPrefixABCDEFG123' }), 'fakeOpenAIValueNoPrefixABCDEFG123');
    plant('cookie.txt', 'Cookie: session=FAKEsessionCOOKIE0123456789\n', 'FAKEsessionCOOKIE0123456789');
    plant('setcookie.txt', 'Set-Cookie: sid=FAKEsetCOOKIEvalue; Path=/\n', 'FAKEsetCOOKIEvalue');
    plant('basic.txt', 'Authorization: Basic ZmFrZTpmYWtlcGFzc3dvcmQxMjM=\n', 'ZmFrZTpmYWtlcGFzc3dvcmQxMjM=');
    plant('auth-token.txt', 'authorization: Token FAKEtokenSCHEMEvalue\n', 'FAKEtokenSCHEMEvalue');
    plant('apikey-header.txt', 'x-api-key: FAKEheaderAPIKEYvalue\n', 'FAKEheaderAPIKEYvalue');
    plant('session.yaml', 'session_secret: FAKEsessionSECRETvalue\nmy_private: FAKEprivateVALUEx\n', 'FAKEsessionSECRETvalue');
    plant('sess.json', JSON.stringify({ sessionId: 'FAKEsessionIDvalue9' }), 'FAKEsessionIDvalue9');
    plant('camel.js', "const cfg = { signingKey: 'FAKEsigningKEYvalue' };\n", 'FAKEsigningKEYvalue');
    plant('b64-shape.txt', 'blob ' + Buffer.from('token: ' + GHP).toString('base64'), Buffer.from('token: ' + GHP).toString('base64'));
    plant('utf16be-shape.bin', Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from('key ' + ANT, 'utf16le').swap16()]), 'NEVER-IN-TEXT');
    put(r, `notes-${GHP}.txt`, 'plain'); planted['NAME ghp'] = GHP;
    put(r, `${KNOWN}.md`, 'plain'); planted['NAME known'] = KNOWN;
    put(r, `${Buffer.from(KNOWN).toString('hex')}/inside.txt`, 'in a folder named by a secret'); planted['DIR hex known'] = 'in a folder named by a secret';
    // Positive controls: ordinary code, data, images and databases stay.
    put(r, 'ok/code.js', "const KEY_CODES = { ENTER: 13 };\nconst body = { max_tokens: 1024, \"maxTokens\": 100000 };\nlet password: string;\nconst t = getToken(1);\n");
    put(r, 'ok/package.json', JSON.stringify({ name: 'flower', author: '홍길동 선생님', version: '1.0.0' }));
    put(r, 'ok/readme.md', 'Basic examples. See https://example.com/path?a=1 and commit 3f2a9c1e4b5d6f708192a3b4c5d6e7f8091a2b3c. color #ff00aa.');
    put(r, 'ok/pic.png', Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(13), Buffer.from('tEXtSoftware\0Paint 3.1'), Buffer.alloc(8)]));
    put(r, 'ok/plain.sqlite', Buffer.concat([Buffer.from('SQLite format 3\0'), Buffer.alloc(100), Buffer.from('CREATE TABLE notes(title TEXT, body TEXT)'), Buffer.alloc(20), Buffer.from('꽃집 메모')]));
    const tasks = [{ title: 't', messages: [
      { role: 'user', content: `split hps_student_token_KNO\nWN12345 | hex ${Buffer.from(KNOWN).toString('hex')} | url ${pct(KNOWN)} | aws AWS_SECRET_ACCESS_KEY=${AWSSECRET} | db postgres://admin:FakePassw0rdXYZ@db | basic Authorization: Basic ZmFrZTpmYWtlcGFzc3dvcmQxMjM=` },
      { role: 'tool', content: 'Bash(curl -H "x-api-key: TOOLINPUTFAKE0123456789")', tool: { icon: '', label: 'TOOLINPUTFAKE0123456789', state: 'done' } },
      { role: 'assistant', content: `ran Bash with x-api-key: TOOLOUTPUTFAKE0123456789 and Cookie: sid=FAKEcookieOUT99 | hexant ${Buffer.from(ANT).toString('hex')} | max_tokens: 1024 Basic examples 그대로` },
      { role: 'user', content: `held2 ${Buffer.from(HELD2).toString('hex').toUpperCase()} | ${pct(HELD2)} | Basic ZmFrZTpmYWtlcGFzc3dvcmQxMjM= | flags: token=FAKEnestedVALUE77 | author: 홍길동 선생님` },
    ] }];
    const res = await exportWork({ root: r, destination: pd, secrets: [KNOWN, HELD2], tasks, now }); // GHP and ANT are not held: only their shapes find them
    assert.ok(!path.basename(res.file).includes('ghp_'), 'the zip file name drops a folder name that carries a secret: ' + path.basename(res.file));
    const z = readZip(res.file);
    const work = [...z.keys()].filter(n => n.startsWith('작업 폴더/')).sort();
    assert.deepEqual(work, ['작업 폴더/ok/code.js', '작업 폴더/ok/package.json', '작업 폴더/ok/pic.png', '작업 폴더/ok/plain.sqlite', '작업 폴더/ok/readme.md'],
      'only the positive controls stay: ' + JSON.stringify(work));
    const blob = Buffer.concat([...[...z.keys()].map(k => Buffer.from(k)), ...z.values()]);
    for (const [label, v] of Object.entries(planted)) assert.ok(!blob.includes(Buffer.from(v)), 'zip (names and bytes) carries no ' + label);
    for (const v of ['TOOLINPUTFAKE', 'TOOLOUTPUTFAKE', 'FAKEcookieOUT99', 'FakePassw0rdXYZ', AWSSECRET, Buffer.from(ANT).toString('hex')]) assert.ok(!blob.includes(Buffer.from(v)), 'transcript carries no ' + v.slice(0, 12));
    const msgs = JSON.parse(z.get('대화/transcript.json').toString('utf8')).tasks[0].messages;
    assert.equal(msgs[2].content, 'held2 [가림] | [가림] | [가림] | flags: token=[가림] | author: 홍길동 선생님');
    assert.deepEqual(msgs.map(m => m.role), ['user', 'assistant', 'user'], 'tool messages, their inputs and outputs are never exported');
    assert.equal(msgs[0].content, 'split [가림] | hex [가림] | url [가림] | aws AWS_SECRET_ACCESS_KEY=[가림] | db [가림]db | basic [가림]');
    assert.equal(msgs[1].content, 'ran Bash with x-api-key: [가림] and [가림]');
    const notice = z.get('내보내기-안내.txt').toString('utf8');
    for (const rel of Object.keys(planted).filter(k => !/^(NAME|DIR) /.test(k))) assert.ok(notice.includes(JSON.stringify(rel)), 'notice lists ' + rel);
    assert.equal((notice.match(/\(이름을 표시하지 않음\): 이름에 비밀번호·토큰 같은 정보가 있을 수 있어요/g) ?? []).length, 3, 'two files and one folder named by a secret, listed without the name');
    assert.ok(!notice.includes('ghp_') && !notice.includes(KNOWN) && !notice.includes(Buffer.from(KNOWN).toString('hex')), 'the notice does not print a secret name');
    // The transcript keeps plain prose and code around a credential.
    assert.equal(redactCredentials('hexant ' + Buffer.from(ANT).toString('hex') + ' | max_tokens: 1024 "maxTokens": 100000 Basic examples author: 김철수 그대로', [KNOWN]),
      'hexant [가림] | max_tokens: 1024 "maxTokens": 100000 Basic examples author: 김철수 그대로');
  }

  // --- host flow with a stubbed VS Code -----------------------------------------------------------
  const built = await build({ entryPoints: ['src/workExportHost.ts'], bundle: true, platform: 'node', format: 'cjs', external: ['vscode'], write: false, logLevel: 'silent' });
  const shown = { warn: [], info: [], commands: [], progress: 0 };
  let pick = async () => [{ scheme: 'file', fsPath: dest }], answer = '폴더 열기';
  const vscode = { Uri: { file: fsPath => ({ fsPath, scheme: 'file' }) }, ProgressLocation: { Notification: 15 },
    commands: { executeCommand: async (...args) => { shown.commands.push(args); } },
    window: { showOpenDialog: (...a) => pick(...a), showWarningMessage: async m => { shown.warn.push(m); }, showInformationMessage: async (m, ...items) => { shown.info.push([m, items]); return answer; },
      withProgress: async (options, task) => { shown.progress++; assert.equal(options.location, 15); assert.equal(options.title, '내 작업을 내보내는 중이에요'); return task({ report() {} }); } } };
  const mod = { exports: {} };
  vm.runInNewContext(built.outputFiles[0].text, { module: mod, exports: mod.exports, require: id => id === 'vscode' ? vscode : require(id), Buffer, setTimeout, clearTimeout });
  // Only TOKEN is known here; notes/activity.txt still stays out because hps_… is a Studio token shape (5 files).
  const source = { root, secrets: [TOKEN], tasks: TASKS, current: () => true };
  const written = await mod.exports.runWorkExport(source);
  assert.ok(written && fs.existsSync(written), 'host wrote the zip');
  await new Promise(r => setTimeout(r, 0));
  assert.equal(shown.progress, 1, 'progress shown');
  assert.match(shown.info[0][0], new RegExp('^저장했어요: ' + dest.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' · 내-작업-source-'));
  assert.match(shown.info[0][0], /작업 파일 5개 · 대화 2개 · 넣지 않은 파일 \d+개는 zip 안 내보내기-안내.txt에 적었어요/);
  assert.deepEqual(shown.info[0][1], ['폴더 열기']);
  assert.deepEqual(shown.commands[0][0], 'revealFileInOS', '폴더 열기 reveals the zip');
  assert.equal(shown.commands[0][1].fsPath, written);
  // Cancel, remote, inside and stale: nothing written, each says why (cancel says nothing).
  const count0 = fs.readdirSync(dest).length;
  pick = async () => undefined; assert.equal(await mod.exports.runWorkExport(source), undefined); assert.equal(shown.warn.length, 0);
  pick = async () => [{ scheme: 'vscode-remote', fsPath: dest }]; await mod.exports.runWorkExport(source); assert.match(shown.warn.at(-1), /이 컴퓨터의 폴더만/);
  pick = async () => [{ scheme: 'file', fsPath: path.join(root, 'sub') }]; await mod.exports.runWorkExport(source); assert.match(shown.warn.at(-1), /작업 폴더 밖의 폴더를/);
  pick = async () => [{ scheme: 'file', fsPath: dest }]; await mod.exports.runWorkExport({ ...source, current: () => false }); assert.match(shown.warn.at(-1), /작업이 바뀌어서 멈췄어요/);
  let calls = 0; await mod.exports.runWorkExport({ ...source, current: () => ++calls < 2 }); assert.match(shown.warn.at(-1), /작업이 바뀌어서 멈췄어요/, 'turn started during collection');
  assert.equal(fs.readdirSync(dest).length, count0, 'refusals write nothing');

  // --- the real provider: every seat that has a folder, offline and tokenless -------------------
  for (const kind of ['personal', 'trial', 'classroom', 'instructor']) {
    const hroot = fixture('seat-' + kind), hdest = path.join(base, 'dest-' + kind); fs.mkdirSync(hdest);
    // The bundle copies the module's keys at import time, so ProgressLocation is set before it loads.
    const f = await createTaskHarness(hroot, undefined, { configureVscode: v => { v.ProgressLocation = { Notification: 15 }; } });
    f.activity.kind = kind === 'instructor' ? 'classroom' : kind; f.activity.token = ACTIVITY_TOKEN;
    f.h._instructorMode = { isInstructor: kind === 'instructor' };
    f.h.resolveCoachCwd = () => hroot;
    // Studio-held credentials in SecretStorage, none of them in a generic shape.
    const held = new Map([['hypeproofChat.personalAccount.v1', JSON.stringify({ service: 'https://api.example.test', accessToken: 'acct-access-' + kind + 'ZZ', refreshToken: 'acct-refresh-' + kind + 'WW', sessionId: 's', expiresAt: 1 })],
      ['hps.activity.credential.other', JSON.stringify({ version: 1, name: 'n', token: 'other-activity-' + kind + 'QQ' })], ['hypeproof.classroomOps.credential', 'ops-cred-' + kind + 'EE'],
      // A legacy unscoped token: the scoped storage answers this key with the activity token, so only the raw storage has it.
      ['hypeproofChat.workshopToken', 'legacy-raw-' + kind + 'RR']]);
    Object.assign(f.connections.raw.secrets, { get: async k => held.get(k), keys: async () => [...held.keys()] });
    const HELD = ['acct-access-' + kind + 'ZZ', 'acct-refresh-' + kind + 'WW', 'other-activity-' + kind + 'QQ', 'ops-cred-' + kind + 'EE', 'legacy-raw-' + kind + 'RR'];
    HELD.forEach((v, i) => put(hroot, `held/${i}.txt`, 'value ' + v));
    const w = f.vscode.window;
    const said = [];
    w.withProgress = async (_o, task) => task({ report() {} });
    w.showInformationMessage = async (m) => { said.push(m); return undefined; };
    w.showWarningMessage = async (m) => { said.push(m); };
    let dialogs = 0; w.showOpenDialog = async () => { dialogs++; return [{ scheme: 'file', fsPath: hdest }]; };
    const history = [{ id: 'u', role: 'user', content: '내 질문 ' + kind, createdAt: 1 }, { id: 's', role: 'system', content: 'class-secret-instruction', createdAt: 2 },
      { id: 'a', role: 'assistant', content: 'AI 답 ' + ACTIVITY_TOKEN, createdAt: 3 }, { id: 'h', role: 'user', content: 'held ' + HELD.join(' '), createdAt: 4 }];
    if (kind === 'personal' || kind === 'trial') await f.store.append(f.store.getView().activeTaskId, history);
    else { f.h.taskWorkspace = undefined; await f.h.context.workspaceState.update(f.h.historyKey(), history); }
    // A running turn refuses before any dialog.
    f.h.pendingSends = 1; assert.equal(await f.h.exportMyWork(), undefined); assert.equal(dialogs, 0, kind + ': running turn'); assert.match(said.at(-1), /AI가 작업하는 중이에요/); f.h.pendingSends = 0;
    // No folder: says so, no dialog.
    f.h.resolveCoachCwd = () => undefined; await f.h.exportMyWork(); assert.equal(dialogs, 0); assert.match(said.at(-1), /내보낼 작업 폴더가 아직 없어요/); f.h.resolveCoachCwd = () => hroot;
    // The settings-dialog message drives the same flow.
    await f.handle(f.scoped({ type: 'exportMyWork' }));
    assert.equal(dialogs, 1, kind + ': one picker');
    const zips = fs.readdirSync(hdest); assert.equal(zips.length, 1, kind + ': one zip ' + JSON.stringify(said));
    const got = readZip(path.join(hdest, zips[0]));
    const t = JSON.parse(got.get('대화/transcript.json').toString('utf8'));
    const msgs = t.tasks.flatMap(x => x.messages);
    assert.deepEqual(msgs.map(m => m.content), ['내 질문 ' + kind, 'AI 답 [가림]', 'held [가림] [가림] [가림] [가림] [가림]'], kind + ': transcript from the seat store, activity and every held token redacted');
    for (const v of HELD) assert.ok(!Buffer.concat([...got.values()]).toString('utf8').includes(v), kind + ': no held value ' + v);
    assert.ok(![...got.keys()].some(n => n.startsWith('작업 폴더/held/')), kind + ': files holding a held value stay out');
    const bytes = Buffer.concat([...got.values()]).toString('utf8');
    assert.ok(!bytes.includes(ACTIVITY_TOKEN) && !bytes.includes('class-secret-instruction'), kind + ': grep clean');
    assert.ok(!got.has('작업 폴더/notes/activity.txt'), kind + ': a file holding the activity token stays out');
    // A turn that starts while the picker is open stops the export.
    w.showOpenDialog = async () => { dialogs++; f.h.pendingSends = 1; return [{ scheme: 'file', fsPath: hdest }]; };
    await f.h.exportMyWork(); f.h.pendingSends = 0;
    assert.equal(fs.readdirSync(hdest).length, 1, kind + ': turn started during the picker writes nothing');
    // Double press: the second returns at once while the first picker is open.
    let release; w.showOpenDialog = () => { dialogs++; return new Promise(r => { release = r; }); };
    const first = f.h.exportMyWork(); while (!release) await new Promise(r => setTimeout(r, 1));
    const before = dialogs; assert.equal(await f.h.exportMyWork(), undefined); assert.equal(dialogs, before, kind + ': double press opens no second picker');
    release(undefined); await first;
  }
  console.log('work-export: OK');
} finally {
  fs.rmSync(base, { recursive: true, force: true });
}
