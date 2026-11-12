// #3290: filter the existing inventory, never query the filesystem or change provenance.
import assert from 'node:assert/strict';
import { filterWorks } from '../webview-ui/src/myWorks.ts';
const entries = Object.freeze([
  Object.freeze({ path: '자료/발표.HTML', kind: 'learner_changed', at: 3 }),
  Object.freeze({ path: 'images/cover.png', kind: 'ai_created', at: 2 }),
  Object.freeze({ path: 'notes/발표.txt', kind: 'unobserved', at: 1 }),
]);
assert.equal(filterWorks(entries, '  '), entries);
assert.deepEqual(filterWorks(entries, 'html'), [entries[0]]);
assert.deepEqual(filterWorks(entries, '자료'.normalize('NFD')), [entries[0]]);
assert.deepEqual(filterWorks(entries, ' 발표 '), [entries[0], entries[2]]);
assert.deepEqual(filterWorks(entries, 'images/'), [entries[1]]);
assert.deepEqual(filterWorks(entries, '.*'), []);
assert.deepEqual(filterWorks(entries, 'ai_created'), []); // Search paths, not provenance labels.
assert.deepEqual(filterWorks(entries, 'missing'), []);
assert.equal(filterWorks(entries, 'cover')[0], entries[1]);
console.log('PASS works search: path/name, NFC, case, literal, empty and original provenance/order');
