#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {assertReceipt,isAppPackage,sha256} from '../e2e/unified-release/artifact.mjs';
import {releasePlatforms} from './release/platforms.mjs';
const [directory,sha,version]=process.argv.slice(2);
try{
 if(!directory||!/^[a-f0-9]{40}$/.test(sha??'')||!version)throw Error('Usage: check-unified-release.mjs ASSET_DIRECTORY SOURCE_SHA VERSION');
 const evidence=JSON.parse(fs.readFileSync(path.join(directory,'unified-acceptance.json'),'utf8'));
 const assets=Object.fromEntries(fs.readdirSync(directory).filter(isAppPackage).map(n=>[n,sha256(path.join(directory,n))]));
 // The release's own config/release-platforms.json decides which OS receipts are required;
 // a commit without it (every release before 2026-10-19) requires both.
 const platforms=releasePlatforms(sha);
 if(evidence.schema!=='hps-unified-release/1'||evidence.receipts?.length!==platforms.length)throw Error(`Exactly ${platforms.length} OS receipt(s) are required: ${platforms.join(', ')}`);
 for(const platform of platforms)assertReceipt(evidence.receipts.find(r=>r.platform===platform),{sha,version,platform,assets});
 if(new Set(evidence.receipts.map(r=>r.publicService.version)).size!==1)throw Error('Public Service changed between OS runs');
 console.log(`PASS ${platforms.join(' + ')} artifacts: trial + classroom, live model, file isolation, encrypted restart and unchanged bytes`);
}catch(error){console.error(error.code?'Missing or unreadable release acceptance evidence':error.message);process.exitCode=1;}
