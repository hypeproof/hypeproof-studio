// REQ-STUDIO-SHOW-WHAT-I-MADE (#3794 slice 1) — host side of "내가 만든 것 보여주기". Owns the panel, the native
// file picker, and every write into `<work folder>/.hypeproof/show/<timestamp>/`: the person's material copy,
// the composition (index.html) and the local decision counts (decisions.json). No network call and no model
// call: the one drafted scene is the person's own words over their own material. Nothing is published by the
// question flow. REQ-STUDIO-SHOW-LINK (#3794 slice 2): after 이대로 할래요, a separate 링크로 보여주기 step (flag
// `showLinkEnabled`, a personal account) shows the exact files, asks for the consent item and only on 링크 만들기
// uploads them through the account session; 링크 끄기 turns the link off. Link ids and counts go to share.json.

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
import { showPanelHtml, type SharePanelView } from "./showWhatIMadeView.ts";
import {
  SHOW_CONSENT_VERSION, SHOW_LINK_COPY, SHOW_LINK_VENDORED, safeShowLink, shareInitialState, shareReduce, shareRequestId, showBundle,
  showLinkMessage, showShareRecord, wireFiles, type BundleFile, type ShareEvent, type ShareState,
} from "./showLink.ts";

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
  /** REQ-STUDIO-SHOW-LINK. Absent: no share step at all. */
  share?: ShowSharePorts;
}

