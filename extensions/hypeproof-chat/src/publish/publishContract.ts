// One-click publish to GitHub Pages: the contract shared by both entry points.
//
// Two callers run the SAME pipeline (decision D3, hype-dental batch-1): the toolbar command
// `hypeproof-chat.publishSite` and the coach's in-process MCP tool `publish_site`
// (`mcp__hypeproof__publish_site`). The Service skill `publish-homepage.md` is written against
// the input/output shapes below, so they are a wire contract: field names, step ids and error
// codes are only ever ADDED to, never renamed. Renaming one silently breaks a coach prompt that
// lives in another repository and ships on another schedule.
//
// Pure: no `vscode`, no Node APIs. Loaded under `node --experimental-strip-types` by the smoke
// tests, hence the explicit `.ts` specifiers elsewhere in this folder.

/** Full tool name as the model and canUseTool see it (server `hypeproof`, tool `publish_site`). */
export const MCP_PUBLISH_SITE = "mcp__hypeproof__publish_site";
/** Short name registered on the in-process server. */
export const PUBLISH_SITE_TOOL_NAME = "publish_site";

/** The profile value that turns this feature on (and the only one that does). */
export const PUBLISH_STRATEGY = "per_user_github_pages";

/**
 * Fallback repository name when the served profile carries no `default_repo_name`
 * (an older Service) and the caller passed none. D1 ②: the class proceeds with this name
 * when the participant does not answer the slug proposal within a turn.
 */
export const FALLBACK_REPO_NAME = "dental-homepage";

/** Tool input. Every field is optional so "인터넷 주소로 만들어 주세요" maps to `{}`. */
export interface PublishSiteInput {
  repo_name?: string;
  custom_domain?: string;
  check_only?: boolean;
  /**
   * D-017 (D8): the class uses two sentences. ① "제 GitHub 보관함에 올려 주세요" → `"save"`:
   * repository + files only, Pages stays OFF, so the participant can open the planned URL and
   * see the 404 that makes "saved is not published" visible. ② "인터넷 주소로 만들어 주세요" →
   * `"publish"` (the default, and what the toolbar button uses): saves first if needed, then
   * Pages + Actions + verification.
   */
  stage?: PublishStage;
}

export type PublishStage = "save" | "publish";

/**
 * Stable step ids, in pipeline order. The coach skill and the UI both key on these, so the
 * order of the array is also the order the progress UI shows them.
 */
export const STEP_IDS = ["preflight", "auth", "repo", "pages", "commit", "build", "verify", "domain"] as const;
export type StepId = (typeof STEP_IDS)[number];
export type StepStatus = "ok" | "warning" | "failed" | "skipped" | "needs_user" | "pending";

export interface PublishStep {
  id: StepId;
  status: StepStatus;
  detail_ko: string;
}

/** DNS record the participant (or the clinic's domain vendor) must create. We never touch DNS. */
export interface DnsRecord {
  type: "A" | "AAAA" | "CNAME";
  host: string;
  value: string;
}

export type DomainState = "dns_pending" | "cert_pending" | "https_enforced";

/**
 * Stable error codes. `message_ko` says what happened, `next_action_ko` what the participant
 * (or coach) does next — the coach relays them instead of inventing a diagnosis.
 */
export type PublishErrorCode =
  | "not_allowed"
  | "token_rejected"
  | "service_unreachable"
  | "not_class_folder"
  | "no_workspace"
  | "busy"
  | "declined"
  | "preflight_blocked"
  | "gh_missing"
  | "not_logged_in"
  | "missing_scope"
  | "auth_timeout"
  | "invalid_repo_name"
  | "repo_name_taken"
  | "email_unverified"
  | "repo_archived"
  | "pages_unavailable"
  | "pages_not_ready"
  | "commit_failed"
  | "actions_failed"
  | "domain_not_ready"
  | "remote_changed"
  | "verify_timeout"
  | "rate_limited"
  | "network"
  | "invalid_domain"
  | "unexpected";

