import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createWriteStream } from "node:fs";
import { rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import {verificationContext,verificationManifest,verificationAssetUrl,type VerificationOptions} from "./updateVerification.ts";

import {fetchConfiguredCustomerRelease,authorizeCustomerReleaseAsset} from "./customerReleaseResolver.ts";

const RELEASE_REPO = "hypeproof/hypeproof-studio-releases";
export const RELEASES_API = `https://api.github.com/repos/${RELEASE_REPO}/releases/latest`;
const ASSET_PATH = `/repos/${RELEASE_REPO}/releases/assets/`;

export function trustedUpdateUrl(value: string, options: VerificationOptions = {}): boolean {
  const context=verificationContext(options);
  if(context){try{const url=new URL(value);return url.origin===context.origin&&/^\/asset\/[a-z0-9-]+$/.test(url.pathname)&&!url.search&&!url.hash&&!url.username&&!url.password;}catch{return false;}}
  try {
    const url = new URL(value);
    return url.origin === "https://api.github.com" && !url.username && !url.password &&
      url.pathname.startsWith(ASSET_PATH) && /^\d+$/.test(url.pathname.slice(ASSET_PATH.length)) &&
      !url.search && !url.hash;
  } catch { return false; }
}

/** Use the member's existing GitHub login; never bundle a shared release token. */
export async function releaseToken(): Promise<string> {
  const configured = process.env.HPS_RELEASE_TOKEN || process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (configured?.trim()) return configured.trim();
  try {
    const { stdout } = await promisify(execFile)("gh", ["auth", "token", "--hostname", "github.com"], {
      timeout: 5_000, maxBuffer: 8192, windowsHide: true,
    });
    if (stdout.trim()) return stdout.trim();
  } catch { /* Do not surface command output: it can contain credentials. */ }
  throw new Error("비공개 릴리스 접근 권한이 필요합니다. GitHub CLI에서 gh auth login을 실행하거나 HPS_RELEASE_TOKEN을 설정한 뒤 Studio를 다시 시작해 주세요.");
}

async function fetchAsset(url: string, signal: AbortSignal, options: VerificationOptions, customerPublic = false): Promise<Response> {
  if(verificationContext(options))return fetch(url,{redirect:"error",credentials:"omit",signal});
  const response = await fetch(url, {
    headers: { ...(customerPublic?{}:{authorization: `Bearer ${await releaseToken()}`}), accept: "application/octet-stream" },
    credentials: customerPublic?"omit":"same-origin",
    redirect: "manual", signal,
  });
  if (![301, 302, 303, 307, 308].includes(response.status)) return response;
  const location = response.headers.get("location");
  let target: URL;
  try { target = new URL(location ?? ""); } catch { throw new Error("Invalid update redirect"); }
  if (target.protocol !== "https:" || target.username || target.password || target.port ||
      !["release-assets.githubusercontent.com", "objects.githubusercontent.com"].includes(target.hostname)) {
    throw new Error("Untrusted update redirect");
  }
  // Signed asset URLs authenticate themselves. Never forward the GitHub token.
  return fetch(target.href, { redirect: "error", signal });
}

export async function fetchLatestRelease(options: VerificationOptions = {}): Promise<unknown> {
  const verification=verificationContext(options);
  if(verification){const manifest=await verificationManifest(verification);return {tag_name:manifest.version,draft:false,prerelease:false,html_url:verification.origin+'/verification',body:'[로컬 검증 feed · 정식 배포 아님] 고정된 후보 파일로 실제 앱 updater를 검증합니다.',assets:manifest.assets.map(file=>({name:file.name,url:verificationAssetUrl(verification,file.id),browser_download_url:verificationAssetUrl(verification,file.id),size:file.size,digest:'sha256:'+file.sha256}))};}
  const customerRelease=await fetchConfiguredCustomerRelease();if(customerRelease)return customerRelease;
  const response = await fetch(RELEASES_API, {
    headers: { accept: "application/vnd.github+json", authorization: `Bearer ${await releaseToken()}` },
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Update check failed: HTTP ${response.status}`);
  return response.json();
}

/** A GitHub asset digest detects corruption; it is not a code-signing identity. */
export async function downloadVerifiedUpdate(
  asset: { downloadUrl: string; sizeBytes: number; digest?: string },
  destination: string,
  options: VerificationOptions & { idleTimeoutMs?: number; totalTimeoutMs?: number } = {},
): Promise<void> {
  const verification=verificationContext(options);
  const customerPublic=verification?false:authorizeCustomerReleaseAsset(asset);
  if (!customerPublic && !trustedUpdateUrl(asset.downloadUrl, options)) throw new Error("Untrusted update download URL");
  if (!Number.isSafeInteger(asset.sizeBytes) || asset.sizeBytes <= 0 || asset.sizeBytes > 2 * 1024 ** 3) {
    throw new Error("Invalid update size");
  }
  if (!/^sha256:[a-f0-9]{64}$/i.test(asset.digest ?? "")) throw new Error("Update SHA-256 digest is missing");

  if(verification){const manifest=await verificationManifest(verification);const file=manifest.assets.find(f=>verificationAssetUrl(verification,f.id)===asset.downloadUrl);if(!file||file.size!==asset.sizeBytes||'sha256:'+file.sha256!==asset.digest?.toLowerCase())throw new Error("Verification asset differs from pinned manifest");}
  const controller = new AbortController();
  const abort = () => controller.abort(new Error("Update download timed out"));
  const total = setTimeout(abort, options.totalTimeoutMs ?? 10 * 60_000);
  let idle = setTimeout(abort, options.idleTimeoutMs ?? 60_000);
  let created = false;
  try {
    const response = await fetchAsset(asset.downloadUrl, controller.signal, options, customerPublic);
    if (!response.ok || !response.body) throw new Error(`Update download failed: HTTP ${response.status}`);
    const hash = createHash("sha256");
    let bytes = 0;
    const meter = new Transform({
      transform(chunk, _encoding, callback) {
        clearTimeout(idle);
        idle = setTimeout(abort, options.idleTimeoutMs ?? 60_000);
        bytes += chunk.length;
        if (bytes > asset.sizeBytes) { callback(new Error("Update exceeds declared size")); return; }
        hash.update(chunk);
        callback(null, chunk);
      },
    });
    const output = createWriteStream(destination, { flags: "wx", mode: 0o600 });
    output.once("open", () => { created = true; });
    await pipeline(Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]), meter, output, { signal: controller.signal });
    if (bytes !== asset.sizeBytes) throw new Error("Incomplete update download");
    if (`sha256:${hash.digest("hex")}` !== asset.digest!.toLowerCase()) throw new Error("Update SHA-256 mismatch");
  } catch (error) {
    controller.abort();
    if (created) await rm(destination, { force: true });
    throw error;
  } finally {
    clearTimeout(total);
    clearTimeout(idle);
  }
}
