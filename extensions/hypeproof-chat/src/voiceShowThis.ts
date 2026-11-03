/**
 * CGP-VOICE-R-009 (REQ-CGPV-14) — "보여주기" in voice, the host side.
 *
 * One click attaches one explicitly chosen Studio artifact to the conversation's next turn:
 *   - editor_file: the file open in the active editor, inside the work folder, at the exact
 *     revision the learner sees (document version + sha256 of the text). An unsaved buffer is
 *     refused, so what is attached is byte-for-byte the saved file the learner is looking at.
 *   - preview_tab: the active integrated browser tab, only while it shows this window's own local
 *     preview (served by Studio's preview server), through the existing page-context primitive
 *     (`capturePageContext`): viewport screenshot via tab-scoped CDP, DOM text only for the own
 *     preview (DEC-VOICE-R010). Gated by REQ-N3 `input.page_context`; the screenshot additionally
 *     needs `input.image_paste`, and for a minors cohort it is sent only while the REQ-N3 gate is on.
 *
 * There is no third target. Nothing here (or anywhere in product source, see
 * test/voice-show-this.smoke.mjs) captures the OS screen, a window or the desktop.
 *
 * vscode-free: the provider passes its state and primitives in, so the smoke test drives the
 * real decision and race logic against real temp folders.
 */
import { createHash } from "node:crypto";
import { FILE_REFUSAL_COPY } from "./fileAttachment.ts";
import type { FileAttachmentPreview } from "./protocol.ts";
import type { PageTextSource } from "./pageContext.ts";
import {
  SHOW_THIS_LABEL,
  isShowThisRequestId,
  isShowThisTarget,
  type ReferenceTarget,
  type ShowThisItem,
  type ShowThisTarget,
} from "./voicePopupHelpers.ts";

/** What the active editor shows right now. `null` when no text editor is active. */
export interface EditorSnapshot {
  readonly scheme: string;
  readonly fsPath: string;
  readonly isUntitled: boolean;
  readonly isDirty: boolean;
  readonly version: number;
  readonly text: string;
}

/** The seat and surface state at one moment; re-read on every menu open and every click. */
export interface ShowThisEnv {
  readonly instructor: boolean;
  /** fileAttachAllowed(profile, instructor): `sdk_tools.read` after pass narrowing. */
  readonly fileAllowed: boolean;
  /** REQ-STUDIO-FOLDER-CONSENT refusal text, or null. */
  readonly folderRefusal: string | null;
  readonly root: string | undefined;
  readonly editor: EditorSnapshot | null;
  /** REQ-N3 `input.page_context` (default off, minor-safe). */
  readonly pageContext: boolean;
  /** `input.image_paste`. */
  readonly imagePaste: boolean;
  /**
   * The active integrated browser tab of this window shows the own local preview (its origin is the
   * preview server's). Any other page (an external site, another port) is not "미리보기 화면".
   */
  readonly previewTab: "own" | "other" | "none";
  /** Task/turn scope: a click whose scope changed while it ran attaches nothing. */
  readonly scope: string;
}

export const SHOW_THIS_COPY = {
  instructor: "강사 화면에서는 보여주기를 쓸 수 없어요.",
  fileOff: "이 수업에서는 파일을 보여 줄 수 없어요.",
  noEditor: "열린 파일이 없어요. 작업 폴더의 파일을 편집기에서 열어 주세요.",
  untitled: "아직 저장하지 않은 새 파일이에요. 작업 폴더에 저장한 뒤 보여 주세요.",
  dirty: "저장하지 않은 바뀐 내용이 있어요. 저장한 뒤 보여 주세요.",
  previewOff: "이 수업에서는 미리보기 화면을 보여 줄 수 없어요.",
  noPreview: "열린 미리보기가 없어요. 먼저 미리보기를 열어 주세요.",
  notOwn: "지금 탭은 내 작업 미리보기가 아니에요. 미리보기 탭을 연 뒤 다시 눌러 주세요.",
  changed: "보여 주는 동안 화면이 바뀌었어요. 다시 눌러 주세요.",
  scopeChanged: "작업이 바뀌었어요. 다시 눌러 주세요.",
  busy: "앞의 보여주기가 끝난 뒤 다시 눌러 주세요.",
  replay: "이미 처리한 요청이에요. 다시 보여 주려면 한 번 더 눌러 주세요.",
  invalid: "보여 줄 수 있는 것은 열린 파일과 미리보기 화면뿐이에요.",
  captureFailed: "미리보기 화면을 가져오지 못했어요. 다시 눌러 주세요.",
} as const;

