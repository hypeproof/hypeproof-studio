// The GitHub side of the publish, one function per step. The orchestrator (publishSite.ts)
// decides order, time budgets and what the participant reads; these functions only talk to
// GitHub and report what happened.
//
// The Pages path is the one the Service skill `publish-homepage.md` proved in class (July
// 2026), not the one the REST docs make look simplest:
//   - `build_type: "workflow"`, never the legacy branch builder: on new repositories the
//     legacy builder ended in `startup_failure` and stayed "building" forever (2026-07-25,
//     twice, rebuild requests included).
//   - Pages is switched to `workflow` BEFORE the workflow file lands, and we wait until GET
//     /pages reads back `workflow`: the PUT's 2xx is only "accepted", provisioning is async,
//     and a workflow that runs first dies in configure-pages with `HttpError: Not Found`
//     (#500, three failures in a row on 2026-07-28).
//   - The workflow YAML is the skill's, byte for byte (PAGES_WORKFLOW_YAML).
//
// No `git` binary: on a Mac without developer tools `/usr/bin/git` is a stub that opens a 2 GB
// installer (github-repo.md "하지 말 것"). Everything goes through the Git Data API as ONE
// commit (blobs → tree → commit → ref): a half-uploaded site is never live, and one commit is
// one Pages deployment instead of one per file.

import { createHash } from "node:crypto";
import { ghMessage, type ApiResponse, type GitHubApi } from "./githubApi.ts";
import type { PublishErrorCode } from "./publishContract.ts";

/** publish-homepage.md, "Pages 켜기 — 반드시 Actions 방식으로". Do not reformat. */
export const PAGES_WORKFLOW_YAML = `name: pages
on:
  push:
    branches: [main]
  workflow_dispatch:
permissions:
  contents: read
  pages: write
  id-token: write
jobs:
  deploy:
    environment:
      name: github-pages
      url: \${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: .
      - id: deployment
        uses: actions/deploy-pages@v4
`;

export const WORKFLOW_PATH = ".github/workflows/pages.yml";
export const NONCE_PATH = "hps-build.txt";

export type StepFailure = { ok: false; code: PublishErrorCode; detail?: string };

export interface Clock {
  sleep: (ms: number) => Promise<void>;
  now: () => number;
}

/** Git's blob id: sha1("blob <len>\0" + bytes). Lets us skip uploading unchanged files. */
export function gitBlobSha(bytes: Uint8Array): string {
  return createHash("sha1").update(`blob ${bytes.byteLength}\0`).update(bytes).digest("hex");
}

const isOk = (r: ApiResponse) => r.status >= 200 && r.status < 300;

// ── repository ──────────────────────────────────────────────────────────────

export interface RepoInfo {
  owner: string;
  name: string;
  path: string; // "/repos/<owner>/<name>"
  htmlUrl: string;
  defaultBranch: string;
  created: boolean;
}

interface RepoJson {
  name?: string;
  full_name?: string;
  owner?: { login?: string };
  html_url?: string;
  default_branch?: string;
  archived?: boolean;
  permissions?: { admin?: boolean; push?: boolean };
}

function repoFrom(j: RepoJson, created: boolean): RepoInfo {
  const owner = j.owner?.login ?? "";
  const name = j.name ?? "";
  return {
    owner,
    name,
    path: `/repos/${owner}/${name}`,
    htmlUrl: j.html_url ?? `https://github.com/${owner}/${name}`,
    defaultBranch: j.default_branch || "main",
    created,
  };
}

/**
 * "Ours" means owned by the signed-in login AND writable. A rename or transfer makes
 * GET /repos/<login>/<name> follow a redirect to someone else's repository; publishing into
 * that would put the clinic's site in another account, so it is treated as a name clash.
 */
function ownedBy(j: RepoJson, login: string, name: string): boolean {
  return (
    (j.full_name ?? "").toLowerCase() === `${login}/${name}`.toLowerCase() &&
    (j.owner?.login ?? "").toLowerCase() === login.toLowerCase() &&
    j.permissions?.push !== false
  );
}

