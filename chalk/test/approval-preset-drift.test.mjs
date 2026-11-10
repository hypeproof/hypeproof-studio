// CGP-AGENT-R-019 (REQ-CGP-AGENT-35) — approval preset names and descriptions come from one Service-owned catalog.
// Chalk's picker and Studio's composer label render the strings the Service serves; the only copies of those strings
// left in Studio are (a) Chalk's APPROVAL_FALLBACK, which names a saved preset before the catalog is read, and (b) test
// stand-ins. This test fails when any of them drifts from the catalog fixture, and, when a sibling hypeproof-service
// checkout exists (or HYPEPROOF_SERVICE_DIR points at one), when the fixture itself drifts from the Service source.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SERVICE_APPROVAL_PRESETS } from './fixtures/approval-preset-catalog.mjs';
import { servedApprovalPreset } from '../../extensions/hypeproof-chat/src/approvalPreset.ts';

const here = dirname(fileURLToPath(import.meta.url));
const page = readFileSync(join(here, '../src/ui/authoring.html'), 'utf8');

/** Compare Chalk's pre-catalog names with the catalog labels; returns the drifted ids. */
export function fallbackDrift(html, catalog) {
  const m = /const APPROVAL_FALLBACK=\{([^}]*)\}/.exec(html);
  assert.ok(m, 'authoring.html declares APPROVAL_FALLBACK');
  const fallback = Object.fromEntries([...m[1].matchAll(/(\w+):'([^']*)'/g)].map((x) => [x[1], x[2]]));
  const drift = catalog.filter((p) => fallback[p.id] !== p.label).map((p) => p.id);
  for (const id of Object.keys(fallback)) if (!catalog.some((p) => p.id === id)) drift.push(id);
  return drift;
}

assert.deepEqual(SERVICE_APPROVAL_PRESETS.map((p) => p.id), ['always_ask', 'before_changes', 'important_only'], 'catalog order is strictest first');
assert.deepEqual(fallbackDrift(page, SERVICE_APPROVAL_PRESETS), [], 'Chalk APPROVAL_FALLBACK names equal the Service catalog labels');
// Negative control: the check really sees a changed label and an extra id.
assert.deepEqual(fallbackDrift(page, SERVICE_APPROVAL_PRESETS.map((p) => (p.id === 'before_changes' ? { ...p, label: p.label + '!' } : p))), ['before_changes']);
assert.deepEqual(fallbackDrift(page, SERVICE_APPROVAL_PRESETS.slice(1)), ['always_ask']);

// Studio renders exactly the served text: the profile reader returns label and description untouched.
for (const p of SERVICE_APPROVAL_PRESETS) {
  assert.deepEqual(servedApprovalPreset({ approval_preset: { ...p } }), p, `Studio reads ${p.id} verbatim`);
}

// Chalk renders the served text as-is: the picker takes label and description from the catalog entry, with no per-id copy.
assert.match(page, /typeof p\.label==='string'&&p\.label\.trim\(\)\?p\.label:APPROVAL_FALLBACK\[p\.id\],typeof p\.description==='string'\?p\.description:''/, 'Chalk picker renders catalog label and description');

// The fixture against the Service source, when a checkout is at hand (CI without the private repo skips this).
const serviceDir = process.env.HYPEPROOF_SERVICE_DIR || resolve(here, '../../../hypeproof-service');
const source = join(serviceDir, 'worker/src/lib/lesson-approval-preset.ts');
if (existsSync(source)) {
  const text = readFileSync(source, 'utf8');
  for (const p of SERVICE_APPROVAL_PRESETS) {
    assert.ok(text.includes(`label: '${p.label}'`), `Service source still carries label ${p.id}`);
    assert.ok(text.includes(`description: '${p.description}'`), `Service source still carries description ${p.id}`);
  }
  console.log('  ok  fixture equals Service source');
} else console.log('  NOT RUN  Service source comparison (no sibling hypeproof-service checkout)');
console.log('approval-preset-drift: ok');
