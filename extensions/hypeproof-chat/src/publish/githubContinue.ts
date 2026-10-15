// "GitHub에서 이어하기": find the participant's class sites on GitHub and bring one down into a
// fresh class folder on this computer.
//
// User requirement (2026-10-13): when a participant enters with a token, look at GitHub first.
// If they already published a site, offer "GitHub에서 이어하기" (a choice when there are
// several) next to "새로 하기", which starts a new folder that publishes to a NEW repository.
// Participants do not edit on github.com, so a repository holds exactly what was last published
// from some computer, and bringing it down is the whole of "continuing elsewhere".
//
// Pure apart from the injected API and the file system, so the smoke tests drive it against the
// scripted GitHub (test/fixtures/mock-github.mjs).

import * as fs from "node:fs";
import * as path from "node:path";
import { ghMessage, type GitHubApi } from "./githubApi.ts";
import { REPO_NAME_MAX } from "./publishContract.ts";
import { gitBlobSha, REPO_DESCRIPTION } from "./pagesPublisher.ts";
import { GENERATED_PATHS, isExcludedName, MAX_FILE_BYTES, MAX_FILES, MAX_SITE_BYTES } from "./sitePreflight.ts";

export interface ClassRepo {
  name: string;
  /** GitHub's `pushed_at` (ISO 8601): when this site was last published. */
  pushedAt: string;
  htmlUrl: string;
  defaultBranch: string;
}

/** Repositories without the button's description that are opened to look for `agent.md`. */
const MAX_PROBES = 10;

interface RepoListJson {
  name?: string;
  owner?: { login?: string };
  description?: string | null;
  fork?: boolean;
  archived?: boolean;
  has_pages?: boolean;
  pushed_at?: string | null;
  html_url?: string;
  default_branch?: string;
}

/**
 * The participant's class sites, most recently published first. A class site is a repository
 * the participant owns that either carries the description the button gives every repository
 * it creates (REPO_DESCRIPTION), or is a Pages site with an `agent.md` at its root: the coach's
 * shell path creates repositories without the description, and agent.md is part of every class.
 */
export async function findClassRepos(api: GitHubApi, login: string): Promise<{ ok: true; repos: ClassRepo[] } | { ok: false; detail: string }> {
  const r = await api.request("GET", "/user/repos?affiliation=owner&sort=pushed&direction=desc&per_page=100");
  if (r.status !== 200 || !Array.isArray(r.json)) return { ok: false, detail: `list repos ${r.status} ${ghMessage(r)}` };
  const own = (r.json as RepoListJson[]).filter(
    (j) => !!j.name && !j.fork && !j.archived && (j.owner?.login ?? "").toLowerCase() === login.toLowerCase(),
  );
  const repos: ClassRepo[] = [];
  let probes = 0;
  for (const j of own) {
    let isClass = j.description === REPO_DESCRIPTION;
    if (!isClass && j.has_pages && probes < MAX_PROBES) {
      probes++;
      isClass = (await api.request("GET", `/repos/${login}/${j.name}/contents/agent.md`)).status === 200;
    }
    if (!isClass) continue;
    repos.push({
      name: j.name!,
      pushedAt: j.pushed_at ?? "",
      htmlUrl: j.html_url ?? `https://github.com/${login}/${j.name}`,
      defaultBranch: j.default_branch || "main",
    });
  }
  repos.sort((a, b) => (a.pushedAt < b.pushedAt ? 1 : a.pushedAt > b.pushedAt ? -1 : 0));
  return { ok: true, repos };
}

/** The commit `branch` points at, or null (no such branch, or an empty repository). */
export async function remoteHead(api: GitHubApi, login: string, repo: string, branch: string): Promise<string | null> {
  const r = await api.request("GET", `/repos/${login}/${repo}/git/ref/heads/${branch}`);
  return r.status === 200 ? ((r.json as { object?: { sha?: string } } | null)?.object?.sha ?? null) : null;
}

export type DownloadFailure = {
  ok: false;
  code: "dest_exists" | "empty" | "too_large" | "unsafe_path" | "integrity" | "unexpected";
  detail: string;
};

/** What a publish would not upload stays on GitHub; the next publish regenerates its own files. */
function skipped(parts: string[]): boolean {
  if (GENERATED_PATHS.has(parts.join("/"))) return true;
  return parts.some((p, i) => isExcludedName(p, i < parts.length - 1));
}

function unsafe(p: string): boolean {
  if (!p || p.includes("\\") || p.includes("\0") || path.isAbsolute(p) || /^[a-zA-Z]:/.test(p)) return true;
  return p.split("/").some((s) => s === "" || s === "." || s === "..");
}

/**
 * Write the files of `<login>/<repo>` at the head of `branch` into `dest`.
 *
 * `dest` must not exist: this function creates it and, on any failure, removes it again, so a
 * half-written folder is never opened as a class folder and nothing a person made is touched.
 * Only what a publish uploads comes down (the preflight's rules: no dot entries, node_modules,
 * key files, or the files the pipeline generates). Every blob is checked against its git id.
 * Returns the commit the files came from: the next publish from `dest` builds on exactly it.
 */