export async function lookupRepo(
  api: GitHubApi,
  login: string,
  name: string,
): Promise<{ ok: true; repo: RepoInfo | null } | StepFailure> {
  const r = await api.request("GET", `/repos/${login}/${name}`);
  if (r.status === 404) return { ok: true, repo: null };
  if (r.status !== 200) return { ok: false, code: "unexpected", detail: `GET repo ${r.status} ${ghMessage(r)}` };
  const j = r.json as RepoJson;
  if (!ownedBy(j, login, name)) return { ok: false, code: "repo_name_taken", detail: j.full_name };
  if (j.archived) return { ok: false, code: "repo_archived" };
  return { ok: true, repo: repoFrom(j, false) };
}

/**
 * The description every repository the button creates carries. "GitHub에서 이어하기"
 * (githubContinue.ts) recognizes a class site by it, so it is a contract, not decoration.
 */
export const REPO_DESCRIPTION = "HypeProof Studio에서 만든 홈페이지";

export async function ensureRepo(api: GitHubApi, login: string, name: string): Promise<{ ok: true; repo: RepoInfo } | StepFailure> {
  const found = await lookupRepo(api, login, name);
  if (!found.ok) return found;
  if (found.repo) return { ok: true, repo: found.repo };
  // auto_init: the Git Data API refuses an empty repository ("Git Repository is empty"), and an
  // initial README commit is the cheapest way to have a branch to build on. Public because the
  // free plan only serves Pages from public repositories (D2: the repo is public anyway).
  const c = await api.request("POST", "/user/repos", {
    name,
    description: REPO_DESCRIPTION,
    private: false,
    auto_init: true,
    has_wiki: false,
    has_projects: false,
  });
  if (c.status === 201) return { ok: true, repo: repoFrom(c.json as RepoJson, true) };
  if (c.status === 422) {
    // Either a race with our own earlier attempt (a retried POST) or a real clash. Re-read:
    // ours → reuse; anything else → the name is taken.
    const again = await lookupRepo(api, login, name);
    if (again.ok && again.repo) return { ok: true, repo: again.repo };
    return { ok: false, code: again.ok ? "repo_name_taken" : again.code, detail: ghMessage(c) };
  }
  if (c.status === 403 && /verif|email/i.test(ghMessage(c))) return { ok: false, code: "email_unverified", detail: ghMessage(c) };
  if (c.status === 403 || c.status === 404) return { ok: false, code: "missing_scope", detail: `create repo ${c.status} ${ghMessage(c)}` };
  return { ok: false, code: "unexpected", detail: `create repo ${c.status} ${ghMessage(c)}` };
}

// ── Pages ───────────────────────────────────────────────────────────────────

export interface PagesState {
  buildType: string | null;
  cname: string | null;
  httpsEnforced: boolean;
}

export async function readPages(api: GitHubApi, repoPath: string): Promise<{ ok: true; pages: PagesState | null } | StepFailure> {
  const r = await api.request("GET", `${repoPath}/pages`);
  if (r.status === 404) return { ok: true, pages: null };
  if (r.status !== 200) return { ok: false, code: "unexpected", detail: `GET pages ${r.status} ${ghMessage(r)}` };
  const j = r.json as { build_type?: string; cname?: string | null; https_enforced?: boolean };
  return { ok: true, pages: { buildType: j.build_type ?? null, cname: j.cname ?? null, httpsEnforced: j.https_enforced === true } };
}

/**
 * Pages on, `build_type: workflow`, and READ BACK as such before returning (see header).
 * Bounded: `tries × intervalMs` (the skill's 12 × 5 s). Never an `until` loop.
 */
export async function ensurePagesWorkflow(
  api: GitHubApi,
  repoPath: string,
  clock: Clock,
  poll: { tries: number; intervalMs: number },
): Promise<{ ok: true; pages: PagesState } | StepFailure> {
  const current = await readPages(api, repoPath);
  if (!current.ok) return current;
  if (!current.pages) {
    const c = await api.request("POST", `${repoPath}/pages`, { build_type: "workflow" });
    // 409: it exists after all (a retried POST) — fall through to the read-back.
    if (!isOk(c) && c.status !== 409) {
      return { ok: false, code: c.status === 403 ? "missing_scope" : "pages_unavailable", detail: `${c.status} ${ghMessage(c)}` };
    }
  } else if (current.pages.buildType !== "workflow") {
    const u = await api.request("PUT", `${repoPath}/pages`, { build_type: "workflow" });
    if (!isOk(u)) return { ok: false, code: u.status === 403 ? "missing_scope" : "pages_unavailable", detail: `${u.status} ${ghMessage(u)}` };
  }
  for (let i = 0; i < poll.tries; i++) {
    const p = await readPages(api, repoPath);
    if (p.ok && p.pages?.buildType === "workflow") return { ok: true, pages: p.pages };
    if (i < poll.tries - 1) await clock.sleep(poll.intervalMs);
  }
  return { ok: false, code: "pages_not_ready" };
}

