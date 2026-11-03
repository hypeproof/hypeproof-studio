import * as vscode from "vscode";
import { CdpSession } from "./cdpSession";
import type { PageTextSource } from "./pageContext";

// Native integrated browser wiring (#278).
//
// VS Code 1.116 ships an integrated browser (Electron WebContentsView, rendered
// in editor tabs) reachable via the `browser` proposed API
// (vscode.proposed.browser.d.ts, vendored alongside this file). That proposal is
// enabled for this built-in extension via product.json
// `extensionEnabledApiProposals` — see scripts/apply-product-overrides.sh.
//
// This module is the extension-host browser primitives only. The chat-turn
// injection + the page_context/image_paste gates live in chatPanelProvider.

/** Captured context from a browser tab, ready to feed to the coach (Q2). */
export interface PageContext {
  url: string;
  title: string;
  /** JPEG screenshot of the visible viewport, base64 (no `data:` prefix). */
  imageBase64: string;
  /** Body text (including off-screen text) only from the current own preview. */
  text: string;
  /** Retained for compatibility; context attachments no longer collect AX trees. */
  axNodeCount: number;
  /**
   * Why `text` is what it is, so the learner copy can say what was attached:
   * "own" = read from the own preview (may still be empty), "not-own" = the live
   * document is not this window's own preview, "owner-unknown" = no own preview
   * is known, so ownership could not be confirmed. Both withheld cases send no text.
   */
  textSource: PageTextSource;
}


/** Open (or reveal) a native browser tab at `url`. Q1. */
export async function openBrowser(urlInput?: string): Promise<void> {
  let url = urlInput;
  if (!url) {
    url = await vscode.window.showInputBox({
      prompt: "열 주소 (URL)",
      placeHolder: "https://example.com  ·  http://localhost:5173  ·  /path/to/index.html",
      value: "https://",
      ignoreFocusOut: true,
    });
  }
  if (!url) return;
  await vscode.window.openBrowserTab(normalizeUrl(url), { viewColumn: vscode.ViewColumn.Beside });
}

