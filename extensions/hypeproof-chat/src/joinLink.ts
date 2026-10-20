/**
 * REQ-STUDIO-JOIN-LINK (CGP-SHELL-R-005 / REQ-SHELL-05, DES-SHELL-04) — a class join link.
 *
 * Chalk's "참여 링크 복사" builds `<scheme>://hypeproof.hypeproof-chat/join?class=<id>`. The link
 * names a class (the Chalk cohort id) and nothing else: the participation code stays with the
 * learner, who types it into the ordinary join form. The link is untrusted input from any web page
 * or chat, so it may only bring the join form forward with the class named; it never joins, sends,
 * stores or changes a setting. Any other parameter (`code=`, `token=`, identity, tracking) is
 * ignored and only its name is logged.
 *
 * Pure decisions live here; the URI handler in extension.ts and StartPage call them.
 */
import { decodeTokenPayloadUnverified } from "./chatPanelHelpers.ts";

/** `<publisher>.<name>` of this extension: the URI authority VS Code routes to us. */
export const JOIN_LINK_AUTHORITY = "hypeproof.hypeproof-chat";
export const JOIN_LINK_PATH = "/join";
/** The Chalk cohort id field allows 1–128 of `[A-Za-z0-9_-]` (manage.html `#cohort`). */
export const CLASS_ID_MAX = 128;
const CLASS_ID = /^[A-Za-z0-9_-]{1,128}$/;
/** A link longer than this is not something Chalk produced. */
const QUERY_MAX = 1024;

export const JOIN_LINK_COPY = {
  malformed: "수업 참여 링크를 열 수 없어요. 링크가 잘렸거나 바뀐 것 같아요. 선생님께 링크를 다시 받아 주세요.",
  askTurn: "지금 AI가 대답하고 있어요. 수업 참여 화면을 열까요?",
  askClass: "지금 다른 활동에 연결돼 있어요. 이 링크의 수업 참여 화면을 열까요?",
  askDetail: "참여 화면만 열려요. 참여 코드를 넣고 직접 시작하기 전까지 지금 하던 것은 그대로예요.",
  open: "참여 화면 열기",
  sameClass: "이미 이 수업에 참여하고 있어요.",
  mismatch: "이 참여 코드는 링크로 연 수업의 코드가 아니에요. 선생님께 받은 코드를 다시 확인해 주세요.",
} as const;

export function isClassId(value: unknown): value is string {
  return typeof value === "string" && CLASS_ID.test(value);
}

export interface LinkUri { scheme: string; authority: string; path: string; query: string; fragment: string }
export type JoinLinkParse =
  | { kind: "other" }
  | { kind: "malformed" }
  | { kind: "join"; classId: string; ignored: string[] };

/** A parameter name as it may appear in a log line: never a value, never more than 32 safe chars. */
const safeName = (name: string): string => (name.replace(/[^A-Za-z0-9_-]/g, "") || "?").slice(0, 32);

/**
 * Read a join link. `other`: not a join link for this extension (left to the next handler).
 * `malformed`: ours, but the class cannot be read exactly once as a valid id.
 */
export function parseJoinLink(uri: LinkUri, scheme: string): JoinLinkParse {
  if (uri.scheme !== scheme || uri.authority !== JOIN_LINK_AUTHORITY || uri.path !== JOIN_LINK_PATH) return { kind: "other" };
  if (uri.query.length > QUERY_MAX) return { kind: "malformed" };
  let query: URLSearchParams;
  try { query = new URLSearchParams(uri.query); } catch { return { kind: "malformed" }; }
  const classes = query.getAll("class");
  if (classes.length !== 1 || !isClassId(classes[0])) return { kind: "malformed" };
  const ignored: string[] = [];
  for (const key of query.keys()) {
    if (key === "class") continue;
    const name = safeName(key);
    if (!ignored.includes(name)) ignored.push(name);
  }
  if (uri.fragment) ignored.push("#fragment");
  return { kind: "join", classId: classes[0], ignored };
}

export type JoinLinkDecision = "open" | "ask-turn" | "ask-class" | "same-class";

/** Ask before leaving a running turn or another class; a link for the class already in use only says so. */
export function joinLinkDecision(o: { activeTurn: boolean; currentClass?: string; linkClass: string }): JoinLinkDecision {
  if (o.activeTurn) return "ask-turn";
  if (o.currentClass && o.currentClass !== o.linkClass) return "ask-class";
  if (o.currentClass === o.linkClass) return "same-class";
  return "open";
}

/**
 * The class a participation code names, read without verifying the signature. Presentation only:
 * used to refuse a code for another class before it is sent, and to tell "another class" apart.
 * The Service still decides what the code grants.
 */
export function classOfCode(code: string | null | undefined): string | undefined {
  const c = decodeTokenPayloadUnverified(code)?.c;
  return isClassId(c) ? c : undefined;
}

export interface JoinLinkHost {
  /** `vscode.env.uriScheme` of this build. */
  scheme: string;
  activeTurn(): boolean;
  currentClass(): Promise<string | undefined>;
  /** Bring the join form forward with this class named. Nothing else. */
  open(classId: string): Promise<void>;
  /** A non-modal notice. */
  notify(message: string): unknown;
  /** A modal question; true only when the learner pressed `action`. */
  ask(message: string, detail: string, action: string): Promise<boolean>;
  log?(line: string): void;
}

/** Handle a URI if it is a join link. Returns false when it is not ours to handle. */
export async function handleJoinLink(host: JoinLinkHost, uri: LinkUri): Promise<boolean> {
  const parsed = parseJoinLink(uri, host.scheme);
  if (parsed.kind === "other") return false;
  if (parsed.kind === "malformed") {
    host.log?.("[joinLink] refused a malformed join link");
    host.notify(JOIN_LINK_COPY.malformed);
    return true;
  }
  if (parsed.ignored.length) host.log?.(`[joinLink] ignored parameters: ${parsed.ignored.join(", ")}`);
  let currentClass: string | undefined;
  try { currentClass = await host.currentClass(); } catch { currentClass = undefined; }
  const decision = joinLinkDecision({ activeTurn: host.activeTurn(), currentClass, linkClass: parsed.classId });
  if (decision === "same-class") { host.notify(JOIN_LINK_COPY.sameClass); return true; }
  if (decision === "ask-turn" || decision === "ask-class") {
    const yes = await host.ask(decision === "ask-turn" ? JOIN_LINK_COPY.askTurn : JOIN_LINK_COPY.askClass, JOIN_LINK_COPY.askDetail, JOIN_LINK_COPY.open);
    if (!yes) return true;
  }
  await host.open(parsed.classId);
  return true;
}
