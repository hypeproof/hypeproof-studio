export interface ImageEditRequest {schema:'hps-image-edit/1';original:{data_url:string;sha256:string};operation:'remove_background'|'edit';instruction:string;preserve:string;transparent:boolean}
export interface ImageEditResult {
 schema:'hps-image-edit-result/1';id:string;state:'queued'|'dispatched'|'succeeded'|'failed'|'unknown'|'cancelled'|'completed_after_cancel';
 original_sha256:string;operation:string;transparent:boolean;cancel_requested:boolean;error_code:string|null;
 provider:{name:string;model:string;request_id:string|null};cost:{request_id:string;recording_state:string;pricing:string;amount_micro:number|string|null;currency:string|null;price_revision:string|null;unit:'micro_currency';issues?:string[]};
 output:{sha256:string;mime:'image/png';width:number;height:number;hasAlpha:boolean;transparentPixels:number;opaquePixels:number;partialAlphaPixels:number;expires_at:number}|null;
 semantic_preservation:'not_verified';
}
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export class ImageEditClient {
 private readonly base:string;private readonly token:string;
 constructor(args:{proxyUrl:string;token:string}){const url=new URL(args.proxyUrl);if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw new Error('이미지 편집 서버 주소가 올바르지 않아요.');this.base=args.proxyUrl.replace(/\/$/,'')+'/image-edits';this.token=args.token;}
 private url(id:string,suffix=''):string{if(!UUID.test(id))throw new Error('이미지 작업 ID가 올바르지 않아요.');return `${this.base}/${id}${suffix}`;}
 private async request(id:string,args:{method?:string;body?:ImageEditRequest;suffix?:string;signal?:AbortSignal}={}):Promise<Response>{
  const r=await fetch(this.url(id,args.suffix),{method:args.method??'GET',headers:{authorization:`Bearer ${this.token}`,...(args.body?{'content-type':'application/json'}:{})},...(args.body?{body:JSON.stringify(args.body)}:{}),signal:args.signal});
  if(!r.ok){let code='image_edit_unavailable';try{code=(await r.json() as {error?:{code?:string}}).error?.code??code;}catch{/* no raw provider prose */}throw new Error(imageEditFailureMessage(code));}return r;
 }
 private async result(r:Response):Promise<ImageEditResult>{const body=await r.json() as ImageEditResult;if(body.schema!=='hps-image-edit-result/1'||!UUID.test(body.id)||!['queued','dispatched','succeeded','failed','unknown','cancelled','completed_after_cancel'].includes(body.state))throw new Error('이미지 편집 상태를 확인하지 못했어요. 작업을 다시 실행하기 전에 기록을 확인해 주세요.');return body;}
 async start(id:string,input:ImageEditRequest,signal?:AbortSignal):Promise<ImageEditResult>{return this.result(await this.request(id,{method:'POST',body:input,signal}));}
 async status(id:string):Promise<ImageEditResult>{return this.result(await this.request(id));}
 async cancel(id:string):Promise<ImageEditResult>{return this.result(await this.request(id,{method:'POST',suffix:'/cancel'}));}
 async output(id:string):Promise<Uint8Array>{const r=await this.request(id,{suffix:'/output'});if(r.headers.get('content-type')?.split(';')[0]!=='image/png')throw new Error('편집 결과가 PNG 이미지가 아니에요.');const max=8*1024*1024;if(Number(r.headers.get('content-length')??0)>max)throw new Error('편집 결과가 너무 커요.');const reader=r.body?.getReader();if(!reader)throw new Error('편집 결과가 없어요.');const chunks:Uint8Array[]=[];let size=0;try{for(;;){const n=await reader.read();if(n.done)break;size+=n.value.length;if(size>max)throw new Error('편집 결과가 너무 커요.');chunks.push(n.value);}}finally{await reader.cancel().catch(()=>{});}const bytes=new Uint8Array(size);let at=0;for(const b of chunks){bytes.set(b,at);at+=b.length;}return bytes;}
}
export function imageEditFailureMessage(code:string):string{
 const messages:Record<string,string>={image_edit_disabled:'이미지 편집 기능이 아직 준비되지 않았어요.',image_edit_off:'이 활동은 이미지 편집을 허용하지 않아요.',image_edit_provider_not_configured:'이미지 편집 제공자 연결이 아직 준비되지 않았어요.',media_budget_not_supported:'이 이용권은 이미지 편집 예산을 아직 지원하지 않아요.',lesson_image_edit_not_supported:'이 수업 버전은 이미지 편집 권한을 아직 지원하지 않아요.',trial_busy_or_exhausted:'체험 요청이 진행 중이거나 허용 횟수를 모두 사용했어요.',image_edit_output_opaque:'배경이 투명하지 않아 결과를 적용하지 않았어요.',image_edit_output_empty_subject:'편집 결과에 보이는 대상이 없어 적용하지 않았어요.',image_edit_id_conflict:'같은 작업 ID에 다른 편집 요청이 있어요. 기존 기록을 확인해 주세요.',image_edit_png_required:'현재는 PNG 원본을 편집할 수 있어요. PNG 사본을 선택해 주세요.',image_edit_output_expired:'서버의 편집 결과 보관 기간이 지났어요. 저장한 새 파일을 확인해 주세요.'};
 return messages[code]??'이미지 편집 상태를 확인하지 못했어요. 원본은 보존됩니다. 다시 실행하기 전에 기존 작업 기록을 확인해 주세요.';
}