function normalizeUrl(input: string): string {
  const v = input.trim();
  if (/^(https?|file):\/\//i.test(v)) return v;
  if (/^localhost(:\d+)?(\/|$)/i.test(v)) return `http://${v}`;
  if (v.startsWith("/")) return vscode.Uri.file(v).toString();
  return `https://${v}`;
}

/**
 * Capture a viewport screenshot and own-preview body text via tab-scoped CDP.
 *
 * Uses CdpSession, which does the Target.attachToTarget handshake first — the
 * #278 spike proved page-level CDP methods (Page.captureScreenshot,
 * Runtime.evaluate, Accessibility.*) are "Method not found" without it.
 */
export async function capturePageContext(
  tab: vscode.BrowserTab,
  ownPreviewUrl: () => string | undefined = () => undefined,
): Promise<PageContext> {
  // Only actual integrated tabs in this window may supply context. A stale or
  // fabricated handle must not open a CDP channel to another surface.
  if (!(vscode.window.browserTabs ?? []).includes(tab)) throw new Error("미리보기 탭을 다시 선택해 주세요.");
  const url = tab.url;
  const title = tab.title;
  const preview = ownPreviewUrl();
  let origin = "";
  try {
    const parsed = new URL(preview ?? "");
    if (["http:", "https:"].includes(parsed.protocol)) origin = parsed.origin;
  } catch { /* Unknown ownership grants no DOM access. */ }
  const session = await CdpSession.attach(tab);
  try {
    const shot = await session.send("Page.captureScreenshot", { format: "jpeg", quality: 70 });
    // Check the document's actual origin in the SAME evaluation that reads it:
    // tab.url can lag behind navigation. Never collect an external DOM/AX tree.
    // A document that fails the check yields null (withheld), not "" (empty page).
    const textRes = await session.send("Runtime.evaluate", {
      expression: `["http:", "https:"].includes(location.protocol) && location.origin === ${JSON.stringify(origin)} && location.href === ${JSON.stringify(url)} ? (document.body ? document.body.innerText : '') : null`,
      returnByValue: true,
    });
    if (!(vscode.window.browserTabs ?? []).includes(tab) || tab.url !== url || ownPreviewUrl() !== preview) {
      throw new Error("페이지가 바뀌었어요. 다시 첨부해 주세요.");
    }
    const value = textRes?.result?.value;
    const own = !!origin && typeof value === "string";
    return {
      url, title,
      imageBase64: String(shot?.data ?? ""),
      text: own ? value.slice(0, 4000) : "",
      axNodeCount: 0,
      textSource: own ? "own" : origin ? "not-own" : "owner-unknown",
    };
  } finally {
    await session.close();
  }
}

/**
 * Capture the currently active browser tab. Returns null (with a nudge) when no
 * tab is open or capture fails — callers should bail quietly.
 */
export async function captureActivePage(ownPreviewUrl: () => string | undefined = () => undefined): Promise<PageContext | null> {
  const tab = vscode.window.activeBrowserTab;
  if (!tab) {
    vscode.window.showWarningMessage(
      "HypeProof: 먼저 브라우저 탭을 열어주세요 (명령: HypeProof: 브라우저 열기).",
    );
    return null;
  }
  try {
    return await capturePageContext(tab, ownPreviewUrl);
  } catch (err) {
    vscode.window.showErrorMessage(
      `HypeProof: 페이지 캡처 실패 — ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

/** The chat provider surface the "페이지를 코치에게" command needs. */
export interface PageToCoachTarget {
  isPageContextEnabled(): boolean;
  postPageNotice(label: string): void;
  attachPageContext(ctx: { url: string; title: string; text: string; imageBase64?: string; textSource: PageTextSource }): void;
}

/**
 * The `hypeproof-chat.sendPageToCoach` command body (CGP-VOICE-R-010). The own-preview
 * owner comes from Studio's own preview server, never from the tab being captured:
 * a tab cannot vouch for itself, or every external page would count as "own".
 */
export async function sendActivePageToCoach(
  provider: PageToCoachTarget,
  previewServer: { currentUrl(): string | undefined },
): Promise<void> {
  // Per-cohort gate (default off → minor-safe). Worker emits input.page_context
  // via /v1/profile; the host enforces it here for the text-injection path.
  if (!provider.isPageContextEnabled()) {
    // #308 — inline notice, not a toast: same trigger path, same freeze
    // mechanism (any visible toast pauses the integrated browser). Focus
    // the panel so the notice is actually visible; if the webview isn't
    // mounted yet, the pending-notice flush on "ready" delivers it.
    provider.postPageNotice("이 코호트에서는 '페이지를 코치에게' 기능이 꺼져 있어요.");
    await vscode.commands.executeCommand("hypeproof-chat.panel.focus");
    return;
  }
  const ctx = await captureActivePage(() => previewServer.currentUrl());
  if (!ctx) return;
  // #278 Phase 2 — attach the screenshot too (image_paste-gated inside).
  provider.attachPageContext({
    url: ctx.url,
    title: ctx.title,
    text: ctx.text,
    imageBase64: ctx.imageBase64,
    textSource: ctx.textSource,
  });
  await vscode.commands.executeCommand("hypeproof-chat.panel.focus");
  // #308 — the "붙였어요" confirmation is shown inline in the chat panel by
  // attachPageContext (pageAttached message). A VS Code toast is NOT used
  // here: a visible toast pauses the integrated browser ("Paused due to
  // Notification"), which broke every capture in the workshop.
}

/** Open local HTML in a width-controlled iframe; the shipped shell ignores CDP emulation. */
export function registerPreviewViewport(context: vscode.ExtensionContext, liveServer: import("./liveServer").LiveServer): void {
  context.subscriptions.push(vscode.commands.registerCommand("hypeproof-chat.previewViewport", async () => {
    const tab = vscode.window.activeBrowserTab;
    const base = liveServer.currentUrl();
    if (!tab || !base) {
      void vscode.window.showWarningMessage("먼저 검수할 HTML 미리보기를 실행하세요.");
      return;
    }
    try {
      const current = new URL(tab.url);
      if (current.origin !== new URL(base).origin) throw new Error("현재 작업 폴더의 로컬 미리보기에서 사용할 수 있습니다.");
      const target = current.pathname === "/__hp_viewport"
        ? current.searchParams.get("path") || "/index.html"
        : current.pathname + current.search + current.hash;
      const url = new URL("__hp_viewport", base);
      url.searchParams.set("path", target);
      await vscode.window.openBrowserTab(url.href, { viewColumn: vscode.ViewColumn.Beside });
    } catch (err) {
      void vscode.window.showErrorMessage(`화면 검수 열기 실패: ${err instanceof Error ? err.message : String(err)}`);
    }
  }));
}
