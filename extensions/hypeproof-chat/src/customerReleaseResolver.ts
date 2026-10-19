import type { GhRelease } from './updateCheckerHelpers';

const MIRROR = 'hypeproof/hypeproof-studio-releases';
const ORIGINS = new Set(['https://release.hypeproof-ai.xyz', 'https://api.hypeproof-ai.xyz']);
const MAX_AGE_MS = 5 * 60_000;
type Environment = Record<string, string | undefined>;
type Channel = 'canary' | 'stable';
interface Config { origin: string; channel: Channel; artifactId: string; }
interface CustomerAsset { downloadUrl: string; sizeBytes: number; digest?: string; }
export interface EngineGhRelease extends GhRelease { engineChannel: Channel; engineSequence: number; engineReleaseId: number; }
const verifiedPointers = new Map<string, {sequence: number; identity: string}>();
const verifiedAssets = new Map<string, {size: number; digest: string; origin: string; channel: Channel; observedAt: number}>();
function demand(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }

function configuration(env: Environment, platform: string, arch: string): Config | undefined {
  if (env.HPS_RELEASE_ENGINE_URL === undefined && env.HPS_RELEASE_ENGINE_CHANNEL === undefined && env.HPS_RELEASE_ENGINE_ARTIFACT === undefined) return undefined;
  const raw = env.HPS_RELEASE_ENGINE_URL;
  let url: URL;
  try { url = new URL(raw ?? ''); } catch { throw new Error('Invalid release engine URL'); }
  demand(ORIGINS.has(url.origin) && !url.username && !url.password && !url.port && url.pathname === '/' && !url.search && !url.hash, 'Untrusted release engine origin');
  const channel = env.HPS_RELEASE_ENGINE_CHANNEL;
  demand(channel === 'canary' || channel === 'stable', 'Explicit release engine channel required');
  const artifactId = env.HPS_RELEASE_ENGINE_ARTIFACT ?? (platform === 'darwin' && arch === 'arm64' ? 'mac' : platform === 'win32' && arch === 'x64' ? 'win-user' : undefined);
  demand(artifactId && (platform === 'darwin' && arch === 'arm64' ? artifactId === 'mac' : platform === 'win32' && arch === 'x64' ? ['win-user', 'win-system'].includes(artifactId) : false), 'Unsupported release engine artifact/platform');
  return {origin: url.origin, channel, artifactId};
}

/** Undefined means the existing release API remains selected. Invalid explicit
 * configuration fails closed and never silently returns the legacy feed. */
