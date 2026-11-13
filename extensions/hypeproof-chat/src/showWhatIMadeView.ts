// REQ-STUDIO-SHOW-WHAT-I-MADE (#3794 slice 1) — the panel document, one question at a time. Pure: the host
// passes the nonce, the webview resource origin and, for a draft, the composition to play. The composition is
// handed to <hyperframes-player> as `srcdoc`, so it plays inside the panel's own origin and CSP: no nested
// navigation, no network. Only presentation fields cross into the panel; paths and bytes stay in the host.

import { SHOW_COPY, SHOW_LIMITS, escapeHtml, type ShowStep } from "./showWhatIMade.ts";
import { SHOW_LINK_COPY, type ShareStep } from "./showLink.ts";

/** REQ-STUDIO-SHOW-LINK: the share step as the panel shows it. Present only when the flag is on. */
export interface SharePanelView {
  step: ShareStep;
  consentGiven: boolean;
  /** The exact files 링크 만들기 sends: name, role, bytes. */
  files: { path: string; role: "scene" | "material" | "playback"; bytes: number }[];
  link?: string;
  error?: string;
  notice?: string;
  busy: boolean;
}

/** A paused player opens on a frame where the headline and material are in place, not the black frame at 0 s. */
export const SHOW_POSTER_SECONDS = 5;

export interface ShowPanelView {
  step: ShowStep;
  audience: string;
  glance: string;
  headline: string;
  /** The picked material as the person sees it (work-folder-relative). */
  materialName?: string;
  /** Work-folder-relative show folder, once something was saved. */
  savedRel?: string;
  error?: string;
  share?: SharePanelView;
}

export interface ShowPanelAssets {
  nonce: string;
  /** `webview.cspSource`: where the vendored player/runtime and the show folder are served from. */
  cspSource: string;
  playerSrc: string;
  /** The composition with the runtime injected; present for draft and accepted. */
  composition?: string;
}

const button = (id: string, label: string, primary = false) =>
  `<button id="${id}" type="button"${primary ? ' class="primary"' : ""}>${escapeHtml(label)}</button>`;

const shareLine = (share?: SharePanelView) => [share?.error ? `<p id="error" role="alert">${escapeHtml(share.error)}</p>` : "",
  share?.notice ? `<p class="note" role="status">${escapeHtml(share.notice)}</p>` : ""].join("");

/** The share step: what goes up (review), the link (shared), or the link turned off (revoked). */
function shareBody(view: ShowPanelView, share: SharePanelView, player: string): string {
  if (share.step === "review") {
    const role = (r: string) => r === "scene" ? SHOW_LINK_COPY.fileScene : r === "material" ? SHOW_LINK_COPY.fileMaterial : SHOW_LINK_COPY.filePlayback;
    const files = share.files.map((f) => `<li><code>${escapeHtml(f.path)}</code> · ${escapeHtml(role(f.role))} · ${escapeHtml(SHOW_LINK_COPY.size(f.bytes))}</li>`).join("");
    const consent = share.consentGiven
      ? `<p class="consent"><input id="consent" type="checkbox" checked disabled aria-describedby="consent-detail"><label for="consent">${escapeHtml(SHOW_LINK_COPY.consentLabel)}</label></p><p class="hint" id="consent-detail">${escapeHtml(SHOW_LINK_COPY.consentGiven)}</p>`
      : `<p class="consent"><input id="consent" type="checkbox" aria-describedby="consent-detail"><label for="consent">${escapeHtml(SHOW_LINK_COPY.consentLabel)}</label></p><p class="hint" id="consent-detail">${escapeHtml(SHOW_LINK_COPY.consentDetail)}</p>`;
    return `<h1>${escapeHtml(SHOW_LINK_COPY.heading)}</h1>${player}<p class="hint">${escapeHtml(SHOW_LINK_COPY.intro)}</p>`
      + `<h2>${escapeHtml(SHOW_LINK_COPY.filesHeading)}</h2><ul id="files">${files}</ul>`
      + `<h2>${escapeHtml(SHOW_LINK_COPY.textHeading)}</h2><ul><li>${escapeHtml(SHOW_LINK_COPY.textHeadline(view.headline))}</li><li>${escapeHtml(SHOW_LINK_COPY.textClosing(view.audience))}</li></ul>`
      + `<p class="note">${escapeHtml(SHOW_LINK_COPY.who)}</p>${consent}${shareLine(share)}`
      + `<footer>${button("shareBack", SHOW_LINK_COPY.back)}<button id="shareCreate" type="button" class="primary"${share.files.length ? "" : " disabled"}>${escapeHtml(SHOW_LINK_COPY.create)}</button></footer>`;
  }
  if (share.step === "shared") {
    return `<h1>${escapeHtml(SHOW_LINK_COPY.sharedHeading)}</h1><p class="hint">${escapeHtml(SHOW_LINK_COPY.sharedHint)}</p>`
      + `<label for="link">${escapeHtml(SHOW_LINK_COPY.linkLabel)}</label><input id="link" type="text" readonly value="${escapeHtml(share.link ?? "")}">`
      + `<p class="note">${escapeHtml(SHOW_LINK_COPY.who)}</p>${shareLine(share)}`
      + `<footer>${button("shareRevoke", SHOW_LINK_COPY.revoke)}${button("close", SHOW_COPY.close)}${button("shareCopy", SHOW_LINK_COPY.copy, true)}</footer>`;
  }
  return `<h1>${escapeHtml(SHOW_LINK_COPY.revokedHeading)}</h1><p class="hint">${escapeHtml(SHOW_LINK_COPY.revokedHint)}</p>${shareLine(share)}`
    + `<footer>${button("close", SHOW_COPY.close)}${button("share", SHOW_LINK_COPY.again, true)}</footer>`;
}

