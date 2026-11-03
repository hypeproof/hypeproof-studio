// "프로젝트 변경": move this window's class work to another of the participant's GitHub
// repositories. The current folder's work is left on its own repository first (the caller asks),
// then the chosen repository is brought to its own folder on this computer: cloned when this
// computer has no folder for it, updated from GitHub (a pull) when the folder is behind.
//
// User requirement (2026-10-15): saying "프로젝트 변경" in the chat lists the participant's
// repositories; picking one commits what was done so far, then switches to the picked repository,
// pulling it into its existing folder or cloning it when there is none.
//
// Pure apart from the injected API and the file system, like githubContinue.ts, so a smoke test
// can drive it against the scripted GitHub.

import * as fs from "node:fs";
import * as path from "node:path";
import { ghMessage, type GitHubApi } from "./githubApi.ts";
import { downloadRepo, findClassRepos, type ClassRepo, type DownloadFailure } from "./githubContinue.ts";
import { gitBlobSha } from "./pagesPublisher.ts";
import { GENERATED_PATHS, isExcludedName, preflightSite } from "./sitePreflight.ts";

/** A repository the participant can switch to. `classSite` is false for their other repositories. */
export interface SwitchTarget extends ClassRepo {
  classSite: boolean;
}

interface RepoListJson {
  name?: string;
  owner?: { login?: string };
  fork?: boolean;
  archived?: boolean;
  pushed_at?: string | null;
  html_url?: string;
  default_branch?: string;
}

/**
 * Whether a chat message asks for the project switch. Kept to the phrase and its close variants,
 * so an ordinary sentence that merely mentions a project still goes to the coach.
 */
export function isProjectSwitchRequest(text: string): boolean {
  const t = text.trim().replace(/[.!?~\s]+$/u, "");
  return /^(프로젝트|프로잭트|저장소)\s*(변경|바꾸기|바꿔|전환)(\s*(해|해\s*줘|해\s*주세요|할래|하기|줘|주세요))?$/u.test(t);
}

/**
 * The model-only note on the first coach turn after a switch (user requirement 2026-10-15: "if
 * there is an agent.md, read it first"). The conversation is the opened folder's own (chat history
 * lives in workspaceState), so a cloned project starts empty and a revisited one resumes its own.
 */
export function projectSwitchBrief(repo: string, hasAgentMd: boolean): string {
  const lines = [
    `[프로젝트 변경] 참가자가 방금 프로젝트를 ${repo}(으)로 바꿔 이 폴더를 열었다.`,
    hasAgentMd
      ? "이 폴더의 agent.md 를 다른 어떤 일보다 먼저 읽어라. 읽은 뒤 이 프로젝트가 무엇인지 한두 줄로 확인해 주고, 그다음 참가자의 말에 답해라."
      : "이 폴더에는 agent.md 가 없다. 파일을 고치기 전에 index.html 부터 읽고 지금 상태를 한두 줄로 확인해 준 뒤 참가자의 말에 답해라.",
  ];
  return lines.join("\n");
}

/**
 * The participant's class sites (most recently published first), then their other repositories.
 * Forks and archived repositories are left out: neither is a place this class publishes to.
 */
export async function listSwitchTargets(api: GitHubApi, login: string): Promise<{ ok: true; targets: SwitchTarget[] } | { ok: false; detail: string }> {
  const classes = await findClassRepos(api, login);
  if (!classes.ok) return classes;
  const r = await api.request("GET", "/user/repos?affiliation=owner&sort=pushed&direction=desc&per_page=100");
  if (r.status !== 200 || !Array.isArray(r.json)) return { ok: false, detail: `list repos ${r.status} ${ghMessage(r)}` };
  const known = new Set(classes.repos.map((c) => c.name.toLowerCase()));
  const others: SwitchTarget[] = [];
  for (const j of r.json as RepoListJson[]) {
    if (!j.name || j.fork || j.archived || (j.owner?.login ?? "").toLowerCase() !== login.toLowerCase()) continue;
    if (known.has(j.name.toLowerCase())) continue;
    others.push({
      name: j.name,
      pushedAt: j.pushed_at ?? "",
      htmlUrl: j.html_url ?? `https://github.com/${login}/${j.name}`,
      defaultBranch: j.default_branch || "main",
      classSite: false,
    });
  }
  return { ok: true, targets: [...classes.repos.map((c) => ({ ...c, classSite: true })), ...others] };
}

/** The same exclusion downloadRepo applies: generated files and what a publish never uploads. */
function skipped(parts: string[]): boolean {
  if (GENERATED_PATHS.has(parts.join("/"))) return true;
  return parts.some((p, i) => isExcludedName(p, i < parts.length - 1));
}

/** Path → git blob id of the site files at `sha`, or null when GitHub cannot list them in one go. */
async function remoteFiles(api: GitHubApi, login: string, repo: string, sha: string): Promise<Map<string, string> | null> {
  const base = `/repos/${login}/${repo}`;
  const commit = await api.request("GET", `${base}/git/commits/${sha}`);
  const treeSha = commit.status === 200 ? (commit.json as { tree?: { sha?: string } } | null)?.tree?.sha : undefined;
  if (!treeSha) return null;
  const tree = await api.request("GET", `${base}/git/trees/${treeSha}?recursive=1`);
  const listing = tree.json as { truncated?: boolean; tree?: Array<{ path?: string; type?: string; sha?: string }> } | null;
  if (tree.status !== 200 || !listing || listing.truncated) return null;
  const out = new Map<string, string>();
  for (const e of listing.tree ?? []) {
    if (e.type !== "blob" || !e.sha || typeof e.path !== "string") continue;
    if (skipped(e.path.split("/"))) continue;
    out.set(e.path, e.sha);
  }
  return out;
}

