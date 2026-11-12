// The OS microphone privacy pane, opened from the permission card (CGP-VOICE-R-003). Kept out of
// chatPanelProvider.ts on purpose: that file keeps exactly one confirmed system-browser exit
// (test/macos-privacy-denial.smoke.mjs). The URI comes from the platform table in voiceHost.ts and
// never from the webview.
import * as vscode from "vscode";
import { micSettingsUri } from "./voiceHost";

/** True when the OS accepted the handoff. False on an unknown platform or a refusal; never throws. */
export async function openMicrophoneSettings(platform: string = process.platform): Promise<boolean> {
  const uri = micSettingsUri(platform);
  if (!uri) return false;
  try { return await vscode.env.openExternal(vscode.Uri.parse(uri)); } catch { return false; }
}