export interface ShowSharePorts {
  /** `hypeproofChat.showLinkEnabled`, read live. */
  enabled(): boolean;
  /** The personal account's show-link request (AccountSession.showLinkRequest), or undefined when not signed in. */
  request(): ((path: string, body?: unknown) => Promise<any>) | undefined;
  /** The canonical production Service: links must then be https://show-…-try.hypeproof-ai.xyz. */
  production: boolean;
  copy(text: string): Promise<void>;
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

type Message = { nonce?: unknown; type?: unknown; text?: unknown; consent?: unknown };

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
  // The share step (REQ-STUDIO-SHOW-LINK): its own state, never mixed into the question flow's counts.
  let share: ShareState = shareInitialState();
  let shareError: string | undefined;
  let shareNotice: string | undefined;
  let shareRequest: string | undefined;
  const sharedLinks: { id: string; url: string; created: string; revoked: string | null }[] = [];
  const shareOn = () => !!ports.share?.enabled();

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
      materialName, savedRel: folder?.rel, error, share: state.step === "accepted" && shareOn() ? shareView() : undefined },
    { nonce, cspSource: web.cspSource, playerSrc: web.asWebviewUri(vscode.Uri.joinPath(media, SHOW_PLAYER_FILE)).toString(), composition });
  };
  /** What will be sent, as the person sees it: names, roles and sizes of the exact bytes. */
  const bundle = (): BundleFile[] | string => {
    if (!folder || !state.material) return SHOW_LINK_COPY.changed;
    try {
      const pins = Object.fromEntries((JSON.parse(fs.readFileSync(path.join(media.fsPath, "VENDORED.json"), "utf8")).files as { path: string; sha256: string }[]).map((f) => [f.path, f.sha256]));
      const vendored = Object.fromEntries(SHOW_LINK_VENDORED.map((n) => [n, new Uint8Array(fs.readFileSync(path.join(media.fsPath, n)))]));
      const materialAbs = path.join(folder.abs, state.material.file);
      if (fs.lstatSync(materialAbs).isSymbolicLink()) return SHOW_LINK_COPY.changed;
      const html = showComposition({ headline: state.headline, audience: state.audience, materialFile: state.material.file });
      // The scene sent is the one that played and was saved; a hand-edited index.html is not uploaded.
      if (fs.readFileSync(path.join(folder.abs, "index.html"), "utf8") !== html) return SHOW_LINK_COPY.changed;
      const b = showBundle({ html, materialFile: state.material.file, material: new Uint8Array(fs.readFileSync(materialAbs)), vendored, pins });
      if ("error" in b) return b.error === "tooLarge" ? SHOW_LINK_COPY.tooLarge : SHOW_LINK_COPY.changed;
      return b;
    } catch {
      return SHOW_LINK_COPY.changed;
    }
  };
  const shareView = (): SharePanelView => {
    const b = share.step === "review" ? bundle() : [];
    return { step: share.step, consentGiven: share.consentGiven, link: share.link?.url, error: shareError ?? (typeof b === "string" ? b : undefined),
      notice: shareNotice, files: typeof b === "string" ? [] : b.map((f) => ({ path: f.path, role: f.role, bytes: f.data.length })), busy: false };
  };
  const writeShare = () => {
    if (!folder) return;
    const file = path.join(folder.abs, "share.json");
    const data = JSON.stringify(showShareRecord(share, sharedLinks, now()), null, 2) + "\n";
    writeReplacing(file, data);
    ports.noteWrite?.(file, Buffer.from(data));
  };
  const applyShare = (event: ShareEvent) => {
    const next = shareReduce(share, event);
    if (next === share) return false;
    share = next;
    if (event.type !== "open" && event.type !== "back") writeShare();
    return true;
  };
  const code = (e: unknown) => (e && typeof e === "object" && typeof (e as { code?: unknown }).code === "string" ? (e as { code: string }).code : "unavailable");
  /** One share message. Every Service call here follows a press by the person. */
  const onShare = async (type: string, message: Message) => {
    shareError = undefined; shareNotice = undefined;
    if (state.step !== "accepted" || !shareOn()) return;
    const request = ports.share!.request();
    if (type === "shareBack") { applyShare({ type: "back" }); return; }
    if (type === "shareCopy") {
      if (share.step !== "shared" || !share.link) return;
      try { await ports.share!.copy(share.link.url); applyShare({ type: "copied" }); shareNotice = SHOW_LINK_COPY.copied; } catch { shareError = SHOW_LINK_COPY.copyFailed; }
      return;
    }
    if (!request) { shareError = SHOW_LINK_COPY.signIn; return; }
    if (type === "share") {
      if (share.step !== "closed" && share.step !== "revoked") return;
      try {
        const list = await request("/me/show-links");
        applyShare({ type: "open", consentGiven: list?.consent?.given === true && list?.consent?.version === SHOW_CONSENT_VERSION });
        shareRequest = shareRequestId();
      } catch (e) { shareError = showLinkMessage(code(e)); }
      return;
    }
    if (type === "shareCreate") {
      if (share.step !== "review") return;
      if (!share.consentGiven && message.consent !== true) { shareError = SHOW_LINK_COPY.consentNeeded; return; }
      const files = bundle();
      if (typeof files === "string") { shareError = files; return; }
      try {
        if (!share.consentGiven) {
          const c = await request("/me/consents/show-share", { version: SHOW_CONSENT_VERSION, granted: true });
          if (c?.consent !== true) { shareError = SHOW_LINK_COPY.failed; return; }
          share = { ...share, consentGiven: true };
        }
        const r = await request("/me/show-links", { request_id: shareRequest ?? (shareRequest = shareRequestId()), consent_version: SHOW_CONSENT_VERSION, files: wireFiles(files) });
        const link = r?.link;
        if (!link || typeof link.id !== "string" || !/^[0-9a-f]{16}$/.test(link.id) || !safeShowLink(link.url, ports.share!.production)) { shareError = SHOW_LINK_COPY.failed; return; }
        sharedLinks.push({ id: link.id, url: link.url, created: now().toISOString(), revoked: null });
        applyShare({ type: "shared", link: { id: link.id, url: link.url } });
        shareRequest = undefined;
      } catch (e) { shareError = showLinkMessage(code(e)); }
      return;
    }
    if (type === "shareRevoke") {
      if (share.step !== "shared" || !share.link) return;
      const id = share.link.id;
      try {
        await request(`/me/show-links/${id}/revoke`, {});
        const rec = sharedLinks.find((l) => l.id === id);
        if (rec) rec.revoked = now().toISOString();
        applyShare({ type: "revoked" });
      } catch { shareError = SHOW_LINK_COPY.revokeFailed; }
    }
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
          case "share": case "shareBack": case "shareCreate": case "shareCopy": case "shareRevoke": await onShare(message.type, message); break;
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
