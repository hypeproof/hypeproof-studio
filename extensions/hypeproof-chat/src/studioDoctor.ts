// REQ-STUDIO-DOCTOR (Jay 2026-11-03) — Studio 진단: a fast, deterministic health check of this computer's Studio setup.
// Pure: no vscode import, so test/studio-doctor.smoke.mjs runs it under plain Node. The host side (probes, fixes,
// the quiet chat line, the support command) is studioDoctorHost.ts.
//
// Zero model calls: every check is local host code plus one GET {proxy}/health and one GET {proxy}/profile, so the
// doctor still works when the AI path itself is broken or the learner's allowance is gone.
//
// What leaves the machine is codes only: a failing check becomes one content-free automatic problem signal
// (`doctor_<code>`, through the existing level-1 path and its switch) and, inside a report the learner submits,
// `attachments.doctor` = {v, duration_ms, checks: [{id, status, code}]}. Never a path, folder name, env value or token.

import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

export const DOCTOR_CHECK_IDS = ["sdk", "service", "login", "workfolder", "disk"] as const;
export type DoctorCheckId = (typeof DOCTOR_CHECK_IDS)[number];
export type DoctorStatus = "ok" | "warn" | "fail" | "skip";
/**
 * The only one-click fixes. Each reuses an action Studio already has, and none changes an OS security setting:
 * reseed_sdk = the REQ-M46 on-demand seed (its own confirm modal, pinned hash) or the install page;
 * reconnect = re-read the profile (refused during a run); mac_privacy = open System Settings › Files and Folders;
 * open_folder = show the work folder in Finder/Explorer.
 */
export type DoctorFixId = "reseed_sdk" | "reconnect" | "mac_privacy" | "open_folder";

export interface DoctorCheck { id: DoctorCheckId; status: DoctorStatus; code: string; fix?: DoctorFixId }
export interface DoctorResult { checks: DoctorCheck[]; duration_ms: number }

const CODE_RE = /^[a-z][a-z0-9_]{0,40}$/;

// ── Classifiers: facts in, one check out ─────────────────────────────────

export interface SdkFacts {
  /** resolveSdkBinary's answer. */
  available: boolean;
  /** Where it resolved from; a node-modules resolution has no file to run. */
  source?: "setting" | "env" | "seeded" | "node-modules";
  /** `claude --version` with a timeout; "skipped" when there is no file to run. */
  run: "ok" | "failed" | "timeout" | "skipped";
  /** The current seat needs the SDK runtime (profileRequiresSdk); unknown seat = false. */
  required: boolean;
}
export function classifySdk(f: SdkFacts): DoctorCheck {
  if (!f.available) return { id: "sdk", status: f.required ? "fail" : "warn", code: "sdk_missing", fix: "reseed_sdk" };
  if (f.run === "failed" || f.run === "timeout") return { id: "sdk", status: f.required ? "fail" : "warn", code: f.run === "timeout" ? "sdk_timeout" : "sdk_not_runnable", fix: "reseed_sdk" };
  return { id: "sdk", status: "ok", code: "sdk_ok" };
}

