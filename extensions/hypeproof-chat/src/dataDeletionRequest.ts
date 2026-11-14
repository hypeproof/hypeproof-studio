/**
 * CGP-SHELL-R-027 / CGP-SHELL-D-026 — "계정과 데이터 삭제 요청" in the chat settings dialog.
 * Pure: no VS Code API and no Node API, so the webview imports the view helpers from here too.
 *
 * The request goes webview → host → Service (`POST /v1/data-deletion/requests`) with the seat's
 * own credential. The Service RECORDS it; an operator processes it by hand. Nothing in Studio
 * deletes anything, and files on this computer are never touched by the request.
 *
 * Shown only when the seat's `/v1/profile` carries `data_deletion: { available: true }`
 * (Service `HPS_DATA_DELETION_REQUESTS`, default off; DEC-23 not confirmed by Jay).
 */

export const DATA_DELETION_ROUTE = "/data-deletion/requests";

export type DeletionStatus = "received" | "processing" | "done" | "held";

export type DeletionRequestView = {
  id: string;
  status: DeletionStatus;
  /** ISO time the request was made. */
  createdAt: string;
  /** ISO time of the last status change. */
  updatedAt: string;
  /** Only while held: the operator's reason, shown verbatim (as text, never markup). */
  reason?: string;
};

/** Host → webview: what the settings row shows. */
export type DataDeletionState =
  | { state: "loading" }
  | { state: "ready"; request: DeletionRequestView | null }
  | { state: "error"; message: string; request?: DeletionRequestView | null };

/** The status chip: icon + word (DES-SHELL-26). The icon never carries the meaning alone. */
export const DELETION_STATUS_LABEL: Record<DeletionStatus, { word: string; icon: "flag" | "clock" | "check" | "alert" }> = {
  received: { word: "접수", icon: "flag" },
  processing: { word: "처리 중", icon: "clock" },
  done: { word: "완료", icon: "check" },
  held: { word: "보류", icon: "alert" },
};

export const DATA_DELETION_COPY = {
  title: "계정과 데이터 삭제 요청",
  intro: "HypeProof에 저장된 내 계정과 기록을 지워 달라고 요청해요. 담당자가 확인한 뒤 처리해요.",
  localFiles: "이 컴퓨터의 작업 폴더와 파일은 지우지 않아요.",
  open: "삭제 요청하기",
  confirmTitle: "정말 삭제를 요청할까요?",
  confirmBody: "요청하면 담당자가 확인하고 처리해요. 처리 상태는 여기에서 볼 수 있어요.",
  confirm: "요청 보내기",
  cancel: "취소",
  sending: "요청을 보내는 중이에요…",
  loading: "요청 상태를 확인하는 중이에요…",
  requestedOn: "요청한 날",
  updatedOn: "바뀐 날",
  again: "다시 요청하기",
  failed: "지금은 처리하지 못했어요. 잠시 뒤 다시 시도해 주세요.",
} as const;

/** The seat's profile advertises the request (exactly `available: true`). */
export function dataDeletionOffered(profile: { data_deletion?: unknown } | null | undefined): boolean {
  const d = profile?.data_deletion as { available?: unknown } | null | undefined;
  return !!d && typeof d === "object" && d.available === true;
}

const STATUSES: readonly DeletionStatus[] = ["received", "processing", "done", "held"];
const isIso = (v: unknown): v is string => typeof v === "string" && v.length <= 40 && !Number.isNaN(Date.parse(v));

/** The Service's request view, or null when it is missing or malformed. Strips anything unknown. */
export function parseDeletionRequest(raw: unknown): DeletionRequestView | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== "string" || !/^ddr_[0-9a-f]{32}$/.test(r.id)) return null;
  if (!STATUSES.includes(r.status as DeletionStatus)) return null;
  if (!isIso(r.created_at) || !isIso(r.updated_at)) return null;
  const status = r.status as DeletionStatus;
  const reason = status === "held" && typeof r.reason === "string" && r.reason.trim() && r.reason.length <= 200 ? r.reason.trim() : undefined;
  return { id: r.id, status, createdAt: r.created_at, updatedAt: r.updated_at, ...(reason ? { reason } : {}) };
}

/** Korea calendar date of an ISO time: `2026년 11월 13일`. */
export function deletionDate(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const k = new Date(t + 9 * 3_600_000);
  return `${k.getUTCFullYear()}년 ${k.getUTCMonth() + 1}월 ${k.getUTCDate()}일`;
}

/** A new request may be sent when there is none, or the last one is done. */
export function canRequestAgain(request: DeletionRequestView | null | undefined): boolean {
  return !request || request.status === "done";
}

const base = (proxyUrl: string) => proxyUrl.replace(/\/+$/, "");

/** The Service's own Korean sentence when it sent one, else the generic failure. */
async function refusal(r: Response): Promise<string> {
  try {
    const body = (await r.json()) as { error?: { message?: unknown } } | null;
    const m = body?.error?.message;
    if (typeof m === "string" && /[가-힣]/.test(m) && m.length <= 200) return m;
  } catch { /* not JSON */ }
  return DATA_DELETION_COPY.failed;
}

export type DeletionOutcome = { ok: true; request: DeletionRequestView | null } | { ok: false; message: string };

type Fetch = typeof fetch;

export async function readDeletionRequest(proxyUrl: string, token: string, f: Fetch = fetch, timeoutMs = 10_000): Promise<DeletionOutcome> {
  try {
    const r = await f(`${base(proxyUrl)}${DATA_DELETION_ROUTE}`, {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!r.ok) return { ok: false, message: await refusal(r) };
    const body = (await r.json()) as { request?: unknown } | null;
    if (body?.request === null) return { ok: true, request: null };
    const request = parseDeletionRequest(body?.request);
    return request ? { ok: true, request } : { ok: false, message: DATA_DELETION_COPY.failed };
  } catch {
    return { ok: false, message: DATA_DELETION_COPY.failed };
  }
}

export async function sendDeletionRequest(proxyUrl: string, token: string, f: Fetch = fetch, timeoutMs = 10_000): Promise<DeletionOutcome> {
  try {
    const r = await f(`${base(proxyUrl)}${DATA_DELETION_ROUTE}`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ scope: "account_and_data" }),
      redirect: "error",
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!r.ok) return { ok: false, message: await refusal(r) };
    const request = parseDeletionRequest(((await r.json()) as { request?: unknown } | null)?.request);
    return request ? { ok: true, request } : { ok: false, message: DATA_DELETION_COPY.failed };
  } catch {
    return { ok: false, message: DATA_DELETION_COPY.failed };
  }
}
