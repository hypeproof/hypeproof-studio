// REQ-STUDIO-SHOW-WHAT-I-MADE (#3794 slice 1) — "내가 만든 것 보여주기": the moment a person shows what they
// made to someone else. Studio asks; the person answers. Pure and vscode-free so a smoke drives exactly what
// the host runs: the question flow (a reducer), the decision counts, and the HyperFrames composition.
//
// The composition follows the HyperFrames contract without GSAP (GSAP's standard license does not clearly allow
// redistribution inside the app, 2026-11-12). Motion is one paused Anime.js 4.5.0 (MIT) timeline registered on
// `window.__hfAnime`; the vendored HyperFrames runtime's animejs adapter seeks it to the composition clock in
// milliseconds, so a frame at time t is a function of t alone. The look is the sample Jay approved on 2026-11-12
// (calm word-by-word headline, slow push-in mask reveal of the person's material, thin lime rule, closing card).
// Every file the composition loads sits beside it in the show folder; it names no network URL.
//
// Out of scope for this slice (TODO #3794): Service upload and the -try share link, MP4/WebM export, mobile,
// and the consent-version bump. Slice 1 is local only, so it is on by default (Jay, 2026-11-12); sharing waits for consent.

import { jpegInfo, type CdpSend } from "./deckPdf.ts";

export const SHOW_COPY = {
  title: "내가 만든 것 보여주기",
  audienceQuestion: "누구에게 보여 주고 싶나요?",
  audienceHint: "떠오르는 사람을 그대로 적어 주세요.",
  glanceQuestion: "그 사람이 처음 3초 안에 무엇을 봤으면 하나요?",
  glanceHint: "적은 문장이 화면의 제목이 돼요. 나중에 고칠 수 있어요.",
  materialQuestion: "보여 줄 내 작품을 골라 주세요.",
  materialHint: "작업 폴더 안의 그림(PNG, JPG, WebP, GIF)이나 웹 페이지(HTML)를 고를 수 있어요. 웹 페이지는 첫 화면을 찍어서 써요.",
  pick: "작업 폴더에서 고르기",
  draftHeading: "이렇게 보여 줄까요?",
  draftHint: "제목은 내가 적은 문장 그대로예요. 고치고 싶으면 고친 뒤 ‘제목 바꾸기’를 눌러 주세요.",
  headlineLabel: "제목",
  applyHeadline: "제목 바꾸기",
  accept: "이대로 할래요",
  redo: "다시 할래요",
  notShared: "아직 아무에게도 보내지 않았어요. 이 컴퓨터에만 저장돼요.",
  acceptedHeading: "저장했어요",
  savedAt: (rel: string) => `저장한 곳: ${rel}`,
  next: "다음",
  back: "이전",
  close: "닫기",
  step: (n: number) => `질문 ${n}/3`,
  closingLabel: "받는 사람",
  emptyAnswer: "한 글자 이상 적어 주세요.",
  tooLong: (max: number) => `${max}자 안으로 적어 주세요.`,
  notInFolder: "작업 폴더 안의 파일만 고를 수 있어요.",
  notMaterial: "그림(PNG, JPG, WebP, GIF)이나 웹 페이지(HTML)만 고를 수 있어요.",
  tooLarge: "20MB보다 작은 그림을 골라 주세요.",
  pageFailed: "웹 페이지의 첫 화면을 찍지 못했어요. 미리보기에서 페이지가 열리는지 확인하거나 그림 파일을 골라 주세요.",
  writeFailed: "작업 폴더에 저장하지 못했어요. 폴더에 쓸 수 있는지 확인해 주세요.",
  noFolder: "작업 폴더를 연 뒤에 쓸 수 있어요.",
  off: "이 기능은 아직 꺼져 있어요.",
} as const;

/**
 * Vendored files under media/show (VENDORED.json pins version, license and sha256). The runtime keeps its upstream
 * name on purpose: the player only skips injecting its own CDN runtime into a srcdoc composition when the document
 * already names `hyperframe.runtime.iife.js`. Anime.js and the font are copied into each show folder so the folder
 * renders on its own.
 */
export const SHOW_MEDIA_DIR = "show";
export const SHOW_PLAYER_FILE = "hyperframes-player.global.js";
export const SHOW_RUNTIME_FILE = "hyperframe.runtime.iife.js";
export const SHOW_ANIME_FILE = "anime.umd.min.js";
export const SHOW_FONT_FILE = "NotoSansKR-Korean.woff2";
/** Copied beside every composition. */
export const SHOW_FOLDER_ASSETS = [SHOW_ANIME_FILE, SHOW_FONT_FILE] as const;

