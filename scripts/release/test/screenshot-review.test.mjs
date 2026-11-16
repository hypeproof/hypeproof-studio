// Controls for the screenshot review. Fixture PNGs are generated here (no binary files, no network, no real
// model call: fetch is injected).
//   node --test scripts/release/test/screenshot-review.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {PROMPT, SECRET_NAME, KEY_ENV, buildRequest, decodePng, localCheck, parseVerdict, reviewOs, summaryTable, findManifests, MAX_IMAGES} from '../screenshot-review.mjs';

const crcTable = Array.from({length: 256}, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = buf => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const h = Buffer.alloc(8); h.writeUInt32BE(data.length, 0); h.write(type, 4, 'latin1'); const t = Buffer.concat([h.subarray(4), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(t)); return Buffer.concat([h.subarray(0, 4), t, c]); };
// RGB PNG from a pixel function (x, y) -> [r, g, b]; filter type 0 on every row.
function png(width, height, pixel) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) { const [r, g, b] = pixel(x, y); const o = y * (width * 3 + 1) + 1 + x * 3; raw[o] = r; raw[o + 1] = g; raw[o + 2] = b; }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
// A plausible app screen: dark background, a header bar, text-like stripes and a button.
const good = png(160, 100, (x, y) => (y < 12 ? [40, 60, 40] : x > 100 && y > 70 ? [200, 230, 120] : y % 9 < 3 && x > 10 && x < 90 ? [230, 230, 230] : [24, 32, 28]));
const black = png(160, 100, () => [0, 0, 0]);

test('decodePng and localCheck: a real-looking screen passes, a solid black or white window is flagged', () => {
  const d = decodePng(good);
  assert.deepEqual([d.width, d.height, d.bpp], [160, 100, 3]);
  assert.deepEqual(localCheck(good), {ok: true, issue: null, detail: ''});
  const flagged = localCheck(black);
  assert.equal(flagged.ok, false);
  assert.equal(flagged.issue, 'blank_or_black_window');
  assert.match(flagged.detail, /100\.0% of the window is one colour/);
  assert.equal(localCheck(png(160, 100, () => [255, 255, 255])).issue, 'blank_or_black_window');
  // almost-blank with a tiny spinner (under 0.5% of pixels) still counts as blank
  assert.equal(localCheck(png(200, 200, (x, y) => (x < 8 && y < 8 ? [255, 255, 255] : [0, 0, 0]))).issue, 'blank_or_black_window');
  assert.equal(localCheck(Buffer.from('not a png')).issue, 'other');
});

test('buildRequest: fixed prompt, labelled images, bounded size and count', () => {
  const req = buildRequest([{name: 'start-page', buf: good}, {name: 'settings', buf: good}]);
  assert.equal(req.model, 'claude-sonnet-5-5');
  assert.equal(req.max_tokens, 800);
  const c = req.messages[0].content;
  assert.deepEqual(c.filter(x => x.type === 'text').map(x => x.text).slice(0, 2), ['State: start-page', 'State: settings']);
  assert.equal(c.filter(x => x.type === 'image').length, 2);
  assert.equal(c.at(-1).text, PROMPT);
  assert.equal(c.find(x => x.type === 'image').source.data, good.toString('base64'));
  assert.throws(() => buildRequest([]), /need 1-5/);
  assert.throws(() => buildRequest(Array.from({length: MAX_IMAGES + 1}, (_, i) => ({name: `s${i}`, buf: good}))), /need 1-5/);
  assert.throws(() => buildRequest([{name: 'x', buf: Buffer.alloc(3_000_001)}]), /over the 3000000 cap/);
  for (const word of ['blank_or_black_window', 'overlapping_or_clipped_ui', 'error_overlay', 'untranslated_placeholder']) assert.ok(PROMPT.includes(word));
});

