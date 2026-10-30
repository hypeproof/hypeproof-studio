// CGP-DS-R-005 / #3064: real served controls remain identifiable after forced colours remove fills.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import '@hypeproof/service-testkit/test/harness/loader.mjs';
import { findChromium, launch } from '../../extensions/hypeproof-chat/test/lib/headless-chromium.mjs';

const bin = findChromium();
if (!bin) {
  if (process.env.FOCUS_REQUIRE_BROWSER) throw new Error('forced-colors.browser: Chromium required');
  console.log('NOT RUN forced-colors.browser: no Chromium');
  process.exit(0);
}
const { default: app } = await import('../src/index.ts');
const routes = ['console', 'start', 'issuer', 'board', 'authoring', 'manage', 'budgets', 'sharing', 'learn'];
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  // Only page GETs are served. The fixture cannot issue production or Service requests.
  if (!routes.includes(path.slice(1)) || req.method !== 'GET') {
    res.writeHead(404); res.end('{}'); return;
  }
  const response = await app.fetch(new Request('http://127.0.0.1' + path), { ENVIRONMENT: 'test' });
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(await response.text());
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await launch(bin);
const evidence = process.env.CHALK_FORCED_COLORS_EVIDENCE;
if (evidence) mkdirSync(evidence, { recursive: true });
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const measure = () => browser.evaluate(`(() => {
  const controls = [...document.querySelectorAll('button,a.btn')].filter(e => {
    const r=e.getBoundingClientRect(),s=getComputedStyle(e);
    return r.width>0 && r.height>0 && s.visibility!=='hidden';
  });
  return { overflow:document.scrollingElement.scrollWidth-innerWidth, controls:controls.map(e => {
    const s=getComputedStyle(e),r=e.getBoundingClientRect();
    return { id:e.id, text:e.textContent.trim(), quiet:e.matches('.ghost,.reset'), disabled:e.matches(':disabled'),
      border:parseFloat(s.borderTopWidth), borderStyle:s.borderTopStyle, borderColor:s.borderTopColor,
      background:s.backgroundColor, width:r.width, height:r.height, color:s.color };
  }) };
})()`);
function checkBoundaries(result, label) {
  assert.ok(result.overflow <= 0.5, label + ': no page overflow');
  for (const control of result.controls) {
    if (control.quiet) {
      assert.equal(control.border, 0, label + ': text action stays quieter: ' + control.text);
    } else {
      assert.ok(control.border >= 1 && control.borderStyle === 'solid', label + ': bounded action: ' + control.text);
      assert.notEqual(control.borderColor, control.background, label + ': boundary differs from fill: ' + control.text);
    }
  }
}
const results = [];
try {
  for (const route of routes) for (const width of [320, 1280]) for (const dark of [false, true]) {
    await browser.send('Emulation.setDeviceMetricsOverride', { width, height:900, deviceScaleFactor:1, mobile:false });
    await browser.send('Emulation.setEmulatedMedia', { features:[{name:'forced-colors',value:'none'}, {name:'prefers-color-scheme',value:dark?'dark':'light'}] });
    await browser.send('Page.navigate', {url:`http://127.0.0.1:${server.address().port}/${route}`});
    let ready = false;
    for (let i=0;i<100;i++) {
      await wait(30);
      if (await browser.evaluate("document.readyState==='complete'&&document.fonts.status==='loaded'").catch(()=>false)) { ready=true; break; }
    }
    assert.ok(ready, route + ': page finished loading');
    const normal = await measure();
    // Removing only the proposed sheet in normal mode must leave every computed control unchanged.
    const sheet = await browser.evaluate("document.querySelector('[data-chalk-forced-colors]')?.textContent ?? null");
    assert.ok(sheet, route + ': the real route includes the shared sheet');
    await browser.evaluate("document.querySelector('[data-chalk-forced-colors]').remove()");
    assert.deepEqual(await measure(), normal, route + ': normal appearance is unchanged');
    await browser.evaluate(`(()=>{const s=document.createElement('style');s.dataset.chalkForcedColors='';s.textContent=${JSON.stringify(sheet)};document.head.append(s);})()`);
    await browser.send('Emulation.setEmulatedMedia', { features:[{name:'forced-colors',value:'active'}, {name:'prefers-color-scheme',value:dark?'dark':'light'}] });
    const result = await measure(), label = `${route}/${width}/${dark?'dark':'light'}`;
    checkBoundaries(result,label);
    if (route !== 'start') assert.ok(result.controls.length, label + ': actual controls measured');
    if (route === 'authoring') {
      const save=result.controls.find(x=>x.id==='fr-save'), later=result.controls.find(x=>x.id==='fr-later');
      assert.ok(save && later && save.border>later.border,label+': Save remains more prominent than Later');
      const focus=await browser.focusVisibleStyle('#fr-save');
      assert.ok(parseFloat(focus['outline-width'])>=1 && focus['outline-style']!=='none',label+': focus ring remains visible');
      if (evidence) {
        await browser.evaluate("document.getElementById('fr-save').scrollIntoView({block:'center'})");
        const shot=await browser.send('Page.captureScreenshot',{format:'png'});
        writeFileSync(`${evidence}/${label.replaceAll('/','-')}.png`,Buffer.from(shot.data,'base64'));
      }
      // Negative control reproduces the original defect on the actual page.
      await browser.evaluate("document.querySelector('[data-chalk-forced-colors]').remove()");
      const broken=await measure();
      assert.throws(()=>checkBoundaries(broken,label+' without correction'),/bounded action|text action/);
    }
    results.push({label,...result});
  }
} finally {
  await browser.close();
  await new Promise(resolve=>server.close(resolve));
}
if(evidence)writeFileSync(`${evidence}/results.json`,JSON.stringify(results,null,2)+'\n');
console.log(`PASS forced-colors: ${results.length} real page/viewport/palette combinations, unchanged normal controls and original-defect controls`);
