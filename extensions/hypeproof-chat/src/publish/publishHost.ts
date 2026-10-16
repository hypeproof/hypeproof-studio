// VS Code glue for the one-click publish: the toolbar command, the coach tool's host side,
// the "this becomes public" confirmation, progress, and the device-code modal.
//
// Everything that decides something lives in the pure modules beside this file; this one only
// turns their results into VS Code UI. Both entry points go through `run()`, so they share the
// single-flight lock, the consent memory and the pipeline (D3).

import * as vscode from "vscode";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { execFile } from "node:child_process";
import type { ResolvedProfile } from "../protocol";
import type { McpToolResult } from "../browserMcp";
import { AuthToolMissingError, createGhCliAuthProvider, type GhCliAuthProvider } from "./githubAuth";
import { createFetchTransport, createGhTransport, createGitHubApi, GitHubTransportError, type GitHubApi, type GitHubTransport } from "./githubApi";
import { downloadRepo, findClassRepos, remoteHead, type ClassRepo, type DownloadFailure } from "./githubContinue";
import { cloneRepo, locateRepoFolder, syncClone, type CheckoutFailure, type Exec } from "./repoCheckout";
import { classFolderCheck, pressAccess, publishError, resolveRepoName, sitePublishAllowed, type AccessCheck, type PublishSiteInput, type PublishSiteResult } from "./publishContract";
import { BUTTON_BUDGET_MS, toolBudgetMs, type PublishEndpoints } from "./publishConfig";
import { resultChatText, runPublishSite, stepLabel } from "./publishSite";
import { markerSummary } from "./sitePreflight";
import { cloneFolderFor, decideTarget, folderMatches, listSwitchTargets, localFiles, pullInto, type SwitchTarget, type TargetAction } from "./projectSwitch";
import { consentDecision, PublishRegistry, registrationPrompt, type RegistryStore } from "./publishRegistry";

/** Context key the manifest gates the toolbar button on. */
export const SITE_PUBLISH_CONTEXT_KEY = "hypeproof-chat.sitePublishEnabled";

/** What the start page learns about this seat's GitHub before a class folder opens. */
export type ClassReposOutcome =
  | { status: "found"; login: string; repos: ClassRepo[] }
  | { status: "none"; login: string }
  | { status: "signin" }
  | { status: "unavailable"; detail: string };

/** "GitHub에서 이어하기" could not bring the site down: the sentence the participant reads. */
export function continueFailureMessage(code: DownloadFailure["code"] | CheckoutFailure["code"] | "network" | "account"): string {
  if (code === "empty") return "이 저장소에는 아직 올린 홈페이지가 없어요. '새로 하기'를 눌러 주세요.";
  if (code === "git_missing") return "이 컴퓨터에서 git을 찾지 못해 내려받지 않았어요. 강사에게 알려 주세요.";
  if (code === "too_large") return "홈페이지 파일이 너무 많거나 커서 내려받지 않았어요. 강사에게 알려 주세요.";
  if (code === "network") return "GitHub에 연결하지 못해 내려받지 않았어요. 인터넷 연결을 확인한 뒤 다시 눌러 주세요.";
  if (code === "account") return "GitHub 계정을 다시 확인하지 못했어요. 시작 화면을 닫았다 다시 열어 주세요.";
  return "GitHub에서 홈페이지를 내려받지 못했어요. 잠시 뒤 다시 눌러 주세요.";
}

export interface SitePublisherHost {
  profile(): ResolvedProfile | null;
  isMinor(profile: ResolvedProfile): boolean;
  workspaceRoot(): string | undefined;
  /** No coach turn is running (the button refuses while one is: the coach may be publishing). */
  idle(): boolean;
  /** Put a finished button run into the chat transcript (as an app-written reply). */
  postToChat(text: string): Promise<void>;
  /** Inline notice in the chat panel (no toast — a toast pauses the integrated browser, #308). */
  notice(text: string): void;
  log(line: string): void;
  stallMs(): number | undefined;
  endpoints: PublishEndpoints;
  /** Where registrations persist (the extension's globalState: survives restarts). */
  store: RegistryStore;
  /** Ask the Service, now, about the token stored in this seat (one fresh /v1/profile). */
  checkAccess(): Promise<AccessCheck>;
  /** Re-read the profile after the Service refused a press, so the button disappears. */
  refreshProfile(): Promise<void>;
  /** The class folder: the activity's folder, else the profile's workspace_root. */
  classFolder(): string | undefined;
  /** The same folder on disk (symlinks resolved). */
  sameFolder(a: string, b: string): boolean;
}

