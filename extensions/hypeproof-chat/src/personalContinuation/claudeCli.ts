import { spawn } from 'node:child_process';
import { access, lstat, mkdtemp, realpath, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir, tmpdir, userInfo } from 'node:os';
import { delimiter, isAbsolute, join } from 'node:path';
import { createHash } from 'node:crypto';
import { CONTINUATION_LIMITS } from './session.ts';
import type { ClaudeDisclosure, ContinuationInspection, ContinuationResult, ContinuationSnapshot, ContinuationTransport } from './types.ts';

// Supported public CLI contracts, checked against 2.1.309 on 2026-10-23:
// https://code.claude.com/docs/en/cli-reference
// https://code.claude.com/docs/en/managed-settings
// https://code.claude.com/docs/en/hooks#disable-or-remove-hooks
// Safe mode preserves official auth. Bare mode does not preserve subscription auth.
const MIN_VERSION = 309;
const MAX_STDOUT = 256 * 1024;
const flags = ['--safe-mode', '--restricted', '--tools', '--strict-mcp-config', '--no-session-persistence', '--permission-prompts'];
const billingNotice = '개인 Claude 계정의 구독 또는 해당 계정에 설정된 추가 사용 요금이 적용돼요. 추가 사용이 켜져 있으면 제공자가 청구할 수 있어요. Studio 이용권으로 자동 전환하지 않아요.';
const fingerprint = (env: NodeJS.ProcessEnv) => createHash('sha256').update(JSON.stringify(env)).digest('hex');
type ProcessResult = { code: number | null; stdout: string; stderr: string; failure?: string };

/** Forward official auth/provider configuration without copying credentials into app storage. */
export function personalClaudeEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [name, value] of Object.entries(source)) {
    if (['USER', 'LOGNAME', '__CF_USER_TEXT_ENCODING'].includes(name)) { env[name] = value; continue; }
    if (/^(?:ANTHROPIC_|AWS_|GOOGLE_|CLOUDSDK_|AZURE_|VERTEX_|BEDROCK_)/.test(name)
        || /^(?:PATH|HOME|USERPROFILE|APPDATA|LOCALAPPDATA|SYSTEMROOT|SystemRoot|TEMP|TMP|TMPDIR|XDG_CONFIG_HOME|LANG|LC_ALL|HTTPS_PROXY|HTTP_PROXY|NO_PROXY|https_proxy|http_proxy|no_proxy|NODE_EXTRA_CA_CERTS|SSL_CERT_FILE|SSL_CERT_DIR|CLAUDE_CONFIG_DIR|CLAUDE_CODE_OAUTH_TOKEN|CLAUDE_CODE_USE_BEDROCK|CLAUDE_CODE_USE_VERTEX|CLAUDE_CODE_USE_FOUNDRY|CLAUDE_CODE_USE_ANTHROPIC_AWS)$/.test(name)) env[name] = value;
  }
  // These affect retention or optional discovery, never authentication or payment source.
  env.CLAUDE_CODE_SKIP_PROMPT_HISTORY = '1';
  env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1';
  env.CLAUDE_CODE_DISABLE_REFUSAL_FALLBACK = '1';
  env.CLAUDE_CODE_DISABLE_NONSTREAMING_FALLBACK = '1';
  env.CLAUDE_CODE_DISABLE_FILE_MENTIONS = '1';
  env.CLAUDE_CODE_MAX_RETRIES = '0';
  return env;
}

