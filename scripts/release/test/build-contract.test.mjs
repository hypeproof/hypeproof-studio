// Offline controls. Fixture bytes are not installed-App or release acceptance.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync, spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {buildDispatches, buildTagMessage, contractSources, assertManagedCandidateSupport, resolveBuildContract, draftIdentity, assertRemoteCandidate} from '../build-contract.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const cli = path.join(root, 'scripts/release/build-contract.mjs');
const sha = 'a'.repeat(40), other = 'b'.repeat(40);
const plan = {candidate: sha, version: 'v2026.1018.0', rcTag: 'v2026.1018.0-rc.1'};
const request = () => ({eventName: 'workflow_dispatch', githubRef: `refs/tags/${plan.rcTag}`, githubSha: sha,
  head: sha, tagCommit: sha, tagObject: other, tagMessage: buildTagMessage(plan, {managedDraft: true}),
  inputs: buildDispatches(plan, {managedDraft: true})[0].inputs});
const tmp = t => { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hps-draft-')); t.after(() => fs.rmSync(dir, {recursive: true, force: true})); return dir; };
const git = (cwd, ...args) => execFileSync('git', args, {cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']}).trim();
const run = (cwd, env, ...args) => spawnSync(process.execPath, [cli, ...args], {cwd, env: {...process.env, ...env}, encoding: 'utf8'});

test('release-cut dispatches pin both builders; managed draft separates final version from RC identity', () => {
  for (const managedDraft of [false, true]) {
    // This checkout's config/release-platforms.json ships both; Mac only when configured so.
    assert.deepEqual(buildDispatches(plan, {managedDraft}).map(d => d.workflow), ['build-mac.yml', 'build-windows.yml']);
    assert.deepEqual(buildDispatches(plan, {managedDraft, platforms: ['darwin-arm64']}).map(d => d.workflow), ['build-mac.yml']);
    const dispatches = buildDispatches(plan, {managedDraft, platforms: ['darwin-arm64', 'win32-x64']});
    assert.deepEqual(dispatches.map(d => d.workflow), ['build-mac.yml', 'build-windows.yml']);
    for (const dispatch of dispatches) {
      assert.equal(dispatch.ref, plan.rcTag);
      assert.equal(dispatch.inputs.ref, sha);
      assert.equal(dispatch.inputs.candidate_sha, managedDraft ? sha : undefined);
      assert.equal(dispatch.inputs.release_version, managedDraft ? plan.version : undefined);
      assert.equal(dispatch.inputs.managed_draft, managedDraft ? 'true' : undefined);
    }
  }
  for (const change of [{candidate: 'main'}, {candidate: '--help'}, {candidate: sha + '\nX=1'}, {candidate: sha + '\n'},
    {version: 'v2026.01018.0'}, {version: 'v2026.1018.0-rc.1'}, {rcTag: 'v2026.1019.0-rc.1'},
    {version: plan.version + '\n'}, {rcTag: plan.rcTag + '\n'},
    {rcTag: 'v2026.1018.0-rc.0'}, {rcTag: plan.rcTag + '$(touch injected)'}]) {
    assert.throws(() => buildDispatches({...plan, ...change}, {managedDraft: true}), /Build contract:/);
  }
});

test('candidate mismatch and malformed mode cannot fall back to main or the legacy auto-publish path', () => {
  const good = request();
  assert.deepEqual(resolveBuildContract(good), {schema: 'hps-build-contract/1', sourceSha: sha,
    publicationTag: plan.rcTag, publicationTagObject: other, releaseVersion: '2026.1018.0', managedDraft: true, autoAcceptance: false});
  const bad = [
    {head: other}, {githubSha: other}, {tagCommit: other}, {eventName: 'pull_request'}, {tagObject: ''},
    {githubRef: 'refs/heads/main'}, {githubRef: 'refs/tags/v2026.1018.0'},
    {tagMessage: ''}, {tagMessage: 'hps-managed-draft/2\n{}'}, {tagMessage: 'hps-managed-draft/1'},
    {tagMessage: 'hps-managed-draft/1\n{"sourceSha":"' + sha + '"}'},
    ...[{ref: 'main'}, {candidate_sha: 'main'}, {release_version: 'v2026.1018.1'},
      {release_version: 'v2026.1018.0\nAUTO_ACCEPTANCE=true'}, {managed_draft: 'TRUE'},
      {managed_draft: 1}].map(change => ({inputs: {...good.inputs, ...change}})),
  ];
  for (const change of bad) assert.throws(() => resolveBuildContract({...good, ...change}), /Build contract:/);
  for (const tagMessage of ['hps-managed-dra', 'HPS-MANAGED-DRAFT/1', 'hps-managed-draft/1',
    'hps-managed-draft/1\n{}', 'hps-managed-draft/2\n{}']) {
    assert.throws(() => resolveBuildContract({...good, tagMessage, inputs: {}}), /Build contract:/,
      'a malformed marker must fail even when every managed input is absent');
  }
  // The persistent tag contract cannot be switched off by push, retry or false input.
  for (const inputs of [{}, {...good.inputs, managed_draft: 'false'}, {ref: sha}]) {
    for (const eventName of ['push', 'workflow_dispatch']) {
      const pinned = resolveBuildContract({...good, inputs, eventName});
      assert.equal(pinned.autoAcceptance, false); assert.equal(pinned.releaseVersion, '2026.1018.0');
    }
  }
  const legacy = resolveBuildContract({...good, tagMessage: '', inputs: buildDispatches(plan)[0].inputs});
  assert.equal(legacy.releaseVersion, '2026.1018.0-rc.1');
  assert.equal(legacy.autoAcceptance, true);
  const stable = resolveBuildContract({...good, tagMessage: '', eventName: 'push', githubRef: 'refs/tags/v2026.1018.0', inputs: {}});
  assert.equal(stable.releaseVersion, '2026.1018.0');
  assert.equal(stable.autoAcceptance, true);
  const dev = resolveBuildContract({...good, tagMessage: '', githubRef: 'refs/heads/main', tagCommit: '', inputs: {}});
  assert.equal(dev.releaseVersion, ''); // existing extension-version fallback
  assert.equal(dev.autoAcceptance, false);
});

function repoFixture(t) {
  const dir = tmp(t), repo = path.join(dir, 'repo'), remote = path.join(dir, 'remote.git');
  fs.mkdirSync(repo);
  git(repo, 'init', '-q', '--initial-branch=main');
  git(repo, 'config', 'user.name', 'Offline fixture');
  git(repo, 'config', 'user.email', 'fixture@example.invalid');
  fs.writeFileSync(path.join(repo, 'source'), 'candidate');
  git(repo, 'add', 'source'); git(repo, 'commit', '-qm', 'candidate');
  const candidate = git(repo, 'rev-parse', 'HEAD');
  git(repo, 'tag', '-a', plan.rcTag, '-m', buildTagMessage({...plan, candidate}, {managedDraft: true}));
  git(dir, 'init', '--bare', '-q', remote);
  git(repo, 'remote', 'add', 'origin', remote);
  git(repo, 'push', '-q', 'origin', `refs/tags/${plan.rcTag}`); // filesystem only
  fs.writeFileSync(path.join(repo, 'source'), 'new main');
  git(repo, 'commit', '-qam', 'main advances');
  const advanced = git(repo, 'rev-parse', 'HEAD');
  git(repo, 'checkout', '-q', '--detach', candidate);
  const env = {GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: `refs/tags/${plan.rcTag}`, GITHUB_SHA: candidate,
    HPS_BUILD_REF: candidate, HPS_CANDIDATE_SHA: candidate, HPS_RELEASE_VERSION: plan.version, HPS_MANAGED_DRAFT: 'true',
    GITHUB_ENV: path.join(dir, 'env'), GITHUB_OUTPUT: path.join(dir, 'output'), RUNNER_TEMP: dir};
  return {dir, repo, candidate, advanced, env, contractPath: path.join(dir, 'hps-build-contract.json')};
}

test('real git preflight stays on the fixed candidate after main advances and writes no environment on rejection', t => {
  const f = repoFixture(t);
  const result = run(f.repo, f.env, 'preflight', f.contractPath);
  assert.equal(result.status, 0, result.stderr);
  assert.match(fs.readFileSync(f.env.GITHUB_ENV, 'utf8'), new RegExp(`BUILD_SOURCEVERSION=${f.candidate}\nHPS_VERSION=2026.1018.0\n`));
  assert.match(fs.readFileSync(f.env.GITHUB_OUTPUT, 'utf8'), /auto_acceptance=false/);
  for (const env of [{HPS_RELEASE_VERSION: 'v1.2.3\nFORGED=true'}, {HPS_MANAGED_DRAFT: 'typo'}, {GITHUB_SHA: f.advanced}]) {
    fs.writeFileSync(f.env.GITHUB_ENV, ''); fs.writeFileSync(f.env.GITHUB_OUTPUT, '');
    const rejected = run(f.repo, {...f.env, ...env}, 'preflight', f.contractPath);
    assert.notEqual(rejected.status, 0);
    assert.equal(fs.readFileSync(f.env.GITHUB_ENV, 'utf8'), '');
    assert.equal(fs.readFileSync(f.env.GITHUB_OUTPUT, 'utf8'), '');
  }
  git(f.repo, 'checkout', '-q', 'main');
  assert.notEqual(run(f.repo, f.env, 'preflight', f.contractPath).status, 0);
  const dev = run(f.repo, {...f.env, GITHUB_REF: 'refs/heads/main', GITHUB_SHA: f.advanced,
    HPS_BUILD_REF: '', HPS_CANDIDATE_SHA: '', HPS_MANAGED_DRAFT: '', HPS_RELEASE_VERSION: ''}, 'preflight', f.contractPath);
  assert.equal(dev.status, 0, dev.stderr);
  assert.equal(JSON.parse(fs.readFileSync(f.contractPath)).releaseVersion, '');
});

test('managed creation rejects pre-contract candidates before a remote mutation', t => {
  const f = repoFixture(t);
  const read = candidate => file => execFileSync('git', ['show', `${candidate}:${file}`], {cwd: f.repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});
  assert.throws(() => assertManagedCandidateSupport(f.candidate, read(f.candidate)), /lacks managed draft support/);
  const planPath = path.join(f.dir, 'plan.json');
  fs.writeFileSync(planPath, JSON.stringify({...plan, candidate: f.candidate, schema: 'hps-release-plan/0', mode: 'create', smoke: 'PASS'}));
  const before = git(f.repo, 'show-ref');
  const result = spawnSync(process.execPath, [path.join(root, 'scripts/release/create.mjs'), '--plan', planPath, '--managed-draft'], {cwd: f.repo, encoding: 'utf8'});
  assert.notEqual(result.status, 0); assert.match(result.stderr, /lacks managed draft support/);
  assert.equal(git(f.repo, 'show-ref'), before);
  for (const file of contractSources) {
    fs.mkdirSync(path.dirname(path.join(f.repo, file)), {recursive: true});
    fs.copyFileSync(path.join(root, file), path.join(f.repo, file));
  }
  git(f.repo, 'add', '.'); git(f.repo, 'commit', '-qm', 'supports reviewed contract');
  const capable = git(f.repo, 'rev-parse', 'HEAD');
  assert.doesNotThrow(() => assertManagedCandidateSupport(capable, read(capable)));
  fs.appendFileSync(path.join(f.repo, '.github/workflows/build-windows.yml'), '\n# divergent workflow\n');
  git(f.repo, 'commit', '-qam', 'different workflow');
  const changed = git(f.repo, 'rev-parse', 'HEAD');
  assert.throws(() => assertManagedCandidateSupport(changed, read(changed)), /different build contract/);
});

function appFixture(dir, platform, sourceSha = sha) {
  const app = path.join(dir, platform === 'darwin-arm64' ? 'hps-draft-artifact/HypeProof Studio.app' : 'hps-smoke');
  const resources = path.join(app, platform === 'darwin-arm64' ? 'Contents/Resources/app' : 'resources/app');
  fs.mkdirSync(path.join(resources, 'extensions/hypeproof-chat'), {recursive: true});
  fs.writeFileSync(path.join(resources, 'product.json'), JSON.stringify({commit: sourceSha, version: '2026.1018.0', nameLong: 'HypeProof Studio'}));
  fs.writeFileSync(path.join(resources, 'extensions/hypeproof-chat/package.json'), JSON.stringify({version: '2026.1018.0'}));
  return {app, resources};
}
const names = platform => platform === 'darwin-arm64' ? ['HypeProof-Studio-darwin-arm64.zip']
  : ['HypeProof.Studio-win32-x64-1.2.3.zip', 'HypeProof.StudioUserSetup-x64-1.2.3.exe', 'HypeProof.StudioSetup-x64-1.2.3.exe'];

test('draft inventory requires every platform package, exact App version/SHA, and never claims acceptance', t => {
  for (const platform of ['darwin-arm64', 'win32-x64']) {
    const dir = tmp(t), dist = path.join(dir, 'dist'); fs.mkdirSync(dist);
    const {app, resources} = appFixture(dir, platform);
    for (const name of names(platform)) fs.writeFileSync(path.join(dist, name), `fixture bytes: ${name}`);
    const contract = resolveBuildContract(request());
    const receipt = draftIdentity(contract, {dist, platform, app});
    assert.equal(receipt.assets.length, platform === 'darwin-arm64' ? 1 : 3);
    assert.equal(receipt.acceptance, 'NOT_RUN'); assert.equal(receipt.promotion, 'NOT_AUTHORIZED');
    for (const asset of receipt.assets) { assert.match(asset.sha256, /^[a-f0-9]{64}$/); assert.ok(asset.size > 0); }
    const first = path.join(dist, names(platform)[0]);
    fs.appendFileSync(first, 'changed');
    assert.notEqual(draftIdentity(contract, {dist, platform, app}).assets[0].sha256, receipt.assets[0].sha256);
    fs.renameSync(first, first + '.absent');
    assert.throws(() => draftIdentity(contract, {dist, platform, app}), /package assets/);
    fs.renameSync(first + '.absent', first);
    fs.writeFileSync(path.join(dist, 'unexpected.exe'), 'fixture');
    assert.throws(() => draftIdentity(contract, {dist, platform, app}), /package assets/);
    fs.unlinkSync(path.join(dist, 'unexpected.exe'));
    fs.writeFileSync(path.join(resources, 'extensions/hypeproof-chat/package.json'), JSON.stringify({version: '2026.1018.0-rc.1'}));
    assert.throws(() => draftIdentity(contract, {dist, platform, app}), /App identity/);
    appFixture(dir, platform, other);
    assert.throws(() => draftIdentity(contract, {dist, platform, app}), /App identity/);
  }
});

test('Windows inventory rejects overlapping installer roles and an unrecorded upload', t => {
  const dir = tmp(t), dist = path.join(dir, 'dist'); fs.mkdirSync(dist);
  const platform = 'win32-x64', {app} = appFixture(dir, platform);
  const overlapping = 'HypeProof StudioUserSetup-x64-1.116.0-Setup-x64.exe';
  for (const name of [names(platform)[0], overlapping, 'unrelated.exe']) fs.writeFileSync(path.join(dist, name), 'fixture package');
  const contract = resolveBuildContract(request());
  assert.throws(() => draftIdentity(contract, {dist, platform, app}), /package roles must cover distinct files/);
  fs.unlinkSync(path.join(dist, overlapping));
  fs.unlinkSync(path.join(dist, 'unrelated.exe'));
  for (const name of names(platform).slice(1)) fs.writeFileSync(path.join(dist, name), 'fixture package');
  const assets = draftIdentity(contract, {dist, platform, app}).assets;
  assert.deepEqual(assets.map(asset => asset.id), ['win-portable', 'win-user', 'win-system']);
  assert.deepEqual(new Set(assets.map(asset => asset.name)), new Set(fs.readdirSync(dist)));
});

test('upload boundary rejects changed bytes and a moved remote tag, including annotated tags', t => {
  const f = repoFixture(t), platform = 'darwin-arm64', dist = path.join(f.repo, 'dist'); fs.mkdirSync(dist);
  const {app} = appFixture(f.dir, platform, f.candidate);
  const file = path.join(dist, names(platform)[0]); fs.writeFileSync(file, 'fixture zip, never executed');
  assert.equal(run(f.repo, f.env, 'preflight', f.contractPath).status, 0);
  assert.equal(run(f.repo, f.env, 'record', f.contractPath, platform, dist, app).status, 0);
  let result = run(f.repo, f.env, 'check-upload', f.contractPath, platform, dist, app);
  assert.equal(result.status, 0, result.stderr);
  fs.appendFileSync(file, 'changed');
  result = run(f.repo, f.env, 'check-upload', f.contractPath, platform, dist, app);
  assert.notEqual(result.status, 0); assert.match(result.stderr, /changed after recording/);
  fs.writeFileSync(file, 'fixture zip, never executed');
  git(f.repo, 'tag', '-f', '-a', plan.rcTag, f.candidate, '-m', 'marker removed at the same commit');
  git(f.repo, 'push', '-q', '--force', 'origin', `refs/tags/${plan.rcTag}`);
  result = run(f.repo, f.env, 'check-upload', f.contractPath, platform, dist, app);
  assert.notEqual(result.status, 0); assert.match(result.stderr, /remote candidate tag/);
  git(f.repo, 'tag', '-f', plan.rcTag, f.advanced);
  git(f.repo, 'push', '-q', '--force', 'origin', `refs/tags/${plan.rcTag}`);
  result = run(f.repo, f.env, 'check-upload', f.contractPath, platform, dist, app);
  assert.notEqual(result.status, 0); assert.match(result.stderr, /remote candidate tag/);
  const contract = resolveBuildContract(request());
  assert.throws(() => assertRemoteCandidate(`${sha}\trefs/tags/${plan.rcTag}\n`, contract), /remote candidate tag/);
  assert.doesNotThrow(() => assertRemoteCandidate(`${other}\trefs/tags/${plan.rcTag}\n${sha}\trefs/tags/${plan.rcTag}^{}\n`, contract));
  assert.throws(() => assertRemoteCandidate('', contract), /remote candidate tag/);
});

function workflow(name) {
  return JSON.parse(execFileSync('python3', ['-c', 'import json,sys,yaml; print(json.dumps(yaml.safe_load(open(sys.argv[1]))))',
    path.join(root, '.github/workflows', name)], {encoding: 'utf8'}));
}

test('managed Windows collects distributable packages without unpacked helper executables', t => {
  const dir = tmp(t), build = path.join(dir, 'vscodium-base'), dist = path.join(dir, 'dist');
  fs.mkdirSync(path.join(build, 'assets'), {recursive: true});
  fs.mkdirSync(path.join(build, 'VSCode-win32-x64'));
  for (const name of names('win32-x64')) fs.writeFileSync(path.join(build, 'assets', name), 'fixture package');
  fs.writeFileSync(path.join(build, 'VSCode-win32-x64', 'HypeProof Studio.exe'), 'unpacked App, not a release package');
  const locate = Object.values(workflow('build-windows.yml').jobs)[0].steps.find(s => s.name === 'Locate artifacts');
  const execute = mode => spawnSync('bash', ['-e', '-c', locate.run], {cwd: build, encoding: 'utf8',
    env: {...process.env, HPS_MANAGED_DRAFT: mode}});
  const managed = execute('true');
  assert.equal(managed.status, 0, managed.stderr);
  assert.deepEqual(fs.readdirSync(dist).sort(), names('win32-x64').sort());
  fs.rmSync(dist, {recursive: true});
  const legacy = execute('false');
  assert.equal(legacy.status, 0, legacy.stderr);
  assert.ok(fs.existsSync(path.join(dist, 'HypeProof Studio.exe')), 'preserve the existing legacy collection behavior');
});

test('both workflow upload scripts stop at the draft and use validated outputs to gate automatic acceptance', t => {
  for (const [name, platform] of [['build-mac.yml', 'darwin-arm64'], ['build-windows.yml', 'win32-x64']]) {
    const doc = workflow(name), job = Object.values(doc.jobs)[0], steps = job.steps;
    const inputs = doc[true].workflow_dispatch.inputs; // YAML 1.1 reads "on" as true.
    assert.equal(inputs.ref.default, '');
    assert.equal(inputs.managed_draft.default, false);
    assert.equal(steps.find(s => s.name === 'Checkout').with.ref, '${{ inputs.candidate_sha || inputs.ref || github.ref }}');
    const preflight = steps.find(s => s.id === 'contract');
    assert.deepEqual(preflight.env, {HPS_BUILD_REF: '${{ inputs.ref }}', HPS_CANDIDATE_SHA: '${{ inputs.candidate_sha }}',
      HPS_MANAGED_DRAFT: '${{ inputs.managed_draft }}', HPS_RELEASE_VERSION: '${{ inputs.release_version }}'});
    assert.ok(steps.indexOf(preflight) < steps.findIndex(s => s.name.includes('pre-build')));
    for (const step of steps) assert.doesNotMatch(step.run ?? '', /\$\{\{\s*(?:inputs|github\.event\.inputs)\./, 'inputs must enter shell through env, never source interpolation');
    const f = repoFixture(t), dist = path.join(f.repo, 'dist'); fs.mkdirSync(dist);
    fs.symlinkSync(path.join(root, 'scripts'), path.join(f.repo, 'scripts'));
    const {app} = appFixture(f.dir, platform, f.candidate);
    for (const asset of names(platform)) fs.writeFileSync(path.join(dist, asset), `offline fixture ${asset}`);
    assert.equal(run(f.repo, f.env, 'preflight', f.contractPath).status, 0);
    assert.equal(run(f.repo, f.env, 'record', f.contractPath, platform, dist, app).status, 0);
    const log = path.join(f.dir, 'calls.jsonl');
    // Fake gh executable on PATH: logs argv, answers api+release calls, exits 9 otherwise.
    // Node's execFileSync(gh) bypasses shell functions, so a real executable is required.
    const stub = path.join(f.dir, 'gh-stub.cjs');
    const bin = path.join(f.dir, 'bin'); fs.mkdirSync(bin);
    const fakeGh = path.join(bin, 'gh');
    fs.writeFileSync(stub, [
      'const fs=require("fs"),args=process.argv.slice(2);',
      'fs.appendFileSync(process.env.FIXTURE_LOG,JSON.stringify(args)+"\\n");',
      'if(args[0]==="api"&&args.some(a=>a.includes("/releases"))&&args.includes("--slurp")){',
      '  const c=process.env.FIXTURE_LOG+".apicnt";',
      '  let n=0;try{n=parseInt(fs.readFileSync(c,"utf8")||"0");}catch{}',
      '  fs.writeFileSync(c,String(n+1));',
      '  const tag=process.env.GITHUB_REF.replace("refs/tags/","");',
      '  if(process.env.FIXTURE_IS_DRAFT==="true"){',
      '    console.log(n===0?"[[]]":JSON.stringify([[{id:1,tag_name:tag,draft:true}]]));',
      '  }else{console.log(JSON.stringify([[{id:2,tag_name:tag,draft:false}]]));} process.exit(0);',
      '}',
      'if(args[0]==="release"&&args[1]==="create")process.exit(0);',
      'if(args[0]==="release"&&args[1]==="upload")process.exit(0);',
      'process.exit(9);',
    ].join('\n'));
    fs.writeFileSync(fakeGh, `#!/bin/sh\nexec node ${JSON.stringify(stub)} "$@"\n`);
    fs.chmodSync(fakeGh, 0o755);
    const upload = steps.find(s => s.name === 'Upload draft candidate (tag builds only)');
    const fakeEnv = {...process.env, ...f.env, HPS_MANAGED_DRAFT: 'true',
      FIXTURE_LOG: log, FIXTURE_IS_DRAFT: 'true', GITHUB_REPOSITORY: 'hypeproof/hypeproof-studio',
      PATH: `${bin}${path.delimiter}${process.env.PATH}`};
    const result = spawnSync('bash', ['-e', '-c', upload.run], {cwd: f.repo, encoding: 'utf8', env: fakeEnv});
    assert.equal(result.status, 0, result.stderr);
    const calls = fs.readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse);
    // list → create → list (race guard re-check) → upload
    assert.deepEqual(calls.map(args => args.slice(0, 2)),
      [['api', 'repos/hypeproof/hypeproof-studio/releases'], ['release', 'create'],
       ['api', 'repos/hypeproof/hypeproof-studio/releases'], ['release', 'upload']]);
    assert.ok(calls[1].includes('--draft')); assert.ok(calls[1].includes('--prerelease'));
    assert.ok(calls[3].includes(`dist/draft-build-${platform}.json`));
    assert.ok(!calls[3].includes('--clobber'));
    fs.writeFileSync(log, ''); try { fs.unlinkSync(log + '.apicnt'); } catch {}
    const published = spawnSync('bash', ['-e', '-c', upload.run], {cwd: f.repo, encoding: 'utf8',
      env: {...fakeEnv, FIXTURE_IS_DRAFT: 'false'}});
    assert.notEqual(published.status, 0);
    assert.deepEqual(fs.readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse).map(args => args.slice(0, 2)),
      [['api', 'repos/hypeproof/hypeproof-studio/releases']], 'a public release must be refused before create or upload');
    const gate = steps.find(s => s.name === 'Trigger both-activity release acceptance');
    assert.equal(gate.if, "steps.contract.outputs.auto_acceptance == 'true'");
    const output = Object.fromEntries(fs.readFileSync(f.env.GITHUB_OUTPUT, 'utf8').trim().split('\n').map(line => line.split('=')));
    assert.equal(output.auto_acceptance === 'true', false);
    assert.equal(resolveBuildContract({...request(), tagMessage: '', inputs: buildDispatches(plan)[0].inputs}).autoAcceptance, true);
  }
});

test('both build dispatches forward override_live_session to the release check; a tag push forwards false', t => {
  for (const name of ['build-mac.yml', 'build-windows.yml']) {
    const gate = Object.values(workflow(name).jobs)[0].steps.find(s => s.name === 'Trigger both-activity release acceptance');
    const key = Object.keys(gate.env).find(k => gate.env[k].includes('override_live_session'));
    assert.ok(key, `${name}: dispatch step must pass override_live_session through env`);
    assert.equal(gate.env[key], '${{ inputs.override_live_session || false }}', `${name}: a tag push has no inputs, so the value must default to false`);
    assert.match(gate.run, new RegExp(`-f override_live_session="\\$\\{${key}\\}"`), `${name}: dispatch must forward the value`);
    for (const [supplied, forwarded] of [['true', 'true'], [undefined, 'false']]) {
      const dir = tmp(t), bin = path.join(dir, 'bin'), log = path.join(dir, 'gh-args.txt');
      fs.mkdirSync(bin);
      fs.writeFileSync(path.join(bin, 'gh'), `#!/bin/sh\nprintf '%s\\n' "$@" > ${JSON.stringify(log)}\n`);
      fs.chmodSync(path.join(bin, 'gh'), 0o755);
      // GitHub renders `inputs.x || false`: a dispatched true stays true; a tag push (no inputs) becomes false.
      const rendered = gate.env[key].replace('${{ inputs.override_live_session || false }}', supplied ?? 'false');
      const result = spawnSync('bash', ['-e', '-c', gate.run], {encoding: 'utf8', env: {...process.env,
        GITHUB_REPOSITORY: 'hypeproof/hypeproof-studio', GITHUB_REF: 'refs/tags/v0.1.99', [key]: rendered,
        PATH: `${bin}${path.delimiter}${process.env.PATH}`}});
      assert.equal(result.status, 0, result.stderr);
      assert.ok(fs.readFileSync(log, 'utf8').split('\n').includes(`override_live_session=${forwarded}`),
        `${name}: ${supplied ?? 'tag push'} must dispatch override_live_session=${forwarded}`);
    }
  }
});