test('parseVerdict: accepts a complete, consistent answer and rejects everything else', () => {
  const names = ['a', 'b'];
  const ok = {verdict: 'ok', states: [{state: 'a', ok: true, issue: null, detail: ''}, {state: 'b', ok: true, issue: null, detail: ''}]};
  assert.equal(parseVerdict(`Here you go:\n${JSON.stringify(ok)}`, names).verdict, 'ok');
  const bad = {verdict: 'flagged', states: [{state: 'a', ok: false, issue: 'error_overlay', detail: 'red dialog'}, {state: 'b', ok: true, issue: null, detail: ''}]};
  assert.equal(parseVerdict(JSON.stringify(bad), names).verdict, 'flagged');
  const clone = o => structuredClone(o);
  const refusals = {
    'no json': 'I cannot help',
    'missing state': JSON.stringify({...ok, states: ok.states.slice(0, 1)}),
    'unknown state': JSON.stringify({...ok, states: [...ok.states.slice(0, 1), {state: 'zzz', ok: true, issue: null, detail: ''}]}),
    'repeated state': JSON.stringify({...ok, states: [ok.states[0], ok.states[0]]}),
    'unknown issue': JSON.stringify((o => { o.states[0].issue = 'ugly'; return o; })(clone(bad))),
    'issue on an ok state': JSON.stringify((o => { o.states[0].issue = 'other'; return o; })(clone(ok))),
    'verdict disagrees': JSON.stringify({...clone(bad), verdict: 'ok'}),
    'flagged without a flagged state': JSON.stringify({...clone(ok), verdict: 'flagged'}),
    'ok not boolean': JSON.stringify((o => { o.states[0].ok = 'yes'; return o; })(clone(ok))),
  };
  for (const [name, text] of Object.entries(refusals)) assert.throws(() => parseVerdict(text, names), undefined, name);
});

const states = [{name: 'start-page', file: 'start-page.png', reached: true}, {name: 'settings', file: 'settings.png', reached: true}, {name: 'composer', file: null, reached: false, note: 'no composer in any webview'}];
const files = {'start-page.png': good, 'settings.png': good};
const read = f => files[f];
const modelAnswer = verdict => async () => ({ok: true, json: async () => ({content: [{type: 'text', text: JSON.stringify(verdict)}], usage: {input_tokens: 4000, output_tokens: 90}})});

test('reviewOs: the deliberately broken screenshot is flagged even when the model says it is fine; unreached states are not judged', async () => {
  const broken = {...files, 'settings.png': black};
  let calls = 0;
  const fetchImpl = async (...a) => { calls++; return modelAnswer({verdict: 'ok', states: [{state: 'start-page', ok: true, issue: null, detail: ''}, {state: 'settings', ok: true, issue: null, detail: ''}]})(...a); };
  const r = await reviewOs({os: 'darwin-arm64', states, read: f => broken[f], apiKey: 'k', fetchImpl});
  assert.equal(calls, 1, 'one model call per OS');
  assert.equal(r.verdict, 'flagged');
  const settings = r.states.find(s => s.name === 'settings');
  assert.deepEqual([settings.ok, settings.issue, settings.source], [false, 'blank_or_black_window', 'local']);
  assert.deepEqual(r.states.find(s => s.name === 'composer'), {name: 'composer', reached: false, ok: true, issue: null, detail: 'no composer in any webview', source: 'not-reached'});
  assert.equal(r.states.find(s => s.name === 'start-page').ok, true);
});

test('reviewOs: a model flag on a healthy-looking image is recorded; clean screenshots give an ok verdict', async () => {
  const flag = {verdict: 'flagged', states: [{state: 'start-page', ok: false, issue: 'untranslated_placeholder', detail: 'shows {{name}}'}, {state: 'settings', ok: true, issue: null, detail: ''}]};
  const r = await reviewOs({os: 'win32-x64', states, read, apiKey: 'k', fetchImpl: modelAnswer(flag)});
  assert.equal(r.verdict, 'flagged');
  assert.deepEqual(r.states[0].source, 'model');
  assert.equal(r.model.called, true);
  assert.deepEqual(r.model.usage, {input_tokens: 4000, output_tokens: 90});
  const clean = await reviewOs({os: 'win32-x64', states, read, apiKey: 'k', fetchImpl: modelAnswer({verdict: 'ok', states: [{state: 'start-page', ok: true, issue: null, detail: ''}, {state: 'settings', ok: true, issue: null, detail: ''}]})});
  assert.equal(clean.verdict, 'ok');
});

