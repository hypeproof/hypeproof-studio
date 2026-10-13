// "배포 등록" — the one-time, persisted consent behind frictionless publishes.
//
// User requirement (2026-10-13): once GitHub login works, pressing Studio's button deploys all
// the way, and after registering once every press pushes to main with no further question.
// So the consent that used to be session-scoped is now a REGISTRATION: given once per
// (GitHub login, repository), stored in the extension's globalState (it survives restarts and
// app updates), and revocable with the "배포 등록 해제" command.
//
// Why keyed by login AND repository: the thing consented to is "this account's public
// repository receives my workspace". A second repository, or the same name under another
// GitHub account on a shared classroom Mac, is a different act and asks again.
//
// A registration answers "may we skip the question", never "may this seat publish". That one
// is the token gate (user decision 2026-10-13, publishContract.ts `pressAccess`): only people
// holding a token HypeProof issued see the button, and the Service decides per cohort. A
// registration on its own neither shows the button nor lets a press through.
//
// Pure apart from the injected store (structurally `vscode.Memento`), so the smoke tests use a
// Map-backed fake.

export interface RegistryStore {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): Thenable<void> | Promise<void>;
}

export interface Registration {
  login: string;
  repo: string;
  /** Epoch ms of the consent. */
  at: number;
  /** The workspace folder the registration was made from (a record only; access never reads it). */
  workspace?: string;
  /**
   * The commit our last successful push created (D18 ⑤). Before the next push the remote head
   * must still be exactly this; anything else means someone changed the repository outside
   * Studio (the pencil on github.com, the coach's shell path) and we stop instead of
   * overwriting it.
   */
  lastPushedSha?: string;
}

export const REGISTRY_KEY = "hps.publish.registrations.v1";
/** The last GitHub login a publish ran as — lets the tool path recognize a registration before it authenticates. */
export const LAST_LOGIN_KEY = "hps.publish.lastLogin.v1";

const keyOf = (login: string, repo: string) => `${login.toLowerCase()}/${repo.toLowerCase()}`;

export class PublishRegistry {
  private readonly store: RegistryStore;
  private readonly now: () => number;

  constructor(store: RegistryStore, now: () => number = () => Date.now()) {
    this.store = store;
    this.now = now;
  }

  private all(): Record<string, Registration> {
    const v = this.store.get<Record<string, Registration>>(REGISTRY_KEY);
    return v && typeof v === "object" ? v : {};
  }

  isRegistered(login: string, repo: string): boolean {
    if (!login || !repo) return false;
    return Object.prototype.hasOwnProperty.call(this.all(), keyOf(login, repo));
  }

  get(login: string, repo: string): Registration | undefined {
    return this.all()[keyOf(login, repo)];
  }

  async register(login: string, repo: string, workspace?: string): Promise<void> {
    if (!login || !repo) return;
    await this.store.update(REGISTRY_KEY, { ...this.all(), [keyOf(login, repo)]: { login, repo, at: this.now(), ...(workspace ? { workspace } : {}) } });
  }

  /** Record the commit a successful push created (only for an existing registration). */
  async recordPush(login: string, repo: string, sha: string, workspace?: string): Promise<void> {
    const current = this.all();
    const k = keyOf(login, repo);
    const reg = current[k];
    if (!reg) return;
    await this.store.update(REGISTRY_KEY, { ...current, [k]: { ...reg, lastPushedSha: sha, ...(workspace ? { workspace } : {}) } });
  }

  list(): Registration[] {
    return Object.values(this.all()).sort((a, b) => a.at - b.at);
  }

  /**
   * The repository `workspace` publishes to under `login`: the latest registration made from that
   * folder (a publish, or "GitHub에서 이어하기" bringing the repository down into it). Undefined
   * means the folder never published from this computer, and its first publish makes a new
   * repository instead of writing into one made elsewhere (githubContinue.ts firstFreeRepoName).
   */
  boundRepo(login: string, workspace: string | undefined, same: (a: string, b: string) => boolean): string | undefined {
    if (!login || !workspace) return undefined;
    const mine = this.list().filter((r) => r.login.toLowerCase() === login.toLowerCase() && !!r.workspace && same(r.workspace, workspace));
    return mine.length ? mine[mine.length - 1].repo : undefined;
  }

  /** Remove one registration (login + repo), or every one when called without arguments. Returns how many were removed. */
  async unregister(login?: string, repo?: string): Promise<number> {
    const current = this.all();
    if (login === undefined || repo === undefined) {
      const n = Object.keys(current).length;
      await this.store.update(REGISTRY_KEY, {});
      return n;
    }
    const k = keyOf(login, repo);
    if (!(k in current)) return 0;
    const { [k]: _removed, ...rest } = current;
    await this.store.update(REGISTRY_KEY, rest);
    return 1;
  }

  lastLogin(): string | undefined {
    const v = this.store.get<string>(LAST_LOGIN_KEY);
    return typeof v === "string" && v ? v : undefined;
  }

  async setLastLogin(login: string): Promise<void> {
    if (login && login !== this.lastLogin()) await this.store.update(LAST_LOGIN_KEY, login);
  }
}

/** The consent sentence, one place for button and tool (requirement wording). */
export function registrationPrompt(login: string, repo: string): { title: string; detail: string } {
  return {
    title: `이 저장소(${login}/${repo})에 홈페이지를 공개합니다 — 이후 버튼을 누르면 확인 없이 바로 올라갑니다`,
    detail:
      "GitHub 공개 저장소에 올라가서 누구나 볼 수 있어요(agent.md 포함).\n" +
      "환자 정보·직원 연락처·비밀번호가 없는지 확인해 주세요.\n" +
      "등록을 풀려면 명령 \"HypeProof: 배포 등록 해제\"를 쓰세요.",
  };
}

/**
 * The consent decision once the signed-in login is known.
 *   no profile → refuse, registered or not: the token gate comes first (2026-10-13);
 *   registered → go, no question (the point of registering);
 *   tool already approved in canUseTool → register and go;
 *   otherwise → ask (and register on yes).
 */
export function consentDecision(args: { registered: boolean; profileAllowed: boolean; toolApproved: boolean }): "go" | "not_allowed" | "register" | "ask" {
  if (!args.profileAllowed) return "not_allowed";
  if (args.registered) return "go";
  if (args.toolApproved) return "register";
  return "ask";
}
