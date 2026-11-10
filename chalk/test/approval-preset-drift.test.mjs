// CGP-AGENT-R-019 (REQ-CGP-AGENT-35) — approval preset names and descriptions have one Service-owned catalog.
//
// HOW THIS IS ENFORCED (read this before trusting a green run):
//   chalk/test/fixtures/approval-preset-catalog.json is the contract. It is vendored byte-for-byte into
//   hypeproof-service (worker/test/fixtures/approval-preset-catalog.json), where a Service test asserts that
//   worker/src/lib/lesson-approval-preset.ts equals it entry by entry. So a Service catalog change fails Service CI until
//   the fixture changes in both repos, and this test then fails Studio CI for every Studio copy that was not updated.
//   CI relies on the fixture plus that Service test. The live comparison at the bottom only runs when a hypeproof-service
//   checkout is at hand (HYPEPROOF_SERVICE_DIR or a sibling); it is a convenience, not the guard, and prints NOT RUN otherwise.
//
// What this test checks in Studio: Chalk's pre-catalog names (APPROVAL_FALLBACK), the Chalk help text that names the minors'
// default, Studio's served-preset reader, and that no Studio test file carries its own inline copy of a catalog entry.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { servedApprovalPreset } from '../../extensions/hypeproof-chat/src/approvalPreset.ts';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const FIXTURE = JSON.parse(readFileSync(join(here, 'fixtures/approval-preset-catalog.json'), 'utf8'));
const page = readFileSync(join(here, '../src/ui/authoring.html'), 'utf8');

/** Entry-by-entry, both ways: same ids, same order, same label and description per id. Returns the differences. */
export function catalogDiff(actual, expected) {
  const out = [];
  const a = actual.map((p) => p.id), e = expected.map((p) => p.id);
  if (JSON.stringify(a) !== JSON.stringify(e)) out.push(`ids/order: ${a.join(',')} != ${e.join(',')}`);
  for (const p of expected) {
    const q = actual.find((x) => x.id === p.id);
    if (!q) continue;
    if (q.label !== p.label) out.push(`${p.id} label`);
    if (q.description !== p.description) out.push(`${p.id} description`);
  }
  return out;
}

/** Chalk's pre-catalog names as {id,label} in declaration order. */
export function fallbackNames(html) {
  const m = /const APPROVAL_FALLBACK=\{([^}]*)\}/.exec(html);
  assert.ok(m, 'authoring.html declares APPROVAL_FALLBACK');
  return [...m[1].matchAll(/(\w+):'([^']*)'/g)].map((x) => ({ id: x[1], label: x[2] }));
}

/** The label the Chalk help text names as the minors' default, or null. */
export const helpDefaultName = (html) => /id="approval-help">[^<]*미성년자 수업\(초등·중·고\)의 기본은 ‘([^’]+)’/.exec(html)?.[1] ?? null;

/** Test files that inline a Korean label for a catalog id instead of reading the fixture. */
export function inlineCopies(files, ids) {
  const re = new RegExp(`id:\\s*["'](?:${ids.join('|')})["'],\\s*label:\\s*["'\`][^"'\`]*[가-힣]`);
  return files.filter((f) => re.test(readFileSync(f, 'utf8')));
}

// 0. The fixture itself: a closed three-id catalog, strictest first.
assert.deepEqual(FIXTURE.map((p) => p.id), ['always_ask', 'before_changes', 'important_only']);
assert.ok(FIXTURE.every((p) => p.label.trim() && p.description.trim()));

// 1. The differ sees every mutant: added, removed, reordered, swapped labels, changed text.
const m = (f) => f(structuredClone(FIXTURE));
assert.deepEqual(catalogDiff(FIXTURE, FIXTURE), []);
assert.notDeepEqual(catalogDiff(m((c) => [...c, { id: 'full_access', label: 'x', description: 'y' }]), FIXTURE), [], 'an added preset fails');
assert.notDeepEqual(catalogDiff(m((c) => c.slice(1)), FIXTURE), [], 'a removed preset fails');
assert.notDeepEqual(catalogDiff(m((c) => [c[1], c[0], c[2]]), FIXTURE), [], 'a reorder fails');
assert.notDeepEqual(catalogDiff(m((c) => { [c[0].label, c[1].label] = [c[1].label, c[0].label]; return c; }), FIXTURE), [], 'swapped labels fail');
assert.notDeepEqual(catalogDiff(m((c) => { c[2].description += '!'; return c; }), FIXTURE), [], 'a changed description fails');

// 2. Chalk's pre-catalog names equal the fixture labels, id for id, in order (no extra, no missing, no swap).
assert.deepEqual(fallbackNames(page), FIXTURE.map(({ id, label }) => ({ id, label })), 'Chalk APPROVAL_FALLBACK equals the catalog labels');
assert.notDeepEqual(fallbackNames(page.replace("before_changes:'바꾸기 전에 묻기'", "before_changes:'바꾸기 전 묻기'")), FIXTURE.map(({ id, label }) => ({ id, label })), 'negative control: a changed fallback name is seen');

// 3. The help text names the strictest-free default (important_only) by its catalog label.
const important = FIXTURE.find((p) => p.id === 'important_only');
assert.equal(helpDefaultName(page), important.label, 'Chalk help text names the catalog label of important_only');
assert.notEqual(helpDefaultName(page.replace('‘중요한 것만 묻기’입니다', '‘중요한 것만 묻기!’입니다')), important.label, 'negative control: a changed help name is seen');

// 4. Studio renders exactly the served text.
for (const p of FIXTURE) assert.deepEqual(servedApprovalPreset({ approval_preset: { ...p } }), p, `Studio reads ${p.id} verbatim`);

// 5. Chalk renders the served label and description as-is.
assert.match(page, /typeof p\.label==='string'&&p\.label\.trim\(\)\?p\.label:APPROVAL_FALLBACK\[p\.id\],typeof p\.description==='string'\?p\.description:''/, 'Chalk picker renders the catalog label and description');

// 6. No Studio test file keeps its own inline copy of a catalog label (they read the fixture).
const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === 'node_modules' ? [] : walk(join(d, e.name))) : [join(d, e.name)]));
const tests = [...walk(join(root, 'extensions/hypeproof-chat/test')), ...walk(join(root, 'chalk/test'))].filter((f) => /\.(mjs|tsx?)$/.test(f) && !f.endsWith('approval-preset-drift.test.mjs'));
const ids = FIXTURE.map((p) => p.id);
assert.deepEqual(inlineCopies(tests, ids), [], 'no test file inlines a catalog label; read chalk/test/fixtures/approval-preset-catalog.json');

// 7. Optional live comparison with the Service source (see the header: CI relies on the fixture + the Service test).
const source = join(process.env.HYPEPROOF_SERVICE_DIR || resolve(root, '../hypeproof-service'), 'worker/src/lib/lesson-approval-preset.ts');
if (existsSync(source)) {
  const text = readFileSync(source, 'utf8');
  const parsed = [...text.matchAll(/id: '(\w+)',\s*label: '([^']*)',\s*description: '([^']*)',/g)].map((x) => ({ id: x[1], label: x[2], description: x[3] }));
  assert.deepEqual(catalogDiff(parsed, FIXTURE), [], 'Service source equals the fixture');
  console.log('  ok  fixture equals Service source (live)');
} else console.log('  NOT RUN  live Service source comparison (no checkout); CI relies on the fixture + the Service test');
console.log('approval-preset-drift: ok');
