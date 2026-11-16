#!/usr/bin/env node
// Visual-breakage review of the acceptance screenshots, once per rc. NEVER gates a publish.
//
//   screenshot-review.mjs --input DIR --out DIR
//     DIR/<anything>/screenshots-manifest.json (hps-acceptance-screenshots/1, one per OS) beside its PNGs.
//     Writes OUT/screenshot-review.json (hps-screenshot-review/1) and, with GITHUB_STEP_SUMMARY set, a table.
//
// Two layers, so the free one still works without a key:
//   1. A deterministic local check per image (blank/black/single-colour window). Always runs.
//   2. One Claude call per OS, at most, sending that OS's images with a fixed prompt and asking for a JSON
//      verdict. Skipped with a visible notice when HPS_SCREENSHOT_REVIEW_ANTHROPIC_API_KEY is absent
//      (the secret is named here, not created here).
// A state is flagged when either layer flags it. The exit code is 0 whatever the verdict (a flag is a
// warning annotation); only a usage error exits 2.
//
// Cost: at most 5 images (about 1.4k input tokens each at 1280x800) and max_tokens 800 per call, one call
// per OS, so a Mac+Windows rc costs two calls of roughly 8k tokens in and 0.5k out.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';

export const SECRET_NAME = 'HPS_SCREENSHOT_REVIEW_ANTHROPIC_API_KEY';
export const MODEL = 'claude-sonnet-5-5';
export const MANIFEST_SCHEMA = 'hps-acceptance-screenshots/1';
export const REVIEW_SCHEMA = 'hps-screenshot-review/1';
export const MAX_IMAGES = 5;
export const MAX_BYTES = 3_000_000;
export const ISSUES = ['blank_or_black_window', 'overlapping_or_clipped_ui', 'error_overlay', 'untranslated_placeholder', 'other'];

export const PROMPT = `You review screenshots of the HypeProof Studio desktop app taken by an automated release check. Each image is labelled with its state name just before it. The UI text is Korean by design; that is not a problem.

Flag a state only for visible breakage:
- blank_or_black_window: the window is empty, solid black or white, or only a spinner with nothing else.
- overlapping_or_clipped_ui: text or controls overlap, are cut off by the window edge, or are unreadably small.
- error_overlay: an error dialog, a stack trace, a crash page or a red error banner covers the content. An informational update banner is normal.
- untranslated_placeholder: raw keys, template markers such as {{name}} or %s, "undefined", "null", "NaN", or lorem ipsum shown to the user.
- other: any other clearly broken rendering.

Do not judge design taste, copy quality or missing features. When unsure, do not flag.
Answer with one JSON object and nothing else:
{"verdict": "ok" | "flagged", "states": [{"state": "<state name>", "ok": true | false, "issue": null | "<one of the issue names above>", "detail": "<one short sentence, empty when ok>"}]}
Include every labelled state exactly once. "verdict" is "flagged" when any state has ok false.`;

// ---- Deterministic layer: a minimal PNG reader (8-bit, non-interlaced, colour types 2 and 6) ----

export function decodePng(buf) {
  if (buf.length < 33 || buf.readUInt32BE(0) !== 0x89504e47) throw Error('not a PNG');
  let off = 8, width, height, bpp, idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off), type = buf.toString('latin1', off + 4, off + 8), data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      const [depth, color, , , interlace] = [data[8], data[9], data[10], data[11], data[12]];
      if (depth !== 8 || ![2, 6].includes(color) || interlace !== 0) throw Error('unsupported PNG (need 8-bit RGB/RGBA, not interlaced)');
      bpp = color === 6 ? 4 : 3;
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (!width || !idat.length) throw Error('PNG has no image data');
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * bpp, out = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), o = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[o + x - bpp] : 0, b = y ? out[o - stride + x] : 0, c = x >= bpp && y ? out[o - stride + x - bpp] : 0;
      let p = 0;
      if (f === 2) p = b; else if (f === 1) p = a; else if (f === 3) p = (a + b) >> 1;
      else if (f === 4) { const pa = Math.abs(b - c), pb = Math.abs(a - c), pc = Math.abs(a + b - 2 * c); p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; } else if (f !== 0) throw Error('bad PNG filter');
      out[o + x] = (line[x] + p) & 255;
    }
  }
  return {width, height, bpp, pixels: out};
}

