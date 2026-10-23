#!/usr/bin/env node
// Guard: test and harness code must launch the Studio app only through the shared
// launcher (scripts/lib/studio-launcher.mjs, CLI scripts/studio-launch.mjs), which
// runs it in the background and cleans up after it. Fails on, in e2e/, scripts/
// and test directories:
//   - a direct Playwright `electron.launch(` / `_electron.launch(`
//   - spawn / execFile / exec / Popen of the app binary (a literal path with
//     `Contents/MacOS/` or `HypeProof Studio.exe`, or a variable assigned one)
//   - `open -a|-n|-b` of the app, or `open <...>.app`
//   - `studio-dev.py ... run` (it opens a visible Dev app)
// A human-facing launch (a Dev app or kit someone works in) is exempt only with a
// marker on the same or the previous line:  studio-launch: interactive -- <reason>
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const SCAN_DIRS = ['e2e', 'scripts', 'test', 'extensions/hypeproof-chat/test', 'chalk/test'];
const EXTS = new Set(['.mjs', '.js', '.cjs', '.ts', '.mts', '.py', '.sh', '.bash', '.zsh', '.ps1', '.command']);
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'test-results', 'playwright-report']);
// The launcher itself, this guard and its controls (their launch forms are strings there).
const ALLOWED_FILES = new Set(['scripts/lib/studio-launcher.mjs', 'scripts/check-studio-launches.mjs', 'scripts/test/studio-launch-guard.test.mjs']);
const MARKER = /studio-launch:\s*interactive\s*--\s*\S/;
// `studio-dev.py [options] run` in a shell line, or ['studio-dev.py', ..., 'run'] in an argv list.
const STUDIO_DEV_RUN = [
  /studio-dev\.py["']?(?:\s+(?:--?[\w-]+(?:[ =](?:"[^"]*"|'[^']*'|[^\s"']+))?|\$\{?\w+[^\s]*))*\s+run\b/,
  /studio-dev\.py['"]\s*,\s*(?:['"][^'"]*['"]\s*,\s*)*['"]run['"]/,
];
const APP_PATH = /Contents\/MacOS\/|HypeProof Studio\.exe|HypeProof Studio Helper/;

/** Violations in one file's text: [{line, rule, text}]. */
export function scanText(text, file = 'x.mjs') {
  const lines = text.split('\n');
  const out = [];
  const exempt = i => MARKER.test(lines[i]) || (i > 0 && MARKER.test(lines[i - 1]));
  const add = (i, rule) => { if (!exempt(i)) out.push({ file, line: i + 1, rule, text: lines[i].trim().slice(0, 160) }); };
  const isPy = file.endsWith('.py');
  const isShell = /\.(sh|bash|zsh|command)$/.test(file);
  // Identifiers assigned an app-binary path anywhere in the file.
  const binVars = new Set();
  for (const line of lines) {
    for (const m of line.matchAll(/(?:\b(?:const|let|var)\s+|[,;{(]\s*|^\s*)([A-Za-z_$][\w$]*)\s*=(?!=)([^;\n]*)/g)) {
      if (APP_PATH.test(m[2])) binVars.add(m[1]);
    }
  }
  const binRef = binVars.size ? `(?:${[...binVars].map(v => v.replace(/\$/g, '\\$')).join('|')})\\b` : null;
  const spawnCall = /\b(?:spawn|spawnSync|execFile|execFileSync|exec|execSync|fork|Popen|check_call|check_output|subprocess\.run|subprocess\.call)\s*\(\s*([^\n]{0,200})/g;
  let heredoc = null;
  lines.forEach((line, i) => {
    // A shell heredoc body is text printed for a person (instructions), not a command.
    if (heredoc) { if (line.trim() === heredoc) heredoc = null; return; }
    if (isShell) { const h = /<<-?\s*['"]?(\w+)['"]?/.exec(line); if (h) heredoc = h[1]; }
    if (/^\s*(?:\/\/|#|\*)/.test(line) && !/^\s*#!/.test(line)) return; // comments describe, they do not launch
    if (/\b_?electron\s*\.\s*launch\s*\(/.test(line)) add(i, 'direct electron.launch — use launchStudio(electron, options, meta)');
    for (const m of line.matchAll(spawnCall)) {
      const arg = m[1];
      const first = arg.split(/,(?![^([{]*[)\]}])/)[0];
      if (APP_PATH.test(first) || (binRef && new RegExp('^\\s*\\[?\\s*' + binRef).test(first))) add(i, 'raw spawn of the Studio binary — use spawnStudio(binary, args, options, meta)');
    }
    if (isPy && /\bPopen\s*\(/.test(line) && APP_PATH.test(text)) add(i, 'Popen in a file that builds a Studio binary path — use scripts/studio-launch.mjs run');
    if (/(?:^|[\s;&|('"`[,])(?:\/usr\/bin\/)?open['"]?\s*,?\s*\[?\s*(?:['"]?-[gjWFn]+['"]?\s*,?\s*)*['"]?-(?:a|n|b)\b/.test(line) && /HypeProof|\.app\b|\$\{?APP|ai\.hypeproof/.test(line)) add(i, 'open -a/-n/-b of the Studio app — use scripts/studio-launch.mjs run');
    else if ((isShell || /\bopen\b['"]?\s*,/.test(line)) && /(?:^|[\s;&|(])(?:\/usr\/bin\/)?open\s+(?:-[a-zA-Z]+\s+)*(?:"[^"]*\.app\/?"|'[^']*\.app\/?'|[^\s"']*\.app\b)/.test(line)) add(i, 'open <app bundle> — use scripts/studio-launch.mjs run');
    // An echo, or a sys.argv value handed to a patched main() in a unit test, is not a launch.
    if (!/^\s*(?:echo|printf|log|say)\b/.test(line) && !/\bdef\s+argv\b|\bargv\s*=/.test(line) && STUDIO_DEV_RUN.some(r => r.test(line))) add(i, 'studio-dev.py run opens a visible Dev app — tests use the launcher');
  });
  return out;
}

function* walk(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name) || entry.isSymbolicLink()) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (EXTS.has(path.extname(entry.name)) || (!path.extname(entry.name) && dir.endsWith('scripts'))) yield full;
  }
}

export function scanRepo(root = REPO) {
  const out = [];
  for (const base of SCAN_DIRS) {
    for (const file of walk(path.join(root, base))) {
      const rel = path.relative(root, file).split(path.sep).join('/');
      if (ALLOWED_FILES.has(rel)) continue;
      out.push(...scanText(fs.readFileSync(file, 'utf8'), rel));
    }
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}` || fileURLToPath(import.meta.url) === path.resolve(process.argv[1] || '')) {
  const found = scanRepo();
  for (const v of found) process.stderr.write(`${v.file}:${v.line}: ${v.rule}\n    ${v.text}\n`);
  if (found.length) {
    process.stderr.write(`\n✗ ${found.length} Studio launch(es) bypass the quiet launcher. See AGENTS.md "Studio test launches".\n`);
    process.exit(1);
  }
  process.stdout.write('✓ every Studio launch in e2e/, scripts/ and test dirs goes through the quiet launcher\n');
}
