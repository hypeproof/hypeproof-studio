import assert from 'node:assert/strict';
import { assertDatabaseInfo, decodeResults, inspectUsageSchema } from './check-usage-schema.mjs';

const names = ['usage_log', 'access_contracts', 'access_periods', 'model_usage_requests', 'usage_jobs', 'usage_attempt_costs', 'usage_cost_evidence', 'usage_request_attribution', 'usage_request_rows', 'image_edit_jobs', 'image_edit_retention'];
const constraint = 'CHECK ((contract_id IS NULL AND period_id IS NULL AND policy_revision IS NULL) OR (contract_id IS NOT NULL AND period_id IS NOT NULL AND policy_revision IS NOT NULL))';
const fixture = () => ({
  objects: names.map(name => ({ name, type: name === 'image_edit_retention' ? 'index' : 'table', sql: name === 'usage_jobs' ? constraint : '' })),
  info: ['id', 'subject_key', 'contract_id', 'period_id', 'policy_revision', 'created_at'].map(name => ({ name, notnull: 0 })),
  links: [{ from: 'job_id', table: 'usage_jobs', to: 'id' }], violations: [], count: 9,
});
const query = data => async sql => {
  if (sql.startsWith('SELECT name')) return data.objects;
  if (sql === 'PRAGMA foreign_key_check') return data.violations;
  if (sql === 'PRAGMA table_info(usage_jobs)') return data.info;
  if (sql === 'PRAGMA foreign_key_list(usage_attempt_costs)') return data.links;
  if (/^SELECT COUNT\(\*\) AS n FROM usage_(jobs|attempt_costs|cost_evidence)$/.test(sql)) return [{ n: data.count }];
  throw new Error('Unexpected query');
};
const baseline = await inspectUsageSchema(query(fixture()), 'before');
assert.equal((await inspectUsageSchema(query(fixture()), 'after', baseline)).status, 'PASS');
const cases = [
  [data => data.objects.splice(data.objects.findIndex(row => row.name === 'usage_log'), 1), /Missing required table/],
  [data => data.objects.push({ name: 'usage_jobs_observation_upgrade' }), /Incomplete/],
  [data => data.violations.push({ table: 'usage_attempt_costs' }), /Foreign key/],
  [data => data.info.reverse(), /column order/],
  [data => data.links.length = 0, /foreign key/],
  [data => data.count = 8, /decreased/],
  [data => data.count = null, /Invalid ledger count/],
  [data => data.objects.splice(data.objects.findIndex(row => row.name === 'image_edit_jobs'), 1), /Missing migrated object/],
  [data => data.info[2].notnull = 1, /not nullable/],
  [data => data.objects.find(row => row.name === 'usage_jobs').sql = '', /constraint/],
];
for (const [mutate, expected] of cases) { const data = fixture(); mutate(data); await assert.rejects(inspectUsageSchema(query(data), 'after', baseline), expected); }
await assert.rejects(inspectUsageSchema(query(fixture()), 'after'), /pre-migration observation/);
assert.deepEqual(decodeResults('[{"success":true,"results":[]}]'), []);
for (const output of ['{}', '[]', '[{"success":false,"results":[]}]', '[{"success":true}]', '[{"success":true,"results":[]},{"success":true,"results":[]}]']) {
  assert.throws(() => decodeResults(output));
}
assertDatabaseInfo({ uuid: '2427207c-272e-4ecd-9d16-7a1dcc0fc741' });
for (const info of [null, {}, { uuid: 'different-database' }]) assert.throws(() => assertDatabaseInfo(info), /database/);
console.log('PASS usage schema release guards: expected database; malformed/failed result; missing tables; interrupted rebuild; FK; column order/nullability/CHECK; ledger preservation; successful before/after');