export class SitePublisher {
  private readonly host: SitePublisherHost;
  private readonly auth: GhCliAuthProvider;
  private running = false;
  readonly registry: PublishRegistry;
  private readonly transport: (token: string) => GitHubTransport;
  /**
   * Repositories the coach tool was approved for in canUseTool but whose owner was not known
   * yet (the approval happens before authentication). The run that follows registers them
   * under the login it signs in as, then clears the entry.
   */
  private readonly toolApproved = new Set<string>();

  constructor(host: SitePublisherHost) {
    this.host = host;
    this.registry = new PublishRegistry(host.store);
    this.auth = createGhCliAuthProvider({
      execFile: execFile as unknown as Parameters<typeof createGhCliAuthProvider>[0]["execFile"],
      platform: process.platform,
      ...(host.endpoints.ghPath ? { ghPath: host.endpoints.ghPath } : {}),
    });
    const ghApi = createGhTransport({
      execFile: execFile as unknown as Parameters<typeof createGhTransport>[0]["execFile"],
      bin: () => this.auth.bin(),
    });
    // `gh api` in every real run. Only a loopback mock that publishConfig.ts let through gets
    // plain HTTP (it cannot be reached by `gh`, which talks to github.com).
    const apiBase = host.endpoints.apiBase;
    this.transport = apiBase ? (token) => createFetchTransport({ base: apiBase, token, fetch }) : () => ghApi;
    for (const r of host.endpoints.refused) host.log(`[publish] ignored override ${r} (not a test/dev run, or not a loopback URL)`);
  }

  /** The served profile allows publishing here — the gate for the button, the coach tool and registrations. */
  allowed(): boolean {
    const p = this.host.profile();
    return !!p && sitePublishAllowed(p.publishing, this.host.isMinor(p)).ok;
  }

  /**
   * May the BUTTON be shown? Only when the profile served for this seat's token allows it (user
   * decision 2026-10-13: publishing is for holders of a HypeProof-issued token, decided per
   * cohort by the Service). There is no profile without a valid token, so an expired token, a
   * Service that does not answer, or a cohort without publishing all hide it — a persisted
   * registration does not bring it back. Each press re-checks the token (`run`).
   */
  available(): boolean {
    return this.allowed();
  }

  /**
   * The repository name this input would publish to (for the confirmation copy): an explicit
   * name, else the repository the open folder is bound to under the last login, else the
   * profile's default. The run decides finally, after sign-in (`folderRepo` in run()).
   */
  repoNameFor(input: PublishSiteInput): string {
    if (!input.repo_name?.trim()) {
      const login = this.registry.lastLogin();
      const bound = login ? this.registry.boundRepo(login, this.host.workspaceRoot(), (a, b) => this.host.sameFolder(a, b)) : undefined;
      if (bound) return bound;
    }
    return resolveRepoName(input.repo_name, this.host.profile()?.publishing?.default_repo_name);
  }

  /**
   * Ask once per repository per session. Used by the button directly and by the coach tool via
   * resolveActionApproval ("publishSite" kind). The copy names the consequence — public, and
   * agent.md included (D2) — because "올리기" alone reads like saving.
   */
  /** Registered already under the last login we published as (the tool path cannot know the login sooner). */
  allowedWithoutPrompt(repoName: string): boolean {
    const login = this.registry.lastLogin();
    return !!login && this.registry.isRegistered(login, repoName);
  }

  /**
   * The registration question (button path, and the tool path when the owner turns out to be
   * unregistered). Asked AFTER sign-in so it can name `<login>/<repo>`; a "yes" is persisted,
   * so every later press of the button publishes without a modal.
   */
  async confirmRegistration(login: string, repoName: string): Promise<boolean> {
    await this.registry.setLastLogin(login);
    if (this.registry.isRegistered(login, repoName)) return true;
    const { title, detail } = registrationPrompt(login, repoName);
    const pick = await vscode.window.showWarningMessage(title, { modal: true, detail }, "공개하기");
    if (pick !== "공개하기") return false;
    await this.registry.register(login, repoName, this.host.workspaceRoot());
    return true;
  }

