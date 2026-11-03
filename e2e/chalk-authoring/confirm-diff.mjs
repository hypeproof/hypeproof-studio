import '@hypeproof/service-testkit/test/harness/loader.mjs';
// VER-03 (CGP-AGENT-R-016 / CGP-DS-R-029): the instruction diff in /authoring 05 · 수업 버전 확정, rendered in Chromium.
// Real here: the served /authoring page and its script, Chalk's own forwarder. Controlled: the Service is a stub behind
// HPS_SERVICE_ORIGIN that answers the three reads the step makes (/versions, /versions/:v, /versions/:v/readiness)
// and records the confirmation POST. Each check below names the regression it exists to catch.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';

const { default: chalk } = await import('../../chalk/src/index.ts');
const ORIGIN = 'https://service.stub';
const out = process.env.HPS_CHALK_CONFIRM_DIFF_OUT || 'test-results/chalk-confirm-diff';
mkdirSync(out, { recursive: true });

const same = Array.from({ length: 9 }, (_, i) => `공통 안내 ${i + 1}: 미리보기에서 확인한 내용을 한 줄로 적습니다.`);
const XSS = '<img src=x onerror="window.__xss=1">';
const lessonOf = (steps) => ({ schema: 'hps-session-design/1', title: '치과 홈페이지', steps: steps.map(([title, instructions], n) => ({ id: 's' + n, title, instructions })) });
const V1 = lessonOf([['홈페이지 열기', ['시작 예제를 엽니다.', ...same, '진료 시간을 표에 적습니다.', '끝 공백 없음'].join('\r\n') + '\r\n'], ['문구 고치기', '소개 문구를 고칩니다.']]);
const V2 = lessonOf([['홈페이지 열기', ['시작 예제를 엽니다.', ...same, '진료 시간과 휴진일을 표에 적습니다.', '끝 공백 없음 '].join('\n')], ['문구 고치기', '소개 문구를 고칩니다.\n' + XSS]]);

// Mutable stub state, reset per scenario.
let S;
const reset = (over = {}) => { S = { versions: [{ version: 'v2', confirmed: false }, { version: 'v1', confirmed: true }], truncated: false, base: { v1: V1 }, baseStatus: 200, baseShape: 'module', posts: [], ...over }; };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const u = new URL(String(url));
  if (u.origin !== ORIGIN) return realFetch(url, init);
  const p = u.pathname, method = (init?.method || (url instanceof Request ? url.method : 'GET')).toUpperCase();
  if (p.endsWith('/versions')) return json({ versions: S.versions, truncated: S.truncated });
  if (p.endsWith('/versions/v2/readiness')) return json({ version: 'v2', state: 'passed', lesson_sha256: 'sha-v2', rehearsal: { id: 'rh-00000000-0000-0000-0000-000000000000', reasons: [], checks: {} }, content: V2, confirmed: S.confirmedV2 ?? null, confirmation_required: true });
  if (p.endsWith('/versions/v2/confirmation') && method === 'POST') {
    const body = init?.body ? JSON.parse(typeof init.body === 'string' ? init.body : await new Response(init.body).text()) : (url instanceof Request ? await url.json() : null);
    S.posts.push(body); S.confirmedV2 = { at: Date.now() };
    return json({ version: 'v2', confirmed: { at: Date.now(), rehearsal_id: body.rehearsal_id } });
  }
  const m = /\/versions\/(v\d+)$/.exec(p);
  if (m) {
    if (S.baseStatus !== 200) return json({ error: 'upstream unavailable' }, S.baseStatus);
    const content = S.base[m[1]];
    return json(S.baseShape === 'module' ? { module: { content }, source_revision: 1 } : { content });
  }
  return json({ error: 'unexpected ' + p }, 404);
};
const env = { HPS_SIGNING_SECRET: 'test-secret-0123456789abcdef', ENVIRONMENT: 'dev', HPS_SERVICE_ORIGIN: ORIGIN };
const server = createServer(async (req, res) => {
  try {
    const chunks = []; for await (const c of req) chunks.push(c); const body = Buffer.concat(chunks);
    const r = await chalk.fetch(new Request('http://localhost' + req.url, { method: req.method, headers: req.headers, body: body.length ? body : undefined }), env, {});
    res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer()));
  } catch (e) { res.writeHead(500); res.end(String(e)); }
});
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const origin = 'http://127.0.0.1:' + server.address().port;

