// REQ-STUDIO-WRITE-APPROVAL-CHANGE (CGP-ART-R-021): the view of one overwrite and its copy live here, not in
// writeApprovalChange.ts, because the webview imports this file and must not bundle node:fs.
export type WriteChangeUnknownReason = "large" | "binary" | "unreadable" | "no-edit" | "no-match" | "ambiguous" | "no-change";

/** What the dialog shows for one existing file. Plain data: it is posted to the webview. */
export type WriteChangeView =
  | {
    kind: "measured";
    /** "37%", "1% 미만", "약 37%" (diffGuard's estimate beyond its exact range). */
    percent: string;
    /** diffGuard `changed_ratio`, 0..1. */
    ratio: number;
    changedLines: number;
    addedLines: number;
    /** `changed_ratio` above diffGuard's REWRITE_RATIO (0.5): the coach-side diff guard calls this save a rewrite. */
    rewrite: boolean;
    /** `changed_ratio` at or above ALMOST_ALL_RATIO: the label may honestly say "거의 전부". */
    almostAll: boolean;
    /** Nothing but whitespace or line breaks differ (diffGuard normalises whitespace inside a unit). */
    spacingOnly: boolean;
    /** CGP-ART-D-021: the text after the call differs from the file now, so the host can show the two side by side. */
    diff?: boolean;
  }
  | { kind: "unknown"; reason: WriteChangeUnknownReason };

/** Share of the existing content at which "거의 전부 바뀌어요" is an honest description (owner decision, CGP-ART-R-021). */
export const ALMOST_ALL_RATIO = 0.8;

/** The warning line for a measured change, or null when it is not a rewrite. */
export function writeChangeWarning(v: Extract<WriteChangeView, { kind: "measured" }>): string | null {
  if (!v.rewrite) return null;
  return v.almostAll ? WRITE_CHANGE_TEXT.rewrite : WRITE_CHANGE_TEXT.overHalf;
}

export const WRITE_CHANGE_TEXT = {
  heading: "바뀌는 정도",
  /** A rewrite at or above ALMOST_ALL_RATIO. */
  rewrite: "거의 전부 바뀌어요",
  /** A rewrite below ALMOST_ALL_RATIO: still more than half, so still warned, without overstating it. */
  overHalf: "절반 넘게 바뀌어요",
  spacing: "글자는 그대로, 띄어쓰기·줄바꿈만 달라져요",
  /** CGP-ART-D-021: opens the file now and the text after the call side by side; it never answers the dialog. */
  showDiff: "바뀐 곳 보기",
  same: "내용은 그대로예요",
  unknown: "얼마나 바뀌는지 미리 알 수 없어요",
  reasons: {
    large: "파일이 너무 커요",
    binary: "글자 파일이 아니에요",
    unreadable: "파일을 읽지 못했어요",
    "no-edit": "바꿀 내용을 알 수 없어요",
    "no-match": "바꿀 부분을 파일에서 찾지 못했어요",
    ambiguous: "바꿀 부분이 파일에 여러 군데 있어요",
    "no-change": "바꾸기 전과 후가 같아요",
  } satisfies Record<WriteChangeUnknownReason, string>,
} as const;

/** CGP-ART-D-021 (DES-ART-21): the change bar has this many steps. */
export const WRITE_CHANGE_STEPS = 4;

/**
 * CGP-ART-D-021: filled steps of the change bar, aligned with the words beside it so the bar never says more than
 * the label: 0 when no existing content changes, 1 up to a quarter, 2 up to half (not a rewrite), 3 for a rewrite
 * below ALMOST_ALL_RATIO ("절반 넘게"), 4 only at or above it ("거의 전부").
 */
export function writeChangeSteps(v: Extract<WriteChangeView, { kind: "measured" }>): number {
  if (v.ratio === 0 && v.addedLines === 0) return 0;
  if (v.rewrite) return v.almostAll ? 4 : 3;
  return v.ratio > 0.25 ? 2 : 1;
}

/** CGP-ART-D-021: the bar's text equivalent (the visible percentage stays beside it). */
export const writeChangeStepsLabel = (v: Extract<WriteChangeView, { kind: "measured" }>): string =>
  `${WRITE_CHANGE_TEXT.heading} ${v.percent} · ${WRITE_CHANGE_STEPS}칸 중 ${writeChangeSteps(v)}칸`;

/** The lines under "바뀌는 정도: {percent}" for a measured change. */
export function writeChangeDetail(v: Extract<WriteChangeView, { kind: "measured" }>): string {
  if (v.ratio === 0 && v.addedLines === 0) return v.spacingOnly ? WRITE_CHANGE_TEXT.spacing : WRITE_CHANGE_TEXT.same;
  const parts: string[] = [];
  if (v.changedLines > 0) parts.push(`바뀌는 줄 ${v.changedLines}개`);
  if (v.addedLines > 0) parts.push(`새 줄 ${v.addedLines}개`);
  return parts.join(" · ");
}

export interface WriteApprovalPrompt {
  id: string; title: string; verb: string; files: string[];
  /** Same order as `files`: the change summary of each existing file, null for a file that does not exist yet. */
  changes?: Array<WriteChangeView | null>;
}
/** Request-bound presentation only. Path/permission checks remain in the existing host gate. */
export class WriteApprovalRequest {
  generation=0;
  private observedScope?:string;
  private pending?: {id:string;scope:string;finish:(approved:boolean)=>void};
  private readonly ports:{scope():string;present(prompt:WriteApprovalPrompt|null):Promise<boolean|void>};
  private readonly timeoutMs:number;
  constructor(ports:{scope():string;present(prompt:WriteApprovalPrompt|null):Promise<boolean|void>}, timeoutMs=180_000) {this.ports=ports;this.timeoutMs=timeoutMs;}
  confirm(prompt:WriteApprovalPrompt):Promise<boolean> {
    this.invalidate();
    if(this.pending || !prompt.id || !prompt.files.length) return Promise.resolve(false);
    const frozen=structuredClone(prompt), scope=this.ports.scope();
    return new Promise(resolve=>{
      const timer=setTimeout(()=>this.cancel(),this.timeoutMs);
      this.pending={id:frozen.id,scope,finish:approved=>{clearTimeout(timer);this.pending=undefined;void this.ports.present(null).catch(()=>{});resolve(approved);}};
      void this.ports.present(frozen).then(shown=>{if(shown!==true && this.pending?.id===frozen.id)this.cancel();}).catch(()=>{if(this.pending?.id===frozen.id)this.cancel();});
    });
  }
  respond(id:unknown,approved:unknown):void {
    if(!this.pending || id!==this.pending.id)return;
    this.pending.finish(approved===true && this.pending.scope===this.ports.scope());
  }
  invalidate():void {
    const scope=this.ports.scope();
    if(this.observedScope!==undefined && this.observedScope!==scope)this.cancel();
    this.observedScope=scope;
  }
  cancel():void {this.generation++;this.pending?.finish(false);}
}
