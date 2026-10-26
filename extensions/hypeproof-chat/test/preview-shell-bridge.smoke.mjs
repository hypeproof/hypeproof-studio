import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {execFileSync} from 'node:child_process';
import ts from 'typescript';
const root=new URL('../../../',import.meta.url).pathname;
const rel='src/vs/workbench/contrib/browserView/electron-browser/browserEditor.ts';
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'hps-shell-bridge-'));
try {
 const file=path.join(dir,rel);fs.mkdirSync(path.dirname(file),{recursive:true});fs.copyFileSync(path.join(root,'scripts/patches/core/upstream',rel),file);
 execFileSync('git',['init','-q'],{cwd:dir});execFileSync('git',['apply',path.join(root,'scripts/patches/core/hps-preview-recovery.patch')],{cwd:dir});
 const source=fs.readFileSync(file,'utf8'),tree=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true);
 const cls=tree.statements.find(s=>ts.isClassDeclaration(s)&&s.name?.text==='BrowserEditor');
 const methods=['clearHpsRecovery','refreshHpsRecovery','shouldShowView','updateVisibility','dispose'].map(n=>{const m=cls.members.find(m=>m.name?.getText(tree)===n);assert.ok(m,n);return m.getText(tree)}).join('\n');
 const code=ts.transpileModule(`class Base {dispose(){}};globalThis.Editor=class extends Base {
 _hpsRecoveryEpoch=0;_hpsRecoveryShown=false;_editorVisible=true;_overlayVisible=false;
 _errorContainer={style:{}};_welcomeContainer={style:{}};_placeholderScreenshot={style:{}};_overlayPauseContainer={classList:{toggle(){}}};
 _browserContainer={ownerDocument:{hasFocus:()=>false}};window={requestAnimationFrame:f=>f()};
 _certActionButton={clear(){}};doScreenshot(){};updateErrorDisplay(){this.refreshed=(this.refreshed||0)+1;this.clearHpsRecovery()}
 ${methods}
 };`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText;
 let resolve,rendered=0,disposed=0,click,focus,commands=[],actionResult=true;
 const context={ICommandService:{},parseHpsPreviewRecovery:(v,url)=>v?.url===url?v:undefined,renderHpsPreviewRecovery:(c,v,fn,f)=>{rendered++;click=fn;focus=f;return()=>disposed++}};
 vm.runInNewContext(code,context);
 function editor(){const e=new context.Editor();e._model={url:'http://localhost:8000/',loading:false,visible:true,setVisible(v){this.visible=v}};e.instantiationService={invokeFunction:f=>f({get:()=>({executeCommand:(name,...args)=>{commands.push([name,...args]);return name.endsWith('.resolve')?new Promise(r=>resolve=r):Promise.resolve(actionResult)}})})};return e}
 const view={url:'http://localhost:8000/',requestId:'request-0123456789',text:'파일이 없어요',action:'show_files',actionLabel:'파일 목록 보기',detail:'HTTP 404'};
 let e=editor(),pending=e.refreshHpsRecovery();resolve(view);await pending;
 assert.equal(e._hpsRecoveryShown,true);assert.equal(e._model.error,undefined);assert.equal(e.shouldShowView,false);assert.equal(e._model.visible,false);assert.equal(e._errorContainer.style.display,'');assert.equal(focus,true);
 assert.equal(await click(view.requestId,view.url,view.action),true);assert.equal(e.refreshed,1);assert.deepEqual(commands.at(-1),['_hps.previewRecovery.act',view.requestId,view.url,view.action]);
 e=editor();pending=e.refreshHpsRecovery();e._model.url+='other';resolve(view);await pending;assert.equal(e._hpsRecoveryShown,false);
 e=editor();pending=e.refreshHpsRecovery();e.clearHpsRecovery();resolve(view);await pending;assert.equal(e._hpsRecoveryShown,false);
 e=editor();pending=e.refreshHpsRecovery();e.dispose();resolve(view);await pending;assert.equal(e._hpsRecoveryShown,false);
 e=editor();e._editorVisible=false;pending=e.refreshHpsRecovery();resolve(view);await pending;assert.equal(focus,false);
 const staleClick=click;e.clearHpsRecovery();const before=commands.length;assert.equal(await staleClick(view.requestId,view.url,view.action),false);assert.equal(commands.length,before);
 e=editor();pending=e.refreshHpsRecovery();resolve(null);await pending;assert.equal(e.shouldShowView,true);
 e=editor();pending=e.refreshHpsRecovery();resolve(view);await pending;actionResult=false;
 assert.equal(await click(view.requestId,view.url,view.action),false);assert.equal(e.refreshed,1,'refused one-use request is replaced');
 assert.equal(rendered,3);assert.equal(disposed,3);
 console.log('PASS applied shell methods: 404 hides native page, command binding, navigation/disposal races, hidden focus');
}finally{fs.rmSync(dir,{recursive:true,force:true})}
