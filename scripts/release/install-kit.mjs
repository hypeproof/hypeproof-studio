#!/usr/bin/env node
// Per-release Mac installer and Test Kit (2026-10-20).
//
// Every published release, rc and stable alike, carries two assets made here in
// verify-unified-release.yml's publish job, while the release is still a draft:
//
//   install-mac.sh                     the one-line curl install, pinned to this tag
//   HypeProof-<tag>-Test-Kit.zip       INSTALL-<v>.command, START-<v>.command, the same
//                                      install-mac.sh and a Korean READ-ME.txt
//
// Both install exactly this release: the tag, the source commit, the SHA-256 of
// HypeProof-Studio-darwin-arm64.zip and of the native SDK seed are baked in. The zip is
// verified before placement. The candidate's signing policy is baked into the
// installer: official candidates require Developer ID and Gatekeeper acceptance.
//
// CLI:
//   install-kit.mjs render --tag vX --source-sha SHA --zip-sha256 HEX
//       [--seed-name claude-agent-sdk-darwin-arm64-V.tgz --seed-sha256 HEX --seeder-sha256 HEX]
//       --product-version EXACT_BUILD_CONTRACT_VERSION --mac-zip PATH_TO_ACCEPTED_MAC_ZIP --out DIR
//     writes DIR/install-mac.sh and DIR/HypeProof-<tag>-Test-Kit.zip
//   install-kit.mjs render-windows --tag vX --user-setup PATH_TO_ACCEPTED_USER_SETUP_EXE --seed-tarball PATH_TO_SDK_TGZ --seeder scripts/seed-sdk-binary.ps1 --out DIR
//     writes DIR/update-windows.cmd, pinned to this tag and to the exe's SHA-256 (2026-11-02)
//   install-kit.mjs notes --tag vX [--mac] [--windows] < BODY > BODY
//     the release body with the Mac and/or Windows install sections added (or replaced,
//     idempotent); sections not asked for are removed
//   install-kit.mjs check --tag vX --platforms JSON < RELEASE_JSON
//     RELEASE_JSON is `gh release view --json body,assets`; fails unless every platform of the
//     release has its installer asset and its notes section (the publish job runs it)
//   install-kit.mjs announce --tag vX < BODY > TEXT
//     the release announcement text: the install/update commands first, then the body
//     without the install sections (notify-release-published.yml)
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {signingPolicy} from './macos-signing-receipt.mjs';

const TEMPLATES = fileURLToPath(new URL('./templates/', import.meta.url));
export const REPO = 'hypeproof/hypeproof-studio';
export const INSTALLER_NAME = 'install-mac.sh';
const TAG_RE = /^v(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.]+)?$/;
const HEX64 = /^[a-f0-9]{64}$/;
const WINDOWS_SEED_RE = /^claude-agent-sdk-win32-x64-(\d+\.\d+\.\d+)\.tgz$/;
const SEED_RE = /^claude-agent-sdk-darwin-arm64-(\d+\.\d+\.\d+)\.tgz$/;
// First version whose start needs no participation code (free start, 2026.1020.0).
const FREE_START_FROM = [2026, 1020, 0];
const NOTES_BEGIN = '<!-- hps-install-mac:v1 -->';
const NOTES_END = '<!-- /hps-install-mac:v1 -->';
// Windows (2026-11-02). Asset name and markers match the section Jay added by hand to v2026.1102.2.
export const WINDOWS_UPDATER_NAME = 'update-windows.cmd';
const WIN_BEGIN = '<!-- hps-install-windows:v1 -->';
const WIN_END = '<!-- /hps-install-windows:v1 -->';
// The accepted per-user installer. Strict, because the name is baked into a PowerShell string.
export const USER_SETUP_RE = /^HypeProof\.StudioUserSetup-x64-[0-9A-Za-z.-]+\.exe$/;

