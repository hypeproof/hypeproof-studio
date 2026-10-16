#!/usr/bin/env node
// Dedicated hosted runner only. Downloads an official shell, injects the current extension and drives an isolated profile.
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {sha256} from './safety.mjs';
import {hostedCommands,OFFICIAL_SHELL_REPOSITORY} from './hosted-shell.mjs';
const args=process.argv.slice(2);
if(args.includes('--help')){console.log('GITHUB_ACTIONS=true HPS_SERVICE_SOURCE=PINNED_CHECKOUT node e2e/feedback-native/hosted.mjs [PUBLIC_APP_TAG]\nNo provider requests. Foreground native input is confined to the hosted desktop.');process.exit(0);}
if(process.env.GITHUB_ACTIONS!=='true'||!process.env.RUNNER_TEMP)throw Error('Hosted native foreground suite requires a GitHub Actions dedicated desktop');
if(!['darwin','win32'].includes(process.platform))throw Error('Only Mac/Windows prepared shells are supported');
if(args[0]&&!/^v[0-9]+\.[0-9]+\.[0-9]+(?:-[A-Za-z0-9.-]+)?$/.test(args[0]))throw Error('Invalid official app tag');
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'),base=path.join(process.env.RUNNER_TEMP,'feedback-native'),assets=path.join(base,'assets'),extracted=path.join(base,'released'),state=path.join(base,'candidate'),privateService=path.join(base,'private-service'),evidence=path.join(base,'evidence');
for(const d of[assets,extracted,evidence])fs.mkdirSync(d,{recursive:true});
const commands=hostedCommands(repo),run=commands.run;
const officialRepo=OFFICIAL_SHELL_REPOSITORY;
const release=commands.release(args[0]??'');
const platform=process.platform==='darwin'?'darwin-arm64':'win32-x64',selected=release.assets.filter(a=>a.name.endsWith('.zip')&&a.name.includes(platform));
if(selected.length!==1)throw Error('Expected exactly one official portable shell for '+platform);
const asset=selected[0];commands.download(release.tag_name,asset.name,assets);
let expected=typeof asset.digest==='string'&&asset.digest.startsWith('sha256:')?asset.digest.slice(7):null;
if(!expected){const acceptance=release.assets.find(a=>a.name==='unified-acceptance.json');if(!acceptance)throw Error('BLOCKED official release has neither asset digest nor published acceptance hashes');commands.download(release.tag_name,acceptance.name,assets);const proof=JSON.parse(fs.readFileSync(path.join(assets,acceptance.name),'utf8'));if(proof.schema!=='hps-unified-release/1')throw Error('Unrecognized official acceptance manifest');expected=proof.receipts?.find(r=>r.platform===platform)?.assets?.[asset.name];}
if(!/^[a-f0-9]{64}$/.test(expected??'')||sha256(path.join(assets,asset.name))!==expected)throw Error('Official shell download checksum mismatch or missing hash');
fs.writeFileSync(path.join(evidence,'shell-download.json'),JSON.stringify({repository:officialRepo,tag:release.tag_name,asset:asset.name,sha256:expected,url:asset.browser_download_url,scope:'official shell only; candidate extension will be injected'},null,2));
if(process.platform==='darwin')run('ditto',['-xk',path.join(assets,asset.name),extracted]);else run('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from("Expand-Archive -LiteralPath '"+path.join(assets,asset.name).replaceAll("'","''")+"' -DestinationPath '"+extracted.replaceAll("'","''")+"'",'utf16le').toString('base64')]);
function findApp(dir,depth=0){if(depth>3)return[];const found=[];for(const entry of fs.readdirSync(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory()&&process.platform==='darwin'&&entry.name==='HypeProof Studio.app')found.push(file);else if(entry.isFile()&&process.platform==='win32'&&entry.name==='HypeProof Studio.exe')found.push(dir);else if(entry.isDirectory())found.push(...findApp(file,depth+1));}return found;}
const apps=findApp(extracted);if(apps.length!==1)throw Error('Expected one extracted official app');
const servicePin=JSON.parse(fs.readFileSync(path.join(repo,'config/service-deployment.json'),'utf8'));
if(servicePin.repository!=='hypeproof/hypeproof-service'||process.env.HPS_SERVICE_SHA!==servicePin.sha)throw Error('Hosted Service SHA must match config/service-deployment.json; no arbitrary sibling checkout');
let service;try{
 service=spawn(process.execPath,['--experimental-strip-types','--experimental-sqlite',path.join(repo,'e2e/feedback-native/service.mjs'),privateService],{cwd:repo,stdio:'inherit',env:commands.runtimeEnv});
 const manifest=path.join(privateService,'service.json');const end=Date.now()+60000;while(!fs.existsSync(manifest)){if(service.exitCode!==null)throw Error('Actual-source synthetic Service failed to start');if(Date.now()>end)throw Error('Timed out starting actual-source Service');await new Promise(r=>setTimeout(r,150));}
 run(process.platform==='win32'?'python':'python3',['scripts/studio-dev.py','prepare','--base-app',apps[0],'--state-dir',state,'--provider','service','--service','local']);
 // The disposable hosted desktop must exercise normal persisted credentials across reload.
 // In-memory SecretStorage cannot establish that acceptance boundary.
 run(process.execPath,['e2e/feedback-native/prepare-config.mjs',path.join(state,'receipt.json'),manifest,evidence,'--secret-storage=os-keychain']);
 run(process.execPath,['e2e/feedback-native/run.mjs',path.join(evidence,'config.json'),'--allow-foreground']);
}finally{service?.kill();}