export interface ServiceFacts {
  /** HTTP status of GET {proxy}/health, or 0 when no answer arrived. */
  status: number;
  /** Node's error code when the fetch threw (err.cause.code), or "timeout". */
  errorCode?: string;
}
const TLS_CODES = new Set(["UNABLE_TO_VERIFY_LEAF_SIGNATURE", "SELF_SIGNED_CERT_IN_CHAIN", "DEPTH_ZERO_SELF_SIGNED_CERT", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY", "CERT_HAS_EXPIRED", "ERR_TLS_CERT_ALTNAME_INVALID"]);
const DNS_CODES = new Set(["ENOTFOUND", "EAI_AGAIN", "ENETUNREACH", "ENETDOWN", "EHOSTUNREACH"]);
export function classifyService(f: ServiceFacts): DoctorCheck {
  if (f.status >= 200 && f.status < 300) return { id: "service", status: "ok", code: "service_ok" };
  if (f.status === 407) return { id: "service", status: "fail", code: "service_proxy_auth" };
  if (f.status > 0) return { id: "service", status: "fail", code: "service_error" };
  const e = f.errorCode ?? "";
  if (TLS_CODES.has(e)) return { id: "service", status: "fail", code: "service_tls" };
  if (DNS_CODES.has(e)) return { id: "service", status: "fail", code: "service_offline" };
  if (e === "timeout" || e === "ETIMEDOUT" || e === "UND_ERR_CONNECT_TIMEOUT") return { id: "service", status: "fail", code: "service_timeout" };
  return { id: "service", status: "fail", code: "service_unreachable" };
}

export interface LoginFacts {
  hasToken: boolean;
  /** GET /profile: the profile's allowance facts, or the classified failure. Absent when the read was not tried. */
  profile?:
    | { ok: true; trial?: { state?: string } | null; pass?: { request_limit?: number; requests_used?: number; expires_at?: number } | null }
    | { ok: false; reason: string; code?: string };
  now: number;
}
export function classifyLogin(f: LoginFacts): DoctorCheck {
  if (!f.hasToken) return { id: "login", status: "warn", code: "login_missing" };
  const p = f.profile;
  if (!p) return { id: "login", status: "skip", code: "login_unknown" };
  if (p.ok) {
    if (p.trial?.state === "expired") return { id: "login", status: "warn", code: "seat_ended" };
    if (p.trial?.state === "exhausted") return { id: "login", status: "warn", code: "quota_exhausted" };
    const pass = p.pass;
    if (pass && typeof pass.expires_at === "number" && pass.expires_at <= f.now) return { id: "login", status: "warn", code: "seat_ended" };
    if (pass && typeof pass.request_limit === "number" && typeof pass.requests_used === "number" && pass.request_limit > 0 && pass.requests_used >= pass.request_limit)
      return { id: "login", status: "warn", code: "quota_exhausted" };
    return { id: "login", status: "ok", code: "login_ok" };
  }
  // The network is the Service check's finding; it is not also a login finding.
  if (p.reason === "network") return { id: "login", status: "skip", code: "login_unknown" };
  if (p.code === "trial_expired" || p.code === "trial_revoked_or_reissued") return { id: "login", status: "warn", code: "seat_ended" };
  if (p.reason === "expired") return { id: "login", status: "fail", code: "login_expired" };
  // A server-side failure: re-reading the profile is the safe retry.
  if (p.reason === "server") return { id: "login", status: "fail", code: "login_unverified", fix: "reconnect" };
  return { id: "login", status: "fail", code: "login_rejected" };
}

export interface WorkFolderFacts {
  /** No work folder is known yet (nothing opened, no profile root): nothing to check. */
  folder: boolean;
  platform: string;
  /** Outcome of the probes (stat, readdir, write access): the first failing errno, or "ok". */
  probe: "ok" | "ENOENT" | "ENOTDIR" | "EPERM" | "EACCES" | "EROFS" | "other";
  /** win32 only: the folder sits under Documents, Desktop or Pictures (Controlled Folder Access protects these). */
  protectedWindowsFolder?: boolean;
}
export function classifyWorkFolder(f: WorkFolderFacts): DoctorCheck {
  if (!f.folder) return { id: "workfolder", status: "skip", code: "folder_none" };
  if (f.probe === "ok") return { id: "workfolder", status: "ok", code: "folder_ok" };
  if (f.probe === "ENOENT" || f.probe === "ENOTDIR") return { id: "workfolder", status: "fail", code: "folder_missing" };
  // Same rule as denialNotice.macPrivacyBlocked: on macOS, EPERM on a user folder is the privacy (TCC) setting.
  if (f.platform === "darwin" && f.probe === "EPERM") return { id: "workfolder", status: "fail", code: "folder_mac_privacy", fix: "mac_privacy" };
  // Windows Security's Controlled Folder Access refuses writes in protected folders with EPERM/EACCES. Hint only:
  // Studio never changes the Defender setting and does not open it for the learner.
  if (f.platform === "win32" && f.protectedWindowsFolder && (f.probe === "EPERM" || f.probe === "EACCES"))
    return { id: "workfolder", status: "fail", code: "folder_windows_protected", fix: "open_folder" };
  return { id: "workfolder", status: "fail", code: "folder_not_writable", fix: "open_folder" };
}

export interface DiskFacts { free: number | null; threshold: number }
export function classifyDisk(f: DiskFacts): DoctorCheck {
  if (f.free === null || !(f.threshold > 0)) return { id: "disk", status: "skip", code: "disk_unknown" };
  return f.free < f.threshold ? { id: "disk", status: "warn", code: "disk_low" } : { id: "disk", status: "ok", code: "disk_ok" };
}

// ── Copy (Korean product text) ───────────────────────────────────────────

export const DOCTOR_CHECK_LABEL: Record<DoctorCheckId, string> = {
  sdk: "AI 작업 도구", service: "Studio 서버 연결", login: "로그인·이용권", workfolder: "작업 폴더", disk: "저장 공간",
};

/** One plain sentence per code. No path, version or HTTP number in it. */
export const DOCTOR_TEXT: Record<string, string> = {
  sdk_ok: "AI 작업 도구가 준비돼 있어요.",
  sdk_missing: "AI 작업 도구가 없거나 확인되지 않아 코치가 파일 작업을 못 해요.",
  sdk_not_runnable: "AI 작업 도구가 실행되지 않아요. 다시 받으면 고쳐져요.",
  sdk_timeout: "AI 작업 도구가 제때 응답하지 않아요. 다시 받으면 고쳐질 수 있어요.",
  service_ok: "Studio 서버에 연결돼요.",
  service_offline: "인터넷에 연결되지 않았어요. 와이파이나 인터넷 연결을 확인해 주세요.",
  service_tls: "이 네트워크(학교·회사)가 보안 연결을 가로채고 있어요. 다른 와이파이나 휴대폰 핫스팟으로 해 보세요.",
  service_proxy_auth: "프록시 로그인이 필요한 네트워크예요. 다른 네트워크로 해 보세요.",
  service_timeout: "Studio 서버가 제때 응답하지 않아요. 잠시 뒤 다시 해 보세요.",
  service_error: "Studio 서버에 문제가 있어요. 잠시 뒤 다시 해 보세요.",
  service_unreachable: "Studio 서버에 연결되지 않아요. 인터넷 연결을 확인해 주세요.",
  login_ok: "로그인과 이용권이 정상이에요.",
  login_missing: "아직 연결되지 않았어요. 시작 화면에서 바로 시작하거나 참여 코드를 넣어 주세요.",
  login_unknown: "서버에 연결되지 않아 로그인 상태를 확인하지 못했어요.",
  login_expired: "로그인이 풀렸어요. 참여 코드나 이용권으로 다시 연결해 주세요.",
  login_rejected: "서버가 이 연결을 받아 주지 않았어요. 참여 코드나 이용권을 다시 확인해 주세요.",
  login_unverified: "서버가 잠시 로그인 상태를 확인해 주지 못했어요. 다시 연결해 보세요.",
  seat_ended: "이용 기간이 끝났어요. 이어서 쓰려면 이용권을 확인해 주세요.",
  quota_exhausted: "오늘 쓸 수 있는 사용량을 다 썼어요. 사용량이 다시 채워지면 이어서 할 수 있어요.",
  folder_none: "아직 작업 폴더가 없어요.",
  folder_ok: "작업 폴더에 파일을 만들 수 있어요.",
  folder_missing: "작업 폴더를 찾을 수 없어요. 옮겨졌거나 지워졌을 수 있어요.",
  folder_mac_privacy: "Mac 개인정보 보호 설정이 Studio의 이 폴더 접근을 막고 있어요. 설정에서 HypeProof Studio를 켜 주세요.",
  folder_windows_protected: "Windows 보안의 '랜섬웨어 방지(제어된 폴더 액세스)'가 막고 있을 수 있어요. 작업 폴더를 문서·바탕 화면 밖으로 옮기거나 관리자에게 Studio 허용을 요청해 주세요.",
  folder_not_writable: "작업 폴더에 파일을 쓸 수 없어요. 폴더 권한을 확인해 주세요.",
  disk_ok: "저장 공간이 충분해요.",
  disk_low: "저장 공간이 거의 없어요. 필요 없는 파일을 정리해 주세요.",
  disk_unknown: "저장 공간을 확인하지 못했어요.",
};

export const DOCTOR_FIX_LABEL: Record<DoctorFixId, string> = {
  reseed_sdk: "AI 작업 도구 다시 받기",
  reconnect: "다시 연결",
  mac_privacy: "Mac 설정 열기",
  open_folder: "작업 폴더 열기",
};

export const DOCTOR_COMMAND_TITLE = "진단 실행";

export function doctorText(code: string): string { return DOCTOR_TEXT[code] ?? "확인하지 못했어요."; }

/** The headline: everything fine, or how many things need attention. */
export function doctorSummary(r: DoctorResult): string {
  const bad = r.checks.filter((c) => c.status === "fail" || c.status === "warn").length;
  return bad === 0 ? "모두 정상이에요." : `확인할 것이 ${bad}개 있어요.`;
}

/** The support list: one row per check, ✓ when it passed, ⚠ otherwise (a skipped check reads as "확인 못 함"). */
export function doctorRows(r: DoctorResult): Array<{ id: DoctorCheckId; mark: "✓" | "⚠" | "–"; label: string; text: string; fix?: { id: DoctorFixId; label: string } }> {
  return r.checks.map((c) => ({
    id: c.id,
    mark: c.status === "ok" ? "✓" : c.status === "skip" ? "–" : "⚠",
    label: DOCTOR_CHECK_LABEL[c.id],
    text: doctorText(c.code),
    ...(c.fix ? { fix: { id: c.fix, label: DOCTOR_FIX_LABEL[c.fix] } } : {}),
  }));
}

// ── Automatic runs: the one quiet line, the daily limit, the signals ─────

/** Per-check day stamps (KST date) of the last time a check's line was shown or its signal was sent. */
export type DoctorDayLog = Partial<Record<DoctorCheckId, string>>;

/** The calendar day in Korea, so "once a day" turns over at the same midnight the free allowance does. */
export function doctorDay(now: number): string {
  return new Date(now + 9 * 3600_000).toISOString().slice(0, 10);
}

/**
 * The checks whose line or signal is due: failing (fail or warn), not shown/sent today. The low-disk bar
 * (REQ-KNOW-35) already speaks for disk_low, so the quiet line leaves it out (`forLine`); the signal still counts it.
 * A seat that ended or a drained allowance is an account state the learner was already told about, not a fault:
 * no line and no signal (same rule as noteProblem).
 */
export function dueChecks(r: DoctorResult, log: DoctorDayLog, now: number, forLine: boolean): DoctorCheck[] {
  const today = doctorDay(now);
  return r.checks
    .filter((c) => c.status === "fail" || c.status === "warn")
    .filter((c) => c.code !== "seat_ended" && c.code !== "quota_exhausted" && c.code !== "login_missing")
    .filter((c) => !(forLine && c.id === "disk"))
    .filter((c) => log[c.id] !== today)
    .sort((a, b) => (a.status === b.status ? 0 : a.status === "fail" ? -1 : 1));
}

export function markShown(log: DoctorDayLog, checks: DoctorCheck[], now: number): DoctorDayLog {
  const next: DoctorDayLog = { ...log }, today = doctorDay(now);
  for (const c of checks) next[c.id] = today;
  return next;
}

/** The quiet chat line: the most important due check, its sentence and its fix (if safe). */
export interface DoctorNotice { id: string; check: DoctorCheckId; code: string; text: string; fix?: { id: DoctorFixId; label: string } }
export function doctorNotice(c: DoctorCheck | undefined, id: string): DoctorNotice | null {
  if (!c) return null;
  return { id, check: c.id, code: c.code, text: doctorText(c.code), ...(c.fix ? { fix: { id: c.fix, label: DOCTOR_FIX_LABEL[c.fix] } } : {}) };
}

/** Problem-signal step per check; values must be in the Service's PROBLEM_STEPS. */
export const DOCTOR_STEP: Record<DoctorCheckId, "agent" | "other" | "access" | "workspace"> = {
  sdk: "agent", service: "other", login: "access", workfolder: "workspace", disk: "workspace",
};
/** The content-free signal facts for each due check: `doctor_<code>` (≤ 48 chars, machine word). */
export function doctorSignalFacts(checks: DoctorCheck[]): Array<{ code: string; step: "agent" | "other" | "access" | "workspace" }> {
  return checks.filter((c) => CODE_RE.test(c.code)).map((c) => ({ code: `doctor_${c.code}`, step: DOCTOR_STEP[c.id] }));
}

// ── Report attachment ───────────────────────────────────────────────────

export interface DoctorAttachment { v: 1; duration_ms: number; checks: Array<{ id: DoctorCheckId; status: DoctorStatus; code: string }> }
/** Codes only: a check whose id or code is not a known machine word is dropped, never passed through. */
export function doctorAttachment(r: DoctorResult): DoctorAttachment {
  const ids = new Set<string>(DOCTOR_CHECK_IDS), statuses = new Set(["ok", "warn", "fail", "skip"]);
  return {
    v: 1,
    duration_ms: Number.isFinite(r.duration_ms) && r.duration_ms >= 0 ? Math.min(Math.round(r.duration_ms), 600_000) : 0,
    checks: r.checks
      .filter((c) => ids.has(c.id) && statuses.has(c.status) && CODE_RE.test(c.code) && Object.hasOwn(DOCTOR_TEXT, c.code))
      .map((c) => ({ id: c.id, status: c.status, code: c.code })),
  };
}

// ── Probe helpers the host uses (pure so their rules are tested) ─────────

/** Map a thrown fs error to the probe outcome. */
export function probeOutcome(err: unknown): WorkFolderFacts["probe"] {
  const code = (err as { code?: unknown } | null)?.code;
  return code === "ENOENT" || code === "ENOTDIR" || code === "EPERM" || code === "EACCES" || code === "EROFS" ? code : "other";
}

/** The fetch error's Node code (undici puts it on `cause`), or "timeout" for an abort/timeout. */
export function fetchErrorCode(err: unknown): string {
  const e = err as { name?: unknown; code?: unknown; cause?: { code?: unknown; name?: unknown } } | null;
  if (e?.name === "TimeoutError" || e?.name === "AbortError") return "timeout";
  const c = e?.cause?.code ?? e?.code;
  return typeof c === "string" && /^[A-Z_0-9]{2,48}$/.test(c) ? c : "unknown";
}

/** win32: is this folder inside a folder Controlled Folder Access protects by default? */
export function isProtectedWindowsFolder(folder: string, home: string): boolean {
  const norm = (p: string) => p.replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();
  const f = norm(folder), h = norm(home);
  return ["Documents", "Desktop", "Pictures", "Videos", "Music", "Favorites"].some((d) => f === `${h}\\${d.toLowerCase()}` || f.startsWith(`${h}\\${d.toLowerCase()}\\`))
    || /\\onedrive[^\\]*\\(documents|desktop|pictures|문서|바탕 화면|사진)(\\|$)/.test(f);
}

// ── Node probes (no vscode; each bounded by a timeout) ───────────────────

/** Runs `<binary> --version`; "ok" only on exit 0 within the timeout. */
export function runBinaryVersion(binary: string, timeoutMs = 8000): Promise<"ok" | "failed" | "timeout"> {
  return new Promise((resolve) => {
    try {
      execFile(binary, ["--version"], { timeout: timeoutMs, windowsHide: true, maxBuffer: 64 * 1024 }, (err) => {
        if (!err) return resolve("ok");
        resolve((err as { killed?: boolean; signal?: unknown }).killed || (err as { signal?: unknown }).signal === "SIGTERM" ? "timeout" : "failed");
      });
    } catch { resolve("failed"); }
  });
}

/** GET {proxy}/health — the same endpoint the classroom `retry_diagnostics` executor probes (answers 200 on /v1/health). */
export async function probeService(proxyBase: string, fetchImpl: typeof fetch = fetch, timeoutMs = 4000): Promise<ServiceFacts> {
  try {
    const res = await fetchImpl(proxyBase.replace(/\/+$/, "") + "/health", { signal: AbortSignal.timeout(timeoutMs) });
    return { status: res.status };
  } catch (err) {
    return { status: 0, errorCode: fetchErrorCode(err) };
  }
}

/**
 * The work folder: it exists and is a folder, it can be listed (macOS privacy refuses this with EPERM), and the
 * user may write in it. On Windows a write probe (one temp file, removed at once) is the only way to see Controlled
 * Folder Access, which allows the permission check and refuses the write; elsewhere nothing is written.
 */
export async function probeWorkFolder(folder: string, platform: string = process.platform): Promise<WorkFolderFacts["probe"]> {
  try {
    const st = await fs.promises.stat(folder);
    if (!st.isDirectory()) return "ENOTDIR";
    await fs.promises.readdir(folder);
    await fs.promises.access(folder, fs.constants.W_OK);
    if (platform === "win32") {
      const probe = path.join(folder, `.hps-doctor-${process.pid}-${Date.now().toString(36)}`);
      await fs.promises.writeFile(probe, "", { flag: "wx" });
      await fs.promises.rm(probe, { force: true });
    }
    return "ok";
  } catch (err) {
    return probeOutcome(err);
  }
}

export interface DoctorProbes {
  sdk(): Promise<SdkFacts>;
  service(): Promise<ServiceFacts>;
  login(serviceReachable: boolean): Promise<LoginFacts>;
  workFolder(): Promise<WorkFolderFacts>;
  disk(): Promise<DiskFacts>;
  now?: () => number;
}

/** Runs every check. A probe that throws becomes that check's "skip", never a failed doctor. */
export async function runDoctor(p: DoctorProbes): Promise<DoctorResult> {
  const now = p.now ?? Date.now, started = now();
  const safe = async <T>(f: () => Promise<T>): Promise<T | null> => { try { return await f(); } catch { return null; } };
  const [sdk, service, folder, disk] = await Promise.all([safe(p.sdk), safe(p.service), safe(p.workFolder), safe(p.disk)]);
  const serviceCheck = service ? classifyService(service) : { id: "service" as const, status: "skip" as const, code: "service_unreachable" };
  const login = await safe(() => p.login(serviceCheck.status === "ok"));
  return {
    checks: [
      sdk ? classifySdk(sdk) : { id: "sdk", status: "skip", code: "sdk_missing" },
      serviceCheck,
      login ? classifyLogin(login) : { id: "login", status: "skip", code: "login_unknown" },
      folder ? classifyWorkFolder(folder) : { id: "workfolder", status: "skip", code: "folder_none" },
      disk ? classifyDisk(disk) : { id: "disk", status: "skip", code: "disk_unknown" },
    ],
    duration_ms: now() - started,
  };
}
