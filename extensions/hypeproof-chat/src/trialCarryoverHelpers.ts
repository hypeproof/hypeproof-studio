// REQ-L12 ⑫ (ot-conversation-carryover) — pure helpers for carrying a trial conversation into a
// newly bought pass. vscode-free so they run under plain Node (see chatPanelHelpers.ts).
//
// The default stays what REQ-L12 ⑫ says: a new pass starts a new conversation. Carry-over is an
// exception the learner has to choose (US-09: reuse is a separate, user-confirmed action):
//   - offered only when the Service advertises it (`conversation_carryover.available`) on a pass
//     profile, only once per pass, only while the pass conversation has no learner message yet;
//   - on confirm the trial transcript is shown read-only and NOT copied into the pass history;
//   - the coach gets a summary that is itself a visible message in the pass conversation;
//   - nothing from the trial seat's runtime (SDK session, credentials) is reused.

export interface CarryoverMessage { id?: string; role: string; content: string; createdAt?: number }
/** The trial that held the folder: its record id, name and canonical home folder (its task-store key). */
export interface CarryoverSource { id: string; name: string; workspace: string }
export interface CarryoverOffer {
  version: 1;
  /** The pass activity (ActivityConnections record id) the offer belongs to. */
  passId: string;
  from: CarryoverSource;
  status: "pending" | "accepted" | "declined";
  decidedAt?: number;
}
export type CarryoverView =
  | { status: "offer"; fromName: string }
  | { status: "accepted"; fromName: string; transcript: Array<{ role: "user" | "assistant"; content: string }> };

/** globalState key; global because the offer is written before the window reopens the pass folder. */
export const carryoverOfferKey = (passId: string) => "hps.carryover.offer." + passId;

/** The Service switch. Studio never offers carry-over on its own. */
export function carryoverAdvertised(profile: { pass?: unknown; conversation_carryover?: { available?: boolean } } | null | undefined): boolean {
  return !!profile?.pass && profile.conversation_carryover?.available === true;
}

/**
 * Which earlier activity the new pass may offer to continue from. Only a trial (kind "trial"
 * without the pass mark) counts — a class or an earlier pass is not "체험에서 하던 대화".
 */
export function carryoverSourceOf(
  previous: { id: string; name: string; workspace?: string; kind?: string; pass?: boolean } | undefined | null,
  passId: string,
): CarryoverSource | null {
  if (!previous || previous.id === passId || previous.kind !== "trial" || previous.pass || typeof previous.workspace !== "string" || !previous.workspace) return null;
  return { id: previous.id, name: previous.name, workspace: previous.workspace };
}

export function newOffer(passId: string, from: CarryoverSource): CarryoverOffer {
  return { version: 1, passId, from, status: "pending" };
}

export function validOffer(value: unknown, passId: string): CarryoverOffer | null {
  const o = value as CarryoverOffer | null | undefined;
  if (!o || o.version !== 1 || o.passId !== passId || !o.from || typeof o.from.id !== "string" || typeof o.from.name !== "string" || typeof o.from.workspace !== "string" || !o.from.workspace) return null;
  if (o.status !== "pending" && o.status !== "accepted" && o.status !== "declined") return null;
  return o;
}

/** Only what was said: tool lines and app-internal roles are not part of the transcript shown. */
export function readableTranscript(messages: readonly CarryoverMessage[]): Array<{ role: "user" | "assistant"; content: string }> {
  return messages
    .filter((m): m is CarryoverMessage & { role: "user" | "assistant" } => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim() !== "")
    .map(({ role, content }) => ({ role, content }));
}

const hasLearnerMessage = (messages: readonly CarryoverMessage[]) => messages.some((m) => m.role === "user");

/**
 * What the chat shows. Off unless the Service advertises it. A pending offer is withdrawn as soon
 * as the learner talks in the pass (no silent mixing later) or when the trial left nothing to read.
 */
