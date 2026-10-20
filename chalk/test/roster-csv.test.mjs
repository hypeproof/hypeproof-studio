// CGP-SHELL-R-032 / CGP-SHELL-D-031 (classroom-admin ADM-01 roster CSV): roster import on /console.
// The parser, preview, request body, per-row result mapping and retry selection are one pure kit
// (src/lib/roster-csv.ts) that the served page inlines verbatim, so the page and these tests run the same code.
// Rendered behaviour (preview before send, result lines, retry) is covered in Chromium: e2e/classroom/roster-csv.mjs.
import assert from 'node:assert/strict';
import test from 'node:test';
import '@hypeproof/service-testkit/test/harness/loader.mjs';
const { rosterCsvKit, ROSTER_CSV_SCRIPT } = await import('../src/lib/roster-csv.ts');
const { default: chalk } = await import('../src/index.ts');
const kit = rosterCsvKit();
const env = { HPS_SIGNING_SECRET: 'test-secret-0123456789abcdef', ENVIRONMENT: 'dev', HPS_SERVICE_ORIGIN: 'https://service.test' };
const okRows = (p) => p.rows.filter((r) => r.ok).map((r) => r.handle);
const bad = (p) => Object.fromEntries(p.rows.filter((r) => !r.ok).map((r) => [r.line, r.reason]));

test('BOM, CRLF, quotes, a Korean name and an empty line parse to the same rows as plain LF text', () => {
  const plain = 'handle,name\nkim-a,김민지\nlee-b,"이, 서준"\npark-c,"박 ""별"" 하늘"\n';
  const messy = '\uFEFFhandle,name\r\nkim-a,김민지\r\n\r\nlee-b,"이, 서준"\r\npark-c,"박 ""별"" 하늘"\r\n';
  const a = kit.preview(plain), b = kit.preview(messy);
  assert.equal(a.ok, true); assert.equal(b.ok, true);
  assert.deepEqual(b.rows.map((r) => [r.handle, r.name, r.ok]), [['kim-a', '김민지', true], ['lee-b', '이, 서준', true], ['park-c', '박 "별" 하늘', true]]);
  assert.deepEqual(b.rows.map((r) => [r.handle, r.name]), a.rows.map((r) => [r.handle, r.name]));
  assert.equal(b.rows[0].line, 2, 'line numbers count physical lines');
  assert.equal(b.rows[1].line, 4, 'the empty line is skipped but still counted');
  assert.equal(b.hasName, true);
  // Old Mac CR line endings and a decomposed Hangul name (NFD) end up the same.
  const cr = kit.preview('handle,name\rkim-a,' + '김민지'.normalize('NFD'));
  assert.equal(cr.rows[0].name, '김민지');
  // Negative control: the header match is exact — an invisible zero-width space (not whitespace) makes an unknown column.
  assert.match(kit.preview('handle,\u200Bname\nkim-a,x').error, /모르는 열이 있어요/);
});

test('file bytes: UTF-8 with a BOM and CP949 (Korean Excel "CSV") both read the Korean name', () => {
  const utf8 = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('handle,name\r\nkim-a,김민지\r\n')]);
  assert.equal(kit.preview(kit.decode(utf8)).rows[0].name, '김민지');
  // "handle,name\nkim-a,김" in CP949: 김 = B1 E8.
  const cp949 = new Uint8Array([...new TextEncoder().encode('handle,name\nkim-a,'), 0xb1, 0xe8]);
  assert.equal(kit.preview(kit.decode(cp949)).rows[0].name, '김');
  // Negative control: a plain UTF-8 decoder turns those bytes into replacement characters.
  assert.match(new TextDecoder().decode(cp949), /�/);
});

