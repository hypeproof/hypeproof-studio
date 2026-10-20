// Folder consent (REQ-STUDIO-FOLDER-CONSENT; CGP-KNOW-R-010 / REQ-KNOW-18).
//
// A personal activity can be bound to any folder the learner picks (start page "작업 폴더
// 열기" → "현재 활동 연결", or "이 활동의 작업 폴더 선택"). The first time such a folder is
// not the activity's own work folder, Studio asks once what its AI may do there:
//
//   full — 읽기·고치기·명령 실행 모두 허용: the seat's tools as the profile grants them;
//   read — 읽기만 허용: write/edit, shell and site publishing are removed;
//   none — 이 폴더에서는 AI를 쓰지 않음: every turn in that folder is refused.
//
// The choice is remembered per activity per canonical folder path (real path, on-disk
// case, upper-case drive letter). Classroom and lesson seats never ask: a class folder is
// prepared by the cohort. The narrowing only ever removes grants: `full` returns the
// profile untouched, so the choice can never widen what the Service profile allows.
//
// Pure apart from the injectable realpath: no vscode, no DOM. The host wiring lives in
// folderConsentHost.ts.

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { denialCopy, denialToolText, type Denial } from "./denialSource.ts";
import { FREE_FOLDER_COUNT } from "./seatVocabulary.ts";
import type { ResolvedProfile } from "./protocol";

export type FolderConsentLevel = "full" | "read" | "none";

/** globalState key: { [activityId]: { [canonicalFolder]: { level, at } } }. */
export const FOLDER_CONSENT_KEY = "hps.folderConsent.v1";

/** The three choices in the order they are offered: the narrowest grant first is not the default. */
export const FOLDER_CONSENT_LABEL: Readonly<Record<FolderConsentLevel, string>> = {
  read: "읽기만 허용 (고치기·명령은 안 함)",
  full: "읽기·고치기·명령 실행 모두 허용",
  none: "이 폴더에서는 AI를 쓰지 않음",
};
/** Offer order. The safe-but-useful choice is first, so Enter never grants commands. */
export const FOLDER_CONSENT_ORDER: readonly FolderConsentLevel[] = ["read", "full", "none"];

/** The single command that changes a remembered choice. */
export const FOLDER_CONSENT_COMMAND = "hypeproof-chat.changeFolderAiPermission";
export const FOLDER_CONSENT_COMMAND_TITLE = "이 폴더의 AI 권한 바꾸기";

export const FOLDER_CONSENT_TITLE = "이 폴더에서 작업할까요?";
export function folderConsentDetail(folder: string): string {
  return [
    folder,
    "",
    "이 폴더는 이 활동의 작업 폴더가 아니에요. Studio의 AI가 여기서 무엇을 해도 되는지 골라 주세요.",
    "• 읽기: 파일 내용을 봐요",
    "• 고치기: 파일을 만들고 바꿔요",
    "• 명령 실행: 프로그램을 실행해요",
    `나중에 ‘${FOLDER_CONSENT_COMMAND_TITLE}’로 바꿀 수 있어요.`,
  ].join("\n");
}

/** Shown when the learner closes the question without choosing: nothing is remembered. */
export const FOLDER_CONSENT_UNDECIDED =
  "이 폴더에서 AI가 할 수 있는 일을 고른 뒤 다시 보내 주세요. 입력은 그대로 두었어요.";

const upperDrive = (p: string) => p.replace(/^[a-z]:/, (d) => d.toUpperCase());

/**
 * The one spelling of a folder for stored decisions: symlinks resolved, the on-disk case
 * (realpath.native reports it on case-insensitive volumes), an upper-case drive letter.
 * Two spellings of one folder share a decision; two distinct folders on a case-sensitive
 * volume do not.
 */
export function canonicalFolder(p: string, realpath: (p: string) => string = fs.realpathSync.native): string {
  return upperDrive(path.normalize(realpath(path.resolve(p))));
}