export function showPanelHtml(view: ShowPanelView, assets: ShowPanelAssets): string {
  const n = escapeHtml(assets.nonce);
  const csp = [
    "default-src 'none'",
    `img-src ${assets.cspSource} data: blob:`,
    `media-src ${assets.cspSource} blob:`,
    `style-src 'unsafe-inline' ${assets.cspSource}`,
    `font-src ${assets.cspSource}`,
    `script-src 'nonce-${n}' ${assets.cspSource}`,
    "frame-src 'self' about:",
    "connect-src 'none'",
  ].join("; ");
  const error = view.error ? `<p id="error" role="alert">${escapeHtml(view.error)}</p>` : "";
  const question = (step: number, id: string, label: string, hint: string, value: string, max: number, back: boolean) =>
    `<p class="step">${escapeHtml(SHOW_COPY.step(step))}</p><form id="ask"><label for="${id}"><h1>${escapeHtml(label)}</h1></label><p class="hint" id="${id}-hint">${escapeHtml(hint)}</p>`
    + `<input id="${id}" name="answer" type="text" maxlength="${max}" value="${escapeHtml(value)}" aria-describedby="${id}-hint" autocomplete="off" autofocus>${error}`
    + `<footer>${back ? button("back", SHOW_COPY.back) : button("close", SHOW_COPY.close)}<button id="next" type="submit" class="primary">${escapeHtml(SHOW_COPY.next)}</button></footer></form>`;
  const player = assets.composition
    ? `<div class="stage"><hyperframes-player id="player" srcdoc="${escapeHtml(assets.composition)}" controls muted></hyperframes-player></div>`
    : "";
  let body: string;
  switch (view.step) {
    case "audience":
      body = question(1, "audience", SHOW_COPY.audienceQuestion, SHOW_COPY.audienceHint, view.audience, SHOW_LIMITS.audience, false);
      break;
    case "glance":
      body = question(2, "glance", SHOW_COPY.glanceQuestion, SHOW_COPY.glanceHint, view.glance, SHOW_LIMITS.glance, true);
      break;
    case "material":
      body = `<p class="step">${escapeHtml(SHOW_COPY.step(3))}</p><h1>${escapeHtml(SHOW_COPY.materialQuestion)}</h1><p class="hint">${escapeHtml(SHOW_COPY.materialHint)}</p>${error}`
        + `<footer>${button("back", SHOW_COPY.back)}${button("pick", SHOW_COPY.pick, true)}</footer>`;
      break;
    case "draft":
      body = `<h1>${escapeHtml(SHOW_COPY.draftHeading)}</h1>${player}<p class="hint">${escapeHtml(SHOW_COPY.draftHint)}</p>`
        + `<form id="retitle"><label for="headline">${escapeHtml(SHOW_COPY.headlineLabel)}</label><div class="row"><input id="headline" type="text" maxlength="${SHOW_LIMITS.glance}" value="${escapeHtml(view.headline)}" autocomplete="off">`
        + `<button id="apply" type="submit">${escapeHtml(SHOW_COPY.applyHeadline)}</button></div></form>${error}`
        + `<p class="note">${escapeHtml(SHOW_COPY.notShared)}</p><footer>${button("redo", SHOW_COPY.redo)}${button("accept", SHOW_COPY.accept, true)}</footer>`;
      break;
    case "accepted":
      body = view.share && view.share.step !== "closed" ? shareBody(view, view.share, player)
        : `<h1>${escapeHtml(SHOW_COPY.acceptedHeading)}</h1>${player}${view.savedRel ? `<p class="note">${escapeHtml(SHOW_COPY.savedAt(view.savedRel))}</p>` : ""}`
        + `<p class="note">${escapeHtml(SHOW_COPY.notShared)}</p>${shareLine(view.share)}`
        + `<footer>${button("close", SHOW_COPY.close, !view.share)}${view.share ? button("share", SHOW_LINK_COPY.open, true) : ""}</footer>`;
      break;
  }
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="${csp}"><style>
body{margin:0;padding:24px;font:14px/1.5 system-ui,sans-serif;color:var(--vscode-foreground);background:var(--vscode-editor-background);overflow-wrap:anywhere}
main{max-width:960px;margin:auto}h1{font-size:22px;margin:4px 0 8px;font-weight:700}.step{margin:0;opacity:.8}.hint,.note{margin:8px 0}
label{display:block;font-weight:600}input{box-sizing:border-box;width:100%;min-height:44px;font:inherit;font-size:16px;padding:8px 12px;color:var(--vscode-input-foreground,inherit);background:var(--vscode-input-background,transparent);border:1px solid var(--vscode-input-border,var(--vscode-panel-border,#777));border-radius:4px}
.row{display:flex;gap:8px;flex-wrap:wrap}.row input{flex:1 1 240px;width:auto}
button{font:inherit;min-height:44px;min-width:44px;padding:8px 16px;border:1px solid var(--vscode-button-border,transparent);border-radius:4px;color:var(--vscode-button-secondaryForeground,var(--vscode-foreground));background:var(--vscode-button-secondaryBackground,transparent);cursor:pointer}
button.primary{color:var(--vscode-button-foreground);background:var(--vscode-button-background)}
button:focus-visible,input:focus-visible{outline:2px solid var(--vscode-focusBorder,Highlight);outline-offset:2px}
h2{font-size:16px;margin:16px 0 4px}ul{margin:4px 0;padding-left:20px}code{overflow-wrap:anywhere}.consent{display:flex;gap:8px;align-items:center;margin:16px 0 0;font-weight:600}.consent input{width:20px;height:20px;min-height:0}
footer{display:flex;flex-wrap:wrap;gap:12px;margin-top:20px}#error{color:var(--vscode-errorForeground,inherit);font-weight:600}
.stage{width:100%;aspect-ratio:16/9;margin:12px 0;background:#0b0d10;border-radius:4px;overflow:hidden}hyperframes-player{display:block;width:100%;height:100%}
@media(max-width:480px){body{padding:16px}}@media(forced-colors:active){button,input{border:1px solid CanvasText}}
</style></head><body><main>${body}</main>
${assets.composition ? `<script nonce="${n}" src="${escapeHtml(assets.playerSrc)}"></script>` : ""}
<script nonce="${n}">(()=>{const api=acquireVsCodeApi(),nonce=${JSON.stringify(assets.nonce)};let sent=false;
const send=m=>{if(sent)return;sent=true;document.querySelectorAll('button,input').forEach(b=>b.disabled=true);api.postMessage({...m,nonce})};
const on=(id,fn)=>{const e=document.getElementById(id);if(e)e.addEventListener('click',fn)};
const ask=document.getElementById('ask');if(ask)ask.addEventListener('submit',e=>{e.preventDefault();send({type:'answer',text:ask.answer.value})});
const retitle=document.getElementById('retitle');if(retitle)retitle.addEventListener('submit',e=>{e.preventDefault();send({type:'headline',text:document.getElementById('headline').value})});
on('share',()=>send({type:'share'}));on('shareBack',()=>send({type:'shareBack'}));on('shareCopy',()=>send({type:'shareCopy'}));on('shareRevoke',()=>send({type:'shareRevoke'}));
on('shareCreate',()=>{const c=document.getElementById('consent');send({type:'shareCreate',consent:!!(c&&c.checked)})});
const link=document.getElementById('link');if(link)link.addEventListener('focus',()=>link.select());
on('back',()=>send({type:'back'}));on('pick',()=>send({type:'pick'}));on('redo',()=>send({type:'redo'}));on('accept',()=>send({type:'accept'}));on('close',()=>send({type:'close'}));
document.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();send({type:'close'})}});
const pl=document.getElementById('player');if(pl){let i=0;const t=setInterval(()=>{i++;try{if(pl.duration>0){clearInterval(t);if(pl.paused&&!(pl.currentTime>0))pl.seek(${SHOW_POSTER_SECONDS})}}catch{}if(i>100)clearInterval(t)},100)}})();</script></body></html>`;
}