  /**
   * Coach tool approval (resolveActionApproval "publishSite"). The tool keeps its consent
   * semantics — the coach's first outward publish is the participant's decision, asked in
   * canUseTool before the tool runs — but uses the SAME persisted registration as the button:
   * one consent concept, one place to revoke it ("배포 등록 해제"), and no second question for
   * a repository the participant already registered by pressing the button (or vice versa).
   * The login is unknown here (no authentication has run yet), so the last login we published
   * as is used to recognize a registration; when there is none, the copy names the repository
   * only and the run registers it under whoever signs in.
   */
  async approveForTool(repoName: string, stage: "save" | "publish", onPrompted?: () => void): Promise<boolean> {
    if (this.allowedWithoutPrompt(repoName)) return true;
    onPrompted?.();
    const login = this.registry.lastLogin();
    const { title, detail } = registrationPrompt(login ?? "내 GitHub 계정", repoName);
    const pick = await vscode.window.showWarningMessage(stage === "save" ? title.replace("홈페이지를 공개합니다", "홈페이지를 저장합니다(공개 저장소)") : title, { modal: true, detail }, "공개하기");
    if (pick !== "공개하기") return false;
    this.toolApproved.add(repoName);
    return true;
  }

  /** "배포 등록 해제": forget one registration (or all). The next press asks again. */
  async unregisterFromCommand(): Promise<void> {
    const regs = this.registry.list();
    this.toolApproved.clear();
    if (regs.length === 0) {
      void vscode.window.showInformationMessage("등록된 배포가 없어요.");
      return;
    }
    const ALL = "모두 해제";
    const items = [...regs.map((r) => ({ label: `${r.login}/${r.repo}`, reg: r })), ...(regs.length > 1 ? [{ label: ALL, reg: null }] : [])];
    const pick = regs.length === 1 ? items[0] : await vscode.window.showQuickPick(items, { placeHolder: "등록을 해제할 저장소를 고르세요" });
    if (!pick) return;
    const ok = await vscode.window.showWarningMessage(
      pick.reg ? `${pick.label} 배포 등록을 해제할까요?` : "모든 배포 등록을 해제할까요?",
      { modal: true, detail: "저장소와 공개된 사이트는 그대로 있어요. 다음에 버튼을 누르면 다시 확인을 받아요." },
      "해제",
    );
    if (ok !== "해제") return;
    const n = pick.reg ? await this.registry.unregister(pick.reg.login, pick.reg.repo) : await this.registry.unregister();
    void vscode.window.showInformationMessage(`배포 등록 ${n}건을 해제했어요.`);
  }

  private async run(input: PublishSiteInput, mode: "button" | "tool", progress?: (line: string) => void): Promise<PublishSiteResult> {
    const repoName = this.repoNameFor(input);
    const workspace = this.host.workspaceRoot();
    if (this.running) return { ok: false, verified: false, repo_name: repoName, steps: [], error: publishError("busy") };
    this.running = true;
    try {
      // Token gate: the Service answers for this seat's token before anything else happens.
      const gate = pressAccess(await this.host.checkAccess());
      if (!gate.ok) {
        this.host.log(`[publish] press refused by the token gate: ${gate.code}`);
        if (gate.refreshProfile) await this.host.refreshProfile().catch(() => undefined);
        return { ok: false, verified: false, repo_name: repoName, steps: [], error: publishError(gate.code) };
      }
      // Class folder only: the pipeline uploads the whole open folder, so nothing else may go out.
      const classFolder = this.host.classFolder();
      const folder = classFolderCheck({ workspaceRoot: workspace, classFolder, same: (a, b) => this.host.sameFolder(a, b) });
      if (!folder.ok) {
        this.host.log(`[publish] press refused: ${folder.code} (open ${workspace ?? "none"}, class ${classFolder ?? "unknown"})`);
        const name = (p: string | undefined) => (p ? path.basename(p) : "알 수 없음");
        const error =
          folder.code === "not_class_folder"
            ? publishError("not_class_folder", { message_ko: `수업 폴더(${name(classFolder)})에서만 올릴 수 있어요. 지금 열린 폴더(${name(workspace)})는 올리지 않았어요.` })
            : publishError("no_workspace");
        return { ok: false, verified: false, repo_name: repoName, steps: [], error };
      }
      const profileOk = this.allowed();
      const profile = this.host.profile();
      return await runPublishSite(input, {
        fetch,
        sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
        now: () => Date.now(),
        auth: this.auth,
        transport: this.transport,
        ...(this.host.endpoints.pagesBase ? { pagesBase: this.host.endpoints.pagesBase } : {}),
        workspaceRoot: this.host.workspaceRoot(),
        profileDefaultRepo: profile?.publishing?.default_repo_name,
        customDomainAllowed: profileOk && profile?.publishing?.custom_domain === true,
        nonce: () => crypto.randomBytes(16).toString("hex"),
        // Button: the person at the screen enters the code while we wait (≤ 5 min, the class
        // budget). Tool: answer at once so the coach can show the code; a later call joins the
        // same flow and waits a little for it to finish.
        userAuthWaitMs: mode === "button" ? 5 * 60_000 : 0,
        joinedAuthWaitMs: mode === "tool" ? 45_000 : 0,
        budgetMs: mode === "button" ? BUTTON_BUDGET_MS : toolBudgetMs(this.host.stallMs()),
        // A folder publishes to its own repository: the one it is bound to under this login, or a
        // new one when it never published from this computer (user requirement 2026-10-13).
        folderRepo: (login) => {
          const bound = this.registry.boundRepo(login, workspace, (a, b) => this.host.sameFolder(a, b));
          return bound ? { repo: bound } : "new";
        },
        // Registration gate between sign-in and the first write (check_only never reaches it).
        confirmPublish: async (login, repo) => {
          await this.registry.setLastLogin(login);
          // The tool was approved under the name known before sign-in; a new folder's repository
          // is named only after it, so that approval covers the name the run settled on.
          const approved = this.toolApproved.has(repo) || this.toolApproved.has(repoName);
          const decision = consentDecision({
            registered: this.registry.isRegistered(login, repo),
            profileAllowed: profileOk,
            toolApproved: mode === "tool" && approved,
          });
          if (decision === "go") return true;
          if (decision === "not_allowed") return "not_allowed";
          if (decision === "register") {
            this.toolApproved.delete(repo);
            this.toolApproved.delete(repoName);
            await this.registry.register(login, repo, workspace);
            return true;
          }
          return this.confirmRegistration(login, repo);
        },
        lastPushedSha: (login, repo) => this.registry.get(login, repo)?.lastPushedSha,
        onPushed: async (login, repo, sha) => {
          await this.registry.recordPush(login, repo, sha, workspace);
        },
        onStep: (step, at) => {
          this.host.log(`[publish] ${new Date(at).toISOString()} ${step.id} ${step.status} ${step.detail_ko}`);
          progress?.(stepLabel(step));
        },
        onDeviceCode: (code, uri) => (mode === "button" ? void this.showDeviceCode(code, uri) : this.host.notice(`GitHub 코드 ${code} — ${uri} 에서 입력해 주세요.`)),
        log: (line) => this.host.log(line),
      });
    } finally {
      this.running = false;
    }
  }

