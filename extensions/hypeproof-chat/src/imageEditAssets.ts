import * as fs from 'node:fs';
import * as path from 'node:path';
import { inspectEditPng,imageBytesHash,type PngInfo } from './imageEditPng.ts';
import type { ImageEditResult } from './imageEditClient.ts';
import { classifyDenial, denialCopy } from './denialSource.ts';
import { noteHostWrite } from './artifactProvenance.ts';
export interface ImageEditAsset {relativePath:string;sha256:string;dataUrl:string;bytes:Uint8Array;info:PngInfo}
function workspaceFile(cwd:string,rel:string,allowMissing=false):string{
 const root=fs.realpathSync(cwd);if(!rel||path.isAbsolute(rel)||/[\\\x00]/.test(rel)||rel.split('/').some(p=>!p||p==='.'||p==='..'))throw new Error('작업 폴더 안의 이미지 상대경로만 사용할 수 있어요.');
 let at=root;for(const part of rel.split('/')){at=path.join(at,part);if(allowMissing&&!fs.existsSync(at))continue;if(fs.lstatSync(at).isSymbolicLink())throw new Error('연결된 파일·폴더를 이미지 작업에 쓰지 않았어요.');}
 const relative=path.relative(root,at);if(relative==='..'||relative.startsWith(`..${path.sep}`)||path.isAbsolute(relative))throw new Error(denialCopy({source:classifyDenial('path_outside_workspace'),reason:'작업 폴더 밖의 파일이에요'}));return at;
}
export async function prepareImageEditAsset(cwd:string,relativePath:string):Promise<ImageEditAsset>{
 const file=workspaceFile(cwd,relativePath);const st=fs.lstatSync(file);if(!st.isFile()||st.size===0||st.size>4*1024*1024)throw new Error('4MB 이하의 PNG 원본을 선택해 주세요.');
 const fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW??0));
 try{
  // O_NOFOLLOW covers only the final component. Bind the opened handle to the
  // pre-open identity, then recheck every component and its physical location.
  const unchanged=()=>{
   const opened=fs.fstatSync(fd),current=fs.lstatSync(file);
   if(!opened.isFile()||opened.dev!==st.dev||opened.ino!==st.ino||opened.size!==st.size||opened.mtimeMs!==st.mtimeMs||opened.ctimeMs!==st.ctimeMs||current.dev!==opened.dev||current.ino!==opened.ino||current.isSymbolicLink()||workspaceFile(cwd,relativePath)!==file||fs.realpathSync(file)!==file)throw new Error('읽는 동안 이미지 위치·내용이 바뀌었어요. 다시 선택해 주세요.');
  };
  unchanged();
  const bytes=fs.readFileSync(fd);unchanged();
  if(bytes.length!==st.size||bytes.length>4*1024*1024)throw new Error('4MB 이하의 변경되지 않은 PNG 원본을 선택해 주세요.');
  let info:PngInfo;try{info=await inspectEditPng(bytes);}catch{throw new Error('지원되는 PNG 원본을 읽지 못했어요. RGB/RGBA PNG 사본을 선택해 주세요.');}
  const sha256=await imageBytesHash(bytes);unchanged();
  return {relativePath,bytes,info,sha256,dataUrl:`data:image/png;base64,${Buffer.from(bytes).toString('base64')}`};
 }finally{fs.closeSync(fd);}
}
/** A new exclusive file only. Saving never means adopting or visually accepting the edit. */
export async function saveImageEditOutput(cwd:string,original:ImageEditAsset,job:ImageEditResult,bytes:Uint8Array):Promise<{relativePath:string;sha256:string;info:PngInfo}>{
 if(job.state!=='succeeded'||job.cancel_requested||job.original_sha256!==original.sha256||!job.output)throw new Error('완료가 확인된 편집 결과만 새 파일로 저장할 수 있어요.');
 if((await prepareImageEditAsset(cwd,original.relativePath)).sha256!==original.sha256)throw new Error('원본 파일이 작업 중 바뀌었어요. 이전 결과를 자동 적용하지 않았어요.');
 if(bytes.length>8*1024*1024)throw new Error('편집 결과가 너무 커요.');
 const info=await inspectEditPng(bytes),sha256=await imageBytesHash(bytes);
 if(sha256!==job.output.sha256||info.width!==job.output.width||info.height!==job.output.height)throw new Error('편집 결과의 해시·크기가 작업 기록과 달라 저장하지 않았어요.');
 if(job.transparent&&(!info.hasAlpha||info.transparentPixels===0)||info.opaquePixels+info.partialAlphaPixels===0)throw new Error('투명 배경·대상 보존을 확인할 수 없어 저장하지 않았어요.');
 if(!/^[a-f0-9-]{36}$/i.test(job.id))throw new Error('편집 작업 ID가 올바르지 않아요.');
 const stem=path.basename(original.relativePath,path.extname(original.relativePath)).replace(/[^\p{L}\p{N}_-]/gu,'-').slice(0,48)||'image';
 const rel=`images/edited/${stem}-${job.id}-${sha256.slice(0,12)}.png`,file=workspaceFile(cwd,rel,true);
 fs.mkdirSync(path.dirname(file),{recursive:true});workspaceFile(cwd,rel,true);
 fs.writeFileSync(file,bytes,{flag:'wx'});noteHostWrite([{absPath:file,data:bytes}],'ai');return {relativePath:rel,sha256,info};
}
export function imageEditSelection(original:ImageEditAsset,editedPath:string,action:'adopt'|'restore'):string{if(action!=='adopt'&&action!=='restore')throw new Error('이미지 선택 동작이 올바르지 않아요.');return action==='restore'?original.relativePath:editedPath;}
function escape(value:string):string{return value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));}
/** Host supplies webview-safe image URIs and a cryptographic nonce. No provider keys or remote assets. */
export function imageEditComparisonHtml(args:{originalUri:string;editedUri:string;originalPath:string;editedPath:string;nonce:string;source:string}):string{
 if(!/^[A-Za-z0-9_-]{16,128}$/.test(args.nonce))throw new Error('Invalid image comparison nonce');
 if(!/^(?:vscode-webview(?:-resource)?:|https:\/\/)[A-Za-z0-9.*:/_-]*$/.test(args.source))throw new Error('Invalid image comparison source');
 return `<!doctype html><html lang="ko"><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${escape(args.source)} data:; style-src 'nonce-${args.nonce}'; script-src 'nonce-${args.nonce}';"><title>이미지 편집 전후 비교</title><style nonce="${args.nonce}">body{font:16px system-ui;padding:24px;color:var(--vscode-foreground);background:var(--vscode-editor-background)}.pair{display:grid;grid-template-columns:1fr 1fr;gap:20px}.frame{padding:12px;background:repeating-conic-gradient(#ddd 0% 25%,#fff 0% 50%) 0/20px 20px}.frame img{max-width:100%;height:auto}button{padding:12px;margin:8px 8px 8px 0}select{padding:8px}@media(max-width:700px){.pair{grid-template-columns:1fr}}</style><h1>원본과 편집 결과 비교</h1><p>대상 형태·가장자리·세부 무늬를 확인한 뒤 선택해 주세요. 파일 저장은 품질 인수가 아닙니다.</p><label>비교 배경 <select id="background"><option value="checker">체커보드</option><option value="white">밝은 배경</option><option value="black">어두운 배경</option></select></label><div class="pair"><section><h2>원본</h2><div class="frame"><img src="${escape(args.originalUri)}" alt="편집 전 원본"></div><p>${escape(args.originalPath)}</p></section><section><h2>편집 결과</h2><div class="frame"><img src="${escape(args.editedUri)}" alt="편집 후 결과"></div><p>${escape(args.editedPath)}</p></section></div><button data-action="adopt">편집 결과 사용</button><button data-action="restore">원본 사용으로 되돌리기</button><p id="status" aria-live="polite">원본 파일은 보존되어 있습니다.</p><script nonce="${args.nonce}">const vscode=acquireVsCodeApi();document.querySelector('#background').addEventListener('change',e=>{for(const frame of document.querySelectorAll('.frame'))frame.style.background=e.target.value==='checker'?'':e.target.value});for(const button of document.querySelectorAll('[data-action]'))button.addEventListener('click',()=>vscode.postMessage({type:'imageEditSelection',action:button.dataset.action}));</script></html>`;
}