export const SHOW_LIMITS ={ audience: 40, glance: 60, materialBytes: 20 * 1024 * 1024 } as const;

/** One scene and one closing card; the whole piece stays at the 15 s ceiling. Times in ms are Anime.js positions. */
export const SHOW_TIMING = { width: 1920, height: 1080, total: 15, max: 15, revealMs: 1300, wordsAtMs: 1300, wordStaggerMs: 150, wordMs: 760, sceneOutMs: 10700, closingInMs: 11300 } as const;

// ---------------------------------------------------------------------------------------------------------------
// Flow

export type ShowStep = "audience" | "glance" | "material" | "draft" | "accepted";

export interface ShowMaterial {
  /** What the person picked, as shown to them (work-folder-relative). */
  source: string;
  /** The copy inside the show folder the composition references, e.g. `material-1.png`. */
  file: string;
}

/** Each counter is one choice the person made; nothing Studio did counts. */
export interface ShowDecisions {
  audience: number;
  glance: number;
  material: number;
  headlineEdits: number;
  accept: number;
  redo: number;
}

export interface ShowState {
  step: ShowStep;
  audience: string;
  glance: string;
  headline: string;
  material: ShowMaterial | null;
  decisions: ShowDecisions;
}

export type ShowEvent =
  | { type: "answer"; text: string }
  | { type: "back" }
  | { type: "material"; material: ShowMaterial }
  | { type: "headline"; text: string }
  | { type: "accept" }
  | { type: "redo" };

export function showInitialState(): ShowState {
  return { step: "audience", audience: "", glance: "", headline: "", material: null,
    decisions: { audience: 0, glance: 0, material: 0, headlineEdits: 0, accept: 0, redo: 0 } };
}

/** Collapses whitespace runs (including newlines) to one space; the person's words otherwise stay as typed. */
export function cleanAnswer(text: unknown): string {
  return typeof text === "string" ? text.replace(/\s+/g, " ").trim() : "";
}

function check(text: string, max: number): string | null {
  if (!text) return SHOW_COPY.emptyAnswer;
  if ([...text].length > max) return SHOW_COPY.tooLong(max);
  return null;
}

/**
 * The question flow. An event that does not belong to the current step leaves the state unchanged (same
 * object), so a stale or forged webview message cannot skip a question. `error` is the line shown under the
 * current question; a refused answer is not counted.
 */
export function showReduce(state: ShowState, event: ShowEvent): { state: ShowState; error?: string } {
  const d = state.decisions;
  switch (event.type) {
    case "answer": {
      if (state.step !== "audience" && state.step !== "glance") return { state };
      const text = cleanAnswer(event.text);
      const error = check(text, state.step === "audience" ? SHOW_LIMITS.audience : SHOW_LIMITS.glance);
      if (error) return { state, error };
      if (state.step === "audience") return { state: { ...state, step: "glance", audience: text, decisions: { ...d, audience: d.audience + 1 } } };
      return { state: { ...state, step: "material", glance: text, decisions: { ...d, glance: d.glance + 1 } } };
    }
    case "back":
      if (state.step === "glance") return { state: { ...state, step: "audience" } };
      if (state.step === "material") return { state: { ...state, step: "glance" } };
      return { state };
    case "material":
      if (state.step !== "material") return { state };
      // The headline starts as the person's own answer to "what should they see in 3 seconds".
      return { state: { ...state, step: "draft", material: event.material, headline: state.glance, decisions: { ...d, material: d.material + 1 } } };
    case "headline": {
      if (state.step !== "draft") return { state };
      const text = cleanAnswer(event.text);
      const error = check(text, SHOW_LIMITS.glance);
      if (error) return { state, error };
      if (text === state.headline) return { state };
      return { state: { ...state, headline: text, decisions: { ...d, headlineEdits: d.headlineEdits + 1 } } };
    }
    case "accept":
      if (state.step !== "draft") return { state };
      return { state: { ...state, step: "accepted", decisions: { ...d, accept: d.accept + 1 } } };
    case "redo":
      // Back to the 3-second question with the earlier answers kept for editing; the audience stays.
      if (state.step !== "draft") return { state };
      return { state: { ...state, step: "glance", decisions: { ...d, redo: d.redo + 1 } } };
  }
}

export const SHOW_DECISIONS_SCHEMA = "hps-show-decisions/1";