export interface PublishError {
  code: PublishErrorCode;
  message_ko: string;
  next_action_ko: string;
}

/** Tool output (also the button's result). See the module header on stability. */
export interface PublishSiteResult {
  /**
   * false ⇔ something stopped the run (`error` set) or a person must act (`needs_user` set).
   * `ok: true, verified: false` means "nothing failed, the site is not confirmed yet" — still
   * building inside this call's time budget, a save stage, or a domain whose DNS is pending.
   * The Service skill reads exactly this pair as "아직 만들어지는 중" and re-checks with
   * `check_only` later, so a budget running out is deliberately NOT an error.
   */
  ok: boolean;
  /**
   * R0 — true ONLY after the live site served the nonce this run committed (or, for
   * `check_only`, the nonce the repository holds). Never inferred from an API status.
   */
  verified: boolean;
  /** Present only when `verified` is true: a URL the tool has not seen working is never returned. */
  url?: string;
  repo_url?: string;
  repo_name: string;
  /**
   * `https://<login>.github.io/<slug>/` — where the site WILL be. Returned whenever the login is
   * known, deliberately separate from `url`: the save stage and `check_only` need to show an
   * address that does not work yet (the 404 step) without ever putting it in the field that
   * means "verified working".
   */
  planned_url?: string;
  /**
   * `<!-- 여기고치기: <label> -->` counts found by preflight (D24), only labels present. Counted
   * by code so the participant's next-day instructions never quote a number the coach guessed.
   */
  markers?: Array<{ label: string; count: number }>;
  steps: PublishStep[];
  needs_user?: { kind: "device_code"; code: string; verification_uri: string };
  domain?: { name: string; state: DomainState; dns_records: DnsRecord[] };
  error?: PublishError;
}

// ── Gate ─────────────────────────────────────────────────────────────────────

export const SITE_PUBLISH_NOT_ALLOWED = "이 수업에서는 홈페이지를 인터넷에 올리는 기능을 쓰지 않아요.";

/**
 * May this seat publish to GitHub Pages? The served profile owns the answer, in the same
 * shape and direction as `galleryPublishAllowed` (galleryPublish.ts): no profile is not
 * permission, `enabled` must be literally `true`, and the strategy must name this path.
 *
 * `minor` is computed by the caller (isMinorTier / `minor_cohort`) because those helpers live
 * in sdkCoachHelpers.ts, which imports this module — passing the boolean keeps the import
 * graph acyclic. Minors are refused even if a profile mistakenly enables publishing: a public
 * repository under a child's account is exactly the outward act the minor-safety posture
 * (#306/#318) keeps closed, and the Service harness is not the only lock we want.
 */
export function sitePublishAllowed(
  publishing: { enabled?: unknown; strategy?: unknown } | null | undefined,
  minor: boolean,
): { ok: true } | { ok: false; message: string } {
  if (!publishing) return { ok: false, message: SITE_PUBLISH_NOT_ALLOWED };
  if (publishing.enabled !== true) return { ok: false, message: SITE_PUBLISH_NOT_ALLOWED };
  if (publishing.strategy !== PUBLISH_STRATEGY) return { ok: false, message: SITE_PUBLISH_NOT_ALLOWED };
  if (minor) return { ok: false, message: SITE_PUBLISH_NOT_ALLOWED };
  return { ok: true };
}

/**
 * What the Service said, at the moment of a press, about the token stored in this seat.
 * `profile` carries the fresh profile's publishing block; the other kinds carry no profile.
 */
export type AccessCheck =
  | { kind: "no_token" }
  | { kind: "profile"; publishing: { enabled?: unknown; strategy?: unknown } | null | undefined; minor: boolean }
  | { kind: "failure"; reason: string };

/**
 * The token gate, checked on every press (user decision 2026-10-13): publishing is only for
 * people holding a token HypeProof issued, and the Service decides per cohort through the
 * served profile. The cached profile is not enough on its own — an app left open past the
 * token's expiry still holds it — so each press asks the Service again.
 *
 * `refreshProfile` asks the caller to re-read the profile so the button disappears now: the
 * Service refused the token, or its fresh profile no longer allows publishing. A network
 * failure keeps the cached profile (a dropped connection is not a revoked token) but still
 * publishes nothing.
 */