let browser, n = 0;
const ok = (name) => { n++; console.log('PASS ' + name); };
// Brings the confirm step to a passed candidate v2 through the page's own readiness button.
async function open(width = 1280, colorScheme = 'light') {
  const page = await browser.newPage({ viewport: { width, height: 900 }, colorScheme });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.on('dialog', (d) => d.accept());
  await page.goto(origin + '/authoring');
  await page.locator('details').evaluateAll((es) => es.forEach((e) => (e.open = true)));
  await page.locator('#token').fill('instructor-token');
  await page.locator('#cohort').fill('cohort-1'); await page.locator('#profile').fill('profile-1'); await page.locator('#course').fill('course-1');
  await page.evaluate(() => { candidateVersion = 'v2'; bound = identity(); controls(); }); // the state a freeze leaves behind
  await page.locator('#readiness-load').click();
  await page.locator('#confirm-diff-summary').filter({ hasNotText: '비교하는 중' }).filter({ hasNotText: '리허설을 통과하면' }).waitFor();
  return { page, errors };
}
const summary = (page) => page.locator('#confirm-diff-summary').textContent();

try {
  browser = await chromium.launch(process.env.HPS_BROWSER_CHANNEL ? { channel: process.env.HPS_BROWSER_CHANNEL } : {});

  reset();
  for (const scheme of ['light','dark']) for (const width of [375,800,1420]) {
    const { page, errors } = await open(width,scheme);
    assert.equal(await page.locator('#confirm-groups').count(),1,'grouped candidate comparison exists');
    assert.match(await page.locator('#confirm-groups-status').textContent(),/확정 버전 v1 → 후보 v2/);
    assert.deepEqual(await page.locator('#confirm-groups-list h4').allTextContents(),['지시문']);
    const rects=await page.evaluate(()=>{const a=document.querySelector('#confirm-groups').getBoundingClientRect(),b=document.querySelector('#confirm-diff').getBoundingClientRect();return {al:a.left,ar:a.right,at:a.top,ab:a.bottom,bl:b.left,bt:b.top};});
    if(width>=768){assert.ok(rects.ar<=rects.bl&&Math.abs(rects.at-rects.bt)<1,'groups left, instructions right');}else assert.ok(rects.ab<=rects.bt,'mobile stacks groups before instruction diff');
    await page.locator('#confirm-groups-list summary').first().click();
    assert.ok((await page.locator('#confirm-groups-list pre').allTextContents()).some(t=>t.includes(XSS)),'full candidate is available as literal text');
    assert.equal(await page.locator('#confirm-groups-list img').count(),0);
    const colors=await page.locator('#confirm-diff-lines ins, #confirm-diff-lines del, #confirm-diff-lines .diff-glyph, #confirm-groups-list summary, #confirm-groups-list pre').evaluateAll(es=>es.map(e=>{const chain=[];for(let p=e;p;p=p.parentElement)chain.push(getComputedStyle(p).backgroundColor);let bg=[255,255,255];for(const color of chain.reverse()){const v=color.match(/[\d.]+/g).map(Number),alpha=v.length===4?v[3]:1;bg=bg.map((b,i)=>v[i]*alpha+b*(1-alpha));}return {fg:getComputedStyle(e).color,bg:'rgb('+bg.join(',')+')'};}));
    const lum=c=>{const v=c.match(/[\d.]+/g).slice(0,3).map(Number).map(x=>{x/=255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4});return .2126*v[0]+.7152*v[1]+.0722*v[2];};
    for(const c of colors){const a=lum(c.fg),b=lum(c.bg);assert.ok((Math.max(a,b)+.05)/(Math.min(a,b)+.05)>=4.5,'diff contrast in '+scheme+' '+JSON.stringify(c));}
    const targets=await page.locator('#confirm-groups-list summary').evaluateAll(es=>es.map(e=>({h:e.getBoundingClientRect().height,font:parseFloat(getComputedStyle(e).fontSize)})));
    for(const t of targets){assert.ok(t.h>=44);assert.ok(t.font>=14);}
    const valueFonts=await page.locator('#confirm-groups-list pre').evaluateAll(es=>es.map(e=>parseFloat(getComputedStyle(e).fontSize)));
    assert.ok(valueFonts.length>=2&&valueFonts.every(f=>f>=14),'previous/new value text is >=14px at '+width+': '+valueFonts);
    await page.keyboard.press('Tab');await page.locator('#confirm-groups-list').focus();
    assert.equal(await page.locator('#confirm-groups-list').evaluate(e=>getComputedStyle(e).outlineStyle),'solid','keyboard focus ring');
    assert.equal(await page.locator('#confirm-groups-list').evaluate(e=>getComputedStyle(e).outlineOffset),'-2px','scroll container uses inset ring');
    await page.keyboard.press('End');await page.waitForTimeout(100);
    assert.ok(await page.locator('#confirm-groups-list').evaluate(e=>e.scrollTop>0),'keyboard reaches lower changed values');
    await page.locator('#confirm-groups-list').evaluate(e=>e.scrollTop=0);
    const rows = await page.locator('#confirm-diff-lines > li').evaluateAll((els) => els.map((e) => ({ cls: e.className, text: e.textContent, sr: e.querySelector('.sr-only')?.textContent ?? null })));
    const adds = rows.filter((r) => r.cls === 'diff-add'), dels = rows.filter((r) => r.cls === 'diff-del');
    assert.ok(adds.length >= 2 && dels.length >= 1, JSON.stringify(rows));
    // Missing 추가/삭제 screen-reader text.
    assert.ok(adds.every((r) => /^추가(\(공백만 바뀜\))?: $/.test(r.sr) && r.text.startsWith(r.sr + '+')), 'every added row starts with the spoken 추가 word, then +');
    assert.ok(dels.every((r) => /^삭제(\(공백만 바뀜\))?: $/.test(r.sr) && r.text.startsWith(r.sr + '−')), 'every removed row starts with the spoken 삭제 word, then −');
    const srBox = await page.locator('#confirm-diff-lines .sr-only').first().evaluate((e) => { const r = e.getBoundingClientRect(); return [r.width, r.height]; });
    assert.ok(srBox[0] <= 1 && srBox[1] <= 1, 'the spoken word is visually hidden, not removed');
    // innerHTML injection of line text.
    assert.equal(await page.locator('#confirm-diff-lines img, #confirm-diff-lines script').count(), 0, 'lesson text never becomes markup');
    assert.equal(await page.evaluate(() => window.__xss), undefined);
    assert.ok(adds.some((r) => r.text.endsWith(XSS)), 'the markup-looking line is shown as literal text');
    // Underline / strike removed.
    const deco = await page.evaluate(() => ({ ins: getComputedStyle(document.querySelector('#confirm-diff-lines ins')).textDecorationLine, del: getComputedStyle(document.querySelector('#confirm-diff-lines del')).textDecorationLine }));
    assert.match(deco.ins, /underline/, 'added text is underlined, not colour only'); assert.match(deco.del, /line-through/, 'removed text is struck, not colour only');
    // Whitespace-only change is visible.
    assert.ok(rows.some((r) => r.cls === 'diff-add' && r.text.includes('끝·공백·없음·')), 'a trailing space is drawn');
    assert.deepEqual(await page.locator('#confirm-diff-lines .diff-ws').allTextContents(), ['공백만 바뀜', '공백만 바뀜'], 'the whitespace-only pair carries a visible label');
    // CRLF + trailing newline in the base produce no false rows for the unchanged lines.
    assert.ok(!rows.some((r) => r.text.includes('시작 예제를 엽니다') && r.cls !== 'diff-same'));
    // The fold row is rendered and expands by keyboard.
    const fold = page.locator('#confirm-diff-lines > li.diff-fold button');
    assert.equal(await fold.count(), 1, 'the long unchanged run is one fold row');
    assert.match(await fold.textContent(), /^변경 없음 \d+줄 · 펼치기$/);
    assert.equal(await page.locator('#confirm-go').isDisabled(), false, 'a loaded diff allows confirm');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), 0, 'no horizontal overflow');
    await page.locator('#confirm').screenshot({ path: `${out}/confirm-diff-${scheme}-${width}.png` });
    await fold.focus(); await page.keyboard.press('Enter');
    assert.equal(await page.locator('#confirm-diff-lines > li.diff-fold').count(), 0, 'Enter expands the fold');
    assert.ok((await page.locator('#confirm-diff-lines > li.diff-same').count()) >= 9, 'the folded lines are back');
    await page.locator('#confirm').screenshot({ path: `${out}/confirm-diff-${scheme}-${width}-expanded.png` });
    assert.deepEqual(errors, []);
    await page.close();
  }
  ok('diff rows: spoken 추가/삭제 + glyph, literal text (no markup), underline/strike, whitespace label, fold row that expands — light/dark preference at 375, 800 and 1420px');

  reset();
  { const {page}=await open(375);await page.emulateMedia({forcedColors:'active'});
    const styles=await page.evaluate(()=>({add:getComputedStyle(document.querySelector('#confirm-diff-lines ins')).textDecorationLine,del:getComputedStyle(document.querySelector('#confirm-diff-lines del')).textDecorationLine}));
    assert.match(styles.add,/underline/);assert.match(styles.del,/line-through/);
    await page.keyboard.press('Tab');await page.locator('#confirm-groups-list').focus();
    assert.equal(await page.locator('#confirm-groups-list').evaluate(e=>getComputedStyle(e).outlineStyle),'solid');await page.close(); }
  ok('forced colours retain additions/deletions and keyboard focus');

  // A re-read that fails must not leave the previous grouped values on screen (they belong to a base that is no longer proven).
  reset();
  { const { page } = await open();
    assert.ok(await page.locator('#confirm-groups-list section').count() > 0, 'groups are shown after a good read');
    S.baseStatus = 502; await page.locator('#readiness-load').click();
    await page.locator('#confirm-diff-summary').filter({ hasText: '비교를 불러오지 못했습니다' }).waitFor();
    assert.equal(await page.locator('#confirm-groups-list section').count(), 0, 'failed re-read clears the old grouped values');
    assert.match(await page.locator('#confirm-groups-status').textContent(), /불러오지 못했습니다/);
    await page.close(); }
  ok('a failed re-read clears the previously shown grouped values');

  // Confirm enabled after a failed diff.
  reset({ baseStatus: 502 });
  { const { page } = await open();
    assert.match(await summary(page), /비교를 불러오지 못했습니다/);
    assert.equal(await page.locator('#confirm-go').isDisabled(), true, 'a failed diff keeps confirm locked');
    assert.equal(await page.locator('#confirm-groups-list section').count(),0,'failed reads cannot retain old grouped values');
    const look = await page.locator('#confirm-go').evaluate((b) => { const s = getComputedStyle(b); return { bg: s.backgroundColor, border: s.borderStyle, cursor: s.cursor }; });
    assert.equal(look.border, 'dashed', 'the locked button looks locked'); assert.equal(look.bg, 'rgba(0, 0, 0, 0)');
    await page.locator('#confirm').screenshot({ path: `${out}/confirm-diff-load-failed.png` });
    S.baseStatus = 200; await page.locator('#confirm-diff-retry').click();
    await page.locator('#confirm-diff-summary').filter({ hasText: '추가' }).waitFor();
    assert.equal(await page.locator('#confirm-go').isDisabled(), false, 'retry after recovery unlocks');
    await page.close(); }
  ok('failed diff locks confirm (and the button looks locked); retry recovers');

  // Unexpected base shape and an unprovable "first confirmation" stay locked; a proven first confirmation does not.
  reset({ baseShape: 'flat' });
  { const { page } = await open(); assert.match(await summary(page), /응답 형식이 예상과 다릅니다/); assert.equal(await page.locator('#confirm-go').isDisabled(), true); await page.close(); }
  reset({ versions: [{ version: 'v2', confirmed: false }], truncated: true });
  { const { page } = await open(); assert.match(await summary(page), /최근 버전 1개 안에 확정 버전이 없어/); assert.equal(await page.locator('#confirm-go').isDisabled(), true, 'a truncated list is not proof of a first confirmation'); await page.close(); }
  reset({ versions: [{ version: 'v2', confirmed: false }], truncated: false });
  { const { page } = await open(); assert.match(await summary(page), /첫 확정 버전/); assert.equal(await page.locator('#confirm-go').isDisabled(), false); await page.close(); }
  ok('wrong base shape and a truncated list keep confirm locked; a complete list with no confirmed version is a first confirmation');

  // The base moved after the review: confirm refuses, re-diffs, and only then confirms naming the new base.
  reset({ base: { v1: V1, v3: lessonOf([['홈페이지 열기', '다른 탭에서 확정한 안내'], ['문구 고치기', '소개 문구를 고칩니다.']]) } });
  { const { page } = await open();
    assert.match(await summary(page), /확정 버전 v1 → 이 후보 v2/);
    S.versions = [{ version: 'v3', confirmed: true }, { version: 'v2', confirmed: false }, { version: 'v1', confirmed: true }];
    await page.locator('#confirm-go').click();
    await page.locator('#confirm-status').filter({ hasText: '확정하지 않았습니다' }).waitFor();
    assert.equal(S.posts.length, 0, 'no confirmation was sent against a stale base');
    assert.match(await summary(page), /확정 버전 v3 → 이 후보 v2/, 'the diff was redone against the new base');
    assert.match(await page.locator('#confirm-groups-status').textContent(),/확정 버전 v3 → 후보 v2/,'both columns use new base');
    await page.locator('#confirm-go').click();
    await page.locator('#confirm-status').filter({ hasText: '확정했습니다' }).waitFor();
    assert.equal(S.posts.length, 1); assert.equal(S.posts[0].compared_with, 'v3', 'the request names the reviewed base');
    assert.match(await summary(page), /확정됐습니다/, 'after confirming, the block no longer claims a v3 → v2 comparison');
    await page.close(); }
  ok('a base confirmed elsewhere after the review blocks confirm, re-diffs, then confirm sends compared_with');

  console.log(`${n} confirm-diff browser checks passed`);
} finally { await browser?.close(); server.close(); }