export function carryoverView(args: {
  advertised: boolean;
  offer: CarryoverOffer | null;
  passHistory: readonly CarryoverMessage[];
  trialHistory: readonly CarryoverMessage[];
}): CarryoverView | null {
  const { advertised, offer } = args;
  if (!advertised || !offer) return null;
  const transcript = readableTranscript(args.trialHistory);
  if (offer.status === "pending") {
    if (hasLearnerMessage(args.passHistory) || transcript.length === 0) return null;
    return { status: "offer", fromName: offer.from.name };
  }
  if (offer.status === "accepted" && transcript.length > 0) return { status: "accepted", fromName: offer.from.name, transcript };
  return null;
}

const clip = (s: string, max: number) => {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > max ? flat.slice(0, max - 1) + "…" : flat;
};

/**
 * The summary the coach receives — and the learner sees, because it is posted as a visible app
 * message in the pass conversation. Deterministic (no model call): the learner's last requests
 * and the coach's last answer, clipped. The full trial text stays only in the read-only view.
 */
export function carryoverSummary(trialHistory: readonly CarryoverMessage[], opts: { maxRequests?: number; requestChars?: number; replyChars?: number } = {}): string {
  const { maxRequests = 5, requestChars = 140, replyChars = 400 } = opts;
  const t = readableTranscript(trialHistory);
  const asks = t.filter((m) => m.role === "user").slice(-maxRequests).map((m) => "- " + clip(m.content, requestChars));
  const lastReply = [...t].reverse().find((m) => m.role === "assistant");
  const lines = ["체험에서 하던 대화를 이어서 해요. 아래는 체험 대화를 줄인 내용이에요. 체험 대화 전체는 위에서 읽기만 할 수 있어요."];
  if (asks.length) lines.push("", "체험에서 요청한 것:", ...asks);
  if (lastReply) lines.push("", "체험의 마지막 답변: " + clip(lastReply.content, replyChars));
  return lines.join("\n");
}

/** A confirm or decline is honoured only for a pending offer that is still on screen. */
export function decideOffer(offer: CarryoverOffer | null, decision: "confirm" | "decline", view: CarryoverView | null, now: number): CarryoverOffer | null {
  if (!offer || offer.status !== "pending" || view?.status !== "offer") return null;
  return { ...offer, status: decision === "confirm" ? "accepted" : "declined", decidedAt: now };
}

/** The stores the host hands in: VS Code Mementos in the app, Maps in the tests. */
export interface CarryoverStores {
  offers: { get(key: string): unknown; update(key: string, value: unknown): PromiseLike<void> | void };
  /**
   * The trial activity's own transcript (read only; never written by carry-over). In the app this
   * is the trial's TaskWorkspaceStore, not workspaceState (trialCarryoverSource.ts).
   */
  trialHistory(source: CarryoverSource): readonly CarryoverMessage[];
  /** The pass conversation as it is now. */
  passHistory(): readonly CarryoverMessage[];
}

export function carryoverState(passId: string, advertised: boolean, stores: CarryoverStores) {
  const key = carryoverOfferKey(passId);
  const offer = validOffer(stores.offers.get(key), passId);
  const trialHistory = offer ? stores.trialHistory(offer.from) : [];
  const view = carryoverView({ advertised, offer, passHistory: offer ? stores.passHistory() : [], trialHistory });
  return { key, offer, view, trialHistory };
}

/**
 * Apply the learner's answer. Confirm stores "accepted" and appends exactly one visible summary
 * message to the pass conversation through `appendSeed`; decline stores "declined" and appends
 * nothing. Anything not on screen as an offer (flag off, already decided, learner already talked)
 * is ignored. Returns the stored offer, or null when nothing changed.
 */
export async function applyCarryoverDecision(args: {
  passId: string; advertised: boolean; decision: "confirm" | "decline"; stores: CarryoverStores;
  appendSeed: (text: string) => Promise<void>; now: number;
}): Promise<CarryoverOffer | null> {
  const { key, offer, view, trialHistory } = carryoverState(args.passId, args.advertised, args.stores);
  const next = decideOffer(offer, args.decision, view, args.now);
  if (!next) return null;
  await args.stores.offers.update(key, next);
  if (next.status === "accepted") await args.appendSeed(carryoverSummary(trialHistory));
  return next;
}