export const kitZipName = tag => `HypeProof-${tag}-Test-Kit.zip`;
// The kit name pattern that check-unified-release.mjs leaves out of the accepted bytes.
export {TEST_KIT_ZIP as KIT_ZIP_RE} from '../../e2e/unified-release/artifact.mjs';
export const releaseUrl = tag => `https://github.com/${REPO}/releases/download/${tag}`;
export const oneLiner = tag => `curl -fsSL ${releaseUrl(tag)}/${INSTALLER_NAME} | bash`;
export const windowsUpdaterUrl = tag => `${releaseUrl(tag)}/${WINDOWS_UPDATER_NAME}`;
// PowerShell: irm cannot pipe a .cmd into iex, so save it to %TEMP% and run it.
export const windowsOneLiner = tag =>
  `irm ${windowsUpdaterUrl(tag)} -OutFile "$env:TEMP\\hps-update.cmd"; & "$env:TEMP\\hps-update.cmd"`;

export function parseTag(tag) {
  const m = TAG_RE.exec(tag ?? '');
  if (!m) throw Error(`not a release tag: ${tag}`);
  return {tag, version: tag.slice(1), core: [m[1], m[2], m[3]].map(Number), prerelease: Boolean(m[4])};
}

export function isFreeStart(tag) {
  const {core} = parseTag(tag);
  for (let i = 0; i < 3; i++) if (core[i] !== FREE_START_FROM[i]) return core[i] > FREE_START_FROM[i];
  return true;
}

export const kitDirName = tag => {
  const {version, prerelease} = parseTag(tag);
  return prerelease ? `HypeProof-RC-${version}` : `HypeProof-${version}`;
};

function fill(text, values) {
  const out = text.replace(/@@([A-Z0-9_]+)@@/g, (_, key) => {
    if (!(key in values)) throw Error(`template value missing: ${key}`);
    return values[key];
  });
  if (out.includes('@@')) throw Error('unfilled template placeholder');
  return out;
}

// The existing build contract resolves marked RCs to final-version bytes and
// legacy RCs to suffixed bytes. Keep that exact caller-supplied value.
export function productVersionFor({tag, productVersion}) {
  const parsed = parseTag(tag);
  const value = productVersion ?? parsed.version;
  if (![parsed.version, parsed.core.join('.')].includes(value)) throw Error('product version does not belong to release tag');
  return value;
}

function validate({tag, sourceSha, zipSha256, seedName = '', seedSha256 = '', seederSha256 = '', productVersion}) {
  productVersionFor({tag, productVersion});
  if (!/^[a-f0-9]{40}$/.test(sourceSha ?? '')) throw Error('source sha must be 40 lowercase hex characters');
  if (!HEX64.test(zipSha256 ?? '')) throw Error('zip sha256 must be 64 lowercase hex characters');
  if (seedName || seedSha256 || seederSha256) {
    if (!SEED_RE.test(seedName)) throw Error(`not a darwin-arm64 SDK seed: ${seedName}`);
    if (!HEX64.test(seedSha256) || !HEX64.test(seederSha256)) throw Error('seed and seeder sha256 must be 64 lowercase hex characters');
  }
}

const template = name => fs.readFileSync(path.join(TEMPLATES, name), 'utf8');

export function renderStart(tag) {
  const {version} = parseTag(tag);
  return fill(template('START.command'), {TAG: tag, VERSION: version, KIT_DIR_NAME: kitDirName(tag)});
}

export function renderInstallCommand(tag) {
  return fill(template('INSTALL.command'), {VERSION: parseTag(tag).version});
}

