// Verify the existing ZIP and the small immutable Actions receipt (#620).
// This is package provenance, never human approval or installed-app acceptance.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync, spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {sha256} from '../../e2e/unified-release/artifact.mjs';

export const MAC_RECEIPT = 'HypeProof-Studio-darwin-arm64.signing.json';
export const MAC_ZIP = 'HypeProof-Studio-darwin-arm64.zip';
export const MAC_RECEIPT_ARTIFACT = 'hypeproof-studio-macos-signing-receipt';
const REPO = 'hypeproof/hypeproof-studio';
const WORKFLOW = '.github/workflows/build-mac.yml';
const HASH = /^[a-f0-9]{64}$/;
const fail = message => { throw Error(`Mac signing: ${message}`); };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const git = (...args) => execFileSync('git', args, {encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();

export function signingPolicy(sha) {
  if (!/^[a-f0-9]{40}$/.test(sha)) fail('full source SHA required');
  git('cat-file', '-e', `${sha}^{commit}`); // unreadable source is not a legacy release
  const file = 'config/macos-distribution.json';
  if (!git('ls-tree', '--name-only', sha, '--', file)) return null;
  const policy = JSON.parse(git('show', `${sha}:${file}`));
  if (policy.schema !== 'hps-macos-distribution/v1' || policy.required !== true
      || policy.team_id !== 'RZBNT9ZB67' || policy.bundle_id !== 'ai.hypeproof.studio') fail('invalid candidate policy');
  return policy;
}

export function assertMacReceipt(receipt, {sha, version, artifact, policy}) {
  if (!policy || receipt?.schema !== 'hps-macos-release-signing/v1'
      || receipt.release_eligible !== true || receipt.repository !== REPO
      || receipt.source_sha !== sha || receipt.platform !== 'darwin-arm64'
      || receipt.bundle_id !== policy.bundle_id || receipt.team_id !== policy.team_id
      || receipt.bundle_version !== version || !/^[A-F0-9]{40}$/.test(receipt.certificate_sha1 ?? '')) fail('identity or eligibility mismatch');
  if (receipt.signing?.type !== 'Developer ID Application' || receipt.signing.hardened_runtime !== true
      || receipt.signing.secure_timestamp !== true || receipt.notarization?.status !== 'Accepted'
      || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(receipt.notarization.submission_id ?? '')
      || !HASH.test(receipt.notarization.submitted_archive_sha256 ?? '')
      || ['codesign', 'stapler', 'gatekeeper'].some(k => receipt.verification?.[k] !== true)) fail('incomplete Apple verification');
  if (receipt.artifact?.name !== MAC_ZIP || receipt.artifact.sha256 !== artifact.sha256
      || receipt.artifact.bytes !== artifact.bytes || !HASH.test(artifact.sha256)
      || !Number.isSafeInteger(artifact.bytes) || artifact.bytes <= 0) fail('final ZIP differs');
  const p = receipt.provenance;
  if (p?.kind !== 'github-actions' || p.workflow !== WORKFLOW
      || !Number.isSafeInteger(p.run_id) || p.run_id <= 0
      || !Number.isSafeInteger(p.run_attempt) || p.run_attempt <= 0) fail('trusted build provenance required');
  return receipt;
}

export function assertMacRun(receipt, run) {
  const p = receipt.provenance;
  if (run.id !== p.run_id || run.run_attempt !== p.run_attempt || run.path !== WORKFLOW
      || run.head_sha !== receipt.source_sha || run.repository?.full_name !== REPO
      || run.status !== 'completed' || run.conclusion !== 'success'
      || !['push', 'workflow_dispatch'].includes(run.event)) fail('build run mismatch or unsuccessful');
}

export function assertReceiptArchive(raw, archive, metadata) {
  if (!Buffer.isBuffer(archive) || archive.length > 1024 * 1024 || archive.length === 0
      || metadata.name !== MAC_RECEIPT_ARTIFACT || metadata.expired !== false
      || metadata.digest !== `sha256:${hash(archive)}`) fail('untrusted receipt artifact');
  // zipfile reads one bounded member in memory; no paths are extracted to disk.
  const payload = execFileSync('python3', ['-c',
    'import io,sys,zipfile; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); n=z.infolist(); assert len(n)==1 and n[0].filename==sys.argv[1] and n[0].file_size<=65536 and not n[0].is_dir(); sys.stdout.buffer.write(z.read(n[0]))', MAC_RECEIPT],
  {input: archive, maxBuffer: 65536, stdio: ['pipe', 'pipe', 'pipe']});
  if (!payload.equals(raw)) fail('release receipt differs from immutable build artifact');
}

export function verifyMacDistribution(directory, {sha, version, policy = signingPolicy(sha), remote = true} = {}) {
  if (!policy) return {status: 'legacy', reason: 'candidate predates official signing policy'};
  const receiptFile = path.join(directory, MAC_RECEIPT), zip = path.join(directory, MAC_ZIP);
  for (const file of [receiptFile, zip]) if (!fs.lstatSync(file).isFile()) fail('regular package and receipt files required');
  if (fs.statSync(receiptFile).size > 65536) fail('oversized receipt');
  const raw = fs.readFileSync(receiptFile);
  const receipt = assertMacReceipt(JSON.parse(raw), {sha, version, policy,
    artifact: {sha256: sha256(zip), bytes: fs.statSync(zip).size}});
  if (remote) {
    const api = (suffix, options = {}) => execFileSync('gh', ['api', `repos/${REPO}/${suffix}`],
      {maxBuffer: 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], ...options});
    const run = JSON.parse(api(`actions/runs/${receipt.provenance.run_id}/attempts/${receipt.provenance.run_attempt}`));
    assertMacRun(receipt, run);
    const artifacts = JSON.parse(api(`actions/runs/${run.id}/artifacts?name=${MAC_RECEIPT_ARTIFACT}&per_page=100`)).artifacts;
    const matches = artifacts.filter(a => a.name === MAC_RECEIPT_ARTIFACT && !a.expired
      && Date.parse(a.created_at) >= Date.parse(run.run_started_at)
      && Date.parse(a.created_at) <= Date.parse(run.updated_at));
    if (matches.length !== 1 || !Number.isSafeInteger(matches[0].id)) fail('missing or ambiguous signing artifact for build attempt');
    assertReceiptArchive(raw, api(`actions/artifacts/${matches[0].id}/zip`), matches[0]);
  }
  return {status: 'official', receipt};
}

export function verifyMacApp(app) {
  const requirement = 'anchor apple generic and certificate 1[field.1.2.840.113635.100.6.2.6] exists '
    + 'and certificate leaf[field.1.2.840.113635.100.6.1.13] exists '
    + 'and certificate leaf[subject.OU] = "RZBNT9ZB67" and identifier "ai.hypeproof.studio"';
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--all-architectures', `-R=${requirement}`, app], {stdio: 'pipe'});
  const result = spawnSync('/usr/sbin/spctl', ['--assess', '--type', 'execute', '--verbose=2', app], {encoding: 'utf8', timeout: 120000});
  if (result.status !== 0 || !/^source=Notarized Developer ID$/m.test(result.stderr + result.stdout)) fail('Gatekeeper did not accept notarized Developer ID');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  const [directory, sha, version, app] = process.argv.slice(2);
  try {
    const result = verifyMacDistribution(directory, {sha, version});
    if (app && result.status === 'official') verifyMacApp(app);
    console.log(JSON.stringify(result));
  }
  catch (error) { console.error(error.message.startsWith('Mac signing:') ? error.message : 'Mac signing: required evidence unavailable or malformed'); process.exitCode = 1; }
}