/** The local record beside the composition: counts only, never the person's words. No network. */
export function showDecisionRecord(state: ShowState, updated: Date) {
  const counts = { ...state.decisions };
  return {
    schema: SHOW_DECISIONS_SCHEMA,
    counts,
    total: Object.values(counts).reduce((a, b) => a + b, 0),
    outcome: state.step === "accepted" ? "accepted" : "open",
    updated: updated.toISOString(),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Material

export type ShowMaterialKind = "image" | "page";
const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp"]);
const PAGE_EXT = new Set([".html", ".htm"]);

export function showMaterialKind(name: string): ShowMaterialKind | null {
  const m = /(\.[^./\\]+)$/.exec(name.toLowerCase());
  if (!m) return null;
  if (IMAGE_EXT.has(m[1]!)) return "image";
  if (PAGE_EXT.has(m[1]!)) return "page";
  return null;
}

export const SHOW_MATERIAL_EXT: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" };
const MATERIAL_FILE = /^material-[1-9][0-9]{0,3}\.(png|jpg|gif|webp)$/;

/** `.hypeproof/show/20261112-205012`, from local time. */
export function showFolderRel(now: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `.hypeproof/show/${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
}

/**
 * Screenshot of the person's served page at 1920x1080 (the first screen), through Studio's own browser tab,
 * like pagePdf.ts. JPEG bytes or null.
 */
export async function captureShowPage(send: CdpSend, opts: { expectedUrl: string; loadTimeoutMs?: number; sleep?: (ms: number) => Promise<void> }): Promise<Uint8Array | null> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const evaluate = async (expression: string) => {
    const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (!r || r.exceptionDetails) throw new Error("evaluate failed");
    return r.result?.value;
  };
  const deadline = Date.now() + (opts.loadTimeoutMs ?? 10_000);
  let loaded = false;
  while (Date.now() < deadline) {
    const where = await evaluate(`[location.href,document.readyState]`).catch(() => null);
    if (Array.isArray(where) && where[0] === opts.expectedUrl && where[1] === "complete") { loaded = true; break; }
    await sleep(100);
  }
  if (!loaded) return null;
  let emulated = false;
  try {
    await send("Emulation.setDeviceMetricsOverride", { width: SHOW_TIMING.width, height: SHOW_TIMING.height, deviceScaleFactor: 1, mobile: false });
    emulated = true;
    await evaluate(`document.fonts ? document.fonts.ready.then(()=>true) : true`).catch(() => null);
    await sleep(200);
    const shot = await send("Page.captureScreenshot", { format: "jpeg", quality: 90,
      clip: { x: 0, y: 0, width: SHOW_TIMING.width, height: SHOW_TIMING.height, scale: 1 } }).catch(() => null);
    const data = shot?.data;
    if (typeof data !== "string" || !data || data.length > 16_000_000 || !/^[A-Za-z0-9+/]+=*$/.test(data)) return null;
    const bytes = new Uint8Array(Buffer.from(data, "base64"));
    return jpegInfo(bytes) ? bytes : null;
  } catch {
    return null;
  } finally {
    if (emulated) await send("Emulation.clearDeviceMetricsOverride").catch(() => {});
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Composition

export const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]!));


export interface ShowCompositionInput {
  headline: string;
  audience: string;
  /** The material file inside the show folder, e.g. `material-1.png`. */
  materialFile: string;
  /**
   * Playback only. `base` is the show folder's webview URI ending in `/` (the files are the same ones the disk copy
   * names); `runtimeSrc` is the vendored runtime, injected first in <head> like `hyperframes play`; `nonce` goes on
   * every script so the panel CSP admits them.
   */
  playback?: { base: string; runtimeSrc: string; nonce: string };
}

/** Bigger type for shorter text; a function of the text only. */
export function headlineSize(text: string): number {
  const n = [...text].length;
  return n <= 16 ? 80 : n <= 30 ? 72 : n <= 44 ? 62 : 54;
}
function closingSize(text: string): number {
  const n = [...text].length;
  return n <= 20 ? 68 : n <= 34 ? 56 : 46;
}

/** The person's headline as one span per word (whitespace-separated), each escaped. */
export function headlineWords(headline: string): string[] {
  return headline.split(" ").filter(Boolean);
}

/**
 * One scene (the person's material with their own words as the headline) and a closing card
 * "내가 만든 것 · <audience>에게". Person text only ever lands in element text, escaped; the script holds constants.
 * Throws on a material that is not a show-folder material file, so a path or URL can never reach the file.
 */
export function showComposition(input: ShowCompositionInput): string {
  if (!MATERIAL_FILE.test(input.materialFile)) throw new Error("show_material_file");
  const t = SHOW_TIMING;
  const play = input.playback;
  const base = play ? play.base : "";
  const src = (file: string) => escapeHtml(base + file);
  const script = play ? ` nonce="${escapeHtml(play.nonce)}"` : "";
  const words = headlineWords(input.headline);
  const ruleAt = t.wordsAtMs + t.wordStaggerMs * Math.max(0, words.length - 1) + Math.round(t.wordMs / 2);
  const closing = `내가 만든 것 · ${input.audience}에게`;
  return `<!doctype html>
<html lang="ko">
<head>
${play ? `<script${script} src="${escapeHtml(play.runtimeSrc)}"></script>\n` : ""}<meta charset="UTF-8">
<meta name="viewport" content="width=${t.width}, height=${t.height}">
<meta name="generator" content="HypeProof Studio show-what-i-made/1">
<script${script} src="${src(SHOW_ANIME_FILE)}"></script>
<style>
@font-face{font-family:"Noto Sans KR";src:url("${src(SHOW_FONT_FILE)}") format("woff2");font-weight:100 900;font-style:normal}
:root{--ground:#0b0d10;--ink:#f2f4f1;--lime:#c6ff3d;--line:rgba(242,244,241,.12)}
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:${t.width}px;height:${t.height}px;overflow:hidden;background:var(--ground)}
#root{position:relative;width:${t.width}px;height:${t.height}px;font-family:"Noto Sans KR",sans-serif;color:var(--ink)}
#scene,#scene-inner,#closing{position:absolute;inset:0}
#headline{position:absolute;left:140px;top:372px;width:660px;font-size:${headlineSize(input.headline)}px;line-height:1.24;font-weight:700;letter-spacing:-.025em;word-break:keep-all;overflow-wrap:anywhere}
#headline .w{display:inline-block;opacity:0;transform:translateY(26px)}
#rule{position:absolute;left:140px;top:690px;width:300px;height:4px;background:var(--lime);border-radius:2px;transform:scaleX(0);transform-origin:left center}
#frame{position:absolute;left:840px;top:240px;width:960px;height:600px;border-radius:20px;overflow:hidden;background:#111418;box-shadow:0 0 0 1px var(--line),0 40px 80px rgba(0,0,0,.45);clip-path:inset(100% 0% 0% 0% round 20px)}
#material{position:absolute;left:0;top:0;width:100%;height:100%;object-fit:contain;transform-origin:50% 45%}
#closing-inner{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:36px;padding:0 160px;text-align:center;opacity:0;transform:translateY(18px)}
#closing-line{font-size:${closingSize(closing)}px;font-weight:600;letter-spacing:-.02em;word-break:keep-all;overflow-wrap:anywhere}
#closing-line .sep{color:var(--lime);padding:0 .22em}
#closing-rule{width:120px;height:4px;background:var(--lime);border-radius:2px;transform:scaleX(0)}
</style>
</head>
<body>
<!-- data-no-timeline: lint's opt-out of the GSAP window.__timelines registry; motion is the Anime.js adapter's. -->
<div id="root" data-no-timeline data-composition-id="main" data-start="0" data-duration="${t.total}" data-width="${t.width}" data-height="${t.height}">
<div id="scene"><div id="scene-inner">
<div id="frame"><img id="material" src="${src(input.materialFile)}" alt="" data-layout-allow-overflow></div>
<h1 id="headline">${words.map((w) => `<span class="w">${escapeHtml(w)}</span>`).join(" ")}</h1>
<div id="rule"></div>
</div></div>
<div id="closing"><div id="closing-inner">
<p id="closing-line">내가 만든 것<span class="sep">·</span>${escapeHtml(input.audience)}에게</p>
<div id="closing-rule"></div>
</div></div>
</div>
<script${script}>
const tl = anime.createTimeline({ autoplay: false, defaults: { ease: "outCubic" } });
tl.add("#frame", { clipPath: ["inset(100% 0% 0% 0% round 20px)", "inset(0% 0% 0% 0% round 20px)"], duration: ${t.revealMs}, ease: "inOutQuart" }, 0);
tl.add("#material", { scale: [1, 1.06], duration: ${t.sceneOutMs}, ease: "inOutSine" }, 0);
tl.add("#headline .w", { opacity: [0, 1], y: [26, 0], duration: ${t.wordMs}, ease: "outQuart", delay: anime.stagger(${t.wordStaggerMs}) }, ${t.wordsAtMs});
tl.add("#rule", { scaleX: [0, 1], duration: 1000, ease: "inOutQuad" }, ${ruleAt});
tl.add("#scene-inner", { opacity: [1, 0], duration: 600, ease: "inQuad" }, ${t.sceneOutMs});
tl.add("#closing-inner", { opacity: [0, 1], y: [18, 0], duration: 1100, ease: "outCubic" }, ${t.closingInMs});
tl.add("#closing-rule", { scaleX: [0, 1], duration: 900, ease: "inOutQuad" }, ${t.closingInMs + 600});
window.__hfAnime = window.__hfAnime || [];
window.__hfAnime.push(tl);
</script>
</body>
</html>
`;
}