/** Revision the learner sees: editor version plus the first 12 hex of the text's sha256. */
export function editorRevision(version: number, text: string): string {
  return `v${version}-${createHash("sha256").update(text, "utf8").digest("hex").slice(0, 12)}`;
}

function editorRefusal(env: ShowThisEnv): string | null {
  if (env.instructor) return SHOW_THIS_COPY.instructor;
  if (!env.fileAllowed) return SHOW_THIS_COPY.fileOff;
  if (env.folderRefusal) return env.folderRefusal;
  if (!env.root) return FILE_REFUSAL_COPY["no-workspace"];
  const e = env.editor;
  if (!e) return SHOW_THIS_COPY.noEditor;
  if (e.isUntitled) return SHOW_THIS_COPY.untitled;
  if (e.scheme !== "file") return SHOW_THIS_COPY.noEditor;
  if (e.isDirty) return SHOW_THIS_COPY.dirty;
  return null;
}

function previewRefusal(env: ShowThisEnv): string | null {
  if (env.instructor) return SHOW_THIS_COPY.instructor;
  if (!env.pageContext) return SHOW_THIS_COPY.previewOff;
  if (env.previewTab === "none") return SHOW_THIS_COPY.noPreview;
  if (env.previewTab !== "own") return SHOW_THIS_COPY.notOwn;
  return null;
}

/**
 * The screenshot rides along only with image_paste, and for minors only while REQ-N3 is on. Requiring
 * page_context for every seat is stricter than "minors only", so one rule covers both and no separate
 * minor flag is needed.
 */
export function previewImageAllowed(env: Pick<ShowThisEnv, "imagePaste" | "pageContext">): boolean {
  return env.imagePaste && env.pageContext;
}

export function showThisMenu(env: ShowThisEnv): ShowThisItem[] {
  const item = (target: ShowThisTarget, reason: string | null): ShowThisItem => ({ target, label: SHOW_THIS_LABEL[target], enabled: reason === null, reason });
  return [item("editor_file", editorRefusal(env)), item("preview_tab", previewRefusal(env))];
}

/** What the preview capture returns (nativeBrowser.PageContext without the vscode import). */
export interface PreviewCapture {
  url: string;
  title: string;
  imageBase64: string;
  text: string;
  textSource: PageTextSource;
}

/**
 * Attach one work-folder file through the provider's single file path (attachWorkspaceFile: gate,
 * folder consent, readWorkspaceTextFile). `verify` runs after the read and before anything is
 * queued; a non-null answer refuses with that text. The queued model text carries `revision`.
 */
export type AttachFile = (fsPath: string, revision: string, verify: (preview: FileAttachmentPreview) => string | null) =>
  Promise<{ ok: true; preview: FileAttachmentPreview } | { ok: false; error: string }>;

export interface ShowThisDeps {
  env(): ShowThisEnv;
  attachFile: AttachFile;
  /** Capture the active integrated tab; throws when the tab closes, navigates or changes owner. */
  capturePreview(): Promise<PreviewCapture>;
  queuePage(ctx: PreviewCapture): void;
}

export type ShowThisResult =
  | { readonly requestId: string; readonly target: ShowThisTarget; readonly ok: true; readonly reference: ReferenceTarget }
  | { readonly requestId: string; readonly target: ShowThisTarget | null; readonly ok: false; readonly error: string };

/**
 * One attach per click: a request id is used once (a replay attaches nothing), and while one
 * attach runs a second click is refused rather than queued.
 */