// ── commit ──────────────────────────────────────────────────────────────────

export interface TreeFile {
  path: string;
  bytes: Uint8Array;
}

async function headSha(api: GitHubApi, repoPath: string, branch: string): Promise<string | null> {
  const r = await api.request("GET", `${repoPath}/git/ref/heads/${branch}`);
  if (r.status === 200) return ((r.json as { object?: { sha?: string } }).object?.sha ?? null) as string | null;
  return null;
}

/** Blob shas already in the head tree — reusable without re-upload. Empty set on any doubt. */
async function existingBlobs(api: GitHubApi, repoPath: string, parent: string): Promise<Set<string>> {
  const c = await api.request("GET", `${repoPath}/git/commits/${parent}`);
  const tree = (c.json as { tree?: { sha?: string } } | null)?.tree?.sha;
  if (c.status !== 200 || !tree) return new Set();
  const t = await api.request("GET", `${repoPath}/git/trees/${tree}?recursive=1`);
  const j = t.json as { truncated?: boolean; tree?: Array<{ type?: string; sha?: string }> } | null;
  if (t.status !== 200 || !j || j.truncated) return new Set();
  return new Set((j.tree ?? []).filter((e) => e.type === "blob" && e.sha).map((e) => e.sha!));
}

/** A write refused for lack of the `workflow` scope reads like this (REST docs and observed). */
function isWorkflowScopeRefusal(r: ApiResponse): boolean {
  return (r.status === 403 || r.status === 404 || r.status === 422) && /workflow/i.test(ghMessage(r));
}

/**
 * Replace the branch's content with exactly `files`, as one commit on top of the current head.
 *
 * Snapshot, not overlay (no `base_tree`): the published site must be what the workspace holds
 * now. An overlay keeps every file ever uploaded — a renamed page stays reachable under its old
 * name forever, and a deleted photo stays public. Nothing is lost: the previous commits remain
 * in the repository history.
 */