/** Share of pixels equal to the most common colour, and the mean luminance (0-255). */
export function colourStats({width, height, bpp, pixels}) {
  const counts = new Map();
  let lum = 0;
  const n = width * height;
  for (let i = 0; i < n; i++) {
    const r = pixels[i * bpp], g = pixels[i * bpp + 1], b = pixels[i * bpp + 2];
    const key = (r << 16) | (g << 8) | b;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    lum += 0.299 * r + 0.587 * g + 0.114 * b;
  }
  return {dominantShare: Math.max(...counts.values()) / n, meanLuminance: lum / n, colours: counts.size};
}

/** A window that is (almost) one colour is blank, black or white. A real app screen never is. */
export function localCheck(buf) {
  let stats;
  try { stats = colourStats(decodePng(buf)); } catch (error) { return {ok: false, issue: 'other', detail: `unreadable screenshot: ${error.message}`}; }
  if (stats.dominantShare >= 0.995) {
    return {ok: false, issue: 'blank_or_black_window', detail: `${(stats.dominantShare * 100).toFixed(1)}% of the window is one colour (mean luminance ${stats.meanLuminance.toFixed(0)})`};
  }
  return {ok: true, issue: null, detail: ''};
}

// ---- Model layer ----

export function buildRequest(images, {model = MODEL} = {}) {
  if (!images.length || images.length > MAX_IMAGES) throw Error(`need 1-${MAX_IMAGES} images, got ${images.length}`);
  const content = [];
  for (const {name, buf} of images) {
    if (buf.length > MAX_BYTES) throw Error(`${name} is ${buf.length} bytes, over the ${MAX_BYTES} cap`);
    content.push({type: 'text', text: `State: ${name}`}, {type: 'image', source: {type: 'base64', media_type: 'image/png', data: buf.toString('base64')}});
  }
  content.push({type: 'text', text: PROMPT});
  return {model, max_tokens: 800, temperature: 0, messages: [{role: 'user', content}]};
}

/** Strict validation of the model's answer against the states we sent. Throws on any deviation. */
export function parseVerdict(text, stateNames) {
  const m = String(text).match(/\{[\s\S]*\}/);
  if (!m) throw Error('no JSON object in the model answer');
  const v = JSON.parse(m[0]);
  if (!['ok', 'flagged'].includes(v.verdict) || !Array.isArray(v.states)) throw Error('verdict/states missing');
  const seen = new Set();
  for (const s of v.states) {
    if (!stateNames.includes(s.state) || seen.has(s.state)) throw Error(`unexpected or repeated state ${JSON.stringify(s.state)}`);
    seen.add(s.state);
    if (typeof s.ok !== 'boolean') throw Error(`${s.state}: ok must be boolean`);
    if (s.ok ? s.issue !== null : !ISSUES.includes(s.issue)) throw Error(`${s.state}: issue must be null when ok, else one of ${ISSUES.join(', ')}`);
    if (typeof s.detail !== 'string') throw Error(`${s.state}: detail must be a string`);
  }
  if (stateNames.some(n => !seen.has(n))) throw Error('a state was not answered');
  if ((v.verdict === 'flagged') !== v.states.some(s => !s.ok)) throw Error('verdict disagrees with the states');
  return v;
}

