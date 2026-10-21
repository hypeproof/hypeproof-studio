#!/usr/bin/env node
// Idempotent draft-release create-or-find, then upload.
//
// Usage: node release-draft.mjs --tag TAG [--prerelease] ASSET [ASSET...]
// Env:   GH_TOKEN (required), GITHUB_REPOSITORY (required)
//
// Lists existing releases via the API, finds those whose tag_name matches TAG:
//   0 found              → creates a new draft, then uploads assets
//   1 found, draft       → skips create, uploads assets to it
//   1 found, published   → refuses (never overwrite a published release)
//   2+ found             → fails naming all matching ids (manual cleanup needed)
//
// After the decision step, exactly one draft release for TAG exists, so
// `gh release upload TAG` resolves it deterministically.

import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import process from 'node:process';

// Pure decision function — exported for tests.
// releases: array of GitHub release objects (id, tag_name, draft)
// Returns {action:'create'} or {action:'upload', id:number}
// Throws on published-release collision or multiple matches.
export function pickRelease(releases, tag) {
  const matching = releases.filter(r => r.tag_name === tag);
  if (matching.length > 1) {
    throw new Error(
      `Multiple releases for tag ${tag}: ids ${matching.map(r => r.id).join(', ')}; ` +
      'resolve manually before rebuilding'
    );
  }
  if (matching.length === 0) return {action: 'create'};
  const r = matching[0];
  if (!r.draft) {
    throw new Error(
      `Release ${r.id} for ${tag} is already published; refusing to overwrite`
    );
  }
  return {action: 'upload', id: r.id};
}

function gh(...args) {
  return execFileSync('gh', args, {encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit']});
}

function main() {
  const argv = process.argv.slice(2);
  let tag = '';
  let prerelease = false;
  const assets = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--tag') { tag = argv[++i]; }
    else if (argv[i] === '--prerelease') { prerelease = true; }
    else { assets.push(argv[i]); }
  }

  if (!tag) { process.stderr.write('release-draft: --tag is required\n'); process.exit(1); }
  if (assets.length === 0) { process.stderr.write('release-draft: at least one asset is required\n'); process.exit(1); }

  const repo = process.env.GITHUB_REPOSITORY;
  if (!repo) { process.stderr.write('release-draft: GITHUB_REPOSITORY env var is required\n'); process.exit(1); }

  const releases = JSON.parse(
    gh('api', `repos/${repo}/releases`, '--paginate', '--slurp')
  ).flat();

  const decision = pickRelease(releases, tag);

  if (decision.action === 'create') {
    const createArgs = [
      'release', 'create', tag,
      '--draft',
      '--title', `HypeProof Studio ${tag}`,
      '--generate-notes',
      '--verify-tag',
    ];
    if (prerelease) createArgs.push('--prerelease');
    gh(...createArgs);
    console.log(`release-draft: created draft release for ${tag}`);
  } else {
    console.log(`release-draft: reusing existing draft release ${decision.id} for ${tag}`);
  }

  // Exactly one draft release for TAG exists at this point — pickRelease guarantees it.
  // gh release upload resolves by tag and hits that one deterministically.
  gh('release', 'upload', tag, ...assets);
  console.log(`release-draft: uploaded ${assets.length} asset(s) to ${tag}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
