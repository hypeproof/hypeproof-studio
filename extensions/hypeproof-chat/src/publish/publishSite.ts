// The one-click publish pipeline. Both entry points — the toolbar command and the coach's
// `publish_site` tool — call `runPublishSite` and nothing else, so the order of operations,
// the checks and the Korean the participant reads are identical whichever way it started (D3).
//
// Deterministic by construction: the same inputs walk the same steps; no model assembles
// commands (the July shell path took 82 s and two tool failures in one turn, F3). Every wait is
// bounded, and a run that is out of time says "not confirmed yet" rather than "done" (R0).
//
// Everything with a side effect is injected (`fetch`, the clock, the auth provider, the API
// base), so the smoke tests drive the whole pipeline against a scripted GitHub.

import * as fs from "node:fs";
import { createGitHubApi, ghMessage, GitHubTransportError, missingScopes, parseOAuthScopes, type GitHubApi } from "./githubApi.ts";
import { AuthToolMissingError, type AuthProvider } from "./githubAuth.ts";
import {
  normalizeCustomDomain,
  publishError,
  resolveRepoName,
  STEP_LABEL_KO,
  validateRepoName,
  type DomainState,
  type PublishErrorCode,
  type PublishSiteInput,
  type PublishSiteResult,
  type PublishStep,
  type StepId,
  type StepStatus,
} from "./publishContract.ts";
import { markerSummary, preflightSite, summarizeIssues } from "./sitePreflight.ts";
import {
  commitSnapshot,
  ensurePagesWorkflow,
  ensureRepo,
  lookupRepo,
  NONCE_PATH,
  PAGES_WORKFLOW_YAML,
  readPages,
  readPublishedNonce,
  verifyLive,
  waitForRun,
  WORKFLOW_PATH,
  type Clock,
  type RepoInfo,
  type TreeFile,
} from "./pagesPublisher.ts";
import { checkDomain, dnsRecordsFor } from "./customDomain.ts";

export interface PublishTiming {
  pagesTries: number;
  pagesIntervalMs: number;
  runIntervalMs: number;
  /** No run for this long after the commit → dispatch the workflow once. */
  runAppearMs: number;
  verifyIntervalMs: number;
  /**
   * GitHub: "it can take up to 10 minutes for changes to your site to publish"
   * (creating-a-github-pages-site). Each of the two waits gets that much at most.
   */
  buildBoundMs: number;
  verifyBoundMs: number;
  healthTries: number;
  healthIntervalMs: number;
}

export const DEFAULT_TIMING: PublishTiming = {
  pagesTries: 12,
  pagesIntervalMs: 5_000,
  runIntervalMs: 5_000,
  runAppearMs: 60_000,
  verifyIntervalMs: 5_000,
  buildBoundMs: 10 * 60_000,
  verifyBoundMs: 10 * 60_000,
  healthTries: 3,
  healthIntervalMs: 5_000,
};

export interface PublishSiteDeps {
  fetch: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  auth: AuthProvider;
  /** `https://api.github.com` in production. */
  apiBase: string;
  /**
   * Test/dev only: serve the site from `<pagesBase>/<login>/<slug>/` instead of
   * `https://<login>.github.io/<slug>/`. The host decides whether it may be set.
   */
  pagesBase?: string;
  workspaceRoot: string | undefined;
  /** `publishing.default_repo_name` from the served profile. */
  profileDefaultRepo?: string;
  /**
   * `publishing.custom_domain === true` on the served profile. The cohort, not the model,
   * decides whether attaching a clinic domain is part of the lesson; a `custom_domain` input
   * on a cohort that did not opt in is refused before anything happens.
   */
  customDomainAllowed: boolean;
  /** Fresh random hex per run. */
  nonce: () => string;
  /** How long to wait for the participant to finish a device-code authorization. 0 → return `needs_user` at once. */
  userAuthWaitMs: number;
  /** How long a JOINED (already shown) device flow is awaited before answering `needs_user` again. */
  joinedAuthWaitMs?: number;
  /**
   * Wall-clock budget for the whole run. The tool path passes less than the SDK stall watchdog
   * (it aborts a turn after ~4 silent minutes); a run that is out of budget reports "still
   * building" and the coach re-checks with `check_only` later.
   */
  budgetMs: number;
  timing?: Partial<PublishTiming>;
  /**
   * Consent gate between authentication and the first write: called with the signed-in login
   * and the repository, so the question can name exactly what becomes public
   * (`<login>/<repo>`). Placed AFTER auth because the owner is unknown before it, and BEFORE
   * any write so a "no" leaves GitHub untouched. Absent → no gate (tests, the live script).
   * Not called for `check_only`, which writes nothing.
   */
  confirmPublish?: (login: string, repo: string, stage: "save" | "publish") => Promise<boolean | "not_allowed">;
  /** The commit our last push to `<login>/<repo>` created (divergence stop, D18 ⑤). */
  lastPushedSha?: (login: string, repo: string) => string | undefined;
  /** A push succeeded: remember its commit for the next divergence check. */
  onPushed?: (login: string, repo: string, sha: string) => Promise<void>;
  onStep?: (step: PublishStep, at: number) => void;
  onDeviceCode?: (code: string, verificationUri: string) => void;
  /** Developer-side detail (HTTP statuses, GitHub messages). Never shown to the participant. */
  log?: (line: string) => void;
}

