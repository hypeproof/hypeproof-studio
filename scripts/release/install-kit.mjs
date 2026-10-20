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
// not notarized, so a browser download is quarantined and Gatekeeper refuses it; curl
// adds no quarantine flag, which is why the curl one-liner is the primary path.
//
// CLI:
//   install-kit.mjs render --tag vX --source-sha SHA --zip-sha256 HEX
//       [--seed-name claude-agent-sdk-darwin-arm64-V.tgz --seed-sha256 HEX --seeder-sha256 HEX]
//       --out DIR
//     writes DIR/install-mac.sh and DIR/HypeProof-<tag>-Test-Kit.zip
//   install-kit.mjs notes --tag vX < BODY > BODY
//     the release body with the install section added (or replaced, idempotent)
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';

const TEMPLATES = fileURLToPath(new URL('./templates/', import.meta.url));
export const REPO = 'hypeproof/hypeproof-studio';
export const INSTALLER_NAME = 'install-mac.sh';
const TAG_RE = /^v(\d+)\.(\d+)\.(\d+)(-[0-9A-Za-z.]+)?$/;
const HEX64 = /^[a-f0-9]{64}$/;
const SEED_RE = /^claude-agent-sdk-darwin-arm64-(\d+\.\d+\.\d+)\.tgz$/;
// First version whose start needs no participation code (free start, 2026.1020.0).
const FREE_START_FROM = [2026, 1020, 0];
const NOTES_BEGIN = '<!-- hps-install-mac:v1 -->';
const NOTES_END = '<!-- /hps-install-mac:v1 -->';

export const kitZipName = tag => `HypeProof-${tag}-Test-Kit.zip`;
// The kit name pattern that check-unified-release.mjs leaves out of the accepted bytes.
export {TEST_KIT_ZIP as KIT_ZIP_RE} from '../../e2e/unified-release/artifact.mjs';
export const releaseUrl = tag => `https://github.com/${REPO}/releases/download/${tag}`;
export const oneLiner = tag => `curl -fsSL ${releaseUrl(tag)}/${INSTALLER_NAME} | bash`;

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

function validate({tag, sourceSha, zipSha256, seedName = '', seedSha256 = '', seederSha256 = ''}) {
  parseTag(tag);
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
    TAG: tag, VERSION: version, SOURCE_SHA: sourceSha, ZIP_SHA256: zipSha256,
    SEED_NAME: seedName, SEED_SHA256: seedSha256, SEED_VERSION: SEED_RE.exec(seedName)?.[1] ?? '',
    SEEDER_SHA256: seederSha256, PRERELEASE: prerelease ? '1' : '0', FREE_START: isFreeStart(tag) ? '1' : '0',
    KIT_DIR_NAME: kitDirName(tag), START_COMMAND: start,
  });
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
    '  브라우저로 받은 파일과 달리 macOS가 막지 않습니다. 설치 위치는 아래와 같습니다.',
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
    `Installs ${where}. The script is pinned to \`${tag}\`: it downloads the darwin-arm64 zip with curl, checks its SHA-256 and the app version, and seeds the coach SDK binary from this release. No sudo. curl downloads are not quarantined, so Gatekeeper does not block the app the way it blocks a browser-downloaded zip.`,
    '',
    `Testers who prefer double-click: \`${kitZipName(tag)}\` (INSTALL/START .command files and a Korean READ-ME). macOS may refuse a .command file downloaded in a browser; use the one-liner then.`,
    NOTES_END,
  ].join('\n');
}

export function withInstallSection(body, tag) {
  const text = String(body ?? '');
  const start = text.indexOf(NOTES_BEGIN);
  const end = text.indexOf(NOTES_END);
  const base = start >= 0 && end > start ? text.slice(0, start) + text.slice(end + NOTES_END.length) : text;
  return `${notesSection(tag)}\n\n${base.trim()}\n`.replace(/\n{3,}/g, '\n\n');
}

export function writeKit(opts, outDir) {
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
    out: {type: 'string'},
  }});
  if (command === 'render') {
    if (!values.out) throw Error('--out is required');
    const names = writeKit({tag: values.tag, sourceSha: values['source-sha'], zipSha256: values['zip-sha256'],
      seedName: values['seed-name'], seedSha256: values['seed-sha256'], seederSha256: values['seeder-sha256']}, values.out);
    for (const name of names) console.log(path.join(values.out, name));
  } else if (command === 'notes') {
    process.stdout.write(withInstallSection(fs.readFileSync(0, 'utf8'), parseTag(values.tag).tag));
  } else {
    throw Error('usage: install-kit.mjs render|notes ... (see the header)');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
