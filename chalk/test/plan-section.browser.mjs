// CGP-ART-R-004 / CGP-ART-D-004 (REQ-ART-04, DES-ART-04) — 계획서 · 부분 고치기 on the REAL served /authoring page, headless
// Chromium (CDP) at 1280 and 768 px. The Service is stubbed behind window.fetch and follows the contract of
// hypeproof-service#433: POST .../plan/section-revision answers 404 while the flag is off and 400 for an empty body while it is on,
// otherwise {changed, revision, from_revision, findings}; GET .../plan returns the stored file; GET .../diff returns the FB-01
// changes. The plan is the Service's real r5.html fixture (test/fixtures/chalk-plan/r5.html, byte-identical to
// hypeproof-service worker/test/fixtures/chalk-plan/r5.html), with hostile markup added to one section.
// Checked (all geometry is relative to elements on the page, so no assertion depends on a font):
//   1. flag off → the view stays hidden (probe body is {}); flag on → it shows;
//   2. the plan is drawn inert: no script, style, link, image or handler survives, only data-chalk-* attributes;
//   3. every section and every unique item marker is focusable (tabindex=0); a real pointer move draws the 1px outline (≥3:1 on
//      the paper) on the innermost mark and reveals no action; a real click or a real Tab selects it and shows "이 부분 고치기"
//      at the section's top end corner;
//   4. Enter opens the composer anchored under the section; Esc closes it and gives focus back; IME-safe field;
//   5. sending posts {at (marker key, no line number), request, expected_revision, request_id}; the draft is read back, the plan is
//      redrawn and the result opens in the compare (GET .../diff from → to); the revised section is marked;
//   6. 409 / 429 / 422 / unchanged / 404 copy; unsaved edits block sending;
//   7. 44px targets, 14px text floor, no horizontal scroll; forced-colors keeps the outline.
// Without a browser this prints NOT RUN; with FOCUS_REQUIRE_BROWSER=1 (CI) a missing browser fails.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import '@hypeproof/service-testkit/test/harness/loader.mjs';
import { TEST_CONNECT_SECRET, sessionCookie } from './harness/connect.mjs';
import { findChromium, launch } from '../../extensions/hypeproof-chat/test/lib/headless-chromium.mjs';

const bin = findChromium();
if (!bin) {
  if (process.env.FOCUS_REQUIRE_BROWSER) { console.error('plan-section.browser: no headless Chromium and FOCUS_REQUIRE_BROWSER=1'); process.exit(1); }
  console.log('  NOT RUN  plan-section.browser (no headless Chromium)');
  process.exit(0);
}
const R5 = readFileSync(new URL('./fixtures/chalk-plan/r5.html', import.meta.url), 'utf8');
const HOSTILE = '<p>참고 <a href="https://example.test/x" style="color:red">링크</a><img src="x" onerror="window.__xss=1"><script>window.__xss=2</script><b onclick="window.__xss=3">굵게</b></p>';
const PLAN = R5.replace('<section data-chalk-section="bridging">', '<section data-chalk-section="bridging">' + HOSTILE);
assert.notEqual(PLAN, R5);
const TEACHER_BEFORE = '주제 카드(예: 약이 하는 일, 몸속 세포 이야기 등) 중 고르게 하고 7분, 8분으로 나눠 타이머를 켠다.';
const TEACHER_AFTER = '짝끼리 역할을 정하게 하고 3분 뒤 한 팀씩 확인한다.';
assert.ok(PLAN.includes(TEACHER_BEFORE));
const REVISED = PLAN.replace(TEACHER_BEFORE, TEACHER_AFTER);
const SECTIONS = [...R5.matchAll(/data-chalk-section="([a-z-]+)"/g)].map((m) => m[1]);
const SAVED = { schema: 'hps-session-design/1', title: '첫 수업', audience: '초등', duration_minutes: 90, objective: '목표', starter: '예제', prerequisites: '', steps: [{ id: 's1', title: '1단계', instructions: '', hint: '', acceptance: '' }] };

