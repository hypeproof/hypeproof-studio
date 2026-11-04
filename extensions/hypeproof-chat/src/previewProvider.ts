import * as vscode from "vscode";
import * as path from "node:path";
import { buildPreviewShellCsp, PREVIEW_IFRAME_ALLOW, PREVIEW_IFRAME_SANDBOX } from "./cspBuilder";
import { sanitizeArtifactEntry, ARTIFACT_FILES, applyPlaceholderDefaults } from "./previewArtifacts";
import { injectBaseHref, injectInnerCsp } from "./previewHtml";
import { noteHostWrite } from "./artifactProvenance";
import type { PreviewReviewBar } from "./turnReviewView";

/** CGP-ART-D-002 — a press on the preview's review bar, for the chat host's turn review. */
export interface PreviewReviewAction { action: "revert" | "keep" | "show"; turnId: string }

/**
 * HTML preview for AI-generated webapps + user-opened .html files.
 *
 * Renders in the EDITOR AREA (a reused WebviewPanel beside the chat sidebar).
 * The HTML lives inside a sandboxed iframe (srcdoc). Threat-model + capability
 * trade-off (see PREVIEW_IFRAME_SANDBOX comment for the spec details):
 *  - `allow-same-origin` is OMITTED → opaque origin → no parent-CSP inherit →
 *    inner-page inline scripts (and therefore click/keyboard handlers) run.
 *  - Cost: fetch/XHR to workspace assets fails CORS. Static asset loads via
 *    `<img>/<script src>/<link>` still work via `<base href>` injection.
 *  - Exfil gate: the inner meta CSP from `injectInnerCsp` (connect/frame/img
 *    exclude https:), enforced standalone since opaque-origin srcdoc doesn't
 *    intersect with parent.
 *  - `localResourceRoots` is the workspace folders ∪ the previewed file's
 *    parent dir only — webview refuses to serve anything outside that set.
 *  - The trusted header has a revision-bound `preview_ask_file` callback. The
 *    inner document can only forward `preview_request_action` + `preview_result`;
 *    the action handler only
 *    acts on `append_artifact` and only after a modal confirm, writing to
 *    `workshop-output/` (#155). `preview_result` (kids-quest `hp:result`) never
 *    touches disk — it is a plain-data event the chat panel folds into the
 *    next turn's prompt (see ChatPanelProvider.attachQuestResult).
 *
 * If you weaken any of those, update test/csp-sandbox.smoke.mjs and
 * docs/studio-requirements.md REQ-D rows.
 */

// 결과지 정화는 순수 로직이라 questResultHelpers.ts 로 옮겼다 — vscode 를
// import 하지 않는 파일이라야 앱 없이 테스트가 된다. 이 경계를 지나는 계약은
// worker/test/quest-result-contract.test.mjs 가 고정한다.
import { sanitizeQuestResult } from "./questResultHelpers";
export { sanitizeQuestResult } from "./questResultHelpers";

export class PreviewProvider {
  private panel: vscode.WebviewPanel | undefined;
  private ready = false;
  private pendingHtml: string | null = null;
  private askAboutFile: (() => Promise<void>) | undefined;
  private askEnabled = false;
  private previewRevision = 0;
  private asking = false;

  /** Visibility follows the resolved file-attach grant; the action rechecks it. */
  setAskAboutFileEnabled(enabled: boolean): void {
    this.askEnabled = enabled;
    this.postAskState();
  }

  private postAskState(): void {
    if (this.ready) void this.panel?.webview.postMessage({
      type: "previewAskState", revision: this.previewRevision,
      enabled: this.askEnabled && !!this.askAboutFile && !this.asking,
    });
  }
  // For the "preview .html file" path: watched file URI + its parent dir.
  // On save we re-read and re-render. Cleared when panel disposes or user
  // previews a different file.
  private watchedFile: vscode.Uri | undefined;
  private watchedBase: vscode.Uri | undefined;
  private watchedRead: (() => Promise<string | null>) | undefined;
  private saveSubscription: vscode.Disposable | undefined;
  private labels: { title: string; placeholder: string; emoji: string } = {
    title: "🎮 내 게임",
    placeholder: "게임이 여기에 나와요",
    emoji: "🎮",
  };