export async function downloadRepo(
  api: GitHubApi,
  login: string,
  repo: string,
  branch: string,
  dest: string,
): Promise<{ ok: true; head: string; files: number } | DownloadFailure> {
  const fail = (code: DownloadFailure["code"], detail: string): DownloadFailure => ({ ok: false, code, detail });
  if (!/^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/.test(branch) || branch.includes("..")) return fail("unexpected", `branch ${branch}`);
  const base = `/repos/${login}/${repo}`;

  // Read the whole listing first: nothing is written for a repository we would refuse anyway.
  const ref = await api.request("GET", `${base}/git/ref/heads/${branch}`);
  if (ref.status === 409) return fail("empty", "the repository has no commits");
  const head = ref.status === 200 ? (ref.json as { object?: { sha?: string } } | null)?.object?.sha : undefined;
  if (!head) return fail("unexpected", `GET ref ${ref.status} ${ghMessage(ref)}`);
  const commit = await api.request("GET", `${base}/git/commits/${head}`);
  const treeSha = commit.status === 200 ? (commit.json as { tree?: { sha?: string } } | null)?.tree?.sha : undefined;
  if (!treeSha) return fail("unexpected", `GET commit ${commit.status} ${ghMessage(commit)}`);
  const tree = await api.request("GET", `${base}/git/trees/${treeSha}?recursive=1`);
  const listing = tree.json as { truncated?: boolean; tree?: Array<{ path?: string; mode?: string; type?: string; sha?: string; size?: number }> } | null;
  if (tree.status !== 200 || !listing) return fail("unexpected", `GET tree ${tree.status} ${ghMessage(tree)}`);
  if (listing.truncated) return fail("too_large", "the tree listing was truncated");

  const wanted: Array<{ parts: string[]; sha: string }> = [];
  let total = 0;
  for (const e of listing.tree ?? []) {
    if (e.type !== "blob" || !e.sha || typeof e.path !== "string") continue;
    if (e.mode === "120000") continue; // a symlink: a publish never makes one
    if (unsafe(e.path)) return fail("unsafe_path", e.path);
    const parts = e.path.split("/");
    if (skipped(parts)) continue;
    total += e.size ?? 0;
    wanted.push({ parts, sha: e.sha });
  }
  if (wanted.length > MAX_FILES) return fail("too_large", `${wanted.length} files`);
  if (total > MAX_SITE_BYTES) return fail("too_large", `${total} bytes`);

  try {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.mkdirSync(dest); // throws if it exists: the folder is ours from here on
  } catch (err) {
    return fail("dest_exists", err instanceof Error ? err.message : String(err));
  }
  try {
    for (const f of wanted) {
      const b = await api.request("GET", `${base}/git/blobs/${f.sha}`);
      const j = b.json as { content?: string; encoding?: string } | null;
      if (b.status !== 200 || typeof j?.content !== "string") throw Object.assign(new Error(`GET blob ${b.status} ${ghMessage(b)}`), { code: "unexpected" });
      const bytes = j.encoding === "base64" ? Buffer.from(j.content, "base64") : Buffer.from(j.content, "utf8");
      if (bytes.byteLength > MAX_FILE_BYTES) throw Object.assign(new Error(`${f.parts.join("/")} ${bytes.byteLength} bytes`), { code: "too_large" });
      if (gitBlobSha(bytes) !== f.sha) throw Object.assign(new Error(f.parts.join("/")), { code: "integrity" });
      const abs = path.join(dest, ...f.parts);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, bytes, { flag: "wx" });
    }
  } catch (err) {
    fs.rmSync(dest, { recursive: true, force: true });
    const code = (err as { code?: string }).code;
    const known = code === "too_large" || code === "integrity" || code === "unexpected";
    return fail(known ? (code as DownloadFailure["code"]) : "unexpected", err instanceof Error ? err.message : String(err));
  }
  return { ok: true, head, files: wanted.length };
}

/** `base`, then `base-2`, `base-3`, … — the first path that does not exist yet. */
export function nextFreeFolder(base: string, exists: (p: string) => boolean = fs.existsSync): string {
  if (!exists(base)) return base;
  for (let n = 2; n < 100; n++) {
    const candidate = `${base}-${n}`;
    if (!exists(candidate)) return candidate;
  }
  throw new Error(`no free folder next to ${base}`);
}

/**
 * `<base>`, then `<base>-2`, `<base>-3`, … — the first name with no repository on this account.
 * A folder that never published from this computer gets one of these, so it can never write
 * into a site made elsewhere ("새로 하기 → 올릴 때 새 저장소"). The base is shortened, never the
 * suffix, so every candidate stays within REPO_NAME_MAX.
 */
export async function firstFreeRepoName(api: GitHubApi, login: string, base: string): Promise<{ ok: true; name: string } | { ok: false; detail: string }> {
  for (let n = 1; n <= 20; n++) {
    const suffix = n === 1 ? "" : `-${n}`;
    const name = `${base.slice(0, REPO_NAME_MAX - suffix.length).replace(/-+$/, "")}${suffix}`;
    const r = await api.request("GET", `/repos/${login}/${name}`);
    if (r.status === 404) return { ok: true, name };
    if (r.status !== 200) return { ok: false, detail: `GET repo ${name} ${r.status} ${ghMessage(r)}` };
  }
  return { ok: false, detail: `${base}: 20 names in a row are taken` };
}