test('the column contract is strict: header required, only handle and name, no truncation', () => {
  assert.match(kit.preview('').error, /내용이 없어요/);
  assert.match(kit.preview('\n\n').error, /내용이 없어요/);
  assert.match(kit.preview('kim-a\nlee-b').error, /모르는 열이 있어요: kim-a/);
  assert.match(kit.preview('handle,name,phone\nkim-a,김,010').error, /모르는 열이 있어요: phone/);
  assert.match(kit.preview('name\n김민지').error, /handle 머리글이 없어요/);
  assert.match(kit.preview('handle,handle\na,b').error, /같은 머리글이 두 번/);
  assert.match(kit.preview('handle').error, /학생 줄이 없어요/);
  assert.match(kit.preview('handle\n"kim-a').error, /따옴표가 닫히지 않았어요/);
  assert.match(kit.preview('handle\n"kim"-a').error, /따옴표가 닫힌 뒤에/);
  // Positive control: handle alone, header in another case, whitespace around unquoted cells.
  const p = kit.preview('Handle\n  kim-a  \nlee-b');
  assert.equal(p.ok, true); assert.deepEqual(okRows(p), ['kim-a', 'lee-b']); assert.equal(p.hasName, false);
});

test('an over-cap file is refused whole, and exactly the cap is accepted', () => {
  const rows = (n) => 'handle\n' + Array.from({ length: n }, (_, i) => 'student-' + (i + 1)).join('\n');
  const at = kit.preview(rows(kit.MAX_ROWS));
  assert.equal(at.ok, true); assert.equal(at.valid, 200);
  const over = kit.preview(rows(kit.MAX_ROWS + 1));
  assert.equal(over.ok, false); assert.match(over.error, /200줄까지 받아요\. 지금 201줄/);
  // Empty lines do not count toward the cap.
  assert.equal(kit.preview(rows(kit.MAX_ROWS) + '\n\n\n').ok, true);
  assert.match(kit.preview('handle\n' + 'x'.repeat(kit.MAX_BYTES)).error, /64KB/);
});

test('formula-leading cells are refused as data and never sent', () => {
  const text = ['handle,name', 'ok-a,김', '=cmd,x', 'ok-b,"=HYPERLINK(""http://x"")"', 'ok-c,+82', 'ok-d,-1', 'ok-e,@SUM(A1)', 'ok-f," =1+1"', 'ok-g,"\t=1"', 'ok-h,a=b'].join('\n');
  const p = kit.preview(text);
  assert.equal(p.ok, true);
  assert.deepEqual(okRows(p), ['ok-a', 'ok-h'], 'only rows without a formula-leading cell are valid; "=" inside a cell is fine');
  for (const line of [3, 4, 5, 6, 7, 8, 9]) assert.match(bad(p)[line], /=, \+, -, @로 시작하는 칸/, 'line ' + line);
  // The cell text is kept verbatim for the preview (shown as text), and the body carries handles only.
  assert.equal(p.rows.find((r) => r.line === 4).name, '=HYPERLINK("http://x")');
  const body = JSON.stringify(kit.requestBody(okRows(p)));
  assert.doesNotMatch(body, /=|HYPERLINK|@SUM|\+82/);
  // Negative control: without the formula rule a "+82" name would pass the other checks.
  assert.equal(kit.preview('handle,name\nok-c,82').valid, 1);
});

test('row checks: invalid handles, duplicates and cell counts are flagged before anything is sent', () => {
  const p = kit.preview(['handle,name', 'kim-a,김', '김민지,김', 'Kim-B,', 'kim-a,다른 김', ',빈', 'lee-c', 'park-d,"줄\n바꿈"', 'choi-e,' + '가'.repeat(41)].join('\n'));
  assert.deepEqual(okRows(p), ['kim-a'], 'only the first row is valid');
  assert.equal(p.rows[0].ok, true);
  assert.match(bad(p)[3], /영문 소문자·숫자·하이픈/, 'a Korean name in the handle column');
  assert.match(bad(p)[4], /영문 소문자/, 'upper case is not lower-cased silently');
  assert.match(bad(p)[5], /2번째 줄과 같은 handle/);
  assert.match(bad(p)[6], /handle이 비어 있어요/);
  assert.match(bad(p)[7], /칸 수가 머리글과 달라요/);
  assert.match(bad(p)[8], /줄바꿈/);
  assert.match(bad(p)[10], /40자까지/, 'line numbers stay physical after a quoted line break');
  assert.equal(p.valid, 1); assert.equal(p.invalid, 7);
});

test('the request body has exactly the single-add form fields: handles, no names', () => {
  const p = kit.preview('handle,name\nkim-a,김민지\nlee-b,이서준');
  const body = kit.requestBody(okRows(p));
  assert.deepEqual(Object.keys(body), ['users']);
  assert.deepEqual(body.users, ['kim-a', 'lee-b']);
  assert.doesNotMatch(JSON.stringify(body), /김민지|이서준/);
});

