// The "덱 장 다듬기" panel host (CGP-ART-D-016). One panel per window. It turns the panel into two awaitable
// steps for ChatPanelProvider.deckSlideSuggest: pick (the learner presses a chip under a slide) and propose
// (the learner answers 반영 or 그대로 for one proposal). A message counts only with this panel's nonce, only in the
// step that is waiting for it, and a decision only for the current proposal's request id; closing the panel
// answers whatever is waiting with undefined, which writes nothing.
import * as vscode from "vscode";
import { randomBytes } from "node:crypto";
import { slideStudioHtml, type StudioProposal, type StudioView } from "./slideStudio";
import type { SlideChip } from "./slideSuggestion";

export interface SlideStudioUi {
  /** Shows the slides; resolves with the learner's chip, or undefined once the panel is closed. */
  pick(view: StudioView): Promise<{ no: number; chip: SlideChip } | undefined>;
  /** Shows one proposal; resolves true for 반영, false for 그대로 (or Esc), undefined once the panel is closed. */
  propose(proposal: StudioProposal): Promise<boolean | undefined>;
  readonly closed: boolean;
  reveal(): void;
  dispose(): void;
}

/** A chip message is valid only for a slide and chip the posted view offers. */
export function validChip(view: StudioView, m: unknown): { no: number; chip: SlideChip } | undefined {
  const x = m as { no?: unknown; chip?: unknown };
  if (!Number.isInteger(x?.no) || typeof x?.chip !== "string") return undefined;
  const slide = view.slides.find((s) => s.no === x.no);
  const chip = slide?.chips.find((c) => c.id === x.chip);
  return slide && chip ? { no: slide.no, chip: chip.id } : undefined;
}

export function openSlideStudio(): SlideStudioUi {
  const nonce = randomBytes(18).toString("hex");
  let panel: vscode.WebviewPanel | undefined;
  let closed = false;
  let waiting:
    | { kind: "pick"; view: StudioView; resolve: (v: { no: number; chip: SlideChip } | undefined) => void }
    | { kind: "propose"; req: string; resolve: (v: boolean | undefined) => void }
    | undefined;
  const settle = () => { const w = waiting; waiting = undefined; return w; };
  const ensure = (view: StudioView) => {
    if (panel) return false;
    panel = vscode.window.createWebviewPanel("hypeproof.slideStudio", "덱 장 다듬기", vscode.ViewColumn.Active, { enableScripts: true, localResourceRoots: [] });
    panel.webview.html = slideStudioHtml(view, nonce);
    panel.onDidDispose(() => { closed = true; panel = undefined; settle()?.resolve(undefined); });
    panel.webview.onDidReceiveMessage((m: { nonce?: unknown; type?: unknown; req?: unknown; accept?: unknown }) => {
      if (m?.nonce !== nonce || !waiting) return;
      if (m.type === "chip" && waiting.kind === "pick") {
        const pick = validChip(waiting.view, m);
        if (pick) (settle() as { resolve: (v: typeof pick) => void }).resolve(pick);
      } else if (m.type === "decide" && waiting.kind === "propose" && m.req === waiting.req && typeof m.accept === "boolean") {
        (settle() as { resolve: (v: boolean) => void }).resolve(m.accept);
      }
    });
    return true;
  };
  return {
    get closed() { return closed; },
    pick(view) {
      if (closed) return Promise.resolve(undefined);
      settle()?.resolve(undefined);
      return new Promise((resolve) => {
        waiting = { kind: "pick", view, resolve };
        if (!ensure(view)) void panel!.webview.postMessage({ nonce, type: "view", view });
      });
    },
    propose(proposal) {
      if (closed || !panel) return Promise.resolve(undefined);
      settle()?.resolve(undefined);
      return new Promise((resolve) => {
        waiting = { kind: "propose", req: proposal.req, resolve };
        void panel!.webview.postMessage({ nonce, type: "proposal", proposal });
      });
    },
    reveal() { panel?.reveal(); },
    dispose() { panel?.dispose(); },
  };
}
