#!/usr/bin/env node
// Deployment-only, read-only schema observations. Never print ledger rows.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const columns = ['id', 'subject_key', 'contract_id', 'period_id', 'policy_revision', 'created_at'];
const ledgers = ['usage_jobs', 'usage_attempt_costs', 'usage_cost_evidence'];
export function assertDatabaseInfo(info) {
  if (info?.uuid !== '2427207c-272e-4ecd-9d16-7a1dcc0fc741') throw new Error('Unexpected deployment database');
}
export function decodeResults(output) {
  const value = JSON.parse(output);
  if (!Array.isArray(value) || value.length !== 1 || value[0]?.success !== true || !Array.isArray(value[0].results)) {
    throw new Error('D1 query did not return one successful result');
  }
  return value[0].results;
}

export async function inspectUsageSchema(query, phase, before) {
  if (!['before', 'after'].includes(phase)) throw new Error('Expected before or after');
  const objects = await query("SELECT name, type, sql FROM sqlite_master WHERE type IN ('table','index')");
  const names = new Set(objects.map(row => row.name));
  for (const name of ['usage_log', 'access_contracts', 'access_periods', 'model_usage_requests', ...ledgers]) {
    if (!names.has(name)) throw new Error(`Missing required table: ${name}`);
  }
  if (names.has('usage_jobs_observation_upgrade')) throw new Error('Incomplete usage_jobs migration');
  if ((await query('PRAGMA foreign_key_check')).length) throw new Error('Foreign key violations');
  const info = await query('PRAGMA table_info(usage_jobs)');
  if (info.map(row => row.name).join(',') !== columns.join(',')) throw new Error('Unexpected usage_jobs column order');
  const links = await query('PRAGMA foreign_key_list(usage_attempt_costs)');
  if (!links.some(row => row.from === 'job_id' && row.table === 'usage_jobs' && row.to === 'id')) {
    throw new Error('Missing attempt-to-job foreign key');
  }
  const counts = {};
  for (const table of ledgers) {
    const rows = await query(`SELECT COUNT(*) AS n FROM ${table}`);
    if (rows.length !== 1 || !Number.isSafeInteger(rows[0].n) || rows[0].n < 0) throw new Error('Invalid ledger count');
    counts[table] = rows[0].n;
  }
  if (phase === 'after') {
    if (before?.phase !== 'before' || !before.counts) throw new Error('Missing pre-migration observation');
    for (const table of ledgers) {
      if (!Number.isSafeInteger(before.counts[table]) || before.counts[table] < 0 || counts[table] < before.counts[table]) {
        throw new Error(`Ledger count decreased: ${table}`);
      }
    }
    for (const name of ['usage_request_attribution', 'usage_request_rows', 'image_edit_jobs', 'image_edit_retention']) {
      if (!names.has(name)) throw new Error(`Missing migrated object: ${name}`);
    }
    for (const name of columns.slice(2, 5)) {
      if (info.find(row => row.name === name)?.notnull !== 0) throw new Error(`Observation field is not nullable: ${name}`);
    }
    const sql = objects.find(row => row.name === 'usage_jobs')?.sql?.replace(/\s+/g, ' ').toLowerCase() ?? '';
    if (!sql.includes('check ((contract_id is null and period_id is null and policy_revision is null) or (contract_id is not null and period_id is not null and policy_revision is not null))')) {
      throw new Error('Missing all-null or all-set contract constraint');
    }
  }
  return { phase, counts, foreign_key_violations: 0, status: 'PASS' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [phase, worker, snapshot] = process.argv.slice(2);
    if (!worker || !snapshot) throw new Error('Usage: check-usage-schema.mjs before|after SERVICE_WORKER_DIR SNAPSHOT_JSON');
    const wrangler = args => execFileSync('npx', ['wrangler', ...args], {
      cwd: worker, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000,
    });
    assertDatabaseInfo(JSON.parse(wrangler(['d1', 'info', 'hypeproof-studio', '--json'])));
    const query = async sql => decodeResults(wrangler(['d1', 'execute', 'hypeproof-studio', '--remote', '--json', '--command', sql]));
    const result = await inspectUsageSchema(query, phase, phase === 'after' ? JSON.parse(readFileSync(snapshot, 'utf8')) : undefined);
    if (phase === 'before') writeFileSync(snapshot, JSON.stringify(result), { mode: 0o600 });
    console.log(JSON.stringify(result));
  } catch (error) {
    // External CLI output is deliberately not logged: schema counts suffice.
    console.error(`Usage schema check failed: ${error.status === undefined ? error.message : 'D1 command failed'}`);
    process.exitCode = 1;
  }
}