export async function fetchConfiguredCustomerRelease(
  env: Environment = process.env,
  {fetchImpl = fetch, platform = process.platform, arch = process.arch, clock = Date.now}: {fetchImpl?: typeof fetch; platform?: string; arch?: string; clock?: () => number} = {},
): Promise<EngineGhRelease | undefined> {
  const config = configuration(env, platform, arch);
  if (!config) return undefined;
  const response = await fetchImpl(`${config.origin}/api/release/customer/channels/${config.channel}/${config.artifactId}`, {
    method: 'GET', headers: {accept: 'application/json'}, credentials: 'omit', redirect: 'error', signal: AbortSignal.timeout(15_000),
  });
  demand(response.ok, `Customer release check failed: HTTP ${response.status}`);
  const receipt = await response.json() as Record<string, unknown>;
  demand(receipt.status === 'AVAILABLE' && receipt.channel === config.channel && receipt.repository === MIRROR && receipt.artifactId === config.artifactId, 'Customer release receipt identity mismatch');
  demand(Number.isSafeInteger(receipt.releaseId) && Number(receipt.releaseId) > 0 && Number.isSafeInteger(receipt.assetId) && Number(receipt.assetId) > 0 && Number.isSafeInteger(receipt.sequence) && Number(receipt.sequence) > 0, 'Immutable customer release IDs required');
  demand(typeof receipt.version === 'string' && /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(receipt.version), 'Invalid customer release version');
  demand(receipt.version.slice(1).split('.').every(part => Number.isSafeInteger(Number(part))), 'Invalid customer release version');
  demand(typeof receipt.manifestDigest === 'string' && /^[a-f0-9]{64}$/.test(receipt.manifestDigest) && typeof receipt.sha256 === 'string' && /^[a-f0-9]{64}$/.test(receipt.sha256), 'Customer release digest required');
  demand(Number.isSafeInteger(receipt.size) && Number(receipt.size) > 0 && Number(receipt.size) <= 2 * 1024 ** 3 && typeof receipt.name === 'string' && receipt.name.length > 0 && !/[\\/\x00-\x1f]/.test(receipt.name), 'Invalid customer release asset');
  const observedAt = typeof receipt.observedAt === 'string' ? Date.parse(receipt.observedAt) : NaN;
  demand(Number.isFinite(observedAt) && observedAt <= clock() + 60_000 && clock() - observedAt <= MAX_AGE_MS, 'Stale customer release receipt');
  let download: URL;
  try { download = new URL(String(receipt.url)); } catch { throw new Error('Invalid customer download URL'); }
  const segments = download.pathname.split('/');
  demand(download.origin === 'https://github.com' && !download.username && !download.password && !download.port && !download.search && !download.hash && segments.length === 7 && segments.slice(1,5).join('/') === `${MIRROR}/releases/download`, 'Untrusted customer download URL');
  const tag = decodeURIComponent(segments[5] ?? ''), name = decodeURIComponent(segments[6] ?? '');
  demand(name === receipt.name && (config.channel === 'stable' ? tag === receipt.version : tag.startsWith(`${receipt.version}-rc.`) && /^[1-9]\d*$/.test(tag.slice(`${receipt.version}-rc.`.length))), 'Customer download version or asset mismatch');
  demand(config.artifactId === 'mac' ? name.endsWith('darwin-arm64.zip') : config.artifactId === 'win-user' ? /UserSetup.*x64.*\.exe$/i.test(name) : /Setup.*x64.*\.exe$/i.test(name) && !/UserSetup/i.test(name), 'Customer download platform mismatch');
  const apiUrl = `https://api.github.com/repos/${MIRROR}/releases/assets/${receipt.assetId}`;
  const assetDigest = `sha256:${receipt.sha256}`;
  const pointerKey = `${config.origin}/${config.channel}/${config.artifactId}`;
  const identity = JSON.stringify([receipt.releaseId, receipt.assetId, receipt.manifestDigest, receipt.sha256, receipt.size, receipt.version, tag, name]);
  const previous = verifiedPointers.get(pointerKey);
  demand(!previous || Number(receipt.sequence) > previous.sequence || Number(receipt.sequence) === previous.sequence && identity === previous.identity, 'Customer release sequence rollback or conflicting receipt');
  verifiedPointers.set(pointerKey, {sequence: Number(receipt.sequence), identity});
  verifiedAssets.set(apiUrl, {size: Number(receipt.size), digest: assetDigest, origin: config.origin, channel: config.channel, observedAt});
  return {
    tag_name: tag, html_url: `https://github.com/${MIRROR}/releases/tag/${encodeURIComponent(tag)}`,
    draft: false, prerelease: config.channel === 'canary', engineChannel: config.channel,
    engineSequence: Number(receipt.sequence), engineReleaseId: Number(receipt.releaseId),
    assets: [{name, size: Number(receipt.size), digest: assetDigest, browser_download_url: download.href, url: apiUrl}],
  };
}

/** The production transport may omit GitHub authentication only for the exact
 * current receipt's numeric asset, digest and size. Merely enabling the engine
 * or passing an arbitrary GitHub URL is insufficient. */
export function authorizeCustomerReleaseAsset(asset: CustomerAsset, env: Environment = process.env, {platform = process.platform, arch = process.arch, clock = Date.now}: {platform?: string; arch?: string; clock?: () => number} = {}): boolean {
  const config = configuration(env, platform, arch);
  if (!config) return false;
  const verified = verifiedAssets.get(asset.downloadUrl);
  demand(verified && verified.origin === config.origin && verified.channel === config.channel && verified.size === asset.sizeBytes && verified.digest === asset.digest?.toLowerCase() && verified.observedAt <= clock() + 60_000 && clock() - verified.observedAt <= MAX_AGE_MS, 'Customer download does not match the verified channel receipt');
  return true;
}