export async function callModel(request, {apiKey, fetchImpl = fetch}) {
  const res = await fetchImpl('https://api.anthropic.com/v1/messages', {
    method: 'POST', headers: {'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01'}, body: JSON.stringify(request), signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) throw Error(`Anthropic API answered HTTP ${res.status}`);
  const body = await res.json();
  return {text: body.content?.filter(b => b.type === 'text').map(b => b.text).join('') ?? '', usage: body.usage ?? null};
}

/**
 * Reviews one OS. `states`: [{name, file|null, reached, note?}], `read(file)` returns the PNG bytes.
 * Returns {os, model: {called, skipped, error, usage}, states: [{name, reached, ok, issue, detail, source}]}.
 */
export async function reviewOs({os, states, read, apiKey, fetchImpl}) {
  const out = states.map(s => ({name: s.name, reached: s.reached === true, ok: true, issue: null, detail: s.reached ? '' : (s.note ?? 'state not reached'), source: s.reached ? 'none' : 'not-reached'}));
  const images = [];
  for (const row of out.filter(r => r.reached)) {
    const buf = read(states.find(s => s.name === row.name).file);
    const local = localCheck(buf);
    if (!local.ok) Object.assign(row, {ok: false, issue: local.issue, detail: local.detail, source: 'local'});
    images.push({name: row.name, buf});
  }
  const model = {called: false, skipped: null, error: null, usage: null};
  if (!images.length) model.skipped = 'no screenshot was reached';
  else if (!apiKey) model.skipped = `${SECRET_NAME} is not set; only the local blank-window check ran`;
  else {
    try {
      const picked = images.slice(0, MAX_IMAGES);
      const {text, usage} = await callModel(buildRequest(picked), {apiKey, fetchImpl});
      model.called = true; model.usage = usage;
      const verdict = parseVerdict(text, picked.map(i => i.name));
      for (const s of verdict.states) {
        const row = out.find(r => r.name === s.state);
        if (!s.ok && row.ok) Object.assign(row, {ok: false, issue: s.issue, detail: s.detail, source: 'model'});
      }
    } catch (error) { model.error = error.message; }
  }
  return {os, model, states: out, verdict: out.some(r => r.reached && !r.ok) ? 'flagged' : 'ok'};
}

export function summaryTable(review) {
  const rows = ['| OS | State | Result | Issue | Source |', '|---|---|---|---|---|'];
  for (const o of review.results) for (const s of o.states) rows.push(`| ${o.os} | ${s.name} | ${!s.reached ? 'not reached' : s.ok ? 'ok' : 'FLAGGED'} | ${s.issue ?? ''}${s.detail && !s.ok ? `: ${s.detail}` : ''} | ${s.source} |`);
  const notes = review.results.map(o => `- ${o.os}: ${o.model.error ? `model review failed, not used: ${o.model.error}` : o.model.called ? `model called${o.model.usage ? ` (${o.model.usage.input_tokens} in / ${o.model.usage.output_tokens} out tokens)` : ''}` : `model not called: ${o.model.skipped}`}`);
  return ['### Screenshot review (non-blocking; never gates publish)', '', ...rows, '', ...notes, ''].join('\n');
}

export function findManifests(dir) {
  const found = [];
  const walk = d => { for (const e of fs.readdirSync(d, {withFileTypes: true})) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name === 'screenshots-manifest.json') found.push(p); } };
  if (fs.existsSync(dir)) walk(dir);
  return found.sort();
}

async function main() {
  const {values: v} = parseArgs({options: {input: {type: 'string'}, out: {type: 'string'}}, strict: true});
  if (!v.input || !v.out) { console.error('usage: screenshot-review.mjs --input DIR --out DIR'); process.exit(2); }
  const apiKey = process.env[SECRET_NAME] || '';
  const results = [];
  for (const file of findManifests(v.input)) {
    const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (manifest.schema !== MANIFEST_SCHEMA) { console.log(`::warning::${file}: not ${MANIFEST_SCHEMA}, skipped`); continue; }
    results.push({...(await reviewOs({os: manifest.os, states: manifest.states, read: f => fs.readFileSync(path.join(path.dirname(file), f)), apiKey})), viewport: manifest.viewport, appVersion: manifest.appVersion});
  }
  const review = {schema: REVIEW_SCHEMA, model: MODEL, gates_publish: false, results};
  fs.mkdirSync(v.out, {recursive: true});
  fs.writeFileSync(path.join(v.out, 'screenshot-review.json'), `${JSON.stringify(review, null, 2)}\n`);
  const table = results.length ? summaryTable(review) : '### Screenshot review\n\nNo screenshot manifest found; nothing to review.\n';
  console.log(table);
  if (!apiKey) console.log(`::notice::Screenshot review: ${SECRET_NAME} is not set, so the model review was skipped; the local blank-window check still ran.`);
  for (const o of results) for (const s of o.states) if (s.reached && !s.ok) console.log(`::warning::Screenshot review flagged ${o.os}/${s.name}: ${s.issue}: ${s.detail}`);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${table}\n`);
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main();