export async function commitSnapshot(
  api: GitHubApi,
  repoPath: string,
  branch: string,
  files: TreeFile[],
  message: string,
  clock: Clock,
  /**
   * The head we last pushed (D18 ⑤). When given, the remote head must equal it: a different
   * head means an edit outside Studio, and we stop BEFORE uploading anything rather than
   * replace it. Undefined (first publish, or no record) keeps today's behaviour.
   */
  expectedHead?: string,
): Promise<{ ok: true; sha: string; uploaded: number } | StepFailure> {
  let parent = await headSha(api, repoPath, branch);
  if (expectedHead && parent !== expectedHead) {
    return { ok: false, code: "remote_changed", detail: `remote ${parent ?? "(none)"} ≠ last pushed ${expectedHead}` };
  }
  if (!parent) {
    // An empty repository (made in the browser, or by an older shell flow without auto_init).
    // The Contents API can create the first commit where the Git Data API cannot.
    const seed = await api.request("PUT", `${repoPath}/contents/${NONCE_PATH}`, {
      message: "HypeProof Studio 저장소 준비",
      content: Buffer.from("init\n").toString("base64"),
      branch,
    });
    if (!isOk(seed)) return { ok: false, code: "commit_failed", detail: `seed ${seed.status} ${ghMessage(seed)}` };
    for (let i = 0; i < 5 && !parent; i++) {
      parent = await headSha(api, repoPath, branch);
      if (!parent) await clock.sleep(1000);
    }
    if (!parent) return { ok: false, code: "commit_failed", detail: "branch did not appear after seeding" };
  }

  for (let attempt = 1; attempt <= 2; attempt++) {
    const reuse = await existingBlobs(api, repoPath, parent);
    const entries: Array<{ path: string; mode: string; type: string; sha: string }> = [];
    let uploaded = 0;
    for (const f of files) {
      const sha = gitBlobSha(f.bytes);
      if (!reuse.has(sha)) {
        const b = await api.request("POST", `${repoPath}/git/blobs`, { content: Buffer.from(f.bytes).toString("base64"), encoding: "base64" });
        const got = (b.json as { sha?: string } | null)?.sha;
        if (b.status !== 201 || !got) return { ok: false, code: "commit_failed", detail: `blob ${f.path} ${b.status} ${ghMessage(b)}` };
        // GitHub computes the same id from the bytes it stored; a mismatch means the bytes
        // arrived changed, and a site built from them would not be the participant's site.
        if (got !== sha) return { ok: false, code: "commit_failed", detail: `blob ${f.path} sha mismatch` };
        reuse.add(sha);
        uploaded++;
      }
      entries.push({ path: f.path, mode: "100644", type: "blob", sha });
    }
    const t = await api.request("POST", `${repoPath}/git/trees`, { tree: entries });
    const tree = (t.json as { sha?: string } | null)?.sha;
    if (t.status !== 201 || !tree) return { ok: false, code: "commit_failed", detail: `tree ${t.status} ${ghMessage(t)}` };
    const c = await api.request("POST", `${repoPath}/git/commits`, { message, tree, parents: [parent] });
    const commit = (c.json as { sha?: string } | null)?.sha;
    if (c.status !== 201 || !commit) return { ok: false, code: "commit_failed", detail: `commit ${c.status} ${ghMessage(c)}` };
    // Fast-forward only: if someone pushed meanwhile (the participant editing on github.com),
    // we rebuild on the new head once instead of overwriting their commit.
    const u = await api.request("PATCH", `${repoPath}/git/refs/heads/${branch}`, { sha: commit, force: false });
    if (isOk(u)) return { ok: true, sha: commit, uploaded };
    if (isWorkflowScopeRefusal(u)) return { ok: false, code: "missing_scope", detail: ghMessage(u) };
    if (u.status === 422 && attempt === 1) {
      const moved = await headSha(api, repoPath, branch);
      // With an expected head, a head that moved under us is an outside edit: stop, never rebase over it.
      if (expectedHead && moved !== parent) return { ok: false, code: "remote_changed", detail: `head moved during push to ${moved}` };
      if (moved && moved !== parent) {
        parent = moved;
        continue;
      }
    }
    return { ok: false, code: "commit_failed", detail: `ref ${u.status} ${ghMessage(u)}` };
  }
  return { ok: false, code: "commit_failed" };
}

/** The repository's current head commit and the nonce it carries (check_only). */
export async function readPublishedNonce(
  api: GitHubApi,
  repoPath: string,
  branch: string,
): Promise<{ head: string | null; nonce: string | null }> {
  const head = await headSha(api, repoPath, branch);
  const r = await api.request("GET", `${repoPath}/contents/${NONCE_PATH}?ref=${encodeURIComponent(branch)}`);
  const content = (r.json as { content?: string } | null)?.content;
  const nonce = r.status === 200 && content ? Buffer.from(content, "base64").toString("utf8").trim() : null;
  return { head, nonce: nonce && /^[a-f0-9]{16,64}$/.test(nonce) ? nonce : null };
}

// ── Actions run ─────────────────────────────────────────────────────────────

interface RunJson {
  id?: number;
  status?: string;
  conclusion?: string | null;
  html_url?: string;
  path?: string;
  head_sha?: string;
}

async function runsFor(api: GitHubApi, repoPath: string, sha: string): Promise<RunJson[]> {
  const r = await api.request("GET", `${repoPath}/actions/runs?head_sha=${sha}&per_page=20`);
  if (r.status !== 200) return [];
  const all = ((r.json as { workflow_runs?: RunJson[] } | null)?.workflow_runs ?? []).filter((x) => !x.head_sha || x.head_sha === sha);
  const ours = all.filter((x) => (x.path ?? "").endsWith("pages.yml"));
  return ours.length ? ours : all;
}

export type RunOutcome =
  | { kind: "success"; url?: string }
  | { kind: "failure"; url?: string; conclusion: string }
  | { kind: "timeout" };