/** The served `workspace_root` as an absolute path (`~/` expanded), or null when unusable. */
export function servedHome(raw: string | null | undefined, home: string = os.homedir()): string | null {
  const v = (raw ?? "").trim();
  if (!v) return null;
  const expanded = v === "~" ? home : v.startsWith("~/") || v.startsWith("~\\") ? path.join(home, v.slice(2)) : v;
  return path.isAbsolute(expanded) ? expanded : null;
}

/**
 * Seats that ask: personal work (personal, trial, a bought pass), never a classroom seat,
 * never a seat with a served lesson, never the instructor surface.
 */
export function folderConsentApplies(
  profile: Pick<ResolvedProfile, "activity_kind" | "pass" | "lesson" | "lesson_binding"> | null | undefined,
  instructor = false,
): boolean {
  if (!profile || instructor) return false;
  if (profile.activity_kind === "classroom") return false;
  if (profile.lesson || profile.lesson_binding?.enforced) return false;
  return profile.activity_kind === "personal" || profile.activity_kind === "trial" || !!profile.pass;
}

/**
 * Is `folder` the activity's own work folder? Both arguments are canonical. Own means
 * exactly the served home folder or a folder inside it. A look-alike sibling
 * (`<home>-taxes`, `<home>Clinic`) is not own, and neither is a sibling Studio created
 * (`<home>-N`, `<home>-<repo>`): those ask once. No served home → no folder is own.
 * The one exception is the free seat (`isFreeSeatFolder`).
 */
