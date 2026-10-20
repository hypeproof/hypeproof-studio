import * as vscode from "vscode";
import { outboundDetails, type OutboundManifest } from "./outboundConsent.ts";
/** No persisted approval, no preselected checkbox; closing or Cancel authorizes nothing. */
export async function confirmOutbound(manifest: OutboundManifest): Promise<boolean> {
  const detail = outboundDetails(manifest);
  if (!detail) return false;
  return await vscode.window.showWarningMessage("보내기 전에 확인해 주세요", { modal: true, detail }, "확인하고 보내기") === "확인하고 보내기";
}