  // kids-quest — a skeleton's `finish()` posts `{type:"hp:result", ok, …}` to
  // its parent. The shell forwards it as `preview_result`; we fan it out here
  // so the chat panel can let the guest react to what the kid just did.
  private readonly resultEmitter = new vscode.EventEmitter<Record<string, unknown>>();
  readonly onResult = this.resultEmitter.event;

  // CGP-ART-D-002 / DES-ART-02 — the review bar pinned at the bottom of the preview. The chat host
  // owns the turn review (turnRestore.ts); this panel only mirrors it and forwards presses, so the
  // preview and the chat offer one undo, never two.
  private reviewBar: PreviewReviewBar | null = null;
  private toastedTurn: string | null = null;
  private readonly reviewActionEmitter = new vscode.EventEmitter<PreviewReviewAction>();
  readonly onReviewAction = this.reviewActionEmitter.event;

  /** Mirror the chat's turn review (null hides the bar). A revert result is shown once, as a toast. */
  setReviewBar(bar: PreviewReviewBar | null): void {
    if (bar?.state === "restored") {
      if (this.toastedTurn === bar.turnId) bar = null;
      else {
        this.toastedTurn = bar.turnId;
        const stale = !this.watchedFile;
        if (!stale) void this.reloadWatched();
        this.reviewBar = { ...bar, stale };
        this.postReviewState();
        this.reviewBar = null;
        return;
      }
    }
    this.reviewBar = bar;
    this.postReviewState();
  }

  private postReviewState(): void {
    if (this.ready) void this.panel?.webview.postMessage({ type: "previewReviewState", bar: this.reviewBar });
  }

  /** Re-read the watched file and show it again (after a revert put its earlier bytes back). */
  private async reloadWatched(): Promise<void> {
    if (!this.panel || !this.watchedFile) return;
    const revision = this.previewRevision;
    const file = this.watchedFile;
    const base = this.watchedBase;
    const ask = this.askAboutFile;
    try {
      const html = this.watchedRead ? await this.watchedRead() : Buffer.from(await vscode.workspace.fs.readFile(file)).toString("utf8");
      if (html === null || revision !== this.previewRevision) return;
      await this.show(html, base, ask, true);
    } catch { /* file may have been deleted; ignore */ }
  }

  constructor(
    private readonly _context: vscode.ExtensionContext,
    private readonly releaseAutomationEntry?: () => vscode.ViewColumn | undefined,
  ) {}

  /** Use the existing work canvas beside the chat, not a third editor group. */
  async showAutomation(html: string): Promise<void> {
    const column = this.releaseAutomationEntry?.() ?? this.panel?.viewColumn ?? vscode.ViewColumn.One;
    await this.show(html, undefined, undefined, false, column);
  }
  /** REQ-STUDIO-FOLDER-CONSENT — the chat host's write question; null = may write. */
  private writeRefusal: (target: string) => string | null = () => null;
  setWriteGuard(guard: (target: string) => string | null): void { this.writeRefusal = guard; }

  /**
   * Re-render the preview every time `fileUri` is saved. Called by the
   * `hypeproof-chat.previewActiveFile` command. Calling again with a
   * different URI swaps the watch target; the previous one stops firing.
   */
  watchForReload(fileUri: vscode.Uri, read?: () => Promise<string | null>): void {
    this.watchedFile = fileUri;
    this.watchedBase = vscode.Uri.joinPath(fileUri, "..");
    // REQ-STUDIO-PAGE-CARD — a caller with its own checked read (handle-based, no links) supplies it; null skips the reload.
    this.watchedRead = read;
    if (this.saveSubscription) return; // single subscription, gated on watchedFile
    this.saveSubscription = vscode.workspace.onDidSaveTextDocument(async (doc) => {
      if (!this.watchedFile) return;
      if (doc.uri.fsPath !== this.watchedFile.fsPath) return;
      await this.reloadWatched();
    });
  }

