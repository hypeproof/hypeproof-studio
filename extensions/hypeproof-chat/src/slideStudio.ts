// The "덱 장 다듬기" panel (CGP-ART-D-016, DES-ART-16 for REQ-STUDIO-DECK-SLIDE-SUGGEST): drafted slides as
// thumbnails, the (at most three) suggestion chips under the selected one, and the proposal as a side-by-side
// 지금 / 바꾼 안 with 반영 and 그대로. The two panes stack under 640 px. Each changed row is highlighted and shows
// the claim's evidence label (확인한 것 / 해석 / 가정), computed from the slide's refs (claimConfidence).
//
// Pure and vscode-free: the host (slideStudioHost.ts) owns the panel and the gate (slideSuggestion.ts) owns what
// may change. The page script is a constant; the view travels as JSON and is drawn with textContent only, so no
// slide text, plan title or model output can become markup or script.

import type { LearningWikiPlan, WikiState } from "./learningWiki.ts";
import type { DeckTemplate } from "./deckGenerator.ts";
import { basisLabel } from "./deckGenerator.ts";
import { claimConfidence, CONFIDENCE_LABEL, slideChips, slideFaceLines, slidePatchRows, SLIDE_CHIPS, type Confidence, type ProposalRow, type SlideChip, type SlidePatch } from "./slideSuggestion.ts";

export interface StudioSlide { no: number; title: string; headline: string; visual: string; chips: Array<{ id: SlideChip; label: string; hint: string }> }
export interface StudioView { heading: string; slides: StudioSlide[]; selected: number; status: string }
export interface StudioProposal { req: string; no: number; title: string; chip: string; rows: ProposalRow[]; confidence: Confidence; confidenceLabel: string; basis: string }

/** The drafted slides in template order; the selection falls back to the first drafted slide. */
export function slideStudioView(s: WikiState, template: DeckTemplate, plan: LearningWikiPlan | undefined, selected: number | undefined, status = ""): StudioView {
  const slides = template.slides
    .filter((t) => s.deck[String(t.no)])
    .map((t) => {
      const sl = s.deck[String(t.no)];
      return { no: t.no, title: t.title, headline: sl.headline, visual: slideFaceLines(sl)[1], chips: slideChips(s, t.no).map(({ id, label, hint }) => ({ id, label, hint })) };
    });
  const pick = slides.some((x) => x.no === selected) ? selected! : (slides[0]?.no ?? 0);
  return { heading: `${template.title || plan?.deck?.title || "피칭 덱"} · ${s.team}`, slides, selected: pick, status };
}

/** The proposal for one gated patch, bound to its request id. */
export function slideStudioProposal(s: WikiState, template: DeckTemplate, patch: SlidePatch, req: string): StudioProposal {
  const confidence = claimConfidence(s, patch.refs);
  return {
    req, no: patch.no,
    title: template.slides.find((t) => t.no === patch.no)?.title ?? "",
    chip: SLIDE_CHIPS.find((c) => c.id === patch.chip)?.label ?? "",
    rows: slidePatchRows(patch),
    confidence, confidenceLabel: CONFIDENCE_LABEL[confidence],
    basis: basisLabel(s, patch.refs),
  };
}

/** JSON safe inside a <script> element: no "<", and no U+2028/2029. */
export const scriptJson = (v: unknown) => JSON.stringify(v).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");