/** `https://<login>.github.io/<slug>/` (or the test host). The URL the site is or will be at. */
export function siteUrlFor(login: string, slug: string, pagesBase?: string): string {
  if (pagesBase) return `${pagesBase.replace(/\/+$/, "")}/${login.toLowerCase()}/${slug}/`;
  return `https://${login.toLowerCase()}.github.io/${slug}/`;
}

// No TypeScript parameter properties here: this file must load under
// `node --experimental-strip-types`, which only erases types and rejects them.
class Steps {
  readonly list: PublishStep[] = [];
  private readonly onStep: PublishSiteDeps["onStep"];
  private readonly now: () => number;
  constructor(onStep: PublishSiteDeps["onStep"], now: () => number) {
    this.onStep = onStep;
    this.now = now;
  }
  set(id: StepId, status: StepStatus, detail_ko: string): void {
    const step = { id, status, detail_ko };
    const i = this.list.findIndex((s) => s.id === id);
    if (i >= 0) this.list[i] = step;
    else this.list.push(step);
    this.onStep?.(step, this.now());
  }
}

/** Reads files as bytes for the commit. A file that vanished since preflight is dropped. */
function readTreeFiles(files: Array<{ path: string; abs: string }>): TreeFile[] {
  const out: TreeFile[] = [];
  for (const f of files) {
    try {
      out.push({ path: f.path, bytes: fs.readFileSync(f.abs) });
    } catch {
      /* deleted between preflight and commit: publishing it is impossible anyway */
    }
  }
  return out;
}

const enc = (s: string) => new TextEncoder().encode(s);