export function pressAccess(check: AccessCheck):
  | { ok: true }
  | { ok: false; code: "not_allowed" | "token_rejected" | "service_unreachable"; refreshProfile: boolean } {
  if (check.kind === "no_token") return { ok: false, code: "token_rejected", refreshProfile: true };
  if (check.kind === "failure") {
    return check.reason === "network"
      ? { ok: false, code: "service_unreachable", refreshProfile: false }
      : { ok: false, code: "token_rejected", refreshProfile: true };
  }
  return sitePublishAllowed(check.publishing, check.minor).ok ? { ok: true } : { ok: false, code: "not_allowed", refreshProfile: true };
}

/**
 * Publishing uploads one folder, whole: the class folder (user decision 2026-10-13, "수업 폴더에
 * 있는 파일만"). The open folder can be anything — in the hands-on run a participant's window
 * ended up on ~/Desktop — so a press from any other folder is refused before sign-in.
 * `classFolder` is the activity's folder, else the profile's workspace_root; when neither is
 * known the class folder is unknown and nothing is published.
 */
export function classFolderCheck(args: {
  workspaceRoot: string | undefined;
  classFolder: string | undefined;
  same: (a: string, b: string) => boolean;
}): { ok: true } | { ok: false; code: "no_workspace" | "not_class_folder" } {
  if (!args.workspaceRoot) return { ok: false, code: "no_workspace" };
  if (!args.classFolder || !args.same(args.workspaceRoot, args.classFolder)) return { ok: false, code: "not_class_folder" };
  return { ok: true };
}

// ── Repository name (D1 ①) ──────────────────────────────────────────────────

/**
 * Lowercase kebab slug, ≤ 30 chars. Narrower than what GitHub accepts on purpose: the name is
 * the URL path the clinic prints on flyers (`<login>.github.io/<slug>/`), and GitHub would
 * accept `Boa.Dental_` and then serve it case-sensitively — the exact class of "works when I
 * type it, 404 when a patient types it" this feature exists to remove.
 */
export const REPO_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const REPO_NAME_MAX = 30;

export function validateRepoName(name: string): { ok: true } | { ok: false; message: string } {
  if (!name) return { ok: false, message: "저장소 이름이 비어 있어요." };
  if (name.length > REPO_NAME_MAX) return { ok: false, message: `저장소 이름은 ${REPO_NAME_MAX}자까지 쓸 수 있어요.` };
  if (!REPO_NAME_PATTERN.test(name)) {
    return { ok: false, message: "저장소 이름은 영어 소문자·숫자·하이픈(-)만 쓸 수 있어요. 예: boa-dental" };
  }
  return { ok: true };
}

/**
 * The name to publish under: explicit input first, then the profile's default, then the fixed
 * fallback. A malformed profile default is NOT silently repaired — it falls through to the
 * fallback, because "fixing" it (lowercasing, stripping) would publish under a name nobody chose.
 */
export function resolveRepoName(input: string | undefined, profileDefault: string | undefined): string {
  const explicit = (input ?? "").trim();
  if (explicit) return explicit;
  const fromProfile = (profileDefault ?? "").trim();
  if (fromProfile && validateRepoName(fromProfile).ok) return fromProfile;
  return FALLBACK_REPO_NAME;
}

// ── Custom domain ────────────────────────────────────────────────────────────

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * Normalize a participant-typed domain ("https://www.Boa-Dental.co.kr/" → "www.boa-dental.co.kr")
 * or refuse it. Scheme and a trailing slash are forgiven because that is how people copy a
 * domain out of a browser; a path, port, IP literal, wildcard or a `github.io` name is refused
 * because none of them can be a Pages custom domain.
 */