test('reviewOs: no key skips the model with a notice naming the secret; the local check still runs and nothing is called', async () => {
  let called = false;
  const r = await reviewOs({os: 'darwin-arm64', states, read: f => ({...files, 'settings.png': black})[f], apiKey: '', fetchImpl: async () => { called = true; }});
  assert.equal(called, false);
  assert.equal(r.model.called, false);
  assert.ok(r.model.skipped.includes(SECRET_NAME));
  assert.equal(r.verdict, 'flagged', 'the free local layer still catches the black window');
});

test('reviewOs: an API error or a malformed answer is reported, never a pass claimed by the model', async () => {
  const http = await reviewOs({os: 'x', states, read, apiKey: 'k', fetchImpl: async () => ({ok: false, status: 529})});
  assert.match(http.model.error, /HTTP 529/);
  assert.equal(http.model.called, false);
  const junk = await reviewOs({os: 'x', states, read, apiKey: 'k', fetchImpl: async () => ({ok: true, json: async () => ({content: [{type: 'text', text: 'looks fine to me'}]})})});
  assert.match(junk.model.error, /no JSON object/);
  assert.equal(junk.verdict, 'ok');
  assert.match(summaryTable({results: [junk]}), /model review failed, not used: no JSON object/);
  const none = await reviewOs({os: 'x', states: [{name: 'a', file: null, reached: false}], read, apiKey: 'k', fetchImpl: async () => { throw Error('must not be called'); }});
  assert.equal(none.model.skipped, 'no screenshot was reached');
});

test('CLI: reads manifests, writes the JSON and the table, exits 0 even when flagged, and notices the missing secret', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hps-shot-review-'));
  try {
    const mac = path.join(dir, 'in/unified-darwin-arm64/update-check');
    fs.mkdirSync(mac, {recursive: true});
    fs.writeFileSync(path.join(mac, 'start-page.png'), good);
    fs.writeFileSync(path.join(mac, 'settings.png'), black);
    fs.writeFileSync(path.join(mac, 'screenshots-manifest.json'), JSON.stringify({schema: 'hps-acceptance-screenshots/1', os: 'darwin-arm64', appVersion: '1', viewport: {width: 160, height: 100}, states}));
    assert.equal(findManifests(path.join(dir, 'in')).length, 1);
    const script = fileURLToPath(new URL('../screenshot-review.mjs', import.meta.url));
    const env = {...process.env, [KEY_ENV]: '', GITHUB_STEP_SUMMARY: path.join(dir, 'summary.md')};
    const r = spawnSync(process.execPath, [script, '--input', path.join(dir, 'in'), '--out', path.join(dir, 'out')], {env, encoding: 'utf8'});
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /::notice::Screenshot review: HPS_ACCEPTANCE_ANTHROPIC_API_KEY is not set/);
    assert.match(r.stdout, /::warning::Screenshot review flagged darwin-arm64\/settings: blank_or_black_window/);
    const review = JSON.parse(fs.readFileSync(path.join(dir, 'out/screenshot-review.json'), 'utf8'));
    assert.deepEqual([review.schema, review.gates_publish, review.results[0].verdict], ['hps-screenshot-review/1', false, 'flagged']);
    assert.match(fs.readFileSync(path.join(dir, 'summary.md'), 'utf8'), /\| darwin-arm64 \| settings \| FLAGGED \|/);
    assert.equal(spawnSync(process.execPath, [script], {encoding: 'utf8'}).status, 2);
  } finally { fs.rmSync(dir, {recursive: true, force: true}); }
});
