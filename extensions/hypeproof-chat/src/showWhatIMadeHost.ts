// REQ-STUDIO-SHOW-WHAT-I-MADE (#3794 slice 1) — host side of "내가 만든 것 보여주기". Owns the panel, the native
// file picker, and every write into `<work folder>/.hypeproof/show/<timestamp>/`: the person's material copy,
// the composition (index.html) and the local decision counts (decisions.json). No network call and no model
// call: the one drafted scene is the person's own words over their own material. Nothing is published.

import * as vscode from "vscode";
import * as fs from "node:fs";
import * as path from "node:path";
import { randomBytes } from "node:crypto";
import { sniffImage } from "./artifactThumbnail.ts";
import { canonicalFolder, isInsideFolder } from "./folderConsent.ts";
import {
  SHOW_COPY, SHOW_LIMITS, SHOW_MATERIAL_EXT, showComposition, showDecisionRecord, showFolderRel, showInitialState,
  SHOW_FOLDER_ASSETS, SHOW_MEDIA_DIR, SHOW_PLAYER_FILE, SHOW_RUNTIME_FILE, showMaterialKind, showReduce, type ShowEvent, type ShowState,
} from "./showWhatIMade.ts";
import { showPanelHtml } from "./showWhatIMadeView.ts";

export interface ShowHostPorts {
  /** `hypeproofChat.showWhatIMadeEnabled`, read live: turning it off closes the flow at the next step. */
  enabled(): boolean;
  /** The current work folder. */
  root(): string | undefined;
  /** The folder-consent write question; null = may write. */
  refusal(target: string): string | null;
  /** A 1920x1080 JPEG of the served page, or null. */
  capturePage(root: string, abs: string): Promise<Uint8Array | null>;
  /** Provenance: Studio's own write. */
  noteWrite?(abs: string, data: Uint8Array): void;
  now?(): Date;
}

/** Real file inside the real root, with no link on the way. Returns the absolute path or null. */
export function resolveInsideRoot(root: string, picked: string): string | null {
  try {
    const base = canonicalFolder(root);
    const rel = path.relative(base, path.resolve(picked));
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return null;
    let at = base;
    for (const part of rel.split(path.sep)) {
      at = path.join(at, part);
      if (fs.lstatSync(at).isSymbolicLink()) return null;
    }
    const st = fs.lstatSync(at);
    if (!st.isFile() || st.nlink !== 1) return null;
    return isInsideFolder(canonicalFolder(at), base) ? at : null;
  } catch {
    return null;
  }
}

/** Creates `.hypeproof/show/<stamp>` (suffix -2, -3 … on a clash), refusing a link at any step. */
export function createShowFolder(root: string, now: Date): { abs: string; rel: string } | null {
  try {
    const base = canonicalFolder(root);
    const rel = showFolderRel(now);
    const parts = rel.split("/");
    let at = base;
    for (const part of parts.slice(0, -1)) {
      at = path.join(at, part);
      try { if (fs.lstatSync(at).isSymbolicLink()) return null; } catch { fs.mkdirSync(at); }
    }
    for (let i = 1; i < 100; i++) {
      const name = i === 1 ? parts.at(-1)! : `${parts.at(-1)}-${i}`;
      const abs = path.join(at, name);
      try { fs.mkdirSync(abs); return { abs, rel: [...parts.slice(0, -1), name].join("/") }; }
      catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") return null; }
    }
    return null;
  } catch {
    return null;
  }
}

/** Write beside, then rename over: a link left at the target is replaced, never followed. */
function writeReplacing(abs: string, data: Uint8Array | string): void {
  const tmp = path.join(path.dirname(abs), `.${path.basename(abs)}.${randomBytes(6).toString("hex")}.tmp`);
  try { fs.writeFileSync(tmp, data, { flag: "wx" }); fs.renameSync(tmp, abs); }
  catch (e) { try { fs.rmSync(tmp, { force: true }); } catch { /* nothing */ } throw e; }
}

type Message = { nonce?: unknown; type?: unknown; text?: unknown };

let open: vscode.WebviewPanel | undefined;