export class ShowThisLedger {
  private readonly used: string[] = [];
  private running = false;
  private readonly cap: number;
  constructor(cap = 200) { this.cap = cap; }
  /** True when this id may run now; records it. */
  claim(id: string): "ok" | "replay" | "busy" {
    if (this.used.includes(id)) return "replay";
    if (this.running) return "busy";
    this.used.push(id);
    if (this.used.length > this.cap) this.used.shift();
    this.running = true;
    return "ok";
  }
  release(): void { this.running = false; }
}

/** Adds the revision to the file data tag; null when the tag is not where it must be (fail closed). */
export function withRevision(modelText: string, revision: string): string | null {
  // revision is [a-z0-9-] only (editorRevision), so it needs no escaping.
  if (!/^[a-z0-9-]{1,40}$/.test(revision) || !/^<file_content path="[^"]*">/.test(modelText)) return null;
  return modelText.replace(/^<file_content path="([^"]*)">/, (_m, p: string) => `<file_content path="${p}" revision="${revision}">`);
}

export async function runShowThis(raw: { requestId?: unknown; target?: unknown }, deps: ShowThisDeps, ledger: ShowThisLedger): Promise<ShowThisResult | null> {
  if (!isShowThisRequestId(raw.requestId)) return null;
  const requestId = raw.requestId;
  if (!isShowThisTarget(raw.target)) return { requestId, target: null, ok: false, error: SHOW_THIS_COPY.invalid };
  const target = raw.target;
  const fail = (error: string): ShowThisResult => ({ requestId, target, ok: false, error });
  const claim = ledger.claim(requestId);
  if (claim === "replay") return fail(SHOW_THIS_COPY.replay);
  if (claim === "busy") return fail(SHOW_THIS_COPY.busy);
  try {
    const env = deps.env();
    if (target === "editor_file") {
      const refusal = editorRefusal(env);
      if (refusal) return fail(refusal);
      const editor = env.editor!, root = env.root!;
      const revision = editorRevision(editor.version, editor.text);
      // The attached bytes must be exactly what the editor shows, at the same version, in the same task.
      const res = await deps.attachFile(editor.fsPath, revision, (preview) => {
        const now = deps.env();
        const same = now.editor && now.editor.fsPath === editor.fsPath && now.editor.version === editor.version && !now.editor.isDirty && now.editor.text === editor.text;
        if (!same || preview.text !== editor.text) return SHOW_THIS_COPY.changed;
        if (now.scope !== env.scope || now.root !== root) return SHOW_THIS_COPY.scopeChanged;
        return editorRefusal(now);
      });
      if (!res.ok) return fail(res.error);
      return { requestId, target, ok: true, reference: { artifactId: res.preview.path, title: res.preview.path, revision } };
    }
    const refusal = previewRefusal(env);
    if (refusal) return fail(refusal);
    let ctx: PreviewCapture;
    try {
      ctx = await deps.capturePreview();
    } catch (e) {
      return fail(e instanceof Error && e.message ? e.message : SHOW_THIS_COPY.captureFailed);
    }
    // The capture itself decides ownership (DEC-VOICE-R010): only the own preview counts as "미리보기 화면".
    if (ctx.textSource !== "own") return fail(SHOW_THIS_COPY.notOwn);
    const now = deps.env();
    if (now.scope !== env.scope) return fail(SHOW_THIS_COPY.scopeChanged);
    const after = previewRefusal(now);
    if (after) return fail(after);
    const image = previewImageAllowed(now) ? ctx.imageBase64 : "";
    deps.queuePage({ ...ctx, imageBase64: image });
    // A preview has no revision Studio can name; the panel says so instead of inventing one.
    return { requestId, target, ok: true, reference: { artifactId: ctx.url, title: ctx.title || ctx.url, revision: null } };
  } finally {
    ledger.release();
  }
}

/** The tab shows this window's own local preview: an http(s) URL with exactly the preview server's origin. */
export function isOwnPreviewTab(tabUrl: string | undefined, previewUrl: string | undefined): boolean {
  try {
    const tab = new URL(tabUrl ?? ""), own = new URL(previewUrl ?? "");
    return ["http:", "https:"].includes(own.protocol) && tab.protocol === own.protocol && tab.origin === own.origin;
  } catch {
    return false;
  }
}
