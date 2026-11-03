#!/usr/bin/env node
// Writes only an owned test configuration/work folders. It does not launch, stop or interact with an application.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {sha256} from './safety.mjs';
import {fileURLToPath} from 'node:url';
const args=process.argv.slice(2),attach=args.includes('--attach');
const storageFlags=args.filter(value=>value.startsWith('--secret-storage='));
if(storageFlags.length>1)throw Error('Declare one secret storage mode');
const secretStorage=storageFlags.length?storageFlags[0].slice('--secret-storage='.length):(process.env.HPS_FEEDBACK_SECRET_STORAGE||'inmemory');
const delayed=process.env.HPS_NATIVE_DELAYED_RESUME==='1';
if(process.env.HPS_NATIVE_DELAYED_RESUME!==undefined&&!delayed)throw Error('HPS_NATIVE_DELAYED_RESUME must be absent or 1');
if(delayed&&(process.env.GITHUB_ACTIONS!=='true'||!process.env.RUNNER_TEMP||attach||secretStorage!=='os-keychain'))throw Error('Delayed activation is explicit owned hosted OS-credential mode only');
if(!['os-keychain','inmemory'].includes(secretStorage))throw Error('Secret storage must be os-keychain or inmemory');
const values=args.filter(value=>!value.startsWith('--'));
if(values.length<3){console.log('Usage: prepare-config.mjs RECEIPT SERVICE_MANIFEST EVIDENCE_DIR [--attach] [--secret-storage=os-keychain|inmemory]\nFor attach, HPS_FEEDBACK_CDP names the existing debugging endpoint. It never owns/kills the app.');process.exit(2);}
const [receiptFile,serviceFile,evidenceDirectory]=values.map(p=>path.resolve(p));
const receipt=JSON.parse(fs.readFileSync(receiptFile,'utf8')),service=JSON.parse(fs.readFileSync(serviceFile,'utf8')),state=path.dirname(receiptFile);
const id=Date.now().toString(36),data=attach?path.join(state,'user-data'):path.join(state,'feedback-data-'+id),a=attach?path.join(state,'workspace'):path.join(state,'feedback-A-'+id),b=path.join(state,'feedback-B-'+id),c=path.join(state,'feedback-C-'+id),d=path.join(state,'feedback-D-'+id);
const extra=delayed?Object.fromEntries(['e','f','g'].map(key=>[key,path.join(state,'feedback-'+key.toUpperCase()+'-'+id)])):{};
fs.mkdirSync(evidenceDirectory,{recursive:true});for(const directory of[data,a,b,c,d,...Object.values(extra)])fs.mkdirSync(directory,{recursive:true});
if(!attach){fs.writeFileSync(path.join(data,'feedback-owner.json'),JSON.stringify({schema:'hps-feedback-owned-profile/1',receipt:receiptFile,workspaces:{a,b,c,d,...extra}}));fs.mkdirSync(path.join(data,'User'),{recursive:true});fs.writeFileSync(path.join(data,'User/settings.json'),JSON.stringify({'hypeproofChat.proxyUrl':service.origin+'/v1','window.dialogStyle':'custom','files.simpleDialog.enable':true,'workbench.startupEditor':'none','update.mode':'none','telemetry.telemetryLevel':'off'},null,2));}
const git=(...v)=>execFileSync('git',v,{cwd:receipt.source,encoding:'utf8'}).trim();
const config={schema:'hps-feedback-native/1',candidate:{app:receipt.app,receipt:receiptFile,sourceSha:git('rev-parse','HEAD')},service:{origin:service.origin,manifest:serviceFile,tokenAFile:service.token_a_file,...(service.token_b_file?{tokenBFile:service.token_b_file}:{})},userDataDir:data,workspace:{a,b,c,d,...extra},...(delayed?{delayedActivation:{enabled:true,inspectorPort:9788}}:{}),evidence:evidenceDirectory,secretStorage,...(service.scripted?{sdkProtocolProof:{file:path.join(evidenceDirectory,'scripted-sdk-protocol/probe.json'),sha256:fs.existsSync(path.join(evidenceDirectory,'scripted-sdk-protocol/probe.json'))?sha256(path.join(evidenceDirectory,'scripted-sdk-protocol/probe.json')):null}}:{}),...(attach?{cdp:process.env.HPS_FEEDBACK_CDP||'http://127.0.0.1:9777',attach:true}:{cdp:'http://127.0.0.1:9778',attach:false}),scenarios:['files','folders','restart','activity-isolation','skills','image-denied',...(service.scripted&&!attach?['history-streaming']:[]),...(service.session_control&&!attach?['session-ended']:[])],skill:{url:'https://github.com/anthropics/skills/tree/dbd4588f9e1033efb41dad4bef2f7947c8993d44/skills/internal-comms',name:'internal-comms',revision:'dbd4588f9e1033efb41dad4bef2f7947c8993d44'}};
const file=path.join(evidenceDirectory,'config.json');fs.writeFileSync(file,JSON.stringify(config,null,2),{mode:0o600});console.log(JSON.stringify({config:file,mode:attach?'attach; no application ownership':'launch owned isolated profile',prerequisites:attach?['Current user-data settings: window.dialogStyle=custom, files.simpleDialog.enable=true','Root owns process; script will not kill/restart it']:['Prepared studio-dev.py copy','No full shell build needed'],model_provider_called:false},null,2));
