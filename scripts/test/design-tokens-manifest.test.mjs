// Two checks only: the manifest lists exactly the canonical token files, and its version is semver.
// Hashes are deliberately not recorded here; Chalk's pin owns sha256 (design-token canon, plan M-3).
import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { focusSource, radiusSource, source, typographySource } from '../sync-design-tokens.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const manifest = JSON.parse(readFileSync(join(repo, 'config/design-tokens.json'), 'utf8'));
const syncText = readFileSync(join(repo, 'scripts/sync-design-tokens.mjs'), 'utf8');
const repoPath = url => relative(repo, fileURLToPath(url)).split('\\').join('/');

// The canonical set is what the generator reads, plus the Studio role layer (tokens.css) that imports designTokens.css.
function canonicalFiles() {
  const korean = syncText.match(/new URL\('(\.\.\/[^']*koreanProse\.css)', import\.meta\.url\)/);
  assert.ok(korean, 'sync script still reads koreanProse.css through a relative URL');
  const koreanPath = relative(repo, resolve(repo, 'scripts', korean[1])).split('\\').join('/');
  const tokensPath = repoPath(new URL('tokens.css', source));
  const mainText = readFileSync(join(repo, 'extensions/hypeproof-chat/webview-ui/src/main.tsx'), 'utf8');
  assert.match(mainText, /import ["']\.\/tokens\.css["'];/, 'main.tsx imports tokens.css');
  return new Set([repoPath(source), repoPath(radiusSource), tokensPath, repoPath(focusSource), koreanPath, repoPath(typographySource)]);
}

test('manifest files are exactly the canonical token files and all exist', () => {
  const expected = canonicalFiles();
  const listed = new Set(manifest.files);
  assert.equal(listed.size, manifest.files.length, 'no duplicate entries');
  assert.deepEqual([...listed].sort(), [...expected].sort());
  for (const file of listed) assert.ok(existsSync(join(repo, file)), `missing canonical file: ${file}`);
});

test('manifest version is a semver string', () => {
  assert.match(manifest.version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/);
});
