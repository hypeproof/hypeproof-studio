import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {assertMacReceipt, assertMacRun, assertReceiptArchive, verifyMacDistribution,
  MAC_RECEIPT, MAC_RECEIPT_ARTIFACT, MAC_ZIP} from '../macos-signing-receipt.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const sha = 'a'.repeat(40), version = '2026.1112.0';
const policy = {team_id: 'RZBNT9ZB67', bundle_id: 'ai.hypeproof.studio'};
const bytes = Buffer.from('synthetic final ZIP, not a signed app');
const artifact = {sha256: digest(bytes), bytes: bytes.length};
const context = {sha, version, policy, artifact};
test('mirror verifier can read immutable source Actions artifacts without write permission', () => {
  const workflow = fs.readFileSync(fileURLToPath(new URL('../../../.github/workflows/mirror-release.yml', import.meta.url)), 'utf8');
  assert.match(workflow, /permissions:\n  contents: read\n  actions: read/);
  assert.match(workflow, /GH_TOKEN="\$GITHUB_TOKEN_SOURCE" node scripts\/check-unified-release\.mjs/);
});
const good = () => ({schema: 'hps-macos-release-signing/v1', repository: 'hypeproof/hypeproof-studio',
  release_eligible: true, source_sha: sha, platform: 'darwin-arm64', ...policy, bundle_version: version,
  certificate_sha1: 'A'.repeat(40), signing: {type: 'Developer ID Application', hardened_runtime: true, secure_timestamp: true},
  notarization: {submission_id: '12345678-abcd-abcd-abcd-123456789abc', status: 'Accepted', submitted_archive_sha256: 'b'.repeat(64)},
  verification: {codesign: true, stapler: true, gatekeeper: true}, artifact: {name: MAC_ZIP, ...artifact},
  provenance: {kind: 'github-actions', workflow: '.github/workflows/build-mac.yml', run_id: 123, run_attempt: 2}});
const run = () => ({id: 123, run_attempt: 2, path: '.github/workflows/build-mac.yml', head_sha: sha,
  repository: {full_name: 'hypeproof/hypeproof-studio'}, status: 'completed', conclusion: 'success', event: 'push'});

test('qualifies only the final package bound to official identity and actual successful build attempt', () => {
  assert.equal(assertMacReceipt(good(), context).source_sha, sha);
  assert.doesNotThrow(() => assertMacRun(good(), run()));
  const cases = [r => r.release_eligible = false, r => r.source_sha = 'c'.repeat(40),
    r => r.team_id = 'OTHERTEAM1', r => r.bundle_id = 'other.app', r => r.bundle_version = '0.0.1',
    r => r.artifact.sha256 = r.notarization.submitted_archive_sha256, r => r.artifact.bytes++,
    r => r.signing.hardened_runtime = false, r => r.signing.secure_timestamp = false,
    r => r.notarization.status = 'In Progress', r => r.verification.stapler = false,
    r => r.provenance.kind = 'local', r => r.provenance.run_id = 0,
    r => r.provenance.workflow = '.github/workflows/other.yml'];
  for (const change of cases) { const r = good(); change(r); assert.throws(() => assertMacReceipt(r, context)); }
  for (const change of [r => r.run_attempt++, r => r.head_sha = 'd'.repeat(40), r => r.event = 'pull_request',
    r => r.conclusion = 'failure', r => r.path = 'other.yml', r => r.repository.full_name = 'other/repo']) {
    const value = run(); change(value); assert.throws(() => assertMacRun(good(), value));
  }
});

function archive(raw, extra = false) {
  return execFileSync('python3', ['-c',
    'import io,sys,zipfile; b=io.BytesIO(); z=zipfile.ZipFile(b,"w"); z.writestr(sys.argv[1],sys.stdin.buffer.read()); z.writestr("unexpected","x") if sys.argv[2]=="yes" else None; z.close(); sys.stdout.buffer.write(b.getvalue())',
    MAC_RECEIPT, extra ? 'yes' : 'no'], {input: raw});
}
test('proves exact receipt bytes using the immutable bounded Actions artifact', () => {
  const raw = Buffer.from(JSON.stringify(good())), zip = archive(raw);
  const meta = {name: MAC_RECEIPT_ARTIFACT, expired: false, digest: `sha256:${digest(zip)}`};
  assert.doesNotThrow(() => assertReceiptArchive(raw, zip, meta));
  assert.throws(() => assertReceiptArchive(Buffer.from('{}'), zip, meta));
  assert.throws(() => assertReceiptArchive(raw, zip, {...meta, expired: true}));
  assert.throws(() => assertReceiptArchive(raw, zip, {...meta, digest: `sha256:${'0'.repeat(64)}`}));
  const extra = archive(raw, true);
  assert.throws(() => assertReceiptArchive(raw, extra, {...meta, digest: `sha256:${digest(extra)}`}));
});

test('package tampering, missing receipt and local-only evidence fail before publication; legacy stays legacy', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mac-proof-'));
  t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
  fs.writeFileSync(path.join(dir, MAC_ZIP), bytes);
  fs.writeFileSync(path.join(dir, MAC_RECEIPT), JSON.stringify(good()));
  assert.equal(verifyMacDistribution(dir, {...context, remote: false}).status, 'official');
  assert.equal(verifyMacDistribution(dir, {...context, policy: null}).status, 'legacy');
  fs.appendFileSync(path.join(dir, MAC_ZIP), 'tampered');
  assert.throws(() => verifyMacDistribution(dir, {...context, remote: false}), /final ZIP differs/);
  fs.rmSync(path.join(dir, MAC_RECEIPT));
  assert.throws(() => verifyMacDistribution(dir, {...context, remote: false}));
});
