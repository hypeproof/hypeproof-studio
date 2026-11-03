// #3221 part 4 — opens System Settings › Privacy & Security › Files and Folders. Not a learner link: a fixed
// system-settings URL, macOS only, never supplied by the webview. Kept out of chatPanelProvider, whose single
// system-browser exit stays the confirmed learner-link branch (external-link-route.smoke).
import * as vscode from "vscode";
import { MAC_PRIVACY_FILES_URL } from "./denialNotice";

export async function openMacPrivacySettings(platform: string = process.platform): Promise<boolean> {
  if (platform !== "darwin") return false;
  return vscode.env.openExternal(vscode.Uri.parse(MAC_PRIVACY_FILES_URL));
}