test('per-row results come from one append answer, and nothing is guessed', () => {
  const sent = ['kim-a', 'lee-b', 'park-c'];
  const r = kit.mapAppend(sent, { status: 200, body: { ok: true, size: 9, added: ['kim-a', 'park-c'] } });
  assert.deepEqual([...r], [['kim-a', { state: 'added' }], ['lee-b', { state: 'exists' }], ['park-c', { state: 'added' }]]);
  assert.deepEqual(kit.counts(sent, r), { added: 2, exists: 1, failed: 0 });
  // No `added` field, or a handle the page did not send: the answer cannot say who was added → every row failed, retry is safe.
  for (const body of [{ ok: true, size: 9 }, { ok: true, added: ['kim-a', 'someone-else'] }, { ok: true, added: 'kim-a' }]) {
    const m = kit.mapAppend(sent, { status: 200, body });
    assert.deepEqual([...m.values()].map((x) => x.state), ['failed', 'failed', 'failed']);
    assert.match(m.get('kim-a').reason, /추가 여부를 읽지 못했어요/);
  }
  // No answer / a 5xx (including Chalk's 502 forward failure): not known whether it was applied.
  for (const a of [{ network: true }, { status: 502, body: { error: { type: 'upstream', message: 'service unreachable — instructor write not applied' } } }, { status: 500, body: {} }]) {
    const m = kit.mapAppend(sent, a);
    assert.ok([...m.values()].every((x) => x.state === 'failed' && /결과를 확인하지 못했어요/.test(x.reason)));
  }
  // A 4xx is decided before the write: nobody added, with the server's reason.
  const scope = kit.mapAppend(sent, { status: 403, body: { error: 'issuer not scoped for cohort' } }, (m) => '권한 밖: ' + m);
  assert.match(scope.get('lee-b').reason, /^권한 밖: issuer not scoped for cohort 이 요청에서는 아무도 추가되지 않았어요\.$/);
  const cap = kit.mapAppend(sent, { status: 400, body: { error: 'roster would exceed 500 users' } });
  assert.match(cap.get('kim-a').reason, /최대 인원을 넘게 되어 아무도 추가되지 않았어요\. 최대 500 users/);
  const syn = kit.mapAppend(['synthetic-a', 'kim-a'], { status: 400, body: { error: 'synthetic cohort accepts only "synthetic-" handles', code: 'synthetic_handle_required', refused: ['kim-a'] } });
  assert.match(syn.get('kim-a').reason, /synthetic-으로 시작하는 handle만/);
  assert.match(syn.get('synthetic-a').reason, /같이 보낸 다른 줄이 거절되어/);
  // Negative control: the mapper is not "always added" — a different added list changes the states.
  assert.deepEqual([...kit.mapAppend(sent, { status: 200, body: { added: [] } }).values()].map((x) => x.state), ['exists', 'exists', 'exists']);
});

test('retry sends only the failed rows and keeps every other result', () => {
  const order = ['kim-a', 'lee-b', 'park-c', 'choi-d'];
  const first = kit.merge(
    kit.mapAppend(['kim-a', 'lee-b'], { status: 200, body: { added: ['kim-a'] } }),
    kit.mapAppend(['park-c', 'choi-d'], { network: true }),
  );
  assert.deepEqual(kit.failed(order, first), ['park-c', 'choi-d']);
  const retryBody = kit.requestBody(kit.failed(order, first));
  assert.deepEqual(retryBody, { users: ['park-c', 'choi-d'] }, 'the retry carries the failed rows only');
  const second = kit.merge(first, kit.mapAppend(retryBody.users, { status: 200, body: { added: ['choi-d'] } }));
  assert.deepEqual(order.map((h) => second.get(h).state), ['added', 'exists', 'exists', 'added']);
  assert.deepEqual(kit.failed(order, second), []);
  assert.deepEqual(kit.counts(order, second), { added: 2, exists: 2, failed: 0 });
});

