#!/usr/bin/env node
// Writes only an owned test configuration/work folders. It does not launch, stop or interact with an application.
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const args=process.argv.slice(2),attach=args.includes('--attach');
const values=args.filter(value=>!value.startsWith('--'));
if(values.length<3){console.log('Usage: prepare-config.mjs RECEIPT SERVICE_MANIFEST EVIDENCE_DIR [--attach]\nFor attach, HPS_FEEDBACK_CDP names the existing debugging endpoint. It never owns/kills the app.');process.exit(2);}
const [receiptFile,serviceFile,evidenceDirectory]=values.map(p=>path.resolve(p));
const receipt=JSON.parse(fs.readFileSync(receiptFile,'utf8')),service=JSON.parse(fs.readFileSync(serviceFile,'utf8')),state=path.dirname(receiptFile);
const id=Date.now().toString(36),data=attach?path.join(state,'user-data'):path.join(state,'feedback-data-'+id),a=attach?path.join(state,'workspace'):path.join(state,'feedback-A-'+id),b=path.join(state,'feedback-B-'+id);
fs.mkdirSync(evidenceDirectory,{recursive:true});for(const directory of[data,a,b])fs.mkdirSync(directory,{recursive:true});
if(!attach){fs.writeFileSync(path.join(data,'feedback-owner.json'),JSON.stringify({schema:'hps-feedback-owned-profile/1',receipt:receiptFile}));fs.mkdirSync(path.join(data,'User'),{recursive:true});fs.writeFileSync(path.join(data,'User/settings.json'),JSON.stringify({'hypeproofChat.proxyUrl':service.origin+'/v1','window.dialogStyle':'custom','files.simpleDialog.enable':true,'workbench.startupEditor':'none','update.mode':'none','telemetry.telemetryLevel':'off'},null,2));}
const git=(...v)=>execFileSync('git',v,{cwd:receipt.source,encoding:'utf8'}).trim();
const config={schema:'hps-feedback-native/1',candidate:{app:receipt.app,receipt:receiptFile,sourceSha:git('rev-parse','HEAD')},service:{origin:service.origin,manifest:serviceFile,tokenAFile:service.token_a_file,...(service.token_b_file?{tokenBFile:service.token_b_file}:{})},userDataDir:data,workspace:{a,b},evidence:evidenceDirectory,secretStorage:process.env.HPS_FEEDBACK_SECRET_STORAGE||'inmemory',...(attach?{cdp:process.env.HPS_FEEDBACK_CDP||'http://127.0.0.1:9777',attach:true}:{cdp:'http://127.0.0.1:9778',attach:false}),scenarios:['files','folders','skills','image-denied'],skill:{url:'https://github.com/anthropics/skills/tree/dbd4588f9e1033efb41dad4bef2f7947c8993d44/skills/internal-comms',name:'internal-comms',revision:'dbd4588f9e1033efb41dad4bef2f7947c8993d44'}};
const file=path.join(evidenceDirectory,'config.json');fs.writeFileSync(file,JSON.stringify(config,null,2),{mode:0o600});console.log(JSON.stringify({config:file,mode:attach?'attach; no application ownership':'launch owned isolated profile',prerequisites:attach?['Current user-data settings: window.dialogStyle=custom, files.simpleDialog.enable=true','Root owns process; script will not kill/restart it']:['Prepared studio-dev.py copy','No full shell build needed'],model_provider_called:false},null,2));