/**
 * Wait for the pages workflow run of `sha` to finish, until `until` (epoch ms).
 * - No run after `appearMs`: dispatch once (`workflow_dispatch` is in the YAML). That covers a
 *   default branch not named `main` (the push trigger is the skill's verbatim `[main]`) and
 *   the #500 race, where the skill's own remedy is exactly this dispatch.
 * - A failed run is re-dispatched ONCE, again the skill's remedy for a run that started before
 *   Pages was provisioned; a second failure is reported with its log link.
 */
export async function waitForRun(
  api: GitHubApi,
  repoPath: string,
  sha: string,
  branch: string,
  clock: Clock,
  opts: { until: number; intervalMs: number; appearMs: number },
): Promise<RunOutcome> {
  const started = clock.now();
  let dispatched = false;
  let retried = false;
  let failedIds = new Set<number>();
  for (;;) {
    const runs = (await runsFor(api, repoPath, sha)).filter((r) => !(r.id !== undefined && failedIds.has(r.id)));
    const done = runs.find((r) => r.status === "completed" && r.conclusion === "success");
    if (done) return { kind: "success", url: done.html_url };
    const active = runs.find((r) => r.status !== "completed");
    const failed = runs.find((r) => r.status === "completed" && r.conclusion !== "success");
    if (!active && failed) {
      if (retried) return { kind: "failure", url: failed.html_url, conclusion: failed.conclusion ?? "failure" };
      retried = true;
      if (failed.id !== undefined) failedIds = new Set([...failedIds, failed.id]);
      await dispatch(api, repoPath, branch);
    } else if (!active && !dispatched && clock.now() - started >= opts.appearMs) {
      dispatched = true;
      await dispatch(api, repoPath, branch);
    }
    if (clock.now() + opts.intervalMs > opts.until) return { kind: "timeout" };
    await clock.sleep(opts.intervalMs);
  }
}

async function dispatch(api: GitHubApi, repoPath: string, branch: string): Promise<void> {
  await api.request("POST", `${repoPath}/actions/workflows/pages.yml/dispatches`, { ref: branch });
}

// ── live verification ───────────────────────────────────────────────────────

export type VerifyOutcome = { kind: "verified" } | { kind: "timeout"; last: string } | { kind: "unreachable"; last: string };

/**
 * R0: the site counts as published only when `<site>/hps-build.txt` serves THIS run's nonce
 * and `<site>` itself answers 200. A 200 alone would also be true of the previous deployment
 * still in the CDN — "old version, 200" is the false success this file exists to rule out.
 *
 * Unauthenticated fetch: the token never goes to the Pages host. `unreachable` (every attempt
 * a network error — e.g. a custom domain whose DNS is not set) is told apart from `timeout`
 * (the host answered, just never with our nonce).
 */
export async function verifyLive(
  doFetch: typeof fetch,
  siteUrl: string,
  nonce: string,
  clock: Clock,
  opts: { until: number; intervalMs: number },
): Promise<VerifyOutcome> {
  let last = "";
  let answered = false;
  // Cache busting: the `?hps=<nonce>` query makes each URL new to the Pages CDN (which caches
  // for up to 10 minutes), and `cache-control: no-cache` covers intermediaries. Node's fetch
  // does not implement the `cache` request option, so it is not used.
  for (;;) {
    try {
      const r = await doFetch(`${siteUrl}${NONCE_PATH}?hps=${nonce}`, { headers: { "cache-control": "no-cache" }, redirect: "follow", signal: AbortSignal.timeout(15_000) });
      answered = true;
      const body = (await r.text()).trim();
      last = `${r.status}`;
      if (r.status === 200 && body === nonce) {
        const index = await doFetch(`${siteUrl}?hps=${nonce}`, { headers: { "cache-control": "no-cache" }, redirect: "follow", signal: AbortSignal.timeout(15_000) });
        await index.arrayBuffer().catch(() => undefined);
        last = `index ${index.status}`;
        if (index.status === 200) return { kind: "verified" };
      }
    } catch (err) {
      last = err instanceof Error ? err.message : String(err);
    }
    if (clock.now() + opts.intervalMs > opts.until) return answered ? { kind: "timeout", last } : { kind: "unreachable", last };
    await clock.sleep(opts.intervalMs);
  }
}