const { default: app } = await import('../src/index.ts');
const server = createServer(async (req, res) => {
  const r = await app.fetch(new Request('http://127.0.0.1' + req.url, { headers: { cookie: await sessionCookie('t') } }), { ENVIRONMENT: 'test', HPS_CHALK_CONNECT_SECRET: TEST_CONNECT_SECRET });
  res.writeHead(r.status, Object.fromEntries(r.headers));
  res.end(Buffer.from(await r.arrayBuffer()));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
const b = await launch(bin);
const ev = (js) => b.evaluate(`(() => { ${js} })()`);
async function until(js, what) {
  for (let i = 0; i < 200; i++) { if (await ev(js).catch(() => false)) return; await new Promise((r) => setTimeout(r, 25)); }
  throw new Error('timed out waiting for ' + what);
}
// window.__flag 'off' | 'on'; window.__rev draft revision; window.__answer null (normal) or {status, body}.
const stub = `window.__posts=[];window.__gets=[];window.__rev=3;window.__flag='on';window.__answer=null;window.__plan=${JSON.stringify(PLAN)};window.__planRef=2;
  window.fetch=async(path,init)=>{const p=String(path),m=(init&&init.method)||'GET';
  const json=(o,status=200)=>new Response(JSON.stringify(o),{status,headers:{'content-type':'application/json'}});
  if(p.endsWith('/proposal'))return json({error:'not found'},404);
  if(p.endsWith('/plan/section-revision')&&m==='POST'){const body=JSON.parse(init.body);window.__posts.push(body);
    if(window.__flag==='off')return json({error:'not found'},404);
    if(typeof body.request!=='string')return json({code:'invalid_request',error:'request required'},400);
    if(window.__answer)return json(window.__answer.body,window.__answer.status);
    if(body.expected_revision!==window.__rev)return json({code:'revision_conflict',reason:'stale_revision',revision:window.__rev},409);
    const from=window.__planRef;window.__plan=${JSON.stringify(REVISED)};window.__rev+=1;window.__planRef=window.__rev;
    return json({revision:window.__rev,sha256:'x',findings:[],changed:true,file:'lesson',from_revision:from,feedback_id:'fb_1',cost:{}});}
  window.__gets.push(p);
  if(p.includes('/plan?file=lesson'))return json({html:window.__plan,sha256:'s',knowledge_version:1,ref_kind:'draft',ref:String(window.__planRef)});
  if(p.includes('/plan?file=ops'))return json({error:'plan file not found'},404);
  if(p.includes('/diff?'))return json({from_revision:2,to_revision:window.__rev,file:'lesson',changes:[{key:'flow/s-2:teacher',kind:'changed',before:${JSON.stringify(TEACHER_BEFORE)},after:${JSON.stringify(TEACHER_AFTER)}}]});
  if(m==='GET')return json({profile_id:'p1',revision:window.__rev,content:${JSON.stringify(SAVED)}});
  return json({});};
  for(const [k,v] of [['cohort','c1'],['profile','p1'],['course','course-1']])document.getElementById(k).value=v;return 0`;
const $ = (id) => `document.getElementById('${id}')`;
const lum = `const lum=c=>{const m=c.match(/[\\d.]+/g).slice(0,3).map(Number).map(v=>{v/=255;return v<=0.03928?v/12.92:((v+0.055)/1.055)**2.4;});return 0.2126*m[0]+0.7152*m[1]+0.0722*m[2];};const ratio=(a,b)=>{const x=lum(a),y=lum(b);return (Math.max(x,y)+0.05)/(Math.min(x,y)+0.05);};`;
const markSel = (at) => `[...document.querySelectorAll('#plan-paper .plan-mark')].find(e=>e.dataset.planAt===${JSON.stringify(JSON.stringify(at))})`;
const S2 = { file: 'lesson', section: 'flow', marker: { name: 'data-chalk-step', value: 's-2' } };
async function openDraft() {
  await ev(`${$('load')}.click();return 0`);
  await until(`return !busy && bound===identity() && revision===window.__rev`, 'the saved draft to open');
}
async function key(k, code = k, vk = 0) {
  for (const type of ['keyDown', 'keyUp']) await b.send('Input.dispatchKeyEvent', { type, key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
}
async function tabTo(js, what) {
  for (let i = 0; i < 120; i++) { if (await ev(js)) return; await key('Tab', 'Tab', 9); }
  throw new Error('Tab never reached ' + what);
}
async function type(text) {
  await ev(`const e=${$('plan-text')};e.value=${JSON.stringify(text)};e.dispatchEvent(new Event('input',{bubbles:true}));return 0`);
}
let checks = 0;
try {
  for (const width of [1280, 768]) {
    await b.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
    await b.send('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'none' }] });
    await b.send('Page.navigate', { url: origin + '/authoring' });
    await until(`return document.readyState==='complete' && typeof planControls==='function' && !!window.chalkConnection?.current?.connected`, '/authoring with the plan view');
    await ev(stub);

    // 1. Flag off → hidden; flag on → shown.
    assert.equal(await ev(`return ${$('plan-view')}.hidden`), true, `${width}px: hidden before a draft is open`);
    await ev(`window.__flag='off';return 0`);
    await openDraft();
    await until(`return window.__posts.length===1`, 'the probe');
    assert.deepEqual(await ev(`return window.__posts`), [{}], `${width}px: the probe is an empty body`);
    assert.equal(await ev(`return ${$('plan-view')}.hidden`), true, `${width}px: flag off hides the view`);
    await ev(`window.__flag='on';planAvail.clear();window.__posts.length=0;return 0`);
    await openDraft();
    await until(`return !${$('plan-view')}.hidden`, 'the view to show');
    checks += 3;

    // 2. Load → inert paper.
    await ev(`window.__xss=0;${$('plan-load')}.click();return 0`);
    await until(`return !busy && document.querySelectorAll('#plan-paper .plan-mark').length>0`, 'the plan to render');
    const paper = await ev(`const p=${$('plan-paper')};const attrs=new Set();for(const e of p.querySelectorAll('*'))for(const a of e.attributes)attrs.add(a.name);
      return {bad:p.querySelectorAll('script,style,a,img,link,iframe,[onerror],[onclick],[style],[href],[src]').length,attrs:[...attrs].filter(a=>!a.startsWith('data-chalk-')&&!a.startsWith('data-plan-')).sort(),
        xss:window.__xss,sections:[...p.querySelectorAll('section.plan-mark')].map(s=>s.dataset.chalkSection),
        tab:[...p.querySelectorAll('.plan-mark')].every(e=>e.tabIndex===0),text:p.textContent.includes(${JSON.stringify(TEACHER_BEFORE)})&&p.textContent.includes('굵게')&&p.textContent.includes('링크'),
        items:[...p.querySelectorAll('.plan-mark:not(section)')].map(e=>JSON.parse(e.dataset.planAt).marker.name+'='+JSON.parse(e.dataset.planAt).marker.value)}`);
    assert.equal(paper.bad, 0, `${width}px: no executable or loading markup survives`);
    assert.deepEqual(paper.attrs, ['aria-describedby', 'class', 'tabindex'], `${width}px: only data-chalk-* (plus the page's own focus attributes) are kept`);
    assert.equal(paper.xss, 0, `${width}px: no handler ran`);
    assert.deepEqual(paper.sections, SECTIONS, `${width}px: every section is a mark, in order`);
    assert.equal(paper.tab, true, `${width}px: every mark is focusable`);
    assert.equal(paper.text, true, `${width}px: text is kept as text`);
    for (const m of ['data-chalk-step=s-1', 'data-chalk-step=s-2', 'data-chalk-objective=obj-1', 'data-chalk-move=P1', 'data-chalk-evidence=ev-1']) assert.ok(paper.items.includes(m), `${width}px: ${m} is selectable (${paper.items})`);
    checks += 7;

    // 3a. A real pointer move draws the 1px outline on the innermost mark only, and reveals no action (REQ-CHALK-ROW-ACTIONS);
    //     a real click selects the mark (focus) and shows "이 부분 고치기" at its top end corner.
    const r = await ev(`${markSel(S2)}.scrollIntoView({block:'center'});const r=${markSel(S2)}.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2}`);
    await b.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: r.x, y: r.y });
    await until(`return ${markSel(S2)}.matches(':hover')`, 'the pointer over s-2');
    const hover = await ev(`${lum}const m=${markSel(S2)},s=getComputedStyle(m),paper=getComputedStyle(${$('plan-paper')}).backgroundColor,flow=getComputedStyle(${markSel({ file: 'lesson', section: 'flow' })});
      return {w:s.outlineWidth,st:s.outlineStyle,ratio:ratio(s.outlineColor,paper),flowOutline:flow.outlineColor===s.outlineColor,fix:${$('plan-fix')}.hidden}`);
    assert.deepEqual({ w: hover.w, st: hover.st }, { w: '1px', st: 'solid' }, `${width}px: hover draws a 1px outline`);
    assert.ok(hover.ratio >= 3, `${width}px: outline contrast ${hover.ratio.toFixed(2)} ≥ 3 on the paper`);
    assert.equal(hover.flowOutline, false, `${width}px: the enclosing section is not outlined`);
    assert.equal(hover.fix, true, `${width}px: hover alone reveals no action`);
    for (const type of ['mousePressed', 'mouseReleased']) await b.send('Input.dispatchMouseEvent', { type, x: r.x, y: r.y, button: 'left', clickCount: 1 });
    await until(`return document.activeElement===${markSel(S2)} && !${$('plan-fix')}.hidden`, 'a click to select the mark');
    const click = await ev(`const m=${markSel(S2)},f=${$('plan-fix')},fr=f.getBoundingClientRect(),mr=m.getBoundingClientRect();
      return {others:document.querySelectorAll('#plan-paper .plan-active').length,text:f.textContent,h:fr.height,font:parseFloat(getComputedStyle(f).fontSize),dTop:Math.abs(fr.top-mr.top),dEnd:Math.abs(fr.right-mr.right)}`);
    assert.equal(click.others, 1, `${width}px: only the innermost mark is selected`);
    assert.equal(click.text, '이 부분 고치기');
    assert.ok(click.h >= 44 && click.font >= 14, `${width}px: button ${click.h}px tall, ${click.font}px text`);
    assert.ok(click.dTop <= 2 && click.dEnd <= 2, `${width}px: the button sits at the section's top end corner (${click.dTop}, ${click.dEnd})`);
    checks += 8;
    await b.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 1 });
    await ev(`${$('plan-load')}.focus();return 0`);
    await until(`return ${$('plan-fix')}.hidden && !document.querySelector('#plan-paper .plan-active')`, 'leaving the plan to clear the selection');

    // 3b. Keyboard focus with a real Tab.
    await tabTo(`return document.activeElement===${markSel(S2)}`, 'the s-2 step');
    const focus = await ev(`${lum}const m=${markSel(S2)},s=getComputedStyle(m),paper=getComputedStyle(${$('plan-paper')}).backgroundColor;return {fv:m.matches(':focus-visible'),active:m.classList.contains('plan-active'),fix:!${$('plan-fix')}.hidden,ow:parseFloat(s.outlineWidth),ratio:ratio(s.outlineColor,paper)}`);
    assert.deepEqual({ fv: focus.fv, a: focus.active, f: focus.fix }, { fv: true, a: true, f: true }, `${width}px: keyboard focus shows the outline and the button`);
    assert.ok(focus.ow >= 1 && focus.ratio >= 3, `${width}px: focus outline ${focus.ow}px at ${focus.ratio.toFixed(2)}:1`);
    checks += 2;

    // 4. Enter opens the anchored composer; Esc closes and gives focus back.
    await key('Enter', 'Enter', 13);
    await until(`return !${$('plan-composer')}.hidden && document.activeElement===${$('plan-text')}`, 'Enter to open the composer');
    const comp = await ev(`const c=${$('plan-composer')}.getBoundingClientRect(),m=${markSel(S2)}.getBoundingClientRect(),t=${$('plan-text')};
      return {title:${$('plan-composer-title')}.textContent,below:c.top-m.bottom,startGap:Math.abs(c.left-${$('plan-wrap')}.getBoundingClientRect().left),target:${markSel(S2)}.classList.contains('plan-target'),
        max:t.maxLength,send:${$('plan-send')}.disabled,font:Math.min(...['plan-composer-title','plan-text','plan-count'].map(i=>parseFloat(getComputedStyle(document.getElementById(i)).fontSize))),
        btn:[...document.querySelectorAll('#plan-composer button')].map(b=>b.getBoundingClientRect().height),past:[...document.querySelectorAll('#plan-composer, #plan-composer *')].filter(e=>e.getBoundingClientRect().right>innerWidth+0.5).length}`);
    assert.equal(comp.title, '‘수업 흐름 · 단계 s-2’ 고치기', `${width}px: the composer names the section`);
    assert.ok(comp.below >= 0 && comp.below <= 8, `${width}px: the composer opens right under the section (${comp.below}px)`);
    assert.equal(comp.target, true);
    assert.deepEqual({ max: comp.max, send: comp.send }, { max: 500, send: true }, `${width}px: 500 cap, send disabled while empty`);
    assert.ok(comp.font >= 14, `${width}px: composer text ${comp.font}px ≥ 14`);
    assert.ok(comp.btn.every((h) => h >= 44), `${width}px: composer buttons ${comp.btn}`);
    assert.equal(comp.past, 0, `${width}px: the composer stays inside the viewport`);
    await key('Escape', 'Escape', 27);
    await until(`return ${$('plan-composer')}.hidden && document.activeElement===${markSel(S2)}`, 'Esc to close and refocus');
    checks += 8;

    // 6a. Unsaved edits block sending.
    await key('Enter', 'Enter', 13);
    await type('선생님 활동을 짝 활동으로 바꿔 주세요');
    assert.equal(await ev(`return ${$('plan-send')}.disabled`), false, `${width}px: typing enables send`);
    await ev(`dirty=true;controls();return 0`);
    assert.deepEqual(await ev(`return {d:${$('plan-send')}.disabled,h:${$('plan-hint')}.textContent}`), { d: true, h: '저장하지 않은 편집이 있어요. 먼저 저장한 뒤에 부탁해 주세요.' }, `${width}px: unsaved edits block sending`);
    await ev(`dirty=false;controls();return 0`);
    checks += 2;

    // 6b. Error copy; nothing changes.
    for (const [status, body, note] of [
      [409, { code: 'revision_conflict', reason: 'stale_revision' }, '계획서나 초안이 그사이 바뀌었어요. 저장본을 다시 열고 다시 부탁해 주세요.'],
      [429, { code: 'daily_cap' }, '오늘 AI 부탁 한도를 다 썼어요. 내일 다시 부탁해 주세요.'],
      [422, { code: 'section_new_link' }, 'AI가 고친 내용이 계획서 규칙에 맞지 않아 넣지 않았어요. 아무것도 바뀌지 않았어요. 다르게 부탁해 보세요.'],
      [200, { changed: false, revision: 3 }, 'AI가 이 부분에서 바꿀 곳을 찾지 못했어요. 무엇을 어떻게 바꿀지 조금 더 구체적으로 적어 주세요.'],
    ]) {
      await ev(`window.__answer={status:${status},body:${JSON.stringify(body)}};${$('plan-send')}.click();return 0`);
      await until(`return !busy && ${$('plan-note')}.textContent===${JSON.stringify(note)}`, `${status} copy`);
      assert.equal(await ev(`return revision`), 3, `${width}px: ${status} keeps the draft revision`);
    }
    await ev(`window.__answer=null;return 0`);
    checks += 4;

    // 5. Send → draft read back, plan redrawn, compare opened.
    const getsBefore = await ev(`return window.__gets.length`);
    await ev(`window.__posts.length=0;${$('plan-send')}.click();return 0`);
    await until(`return !busy && !${$('plan-compare')}.hidden`, 'the compare to open');
    const sent = await ev(`return window.__posts[0]`);
    assert.deepEqual({ ...sent, request_id: undefined }, { at: S2, request: '선생님 활동을 짝 활동으로 바꿔 주세요', expected_revision: 3, request_id: undefined }, `${width}px: the request carries the marker key and the draft revision`);
    assert.match(sent.request_id, /^plan-[0-9a-f-]{36}$/);
    assert.equal(JSON.stringify(sent).match(/line|offset|pos/), null, `${width}px: no line number or offset is sent`);
    const after = await ev(`const rows=[...${$('plan-compare-table')}.tBodies[0].rows].map(r=>[...r.cells].map(c=>c.textContent));
      return {revision,dirty,gets:window.__gets.slice(${getsBefore}),rows,title:${$('plan-compare-title')}.textContent,focus:document.activeElement===${$('plan-compare-title')},
        text:${$('plan-paper')}.textContent.includes(${JSON.stringify(TEACHER_AFTER)}),revised:${markSel(S2)}?.classList.contains('plan-revised'),composer:${$('plan-composer')}.hidden,note:${$('plan-note')}.textContent}`);
    assert.equal(after.revision, 4, `${width}px: the draft revision moved to the saved one`);
    assert.equal(after.dirty, false);
    assert.ok(after.gets.some((p) => /\/authoring\/course-1$/.test(p)), `${width}px: the draft was read back`);
    assert.ok(after.gets.some((p) => p.includes('/plan?file=lesson')), `${width}px: the plan was read back`);
    assert.ok(after.gets.some((p) => p.includes('/diff?file=lesson&from=2&to=4')), `${width}px: the compare is the FB-01 diff from → to (${after.gets})`);
    assert.deepEqual(after.rows, [['flow/s-2:teacher', TEACHER_BEFORE, TEACHER_AFTER]], `${width}px: the compare shows before and after`);
    assert.equal(after.title, '‘수업 흐름 · 단계 s-2’을 고쳤어요 · revision 2 → 4');
    assert.deepEqual({ f: after.focus, t: after.text, r: after.revised, c: after.composer }, { f: true, t: true, r: true, c: true }, `${width}px: focus on the compare, plan redrawn, section marked`);
    assert.equal(after.note, '‘수업 흐름 · 단계 s-2’만 고쳐서 저장했어요 · revision 4. 바뀐 곳을 아래에서 확인하세요.');
    checks += 9;

    // 7. Layout and forced colors.
    const geo = await ev(`return {overflow:document.scrollingElement.scrollWidth-innerWidth,buttons:[...document.querySelectorAll('#plan-view button')].filter(e=>e.getBoundingClientRect().width>0).map(e=>e.getBoundingClientRect().height),
      fonts:[...document.querySelectorAll('#plan-view small,#plan-view label,.plan-fix')].map(e=>parseFloat(getComputedStyle(e).fontSize))}`);
    assert.ok(geo.overflow <= 0, `${width}px: no horizontal scroll (${geo.overflow})`);
    assert.ok(geo.buttons.every((h) => h >= 44), `${width}px: 44px targets ${geo.buttons}`);
    assert.ok(geo.fonts.every((f) => f >= 14), `${width}px: 14px floor ${geo.fonts}`);
    await b.send('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'active' }] });
    await ev(`${markSel(S2)}.focus();return 0`);
    const forced = await ev(`const s=getComputedStyle(${markSel(S2)});return {st:s.outlineStyle,c:s.outlineColor}`);
    assert.equal(forced.st, 'solid'); assert.notEqual(forced.c, 'rgba(0, 0, 0, 0)', `${width}px: forced colors keep a visible outline`);
    await b.send('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'none' }] });
    checks += 4;

    // 6c. A 404 on send hides the view; no plan for the other file says so.
    await ev(`${$('plan-file')}.value='ops';${$('plan-file')}.dispatchEvent(new Event('change'));${$('plan-load')}.click();return 0`);
    await until(`return !busy && ${$('plan-note')}.textContent===${JSON.stringify('이 강의에는 아직 저장된 계획서가 없어요. Studio 강사 모드에서 계획서를 만든 뒤 불러오세요.')}`, 'the no-plan copy');
    await ev(`${$('plan-file')}.value='lesson';${$('plan-file')}.dispatchEvent(new Event('change'));${$('plan-load')}.click();return 0`);
    await until(`return !busy && !!${markSel(S2)}`, 'the lesson plan again');
    await ev(`${markSel(S2)}.focus();return 0`);
    await key('Enter', 'Enter', 13);
    await type('다시');
    await ev(`window.__flag='off';${$('plan-send')}.click();return 0`);
    await until(`return !busy && ${$('plan-view')}.hidden`, '404 to hide the view');
    checks += 2;
  }
  console.log(`PASS plan-section.browser: ${checks} checks at 1280 and 768 px`);
} finally {
  await b.close();
  server.close();
}
