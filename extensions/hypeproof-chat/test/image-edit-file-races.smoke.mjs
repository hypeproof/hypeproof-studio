import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {syncBuiltinESMExports} from 'node:module';
import {png} from './fixtures/image-edit/png.mjs';
import {prepareImageEditAsset} from '../src/imageEditAssets.ts';
const tmp=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'hps-image-read-race-')));
const realOpen=fs.openSync,realRead=fs.readFileSync,realClose=fs.closeSync;
try{
 for(const mode of ['before-open-parent','before-open-file','during-read-parent','during-read-file','after-read-growth']){
  const root=path.join(tmp,mode),assets=path.join(root,'assets'),outside=path.join(tmp,'outside-'+mode),file=path.join(assets,'keyboard.png');
  fs.mkdirSync(assets,{recursive:true});fs.mkdirSync(outside);fs.writeFileSync(file,png());fs.writeFileSync(path.join(outside,'keyboard.png'),png(11,11));
  let opened,closed=false,swapped=false;
  const swap=()=>{if(swapped)return;swapped=true;if(mode.endsWith('parent')){fs.renameSync(assets,assets+'-old');fs.symlinkSync(outside,assets);}else if(mode==='after-read-growth'){fs.appendFileSync(file,Buffer.alloc(4*1024*1024));}else{fs.renameSync(file,file+'.old');fs.copyFileSync(path.join(outside,'keyboard.png'),file);}};
  fs.openSync=function(target,...args){if(target===file&&mode.startsWith('before-open'))swap();const fd=realOpen.call(this,target,...args);if(target===file)opened=fd;return fd;};
  fs.readFileSync=function(target,...args){const bytes=realRead.call(this,target,...args);if(target===opened&&!mode.startsWith('before-open'))swap();return bytes;};
  fs.closeSync=function(fd){if(fd===opened)closed=true;return realClose.call(this,fd);};syncBuiltinESMExports();
  await assert.rejects(prepareImageEditAsset(root,'assets/keyboard.png'),undefined,mode+' must not return image bytes/dataURL');assert.ok(swapped,mode+' exercised actual FS mutation');assert.ok(closed,mode+' closes its opened descriptor');
  fs.openSync=realOpen;fs.readFileSync=realRead;fs.closeSync=realClose;syncBuiltinESMExports();
 }
 const root=path.join(tmp,'normal');fs.mkdirSync(root);fs.writeFileSync(path.join(root,'keyboard.png'),png());assert.ok((await prepareImageEditAsset(root,'keyboard.png')).dataUrl.startsWith('data:image/png;base64,'));
 console.log('PASS actual filesystem original reads: parent symlink/file replacement before open and during read, changed size, descriptor cleanup, normal PNG control');
}finally{fs.openSync=realOpen;fs.readFileSync=realRead;fs.closeSync=realClose;syncBuiltinESMExports();fs.rmSync(tmp,{recursive:true,force:true});}