  /**
   * Update the panel title + placeholder copy for the current cohort tone.
   * Call this whenever the resolved profile changes (e.g. after token set).
   */
  setLabels(labels: { title: string; placeholder: string; emoji: string }): void {
    if (labels.title === this.labels.title && labels.placeholder === this.labels.placeholder && labels.emoji === this.labels.emoji) return;
    this.labels = labels;
    if (this.panel) {
      this.panel.title = labels.title;
      // Re-render shell to update inline placeholder (cheap; iframe contents
      // are re-posted on the next show()).
      this.panel.webview.html = this.shellHtml(this.panel.webview);
      this.ready = false;
    }
  }

  /**
   * Open (or reuse) the editor-area preview panel and render `html`.
   *
   * `basePath` is the directory the inner page resolves relative URLs against
   * (`./pic.png`, `<link href="style.css">`, `fetch('./data.json')`, etc.).
   * - Pass the file's parent dir for the "preview .html in editor" path.
   * - For AI-generated chat HTML, omit it → defaults to the first workspace
   *   folder (matches REQ-D5: game auto-saved at `workspaceFolder/index.html`).
   * Without a workspace AND without an explicit basePath, the iframe falls
   * back to `about:srcdoc` and relative paths remain dead (matches old
   * behavior, just doesn't crash).
   */
  async show(html: string, basePath?: vscode.Uri, askAboutFile?: () => Promise<void>, reload = false, viewColumn?: vscode.ViewColumn): Promise<void> {
    this.previewRevision++;
    this.askAboutFile = askAboutFile;
    // An unrelated/generated preview must not retain the previous file's save watcher.
    if (!reload) {
      this.watchedFile = undefined;
      this.watchedBase = undefined;
      this.watchedRead = undefined;
    }
    // Replace any unresolved `%%KEY%%` with sensible defaults (#161). Lets
    // partial LLM responses still render a recognizable V1.
    html = applyPlaceholderDefaults(html);
    const effectiveBase = basePath ?? vscode.workspace.workspaceFolders?.[0]?.uri;
    if (!this.panel) {
      // localResourceRoots: union of every workspace folder + basePath. Webview
      // refuses to serve files outside this allowlist via asWebviewUri.
      const roots: vscode.Uri[] = [];
      for (const wf of vscode.workspace.workspaceFolders ?? []) roots.push(wf.uri);
      if (basePath && !roots.some((r) => r.fsPath === basePath.fsPath)) {
        roots.push(basePath);
      }
      this.panel = vscode.window.createWebviewPanel(
        "hypeproofPreview",
        this.labels.title,
        { viewColumn: viewColumn ?? vscode.ViewColumn.Beside, preserveFocus: true },
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: roots.length > 0 ? roots : undefined,
        },
      );
      this.panel.webview.html = this.shellHtml(this.panel.webview);
      this.ready = false;
      this.panel.webview.onDidReceiveMessage((msg) => {
        if (msg?.type === "previewReady") {
          this.ready = true;
          this.postAskState();
          this.postReviewState();
          if (this.pendingHtml !== null) {
            this.panel?.webview.postMessage({ type: "renderPreview", revision: this.previewRevision, html: this.pendingHtml });
            this.pendingHtml = null;
          }
        } else if (msg?.type === "preview_ask_file") {
          if (msg.revision !== this.previewRevision || !this.askEnabled || !this.askAboutFile || this.asking) return;
          this.asking = true;
          this.postAskState();
          void this.askAboutFile().catch(() => undefined).finally(() => {
            this.asking = false;
            this.postAskState();
          });
        } else if (msg?.type === "preview_request_action") {
          void this.handlePreviewRequestAction(msg);
        } else if (msg?.type === "preview_review_action") {
          const bar = this.reviewBar;
          const action = msg.action;
          if (!bar || msg.turnId !== bar.turnId || (action !== "revert" && action !== "keep" && action !== "show")) return;
          if (action !== "show" && bar.state !== "open") return;
          this.reviewActionEmitter.fire({ action, turnId: bar.turnId });
        } else if (msg?.type === "preview_result") {
          this.resultEmitter.fire(sanitizeQuestResult(msg.result));
        }
      });
      this.panel.onDidDispose(() => {
        this.panel = undefined;
        this.askAboutFile = undefined;
        this.previewRevision++;
        this.ready = false;
        this.pendingHtml = null;
        this.watchedFile = undefined;
        this.watchedBase = undefined;
        this.watchedRead = undefined;
        this.saveSubscription?.dispose();
        this.saveSubscription = undefined;
      });
    } else {
      // Bring the existing panel forward without stealing focus from chat.
      this.panel.reveal(viewColumn ?? this.panel.viewColumn, true);
    }

