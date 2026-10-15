// #1610 / CR-T09: real Chromium selection and the production next-turn conduit.
// Synthetic local evidence; no model call, Studio shell, or production mutation.
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { serveStatic } from '../../extensions/hypeproof-chat/src/liveServerHelpers.ts';
import { CrExecutor } from '../../extensions/hypeproof-chat/src/experimentBrowser.ts';
import { waitForPick, buildElementContext, elementContextProblems } from '../../extensions/hypeproof-chat/src/elementPick.ts';
import { artifactVersionFor } from '../../extensions/hypeproof-chat/src/artifactVersion.ts';
import { ElementQueue, withElementText, turnImages } from '../../extensions/hypeproof-chat/src/crHostWiring.ts';

const root = fileURLToPath(new URL('./fixtures/dental-element-trial/', import.meta.url));
const out = fileURLToPath(new URL('../test-results/workshop-element-trial/', import.meta.url));
const report = { evidence_class: 'synthetic-real-chromium', app_validation: 'NOT RUN', model_call: 'NOT RUN', samples: [] };
const server = createServer((req, res) => {
  const result = serveStatic(root, req.url ?? '/');
  res.writeHead(result.status, { 'content-type': result.contentType });
  res.end(result.body);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  await mkdir(out, { recursive: true });
  browser = await chromium.launch({ headless: true, channel: 'chromium' });
  const page = await browser.newPage();
  const session = await page.context().newCDPSession(page);
  const listeners = new Set();
  for (const method of ['Overlay.inspectNodeRequested', 'Page.frameNavigated', 'Runtime.executionContextCreated', 'Runtime.executionContextDestroyed', 'Runtime.consoleAPICalled', 'Runtime.exceptionThrown', 'Network.requestWillBeSent', 'Network.responseReceived', 'Network.loadingFailed', 'Log.entryAdded']) {
    session.on(method, params => { for (const listener of listeners) listener({ method, params }); });
  }
  let ready;
  const cdp = {
    send: async (method, params = {}) => {
      const result = await session.send(method, params);
      if (method === 'Overlay.setInspectMode' && params.mode === 'searchForNode') ready?.();
      return result;
    },
    onEvent: fn => { listeners.add(fn); return { dispose: () => listeners.delete(fn) }; },
  };
  await page.goto(`${origin}/index.html`);
  const executor = new CrExecutor({ session: async () => cdp, tabUrl: () => page.url(), navigate: url => page.goto(url) }, {
    allowedOrigins: () => [origin], artifactVersion: url => artifactVersionFor(root, new URL(url).pathname), settleMs: 50,
  });
  let source;
  let previousBox;
  for (const viewport of [{ width: 1280, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    const observed = await executor.execute('browser_observe');
    assert.equal(observed.isError, false);
    const log = await executor.logFor(cdp);
    let refs;
    const box = await page.locator('#clinic-photo').boundingBox();
    assert.ok(box);
    if (previousBox) assert.notEqual(box.x, previousBox.x, 'responsive layout must move the target');
    previousBox = box;
    const inspectorReady = new Promise(resolve => { ready = resolve; });
    const picked = waitForPick(cdp, 5000);
    await Promise.race([inspectorReady, picked]);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    const backendNodeId = await picked;
    assert.equal(await page.locator('#actions').textContent(), '0', 'selection must not activate the page button');
    const ctx = await buildElementContext(cdp, log, backendNodeId, {
      root, artifactVersion: url => artifactVersionFor(root, new URL(url).pathname),
      refFor: id => executor.refFor(id), adopt: (table, generation) => { refs = table; executor.adoptRefs(table, generation); },
    });
    assert.deepEqual(elementContextProblems(ctx, { refTarget: ref => refs.get(ref), viewport }), []);
    assert.equal(ctx.tag, 'button');
    assert.equal(ctx.text, '치과 사진 넣을 자리');
    assert.match(ctx.snippet, /id="clinic-photo"/);
    assert.notEqual(ctx.source, 'unmapped');
    const markup = await readFile(join(root, 'index.html'), 'utf8');
    assert.equal(ctx.source.line, markup.split('\n').findIndex(line => line.includes('<button id="clinic-photo"')) + 1);
    if (source) assert.deepEqual(ctx.source, source, 'source identity survives resize');
    source = ctx.source;
    assert.ok(ctx.crop && ctx.crop.clip.width < viewport.width);
    assert.ok(elementContextProblems({ ...ctx, ref: 'wrong-ref' }, { refTarget: ref => refs.get(ref) }).length > 0, 'wrong element ref must fail');

    const queue = new ElementQueue();
    const preview = queue.attach(ctx, { imagesAllowed: false });
    assert.equal(preview.imageDataUrl, null);
    const textOnly = queue.take(true);
    assert.equal(withElementText('여기에 사진 넣어줘', textOnly), `${preview.sentText}\n\n여기에 사진 넣어줘`);
    assert.equal(turnImages(undefined, null, textOnly), undefined, 'text-only context sends no image');
    assert.equal(queue.take(true), null, 'selection belongs to one turn only');
    const withImage = queue.attach(ctx, { imagesAllowed: true });
    assert.equal(turnImages(undefined, null, queue.take(true))[0], withImage.imageDataUrl);
    queue.attach(ctx, { imagesAllowed: false });
    queue.clear();
    assert.equal(queue.take(true), null, 'removed context must not reach the next turn');
    queue.attach(ctx, { imagesAllowed: true });
    assert.equal(queue.take(false), null, 'disabled runtime must drop the queued context');
    assert.equal(queue.preview(), null);
    const cropFile = `${viewport.width}-element.png`;
    await writeFile(join(out, cropFile), Buffer.from(ctx.crop.data, 'base64'));
    report.samples.push({ viewport, source: ctx.source, capture_ms: ctx.captureMs, snippet_chars: ctx.snippet.length, text_only_bytes: Buffer.byteLength(preview.sentText), crop_bytes: Buffer.from(ctx.crop.data, 'base64').length, crop: cropFile, verdict: 'PASS' });
    console.log(`PASS ${viewport.width}x${viewport.height}: real inspector pick, stable source, next-turn text/image/removal controls`);
  }
  await page.locator('#clinic-photo').click();
  assert.equal(await page.locator('#actions').textContent(), '1', 'normal page clicks resume after selection');
  report.verdict = 'PASS';
  console.log('PASS selection does not activate the button; normal clicks resume afterward');
} catch (error) {
  report.verdict = 'FAIL';
  report.error = error.message;
  process.exitCode = 1;
  console.error(error);
} finally {
  await browser?.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  await mkdir(out, { recursive: true });
  await writeFile(join(out, 'result.json'), `${JSON.stringify(report, null, 2)}\n`);
}
