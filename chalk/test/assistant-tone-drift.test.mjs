// DEC-30 / CGP-AGENT-R-015 — the AI tone catalog (ids, Korean labels, minor_safe) has one Service-owned source.
//
// HOW THIS IS ENFORCED (read this before trusting a green run), same shape as approval-preset-drift.test.mjs:
//   chalk/test/fixtures/assistant-tone-catalog.json is the contract. hypeproof-service owns the catalog in
//   worker/src/lib/lesson-assistant-style.ts (ASSISTANT_TONES) and serves it on the authoring features read as `assistant_tones`.
//   The fixture is meant to be vendored byte-for-byte into hypeproof-service (worker/test/fixtures/assistant-tone-catalog.json)
//   with a Service test that asserts the catalog equals it; that Service test is a follow-up, so until it lands the live comparison
//   at the bottom is the only check against the Service source. It runs when a hypeproof-service checkout is at hand
//   (HYPEPROOF_SERVICE_DIR or a sibling) and prints NOT RUN otherwise. Do not read NOT RUN as a pass of the live comparison.
//
// What this test checks in Studio: Chalk's pre-catalog names (TONE_FALLBACK) equal the fixture labels, Chalk renders the served
// label and the served minor_safe flag as-is (not a copy), and no Studio test file keeps its own inline copy of a tone label.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const FIXTURE = JSON.parse(readFileSync(join(here, 'fixtures/assistant-tone-catalog.json'), 'utf8'));
const page = readFileSync(join(here, '../src/ui/authoring.html'), 'utf8');

/** Entry-by-entry, both ways: same ids, same order, same label and minor_safe per id. Returns the differences. */
export function catalogDiff(actual, expected) {
  const out = [];
  const a = actual.map((p) => p.id), e = expected.map((p) => p.id);
  if (JSON.stringify(a) !== JSON.stringify(e)) out.push(`ids/order: ${a.join(',')} != ${e.join(',')}`);
  for (const p of expected) {
    const q = actual.find((x) => x.id === p.id);
    if (!q) continue;
    if (q.label !== p.label) out.push(`${p.id} label`);
    if (q.minor_safe !== p.minor_safe) out.push(`${p.id} minor_safe`);
  }
  return out;
}

/** Chalk's pre-catalog names as {id,label} in declaration order. */
export function fallbackNames(html) {
  const m = /const TONE_FALLBACK=\{([^}]*)\}/.exec(html);
  assert.ok(m, 'authoring.html declares TONE_FALLBACK');
  return [...m[1].matchAll(/(\w+):'([^']*)'/g)].map((x) => ({ id: x[1], label: x[2] }));
}

/** Test files that inline a Korean label for a catalog id instead of reading the fixture. */
export function inlineCopies(files, ids) {
  const re = new RegExp(`id:\\s*["'](?:${ids.join('|')})["'],\\s*label:\\s*["'\`][^"'\`]*[가-힣]`);
  return files.filter((f) => re.test(readFileSync(f, 'utf8')));
}

// 0. The fixture itself: a closed four-id catalog; the two minor-safe tones are the first two.
assert.deepEqual(FIXTURE.map((p) => p.id), ['friendly', 'calm', 'playful', 'formal']);
assert.ok(FIXTURE.every((p) => p.label.trim() && typeof p.minor_safe === 'boolean'));
assert.deepEqual(FIXTURE.filter((p) => p.minor_safe).map((p) => p.id), ['friendly', 'calm']);

// 1. The differ sees every mutant: added, removed, reordered, swapped labels, flipped flag.
const m = (f) => f(structuredClone(FIXTURE));
assert.deepEqual(catalogDiff(FIXTURE, FIXTURE), []);
assert.notDeepEqual(catalogDiff(m((c) => [...c, { id: 'sarcastic', label: 'x', minor_safe: false }]), FIXTURE), [], 'an added tone fails');
assert.notDeepEqual(catalogDiff(m((c) => c.slice(1)), FIXTURE), [], 'a removed tone fails');
assert.notDeepEqual(catalogDiff(m((c) => [c[1], c[0], c[2], c[3]]), FIXTURE), [], 'a reorder fails');
assert.notDeepEqual(catalogDiff(m((c) => { [c[0].label, c[1].label] = [c[1].label, c[0].label]; return c; }), FIXTURE), [], 'swapped labels fail');
assert.notDeepEqual(catalogDiff(m((c) => { c[2].minor_safe = true; return c; }), FIXTURE), [], 'a flipped minor_safe fails');

// 2. Chalk's pre-catalog names equal the fixture labels, id for id, in order.
assert.deepEqual(fallbackNames(page), FIXTURE.map(({ id, label }) => ({ id, label })), 'Chalk TONE_FALLBACK equals the catalog labels');
assert.notDeepEqual(fallbackNames(page.replace("calm:'차분하게'", "calm:'차분히'")), FIXTURE.map(({ id, label }) => ({ id, label })), 'negative control: a changed fallback name is seen');

// 3. Chalk renders the served label and the served minor_safe flag, not a copy of them.
assert.match(page, /const toneCatalog=\(\)=>[^;]*assistant_tones/, 'Chalk reads the catalog from the features read');
assert.match(page, /typeof toneEntry\(id\)\?\.label==='string'&&toneEntry\(id\)\.label\.trim\(\)\?toneEntry\(id\)\.label:/, 'Chalk shows the catalog label first');
assert.match(page, /t\.minor_safe===false\?MINOR_ROW:''/, 'Chalk warns from the served minor_safe flag');
assert.ok(!/minor_safe:\s*(true|false)/.test(page) && !/\b(playful|formal)\b[^'"\n]{0,12}minor/.test(page), 'Chalk keeps no copy of which tones are minor-safe');

// 4. No Studio test file keeps its own inline copy of a catalog label (they read the fixture).
const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === 'node_modules' ? [] : walk(join(d, e.name))) : [join(d, e.name)]));
const tests = [...walk(join(root, 'extensions/hypeproof-chat/test')), ...walk(join(root, 'chalk/test'))].filter((f) => /\.(mjs|tsx?)$/.test(f) && !f.endsWith('assistant-tone-drift.test.mjs'));
assert.deepEqual(inlineCopies(tests, FIXTURE.map((p) => p.id)), [], 'no test file inlines a tone label; read chalk/test/fixtures/assistant-tone-catalog.json');

// 5. Optional live comparison with the Service source (see the header).
const source = join(process.env.HYPEPROOF_SERVICE_DIR || resolve(root, '../hypeproof-service'), 'worker/src/lib/lesson-assistant-style.ts');
if (existsSync(source)) {
  const text = readFileSync(source, 'utf8');
  const parsed = [...text.matchAll(/(\w+): \{ id: '(\w+)', label: '([^']*)', minor_safe: (true|false) \}/g)].map((x) => ({ id: x[2], label: x[3], minor_safe: x[4] === 'true' }));
  assert.equal(parsed.length, FIXTURE.length, 'parsed the Service catalog');
  assert.deepEqual(catalogDiff(parsed, FIXTURE), [], 'Service source equals the fixture');
  console.log('  ok  fixture equals Service source (live)');
} else console.log('  NOT RUN  live Service source comparison (no checkout or file); the Service-side fixture test is a follow-up');
console.log('assistant-tone-drift: ok');
