// Bring `<login>/<repo>` onto this computer with the participant's gh login, for
// "GitHub에서 이어하기" (start page) and "프로젝트 변경". The repository's folder is the one the
// registry already bound to it, else `<class folder>-<repo>` beside the class folder
// (projectSwitch.ts cloneFolderFor). Absent → `gh repo clone`. Present → fetch, then follow
// decideTarget: "open" keeps the files, "pull" makes them GitHub's (backup first when they hold
// work that was never published).
//
// Not a plain `git pull`: the publish pipeline commits through the API, never through this
// clone, so the clone's HEAD trails GitHub and its working tree carries the published files as
// local edits. `git pull` refuses such a tree. Moving the branch to the fetched commit, keeping
// or replacing the files as decideTarget says, is what the pull means here.
//
// No shell: every git/gh call is an argument vector (see githubAuth.ts).

import * as fs from "node:fs";
import * as path from "node:path";
import { cloneFolderFor, copyTree } from "./projectSwitch.ts";

export interface ExecResult {
  ok: boolean;
  /** The executable itself was not found. */
  missing: boolean;
  stdout: string;
  stderr: string;
}
export type Exec = (file: string, args: readonly string[], opts: { timeout: number }) => Promise<ExecResult>;

export type CheckoutFailure = { ok: false; code: "git_missing" | "clone" | "fetch" | "unexpected"; detail: string };

const GIT_TIMEOUT_MS = 180_000;
const fail = (code: CheckoutFailure["code"], detail: string): CheckoutFailure => ({ ok: false, code, detail: detail.trim().slice(-500) });
/**
 * gh runs git for a clone; without git it reports that rather than failing to start. On macOS
 * `/usr/bin/git` exists even without git: a stub that needs the Command Line Tools and says so
 * through xcrun.
 */
const gitMissing = (r: ExecResult) =>
  r.missing || /executable file not found|git: not found|unable to find git|xcrun: error|invalid active developer path/i.test(r.stderr);

export function repoUrl(login: string, repo: string): string {
  return `https://github.com/${login}/${repo}.git`;
}

/** Does a remote URL name `<login>/<repo>` on github.com (https or ssh, with or without .git)? */
export function sameRepoUrl(url: string, login: string, repo: string): boolean {
  const m = /github\.com[/:]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i.exec(url.trim());
  return !!m && m[1]!.toLowerCase() === login.toLowerCase() && m[2]!.toLowerCase() === repo.toLowerCase();
}

/**
 * The credential helper `gh auth setup-git` would install, for this one command: the
 * participant's git config is not changed, and an older stored credential cannot answer first.
 */
function authArgs(gh: string): string[] {
  return ["-c", "credential.helper=", "-c", `credential.helper=!"${gh.replace(/\\/g, "/")}" auth git-credential`];
}

/**
 * Where `<login>/<repo>` lives here. A candidate counts when it is a clone of that repository, or
 * a plain folder (a copy brought down before clones existed). A folder of the same name holding
 * another repository is left alone and the next free name is used.
 */
export async function locateRepoFolder(args: {
  exec: Exec;
  login: string;
  repo: string;
  classRoot: string;
  registered?: string;
  exists?: (p: string) => boolean;
}): Promise<{ folder: string; present: boolean }> {
  const exists = args.exists ?? fs.existsSync;
  const candidates = [args.registered, `${args.classRoot}-${args.repo}`].filter((c): c is string => !!c);
  for (const folder of candidates) {
    if (!exists(folder)) continue;
    if (!exists(path.join(folder, ".git"))) return { folder, present: true };
    const origin = await args.exec("git", ["-C", folder, "remote", "get-url", "origin"], { timeout: 15_000 });
    if (origin.ok && sameRepoUrl(origin.stdout, args.login, args.repo)) return { folder, present: true };
  }
  return { folder: cloneFolderFor(args.classRoot, args.repo, exists), present: false };
}

/** `gh repo clone` into `folder`, which must not exist. Nothing is left behind on failure. */
export async function cloneRepo(args: { exec: Exec; gh: string; login: string; repo: string; branch: string; folder: string }): Promise<{ ok: true } | CheckoutFailure> {
  // core.autocrlf=false: the files must stay byte-equal to GitHub's, or every later comparison
  // (folderMatches) sees a change and the next publish rewrites each line ending.
  const r = await args.exec(
    args.gh,
    ["repo", "clone", `${args.login}/${args.repo}`, args.folder, "--", "--quiet", "--branch", args.branch, "--config", "core.autocrlf=false"],
    { timeout: GIT_TIMEOUT_MS },
  );
  if (r.ok) return { ok: true };
  fs.rmSync(args.folder, { recursive: true, force: true });
  return fail(gitMissing(r) ? "git_missing" : "clone", r.stderr);
}

/**
 * Bring an existing folder's branch to GitHub's head of `branch`. `replace` makes the files
 * GitHub's (with a copy at `backup` first, when given); otherwise the files stay as they are and
 * only the history moves. A folder that is not a clone yet becomes one in place.
 */
export async function syncClone(args: {
  exec: Exec;
  gh: string;
  login: string;
  repo: string;
  branch: string;
  folder: string;
  replace: boolean;
  backup?: string;
  /** Tests point this at a local repository. */
  remoteUrl?: string;
}): Promise<{ ok: true; backup?: string } | CheckoutFailure> {
  const git = (gitArgs: string[], auth = false) => args.exec("git", [...(auth ? authArgs(args.gh) : []), "-C", args.folder, ...gitArgs], { timeout: GIT_TIMEOUT_MS });
  if (!fs.existsSync(path.join(args.folder, ".git"))) {
    const init = await git(["init", "-q"]);
    if (!init.ok) return fail(gitMissing(init) ? "git_missing" : "unexpected", init.stderr);
    const add = await git(["remote", "add", "origin", args.remoteUrl ?? repoUrl(args.login, args.repo)]);
    if (!add.ok) return fail("unexpected", add.stderr);
  }
  const crlf = await git(["config", "core.autocrlf", "false"]);
  if (!crlf.ok) return fail(gitMissing(crlf) ? "git_missing" : "unexpected", crlf.stderr);
  const tracking = `refs/remotes/origin/${args.branch}`;
  const fetched = await git(["fetch", "-q", "origin", `+refs/heads/${args.branch}:${tracking}`], true);
  if (!fetched.ok) return fail(gitMissing(fetched) ? "git_missing" : "fetch", fetched.stderr);
  let backup: string | undefined;
  if (args.replace && args.backup) {
    copyTree(args.folder, args.backup);
    backup = args.backup;
  }
  // Name the branch (a fresh `git init` may call it master), move it, and track GitHub's.
  const steps = [
    ["symbolic-ref", "HEAD", `refs/heads/${args.branch}`],
    ["reset", "-q", args.replace ? "--hard" : "--mixed", tracking],
    ["branch", "-q", `--set-upstream-to=origin/${args.branch}`],
  ];
  for (const step of steps) {
    const r = await git(step);
    if (!r.ok) return fail("unexpected", r.stderr);
  }
  return { ok: true, ...(backup ? { backup } : {}) };
}
