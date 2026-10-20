// Host wiring for REQ-STUDIO-FOLDER-CONSENT (CGP-KNOW-R-010). The decisions are pure in
// folderConsent.ts; this file only reads the window's folder and activity, asks with a
// native modal, and stores the answer in globalState.

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

const tryCanon = (p: string | null | undefined): string | undefined => {
  if (!p) return undefined;
  try { return canonicalFolder(p); } catch { return undefined; }
};

interface Scope { activityId: string; folder: string; home?: string }

function scopeFor(context: vscode.ExtensionContext, profile: ResolvedProfile, servedRoot: string | null | undefined): Scope | undefined {
  // A folder that cannot be resolved is still keyed (never skipped): unresolved means ask.
  const open = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  const folder = tryCanon(open) ?? (open ? path.resolve(open) : undefined);
  const activityId = activityConnections(context)?.current?.id ?? profile.activity_id;
  if (!folder || !activityId) return undefined;
  // A home that does not exist yet still names its siblings: canonicalize its parent.
  const raw = servedHome(servedRoot);
  const home = raw ? tryCanon(raw) ?? path.join(tryCanon(path.dirname(raw)) ?? path.dirname(raw), path.basename(raw)) : undefined;
  return { activityId, folder, home };
}

async function ask(folder: string): Promise<FolderConsentLevel | undefined> {
  const picked = await vscode.window.showWarningMessage(
    FOLDER_CONSENT_TITLE,
    { modal: true, detail: folderConsentDetail(folder) },
    ...FOLDER_CONSENT_ORDER.map((level) => FOLDER_CONSENT_LABEL[level]),
  );
  return FOLDER_CONSENT_ORDER.find((level) => FOLDER_CONSENT_LABEL[level] === picked);
}

async function remember(context: vscode.ExtensionContext, scope: Scope, level: FolderConsentLevel): Promise<void> {
  await context.globalState.update(FOLDER_CONSENT_KEY, writeFolderConsent(context.globalState.get(FOLDER_CONSENT_KEY), scope.activityId, scope.folder, level));
}

/**
 * The turn's profile under the learner's folder choice. Asks once when the open folder is
 * not the personal activity's own; `none` (or closing the question) refuses the turn. The
 * result is the given profile or a narrower copy of it — never wider.
 */
export async function folderConsentProfile(
  context: vscode.ExtensionContext,
  profile: ResolvedProfile,
  opts: { servedRoot: string | null | undefined; instructor?: boolean },
): Promise<ResolvedProfile> {
  const applies = folderConsentApplies(profile, opts.instructor === true);
  const scope = applies ? scopeFor(context, profile, opts.servedRoot) : undefined;
  // The store is read only for a seat and folder that can ask.
  if (!scope) return profile;
  const decision = folderConsentDecision({
    applies, activityId: scope.activityId, folder: scope.folder, home: scope.home,
    store: context.globalState.get(FOLDER_CONSENT_KEY),
  });
  if (decision.kind === "skip") return profile;
  let level = decision.kind === "apply" ? decision.level : undefined;
  if (decision.kind === "ask") {
    level = await ask(decision.folder);
    if (!level) throw new FolderConsentRefusal(FOLDER_CONSENT_UNDECIDED);
    await remember(context, scope, level);
  }
  if (level === "none") throw new FolderConsentRefusal(folderNoAiCopy());
  return narrowForFolder(profile, level === "full" ? "full" : "read");
}

/** "이 폴더의 AI 권한 바꾸기": change the remembered choice for the open folder. */
export async function changeFolderConsent(
  context: vscode.ExtensionContext,
  profile: ResolvedProfile | null,
  opts: { servedRoot: string | null | undefined; instructor?: boolean },
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
  const current = readFolderConsent(context.globalState.get(FOLDER_CONSENT_KEY), scope.activityId, scope.folder);
  const items = FOLDER_CONSENT_ORDER.map((level) => ({
    level,
    label: FOLDER_CONSENT_LABEL[level],
    ...(level === current ? { description: "지금 설정" } : {}),
  }));
  const picked = await vscode.window.showQuickPick(items, { title: FOLDER_CONSENT_COMMAND_TITLE, placeHolder: scope.folder, ignoreFocusOut: true });
  if (!picked) return undefined;
  await remember(context, scope, picked.level);
  return picked.level;
}

