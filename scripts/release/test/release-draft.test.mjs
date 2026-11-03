import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {pickRelease} from '../release-draft.mjs';

const script = fileURLToPath(new URL('../release-draft.mjs', import.meta.url));

// Helper: make a minimal release object
const rel = (tag_name, draft, id) => ({id, tag_name, draft});

test('none → create', () => {
  assert.deepEqual(pickRelease([], 'v1.0.0'), {action: 'create'});
});

test('none matching (other tags present) → create', () => {
  assert.deepEqual(
    pickRelease([rel('v2.0.0', true, 5)], 'v1.0.0'),
    {action: 'create'}
  );
});

test('one draft → upload to its id', () => {
  assert.deepEqual(
    pickRelease([rel('v1.0.0', true, 42)], 'v1.0.0'),
    {action: 'upload', id: 42}
  );
});

test('one draft among others → upload to matching id', () => {
  assert.deepEqual(
    pickRelease([rel('v0.9.0', true, 1), rel('v1.0.0', true, 42), rel('v1.1.0', true, 99)], 'v1.0.0'),
    {action: 'upload', id: 42}
  );
});

test('published release → refuses with "published"', () => {
  assert.throws(
    () => pickRelease([rel('v1.0.0', false, 99)], 'v1.0.0'),
    /published/
  );
});

test('two drafts for same tag → throws naming both ids', () => {
  const err = assert.throws(
    () => pickRelease([rel('v1.0.0', true, 10), rel('v1.0.0', true, 20)], 'v1.0.0'),
    /Multiple/
  );
  void err;
  // Both ids appear in the message
  try { pickRelease([rel('v1.0.0', true, 10), rel('v1.0.0', true, 20)], 'v1.0.0'); }
  catch (e) {
    assert.ok(e.message.includes('10'), 'id 10 should appear in error');
    assert.ok(e.message.includes('20'), 'id 20 should appear in error');
  }
});

// Race guard scenario: both builders listed (both saw 0), both called create,
// then the re-list after create finds 2 drafts. pickRelease on that re-list
// must throw so upload is never dispatched against an ambiguous tag.
test('race guard — re-list after create finds 2 drafts → throws Multiple', () => {
  assert.throws(
    () => pickRelease([rel('v1.0.0', true, 10), rel('v1.0.0', true, 11)], 'v1.0.0'),
    /Multiple/
  );
  // Both ids appear in the message
  try { pickRelease([rel('v1.0.0', true, 10), rel('v1.0.0', true, 11)], 'v1.0.0'); }
  catch (e) {
    assert.ok(e.message.includes('10'), 'id 10 should appear in error');
    assert.ok(e.message.includes('11'), 'id 11 should appear in error');
  }
});

test('three releases for same tag → throws naming all ids', () => {
  try {
    pickRelease([rel('v1.0.0', true, 1), rel('v1.0.0', true, 2), rel('v1.0.0', true, 3)], 'v1.0.0');
    assert.fail('expected throw');
  } catch (e) {
    assert.ok(e.message.includes('1'), 'id 1 should appear');
    assert.ok(e.message.includes('2'), 'id 2 should appear');
    assert.ok(e.message.includes('3'), 'id 3 should appear');
  }
});

test('release listing requests compact fields and survives a page larger than the default 1 MB buffer', t => {
  for (const [name, line, expected] of [
    ['existing draft', '{"id":42,"tag_name":"v1.0.0","draft":true}', 'reusing existing draft release 42'],
    ['no release', '', 'created draft release for v1.0.0'],
  ]) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-draft-'));
    t.after(() => fs.rmSync(dir, {recursive: true, force: true}));
    const bin = path.join(dir, 'bin'), log = path.join(dir, 'gh-args.jsonl'), asset = path.join(dir, 'asset.zip');
    fs.mkdirSync(bin);
    fs.writeFileSync(asset, 'fixture');
    // Fake gh: a listing without --jq returns 2 MB (full release objects with assets);
    // only the --jq listing returns the compact lines.
    fs.writeFileSync(path.join(bin, 'gh'), [
      `#!${process.execPath}`,
      'const fs = require("fs"), args = process.argv.slice(2);',
      'fs.appendFileSync(process.env.FIXTURE_LOG, JSON.stringify(args) + "\\n");',
      'if (args[0] === "api") {',
      '  if (args.includes("--jq")) process.stdout.write(process.env.FIXTURE_LINE ? process.env.FIXTURE_LINE + "\\n" : "");',
      '  else process.stdout.write(JSON.stringify([{id: 9, tag_name: "v0.0.1", draft: false, body: "x".repeat(2 << 20)}]));',
      '}',
      'process.exit(0);',
    ].join('\n'));
    fs.chmodSync(path.join(bin, 'gh'), 0o755);
    const result = spawnSync(process.execPath, [script, '--tag', 'v1.0.0', asset], {encoding: 'utf8', env: {...process.env,
      PATH: `${bin}${path.delimiter}${process.env.PATH}`, GITHUB_REPOSITORY: 'hypeproof/hypeproof-studio', GH_TOKEN: 'fixture',
      FIXTURE_LOG: log, FIXTURE_LINE: line}});
    assert.equal(result.status, 0, `${name}: ${result.stderr}`);
    assert.match(result.stdout, new RegExp(expected));
    const calls = fs.readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse);
    const listings = calls.filter(args => args[0] === 'api');
    assert.ok(listings.length > 0 && listings.every(args => args.includes('--jq')), `${name}: every listing must request --jq`);
  }
});