async function run(executable: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, signal: AbortSignal, input = '', timeout = 15_000): Promise<ProcessResult> {
  if (signal.aborted) return { code: null, stdout: '', stderr: '', failure: 'cancelled' };
  return new Promise(resolve => {
    let stdout = '', stderr = '', failure: string | undefined;
    const child = spawn(executable, args, { cwd, env, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let settled = false;
    let hardKill: ReturnType<typeof setTimeout> | undefined;
    const stop = (code: string) => {
      if (failure) return;
      failure = code;
      child.kill('SIGTERM');
      hardKill = setTimeout(() => child.kill('SIGKILL'), 250);
      hardKill.unref();
    };
    const abort = () => stop('cancelled');
    signal.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => stop('timeout'), timeout);
    timer.unref();
    const finish = (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer); if (hardKill) clearTimeout(hardKill);
      signal.removeEventListener('abort', abort);
      resolve({ code, stdout, stderr, failure });
    };
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (data: string) => { if (Buffer.byteLength(stdout) + Buffer.byteLength(data) > MAX_STDOUT) stop('output_limit'); else stdout += data; });
    child.stderr.on('data', (data: string) => { if (Buffer.byteLength(stderr) + Buffer.byteLength(data) > 16 * 1024) stop('output_limit'); else stderr += data; });
    child.once('error', () => { failure = 'unavailable'; finish(null); });
    child.once('close', finish);
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

async function discoverExecutable(configured: string | undefined, env: NodeJS.ProcessEnv): Promise<string | undefined> {
  const candidates = configured ? [configured] : [join(homedir(), '.local', 'bin', 'claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude', ...(env.PATH ?? '').split(delimiter).filter(isAbsolute).map(dir => join(dir, 'claude'))];
  for (const candidate of candidates) {
    if (!isAbsolute(candidate)) continue;
    try {
      const executable = await realpath(candidate);
      if (!(await lstat(executable)).isFile()) continue;
      await access(executable, constants.X_OK);
      return executable;
    } catch { /* A missing candidate has no authority to select a different account. */ }
  }
  return undefined;
}

function cleanLabel(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= 254 && !/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/.test(value) ? value : undefined;
}

export function claudeAccountDisclosure(status: Record<string, unknown>): ClaudeDisclosure | undefined {
  const account = cleanLabel(status.email);
  if (!status.loggedIn || status.apiProvider !== 'firstParty' || status.authMethod !== 'claude.ai' || !account
      || !['pro', 'max'].includes(String(status.subscriptionType))) return undefined;
  return { provider: 'Anthropic', recipient: 'api.anthropic.com', account, organization: cleanLabel(status.orgName), authMethod: 'claude.ai', funding: `Claude ${status.subscriptionType === 'max' ? 'Max' : 'Pro'} · 개인 계정`, billingNotice };
}

/** Error text is used only for coarse classification; it is never returned or logged. */
export function classifyClaudeFailure(value: string): ContinuationResult {
  if (/rate.?limit|quota|usage.?limit|limit reached|out of (?:extra )?usage|credit balance|insufficient.{0,12}(?:credit|fund)|too many requests|\b429\b/i.test(value)) return { status: 'quota', code: 'provider_limit' };
  if (/authentication_error|unauthorized|invalid.?api.?key|not logged in|login required|\b401\b|token.{0,20}expired/i.test(value)) return { status: 'auth', code: 'provider_auth' };
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|network.?error|fetch failed|connection.?error|offline/i.test(value)) return { status: 'offline', code: 'provider_unreachable' };
  return { status: 'error', code: 'provider_error' };
}

export function claudeRequestArguments(snapshot: Readonly<ContinuationSnapshot>): string[] {
  return ['--safe-mode', '--restricted', '--print', '--output-format', 'json', '--no-session-persistence', '--max-turns', '1', '--model', snapshot.model, '--tools', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--disallowedTools', 'mcp__*', '--permission-mode', 'dontAsk', '--permission-prompts', 'none', '--disable-slash-commands', '--no-chrome', '--settings', '{"disableAllHooks":true,"disableClaudeAiConnectors":true,"fallbackModel":[],"switchModelsOnFlag":false}', '--system-prompt', snapshot.systemPrompt];
}

async function policyBlocker(cwd: string, env: NodeJS.ProcessEnv, signal: AbortSignal): Promise<string | undefined> {
  // No contents are read, even if an administrator stored secrets inside a policy file.
  // Policy helpers, merged fragments and managed MCP all require a separate supported inspection.
  const base = process.platform === 'darwin' ? '/Library/Application Support/ClaudeCode' : '/etc/claude-code';
  for (const name of ['managed-settings.json', 'managed-settings.d', 'managed-mcp.json']) {
    try { await lstat(join(base, name)); return 'managed_policy_present'; }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return 'managed_policy_unreadable'; }
  }
  if (process.platform === 'darwin') {
    // The documented managed-preferences domain includes MDM-delivered settings.
    for (const file of [join('/Library/Managed Preferences', 'com.anthropic.claudecode.plist'), join('/Library/Managed Preferences', userInfo().username, 'com.anthropic.claudecode.plist')]) {
      try { await lstat(file); return 'managed_policy_present'; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') return 'managed_policy_unreadable'; }
    }
    const mdm = await run('/usr/bin/defaults', ['read', 'com.anthropic.claudecode'], cwd, env, signal);
    if (mdm.failure || mdm.code !== 1 || !/Domain com\.anthropic\.claudecode does not exist/.test(mdm.stderr)) return 'managed_preferences_unknown';
  } else if (process.platform !== 'linux' || /microsoft/i.test((await import('node:os')).release())) return 'platform_policy_unsupported';
  return undefined;
}

/** No login, purchase, credential-file read, automatic retry or provider fallback. */
export function createClaudeCliTransport(options: { executable?: string; env?: NodeJS.ProcessEnv } = {}): ContinuationTransport {
  let prepared: { executable: string; environment: string; version: string } | undefined;
  const environment = () => personalClaudeEnvironment(options.env ?? process.env);
  const blocked = (code: string, version?: string): ContinuationInspection => ({ status: 'blocked', code, version, manualCommand: 'claude' });
  const inEmptyDirectory = async <T>(work: (cwd: string) => Promise<T>): Promise<T> => {
    const cwd = await mkdtemp(join(tmpdir(), 'studio-personal-claude-'));
    try { return await work(cwd); } finally { await rm(cwd, { recursive: true, force: true }); }
  };
  return {
    async inspect(signal) {
      prepared = undefined;
      const env = environment();
      const executable = await discoverExecutable(options.executable, env);
      if (!executable) return blocked('cli_unavailable');
      return inEmptyDirectory(async cwd => {
        const policy = await policyBlocker(cwd, env, signal);
        if (policy) return blocked(policy);
        const help = await run(executable, ['--help'], cwd, env, signal);
        if (help.failure || help.code !== 0 || flags.some(flag => !help.stdout.includes(flag))) return blocked('cli_isolation_unsupported');
        const versionResult = await run(executable, ['--version'], cwd, env, signal);
        const match = /^(2)\.(1)\.(\d+) \(Claude Code\)\s*$/.exec(versionResult.stdout.trim());
        if (versionResult.failure || versionResult.code !== 0 || !match || Number(match[3]) < MIN_VERSION) return blocked('cli_version_unsupported');
        const version = `2.1.${match[3]}`;
        // Restricted mode omits user/project settings; official shell auth/provider vars survive.
        const auth = await run(executable, ['--safe-mode', '--restricted', 'auth', 'status'], cwd, env, signal);
        if (auth.failure) return blocked('auth_status_unavailable', version);
        let status: Record<string, unknown>;
        try { status = JSON.parse(auth.stdout); } catch { return blocked('auth_status_unavailable', version); }
        if (auth.code !== 0 || !status?.loggedIn) return blocked('login_required', version);
        // Print mode always uses a configured API key; cached subscription identity must
        // never be presented as the payer for a separate shell credential or provider.
        if (['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_PROFILE', 'ANTHROPIC_IDENTITY_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY', 'CLAUDE_CODE_USE_ANTHROPIC_AWS'].some(name => !!env[name])) return blocked('account_or_funding_unsupported', version);
        const disclosure = claudeAccountDisclosure(status);
        if (!disclosure) return blocked('account_or_funding_unsupported', version);
        if (env.ANTHROPIC_BASE_URL && env.ANTHROPIC_BASE_URL.replace(/\/$/, '') !== 'https://api.anthropic.com') return blocked('recipient_unsupported', version);
        const doctor = await run(executable, ['--safe-mode', '--restricted', 'doctor'], cwd, env, signal);
        // Positive provider diagnostics are required. A missing policy line is unknown.
        if (doctor.failure || doctor.code !== 0 || !/Managed settings \(remote\): not fetched [^\n]*requires an Enterprise or Team subscription/.test(doctor.stdout)
            || !/Organization policy: not applicable to Pro and Max accounts/.test(doctor.stdout)) return blocked('remote_policy_unverified', version);
        prepared = { executable, environment: fingerprint(env), version };
        return { status: 'ready', code: 'personal_subscription_ready', version, disclosure, manualCommand: 'claude' };
      });
    },
    async request(snapshot, signal) {
      const attested = prepared;
      prepared = undefined;
      const env = environment();
      if (!attested || attested.environment !== fingerprint(env)) return { status: 'blocked', code: 'inspection_required' };
      return inEmptyDirectory(async cwd => {
        const policy = await policyBlocker(cwd, env, signal);
        if (policy) return { status: 'blocked', code: policy };
        const result = await run(attested.executable, claudeRequestArguments(snapshot), cwd, env, signal, snapshot.userPrompt, 90_000);
        if (result.failure) return { status: result.failure === 'cancelled' ? 'cancelled' : 'error', code: result.failure };
        let parsed: Record<string, unknown>;
        try { parsed = JSON.parse(result.stdout); } catch { return classifyClaudeFailure(result.stderr); }
        if (result.code !== 0 || parsed.is_error || parsed.subtype !== 'success') return classifyClaudeFailure(JSON.stringify(parsed) + result.stderr);
        if (typeof parsed.result !== 'string' || !parsed.result.trim()) return { status: 'error', code: 'empty_reply' };
        if (Buffer.byteLength(parsed.result) > CONTINUATION_LIMITS.replyBytes) return { status: 'error', code: 'reply_limit' };
        return { status: 'success', code: 'completed', text: parsed.result };
      });
    },
  };
}
