// CGP-KNOW-D-011 (DES-KNOW-20): the 내 작품 drawer's thumbnails come only from small raster images
// inside the work folder, read by the host and handed over as data: URIs. Real temp folders with a
// planted answer per case: positive controls must produce an image, negative ones must not.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, linkSync, rmSync, realpathSync } from 'node:fs';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readWorkspaceThumbnail, sniffImage, thumbnailCandidate, THUMBNAIL_MAX_BYTES } from '../src/artifactThumbnail.ts';

const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
const JPEG = Buffer.from('ffd8ffe000104a464946', 'hex');
const GIF = Buffer.from('474946383961010001000000', 'hex');
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([4, 0, 0, 0]), Buffer.from('WEBPVP8 ')]);

const base = realpathSync(mkdtempSync(join(tmpdir(), 'hp-thumb-')));
const root = join(base, 'work'), outside = join(base, 'outside');
mkdirSync(join(root, 'img'), { recursive: true }); mkdirSync(outside);
try {
  writeFileSync(join(root, 'cat.png'), PNG);
  writeFileSync(join(root, 'img', '사진.JPG'), JPEG);
  writeFileSync(join(root, 'anim.gif'), GIF);
  writeFileSync(join(root, 'pic.webp'), WEBP);
  writeFileSync(join(root, 'real-jpeg.png'), JPEG);
  writeFileSync(join(root, 'page.png'), '<html><img src="https://example.com/x.png"></html>');
  writeFileSync(join(root, 'logo.svg'), '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.com/x.png"/></svg>');
  writeFileSync(join(root, 'index.html'), '<img src="https://example.com/x.png">');
  writeFileSync(join(root, 'empty.png'), '');
  writeFileSync(join(root, 'big.png'), Buffer.concat([PNG, Buffer.alloc(THUMBNAIL_MAX_BYTES)]));
  writeFileSync(join(outside, 'secret.png'), PNG);
  // Real files whose names carry a separator, a control character or a backslash: only the name check refuses them.
  writeFileSync(join(root, `cat${String.fromCharCode(0x2028)}.png`), PNG);
  writeFileSync(join(root, `tab${String.fromCharCode(9)}.png`), PNG);
  writeFileSync(join(root, 'img\\사진.JPG'), JPEG);
  symlinkSync(join(outside, 'secret.png'), join(root, 'link.png'));
  symlinkSync(outside, join(root, 'linkdir'));
  symlinkSync(join(root, 'cat.png'), join(root, 'alias.png'));
  symlinkSync(join(root, 'img'), join(root, 'imglink'));
  mkdirSync(join(root, 'dir.png'));

  // Positive controls: each real image becomes an inline data: URI of its sniffed kind.
  for (const [rel, mime] of [['cat.png', 'image/png'], ['img/사진.JPG', 'image/jpeg'], ['anim.gif', 'image/gif'], ['pic.webp', 'image/webp'], ['real-jpeg.png', 'image/jpeg']]) {
    const src = readWorkspaceThumbnail(root, rel);
    assert.ok(src?.startsWith(`data:${mime};base64,`), `${rel} → ${mime}`);
  }
  assert.equal(Buffer.from(readWorkspaceThumbnail(root, 'cat.png').split(',')[1], 'base64').equals(PNG), true, 'the bytes are the file\'s own');

  // Negative controls: none of these may produce a thumbnail.
  const refused = {
    'page.png': 'HTML named .png', 'logo.svg': 'SVG (can name outside resources)', 'index.html': 'HTML page',
    'empty.png': 'zero bytes', 'big.png': 'over the size cap', 'link.png': 'link to outside the folder',
    'linkdir/secret.png': 'through a linked folder', 'alias.png': 'a link to a file inside', 'imglink/사진.JPG': 'through a linked folder inside', 'dir.png': 'a folder', 'missing.png': 'missing',
    '../outside/secret.png': 'parent escape', 'img/../../outside/secret.png': 'parent escape mid-path',
    './cat.png': 'dot segment', 'img//사진.JPG': 'empty segment', '/etc/hosts.png': 'absolute',
    'cat.png\u0000.png': 'NUL', 'tab\t.png': 'tab', 'img\\사진.JPG': 'backslash', [`cat${String.fromCharCode(0x2028)}.png`]: 'line separator',
    [`${'a/'.repeat(600)}x.png`]: 'too long',
  };
  for (const [rel, why] of Object.entries(refused)) assert.equal(readWorkspaceThumbnail(root, rel), null, `refused: ${why}`);
  assert.equal(readWorkspaceThumbnail(undefined, 'cat.png'), null, 'no work folder');
  assert.equal(readWorkspaceThumbnail(root, 42), null, 'a non-string path');
  assert.equal(readWorkspaceThumbnail(join(root, 'img'), 'cat.png'), null, 'another folder\'s file is not this folder\'s');

  assert.equal(sniffImage(Buffer.from('GIF87a')), 'image/gif');
  assert.equal(sniffImage(Buffer.from('<svg')), null);
  assert.equal(thumbnailCandidate('a/B.JPEG'), true);
  assert.equal(thumbnailCandidate('a/b.svg'), false);

  // A hard link is a second name for a file that may live outside the folder; it is refused.
  linkSync(join(outside, 'secret.png'), join(root, 'hard.png'));
  assert.equal(readWorkspaceThumbnail(root, 'hard.png'), null, 'refused: a hard link (second name for an outside file)');

  // A folder on the path swapped for a link after the walk and before the open must not reach outside.
  const fs = createRequire(import.meta.url)('fs');
  mkdirSync(join(root, 'swap')); writeFileSync(join(root, 'swap', 'secret.png'), PNG);
  const away = join(base, 'away'); mkdirSync(away);
  writeFileSync(join(away, 'secret.png'), Buffer.concat([PNG, Buffer.from('OUTSIDE')]));
  const realOpen = fs.openSync;
  fs.openSync = function (p, ...rest) {
    if (String(p).endsWith(join('swap', 'secret.png'))) { fs.renameSync(join(root, 'swap'), join(root, 'swap-old')); fs.symlinkSync(away, join(root, 'swap')); }
    return realOpen.call(this, p, ...rest);
  };
  syncBuiltinESMExports();
  let raced;
  try { raced = readWorkspaceThumbnail(root, 'swap/secret.png'); } finally { fs.openSync = realOpen; syncBuiltinESMExports(); }
  assert.equal(raced, null, 'refused: a folder on the path became a link between the walk and the open');
  console.log('PASS artifact thumbnail: 5 images read, 26 refusals');
} finally {
  rmSync(base, { recursive: true, force: true });
}