    // Inject `<base href="...">` so relative paths (./pic.png, style.css,
    // fetch('./data.json')) resolve against the workspace / file dir via
    // webview URIs. Without a base, iframe srcdoc anchors at about:srcdoc
    // and every relative ref dies.
    //
    // Then inject the inner CSP. With `allow-same-origin` on the iframe
    // sandbox, srcdoc inherits the shell's strict `script-src 'nonce-XXX'`
    // (CSP3 §4.2.2), which would block every inline script in AI-generated
    // games. The inner CSP overrides that with `'unsafe-inline' 'unsafe-eval'`
    // (needed for game handlers) while keeping `connect-src`/`frame-src`/etc.
    // off https:* so generated code can't exfil.
    const baseAware = effectiveBase
      ? injectBaseHref(html, String(this.panel.webview.asWebviewUri(effectiveBase)))
      : html;
    const renderedHtml = injectInnerCsp(baseAware, this.panel.webview.cspSource);

    this.postAskState();
    if (this.ready) {
      this.panel.webview.postMessage({ type: "renderPreview", revision: this.previewRevision, html: renderedHtml });
    } else {
      this.pendingHtml = renderedHtml;
    }
  }

  /**
   * Handle a `request_action` postMessage that bubbled up from the
   * inner sandboxed iframe (e.g. verdict-card's [규칙 저장] button).
   *
   * Flow: modal-gated approval (REQ-E1/E2) → append to
   * `workshop-output/<artifact>.{md,log}` in the active workspace.
   * No write happens without explicit user click.
   */
  private async handlePreviewRequestAction(
    msg: { action?: string; payload?: { artifact?: string; entry?: string } },
  ): Promise<void> {
    if (msg.action !== "append_artifact") {
      vscode.window.showWarningMessage(`HypeProof: 알 수 없는 preview action: ${msg.action ?? "(none)"}`);
      return;
    }
    const artifact = msg.payload?.artifact;
    const entry = msg.payload?.entry;
    if (typeof artifact !== "string" || typeof entry !== "string") {
      return;
    }
    const target = ARTIFACT_FILES[artifact as keyof typeof ARTIFACT_FILES];
    if (!target) {
      vscode.window.showWarningMessage(`HypeProof: 지원하지 않는 artifact: ${artifact}`);
      return;
    }

    const safeEntry = sanitizeArtifactEntry(entry);
    if (!safeEntry) return;

    const ws = vscode.workspace.workspaceFolders?.[0];
    if (!ws) {
      vscode.window.showWarningMessage("HypeProof: 작업 폴더가 열려있지 않아요. 폴더를 먼저 열어주세요.");
      return;
    }

    const folderUri = vscode.Uri.joinPath(ws.uri, "workshop-output");
    const fileUri = vscode.Uri.joinPath(folderUri, target);
    const folderRefusal = this.writeRefusal(fileUri.fsPath);
    if (folderRefusal) {
      vscode.window.showWarningMessage(folderRefusal);
      this.panel?.webview.postMessage({ type: "previewActionResult", action: "append_artifact", artifact, ok: false });
      return;
    }

    const pick = await vscode.window.showWarningMessage(
      `다음 ${target} 항목을 저장할까요?\n\n${safeEntry}`,
      { modal: true },
      "저장",
      "취소",
    );
    if (pick !== "저장") {
      this.panel?.webview.postMessage({ type: "previewActionResult", action: "append_artifact", artifact, ok: false });
      return;
    }

    try {
      await vscode.workspace.fs.createDirectory(folderUri);
    } catch { /* exists is fine */ }

    let existing = "";
    try {
      const buf = await vscode.workspace.fs.readFile(fileUri);
      existing = Buffer.from(buf).toString("utf8");
    } catch { /* fresh file */ }

    const stamp = new Date().toISOString();
    const line = `- ${stamp} · ${safeEntry}\n`;
    const next = existing ? existing + line : `# ${path.basename(target)}\n\n${line}`;
    await vscode.workspace.fs.writeFile(fileUri, Buffer.from(next, "utf8"));
    noteHostWrite([{ absPath: fileUri.fsPath, data: next }], "studio"); // REQ-STUDIO-ARTIFACT-PROVENANCE

    this.panel?.webview.postMessage({ type: "previewActionResult", action: "append_artifact", artifact, ok: true });
    vscode.window.showInformationMessage(`HypeProof: ${target}에 저장됐어요.`);
  }

  private shellHtml(webview: vscode.Webview): string {
    // No nonce: the inner srcdoc inherits this CSP, and a nonce-based shell
    // policy would (via inheritance) block every inline script in AI-generated
    // games. See buildPreviewShellCsp comment for the spec rationale.
    const csp = buildPreviewShellCsp({ cspSource: webview.cspSource });
    return /* html */ `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <style>
    html, body { margin: 0; height: 100%; background: #1b1b2a; color: #ddd;
                 font-family: var(--vscode-font-family, sans-serif); }
    body { display: flex; flex-direction: column; }
    #preview-header[hidden] { display: none; }
    #preview-header { padding: 4px 8px; background: var(--vscode-editor-background, #1b1b2a); }
    #ask-file { min-height: 44px; min-width: 44px; padding: 8px 12px; font: inherit; font-size: 14px;
      color: var(--vscode-button-foreground, #fff); background: var(--vscode-button-background, #0e639c);
      border: 1px solid transparent; border-radius: 4px; cursor: pointer; }
    #ask-file:focus-visible { outline: 2px solid var(--vscode-focusBorder, #007fd4); outline-offset: 2px; }
    @media (forced-colors: active) { #ask-file { color: ButtonText; background: ButtonFace; border-color: ButtonText; } }
    #placeholder { display:flex; flex-direction:column; align-items:center;
                   justify-content:center; flex:1; min-height:0; opacity:0.7; gap:8px; }
    #placeholder .big { font-size: 40px; }
    iframe { width: 100%; flex: 1; min-height: 0; border: 0; background: #fff; display: block; }
    /* CGP-ART-D-002 — a strip below the page, never over it: the page's last pixels stay visible. */
    #review-strip[hidden] { display: none; }
    #review-strip { flex: none; display: flex; justify-content: center; box-sizing: border-box;
      min-height: 48px; padding: 1px 8px; background: var(--vscode-editor-background, #1b1b2a);
      border-top: 1px solid var(--vscode-panel-border, rgba(128,128,128,.35)); overflow: hidden; }
    #review-bar[hidden], #review-toast:empty { display: none; }
    #review-bar { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 8px;
      max-width: 100%; color: var(--vscode-foreground, #ddd); }
    #review-bar.entering { animation: hp-review-in 120ms ease-out; }
    @keyframes hp-review-in { from { opacity: 0; } to { opacity: 1; } }
    @media (prefers-reduced-motion: reduce) { #review-bar.entering { animation: none; } }
    #review-title { margin: 0; font-size: 14px; line-height: 20px; }
    #review-actions { display: flex; flex-wrap: wrap; gap: 8px; }
    #review-actions button[hidden] { display: none; }
    #review-actions button { min-height: 44px; min-width: 44px; padding: 0 10px; font: inherit; font-size: 14px;
      border-radius: 4px; cursor: pointer; border: 1px solid var(--vscode-button-border, transparent); }
    #review-actions button.primary { color: var(--vscode-button-foreground, #fff); background: var(--vscode-button-background, #0e639c); }
    #review-actions button.secondary { color: var(--vscode-button-secondaryForeground, #fff);
      background: var(--vscode-button-secondaryBackground, #3a3d41); border-color: var(--vscode-contrastBorder, rgba(128,128,128,.6)); }
    #review-actions button:disabled { opacity: .6; cursor: default; }
    #review-actions button:focus-visible { outline: 2px solid var(--vscode-focusBorder, #007fd4); outline-offset: 2px; }
    #review-toast { align-self: center; margin: 0; font-size: 14px; color: var(--vscode-foreground, #ddd); }
    .sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
    @media (forced-colors: active) {
      #review-strip { border-top-color: CanvasText; }
      #review-actions button { color: ButtonText; background: ButtonFace; border-color: ButtonText; forced-color-adjust: none; }
      #review-actions button.primary { color: HighlightText; background: Highlight; }
    }
  </style>
</head>
<body>
  <header id="preview-header" hidden><button id="ask-file" type="button">이 파일에 대해 묻기</button></header>
  <div id="placeholder">
    <div class="big">${this.labels.emoji}</div>
    <div>${this.labels.placeholder}</div>
  </div>
  <iframe id="frame" style="display:none" sandbox="${PREVIEW_IFRAME_SANDBOX}" allow="${PREVIEW_IFRAME_ALLOW}" referrerpolicy="no-referrer"></iframe>
  <div id="review-strip" hidden>
    <section id="review-bar" hidden aria-label="AI가 바꾼 곳" aria-describedby="review-move-hint">
      <p id="review-title"></p>
      <div id="review-actions">
        <button id="review-show" type="button" class="secondary">바뀐 곳 보기</button>
        <button id="review-revert" type="button" class="secondary">되돌리기</button>
        <button id="review-keep" type="button" class="primary">이대로 둘게요</button>
      </div>
      <span id="review-move-hint" class="sr-only">왼쪽·오른쪽 화살표 키로 이 막대를 옮기고, Home 키로 제자리에 놓아요.</span>
    </section>
    <p id="review-toast" role="status" aria-live="polite"></p>
  </div>
  <script>
  (() => {
    const vscode = acquireVsCodeApi();
    const frame = document.getElementById("frame");
    const placeholder = document.getElementById("placeholder");
    const header = document.getElementById("preview-header");
    const ask = document.getElementById("ask-file");
    let revision = null;
    let renderedRevision = null;
    let enabled = false;
    const updateHeader = () => {
      header.hidden = !enabled || revision !== renderedRevision;
      ask.disabled = header.hidden;
    };
    ask.addEventListener("click", () => {
      if (header.hidden || ask.disabled || revision === null) return;
      ask.disabled = true;
      vscode.postMessage({ type: "preview_ask_file", revision });
    });

    // Only this shell's own host frame may drive it. VS Code's webview preamble sets
    // window.parent = window (and window.top) in this document before this script runs, so
    // ev.source cannot be compared with window.parent (#3476: every host message was dropped).
    // The real parent is the window whose frames contain this shell; cross-origin frames
    // access reads the real frame tree. The preview page, frames nested in it, detached frames,
    // other webviews in the window (siblings), the shell itself and a null source are untrusted.
    const fromHost = (source) => {
      if (!source || source === window || source === frame.contentWindow) return false;
      try {
        for (let i = 0; i < source.length; i++) if (source[i] === window) return true;
      } catch (_) { /* unreadable: untrusted */ }
      return false;
    };
    // CGP-ART-D-002 / DES-ART-02 — the review bar mirrors the chat's turn review; presses go to the host,
    // which runs the chat's own revert or keep (one undo). It never auto-dismisses while open.
    const strip = document.getElementById("review-strip");
    const reviewBar = document.getElementById("review-bar");
    const reviewTitle = document.getElementById("review-title");
    const reviewShow = document.getElementById("review-show");
    const reviewRevert = document.getElementById("review-revert");
    const reviewKeep = document.getElementById("review-keep");
    const toast = document.getElementById("review-toast");
    let review = null;
    let toastTimer = null;
    let offset = 0;
    const placeBar = () => {
      const room = Math.max(0, (strip.clientWidth - 16 - reviewBar.offsetWidth) / 2);
      offset = Math.max(-room, Math.min(room, offset));
      reviewBar.style.transform = offset ? "translateX(" + offset + "px)" : "";
    };
    const syncStrip = () => { strip.hidden = reviewBar.hidden && !toast.textContent; };
    const showToast = (text) => {
      if (toastTimer) clearTimeout(toastTimer);
      toast.textContent = text;
      syncStrip();
      toastTimer = setTimeout(() => { toastTimer = null; toast.textContent = ""; syncStrip(); }, 4000);
    };
    const renderReview = (bar) => {
      const valid = bar && typeof bar === "object" && typeof bar.turnId === "string" && Number.isInteger(bar.count) && bar.count >= 0
        && ["open", "restoring", "restored", "failed"].includes(bar.state);
      const wasHidden = reviewBar.hidden;
      review = null;
      if (valid && bar.state === "restored") {
        reviewBar.hidden = true;
        showToast(bar.stale === true ? "되돌렸어요. 미리보기를 다시 열면 되돌린 내용이 보여요." : "되돌렸어요");
        return;
      }
      if (!valid) { reviewBar.hidden = true; syncStrip(); return; }
      review = { turnId: bar.turnId, state: bar.state };
      if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
      toast.textContent = "";
      const notice = typeof bar.notice === "string" ? bar.notice : "";
      reviewTitle.textContent = bar.state === "failed" ? "되돌리지 못했어요. 채팅에서 확인해 주세요."
        : bar.state === "restoring" ? "되돌리는 중…" : notice || "AI가 " + bar.count + "곳을 바꿨어요";
      reviewShow.textContent = bar.state === "failed" ? "채팅에서 보기" : "바뀐 곳 보기";
      reviewRevert.hidden = reviewKeep.hidden = bar.state === "failed";
      reviewRevert.disabled = reviewKeep.disabled = bar.state !== "open";
      reviewShow.disabled = false;
      reviewBar.hidden = false;
      syncStrip();
      if (wasHidden) {
        reviewBar.classList.remove("entering");
        void reviewBar.offsetWidth;
        reviewBar.classList.add("entering");
      }
      placeBar();
    };
    const press = (action, button) => {
      if (!review || button.disabled || button.hidden) return;
      if (action !== "show") { if (review.state !== "open") return; reviewRevert.disabled = reviewKeep.disabled = true; }
      vscode.postMessage({ type: "preview_review_action", action, turnId: review.turnId });
    };
    reviewShow.addEventListener("click", () => press("show", reviewShow));
    reviewRevert.addEventListener("click", () => press("revert", reviewRevert));
    reviewKeep.addEventListener("click", () => press("keep", reviewKeep));
    reviewBar.addEventListener("keydown", (ev) => {
      if (ev.altKey || ev.ctrlKey || ev.metaKey || ev.shiftKey) return;
      if (ev.key === "ArrowLeft" || ev.key === "ArrowRight") offset += ev.key === "ArrowLeft" ? -24 : 24;
      else if (ev.key === "Home") offset = 0;
      else return;
      ev.preventDefault();
      placeBar();
    });
    window.addEventListener("resize", () => { if (!reviewBar.hidden) placeBar(); });

    // host → shell → inner iframe
    window.addEventListener("message", (ev) => {
      const m = ev.data || {};
      const trusted = fromHost(ev.source);
      if (trusted && m.type === "previewReviewState") {
        renderReview(m.bar);
        return;
      }
      if (trusted && m.type === "previewAskState") {
        revision = m.revision;
        enabled = m.enabled === true;
        updateHeader();
        return;
      }
      if (trusted && m.type === "renderPreview" && typeof m.html === "string") {
        placeholder.style.display = "none";
        frame.style.display = "block";
        frame.srcdoc = m.html;
        renderedRevision = m.revision;
        updateHeader();
        return;
      }
      // Inner iframe (cross-document postMessage from srcdoc) → forward to host (#155).
      // We only accept a known message shape; everything else is ignored.
      if (ev.source === frame.contentWindow && m && typeof m === "object") {
        if (m.type === "request_action" && typeof m.action === "string") {
          vscode.postMessage({
            type: "preview_request_action",
            action: m.action,
            payload: m.payload ?? null,
          });
        } else if (m.type === "hp:result") {
          // kids-quest skeleton finished a round → let the coach/guest know.
          vscode.postMessage({ type: "preview_result", result: m });
        }
        return;
      }
      // host → shell: forward action result back into the inner iframe so the
      // card can flip its status. (sandboxed iframe still receives postMessage.)
      if (m.type === "previewActionResult" && frame.contentWindow) {
        try { frame.contentWindow.postMessage(m, "*"); } catch (_) { /* sandbox quirk */ }
      }
    });

    vscode.postMessage({ type: "previewReady" });
  })();
  </script>
</body>
</html>`;
  }
}
