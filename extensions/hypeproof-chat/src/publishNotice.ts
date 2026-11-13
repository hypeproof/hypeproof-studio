// CGP-ART-R-012 / CGP-ART-D-012 (REQ-STUDIO-PUBLISH-NOTICE): the responsibility notice a learner
// reads before the first test-version link, and the record that they read it.
//
// Types, copy and a store-backed ledger only: no node or vscode imports, so the webview imports
// the copy and the host imports the ledger. The host enforces it (PublishSession refuses a new
// link until the signed-in learner acknowledged the current version); the webview only draws it.
//
// The notice is versioned. Changing any line below is a new notice: bump the version, and every
// learner reads it once more. An acknowledgment is kept per learner (the token's owner digest,
// never the identity) per version, so another learner on the same machine still reads it.

/** The notice now shown. A new string here means everyone reads the notice again. */
export const PUBLISH_NOTICE_VERSION = "publish-notice-2026-11-12";

export const PUBLISH_NOTICE_TITLE = "공개하기 전에 확인해요";

/** DES-ART-12: three bullets, each at most two lines at 320 px. */
export const PUBLISH_NOTICE_LINES = [
  "링크를 받은 사람은 누구나 이 페이지를 볼 수 있어요.",
  "페이지에 담긴 내용은 공개한 내가 책임져요.",
  "이름이나 연락처 같은 개인정보를 모으지 않는지 확인해요.",
] as const;

export const PUBLISH_NOTICE_ACK = "알겠어요";

/** The host refused a new link because the current notice was not acknowledged. */
export const PUBLISH_NOTICE_REQUIRED = "공개하기 전에 안내를 먼저 읽어 주세요.";

/** The acknowledgment could not be saved, so nothing was sent. */
export const PUBLISH_NOTICE_NOT_SAVED = "안내를 읽은 기록을 저장하지 못했어요. 다시 시도해 주세요.";

/** What the host tells the panel about the notice for the signed-in learner. */
export interface PublishNoticeView {
  version: string;
  acknowledged: boolean;
}

/** The ledger as PublishSession sees it: keyed by the session's token, never by the webview. */
export interface PublishNoticePort {
  acknowledged(token: string, version: string): boolean;
  /** Record that the learner holding this token acknowledged `version`. False when it was not saved. */
  record(token: string, version: string): Promise<boolean>;
}

type Stored = { v: 1; acks: Record<string, Record<string, number>> };

/** Bounds on what the record keeps: a malformed or oversized record reads as empty (the notice shows again). */
const MAX_OWNERS = 200;
const MAX_VERSIONS = 20;
const OWNER = /^o-[0-9a-f]{32}$/;
const VERSION = /^[a-z0-9-]{1,64}$/;

function parse(raw: unknown): Stored {
  const empty: Stored = { v: 1, acks: {} };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return empty;
  const r = raw as { v?: unknown; acks?: unknown };
  if (r.v !== 1 || !r.acks || typeof r.acks !== "object" || Array.isArray(r.acks)) return empty;
  const acks: Stored["acks"] = {};
  const owners = Object.entries(r.acks as Record<string, unknown>);
  if (owners.length > MAX_OWNERS) return empty;
  for (const [owner, versions] of owners) {
    if (!OWNER.test(owner) || !versions || typeof versions !== "object" || Array.isArray(versions)) return empty;
    const entries = Object.entries(versions as Record<string, unknown>);
    if (entries.length > MAX_VERSIONS) return empty;
    const kept: Record<string, number> = {};
    for (const [version, at] of entries) {
      if (!VERSION.test(version) || typeof at !== "number" || !Number.isFinite(at) || at <= 0) return empty;
      kept[version] = at;
    }
    acks[owner] = kept;
  }
  return { v: 1, acks };
}

/**
 * The acknowledgment record over a key-value store (globalState in the App). `owner` maps a
 * token to its owner digest (`crBytesOwner`); a token without one (no seat, no account) has no
 * record and can never acknowledge, so it never gets a link through this gate.
 */
export class PublishNoticeLedger implements PublishNoticePort {
  private readonly store: { get(): unknown; update(value: Stored): PromiseLike<void> | void };
  private readonly owner: (token: string) => string | null;
  private readonly now: () => number;
  constructor(store: { get(): unknown; update(value: Stored): PromiseLike<void> | void }, owner: (token: string) => string | null, now: () => number = Date.now) {
    this.store = store;
    this.owner = owner;
    this.now = now;
  }

  acknowledged(token: string, version: string): boolean {
    const owner = this.owner(token);
    if (!owner) return false;
    return typeof parse(this.store.get()).acks[owner]?.[version] === "number";
  }

  async record(token: string, version: string): Promise<boolean> {
    const owner = this.owner(token);
    if (!owner || !OWNER.test(owner) || !VERSION.test(version)) return false;
    const stored = parse(this.store.get());
    const mine = { ...(stored.acks[owner] ?? {}) };
    // Once per learner per version: the first acknowledgment's time is kept.
    if (typeof mine[version] === "number") return true;
    mine[version] = this.now();
    // Keep the newest versions within the bound.
    const versions = Object.entries(mine).sort((a, b) => b[1] - a[1]).slice(0, MAX_VERSIONS);
    const acks = { ...stored.acks, [owner]: Object.fromEntries(versions) };
    const owners = Object.entries(acks);
    // Keep the owners who acknowledged most recently within the bound.
    const keep = owners.length > MAX_OWNERS
      ? Object.fromEntries(owners.sort((a, b) => Math.max(...Object.values(b[1])) - Math.max(...Object.values(a[1]))).slice(0, MAX_OWNERS))
      : acks;
    try {
      await this.store.update({ v: 1, acks: keep });
    } catch {
      return false;
    }
    return this.acknowledged(token, version);
  }
}