export function renderInstaller(opts) {
  validate(opts);
  const {tag, sourceSha, zipSha256, seedName = '', seedSha256 = '', seederSha256 = ''} = opts;
  const {version, prerelease} = parseTag(tag);
  const start = renderStart(tag).replace(/\n$/, '');
  if (/^START_COMMAND$/m.test(start)) throw Error('START.command must not contain the heredoc delimiter');
  return fill(template('install-mac.sh'), {
    TAG: tag, VERSION: version, PRODUCT_VERSION: productVersionFor(opts), SOURCE_SHA: sourceSha, ZIP_SHA256: zipSha256,
    SEED_NAME: seedName, SEED_SHA256: seedSha256, SEED_VERSION: SEED_RE.exec(seedName)?.[1] ?? '',
    SEEDER_SHA256: seederSha256, PRERELEASE: prerelease ? '1' : '0', FREE_START: isFreeStart(tag) ? '1' : '0',
    KIT_DIR_NAME: kitDirName(tag), START_COMMAND: start,
    OFFICIAL_SIGNING: signingPolicy(sourceSha) ? '1' : '0',
  });
}

/** update-windows.cmd for this tag: CRLF, pinned to the accepted per-user installer's SHA-256. */
export function renderWindowsUpdater({tag, exeName, exeSha256, seedName, seedSha256, seederSha256}) {
  parseTag(tag);
  if (!USER_SETUP_RE.test(exeName ?? '')) throw Error(`not a Windows per-user installer: ${exeName}`);
  if (!HEX64.test(exeSha256 ?? '')) throw Error('exe sha256 must be 64 lowercase hex characters');
  const seed = WINDOWS_SEED_RE.exec(seedName ?? '');
  if (!seed) throw Error('Windows win32-x64 SDK tarball name is required');
  if (!HEX64.test(seedSha256 ?? '') || !HEX64.test(seederSha256 ?? '')) throw Error('Windows SDK and seeder sha256 pins are required');
  const text = fill(template(WINDOWS_UPDATER_NAME), {TAG: tag, EXE_NAME: exeName, EXE_SHA256: exeSha256,
    SEED_NAME: seedName, SEED_VERSION: seed[1], SEED_SHA256: seedSha256, SEEDER_SHA256: seederSha256});
  return text.replace(/\r?\n/g, '\r\n');
}

const fileSha256 = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

export function writeWindowsUpdater({tag, userSetup, seedTarball, seeder}, outDir) {
  if (!seedTarball || !seeder || path.basename(seeder) !== 'seed-sdk-binary.ps1') throw Error('Windows SDK tarball and canonical seeder are required');
  const text = renderWindowsUpdater({tag, exeName: path.basename(userSetup ?? ''), exeSha256: fileSha256(userSetup),
    seedName: path.basename(seedTarball), seedSha256: fileSha256(seedTarball), seederSha256: fileSha256(seeder)});
  fs.mkdirSync(outDir, {recursive: true});
  fs.writeFileSync(path.join(outDir, WINDOWS_UPDATER_NAME), text);
  return [WINDOWS_UPDATER_NAME];
}

export function renderReadme({tag, sourceSha, zipSha256}) {
  const {version} = parseTag(tag);
  const dir = kitDirName(tag);
  const start = isFreeStart(tag)
    ? ['3. Studio가 열리면 참여 코드 없이 시작합니다. 나이를 묻는 질문에 답하면 바로 AI 코치와 대화합니다.']
    : ['3. Studio가 열리면 처음 화면에 강사에게 받은 본인의 참여 코드를 붙여넣습니다.',
      '   이 버전은 참여 코드가 있어야 실제 AI 대화를 시작할 수 있습니다.'];
  return [
    `HypeProof Studio ${version} — 테스트 키트`,
    '',
    '가장 쉬운 설치 (권장): 터미널에 아래 한 줄을 붙여넣고 Enter',
    `  ${oneLiner(tag)}`,
    '  내려받은 앱을 확인한 뒤 설치합니다. macOS 보안 검증에 실패하면 설치를 멈춥니다.',
    '',
    '이 키트로 설치하기',
    `1. ${kitZipName(tag)} 을 더블클릭해 압축을 풉니다.`,
    `2. 폴더 안 INSTALL-${version}.command 를 더블클릭합니다. 앱을 내려받아 확인한 뒤 설치하고 Studio를 엽니다.`,
    ...start,
    `4. 다음부터는 ~/Applications/${dir}/START-${version}.command 로 엽니다.`,
    '',
    `설치 위치: ~/Applications/${dir}/`,
    `프로필/기록: ~/Library/Application Support/HPS-${version}/`,
    '기존 HypeProof Studio 앱과 기존 프로필은 바꾸지 않습니다.',
    '로그인 정보는 macOS 키체인에 저장됩니다. 키체인 접근을 묻는 창이 뜨면 \'항상 허용\'을 누르세요.',
    '',
    '주의',
    '- macOS가 .command 파일을 열지 못하게 막으면 보안 설정을 바꾸거나 우회하지 마세요.',
    '  위의 한 줄 설치를 쓰거나, 보이는 오류 문구를 그대로 알려 주세요.',
    '- 설치 스크립트는 내려받은 앱의 SHA-256과 버전이 아래 값과 다르면 설치하지 않습니다.',
    '- 같은 이름의 다른 폴더나 프로필이 있으면 덮어쓰지 않고 멈춥니다.',
    '',
    `패키지: ${tag} / macOS Apple Silicon`,
    `소스: ${sourceSha}`,
    `앱 ZIP SHA256: ${zipSha256}`,
    `공식 릴리스: https://github.com/${REPO}/releases/tag/${tag}`,
    '',
  ].join('\n');
}