export function isOwnFolder(folder: string, home: string | null | undefined): boolean {
  if (!home) return false;
  if (folder === home) return true;
  const rel = path.relative(home, folder);
  return !!rel && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/**
 * REQ-STUDIO-FREE-START / BB-005 (Jay 2026-10-20: a free start never stops and never asks) —
 * the folders Studio itself creates for a free seat are that seat's own: the served home and
 * the numbered siblings free start falls back to when the home is held (`<home>-2` …
 * `<home>-20`, see `freeFolderCandidates`). Exact names only: `<home>-taxes`, `<home>-21`,
 * `<home>-02` and every folder the learner picks elsewhere still ask. Both arguments canonical.
 */
export function isFreeSeatFolder(folder: string, home: string | null | undefined): boolean {
  if (!home) return false;
  for (let n = 1; n <= FREE_FOLDER_COUNT; n++) {
    if (isOwnFolder(folder, n === 1 ? home : `${home}-${n}`)) return true;
  }
  return false;
}

/** Is `target` the folder itself or inside it? Both canonical. */
export function isInsideFolder(target: string, folder: string): boolean {
  if (target === folder) return true;
  const rel = path.relative(folder, target);
  return !!rel && !rel.startsWith("..") && !path.isAbsolute(rel);
}

export type FolderConsentStore = Record<string, Record<string, { level: FolderConsentLevel; at: number }>>;

const isLevel = (v: unknown): v is FolderConsentLevel => v === "full" || v === "read" || v === "none";

/** The remembered level, or undefined (a malformed entry is undecided: ask again, never widen). */
export function readFolderConsent(store: unknown, activityId: string, folder: string): FolderConsentLevel | undefined {
  if (!store || typeof store !== "object") return undefined;
  const perActivity = Object.prototype.hasOwnProperty.call(store, activityId) ? (store as Record<string, unknown>)[activityId] : undefined;
  if (!perActivity || typeof perActivity !== "object") return undefined;
  const entry = Object.prototype.hasOwnProperty.call(perActivity, folder) ? (perActivity as Record<string, unknown>)[folder] : undefined;
  const level = entry && typeof entry === "object" ? (entry as { level?: unknown }).level : undefined;
  return isLevel(level) ? level : undefined;
}

/** A new store with one decision set; other activities and folders are untouched. */
export function writeFolderConsent(store: unknown, activityId: string, folder: string, level: FolderConsentLevel, at = Date.now()): FolderConsentStore {
  const base: FolderConsentStore = store && typeof store === "object" ? { ...(store as FolderConsentStore) } : {};
  const perActivity = base[activityId] && typeof base[activityId] === "object" ? { ...base[activityId] } : {};
  perActivity[folder] = { level, at };
  base[activityId] = perActivity;
  return base;
}

/** What the folder choice removed, read by the tool gates to name the source (폴더 권한). */
export const FOLDER_REMOVED_FEATURES: unique symbol = Symbol("hps.folderRemovedFeatures");
type FolderNarrowed = ResolvedProfile & { [FOLDER_REMOVED_FEATURES]?: readonly string[] };

export function folderRemovedFeatures(profile: ResolvedProfile | null | undefined): ReadonlySet<string> {
  return new Set((profile as FolderNarrowed | null | undefined)?.[FOLDER_REMOVED_FEATURES] ?? []);
}

/**
 * The turn's profile under a folder choice. `full` returns the same object; `read` turns
 * off write, shell and site publishing, recording only the grants that were on. It
 * never sets a grant to true. `none` is not a narrowing: the host refuses the turn.
 */
export function narrowForFolder(profile: ResolvedProfile, level: Exclude<FolderConsentLevel, "none">): ResolvedProfile {
  if (level === "full") return profile;
  const t = profile.sdk_tools;
  const removed: string[] = [];
  if (t?.write) removed.push("write");
  if (t?.shell) removed.push("shell");
  if (profile.publishing?.enabled === true) removed.push("publish");
  const narrowed: FolderNarrowed = {
    ...profile,
    sdk_tools: t ? { ...t, write: false, shell: false } : undefined,
    publishing: profile.publishing ? { ...profile.publishing, enabled: false } : profile.publishing,
  };
  narrowed[FOLDER_REMOVED_FEATURES] = [...folderRemovedFeatures(profile), ...removed];
  return narrowed;
}

/** Shown when a personal seat has a folder open but no activity to remember the choice for. */
export const FOLDER_CONSENT_NO_ACTIVITY = denialCopy(
  { source: "unknown", feature: "AI", reason: "이 활동을 확인하지 못해 이 폴더의 AI 권한을 정할 수 없어요", next: "활동에 다시 연결한 뒤 보내 주세요" },
  "solo",
);

/** Only "모두 허용" lets Studio write into a non-own folder; read-only, no-AI and undecided do not. */
export const folderWriteAllowed = (level: FolderConsentLevel | undefined): boolean => level === "full";

/** The one line a learner sees when Studio did not save a file because of the folder choice. */
export const folderReadOnlyNotice = (): string =>
  denialCopy({ source: "folder", feature: "파일 저장", next: "답은 화면에서 볼 수 있어요. 저장하려면 ‘이 폴더의 AI 권한 바꾸기’에서 다시 골라 주세요" });

/** The learner-facing refusal for a turn in a folder where the learner chose "AI 안 씀". */
export const folderNoAiCopy = (): string => denialCopy({ source: "folder", feature: "AI" });

/** The coach-facing text for a tool the folder choice removed. */
export const folderToolDenial = (d: Omit<Denial, "source">): string => denialToolText({ source: "folder", ...d });

export type FolderConsentDecision =
  | { kind: "skip" } // not a personal seat, or the activity's own folder
  | { kind: "ask"; folder: string }
  | { kind: "apply"; folder: string; level: FolderConsentLevel }
  | { kind: "refuse"; message: string }; // a personal seat in a folder, but no activity to key the choice by

/** What the host does before a turn. Pure: the caller passes canonical paths. */
export function folderConsentDecision(args: {
  applies: boolean;
  /** A free seat (`isFreeSeat`): its app-created numbered folders count as own too. */
  freeSeat?: boolean;
  activityId: string | null | undefined;
  folder: string | null | undefined;
  home: string | null | undefined;
  store: unknown;
}): FolderConsentDecision {
  if (!args.applies || !args.folder) return { kind: "skip" };
  if (isOwnFolder(args.folder, args.home)) return { kind: "skip" };
  if (args.freeSeat && isFreeSeatFolder(args.folder, args.home)) return { kind: "skip" };
  // Fail closed: without an activity id the choice cannot be remembered, so the AI is not used.
  if (!args.activityId) return { kind: "refuse", message: FOLDER_CONSENT_NO_ACTIVITY };
  const level = readFolderConsent(args.store, args.activityId, args.folder);
  return level ? { kind: "apply", folder: args.folder, level } : { kind: "ask", folder: args.folder };
}
