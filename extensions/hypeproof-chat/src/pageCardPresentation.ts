import { artifactVersionFor } from './artifactVersion.ts';
import { readPageInFolder } from './pageCardHost.ts';
import { productVerification } from '@hypeproof/measurement-core/verification';
import type { ObservationEvent } from '@hypeproof/measurement-core/legacy-observation';
import type { PageCardPresentation } from './pageCard.ts';

/** A title is page-owned text, never HTML, a command or evidence of verification. */
export function pageResultTitle(html: string, fallback: string): string {
 const raw=/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html)?.[1] ?? fallback;
 return raw.replace(/<[^>]*>/g,'').replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g,' ').replace(/\s+/g,' ').trim().slice(0,200) || fallback;
}

export function pageResultState(version: string, current: string | null, events: readonly ObservationEvent[]): PageCardPresentation['status'] {
 if(current!==version)return 'previous';
 return productVerification(events,version).state==='verified'?'verified':'unchecked';
}

/** Capture is only retained when the file set is still the exact version measured before it. */
export async function capturePageResult(root: string, rel: string, ports: {
 events():readonly ObservationEvent[];
 capture(path:string,signal:AbortSignal):Promise<{title:string;dataUrl:string}|null>;
 current():boolean;
 publish(view:PageCardPresentation):void;
}, timeoutMs=2000):Promise<void> {
 const read=readPageInFolder(root,rel);if(!read.ok||!ports.current())return;
 const entry='/'+rel.split('/').map(encodeURIComponent).join('/');
 const before=await artifactVersionFor(root,entry);if(!ports.current())return;
 let view:PageCardPresentation={versionId:before.id,title:pageResultTitle(read.text,rel),status:pageResultState(before.id,before.id,ports.events()),thumbnail:{state:'loading'}};
 ports.publish(view);
 const abort=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
 try {
  const timeout=new Promise<null>(resolve=>{timer=setTimeout(()=>{abort.abort();resolve(null)},timeoutMs)});
  const shot=await Promise.race([ports.capture(entry,abort.signal).catch(()=>null),timeout]);
  const after=await artifactVersionFor(root,entry).catch(()=>null);
  if(!ports.current())return;
  const same=after?.id===before.id;
  const valid=same&&shot&&typeof shot.title==='string'&&typeof shot.dataUrl==='string'&&/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+=*$/.test(shot.dataUrl)&&shot.dataUrl.length<=2_000_000;
  view={...view,status:pageResultState(before.id,after?.id??null,ports.events()),thumbnail:valid?{state:'ready',dataUrl:shot.dataUrl}:{state:'failed'}};
  if(valid)view.title=pageResultTitle(`<title>${shot.title}</title>`,view.title);
  ports.publish(view);
 } finally {if(timer)clearTimeout(timer);abort.abort();}
}