export function notesSection(tag) {
  const {prerelease} = parseTag(tag);
  const where = prerelease
    ? 'a side-by-side test install in `~/Applications/' + kitDirName(tag) + '/` with its own profile; an existing HypeProof Studio is untouched'
    : '`~/Applications/HypeProof Studio.app` (add `bash -s -- --system` for `/Applications`)';
  return [
    NOTES_BEGIN,
    '## Install this exact build on a Mac (Apple Silicon)',
    '',
    '```bash',
    oneLiner(tag),
    '```',
    '',
    `Installs ${where}. The script is pinned to \`${tag}\`: it checks the archive SHA-256, app version and source, and seeds the coach SDK binary from this release. Official signed candidates also require the expected Developer ID identity and notarized Gatekeeper acceptance before replacing an app. No sudo or quarantine removal.`,
    '',
    `Testers who prefer double-click: \`${kitZipName(tag)}\` (INSTALL/START .command files and a Korean READ-ME). macOS may refuse a .command file downloaded in a browser; use the one-liner then.`,
    NOTES_END,
  ].join('\n');
}

export function windowsNotesSection(tag) {
  const {prerelease} = parseTag(tag);
  const what = prerelease
    ? `Installs this release candidate over the installed HypeProof Studio (Windows has no side-by-side test install)`
    : 'Installs or updates HypeProof Studio';
  return [
    WIN_BEGIN,
    '## Install or update on Windows (x64)',
    '',
    `Double-click [\`${WINDOWS_UPDATER_NAME}\`](${windowsUpdaterUrl(tag)}) (SmartScreen: 추가 정보 → 실행), or paste in PowerShell:`,
    '',
    '```powershell',
    windowsOneLiner(tag),
    '```',
    '',
    `${what}. The script is pinned to \`${tag}\`: it downloads this release's per-user installer (\`HypeProof.StudioUserSetup-x64-*.exe\`), checks its SHA-256, closes Studio and installs silently. No admin rights; chats and settings are kept.`,
    WIN_END,
  ].join('\n');
}

function strip(text, begin, end) {
  const start = text.indexOf(begin);
  const stop = text.indexOf(end);
  return start >= 0 && stop > start ? text.slice(0, start) + text.slice(stop + end.length) : text;
}

const withoutSections = body => strip(strip(String(body ?? ''), NOTES_BEGIN, NOTES_END), WIN_BEGIN, WIN_END).trim();

/** The body with the requested install sections first (Mac, then Windows); idempotent. */
export function withInstallSection(body, tag, {mac = true, windows = false} = {}) {
  const sections = [mac && notesSection(tag), windows && windowsNotesSection(tag)].filter(Boolean);
  return `${[...sections, withoutSections(body)].join('\n\n')}\n`.replace(/\n{3,}/g, '\n\n');
}

