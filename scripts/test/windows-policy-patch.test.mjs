import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

// Pinned VS Code 560a9dba's installer section. The portable ZIP contains
// policies/en-us/HypeProofStudio.adml but its installer rule omitted subdirs.
const source=String.raw`Source: "{#ProxyExeBasename}.exe"; DestDir: "{code:GetDestDir}"; DestName: "{code:GetProxyExeBasename}"; Flags: ignoreversion
#endif
Source: "tools\*"; DestDir: "{app}\{#VersionedResourcesFolder}\tools"; Flags: ignoreversion
Source: "policies\*"; DestDir: "{code:GetDestDir}\{#VersionedResourcesFolder}\policies"; Flags: ignoreversion skipifsourcedoesntexist
Source: "bin\{#TunnelApplicationName}.exe"; DestDir: "{code:GetDestDir}\bin"; DestName: "{code:GetBinDirTunnelApplicationFilename}"; Flags: ignoreversion skipifsourcedoesntexist
Source: "bin\{#ApplicationName}.cmd"; DestDir: "{code:GetDestDir}\bin"; DestName: "{code:GetBinDirApplicationCmdFilename}"; Flags: ignoreversion
Source: "bin\{#ApplicationName}"; DestDir: "{code:GetDestDir}\bin"; DestName: "{code:GetBinDirApplicationFilename}"; Flags: ignoreversion
`;
test('the build patch includes localized policy payloads and leaves unrelated installer rules intact',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'hps-policy-patch-'));
 try{
  const file=path.join(root,'build/win32/code.iss');fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,source);
  const patch=new URL('../patches/windows-policy-locales.patch',import.meta.url).pathname;
  const payload=['HypeProofStudio.admx','en-us/HypeProofStudio.adml','ko-kr/HypeProofStudio.adml'];
  const selected=text=>{
   const rules=text.split('\n').filter(line=>line.startsWith('Source: "policies\\*";'));
   assert.equal(rules.length,1);
   return payload.filter(name=>!name.includes('/')||/\brecursesubdirs\b/.test(rules[0]));
  };
  assert.deepEqual(selected(source),['HypeProofStudio.admx'],'negative control reproduces missing locale payloads');
  execFileSync('git',['apply','--check',patch],{cwd:root});execFileSync('git',['apply',patch],{cwd:root});
  const fixed=fs.readFileSync(file,'utf8');assert.deepEqual(selected(fixed),payload);
  const unrelated=text=>text.split('\n').filter(line=>!line.startsWith('Source: "policies\\*";'));
  assert.deepEqual(unrelated(fixed),unrelated(source));
  assert.match(fixed,/Flags: ignoreversion recursesubdirs createallsubdirs skipifsourcedoesntexist/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