export const SLIDE_STUDIO_CSS = `:root{color-scheme:light dark;--fg:var(--vscode-foreground,CanvasText);--bg:var(--vscode-editor-background,Canvas);--card:var(--vscode-sideBar-background,var(--bg));--line:var(--vscode-panel-border,var(--vscode-widget-border,GrayText));--muted:var(--vscode-descriptionForeground,var(--fg));--accent:var(--vscode-focusBorder,Highlight);--btn:var(--vscode-button-background,ButtonFace);--btn-fg:var(--vscode-button-foreground,ButtonText);--changed:var(--vscode-diffEditor-insertedTextBackground,rgba(155,185,85,.2));--was:var(--vscode-diffEditor-removedTextBackground,rgba(255,0,0,.12))}
*{box-sizing:border-box}
body{margin:0;padding:16px;background:var(--bg);color:var(--fg);font-family:var(--vscode-font-family,system-ui,sans-serif);font-size:14px;line-height:1.5;word-break:keep-all;overflow-wrap:anywhere}
h1{margin:0 0 12px;font-size:16px;font-weight:700}
h2{margin:0 0 12px;font-size:16px;font-weight:700}
h3{margin:0 0 8px;font-size:14px;font-weight:700}
button{font:inherit;font-size:14px;color:inherit;cursor:pointer}
button:focus-visible{outline-width:2px;outline-style:solid;outline-color:var(--accent);outline-offset:2px}
button[aria-disabled=true]{cursor:default;opacity:.6}
.slides{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,340px),1fr));gap:16px;align-items:start}
.thumb{display:flex;flex-direction:column;gap:4px;width:100%;aspect-ratio:16/9;min-height:44px;padding:12px;text-align:start;border-width:1px;border-style:solid;border-color:var(--line);border-radius:8px;background:var(--card);overflow:hidden}
.thumb[aria-pressed=true]{border-color:var(--accent);box-shadow:inset 0 0 0 1px var(--accent)}
.thumb .kicker{font-size:14px;color:var(--muted)}
.thumb .headline{font-size:16px;font-weight:700;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.thumb .visual{font-size:14px;color:var(--muted);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.chips{display:flex;flex-wrap:wrap;gap:8px;margin-top:8px}
.chip{min-height:44px;min-width:44px;padding:0 14px;border-radius:22px;border-width:1px;border-style:solid;border-color:var(--accent);background:transparent}
.status{min-height:21px;margin:12px 0 0;color:var(--muted)}
.proposal{margin-top:20px;padding-top:16px;border-top-width:1px;border-top-style:solid;border-top-color:var(--line)}
.proposal[hidden]{display:none}
.panes{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.pane{min-width:0;padding:12px;border-width:1px;border-style:solid;border-color:var(--line);border-radius:8px;background:var(--card)}
.rows{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}
.row{display:flex;flex-direction:column;gap:2px;padding:6px 8px;border-inline-start-width:3px;border-inline-start-style:solid;border-inline-start-color:transparent;border-radius:4px}
.row-label{font-size:14px;color:var(--muted)}
.row.changed{border-inline-start-color:var(--accent)}
.after .row.changed{background:var(--changed)}
.before .row.changed{background:var(--was)}
.mark{display:flex;flex-wrap:wrap;gap:6px;align-items:center;font-size:14px;font-weight:700}
.claim-label{display:inline-block;padding:0 8px;border-radius:10px;border-width:1px;border-style:solid;border-color:var(--accent);font-weight:700}
.basis{margin:12px 0 0;color:var(--muted)}
.actions{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}
.actions button{min-height:44px;min-width:44px;padding:0 16px;border-radius:6px;border-width:1px;border-style:solid;border-color:var(--btn)}
.actions .accept{background:var(--btn);color:var(--btn-fg)}
.actions .keep{background:transparent}
@media (max-width:639.98px){.panes{grid-template-columns:1fr}}
@media (forced-colors:active){.thumb[aria-pressed=true]{border-color:Highlight}.row{border-inline-start-color:Canvas}.row.changed{border-inline-start-color:Highlight}.claim-label,.chip{border-color:CanvasText}.actions .accept{border-color:ButtonText}}`;