/** Problems that keep a release from publishing: a platform without its installer or notes. */
export function installProblems({tag, platforms, body = '', assets = []}) {
  parseTag(tag);
  const names = assets.map(a => (typeof a === 'string' ? a : a.name));
  const problems = [];
  const need = (asset, marker, section, label) => {
    if (!names.includes(asset)) problems.push(`${label}: release asset ${asset} is missing`);
    if (!body.includes(marker) || !body.includes(section)) problems.push(`${label}: the release notes lack the ${asset} command`);
  };
  if (platforms.includes('darwin-arm64')) need(INSTALLER_NAME, NOTES_BEGIN, oneLiner(tag), 'macOS');
  if (platforms.includes('win32-x64')) {
    need(WINDOWS_UPDATER_NAME, WIN_BEGIN, windowsOneLiner(tag), 'Windows');
    if (!names.includes('seed-sdk-binary.ps1')) problems.push('Windows: canonical SDK seeder is missing');
    if (names.filter(name => WINDOWS_SEED_RE.test(name)).length !== 1) problems.push('Windows: exactly one win32-x64 SDK tarball is required');
  }
  return problems;
}

/** Announcement text: the install/update commands of the sections the body has, then the rest. */
export function announcement(body, tag) {
  const text = String(body ?? '');
  const lines = [];
  if (text.includes(NOTES_BEGIN)) lines.push('macOS (Terminal):', oneLiner(tag));
  if (text.includes(WIN_BEGIN)) lines.push(`Windows (PowerShell, or double-click ${WINDOWS_UPDATER_NAME} on the release page):`, windowsOneLiner(tag));
  const rest = withoutSections(text);
  return [lines.length ? `Install / update ${tag}\n${lines.join('\n')}` : '', rest].filter(Boolean).join('\n\n') + '\n';
}

/** Check the exact accepted payload before generating a public installer, on either CI OS. */
export function verifyMacArchive(opts, archive) {
  validate(opts);
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(archive, 'r');
  try {
    const block = Buffer.alloc(256 * 1024);
    for (let n; (n = fs.readSync(fd, block)) > 0;) hash.update(block.subarray(0, n));
  } finally { fs.closeSync(fd); }
  if (hash.digest('hex') !== opts.zipSha256) throw Error('Mac archive SHA-256 does not match the pinned installer input');
  const identity = JSON.parse(execFileSync('python3', ['-c', `
import json, plistlib, sys, zipfile
with zipfile.ZipFile(sys.argv[1]) as z:
    plist = 'HypeProof Studio.app/Contents/Info.plist'
    product = 'HypeProof Studio.app/Contents/Resources/app/product.json'
    if any(z.namelist().count(p) != 1 for p in [plist, product]):
        raise ValueError('Missing or duplicate Mac identity metadata')
    info = plistlib.loads(z.read(plist))
    app = json.loads(z.read(product))
    print(json.dumps({'bundleId': info.get('CFBundleIdentifier'), 'plistVersion': info.get('CFBundleShortVersionString'), 'productVersion': app.get('version'), 'sourceSha': app.get('commit')}))
`, path.resolve(archive)], {encoding: 'utf8', timeout: 10000, maxBuffer: 65536}));
  const expected = productVersionFor(opts);
  if (identity.bundleId !== 'ai.hypeproof.studio' || identity.plistVersion !== expected || identity.productVersion !== expected || identity.sourceSha !== opts.sourceSha) {
    throw Error(`Mac archive product identity does not match ${opts.tag} at ${opts.sourceSha}`);
  }
  return identity;
}

