#!/usr/bin/env node
// The packaged App vendors the Agent SDK JS but never the native `claude` binary:
// every machine seeds it per user (scripts/seed-sdk-binary.{sh,ps1}, as the
// installers do). On a fresh runner nothing is seeded, so a native trial turn
// falls back to the proxy runtime and the Service answers 409 trial_requires_sdk
// before any model call. The check then timed out on a Stop button that existed
// for milliseconds (jayleekr/hypeprooflab#997). This module names the version the
// App expects and refuses to start acceptance until that binary is seeded.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
// Mirrors SDK_BINARY_MIN_BYTES in extensions/hypeproof-chat/src/sdkBinaryManifest.ts.
const MIN_BYTES=150*1024*1024;
/** The SDK version the App's vendored JS was installed at; the binary must match it. */
export function appSdkVersion(app,platform=process.platform) {
 const resources=path.join(app,platform==='darwin'?'Contents/Resources/app':'resources/app');
 const manifest=path.join(resources,'extensions/hypeproof-chat/dist/vendor/node_modules/@anthropic-ai/claude-agent-sdk/package.json');
 const version=JSON.parse(fs.readFileSync(manifest,'utf8')).version;
 if(typeof version!=='string'||!/^\d+\.\d+\.\d+$/.test(version))throw Error('App vendors no readable Agent SDK version');
 return version;
}
/** Where the App looks for the seeded binary (sdkCoachHelpers.seededSdkBinaryPath), Mac and Windows only. */
export function seededSdkBinary(version,{platform=process.platform,home=os.homedir(),env=process.env}={}) {
 if(platform==='win32')return path.win32.join(env.APPDATA||path.win32.join(home,'AppData','Roaming'),'HypeProof-Studio','sdk',version,'claude.exe');
 if(platform==='darwin')return path.posix.join(home,'Library','Application Support','HypeProof-Studio','sdk',version,'claude');
 throw Error('Acceptance runs on Mac or Windows only');
}
/** Same verdict as the App's isSeededBinaryTrusted, for the version this App expects. */
export function checkSeededSdk(app,options={}) {
 const platform=options.platform??process.platform;
 const version=appSdkVersion(app,platform),binary=seededSdkBinary(version,{...options,platform});
 const fail=reason=>({ok:false,version,binary,reason});
 const stat=fs.statSync(binary,{throwIfNoEntry:false});
 if(!stat?.isFile())return fail('seeded binary not found');
 if(platform!=='win32'){try{fs.accessSync(binary,fs.constants.X_OK);}catch{return fail('seeded binary is not executable');}}
 let marker;try{marker=JSON.parse(fs.readFileSync(binary+'.verified.json','utf8').replace(/^﻿/,''));}catch{return fail('missing or malformed .verified.json marker');}
 if(typeof marker?.tarballSha512!=='string'||!marker.tarballSha512.startsWith('sha512-'))return fail('missing or malformed .verified.json marker');
 if(marker.sdkVersion!==version)return fail(`marker is for ${marker.sdkVersion}, App expects ${version}`);
 if(marker.size!==stat.size)return fail(`binary size ${stat.size} differs from seed-time size ${marker.size}`);
 if(stat.size<MIN_BYTES)return fail(`binary size ${stat.size} below sanity floor`);
 return {ok:true,version,binary};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 const [command,app]=process.argv.slice(2);
 if(command!=='version'||!app){console.error('Usage: sdk-seed.mjs version APP');process.exit(2);}
 process.stdout.write(appSdkVersion(app));
}
