// Host wiring for REQ-STUDIO-FOLDER-CONSENT (CGP-KNOW-R-010). The decisions are pure in
// folderConsent.ts; this file only reads the window's folder and activity, asks with a
// native modal, stores the answer in globalState, and answers the one write question
// (`folderWriteRefusal`) every host-side write into the open folder asks first.

import * as path from "node:path";
import * as vscode from "vscode";
import { activityConnections } from "./activityConnections";
import {
  canonicalFolder,
  FOLDER_CONSENT_COMMAND_TITLE,
  FOLDER_CONSENT_KEY,
  FOLDER_CONSENT_LABEL,
  FOLDER_CONSENT_ORDER,
  FOLDER_CONSENT_TITLE,
  FOLDER_CONSENT_UNDECIDED,
  folderConsentApplies,
  folderConsentDecision,
  folderConsentDetail,
  folderNoAiCopy,
  folderReadOnlyNotice,
  folderWriteAllowed,
  isInsideFolder,
  narrowForFolder,
  readFolderConsent,
  servedHome,
  writeFolderConsent,
  type FolderConsentLevel,
} from "./folderConsent.ts";
import type { ResolvedProfile } from "./protocol";
import { TurnToolModeError } from "./turnTools";

/** A refused turn. Extends TurnToolModeError so the send path keeps the input and shows the copy. */
export class FolderConsentRefusal extends TurnToolModeError {}

export interface FolderConsentOpts { servedRoot: string | null | undefined; instructor?: boolean }

const tryCanon = (p: string | null | undefined): string | undefined => {
  if (!p) return undefined;
  try { return canonicalFolder(p); } catch { return undefined; }
};

/** The canonical spelling of a path that may not exist yet: its nearest existing ancestor, resolved. */
function canonTarget(p: string): string {
  let probe = path.resolve(p);
  const rest: string[] = [];
  for (;;) {
    const c = tryCanon(probe);
    if (c) return path.join(c, ...rest.reverse());
    const up = path.dirname(probe);
    if (up === probe) return path.resolve(p);
    rest.push(path.basename(probe));
    probe = up;
  }
}

interface Scope { activityId?: string; folder: string; home?: string }

function scopeFor(context: vscode.ExtensionContext, profile: ResolvedProfile, servedRoot: string | null | undefined): Scope | undefined {
  // A folder that cannot be resolved is still keyed (never skipped): unresolved means ask.
  const open = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const folder = tryCanon(open) ?? (open ? path.resolve(open) : undefined);
  if (!folder) return undefined;
  const activityId = activityConnections(context)?.current?.id ?? profile.activity_id ?? undefined;
  // A home that does not exist yet is still compared exactly.
  const raw = servedHome(servedRoot);
  const home = raw ? canonTarget(raw) : undefined;
  return { ...(activityId ? { activityId } : {}), folder, ...(home ? { home } : {}) };
}

async function ask(folder: string): Promise<FolderConsentLevel | undefined> {
  const picked = await vscode.window.showWarningMessage(
    FOLDER_CONSENT_TITLE,
    { modal: true, detail: folderConsentDetail(folder) },
    ...FOLDER_CONSENT_ORDER.map((level) => FOLDER_CONSENT_LABEL[level]),
  );
  return FOLDER_CONSENT_ORDER.find((level) => FOLDER_CONSENT_LABEL[level] === picked);
}

async function remember(context: vscode.ExtensionContext, activityId: string, folder: string, level: FolderConsentLevel): Promise<void> {
  await context.globalState.update(FOLDER_CONSENT_KEY, writeFolderConsent(context.globalState.get(FOLDER_CONSENT_KEY), activityId, folder, level));
}

function decide(context: vscode.ExtensionContext, profile: ResolvedProfile | null | undefined, opts: FolderConsentOpts) {
  const applies = !!profile && folderConsentApplies(profile, opts.instructor === true);
  const scope = applies && profile ? scopeFor(context, profile, opts.servedRoot) : undefined;
  // The store is read only for a seat and folder that can ask.
  if (!scope) return { scope, decision: { kind: "skip" } as const };
  return { scope, decision: folderConsentDecision({ applies, activityId: scope.activityId, folder: scope.folder, home: scope.home, store: context.globalState.get(FOLDER_CONSENT_KEY) }) };
}