export function writeKit(opts, outDir) {
  if (opts.macZip) verifyMacArchive(opts, opts.macZip);
  const installer = renderInstaller(opts);
  const {version} = parseTag(opts.tag);
  fs.mkdirSync(outDir, {recursive: true});
  fs.writeFileSync(path.join(outDir, INSTALLER_NAME), installer, {mode: 0o755});
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'hps-kit-'));
  try {
    const folder = kitZipName(opts.tag).replace(/\.zip$/, '');
    const dir = path.join(stage, folder);
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, `INSTALL-${version}.command`), renderInstallCommand(opts.tag), {mode: 0o755});
    fs.writeFileSync(path.join(dir, `START-${version}.command`), renderStart(opts.tag), {mode: 0o755});
    fs.writeFileSync(path.join(dir, INSTALLER_NAME), installer, {mode: 0o755});
    fs.writeFileSync(path.join(dir, 'READ-ME.txt'), renderReadme(opts));
    const zip = path.resolve(outDir, kitZipName(opts.tag));
    fs.rmSync(zip, {force: true});
    execFileSync('zip', ['-q', '-X', '-r', zip, folder], {cwd: stage});
  } finally {
    fs.rmSync(stage, {recursive: true, force: true});
  }
  return [INSTALLER_NAME, kitZipName(opts.tag)];
}

function main(argv) {
  const [command, ...rest] = argv;
  const {values} = parseArgs({args: rest, options: {
    tag: {type: 'string'}, 'source-sha': {type: 'string'}, 'zip-sha256': {type: 'string'},
    'seed-name': {type: 'string'}, 'seed-sha256': {type: 'string'}, 'seeder-sha256': {type: 'string'},
    out: {type: 'string'}, 'mac-zip': {type: 'string'}, 'product-version': {type: 'string'},
    'user-setup': {type: 'string'}, 'seed-tarball': {type: 'string'}, 'seeder': {type: 'string'}, mac: {type: 'boolean'}, windows: {type: 'boolean'}, platforms: {type: 'string'},
  }});
  if (command === 'render') {
    if (!values.out) throw Error('--out is required');
    if (!values['product-version']) throw Error('--product-version is required from the build contract');
    if (!values['mac-zip']) throw Error('--mac-zip is required to verify the accepted product identity');
    const names = writeKit({tag: values.tag, sourceSha: values['source-sha'], zipSha256: values['zip-sha256'],
      seedName: values['seed-name'], seedSha256: values['seed-sha256'], seederSha256: values['seeder-sha256'], macZip: values['mac-zip'], productVersion: values['product-version']}, values.out);
    for (const name of names) console.log(path.join(values.out, name));
  } else if (command === 'render-windows') {
    if (!values.out) throw Error('--out is required');
    if (!values['user-setup']) throw Error('--user-setup is required: the accepted HypeProof.StudioUserSetup-x64-*.exe');
    for (const name of writeWindowsUpdater({tag: values.tag, userSetup: values['user-setup'], seedTarball: values['seed-tarball'], seeder: values.seeder}, values.out)) console.log(path.join(values.out, name));
  } else if (command === 'notes') {
    if (!values.mac && !values.windows) throw Error('notes needs --mac and/or --windows');
    process.stdout.write(withInstallSection(fs.readFileSync(0, 'utf8'), parseTag(values.tag).tag, {mac: Boolean(values.mac), windows: Boolean(values.windows)}));
  } else if (command === 'check') {
    if (!values.platforms) throw Error('--platforms is required (platforms.mjs list TAG)');
    const release = JSON.parse(fs.readFileSync(0, 'utf8'));
    const problems = installProblems({tag: values.tag, platforms: JSON.parse(values.platforms), body: release.body, assets: release.assets ?? []});
    if (problems.length) throw Error(`release ${values.tag} has no ready install command:\n${problems.join('\n')}`);
    console.log(`install commands present for ${values.tag}`);
  } else if (command === 'announce') {
    process.stdout.write(announcement(fs.readFileSync(0, 'utf8'), parseTag(values.tag).tag));
  } else {
    throw Error('usage: install-kit.mjs render|render-windows|notes|check|announce ... (see the header)');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
