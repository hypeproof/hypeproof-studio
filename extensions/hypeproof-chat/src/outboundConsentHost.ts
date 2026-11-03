import * as vscode from "vscode";
import { outboundDetails, type OutboundManifest } from "./outboundConsent.ts";

/**
 * CGP-KNOW-D-006: the chat panel's in-panel dialog. `null` means it could not be shown (no visible panel), and only then
 * does the VS Code modal below ask instead. A shown dialog's answer is final: a cancel never falls through to a second ask.
 * CGP-KNOW-R-007: `step: "public"` is the separate public-audience decision. It is only ever asked in the panel.
 */
export type OutboundPresenter = (manifest: OutboundManifest, step: "content" | "public") => Promise<boolean | null>;
let presenter: OutboundPresenter | undefined;
export function setOutboundPresenter(next: OutboundPresenter): { dispose(): void } {
  presenter = next;
  return { dispose: () => { if (presenter === next) presenter = undefined; } };
}

/** CGP-KNOW-R-007: a native dialog's default button confirms on Enter, so public publication never asks natively. */
export const PUBLIC_NEEDS_PANEL = "인터넷의 누구나 볼 수 있게 공개하는 일은 채팅 창 안에서만 확인할 수 있어요. 채팅 창을 열어 둔 채로 다시 해 주세요. 아무것도 보내지 않았어요.";
export const OUTBOUND_BUSY = "다른 보내기 확인 창이 열려 있어서 이번 요청은 보내지 않았어요. 열려 있는 창을 먼저 마무리해 주세요.";

let confirming = false;
/** No persisted approval. Public disclosure requires a separate in-panel decision after the content checklist. */
export async function confirmOutbound(manifest: OutboundManifest): Promise<boolean> {
  if (confirming) { void vscode.window.showInformationMessage(OUTBOUND_BUSY); return false; }
  confirming = true;
  try {
    const frozen = structuredClone(manifest);
    const detail = outboundDetails(frozen);
    if (!detail) return false;
    const ask = (step: "content" | "public") => presenter ? presenter(frozen, step).catch(() => false) : Promise.resolve(null);
    const shown = await ask("content");
    if (shown === null) {
      // Panel hidden: a cohort-only send may still use the native modal; a public one is refused, not asked.
      if (frozen.public) { void vscode.window.showInformationMessage(PUBLIC_NEEDS_PANEL); return false; }
      return await vscode.window.showWarningMessage("보내기 전에 확인해 주세요", { modal: true, detail }, "확인하고 보내기") === "확인하고 보내기";
    }
    if (shown !== true) return false;
    if (!frozen.public) return true;
    const audience = await ask("public");
    if (audience === null) { void vscode.window.showInformationMessage(PUBLIC_NEEDS_PANEL); return false; }
    return audience === true;
  } finally {
    confirming = false;
  }
}
