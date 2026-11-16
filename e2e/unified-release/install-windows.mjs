// CI-only: install BOTH shipped installers in isolated directories and compare
// every portable payload file. Extra uninstaller/installation bookkeeping is OK.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {sha256,treeHash,INSTALLER_PRODUCT_JSON,installerTarget,installerProductMatches} from './artifact.mjs';
if(process.platform!=='win32'||process.env.GITHUB_ACTIONS!=='true')throw Error('Windows disposable CI runner required');
const [assets,portable]=process.argv.slice(2);
const names=fs.readdirSync(assets).filter(n=>/Setup.*\.exe$/.test(n));
if(names.length!==2||!names.some(n=>/UserSetup/.test(n)))throw Error('Both installers required');
const files=[];function visit(rel=''){for(const entry of fs.readdirSync(path.join(portable,rel),{withFileTypes:true})){const next=path.join(rel,entry.name);if(entry.isDirectory())visit(next);else if(entry.isFile())files.push(next);else throw Error('Unexpected payload type');}}visit();
// Inno Setup records the /DIR it used under the AppId's uninstall key, and a later install without /DIR
// reuses it (UsePreviousAppDir). Left in place, the acceptance "fresh install" that follows lands in this
// temp folder instead of %LOCALAPPDATA%\Programs\HypeProof Studio. Drop only that registration (files stay;
// the runner is disposable) so the next install picks the default folder, as on a new customer machine.
function forgetInstall(destination){
 const ps=`$d=@($env:HPS_FORGET_DIR,$env:HPS_FORGET_DIR_LONG)|ForEach-Object{$_.TrimEnd('\\')};$n=0;foreach($r in 'HKCU:','HKLM:'){Get-ChildItem "$r\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall" -ErrorAction SilentlyContinue|ForEach-Object{$v=(Get-ItemProperty -LiteralPath $_.PSPath -ErrorAction SilentlyContinue).'Inno Setup: App Path';if($v -and $d -icontains $v.TrimEnd('\\')){Remove-Item -LiteralPath $_.PSPath -Recurse -Force;$n++}}};if($n -lt 1){throw "no uninstall registration for $($d -join ' or ')"}`;
 execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',ps],{stdio:'pipe',env:{...process.env,HPS_FORGET_DIR:destination,HPS_FORGET_DIR_LONG:fs.realpathSync.native(destination)}});
}
const installers=[];
for(const name of names){
 const destination=fs.mkdtempSync(path.join(os.tmpdir(),'hps-installer-'));
 execFileSync(path.resolve(assets,name),['/VERYSILENT','/SUPPRESSMSGBOXES','/NORESTART','/MERGETASKS=!runcode,!desktopicon,!quicklaunchicon',`/DIR=${destination}`],{stdio:'pipe',timeout:180000});
 for(const file of files){
  if(INSTALLER_PRODUCT_JSON.test(file)){
   const why=installerProductMatches(fs.readFileSync(path.join(portable,file),'utf8'),fs.readFileSync(path.join(destination,file),'utf8'),installerTarget(name));
   if(why)throw Error('Installer payload differs: '+name+' / '+file+': '+why);
  }else if(sha256(path.join(portable,file))!==sha256(path.join(destination,file)))throw Error('Installer payload differs: '+name+' / '+file);
 }
 installers.push({name,sha256:sha256(path.join(assets,name)),payloadMatches:true});
 forgetInstall(destination);
}
fs.writeFileSync(path.join(assets,'installer-verification.json'),JSON.stringify({portableTree:treeHash(portable),installers},null,2));
