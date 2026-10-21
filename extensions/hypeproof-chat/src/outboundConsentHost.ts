import * as vscode from "vscode";
import { outboundDetails, type OutboundManifest } from "./outboundConsent.ts";

/**
 * CGP-KNOW-D-006: the chat panel's in-panel dialog. `null` means it could not be shown (no visible panel), and only then
 * does the VS Code modal below ask instead. A shown dialog's answer is final: a cancel never falls through to a second ask.
 */
export type OutboundPresenter = (manifest: OutboundManifest) => Promise<boolean | null>;
let presenter: OutboundPresenter | undefined;
export function setOutboundPresenter(next: OutboundPresenter): { dispose(): void } {
  presenter = next;
  return { dispose: () => { if (presenter === next) presenter = undefined; } };
}

/** No persisted approval, no preselected checkbox; closing or Cancel authorizes nothing. */
export async function confirmOutbound(manifest: OutboundManifest): Promise<boolean> {
  const detail = outboundDetails(manifest);
  if (!detail) return false;
  const shown = presenter ? await presenter(manifest).catch(() => false) : null;
  if (shown !== null) return shown === true;
  return await vscode.window.showWarningMessage("보내기 전에 확인해 주세요", { modal: true, detail }, "확인하고 보내기") === "확인하고 보내기";
}
