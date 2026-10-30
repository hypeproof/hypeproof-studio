// DES-02/03/06, DT-02/04, #3309. Actual served console; synthetic read responses only.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import '@hypeproof/service-testkit/test/harness/loader.mjs';
import { findChromium, launch } from '../../extensions/hypeproof-chat/test/lib/headless-chromium.mjs';

export async function runConsoleDurationBrowser() {
  const bin = findChromium();
  if (!bin) {
    if (process.env.FOCUS_REQUIRE_BROWSER) throw new Error('console-duration: Chromium required');
    console.log('NOT RUN console-duration: no Chromium');
    return;
  }
  const { default: app } = await import('../src/index.ts');
  const requests = [], errors = [], cases = [], sockets = new Set();
  const cohorts = ['duration-two', 'duration-six'];
  const scopes = cohorts.map((cohort, i) => ({ cohort, profiles: ['track-' + i], can_start_session: true, max_session_hours: i ? 6 : 2, max_hours: 2 }));
  // The page decodes this display-only fixture; no Service authentication is claimed.
  const issuer = Buffer.from(JSON.stringify({ role: 'issuer', u: 'Synthetic instructor', exp: Math.floor(Date.now() / 1000) + 3600, scopes })).toString('base64url') + '.synthetic';
  const server = createServer(async (req, res) => {
    requests.push({ method: req.method, path: req.url });
    try {
      if (req.method !== 'GET') throw new Error('Unexpected mutation request');
      let response;
      if (req.url === '/console') {
        response = await app.fetch(new Request('http://127.0.0.1/console'), { ENVIRONMENT: 'test' });
      } else if (req.url === '/workshop/boa-tokens') {
        response = Response.json({ targets: [] });
      } else if (req.url === '/favicon.ico') {
        response = new Response(null, { status: 204 });
      } else {
        const index = cohorts.findIndex(c => req.url === '/admin/cohorts/' + c + '/state');
        if (index < 0) throw new Error('Unexpected fixture path');
        response = Response.json({ id: cohorts[index], session: null, paused: false, roster_size: 0, scope: scopes[index], profiles: [{ id: 'track-' + index, display_name: '선택한 시간 확인용 수업 ' + (index + 1) }] });
      }
      res.writeHead(response.status, {
        ...Object.fromEntries(response.headers),
        // Only the owned read fixture is reachable from this browser page.
        'content-security-policy': "connect-src 'self'; img-src 'self' data:; font-src 'self'; form-action 'none'",
      });
      res.end(await response.text());
    } catch (error) {
      errors.push(error.message); res.writeHead(500); res.end('{}');
    }
  });
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  let browser;
  const evidence = process.env.CHALK_DURATION_EVIDENCE;
  if (evidence) mkdirSync(evidence, { recursive: true });
  const wait = ms => new Promise(done => setTimeout(done, ms));
  async function until(expression, label) {
    for (let i = 0; i < 100; i++) {
      if (await browser.evaluate(expression).catch(() => false)) return;
      await wait(25);
    }
    throw new Error('Timed out: ' + label);
  }
  async function click(selector) {
    const p = await browser.evaluate(`(() => {const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    await browser.send('Input.dispatchMouseEvent', { type: 'mousePressed', ...p, button: 'left', clickCount: 1 });
    await browser.send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...p, button: 'left', clickCount: 1 });
  }
  async function press(key, code) {
    for (const type of ['keyDown', 'keyUp']) await browser.send('Input.dispatchKeyEvent', { type, key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code });
  }
  async function capture(name) {
    if (!evidence) return;
    const previous = await browser.evaluate("document.getElementById('issuer').getAttribute('style')");
    await browser.evaluate("document.getElementById('issuer').style.cssText+=';color:transparent!important;background:magenta!important;caret-color:transparent!important'");
    try {
      const shot = await browser.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
      writeFileSync(resolve(evidence, name + '.png'), Buffer.from(shot.data, 'base64'));
    } finally {
      await browser.evaluate(`(()=>{const e=document.getElementById('issuer');const old=${JSON.stringify(previous)};if(old===null)e.removeAttribute('style');else e.setAttribute('style',old)})()`);
    }
  }
  const measure = () => browser.evaluate(`(() => {
    const zoom=Number(getComputedStyle(document.documentElement).zoom)||1;
    return { viewport:innerWidth, zoom, overflow:document.documentElement.scrollWidth-innerWidth, controls:[...document.querySelectorAll('[data-hours]')].map(e=>{
      const r=e.getBoundingClientRect(),s=getComputedStyle(e),label=e.labels[0],row=e.closest('.row'),rr=row.getBoundingClientRect();
      const clone=e.cloneNode(true);Object.assign(clone.style,{position:'fixed',visibility:'hidden',width:'max-content',minWidth:'0',maxWidth:'none',font:s.font});document.body.append(clone);const preferred=clone.getBoundingClientRect().width/zoom;clone.remove();
      const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');ctx.font=s.font;
      const range=document.createRange();if(label)range.selectNodeContents(label.firstChild);
      return {value:e.value,options:[...e.options].map(o=>o.value),selectedText:e.selectedOptions[0].textContent,width:r.width/zoom,height:r.height/zoom,preferredWidth:preferred,
        contentWidth:r.width/zoom-parseFloat(s.paddingLeft)-parseFloat(s.paddingRight)-parseFloat(s.borderLeftWidth)-parseFloat(s.borderRightWidth),textWidth:ctx.measureText(e.selectedOptions[0].textContent).width,
        labels:e.labels.length,labelText:label?.firstChild.textContent.trim(),labelFont:label?getComputedStyle(label).fontSize:null,labelLines:label?range.getClientRects().length:0,
        rowWidth:rr.width/zoom,contained:r.left>=rr.left-.5&&r.right<=rr.right+.5,active:document.activeElement===e,outlineWidth:s.outlineWidth,outlineStyle:s.outlineStyle};
    }), events:window.durationInputEvents??[] };
  })()`);
  function assertLayout(m, name) {
    assert.ok(m.overflow <= .5, name + ': no document overflow');
    assert.equal(m.controls.length, 2, name + ': both scoped tracks rendered');
    for (const c of m.controls) {
      assert.ok(c.width >= 44 && c.height >= 44, name + ': duration target at least44px');
      assert.ok(c.width + .5 >= c.preferredWidth && c.contentWidth >= c.textWidth, name + ': native selected text has room');
      assert.ok(c.contained, name + ': control stays in task row');
      assert.equal(c.labels, 1, name + ': exactly one associated label');
      assert.equal(c.labelText, '시간', name + ': meaningful accessible label');
      assert.equal(c.labelLines, 1, name + ': label is not split into vertical characters');
      assert.ok(parseFloat(c.labelFont) >= 14, name + ': readable permanent label');
    }
    assert.deepEqual(m.controls.map(c => c.options), [['1', '2'], ['1', '2', '3', '4', '5', '6']], name + ': existing duration caps preserved');
  }
  try {
    browser = await launch(bin);
    for (const [width, zoom] of [[375, 1], [390, 1], [768, 1], [1280, 1], [1440, 1], [1280, 2]]) {
      const name = width + (zoom === 2 ? '-css-page-zoom200' : '-normal');
      await browser.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
      const loaded = browser.waitForEvent(event => event.method === 'Page.loadEventFired', 'console navigation');
      await browser.send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/console` });
      await loaded;
      await until("document.readyState==='complete'&&!!document.querySelector('#issuer')", 'console page');
      await click('#issuer');
      // Select existing tab-scoped fixture text before entering it again, on Mac too.
      const modifiers = process.platform === 'darwin' ? 4 : 2;
      await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers });
      await browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers });
      await browser.send('Input.insertText', { text: issuer });
      await click('#load');
      await until("document.querySelectorAll('[data-hours]').length===2&&document.fonts.status==='loaded'", 'closed tracks');
      await browser.evaluate(`document.documentElement.style.zoom=${JSON.stringify(String(zoom))}`);
      await browser.evaluate("window.durationInputEvents=[];for(const t of ['pointerdown','keydown','input','change'])document.addEventListener(t,e=>{if(e.target.matches('[data-hours]'))window.durationInputEvents.push({type:e.type,key:e.key??null,value:e.target.value,trusted:e.isTrusted})},true)");
      const initial = await measure(), current = { name, initial }; cases.push(current);
      await capture(name + '-initial'); assertLayout(initial, name);
      assert.deepEqual(initial.controls.map(c => c.value), ['2', '4'], name + ': existing defaults preserved');
      // Real pointer followed by native select keys; popup appearance itself is not asserted.
      await click('[data-hours]'); await press('Home', 36); await press('Enter', 13);
      await until("document.querySelector('[data-hours]').value==='1'", 'native pointer/key choice');
      const pointer = await measure(); assertLayout(pointer, name + '/pointer');
      assert.ok(pointer.events.some(e => e.type === 'pointerdown' && e.trusted), name + ': trusted pointer');
      assert.ok(pointer.events.some(e => e.type === 'change' && e.trusted && e.value === '1'), name + ': trusted native selection');
      await click('#issuer');
      for (let n = 0; n < 10 && !await browser.evaluate("document.activeElement.matches('[data-hours]')"); n++) await press('Tab', 9);
      assert.ok(await browser.evaluate("document.activeElement.matches('[data-hours]')"), name + ': Tab reaches duration');
      await press('End', 35); await press('Enter', 13);
      const keyboard = await measure(); assertLayout(keyboard, name + '/keyboard');
      assert.equal(keyboard.controls[0].value, '2', name + ': keyboard chooses last allowed duration');
      assert.ok(keyboard.events.some(e => e.type === 'keydown' && e.key === 'End' && e.trusted), name + ': trusted keyboard');
      assert.ok(parseFloat(keyboard.controls[0].outlineWidth) >= 1 && keyboard.controls[0].outlineStyle !== 'none', name + ': visible keyboard focus');
      await capture(name);
      Object.assign(current, { pointer, keyboard, completed: true, zoomBoundary: zoom === 2 ? '200% CSS page zoom, not native browser-menu zoom' : '100%' });
    }
    assert.deepEqual(errors, [], 'read-only fixture succeeds');
    assert.ok(requests.every(r => r.method === 'GET'), 'selection never starts or changes a class');
  } finally {
    if (browser) await browser.close();
    for (const socket of sockets) socket.destroy();
    await new Promise(done => server.close(done));
    if (evidence) writeFileSync(resolve(evidence, 'results.json'), JSON.stringify({ cases, requests, errors, nativeBrowserZoom: 'NOT_RUN', nativePopupAppearance: 'NOT_PROVEN' }, null, 2) + '\n');
  }
  console.log(`PASS console-duration: ${cases.length} real browser layout/input cases; readable selection,44px,label,keyboard; CSS zoom explicitly scoped`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await runConsoleDurationBrowser();