/** Path → git blob id of the files a publish would upload from `folder`. */
export function localFiles(folder: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const f of preflightSite(folder).files) {
    if (skipped(f.path.split("/"))) continue;
    try {
      out.set(f.path, gitBlobSha(fs.readFileSync(f.abs)));
    } catch {
      /* deleted while we read: it cannot be published either */
    }
  }
  return out;
}

function sameFiles(a: Map<string, string>, b: Map<string, string>): boolean {
  if (a.size !== b.size) return false;
  for (const [p, sha] of a) if (b.get(p) !== sha) return false;
  return true;
}

/**
 * Does `folder` hold exactly the site files of `<login>/<repo>` at `sha`? Null when GitHub could
 * not answer (the caller then treats the folder as changed: asking once too often is harmless).
 */
export async function folderMatches(api: GitHubApi, login: string, repo: string, sha: string, folder: string): Promise<boolean | null> {
  const remote = await remoteFiles(api, login, repo, sha);
  if (!remote) return null;
  return sameFiles(localFiles(folder), remote);
}

/** What happens to the chosen repository on this computer. */
export type TargetAction = "clone" | "open" | "pull";

/**
 * - no folder of its own here → clone it into a new folder;
 * - GitHub empty, or the folder already equals GitHub → open the folder as it is;
 * - GitHub unchanged since this computer last pushed or pulled it → open it as it is: what differs
 *   is newer work made here, which a pull would throw away;
 * - otherwise GitHub moved (edited on github.com, or published from another computer) → pull.
 */
export function decideTarget(args: { hasFolder: boolean; head: string | null; lastPushedSha?: string; matchesHead: boolean | null }): TargetAction {
  if (!args.hasFolder) return "clone";
  if (!args.head || args.matchesHead === true) return "open";
  if (args.lastPushedSha && args.head === args.lastPushedSha) return "open";
  return "pull";
}

/**
 * Bring `folder` up to the head of `branch`: the site files become exactly GitHub's, and what a
 * publish never touches (dot entries such as the coach's notes, node_modules) stays. The files
 * are downloaded and checked first, so a failed download changes nothing. With `keepBackup` the
 * folder is copied beside itself before anything is replaced (`<folder>.before-pull-<stamp>`).
 */
export async function pullInto(
  api: GitHubApi,
  login: string,
  repo: string,
  branch: string,
  folder: string,
  opts: { keepBackup: boolean; stamp: string },
): Promise<{ ok: true; head: string; files: number; backup?: string } | DownloadFailure> {
  const tmp = `${folder}.pull-${opts.stamp}`;
  const d = await downloadRepo(api, login, repo, branch, tmp);
  if (!d.ok) return d;
  try {
    let backup: string | undefined;
    if (opts.keepBackup) {
      backup = `${folder}.before-pull-${opts.stamp}`;
      copyTree(folder, backup);
    }
    const incoming = new Set<string>();
    const walk = (dir: string, rel: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) walk(path.join(dir, e.name), r);
        else incoming.add(r);
      }
    };
    walk(tmp, "");
    // Site files GitHub no longer has go; the rest is overwritten with GitHub's bytes.
    for (const rel of localFiles(folder).keys()) {
      if (!incoming.has(rel)) fs.rmSync(path.join(folder, ...rel.split("/")), { force: true });
    }
    for (const rel of incoming) {
      const to = path.join(folder, ...rel.split("/"));
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(path.join(tmp, ...rel.split("/")), to);
    }
    return { ok: true, head: d.head, files: d.files, ...(backup ? { backup } : {}) };
  } catch (err) {
    return { ok: false, code: "unexpected", detail: err instanceof Error ? err.message : String(err) };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * Copy `from` into `to`, which must not exist (nor any file under it). Not `fs.cpSync`: on
 * Windows it crashes the whole process when the path has non-ASCII characters — measured
 * 2026-10-17 in Studio's own runtime (Electron 39.8.7, Node 22.22.1) under `C:\Users\홍길동`, i.e.
 * every Korean user name. Links are not followed (they are not copied).
 */
export function copyTree(from: string, to: string): void {
  fs.mkdirSync(to);
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, e.name);
    const b = path.join(to, e.name);
    if (e.isDirectory()) copyTree(a, b);
    else if (e.isFile()) fs.copyFileSync(a, b, fs.constants.COPYFILE_EXCL);
  }
}

/** The folder a repository is cloned into: `<class folder>-<repo>`, then `-2`, `-3`, … */
export function cloneFolderFor(classRoot: string, repo: string, exists: (p: string) => boolean = fs.existsSync): string {
  const base = `${classRoot}-${repo}`;
  if (!exists(base)) return base;
  for (let n = 2; n < 100; n++) if (!exists(`${base}-${n}`)) return `${base}-${n}`;
  throw new Error(`no free folder next to ${base}`);
}