export async function runPublishSite(input: PublishSiteInput, deps: PublishSiteDeps): Promise<PublishSiteResult> {
  const timing: PublishTiming = { ...DEFAULT_TIMING, ...(deps.timing ?? {}) };
  const clock: Clock = { sleep: deps.sleep, now: deps.now };
  const startedAt = deps.now();
  const deadline = startedAt + deps.budgetMs;
  const stage = input.stage === "save" ? "save" : "publish";
  const checkOnly = input.check_only === true;
  const steps = new Steps(deps.onStep, deps.now);
  const repoName = resolveRepoName(input.repo_name, deps.profileDefaultRepo);
  const extra: Partial<PublishSiteResult> = {};

  const result = (ok: boolean, verified: boolean): PublishSiteResult => ({
    ok,
    verified,
    repo_name: repoName,
    ...extra,
    steps: steps.list,
  });
  const fail = (code: PublishErrorCode, detail?: string, override?: { message_ko?: string; next_action_ko?: string }): PublishSiteResult => {
    if (detail) deps.log?.(`[publish] ${code}: ${detail}`);
    return { ...result(false, false), error: publishError(code, override) };
  };

  // ── inputs ────────────────────────────────────────────────────────────────
  const name = validateRepoName(repoName);
  if (!name.ok) return fail("invalid_repo_name", undefined, { message_ko: name.message });
  let domain: string | null = null;
  if (input.custom_domain !== undefined && input.custom_domain.trim() !== "") {
    if (!deps.customDomainAllowed) {
      return fail("not_allowed", undefined, {
        message_ko: "이 수업에서는 자기 도메인 연결을 쓰지 않아요.",
        next_action_ko: "custom_domain 없이 다시 올려 주세요. 도메인 연결은 강사와 따로 진행해요.",
      });
    }
    const d = normalizeCustomDomain(input.custom_domain);
    if (!d.ok) return fail("invalid_domain", undefined, { message_ko: d.message });
    domain = d.domain;
  }

  // ── preflight (nothing leaves the machine before this passes) ─────────────
  let siteFiles: Array<{ path: string; abs: string }> = [];
  if (!checkOnly) {
    if (!deps.workspaceRoot) return fail("no_workspace");
    const report = preflightSite(deps.workspaceRoot);
    const lines = summarizeIssues(report.issues);
    if (report.blocked) {
      steps.set("preflight", "failed", lines.join(" / "));
      return fail("preflight_blocked", undefined, { message_ko: `올리기 전에 고쳐야 할 곳이 있어요:\n- ${lines.join("\n- ")}` });
    }
    steps.set(
      "preflight",
      report.issues.length ? "warning" : "ok",
      report.issues.length ? `파일 ${report.files.length}개 · 확인할 점: ${lines.join(" / ")}` : `파일 ${report.files.length}개를 검사했어요. 문제 없어요.`,
    );
    siteFiles = report.files;
    if (report.markers.length) extra.markers = report.markers;
  } else {
    steps.set("preflight", "skipped", "상태만 확인해요.");
  }

  // ── auth ──────────────────────────────────────────────────────────────────
  let api: GitHubApi | null = null;
  let login = "";
  try {
    for (let round = 0; ; round++) {
      let token: string | null;
      try {
        token = await deps.auth.token();
      } catch (err) {
        if (err instanceof AuthToolMissingError) {
          steps.set("auth", "failed", "GitHub 연결 도구(gh)를 찾지 못했어요.");
          return fail("gh_missing");
        }
        throw err;
      }
      let needed: string[] | null = null;
      let signedIn = false;
      if (!token) {
        needed = ["repo", "workflow"];
      } else {
        api = createGitHubApi({ base: deps.apiBase, token, deps: { fetch: deps.fetch, sleep: deps.sleep, now: deps.now } });
        const u = await api.request("GET", "/user");
        if (u.status === 401) {
          // gh still holds a token GitHub no longer accepts (revoked, expired): log in again.
          needed = ["repo", "workflow"];
        } else if (u.status !== 200) {
          steps.set("auth", "failed", `GitHub 계정을 확인하지 못했어요 (${u.status}).`);
          return fail("unexpected", `GET /user ${u.status} ${ghMessage(u)}`);
        } else {
          login = String((u.json as { login?: unknown } | null)?.login ?? "");
          const missing = missingScopes(parseOAuthScopes(u.headers.get("x-oauth-scopes")));
          if (missing.length) {
            needed = missing;
            signedIn = true;
          }
        }
      }
      if (!needed) break;
      if (round >= 1) {
        // The flow finished but the token still lacks the scopes: do not loop on the participant.
        steps.set("auth", "failed", "GitHub 권한이 아직 부족해요.");
        return fail(signedIn ? "missing_scope" : "not_logged_in");
      }
      let pending;
      try {
        pending = await deps.auth.beginUserAuth(needed, signedIn);
      } catch (err) {
        steps.set("auth", "failed", "GitHub 로그인 코드를 받지 못했어요.");
        return fail(signedIn ? "missing_scope" : "not_logged_in", err instanceof Error ? err.message : String(err));
      }
      extra.needs_user = { kind: "device_code", code: pending.code, verification_uri: pending.verificationUri };
      steps.set(
        "auth",
        "needs_user",
        `${pending.verificationUri} 에서 여덟 글자 코드 ${pending.code} 를 입력하고 초록색 Authorize 버튼을 눌러 주세요.`,
      );
      deps.onDeviceCode?.(pending.code, pending.verificationUri);
      const waitMs = pending.joined ? Math.max(deps.userAuthWaitMs, deps.joinedAuthWaitMs ?? 0) : deps.userAuthWaitMs;
      if (waitMs <= 0) return result(false, false);
      const outcome = await Promise.race([pending.done, deps.sleep(waitMs).then(() => "timeout" as const)]);
      if (outcome === "timeout") {
        // Tool path: answer with the same code again; the flow keeps running in the background.
        if (pending.joined || deps.userAuthWaitMs < 60_000) return result(false, false);
        pending.cancel();
        delete extra.needs_user;
        steps.set("auth", "failed", "코드 입력을 기다리다 시간이 지났어요.");
        return fail("auth_timeout");
      }
      delete extra.needs_user;
      if (!outcome) {
        steps.set("auth", "failed", "GitHub 로그인이 끝나지 않았어요.");
        return fail(signedIn ? "missing_scope" : "not_logged_in");
      }
    }
    if (!api || !login) return fail("unexpected", "no api/login after auth");
    steps.set("auth", "ok", `GitHub 계정 ${login} 으로 확인했어요.`);
    const plannedUrl = siteUrlFor(login, repoName, deps.pagesBase);
    extra.planned_url = plannedUrl;

    // ── check_only: report, change nothing (except enforcing HTTPS when GitHub allows) ──
    if (checkOnly) return await checkStatus(api, login, repoName, plannedUrl, domain);

    // ── consent (registration), before the first write ────────────────────────
    const consent = deps.confirmPublish ? await deps.confirmPublish(login, repoName, stage) : true;
    if (consent === "not_allowed") {
      steps.set("repo", "skipped", "이 GitHub 계정·저장소로는 등록되어 있지 않아 올리지 않았어요.");
      return fail("not_allowed");
    }
    if (!consent) {
      steps.set("repo", "skipped", "공개하지 않기로 해서 아무것도 올리지 않았어요.");
      return fail("declined");
    }
    const expectedHead = deps.lastPushedSha?.(login, repoName);

    // ── repository ──────────────────────────────────────────────────────────
    const repoRes = await ensureRepo(api, login, repoName);
    if (!repoRes.ok) {
      steps.set("repo", "failed", "저장소를 준비하지 못했어요.");
      return fail(repoRes.code, repoRes.detail);
    }
    const repo = repoRes.repo;
    extra.repo_url = repo.htmlUrl;
    steps.set("repo", "ok", repo.created ? `새 저장소 ${repo.htmlUrl} 를 만들었어요.` : `이미 있는 내 저장소 ${repo.htmlUrl} 를 그대로 써요.`);

    const site = readTreeFiles(siteFiles);
    // `.nojekyll` in both stages: meaningless to the Actions build but harmless, and it keeps
    // a later switch to branch publishing (or a participant enabling Pages by hand on a saved
    // repo) from running Jekyll over files with underscores.
    const common: TreeFile[] = [...site, { path: ".nojekyll", bytes: new Uint8Array() }];

    // ── save stage: files only, Pages untouched ───────────────────────────────
    if (stage === "save") {
      // No workflow file and no Pages call (D-017): a workflow without Pages enabled produces
      // a failed Actions run the participant would see as red. An existing pages.yml is also
      // dropped from this snapshot, because keeping it would trigger a deployment — saving
      // would silently publish. agent.md is not edited to record the planned address: the tool
      // never rewrites the participant's prose; the coach writes that line if the lesson wants it.
      const c = await commitSnapshot(api, repo.path, repo.defaultBranch, common, "HypeProof Studio에서 홈페이지 저장", clock, expectedHead);
      if (!c.ok) {
        steps.set("commit", "failed", c.code === "remote_changed" ? "GitHub에서 직접 고친 내용이 있어 올리지 않았어요." : "파일을 저장소에 올리지 못했어요.");
        return fail(c.code, c.detail);
      }
      await deps.onPushed?.(login, repoName, c.sha);
      steps.set("commit", "ok", `파일 ${site.length}개를 저장소에 올렸어요. 아직 인터넷 주소는 열리지 않아요(404가 정상이에요).${markerSuffix()}`);
      return result(true, false);
    }

    // ── Pages (before the workflow file lands — #500) ─────────────────────────
    const pagesRes = await ensurePagesWorkflow(api, repo.path, clock, { tries: timing.pagesTries, intervalMs: timing.pagesIntervalMs });
    if (!pagesRes.ok) {
      steps.set("pages", "failed", "GitHub Pages를 켜지 못했어요.");
      return fail(pagesRes.code, pagesRes.detail);
    }
    steps.set("pages", "ok", "GitHub Pages를 켰어요(Actions 방식).");
    const existingCname = pagesRes.pages.cname ? pagesRes.pages.cname.toLowerCase() : null;
    const existingDomainSite = existingCname ? { name: existingCname, https: pagesRes.pages.httpsEnforced } : null;

    // ── commit: site + workflow + nonce (+ CNAME) as ONE commit ───────────────
    const nonce = deps.nonce();
    const cnameForTree = domain ?? existingCname;
    const files: TreeFile[] = [
      ...common,
      { path: WORKFLOW_PATH, bytes: enc(PAGES_WORKFLOW_YAML) },
      { path: NONCE_PATH, bytes: enc(`${nonce}\n`) },
      ...(cnameForTree ? [{ path: "CNAME", bytes: enc(`${cnameForTree}\n`) }] : []),
    ];
    const commit = await commitSnapshot(api, repo.path, repo.defaultBranch, files, `HypeProof Studio에서 홈페이지 올리기 (${nonce.slice(0, 8)})`, clock, expectedHead);
    if (!commit.ok) {
      steps.set("commit", "failed", commit.code === "remote_changed" ? "GitHub에서 직접 고친 내용이 있어 올리지 않았어요." : "파일을 저장소에 올리지 못했어요.");
      return fail(commit.code, commit.detail);
    }
    // Recorded at once: the push happened even if the build or verification later fails.
    await deps.onPushed?.(login, repoName, commit.sha);
    steps.set("commit", "ok", `파일 ${site.length}개를 한 번에 올렸어요.`);

    // ── build + verify ──────────────────────────────────────────────────────
    const verified = await buildAndVerify(api, repo, commit.sha, nonce, existingDomainSite, plannedUrl, { dispatch: true });
    if (verified !== true) return verified;

    // ── custom domain, after the github.io address is verified ───────────────
    if (domain || existingCname) await domainStep(api, repo.path, login, (domain ?? existingCname)!, domain !== null && domain !== existingCname);
    return result(true, true);
  } catch (err) {
    if (err instanceof GitHubTransportError) {
      return fail(err.kind === "rate_limited" ? "rate_limited" : "network", err.message);
    }
    return fail("unexpected", err instanceof Error ? err.stack ?? err.message : String(err));
  }

  // ── helpers sharing this run's state ────────────────────────────────────────

  /** " 다음에 고칠 표식: …" for the final step's detail, or "" when the site has no markers. */
  function markerSuffix(): string {
    const m = markerSummary(extra.markers);
    return m ? ` ${m}` : "";
  }

  /** Wait for the run, then the nonce. Returns true when verified, else the result to return. */
  async function buildAndVerify(
    api: GitHubApi,
    repo: RepoInfo,
    sha: string,
    nonce: string,
    domainSite: { name: string; https: boolean } | null,
    plannedUrl: string,
    opts: { dispatch: boolean },
  ): Promise<true | PublishSiteResult> {
    const cname = domainSite?.name ?? null;
    steps.set("build", "pending", "GitHub에서 사이트를 만드는 중이에요(보통 1~2분).");
    const buildUntil = Math.min(deadline, deps.now() + timing.buildBoundMs);
    const run = await waitForRun(api, repo.path, sha, repo.defaultBranch, clock, {
      until: buildUntil,
      intervalMs: timing.runIntervalMs,
      // check_only never dispatches: it must not start anything.
      appearMs: opts.dispatch ? timing.runAppearMs : Number.POSITIVE_INFINITY,
    });
    if (run.kind === "failure") {
      steps.set("build", "failed", `사이트 만들기가 실패했어요(${run.conclusion}).`);
      return fail("actions_failed", run.url, {
        next_action_ko: run.url ? `실패 기록(${run.url})을 강사에게 보여 주세요.` : "강사에게 알려 주세요.",
      });
    }
    if (run.kind === "timeout") {
      if (buildUntil >= deadline) {
        steps.set("build", "pending", "아직 만드는 중이에요. 열리는 걸 확인하기 전에는 주소를 확정하지 않아요.");
        return result(true, false);
      }
      steps.set("build", "failed", "10분을 기다렸지만 사이트 만들기가 끝나지 않았어요.");
      return fail("verify_timeout");
    }
    steps.set("build", "ok", "사이트를 다 만들었어요.");

    // The address to check: the custom domain once GitHub serves the site there (the github.io
    // address then only redirects to it), else the github.io address.
    // https only once GitHub enforces it: before that the certificate may not exist yet and an
    // https fetch would fail on TLS, which is not what "the site is not there" means.
    const siteUrl = domainSite ? `${domainSite.https ? "https" : "http"}://${domainSite.name}/` : plannedUrl;
    steps.set("verify", "pending", `${siteUrl} 가 새 버전으로 열리는지 확인하는 중이에요.`);
    const verifyUntil = Math.min(deadline, deps.now() + timing.verifyBoundMs);
    const v = await verifyLive(deps.fetch, siteUrl, nonce, clock, { until: verifyUntil, intervalMs: timing.verifyIntervalMs });
    if (v.kind === "verified") {
      // Exactly the address that served the nonce — never a "probably also works" variant.
      extra.url = siteUrl;
      steps.set("verify", "ok", `${extra.url} 가 새 버전으로 열리는 것을 확인했어요.${markerSuffix()}`);
      return true;
    }
    deps.log?.(`[publish] verify ${v.kind}: ${v.last}`);
    if (cname && v.kind === "unreachable") {
      steps.set("verify", "failed", `${cname} 도메인이 아직 열리지 않아 새 버전을 확인하지 못했어요.`);
      extra.domain = { name: cname, state: "dns_pending", dns_records: dnsRecordsFor(cname, login) };
      return fail("domain_not_ready");
    }
    if (verifyUntil >= deadline) {
      steps.set("verify", "pending", "아직 주소에 새 버전이 보이지 않아요. 열리는 걸 확인하기 전에는 주소를 확정하지 않아요.");
      return result(true, false);
    }
    steps.set("verify", "failed", "10분을 기다렸지만 새 버전이 열리는 것을 확인하지 못했어요.");
    return fail("verify_timeout");
  }

  async function domainStep(api: GitHubApi, repoPath: string, login: string, name: string, setNow: boolean): Promise<void> {
    if (setNow) {
      const put = await api.request("PUT", `${repoPath}/pages`, { cname: name });
      if (put.status < 200 || put.status >= 300) {
        deps.log?.(`[publish] set cname ${put.status} ${ghMessage(put)}`);
        steps.set("domain", "failed", `도메인 ${name} 을 GitHub Pages에 등록하지 못했어요.`);
        extra.domain = { name, state: "dns_pending", dns_records: dnsRecordsFor(name, login) };
        return;
      }
    }
    const check = await checkDomain(api, repoPath, name, clock, { healthTries: timing.healthTries, intervalMs: timing.healthIntervalMs });
    extra.domain = { name, state: check.state, dns_records: dnsRecordsFor(name, login) };
    const caveat =
      setNow && check.state !== "https_enforced"
        ? " 도메인 연결이 끝날 때까지는 github.io 주소도 이 도메인으로 넘어가서 열리지 않을 수 있어요."
        : "";
    steps.set("domain", check.state === "https_enforced" ? "ok" : "pending", check.detail_ko + caveat);
  }

  async function checkStatus(api: GitHubApi, login: string, slug: string, plannedUrl: string, wantDomain: string | null): Promise<PublishSiteResult> {
    const found = await lookupRepo(api, login, slug);
    if (!found.ok) {
      steps.set("repo", "failed", "저장소를 확인하지 못했어요.");
      return fail(found.code, found.detail);
    }
    if (!found.repo) {
      steps.set("repo", "pending", `아직 저장소가 없어요. 예정 주소: ${plannedUrl}`);
      return result(true, false);
    }
    const repo = found.repo;
    extra.repo_url = repo.htmlUrl;
    steps.set("repo", "ok", `저장소 ${repo.htmlUrl} 가 있어요.`);
    const pages = await readPages(api, repo.path);
    if (!pages.ok) return fail(pages.code, pages.detail);
    if (!pages.pages) {
      steps.set("pages", "pending", "저장만 된 상태예요. 아직 인터넷 주소가 켜지지 않았어요(404가 정상이에요).");
      return result(true, false);
    }
    steps.set("pages", "ok", "GitHub Pages가 켜져 있어요.");
    const cname = pages.pages.cname ? pages.pages.cname.toLowerCase() : null;
    const published = await readPublishedNonce(api, repo.path, repo.defaultBranch);
    if (!published.head || !published.nonce) {
      // R0: without our nonce we cannot tell this deployment from an older one.
      steps.set("verify", "pending", "확인용 표시가 없는 버전이에요. 이 기능으로 한 번 다시 올리면 확인할 수 있어요.");
      return result(true, false);
    }
    const verified = await buildAndVerify(api, repo, published.head, published.nonce, cname ? { name: cname, https: pages.pages.httpsEnforced } : null, plannedUrl, {
      dispatch: false,
    });
    // The domain view is reported whether or not the content verified: "is my domain ready"
    // is exactly the question a check_only call after DNS changes is asking.
    if (cname || wantDomain) await domainStepReadOnly(api, repo.path, login, cname ?? wantDomain!, wantDomain);
    if (verified !== true) return { ...verified, ...(extra.domain ? { domain: extra.domain } : {}), steps: steps.list };
    return result(true, true);
  }

  /** check_only's domain view: never registers a domain, may enforce HTTPS once allowed. */
  async function domainStepReadOnly(api: GitHubApi, repoPath: string, login: string, configured: string, wanted: string | null): Promise<void> {
    if (wanted && wanted !== configured) {
      extra.domain = { name: wanted, state: "dns_pending" as DomainState, dns_records: dnsRecordsFor(wanted, login) };
      steps.set("domain", "pending", `${wanted} 은 아직 이 사이트에 등록되지 않았어요. custom_domain 으로 다시 올리면 등록돼요.`);
      return;
    }
    await domainStep(api, repoPath, login, configured, false);
  }
}