/** Constant page script: draws the view, sends chip and decision messages bound to the panel nonce. */
export const SLIDE_STUDIO_SCRIPT = `(function(){
var d=document,vs=acquireVsCodeApi(),N=d.body.getAttribute("data-nonce");
var view=JSON.parse(d.getElementById("studio-data").textContent),busy=false,proposal=null,lastChip=null;
var list=d.getElementById("slides"),status=d.getElementById("studio-status"),prop=d.getElementById("proposal");
function el(t,c,x){var e=d.createElement(t);if(c)e.className=c;if(x!=null)e.textContent=String(x);return e;}
function locked(){return busy||!!proposal;}
function render(){d.getElementById("studio-heading").textContent=view.heading;list.textContent="";view.slides.forEach(function(s){var li=el("li","slide-item"),b=el("button","thumb");b.type="button";b.setAttribute("data-no",String(s.no));b.setAttribute("aria-pressed",String(s.no===view.selected));if(locked())b.setAttribute("aria-disabled","true");
b.appendChild(el("span","kicker",(s.no<10?"0":"")+s.no+" · "+s.title));b.appendChild(el("span","headline",s.headline));b.appendChild(el("span","visual",s.visual));li.appendChild(b);
if(s.no===view.selected&&s.chips.length){var g=el("div","chips");g.setAttribute("role","group");g.setAttribute("aria-label",s.no+"번 장 다듬기 제안");s.chips.slice(0,3).forEach(function(c){var x=el("button","chip",c.label);x.type="button";x.title=c.hint;x.setAttribute("data-no",String(s.no));x.setAttribute("data-chip",c.id);if(locked())x.setAttribute("aria-disabled","true");g.appendChild(x);});li.appendChild(g);}
list.appendChild(li);});status.textContent=view.status||"";}
function renderProposal(){prop.textContent="";if(!proposal){prop.hidden=true;return;}var p=proposal;prop.hidden=false;
var h=el("h2",null,p.no+"번 장 · "+p.chip);h.id="proposal-title";prop.appendChild(h);var panes=el("div","panes");
[["before","지금"],["after","바꾼 안"]].forEach(function(side){var sec=el("section","pane "+side[0]);sec.setAttribute("aria-label",side[1]);sec.appendChild(el("h3",null,side[1]));var ul=el("ul","rows");
p.rows.forEach(function(r){var v=r[side[0]];if(!v&&!r.changed)return;var li=el("li","row"+(r.changed?" changed":""));li.appendChild(el("span","row-label",r.label));li.appendChild(el("span","row-text",v||"(없음)"));
if(r.changed){var m=el("span","mark");m.appendChild(el("span",null,side[0]==="after"?"바뀐 곳":"바뀌기 전"));if(side[0]==="after"){var lab=el("span","claim-label","근거 종류: "+p.confidenceLabel);lab.setAttribute("data-confidence",p.confidence);m.appendChild(lab);}li.appendChild(m);}
ul.appendChild(li);});sec.appendChild(ul);panes.appendChild(sec);});prop.appendChild(panes);
prop.appendChild(el("p","basis",p.basis+" · 근거는 그대로예요"));var a=el("div","actions"),ok=el("button","accept","반영"),keep=el("button","keep","그대로");ok.type=keep.type="button";ok.setAttribute("data-decide","1");keep.setAttribute("data-decide","0");a.appendChild(ok);a.appendChild(keep);prop.appendChild(a);keep.focus();}
function decide(accept){if(!proposal||busy)return;busy=true;vs.postMessage({nonce:N,type:"decide",req:proposal.req,accept:accept});status.textContent=accept?"반영하는 중이에요…":"";}
list.addEventListener("click",function(e){var t=e.target.closest&&e.target.closest("button");if(!t||locked())return;var no=Number(t.getAttribute("data-no"));
if(t.classList.contains("chip")){busy=true;lastChip={no:no,chip:t.getAttribute("data-chip")};render();status.textContent=no+"번 장을 다듬는 중이에요…";vs.postMessage({nonce:N,type:"chip",no:no,chip:lastChip.chip});return;}
view.selected=no;render();var again=list.querySelector('.thumb[data-no="'+no+'"]');if(again)again.focus();});
prop.addEventListener("click",function(e){var t=e.target.closest&&e.target.closest("button[data-decide]");if(t)decide(t.getAttribute("data-decide")==="1");});
d.addEventListener("keydown",function(e){if(proposal&&!busy&&(e.key==="Escape"||e.key==="Esc")&&!e.isComposing){e.preventDefault();decide(false);}});
addEventListener("message",function(e){var m=e.data;if(!m||m.nonce!==N)return;
if(m.type==="view"){view=m.view;busy=false;proposal=null;renderProposal();render();var f=lastChip&&list.querySelector('.chip[data-no="'+lastChip.no+'"][data-chip="'+lastChip.chip+'"]')||list.querySelector('.thumb[aria-pressed="true"]');if(f)f.focus();}
else if(m.type==="proposal"){busy=false;proposal=m.proposal;render();status.textContent="";renderProposal();}});
render();
})();`;

/** The panel page: inline style and script allowed only by nonce; nothing else may load. */
export function slideStudioHtml(view: StudioView, nonce: string): string {
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<title>덱 장 다듬기</title><style nonce="${nonce}">${SLIDE_STUDIO_CSS}</style></head>
<body data-nonce="${nonce}"><h1 id="studio-heading"></h1><ol class="slides" id="slides" aria-label="초안이 있는 장"></ol><p class="status" id="studio-status" role="status" aria-live="polite"></p>
<section class="proposal" id="proposal" aria-labelledby="proposal-title" hidden></section>
<script type="application/json" id="studio-data">${scriptJson(view)}</script>
<script nonce="${nonce}">${SLIDE_STUDIO_SCRIPT}</script></body></html>`;
}
