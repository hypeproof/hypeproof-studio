// REQ-CHALK-JOIN-LINK (CGP-SHELL-R-005 / REQ-SHELL-05, ADM-01): "참여 링크 복사" next to the class
// info on the instructor board copies `hypeproof-studio://hypeproof.hypeproof-chat/join?class=<id>`,
// built from the connected cohort id only. It never carries a participation code, the instructor
// token, the seat prefix or a learner identity.
//
// The copy logic is its own inline script (#join-link-script) so it runs here in a vm against a
// minimal document; the static checks lock where the button sits and when it is shown.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../src/ui/manage.html', import.meta.url), 'utf8');
let passed = 0;
const ok = (name) => { passed++; console.log('✓ ' + name); };

// ── 1. Placement: in the header next to 수업 정보, hidden until connected ────────────────────
{
  const title = html.match(/<div class="title">([\s\S]*?)<\/div><section id="conn"/);
  assert.ok(title, 'the header title block is found');
  assert.match(title[1], /<summary>수업 정보<\/summary>/);
  const button = title[1].match(/<button[^>]*id="join-copy"[^>]*>([^<]*)<\/button>/);
  assert.ok(button, 'the button sits in the class-info block');
  assert.equal(button[1], '참여 링크 복사');
  assert.match(button[0], /\bhidden\b/, 'hidden before a class is connected');
  assert.match(button[0], /type="button"/);
  assert.match(title[1], /id="join-copied"[^>]*role="status"/, 'the confirmation is announced');
  // setConnected shows it with the cohort and hides it (clearing the cohort) when disconnected.
  const setConnected = html.match(/function setConnected\(on\)\{[^\n]*?\}\n/)[0];
  assert.match(setConnected, /\$\('join-copy'\)\.hidden=!on/);
  assert.match(setConnected, /\$\('join-copy'\)\.dataset\.cohort=on\?cohort:''/);
  assert.match(setConnected, /text\('join-copied',''\)/, 'an old confirmation never outlives the connection');
  ok('placement: 참여 링크 복사 beside 수업 정보, hidden until connected, status region for the confirmation');
}

// ── 2. Behaviour: run the real script against a minimal document ────────────────────────────
const script = html.match(/<script id="join-link-script">([\s\S]*?)<\/script>/);
assert.ok(script, 'the copy logic is a separate inline script');
function mount({ clipboardFails = false } = {}) {
  const el = (id) => ({ id, dataset: {}, textContent: '', hidden: true, onclick: null });
  const els = { 'join-copy': el('join-copy'), 'join-copied': el('join-copied') };
  const copied = [];
  const window = {};
  const navigator = { clipboard: { writeText: async (t) => { if (clipboardFails) throw Error('denied'); copied.push(t); } } };
  // Planted secrets in the page's globals: the script must not read any of them.
  const sandbox = { window, navigator, document: { getElementById: (id) => els[id] ?? null }, token: 'INSTRUCTOR-SECRET', prefix: 'seat-', code: 'PARTICIPATION-SECRET' };
  vm.runInNewContext(script[1], sandbox);
  return { els, copied, window };
}
{
  const m = mount();
  m.els['join-copy'].dataset.cohort = 'dental-0729';
  await m.els['join-copy'].onclick();
  assert.deepEqual(m.copied, ['hypeproof-studio://hypeproof.hypeproof-chat/join?class=dental-0729']);
  assert.equal(m.els['join-copied'].textContent, '참여 링크를 복사했어요. 참여 코드는 들어 있지 않아요.');
  for (const secret of ['INSTRUCTOR-SECRET', 'PARTICIPATION-SECRET', 'seat-', 'code=', 'token=']) assert.ok(!m.copied[0].includes(secret), secret);
  assert.equal(new URL(m.copied[0]).searchParams.size, 1, 'exactly one parameter: class');
  ok('copy: the link carries the class id only; the confirmation says no code is inside');
}
{
  // Negative controls: an id the Studio handler would refuse is never copied.
  for (const bad of ['', 'a b', 'a/b', '수업', 'a'.repeat(129), 'x&code=1', 'x#y']) {
    const m = mount();
    m.els['join-copy'].dataset.cohort = bad;
    await m.els['join-copy'].onclick();
    assert.deepEqual(m.copied, [], JSON.stringify(bad));
    assert.match(m.els['join-copied'].textContent, /코호트 ID/);
  }
  // Positive control at the length cap.
  const m = mount();
  m.els['join-copy'].dataset.cohort = 'a'.repeat(128);
  await m.els['join-copy'].onclick();
  assert.equal(m.copied.length, 1);
  ok('copy: an id outside [A-Za-z0-9_-]{1,128} is refused (7 negative controls, 1 positive at the cap)');
}
{
  const m = mount({ clipboardFails: true });
  m.els['join-copy'].dataset.cohort = 'dental-0729';
  await m.els['join-copy'].onclick();
  assert.match(m.els['join-copied'].textContent, /복사하지 못했어요/);
  assert.match(m.els['join-copied'].textContent, /hypeproof-studio:\/\/hypeproof\.hypeproof-chat\/join\?class=dental-0729/, 'the link is shown to copy by hand');
  ok('copy: a refused clipboard shows the link to copy by hand');
}
{
  const m = mount();
  assert.equal(m.window.chalkJoinLink('dental-0729'), 'hypeproof-studio://hypeproof.hypeproof-chat/join?class=dental-0729');
  assert.equal(m.window.chalkJoinLink('a/b'), null);
  ok('chalkJoinLink: the builder Studio reads (extensions/hypeproof-chat/src/joinLink.ts)');
}
console.log(`PASS join-link: ${passed} checks`);
