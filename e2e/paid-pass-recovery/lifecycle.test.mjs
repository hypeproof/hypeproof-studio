import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { runBounded } from './bounded-child.mjs';
import { stageEvidence } from './evidence.mjs';

test('bounded child redacts output and escalates a hung process through SIGKILL', async () => {
  const secret = 'PRIVATE_PROVIDER_VALUE';
  const started = Date.now();
  await assert.rejects(runBounded({
    command: process.execPath,
    args: ['-e', `process.on('SIGTERM',()=>{}); console.error('${secret}'); setInterval(()=>{},1000)`],
    cwd: process.cwd(), env: process.env, timeoutMs: 50, termGraceMs: 50, killGraceMs: 1000,
    redact: value => value.split(secret).join('[REDACTED]'),
  }), error => {
    assert.match(error.message, /timed out/);
    assert.match(error.message, /\[REDACTED\]/);
    assert.equal(error.message.includes(secret), false);
    return true;
  });
  assert.ok(Date.now() - started < 2000);
});

test('evidence staging scans all source files and copies only the explicit allowlist', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hps-paid-evidence-'));
  const source = path.join(root, 'source'), destination = path.join(root, 'upload'), secret = 'PRIVATE_EVIDENCE_VALUE';
  fs.mkdirSync(source);
  try {
    fs.writeFileSync(path.join(source, 'receipt.json'), '{"status":"PASS"}');
    fs.writeFileSync(path.join(source, 'unlisted.txt'), secret);
    assert.throws(() => stageEvidence(source, destination, [secret]), /secret-like value/);
    fs.writeFileSync(path.join(source, 'unlisted.txt'), 'harmless but not allowlisted');
    const offline = { code_input_visible: true, error: '연결 상태를 확인하세요.', code_entered_during_outage: false };
    fs.writeFileSync(path.join(source, 'offline-start.json'), JSON.stringify(offline));
    stageEvidence(source, destination, [secret]);
    assert.equal(fs.existsSync(path.join(destination, 'receipt.json')), true);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(destination, 'offline-start.json'), 'utf8')), offline);
    assert.equal(fs.existsSync(path.join(destination, 'unlisted.txt')), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('Keychain cleanup attempts restore, empty search-list restore, and deletion, then fails visibly', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hps-paid-keychain-'));
  const bin = path.join(root, 'bin'), log = path.join(root, 'security.log');
  fs.mkdirSync(bin);
  const shim = path.join(bin, 'security');
  fs.writeFileSync(shim, '#!/bin/sh\necho "$*" >> "$SECURITY_LOG"\nexit 1\n', { mode: 0o755 });
  const priorDefault = path.join(root, 'default'), priorList = path.join(root, 'list');
  fs.writeFileSync(priorDefault, '/tmp/original.keychain-db\n');
  fs.writeFileSync(priorList, '');
  try {
    const script = new URL('./keychain-cleanup.sh', import.meta.url).pathname;
    const result = spawnSync('/bin/bash', [script, '/tmp/test.keychain-db', priorDefault, priorList], {
      env: { ...process.env, PATH: `${bin}:/usr/bin:/bin`, SECURITY_LOG: log }, encoding: 'utf8',
    });
    assert.notEqual(result.status, 0);
    const calls = fs.readFileSync(log, 'utf8');
    assert.match(calls, /default-keychain -d user -s \/tmp\/original\.keychain-db/);
    assert.match(calls, /^list-keychains -d user -s$/m);
    assert.match(calls, /delete-keychain \/tmp\/test\.keychain-db/);
    assert.match(calls, /show-keychain-info \/tmp\/test\.keychain-db/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
