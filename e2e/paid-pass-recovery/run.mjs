#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { appIdentity, treeHash } from '../unified-release/artifact.mjs';
import { candidateService, assertCandidateServiceUnchanged, redactEvidence } from '../unified-release/candidate-service.mjs';
import { createRecoveryProxy } from './proxy.mjs';
import { runBounded } from './bounded-child.mjs';
import { assertNoKnownSecrets } from './evidence.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const [appDirectory, outputDirectory, studioSha, version, publicAppSha, mode = 'preflight'] = process.argv.slice(2);
const serviceSource = process.env.HPS_SERVICE_SOURCE;
const servicePin = JSON.parse(fs.readFileSync(new URL('./service-harness.json', import.meta.url), 'utf8'));
const deploymentPin = JSON.parse(fs.readFileSync(path.join(root, 'config/service-deployment.json'), 'utf8'));
const outageMs = mode === 'full' ? 41 * 60 * 1000 : mode === 'preflight' ? 5000 : NaN;
const freePort = async () => {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  await new Promise(resolve => server.close(resolve));
  return port;
};
const waitHealth = async (url, child) => {
  for (let attempt = 0; attempt < 80; attempt++) {
    if (child && (child.exitCode !== null || child.signalCode !== null)) break;
    try { if ((await fetch(url, { signal: AbortSignal.timeout(500) })).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`isolated recovery service did not become healthy: ${url}`);
};
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
let temporary, gateway, gatewayLog, gatewayLogPath, proxy, activeToken, serviceSecret, proxySecret;
let failure;
try {
  if (process.platform !== 'darwin' || !appDirectory || !outputDirectory || !studioSha || !version || !publicAppSha || !Number.isFinite(outageMs)) {
    throw new Error('Usage: run.mjs APP OUTPUT STUDIO_SHA VERSION APP_SHA preflight|full (macOS only)');
  }
  if (!serviceSource || !process.env.ANTHROPIC_API_KEY || !process.env.HPS_TEST_KEYCHAIN_PATH) throw new Error('missing isolated hosted recovery prerequisite');
  if (git('rev-parse', 'HEAD') !== studioSha || git('status', '--porcelain', '--untracked-files=no')) throw new Error('Studio driver must be clean and exact');
  const defaultKeychain = execFileSync('security', ['default-keychain', '-d', 'user'], { encoding: 'utf8' }).trim().replace(/^"|"$/g, '');
  if (fs.realpathSync(defaultKeychain) !== fs.realpathSync(process.env.HPS_TEST_KEYCHAIN_PATH)) throw new Error('ephemeral test keychain is not the user-domain default');
  const app = appIdentity(appDirectory), treeBefore = treeHash(appDirectory);
  if (app.sha !== publicAppSha || app.version !== version || app.extensionVersion !== version || app.name !== 'HypeProof Studio') throw new Error('public App identity mismatch');
  const candidate = candidateService(serviceSource, servicePin);
  const paidRuntimeFiles = [
    'worker/src/lib/native-trial-grants.ts',
    'worker/src/middleware/native-trial-budget.ts',
    'worker/src/routes/messages.ts',
    'worker/src/lib/sse.ts',
    'worker/src/profiles/studio-native-trial.ts',
    'worker/src/profiles/synthetic-release-acceptance.ts',
  ];
  const runtimeDrift = execFileSync('git', ['diff', '--name-only', `${deploymentPin.sha}..${servicePin.sha}`, '--', ...paidRuntimeFiles], { cwd: serviceSource, encoding: 'utf8' }).trim().split('\n').filter(Boolean);
  if (runtimeDrift.length) throw new Error(`paid runtime drifted from prepared Service baseline: ${runtimeDrift.join(',')}`);
  fs.mkdirSync(outputDirectory, { recursive: true });
  temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'hps-paid-recovery-'));
  const backendPort = await freePort(), frontPort = await freePort(), controlPort = await freePort();
  serviceSecret = randomUUID() + randomUUID();
  proxySecret = randomUUID() + randomUUID();
  const tokenFile = path.join(temporary, 'participant-token');
  const serviceEvidence = path.join(outputDirectory, 'service');
  fs.mkdirSync(serviceEvidence, { recursive: true });
  gatewayLogPath = path.join(temporary, 'gateway.log');
  gatewayLog = fs.openSync(gatewayLogPath, 'w', 0o600);
  const serviceEnv = {
    ...process.env,
    HPS_NATIVE_PORT: String(backendPort),
    HPS_NATIVE_EVIDENCE_DIR: serviceEvidence,
    HPS_E2E_TOKEN_FILE: tokenFile,
    HPS_NATIVE_MANAGED: '1',
    HPS_UNIFIED_LIVE: '1',
    HPS_NATIVE_PAID_RECOVERY: '1',
    HPS_RECOVERY_CONTROL_SECRET: serviceSecret,
    HPS_NATIVE_ISOLATED_KEYCHAIN: '1',
  };
  gateway = spawn(process.execPath, ['--experimental-strip-types', '--import', pathToFileURL(candidate.loader).href, candidate.gateway], {
    cwd: path.join(root, 'e2e'), env: serviceEnv, stdio: ['ignore', gatewayLog, gatewayLog],
  });
  await waitHealth(`http://127.0.0.1:${backendPort}/v1/health`, gateway);
  activeToken = fs.readFileSync(tokenFile, 'utf8').trim();
  proxy = await createRecoveryProxy({ frontPort, backendPort, controlPort, secret: proxySecret });
  await waitHealth(`http://127.0.0.1:${frontPort}/v1/health`);
  assertCandidateServiceUnchanged(serviceSource, servicePin, candidate.manifest);
  const appEnv = { ...process.env };
  for (const name of Object.keys(appEnv)) if (/API_KEY|ADMIN_PASSWORD|TOKEN$/.test(name)) delete appEnv[name];
  Object.assign(appEnv, {
    HPS_APP_PATH: path.resolve(appDirectory),
    HPS_E2E_TOKEN_FILE: tokenFile,
    HPS_E2E_PROXY_URL: `http://127.0.0.1:${frontPort}/v1`,
    HPS_NATIVE_EVIDENCE_DIR: path.resolve(outputDirectory),
    HPS_PAID_RECOVERY: '1',
    HPS_RECOVERY_MODE: mode,
    HPS_RECOVERY_OUTAGE_MS: String(outageMs),
    HPS_RECOVERY_PROXY_CONTROL_URL: `http://127.0.0.1:${controlPort}`,
    HPS_RECOVERY_PROXY_SECRET: proxySecret,
    HPS_RECOVERY_SERVICE_CONTROL_URL: `http://127.0.0.1:${backendPort}/__test/paid-recovery`,
    HPS_RECOVERY_CONTROL_SECRET: serviceSecret,
    HPS_NATIVE_ISOLATED_KEYCHAIN: '1',
    HPS_QUIET: '1',
    HPS_QUIET_NO_HIDE: '1',
  });
  await runBounded({
    command: process.execPath,
    args: ['node_modules/@playwright/test/cli.js', 'test', '--config=native-trial.config.ts', '--workers=1', '--retries=0'],
    cwd: path.join(root, 'e2e'), env: appEnv, timeoutMs: outageMs + 10 * 60_000,
    redact: value => redactEvidence(value, [process.env.ANTHROPIC_API_KEY, activeToken, serviceSecret, proxySecret]),
  });
  assertCandidateServiceUnchanged(serviceSource, servicePin, candidate.manifest);
  const result = JSON.parse(fs.readFileSync(path.join(outputDirectory, 'result.json'), 'utf8'));
  if (result.status !== 'PASS' || result.mode !== mode || result.code_entries !== 1 || result.same_grant !== true || result.file_retained !== true || result.offline_elapsed_ms < outageMs) throw new Error('paid recovery App assertions incomplete');
  const api = JSON.parse(fs.readFileSync(path.join(serviceEvidence, 'api-evidence.json'), 'utf8'));
  if (api.request_limit !== 12 || api.attempts < 1 || api.attempts > 12 || api.failures.length || api.calls.some(call => call.status !== 200)) throw new Error('paid recovery upstream budget failed');
  const treeAfter = treeHash(appDirectory);
  if (treeAfter !== treeBefore) throw new Error('public App was modified');
  fs.writeFileSync(path.join(outputDirectory, 'receipt.json'), JSON.stringify({
    schema: 'hps-hosted-paid-recovery/1', status: 'PASS', mode,
    evidence_level: mode === 'full' ? 'hosted-native-candidate' : 'hosted-keychain-preflight',
    studio_sha: studioSha, app, app_tree_sha256: treeBefore,
    service_harness: candidate.manifest, prepared_service_baseline_sha: deploymentPin.sha,
    paid_runtime_drift: runtimeDrift, keychain: 'ephemeral-hosted-runner',
    provider_attempt_limit: api.request_limit, provider_attempts: api.attempts,
    grant_request_limit: result.grant_request_limit, grant_requests_used: result.grant_requests_used,
    outage_ms: result.offline_elapsed_ms, observed_copy: result.observed_copy, checks: result.checks,
    boundaries: ['no production state', 'no payment transaction', 'no public App rewrite', 'not classroom acceptance'],
  }, null, 2));
  console.log(`PASS hosted paid recovery ${mode}; outage ${result.offline_elapsed_ms}ms`);
} catch (error) {
  failure = error;
  if (outputDirectory) {
    fs.mkdirSync(outputDirectory, { recursive: true });
    const message = redactEvidence(String(error?.message ?? error), [process.env.ANTHROPIC_API_KEY, activeToken, serviceSecret, proxySecret]);
    fs.writeFileSync(path.join(outputDirectory, 'failure.json'), JSON.stringify({ status: 'FAIL', mode, error: message }, null, 2));
  }
  process.exitCode = 1;
} finally {
  let cleanupError;
  try { await proxy?.close(); } catch (error) { cleanupError = error; }
  if (gateway && gateway.exitCode === null && gateway.signalCode === null) {
    const stopped = new Promise(resolve => gateway.once('exit', resolve));
    gateway.kill('SIGTERM');
    const termStopped = await Promise.race([stopped.then(() => true), new Promise(resolve => setTimeout(() => resolve(false), 3000))]);
    if (!termStopped && gateway.exitCode === null && gateway.signalCode === null) {
      gateway.kill('SIGKILL');
      const killStopped = await Promise.race([stopped.then(() => true), new Promise(resolve => setTimeout(() => resolve(false), 3000))]);
      if (!killStopped) cleanupError ??= new Error('paid recovery gateway did not stop after SIGKILL');
    }
  }
  if (gatewayLog !== undefined) fs.closeSync(gatewayLog);
  if (gatewayLogPath && fs.existsSync(gatewayLogPath) && outputDirectory) {
    const secrets = [process.env.ANTHROPIC_API_KEY, activeToken, serviceSecret, proxySecret].filter(Boolean);
    fs.writeFileSync(path.join(outputDirectory, 'gateway.log'), redactEvidence(fs.readFileSync(gatewayLogPath, 'utf8'), secrets), { mode: 0o600 });
  }
  if (outputDirectory) {
    try { assertNoKnownSecrets(outputDirectory, [process.env.ANTHROPIC_API_KEY, activeToken, serviceSecret, proxySecret]); }
    catch (error) { cleanupError ??= error; }
  }
  if (temporary && (!gateway || gateway.exitCode !== null || gateway.signalCode !== null)) fs.rmSync(temporary, { recursive: true, force: true });
  if (cleanupError) {
    process.exitCode = 1;
    const cleanupMessage = redactEvidence(String(cleanupError?.message ?? cleanupError), [serviceSecret, proxySecret]);
    if (outputDirectory) fs.writeFileSync(path.join(outputDirectory, 'cleanup-failure.json'), JSON.stringify({ status: 'FAIL', error: cleanupMessage }, null, 2));
    console.error(cleanupMessage);
  }
  if (failure) console.error(redactEvidence(String(failure?.message ?? failure), [process.env.ANTHROPIC_API_KEY, activeToken, serviceSecret, proxySecret]));
}