/** One Korean line per step for a progress UI that shows only the latest. */
export function stepLabel(step: PublishStep): string {
  return `${STEP_LABEL_KO[step.id]} — ${step.detail_ko}`;
}

/**
 * The chat-transcript line for a run started from the toolbar button. The coach reads the
 * transcript on its next turn, so the button's outcome must be there in words it can continue
 * from — including, for a failure, what the participant was told to do next. The address is
 * written as verified only when it was.
 */
export function resultChatText(r: PublishSiteResult): string {
  const lines: string[] = ["[홈페이지 올리기 버튼 결과]"];
  if (r.verified && r.url) lines.push(`인터넷 주소가 열리는 것을 확인했어요: ${r.url}`);
  else if (r.needs_user) lines.push(`GitHub 코드 입력을 기다리는 중이에요: ${r.needs_user.code} (${r.needs_user.verification_uri})`);
  else if (r.error) lines.push(`올리지 못했어요. ${r.error.message_ko} ${r.error.next_action_ko}`);
  else lines.push(`아직 주소가 열리는 것을 확인하지 못했어요.${r.planned_url ? ` 예정 주소: ${r.planned_url}` : ""}`);
  // Counted by preflight (D24); omitted on failure, where the next step is the fix, not the markers.
  const markers = markerSummary(r.markers);
  if (markers && !r.error) lines.push(markers);
  if (r.repo_url) lines.push(`저장소: ${r.repo_url}`);
  for (const s of r.steps) lines.push(`- ${STEP_LABEL_KO[s.id]}: ${s.detail_ko}`);
  if (r.domain) {
    lines.push(`도메인 ${r.domain.name}: ${r.domain.state}`);
    for (const d of r.domain.dns_records) lines.push(`  ${d.type} ${d.host} → ${d.value}`);
  }
  // Markdown hard breaks: one fact per line in one bubble (same as the team-brain replies).
  return lines.join("  \n");
}
