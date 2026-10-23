import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { startVisitorSnapshot, visitorPreviewHtml, visitorContentType, VISITOR_CSP, VISITOR_FALLBACK_MS } from '../src/visitorPreview.ts';
import { buildPublishSet } from '../src/publishSet.ts';
import { publishWorldConfirmed } from '../src/galleryPublish.ts';
import { PublishSession } from '../src/publishSession.ts';
const root=mkdtempSync(join(tmpdir(),'visitor-preview-'));
try {
 writeFileSync(join(root,'index.html'),'<h1>공개할 작품</h1><link rel="stylesheet" href="style.css">');
 writeFileSync(join(root,'style.css'),'h1{color:blue}');
 writeFileSync(join(root,'private.txt'),'not published');
 const built=await buildPublishSet(root,'/index.html',[],{});assert.equal(built.ok,true);
 const snapshot={...built.set,audience:'링크를 받은 사람'};
 const original=Buffer.from(snapshot.files[0].data);
 const server=await startVisitorSnapshot(snapshot);
 try {
  snapshot.files[0].data.fill(120);
  assert.equal(await (await fetch(server.url)).text(),original.toString(),'snapshot cannot change after preview starts');
  const origin=new URL(server.url).origin;
  assert.equal((await fetch(origin+'/style.css')).status,200);
  for(const path of ['/private.txt','/.env','/%2e%2e%2fprivate.txt','/%ZZ','/missing'])assert.ok((await fetch(origin+path)).status>=400,path);
  assert.equal((await fetch(server.url,{method:'POST'})).status,403);
  const status=await new Promise(resolve=>{const r=request(server.url,{headers:{host:'evil.invalid'}},res=>{res.resume();resolve(res.statusCode)});r.end()});assert.equal(status,403);
  const res=await fetch(server.url);assert.equal(res.headers.get('cache-control'),'no-store');assert.equal(res.headers.get('content-security-policy'),VISITOR_CSP);
  // The snapshot's own policy, directive by directive: nothing may be widened (M31: frame-src *
  // would let the framed page embed outside origins, which the parent's frame-src cannot stop).
  const directives=csp=>Object.fromEntries(csp.split(';').map(d=>d.trim()).filter(Boolean).map(d=>{const [k,...v]=d.split(/\s+/);return [k,v.join(' ')]}));
  assert.deepEqual(directives(res.headers.get('content-security-policy')),{'default-src':"'self'",'script-src':"'self' 'unsafe-inline'",'style-src':"'self' 'unsafe-inline'",'img-src':"'self' data:",'connect-src':"'self'",'object-src':"'none'",'frame-src':"'none'",'worker-src':"'none'",'form-action':"'none'",'base-uri':"'none'",'sandbox':'allow-scripts allow-same-origin'},'snapshot CSP is exactly the narrow policy');
  assert.ok(!/\*/.test(VISITOR_CSP),'no wildcard source in the snapshot CSP');
  // The parent panel's own policy: frames only the snapshot origin, never a wildcard.
  const panelCsp=directives(/http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(visitorPreviewHtml(snapshot,server.url,'n'))[1]);
  assert.equal(panelCsp['frame-src'],origin,'panel frame-src is exactly the snapshot origin');assert.equal(panelCsp['default-src'],"'none'");
  assert.ok(!Object.values(panelCsp).some(v=>v.includes('*')),'no wildcard in the panel CSP');
  const html=visitorPreviewHtml({...snapshot,audience:'<script>bad</script>'},server.url,'safe');
  assert.ok(html.includes('&lt;script&gt;bad&lt;/script&gt;'));assert.ok(!html.includes('<script>bad</script>'));
  assert.match(html,/공개할 파일 2개/);assert.ok(!html.includes('private.txt'));
 } finally {server.close()}
 const directory=await startVisitorSnapshot({entry:'index.html',audience:'public',files:[{path:'index.html',data:Buffer.from('home')},{path:'nested/index.html',data:Buffer.from('nested')}]});
 try{assert.equal(await (await fetch(new URL('/nested/',directory.url))).text(),'nested');assert.equal((await fetch(new URL('/private/',directory.url))).status,404)}finally{directory.close()}
 // Fidelity: types are served by extension (nosniff would otherwise break module scripts, fonts).
 const types={'app.mjs':'text/javascript; charset=utf-8','a.js':'text/javascript; charset=utf-8','a.gif':'image/gif','a.ico':'image/x-icon','a.png':'image/png','a.woff':'font/woff','a.woff2':'font/woff2','a.ttf':'font/ttf','a.wav':'audio/wav','a.ogg':'audio/ogg','a.webm':'video/webm','a.txt':'text/plain; charset=utf-8','a.svg':'image/svg+xml; charset=utf-8','a.json':'application/json; charset=utf-8','A.MJS':'text/javascript; charset=utf-8','a.unknownext':'text/plain; charset=utf-8'};
 const typed=await startVisitorSnapshot({entry:'index.html',audience:'public',files:[{path:'index.html',data:Buffer.from('x')},...Object.keys(types).map(path=>({path,data:Buffer.from('x')}))]});
 try{for(const [path,type] of Object.entries(types)){assert.equal(visitorContentType(path),type,path);assert.equal((await fetch(new URL('/'+path,typed.url))).headers.get('content-type'),type,path)}}finally{typed.close()}
 // M25: the shipped fallback delay is pinned; the panel behaviour around it is in -host and -layout.
 assert.equal(VISITOR_FALLBACK_MS,15_000,'fallback delay is 15 s');
 let sends=0, preview, sentHtml;
 const input={siteBase:'https://gallery.invalid',token:'t',worldId:'w',title:'t',html:'<h1>snapshot</h1>',fetchImpl:async(u,i)=>{sends++;sentHtml=JSON.parse(i.body).html;return Response.json({ok:true,url:'/w'})}};
 for(const hook of [undefined,async()=>false])assert.equal((await publishWorldConfirmed({...input,previewVisitor:hook},async()=>true,async()=>true)).ok,false);
 assert.equal(sends,0);
 let current=true;
 assert.equal((await publishWorldConfirmed({...input,previewVisitor:async s=>{preview=s;current=false;return true}},async()=>true,async()=>current)).ok,false);assert.equal(sends,0);
 assert.equal(preview.files[0].data.toString(),input.html);assert.match(preview.audience,/gallery.invalid.*인터넷의 누구나/);
 // M29: the gallery preview audience is exactly the consent recipient plus the public scope,
 // and its single file is byte-identical to what is sent.
 let galleryRecipient;
 assert.equal((await publishWorldConfirmed({...input,previewVisitor:async s=>{preview=s;return true}},async m=>{galleryRecipient=m.recipient;return true},async()=>true)).ok,true);assert.equal(sends,1);
 assert.equal(galleryRecipient,'갤러리 · gallery.invalid');
 assert.equal(preview.audience,`${galleryRecipient} · 인터넷의 누구나`,'gallery preview audience = consent recipient + public');
 assert.deepEqual(preview.files.map(f=>[f.path,Buffer.from(f.data).toString()]),[['index.html',sentHtml]],'gallery preview bytes = sent html');
 // The version path must use buildPublishSet and must not write while preview is pending/cancelled.
 // M30: a multi-file version, so "every published file" is checked on this path too.
 writeFileSync(join(root,'index.html'),'<h1>version</h1><link rel="stylesheet" href="style.css">');
 let writes=0, versionPreview;
 const state={project:{id:'p',title:'t',members:['learner']},test_origin:null,versions:[],hypotheses:[],experiments:[],links:[]};
 const ports={switchOn:()=>true,token:async()=> 't',base:()=> 'https://service.invalid/v1/curriculum',root:()=>root,entry:()=>'/index.html',events:async()=>[],projectId:()=> 'p',setProjectId:async()=>{},week:()=>1,defaultTitle:()=> 't',qr:s=>s,confirmOutbound:async()=>true,fetchImpl:async(u,i)=>{if(i?.method&&i.method!=='GET'){writes++;return Response.json(new URL(u).pathname.endsWith('/experiments')?{experiment:{id:'e'}}:{share_url:'https://test.invalid/l/1'});}return Response.json(new URL(u).pathname.endsWith('/projects')?{projects:[state.project]}:state)}};
 for(const hook of [undefined,async s=>{versionPreview=s;return false}])assert.equal((await new PublishSession({...ports,previewVisitor:hook}).submit({expires_in_days:1})).ok,false);
 assert.equal(writes,0);assert.deepEqual(versionPreview.files.map(f=>f.path),['index.html','style.css']);assert.match(versionPreview.audience,/service.invalid.*링크를 받은 사람/);
 // Preview and send confirmation must name the same complete recipient, including team members.
 for(const members of [['learner-a','learner-b'], []]){
  state.project.members=members;let recipient;
  const result=await new PublishSession({...ports,previewVisitor:async s=>{versionPreview=s;return true},confirmOutbound:async m=>{recipient=m.recipient;return false}}).submit({expires_in_days:1});
  assert.equal(result.ok,false);assert.equal(writes,0);
  assert.equal(versionPreview.audience,recipient,'preview audience exactly matches outbound recipient');
  assert.equal(recipient,`사용자 테스트 · service.invalid · 프로젝트 구성원 ${members.join(', ') || '나'} · 링크를 받은 사람 (다시 공유 가능)`);
 }
 // M30: previewed paths and bytes = consented file items = uploaded version files.
 {
  state.project.members=['learner'];let uploaded,consented;
  await new PublishSession({...ports,previewVisitor:async s=>{versionPreview=s;return true},confirmOutbound:async m=>{consented=m.items;return true},fetchImpl:async(u,i)=>{if(i?.method==='PUT'&&new URL(u).pathname.includes('/versions/')){uploaded=JSON.parse(i.body).files;return Response.json({version:{id:'v'},created:true})}return ports.fetchImpl(u,i)}}).submit({expires_in_days:1});
  const previewed=versionPreview.files.map(f=>[f.path,Buffer.from(f.data).toString('base64')]);
  assert.deepEqual(previewed.map(([p])=>p),['index.html','style.css']);
  assert.ok(uploaded,'version upload reached');
  assert.deepEqual(previewed,uploaded.map(f=>[f.path,f.data]),'previewed files and bytes = uploaded files');
  assert.deepEqual(consented.filter(i=>!['프로젝트 제목','테스트 설명','링크 설정','검증 기록 참조'].includes(i.name)).map(i=>[i.name,i.bytes]),versionPreview.files.map(f=>[f.path,f.data.byteLength]),'consented files = previewed files');
 }
 console.log('PASS visitor-preview: MIME types, exact snapshot, excluded paths, immutable bytes, CSP, audience, gallery/version cancellation and scope change');
} finally {rmSync(root,{recursive:true,force:true})}