export function normalizeCustomDomain(raw: string): { ok: true; domain: string } | { ok: false; message: string } {
  let v = raw.trim().toLowerCase();
  v = v.replace(/^[a-z]+:\/\//, "").replace(/\/+$/, "");
  const bad = { ok: false as const, message: "도메인 모양이 아니에요. 예: www.boadental.co.kr" };
  if (!v || v.includes("/") || v.includes(":") || v.includes("*") || v.length > 253) return bad;
  const labels = v.split(".");
  if (labels.length < 2 || !labels.every((l) => LABEL.test(l))) return bad;
  if (/^\d+$/.test(labels[labels.length - 1]!)) return bad;
  if (v === "github.io" || v.endsWith(".github.io")) {
    return { ok: false, message: "github.io 주소는 따로 연결할 필요가 없어요. 원래 쓰시는 병원 도메인을 알려 주세요." };
  }
  return { ok: true, domain: v };
}

// ── Result helpers ───────────────────────────────────────────────────────────

/** Korean copy for each error code: one place, so the button and the tool say the same thing. */
export const ERROR_COPY: Record<PublishErrorCode, { message_ko: string; next_action_ko: string }> = {
  not_allowed: { message_ko: SITE_PUBLISH_NOT_ALLOWED, next_action_ko: "강사에게 알려 주세요." },
  token_rejected: {
    message_ko: "참여 코드가 만료되었거나 확인되지 않아 '인터넷에 올리기'를 쓸 수 없어요. 아무것도 올리지 않았어요.",
    next_action_ko: "코드 발급 담당자에게 새 코드를 요청해 주세요.",
  },
  service_unreachable: {
    message_ko: "참여 코드를 확인하지 못해 올리지 않았어요.",
    next_action_ko: "인터넷 연결을 확인한 뒤 다시 눌러 주세요.",
  },
  // The host names both folders in message_ko (publishHost.ts); this is the fallback.
  not_class_folder: {
    message_ko: "수업 폴더에서만 올릴 수 있어요. 지금 열린 폴더는 올리지 않았어요.",
    next_action_ko: "시작 화면에서 '이어서 하기'를 누르면 수업 폴더가 다시 열려요. 그다음 다시 눌러 주세요.",
  },
  no_workspace: { message_ko: "올릴 작업 폴더가 열려 있지 않아요.", next_action_ko: "홈페이지 폴더를 연 뒤에 다시 해 주세요." },
  busy: { message_ko: "이미 올리는 중이에요.", next_action_ko: "지금 진행 중인 작업이 끝난 뒤 다시 해 주세요." },
  declined: { message_ko: "공개하지 않았어요.", next_action_ko: "공개하려면 다시 요청해 주세요." },
  preflight_blocked: { message_ko: "올리기 전에 고쳐야 할 곳이 있어요.", next_action_ko: "아래 목록을 고친 뒤 다시 해 주세요." },
  gh_missing: {
    message_ko: "GitHub 연결 도구(gh)가 이 컴퓨터에 설치되어 있지 않아요.",
    next_action_ko: "설치 안내에 따라 GitHub CLI(gh)를 설치한 뒤 Studio를 다시 열어 주세요.",
  },
  not_logged_in: { message_ko: "GitHub에 로그인되어 있지 않아요.", next_action_ko: "화면의 여덟 글자 코드로 GitHub 로그인을 마쳐 주세요." },
  missing_scope: {
    message_ko: "GitHub 권한이 부족해요(저장소·워크플로 권한이 필요해요).",
    next_action_ko: "화면의 여덟 글자 코드로 권한을 허락한 뒤 다시 해 주세요.",
  },
  auth_timeout: { message_ko: "GitHub 코드 입력이 끝나지 않았어요.", next_action_ko: "다시 누르면 새 코드를 받을 수 있어요." },
  invalid_repo_name: { message_ko: "저장소 이름을 쓸 수 없어요.", next_action_ko: "영어 소문자·숫자·하이픈(-)으로 30자 안에서 정해 주세요." },
  repo_name_taken: {
    message_ko: "이 이름은 이미 다른 곳에서 쓰고 있어요.",
    next_action_ko: "다른 저장소 이름으로 다시 해 주세요. 예: 병원이름-dental",
  },
  email_unverified: {
    message_ko: "GitHub 이메일 인증이 끝나지 않아 저장소를 만들 수 없어요.",
    next_action_ko: "메일함에서 GitHub 확인 메일의 버튼을 누른 뒤 다시 해 주세요.",
  },
  repo_archived: { message_ko: "이 저장소는 보관(archive) 상태라 올릴 수 없어요.", next_action_ko: "다른 이름으로 다시 해 주세요." },
  pages_unavailable: {
    message_ko: "이 저장소에서 GitHub Pages를 켤 수 없어요.",
    next_action_ko: "저장소가 공개(Public)인지 확인해 주세요. 계속 안 되면 강사와 함께 Settings ▸ Pages를 열어 봐요.",
  },
  pages_not_ready: {
    message_ko: "GitHub Pages 준비가 끝나지 않았어요.",
    next_action_ko: "1~2분 뒤에 다시 해 주세요. 계속 안 되면 강사와 함께 Settings ▸ Pages를 열어 봐요.",
  },
  commit_failed: { message_ko: "파일을 저장소에 올리지 못했어요.", next_action_ko: "잠시 뒤 다시 해 주세요." },
  actions_failed: { message_ko: "GitHub에서 사이트를 만드는 작업이 실패했어요.", next_action_ko: "실패 기록 링크를 강사에게 보여 주세요." },
  // Can be read after class while the token is still valid, when no assistant is around, so
  // the message names both situations and the at-home action (photo → reply address).
  remote_changed: {
    message_ko: "GitHub에서 직접 고친 내용이 있어 덮어쓰지 않았어요. 수업 중이면 보조강사에게, 수업 뒤라면 이 화면을 찍어 회신 주소로 보내 주세요.",
    // Shown right after message_ko in the same toast, so it adds what to NOT do rather than
    // repeating whom to tell: pressing again would only stop again.
    next_action_ko: "GitHub에 있는 내용은 그대로예요. 버튼을 다시 누르지 말고 안내를 기다려 주세요.",
  },

  domain_not_ready: {
    message_ko: "도메인 연결(DNS)이 아직 끝나지 않아 새 버전이 열리는지 확인하지 못했어요.",
    next_action_ko: "도메인 업체에서 DNS 등록을 마친 뒤 \"도메인 확인해줘\"라고 말씀해 주세요.",
  },
  verify_timeout: {
    message_ko: "10분을 기다렸지만 새 사이트가 열리는 것을 확인하지 못했어요.",
    next_action_ko: "조금 뒤에 \"확인해줘\"라고 말씀해 주시면 다시 확인할게요.",
  },
  rate_limited: { message_ko: "GitHub 요청 한도에 걸렸어요.", next_action_ko: "몇 분 뒤에 다시 해 주세요." },
  network: { message_ko: "GitHub에 연결하지 못했어요.", next_action_ko: "인터넷 연결을 확인한 뒤 다시 해 주세요." },
  invalid_domain: { message_ko: "도메인 모양이 아니에요.", next_action_ko: "예: www.boadental.co.kr 처럼 알려 주세요." },
  unexpected: { message_ko: "예상하지 못한 문제가 생겼어요.", next_action_ko: "강사에게 알려 주세요. 파일은 작업 폴더에 그대로 있어요." },
};

export function publishError(code: PublishErrorCode, override?: Partial<PublishError>): PublishError {
  return { code, ...ERROR_COPY[code], ...(override ?? {}) };
}

/** Korean labels for the progress UI, one per step id. */
export const STEP_LABEL_KO: Record<StepId, string> = {
  preflight: "올리기 전 검사",
  auth: "GitHub 로그인 확인",
  repo: "저장소 준비",
  pages: "GitHub Pages 켜기",
  commit: "파일 올리기",
  build: "사이트 만드는 중",
  verify: "주소가 열리는지 확인",
  domain: "도메인 연결",
};