test('the served console inlines exactly the tested kit and sends only handles to roster/append', async () => {
  const r = await chalk.fetch(new Request('https://chalk.test/console'), env, {});
  const html = await r.text();
  assert.ok(!html.includes('/*@roster-csv*/'), 'the marker is replaced by the kit');
  assert.ok(html.includes(ROSTER_CSV_SCRIPT), 'the page inlines exactly the tested kit');
  assert.match(html, /rosterCsv\.requestBody\(/, 'the page builds its body with the kit');
  assert.match(html, /\/roster\/append/);
  // The inlined kit runs as plain script (no module scope leaks out of the factory).
  const fn = new Function(ROSTER_CSV_SCRIPT + ';return rosterCsvKit;');
  assert.equal(fn().preview('handle\nkim-a').valid, 1);
});

test('L3: invisible and fullwidth prefixes do not hide a formula', () => {
  const cells = ['​=1+1', '＝SUM(1)', '－1', '‮=x', '　@SUM(A1)', '⁠+1'];
  const p = kit.preview('handle,name\n' + cells.map((c, i) => 's0' + i + ',"' + c + '"').join('\n'));
  assert.deepEqual(p.rows.map((r) => r.ok), cells.map(() => false));
  for (const r of p.rows) assert.match(r.reason, /=, \+, -, @로 시작하는 칸/, JSON.stringify(r.name));
  // Positive control: the same characters inside a name, not leading, are fine; fullwidth letters stay a name.
  assert.equal(kit.preview('handle,name\ns01,"김​민지"\ns02,"Ａ반 1"').valid, 2);
});

test('M1: bidi and zero-width controls are removed from the name that is shown', () => {
  const p = kit.preview('handle,name\ns01,"‮gnp.exe"\ns02,"김⁦민⁩지‏"');
  assert.deepEqual(p.rows.map((r) => [r.name, r.ok]), [['gnp.exe', true], ['김민지', true]]);
  assert.doesNotMatch(p.rows.map((r) => r.name).join(''), /[‎‏‪-‮⁦-⁩]/);
});

test('M2: the request body builder only takes handle strings, so a name cannot reach it', () => {
  const p = kit.preview('handle,name\ns01,김민지\ns02,이서준');
  assert.throws(() => kit.requestBody(p.rows), TypeError, 'preview rows (with names) are refused, not serialized');
  assert.throws(() => kit.requestBody(['s01', '김민지']), TypeError, 'a name passed as a string is not a handle');
  assert.throws(() => kit.requestBody([{ handle: 's01', name: '김' }]), TypeError);
  assert.deepEqual(kit.requestBody(['s01', 's02']), { users: ['s01', 's02'] });
});

test('M2: the page sends exactly the builder output and nothing else from the import step', async () => {
  const html = await (await chalk.fetch(new Request('https://chalk.test/console'), env, {})).text();
  const start = html.indexOf('function renderRosterImport('), end = html.indexOf('\n}\n', start);
  assert.ok(start > 0 && end > start);
  const fn = html.slice(start, end);
  // Request bodies are the `body:` lines of a fetch init.
  const bodies = [...fn.matchAll(/^\s*body:\s*([^\n]+)/gm)].map((m) => m[1].trim());
  assert.deepEqual(bodies, ['JSON.stringify(rosterCsv.requestBody(handles)),'], 'one request body, built by the kit');
  assert.equal((fn.match(/fetch\(/g) || []).length, 1, 'one request in the import step');
  assert.doesNotMatch(fn, /names\.get\([^)]*\)[^;\n]*body|body[^;\n]*names/, 'names never meet the body');
});

test('L4: the page example uses numbered handles and does not over-promise', async () => {
  const html = await (await chalk.fetch(new Request('https://chalk.test/console'), env, {})).text();
  assert.match(html, /placeholder="handle,name&#10;s01,[^"]*&#10;s02,/, 'example handles are numbers, not names');
  assert.doesNotMatch(html, /kim-minji|lee-seojun/);
  assert.match(html, /실명·전화번호 대신 <code>s01<\/code>처럼 번호로/);
  assert.doesNotMatch(html, /이름은 보내지 않아요|이름은 이 화면에서 확인할 때만/, 'the old absolute wording is gone');
  assert.match(html, /name 열은 이 가져오기에서 보내지 않아요/);
});