  // ── "GitHub에서 이어하기" (start page) ─────────────────────────────────────────

  /** The signed-in GitHub account without starting a sign-in: null when nobody is signed in. */
  private async signedInApi(): Promise<{ api: GitHubApi; login: string } | null> {
    const token = await this.auth.token();
    if (!token) return null;
    const api = createGitHubApi({
      transport: this.transport(token),
      deps: { sleep: (ms) => new Promise((r) => setTimeout(r, ms)), now: () => Date.now() },
    });
    const u = await api.request("GET", "/user");
    if (u.status === 401) return null;
    const login = u.status === 200 ? String((u.json as { login?: unknown } | null)?.login ?? "") : "";
    if (!login) throw new Error(`GET /user ${u.status}`);
    return { api, login };
  }

  /** The class sites this seat's GitHub account already has (start page, after a token is entered). */
  async findClassRepos(): Promise<ClassReposOutcome> {
    try {
      const gh = await this.signedInApi();
      if (!gh) return { status: "signin" };
      const r = await findClassRepos(gh.api, gh.login);
      if (!r.ok) return { status: "unavailable", detail: r.detail };
      return r.repos.length ? { status: "found", login: gh.login, repos: r.repos } : { status: "none", login: gh.login };
    } catch (err) {
      const detail = err instanceof AuthToolMissingError ? "gh missing" : err instanceof Error ? err.message : String(err);
      this.host.log(`[continue] could not list repositories: ${detail}`);
      return { status: "unavailable", detail };
    }
  }