/**
 * The turn's profile under the learner's folder choice. Asks once when the open folder is
 * not the personal activity's own; `none` (or closing the question, or no activity to
 * remember it for) refuses. The result is the given profile or a narrower copy — never wider.
 * Every model call from the host passes here first: the chat turn, the skills
 * (`completeSkill`) and image editing.
 */
export async function folderConsentProfile(context: vscode.ExtensionContext, profile: ResolvedProfile, opts: FolderConsentOpts): Promise<ResolvedProfile> {
  const { scope, decision } = decide(context, profile, opts);
  if (decision.kind === "skip" || !scope) return profile;
  if (decision.kind === "refuse") throw new FolderConsentRefusal(decision.message);
  let level = decision.kind === "apply" ? decision.level : undefined;
  if (decision.kind === "ask") {
    level = await ask(decision.folder);
    if (!level) throw new FolderConsentRefusal(FOLDER_CONSENT_UNDECIDED);
    await remember(context, scope.activityId!, scope.folder, level);
  }
  if (level === "none") throw new FolderConsentRefusal(folderNoAiCopy());
  return narrowForFolder(profile, level === "full" ? "full" : "read");
}

/**
 * The single write question. Every host-side write into the open folder (the reply's
 * index.html, engine.js, archives, agent.md, pasted and attached images, the learning
 * wiki, image edits, preview saves) asks here first. Returns null when the write may go
 * ahead, else the one learner line to show instead. Never asks: a write follows a turn
 * that already asked, and an undecided folder is treated as not writable (fail closed).
 * A target outside the open folder is not this guard's business.
 */
export function folderWriteRefusal(context: vscode.ExtensionContext, profile: ResolvedProfile | null | undefined, opts: FolderConsentOpts, target: string): string | null {
  const { scope, decision } = decide(context, profile, opts);
  if (!scope || decision.kind === "skip") return null;
  if (!isInsideFolder(canonTarget(target), scope.folder)) return null;
  if (decision.kind === "refuse") return decision.message;
  return folderWriteAllowed(decision.kind === "apply" ? decision.level : undefined) ? null : folderReadOnlyNotice();
}

/** "이 폴더의 AI 권한 바꾸기": change the remembered choice for the open folder. */
export async function changeFolderConsent(
  context: vscode.ExtensionContext,
  profile: ResolvedProfile | null,
  opts: FolderConsentOpts,
): Promise<FolderConsentLevel | undefined> {
  const scope = profile && folderConsentApplies(profile, opts.instructor === true) ? scopeFor(context, profile, opts.servedRoot) : undefined;
  if (!profile || !scope) {
    void vscode.window.showInformationMessage("지금 열린 폴더에는 따로 정할 AI 권한이 없어요. 개인 활동에서 다른 폴더를 열었을 때 고를 수 있어요.");
    return undefined;
  }
  const decision = folderConsentDecision({ applies: true, activityId: scope.activityId, folder: scope.folder, home: scope.home, store: undefined });
  if (decision.kind === "skip") {
    void vscode.window.showInformationMessage("이 폴더는 이 활동의 작업 폴더라 AI가 활동 설정대로 일해요.");
    return undefined;
  }
  if (decision.kind === "refuse" || !scope.activityId) {
    void vscode.window.showWarningMessage(decision.kind === "refuse" ? decision.message : FOLDER_CONSENT_UNDECIDED);
    return undefined;
  }
  const current = readFolderConsent(context.globalState.get(FOLDER_CONSENT_KEY), scope.activityId, scope.folder);
  const items = FOLDER_CONSENT_ORDER.map((level) => ({
    level,
    label: FOLDER_CONSENT_LABEL[level],
    ...(level === current ? { description: "지금 설정" } : {}),
  }));
  const picked = await vscode.window.showQuickPick(items, { title: FOLDER_CONSENT_COMMAND_TITLE, placeHolder: scope.folder, ignoreFocusOut: true });
  if (!picked) return undefined;
  await remember(context, scope.activityId, scope.folder, picked.level);
  return picked.level;
}