/** One flow at a time; a second command reveals the open one. Resolves when the panel closes. */
export async function runShowWhatIMade(extensionUri: vscode.Uri, ports: ShowHostPorts): Promise<void> {
  if (!ports.enabled()) { void vscode.window.showInformationMessage(SHOW_COPY.off); return; }
  if (open) { open.reveal(); return; }
  const root = ports.root();
  if (!root) { void vscode.window.showInformationMessage(SHOW_COPY.noFolder); return; }
  const media = vscode.Uri.joinPath(extensionUri, "media", SHOW_MEDIA_DIR);
  const showRoot = vscode.Uri.file(path.join(root, ".hypeproof", "show"));
  const panel = vscode.window.createWebviewPanel("hypeproof.showWhatIMade", SHOW_COPY.title, vscode.ViewColumn.Active,
    { enableScripts: true, localResourceRoots: [media, showRoot], retainContextWhenHidden: false });
  open = panel;
  const now = () => ports.now?.() ?? new Date();
  let state: ShowState = showInitialState();
  let folder: { abs: string; rel: string } | null = null;
  let materialName: string | undefined;
  let error: string | undefined;
  let busy = false;
  let nonce = "";

  const writeDecisions = () => {
    if (!folder) return;
    const file = path.join(folder.abs, "decisions.json");
    const data = JSON.stringify(showDecisionRecord(state, now()), null, 2) + "\n";
    writeReplacing(file, data);
    ports.noteWrite?.(file, Buffer.from(data));
  };
  const writeComposition = () => {
    if (!folder || !state.material) return;
    const file = path.join(folder.abs, "index.html");
    const html = showComposition({ headline: state.headline, audience: state.audience, materialFile: state.material.file });
    writeReplacing(file, html);
    ports.noteWrite?.(file, Buffer.from(html));
  };
  const render = () => {
    nonce = randomBytes(24).toString("hex");
    const web = panel.webview;
    const composition = (state.step === "draft" || state.step === "accepted") && folder && state.material
      ? showComposition({ headline: state.headline, audience: state.audience, materialFile: state.material.file,
        playback: { base: web.asWebviewUri(vscode.Uri.file(folder.abs)).toString().replace(/\/?$/, "/"),
          runtimeSrc: web.asWebviewUri(vscode.Uri.joinPath(media, SHOW_RUNTIME_FILE)).toString(), nonce } })
      : undefined;
    web.html = showPanelHtml({ step: state.step, audience: state.audience, glance: state.glance, headline: state.headline,
      materialName, savedRel: folder?.rel, error },
    { nonce, cspSource: web.cspSource, playerSrc: web.asWebviewUri(vscode.Uri.joinPath(media, SHOW_PLAYER_FILE)).toString(), composition });
  };
  const apply = (event: ShowEvent) => {
    const next = showReduce(state, event);
    error = next.error;
    if (next.state === state) return;
    state = next.state;
    if (event.type === "headline") writeComposition();
    writeDecisions();
  };

  /** Copies the picked material into the show folder (creating it on first use). Returns an error line or null. */
  const pickMaterial = async (): Promise<string | null> => {
    const current = ports.root();
    if (current !== root) return SHOW_COPY.noFolder;
    const picked = await vscode.window.showOpenDialog({ defaultUri: vscode.Uri.file(root), canSelectMany: false, canSelectFiles: true,
      canSelectFolders: false, openLabel: SHOW_COPY.pick, title: SHOW_COPY.materialQuestion,
      filters: { "그림과 웹 페이지": ["png", "jpg", "jpeg", "gif", "webp", "html", "htm"] } });
    const uri = picked?.[0];
    if (!uri) return null;
    if (uri.scheme !== "file") return SHOW_COPY.notInFolder;
    const abs = resolveInsideRoot(root, uri.fsPath);
    if (!abs) return SHOW_COPY.notInFolder;
    const kind = showMaterialKind(abs);
    if (!kind) return SHOW_COPY.notMaterial;
    let bytes: Uint8Array | null;
    if (kind === "image") {
      if (fs.statSync(abs).size > SHOW_LIMITS.materialBytes) return SHOW_COPY.tooLarge;
      bytes = fs.readFileSync(abs);
    } else {
      bytes = await ports.capturePage(root, abs);
      if (!bytes) return SHOW_COPY.pageFailed;
    }
    const mime = sniffImage(bytes);
    if (!mime) return SHOW_COPY.notMaterial;
    const target = folder?.abs ?? path.join(root, ".hypeproof", "show");
    const refused = ports.refusal(target);
    if (refused) return refused;
    if (!folder) {
      const created = createShowFolder(root, now());
      if (!created) return SHOW_COPY.writeFailed;
      // Anime.js and the font sit beside the composition so the folder plays and renders on its own.
      try {
        for (const asset of SHOW_FOLDER_ASSETS) {
          const bytes = fs.readFileSync(path.join(media.fsPath, asset));
          fs.writeFileSync(path.join(created.abs, asset), bytes, { flag: "wx" });
        }
      } catch { return SHOW_COPY.writeFailed; }
      folder = created;
    }
    const file = `material-${state.decisions.material + 1}.${SHOW_MATERIAL_EXT[mime]}`;
    const out = path.join(folder.abs, file);
    try { fs.writeFileSync(out, bytes, { flag: "wx" }); } catch { return SHOW_COPY.writeFailed; }
    ports.noteWrite?.(out, bytes);
    materialName = path.relative(canonicalFolder(root), abs).split(path.sep).join("/");
    apply({ type: "material", material: { source: materialName, file } });
    writeComposition();
    return null;
  };

  await new Promise<void>((resolve) => {
    const disposed = panel.onDidDispose(() => { open = undefined; received.dispose(); disposed.dispose(); resolve(); });
    const received = panel.webview.onDidReceiveMessage(async (message: Message) => {
      if (busy || message?.nonce !== nonce || typeof message.type !== "string") return;
      if (!ports.enabled()) { panel.dispose(); return; }
      busy = true;
      try {
        switch (message.type) {
          case "close": panel.dispose(); return;
          case "answer": apply({ type: "answer", text: String(message.text ?? "") }); break;
          case "headline": apply({ type: "headline", text: String(message.text ?? "") }); break;
          case "back": case "accept": case "redo": apply({ type: message.type }); break;
          case "pick": if (state.step === "material") error = (await pickMaterial()) ?? undefined; break;
          default: return;
        }
      } catch {
        error = SHOW_COPY.writeFailed;
      } finally {
        busy = false;
      }
      render();
    });
    render();
  });
}