  /**
   * Sign in from the start page so the participant's sites can be listed: the same device-code
   * modal as the publish button, with the scopes a later publish needs (no second sign-in then).
   */
  async signInForContinue(): Promise<boolean> {
    let pending;
    try {
      pending = await this.auth.beginUserAuth(["repo", "workflow"], false);
    } catch (err) {
      this.host.log(`[continue] sign-in did not start: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
    void this.showDeviceCode(pending.code, pending.verificationUri);
    const outcome = await Promise.race([pending.done, new Promise<"timeout">((r) => setTimeout(() => r("timeout"), 5 * 60_000))]);
    if (outcome === "timeout") {
      pending.cancel();
      return false;
    }
    return outcome === true;
  }

  /**
   * The folder "GitHub에서 이어하기" opens for `repo`: the same rule as "프로젝트 변경"
   * (bringRepo) — the repository's own folder when this computer has one, brought up to GitHub,
   * else a clone beside the class folder. Bound to it either way (registered, with the commit it
   * came from), so the next press publishes on top of that commit with no question.
   */
  async prepareContinue(args: { login: string; repo: ClassRepo; classRoot: string }): Promise<{ ok: true; folder: string; downloaded: boolean } | { ok: false; message: string }> {
    const { login, repo } = args;
    try {
      const gh = await this.signedInApi();
      if (!gh || gh.login.toLowerCase() !== login.toLowerCase()) return { ok: false, message: continueFailureMessage("account") };
      const r = await this.bringRepo("continue", gh.api, login, repo, args.classRoot);
      return r.ok ? { ok: true, folder: r.folder, downloaded: r.action !== "open" } : r;
    } catch (err) {
      this.host.log(`[continue] ${login}/${repo.name}: ${err instanceof Error ? err.message : String(err)}`);
      return { ok: false, message: continueFailureMessage(err instanceof GitHubTransportError ? "network" : "unexpected") };
    }
  }

  /**
   * git/gh with an argument vector, and git never asks anyone anything: no terminal prompt, and
   * no password window. Without the empty GIT_ASKPASS, Git for Windows opened its
   * git-askpass.exe dialog on a failed login and the call waited on it until the timeout
   * (measured 2026-10-17). An empty value is "set": git then skips core.askPass and SSH_ASKPASS.
   */
  private readonly exec: Exec = (file, args, opts) =>
    new Promise((resolve) => {
      try {
        const env = { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "", SSH_ASKPASS: "", GCM_INTERACTIVE: "never" };
        execFile(file, args, { timeout: opts.timeout, maxBuffer: 4 * 1024 * 1024, windowsHide: true, env }, (err, stdout, stderr) =>
          resolve({ ok: !err, missing: !!err && (err as { code?: unknown }).code === "ENOENT", stdout: String(stdout ?? ""), stderr: String(stderr ?? "") }),
        );
      } catch {
        resolve({ ok: false, missing: true, stdout: "", stderr: "" });
      }
    });

  /**
   * `<login>/<repo>` on this computer, bound to it so the button publishes there. Its folder is
   * the one its registration names (never `leaving`, the folder a switch leaves: one folder keeps
   * one repository), else `<class folder>-<repo>`. Absent → cloned; present → opened or pulled,
   * as decideTarget says. Real runs go through gh/git (repoCheckout.ts); a loopback mock GitHub
   * (publishConfig.ts) cannot be cloned, so it gets the API download instead.
   */
  private async bringRepo(
    tag: "continue" | "switch",
    api: GitHubApi,
    login: string,
    repo: { name: string; defaultBranch: string },
    classRoot: string,
    leaving?: string,
  ): Promise<{ ok: true; folder: string; action: TargetAction; backup?: string } | { ok: false; message: string }> {
    const reg = this.registry.get(login, repo.name);
    const registered = reg?.workspace && !(leaving && this.host.sameFolder(reg.workspace, leaving)) ? reg.workspace : undefined;
    const head = await remoteHead(api, login, repo.name, repo.defaultBranch);
    const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*$/, "");
    const failed = (what: string, code: Parameters<typeof continueFailureMessage>[0], detail: string) => {
      this.host.log(`[${tag}] ${what} ${login}/${repo.name}: ${code} ${detail}`);
      return { ok: false as const, message: continueFailureMessage(code) };
    };
    let folder: string;
    let present: boolean;
    if (this.host.endpoints.apiBase) {
      present = !!registered && fs.existsSync(registered);
      folder = present ? registered! : cloneFolderFor(classRoot, repo.name);
    } else {
      ({ folder, present } = await locateRepoFolder({ exec: this.exec, login, repo: repo.name, classRoot, ...(registered ? { registered } : {}) }));
    }
    const matchesHead = present && head ? await folderMatches(api, login, repo.name, head, folder) : null;
    const action = decideTarget({ hasFolder: present, head, ...(reg?.lastPushedSha ? { lastPushedSha: reg.lastPushedSha } : {}), matchesHead });
    let backup: string | undefined;
    if (action === "clone") {
      if (!head) {
        // The start page offers "새로 하기" beside this; the switch has no such button.
        if (tag === "switch") return { ok: false, message: `${repo.name}에는 아직 올린 파일이 없어서 가져올 것이 없어요.` };
        return failed("clone", "empty", "no commits");
      }
      if (this.host.endpoints.apiBase) {
        const d = await downloadRepo(api, login, repo.name, repo.defaultBranch, folder);
        if (!d.ok) return failed("clone", d.code, d.detail);
      } else {
        const c = await cloneRepo({ exec: this.exec, gh: await this.auth.bin(), login, repo: repo.name, branch: repo.defaultBranch, folder });
        if (!c.ok) return failed("clone", c.code, c.detail);
      }
    } else if (head) {
      // "pull" replaces the files; keep a copy unless they are exactly what this computer last
      // published or pulled (then nothing of the participant's is lost).
      const matchesLast = action === "pull" && reg?.lastPushedSha ? await folderMatches(api, login, repo.name, reg.lastPushedSha, folder) : null;
      const keepBackup = action === "pull" && matchesLast !== true;
      if (this.host.endpoints.apiBase) {
        if (action === "pull") {
          const p = await pullInto(api, login, repo.name, repo.defaultBranch, folder, { keepBackup, stamp });
          if (!p.ok) return failed("pull", p.code, p.detail);
          backup = p.backup;
        }
      } else {
        const s = await syncClone({
          exec: this.exec, gh: await this.auth.bin(), login, repo: repo.name, branch: repo.defaultBranch, folder,
          replace: action === "pull", ...(keepBackup ? { backup: `${folder}.before-pull-${stamp}` } : {}),
        });
        if (!s.ok) return failed(action, s.code, s.detail);
        backup = s.backup;
      }
    }
    await this.registry.register(login, repo.name, folder);
    if (head) await this.registry.recordPush(login, repo.name, head, folder);
    await this.registry.setLastLogin(login);
    this.host.log(`[${tag}] ${login}/${repo.name}${head ? `@${head.slice(0, 7)}` : ""} ${action} → ${folder}${backup ? ` (backup ${backup})` : ""}`);
    return { ok: true, folder, action, ...(backup ? { backup } : {}) };
  }

  // ── "프로젝트 변경" (command, or the chat sentence) ───────────────────────────

  /**
   * List the participant's repositories, leave the current folder's work on its own repository
   * (asked), and bring the picked one into its own folder: cloned, pulled, or opened as it is.
   * Returns the folder to open, or undefined when the participant stopped or something failed
   * (they were told why). Opening the folder is the caller's: it reloads the window.
   */
  async switchProject(classRoot: string | undefined): Promise<{ folder: string; repo: string; action: TargetAction; backup?: string } | undefined> {
    if (!this.available()) {
      this.host.notice(publishError("not_allowed").message_ko);
      return;
    }
    if (!this.host.idle()) {
      this.host.notice("코치가 답하는 중이에요. 답이 끝난 뒤 다시 해 주세요.");
      return;
    }
    if (this.running) {
      this.host.notice("홈페이지를 올리는 중이에요. 끝난 뒤 다시 해 주세요.");
      return;
    }
    const gate = pressAccess(await this.host.checkAccess());
    if (!gate.ok) {
      if (gate.refreshProfile) await this.host.refreshProfile().catch(() => undefined);
      this.host.notice(publishError(gate.code).message_ko);
      return;
    }
    const workspace = this.host.workspaceRoot();
    const folder = classFolderCheck({ workspaceRoot: workspace, classFolder: this.host.classFolder(), same: (a, b) => this.host.sameFolder(a, b) });
    if (!folder.ok || !workspace || !classRoot) {
      this.host.notice("수업 폴더를 연 상태에서만 프로젝트를 바꿀 수 있어요.");
      return;
    }

    let gh: { api: GitHubApi; login: string } | null;
    try {
      gh = await this.signedInApi();
      if (!gh && (await this.signInForContinue())) gh = await this.signedInApi();
    } catch (err) {
      this.host.log(`[switch] sign-in: ${err instanceof Error ? err.message : String(err)}`);
      gh = null;
    }
    if (!gh) {
      this.host.notice("GitHub에 로그인하지 못해 프로젝트 목록을 불러오지 않았어요.");
      return;
    }
    const { api, login } = gh;
    const listed = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "GitHub에서 프로젝트 목록을 불러오는 중" }, () =>
      listSwitchTargets(api, login).catch((err): { ok: false; detail: string } => ({ ok: false, detail: err instanceof Error ? err.message : String(err) })),
    );
    if (!listed.ok) {
      this.host.log(`[switch] list: ${listed.detail}`);
      this.host.notice("GitHub에서 프로젝트 목록을 불러오지 못했어요. 잠시 뒤 다시 해 주세요.");
      return;
    }
    const current = this.registry.boundRepo(login, workspace, (a, b) => this.host.sameFolder(a, b));
    const target = await this.pickSwitchTarget(listed.targets, current);
    if (!target) return;
    if (current && target.name.toLowerCase() === current.toLowerCase()) {
      this.host.notice(`이미 ${target.name} 프로젝트에서 작업하고 있어요.`);
      return;
    }
    if (!target.classSite) {
      const go = await vscode.window.showWarningMessage(
        `${target.name}에서 이어서 작업할까요?`,
        { modal: true, detail: "Studio에서 만든 홈페이지가 아닐 수 있어요. 이 저장소에서 올리면 그 안의 파일이 지금 작업으로 바뀌어요." },
        "이어서 작업",
      );
      if (go !== "이어서 작업") return;
    }

    const currentRepo = current ? listed.targets.find((t) => t.name.toLowerCase() === current.toLowerCase()) : undefined;
    if (!(await this.leaveCurrentWork(api, login, workspace, current, currentRepo?.defaultBranch))) return;

    const prepared = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: `${target.name} 가져오는 중` }, () =>
      this.prepareSwitchTarget(api, login, target, workspace, classRoot),
    );
    if (!prepared.ok) {
      this.host.notice(prepared.message);
      return;
    }
    return { folder: prepared.folder, repo: target.name, action: prepared.action, ...(prepared.backup ? { backup: prepared.backup } : {}) };
  }

  private async pickSwitchTarget(targets: SwitchTarget[], current: string | undefined): Promise<SwitchTarget | undefined> {
    if (!targets.length) {
      this.host.notice("GitHub에 바꿀 수 있는 프로젝트가 없어요. 먼저 홈페이지를 한 번 올려 주세요.");
      return;
    }
    type Item = vscode.QuickPickItem & { target?: SwitchTarget };
    const when = (iso: string) => (iso ? new Date(iso).toLocaleString("ko-KR", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "올린 적 없음");
    const row = (t: SwitchTarget): Item => ({
      label: t.name,
      description: current && t.name.toLowerCase() === current.toLowerCase() ? "지금 작업 중" : undefined,
      detail: `마지막으로 올린 때: ${when(t.pushedAt)} · ${t.htmlUrl}`,
      target: t,
    });
    const classes = targets.filter((t) => t.classSite);
    const others = targets.filter((t) => !t.classSite);
    const items: Item[] = [
      ...(classes.length ? [{ label: "수업 홈페이지", kind: vscode.QuickPickItemKind.Separator } as Item, ...classes.map(row)] : []),
      ...(others.length ? [{ label: "다른 저장소", kind: vscode.QuickPickItemKind.Separator } as Item, ...others.map(row)] : []),
    ];
    const pick = await vscode.window.showQuickPick(items, { title: "프로젝트 변경", placeHolder: "이어서 작업할 프로젝트(GitHub 저장소)를 고르세요", matchOnDetail: true });
    return pick?.target;
  }

  /**
   * Before leaving: the current folder's work goes to its own repository if the participant says
   * so — the same publish as the button, so a published site keeps its workflow. Nothing is asked
   * when the folder already equals its repository. False means stop the switch.
   */
  private async leaveCurrentWork(api: GitHubApi, login: string, workspace: string, current: string | undefined, branch: string | undefined): Promise<boolean> {
    const UPLOAD = current ? "올리고 바꾸기" : "새 저장소로 올리고 바꾸기";
    const SKIP = "올리지 않고 바꾸기";
    if (current) {
      const head = await remoteHead(api, login, current, branch ?? "main").catch(() => null);
      const same = head ? await folderMatches(api, login, current, head, workspace).catch(() => null) : null;
      if (same === true) return true;
    } else if (localFiles(workspace).size === 0) {
      return true;
    }
    const choice = await vscode.window.showWarningMessage(
      current ? `지금까지 한 작업을 ${current}에 올리고 바꿀까요?` : "이 폴더는 아직 GitHub에 올린 적이 없어요. 올리고 바꿀까요?",
      {
        modal: true,
        detail: current
          ? "올리면 그 저장소의 인터넷 주소에도 지금 내용이 반영돼요. 올리지 않아도 이 컴퓨터의 폴더는 그대로 남아요."
          : "올리면 새 저장소가 생기고, 나중에 '프로젝트 변경'으로 이 작업에 돌아올 수 있어요. 올리지 않으면 이 폴더는 이 컴퓨터에만 남아요.",
      },
      UPLOAD,
      SKIP,
    );
    if (!choice) return false;
    if (choice === SKIP) return true;
    const result = await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "지금 작업 올리기", cancellable: false }, (progress) =>
      this.run({}, "button", (line) => progress.report({ message: line })),
    );
    await this.host.postToChat(resultChatText(result)).catch(() => undefined);
    if (result.ok) return true;
    const go = await vscode.window.showWarningMessage(
      result.error?.message_ko ?? "지금 작업을 올리지 못했어요.",
      { modal: true, detail: "그래도 프로젝트를 바꿀까요? 지금 폴더는 이 컴퓨터에 그대로 남아요." },
      "그래도 바꾸기",
    );
    return go === "그래도 바꾸기";
  }

  /**
   * The picked repository's folder on this computer, bound to it so the button publishes there.
   * Its own folder is the one its registration names — never the folder being left, so one folder
   * keeps one repository.
   */
  private async prepareSwitchTarget(
    api: GitHubApi,
    login: string,
    target: SwitchTarget,
    leaving: string,
    classRoot: string,
  ): Promise<{ ok: true; folder: string; action: TargetAction; backup?: string } | { ok: false; message: string }> {
    try {
      return await this.bringRepo("switch", api, login, target, classRoot, leaving);
    } catch (err) {
      this.host.log(`[switch] ${login}/${target.name}: ${err instanceof Error ? err.message : String(err)}`);
      return { ok: false, message: continueFailureMessage(err instanceof GitHubTransportError ? "network" : "unexpected") };
    }
  }

  /** Coach tool entry. Consent was already asked by canUseTool (or skipped for check_only). */
  async runForTool(input: PublishSiteInput): Promise<McpToolResult> {
    const r = await this.run(input, "tool");
    return { content: [{ type: "text", text: JSON.stringify(r) }], ...(r.error ? { isError: true } : {}) };
  }

  /** Toolbar command entry. */
  async runFromButton(): Promise<void> {
    if (!this.available()) {
      this.host.notice(publishError("not_allowed").message_ko);
      return;
    }
    if (!this.host.idle()) {
      this.host.notice("코치가 답하는 중이에요. 답이 끝난 뒤 다시 눌러 주세요.");
      return;
    }
    // No question here: sign-in comes first, then the pipeline's confirmPublish asks once per
    // <login>/<repo> (persisted) — a registered repository publishes with no modal at all.
    const result = await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "홈페이지 올리기", cancellable: false },
      (progress) => this.run({}, "button", (line) => progress.report({ message: line })),
    );
    await this.host.postToChat(resultChatText(result)).catch(() => undefined);
    await this.showResult(result);
  }

  private async showDeviceCode(code: string, uri: string): Promise<void> {
    const COPY_OPEN = "코드 복사하고 GitHub 열기";
    const pick = await vscode.window.showInformationMessage(
      `GitHub 코드: ${code}`,
      { modal: true, detail: `브라우저에서 이 여덟 글자를 입력하고 초록색 Authorize 버튼을 눌러 주세요.\n${uri}` },
      COPY_OPEN,
    );
    if (pick === COPY_OPEN) {
      await vscode.env.clipboard.writeText(code);
      await vscode.env.openExternal(vscode.Uri.parse(uri));
    }
  }

  private async showResult(r: PublishSiteResult): Promise<void> {
    const OPEN = "열기";
    const COPY = "주소 복사";
    if (r.verified && r.url) {
      // The marker counts come from preflight (code), never from the coach (D24).
      const markers = markerSummary(r.markers);
      const pick = await vscode.window.showInformationMessage(`인터넷 주소가 열리는 것을 확인했어요: ${r.url}${markers ? ` · ${markers}` : ""}`, OPEN, COPY);
      if (pick === OPEN) await vscode.env.openExternal(vscode.Uri.parse(r.url));
      if (pick === COPY) await vscode.env.clipboard.writeText(r.url);
      return;
    }
    const REPO = "저장소 열기";
    const text = r.error
      ? `${r.error.message_ko} ${r.error.next_action_ko}`
      : r.needs_user
        ? `GitHub 코드 ${r.needs_user.code} 입력이 끝나지 않았어요. 다시 눌러 주세요.`
        : "아직 주소가 열리는 것을 확인하지 못했어요. 1~2분 뒤 다시 눌러 확인해 주세요.";
    const pick = await vscode.window.showWarningMessage(text, ...(r.repo_url ? [REPO] : []));
    if (pick === REPO && r.repo_url) await vscode.env.openExternal(vscode.Uri.parse(r.repo_url));
  }
}
