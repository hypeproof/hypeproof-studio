// The baseline is a published release, not a stable-shaped tag left by a failed promotion.
import {execFileSync} from 'node:child_process';

export function lastPublishedRelease(exec = execFileSync) {
  let release;
  try {
    release = JSON.parse(exec('gh', ['api', 'repos/hypeproof/hypeproof-studio/releases/latest'],
      {encoding: 'utf8', timeout: 30_000}));
  } catch (error) {
    throw new Error(`Cannot read the latest published Studio release; refusing a tag fallback: ${error.message}`);
  }
  if (!release || release.draft !== false || release.prerelease !== false ||
      typeof release.published_at !== 'string' || !Number.isFinite(Date.parse(release.published_at)) ||
      typeof release.tag_name !== 'string' || !/^v[0-9]+(?:\.[0-9]+)+$/.test(release.tag_name)) {
    throw new Error('Latest Studio release is not a published stable v release');
  }
  return release.tag_name;
}

export function publishedBaseline(git, candidate, exec = execFileSync) {
  const tag = lastPublishedRelease(exec);
  try {
    git('merge-base', '--is-ancestor', `refs/tags/${tag}`, candidate);
  } catch {
    throw new Error(`Published baseline ${tag} is missing locally or is not an ancestor of ${candidate}; fetch tags and check the candidate`);
  }
  return tag;
}
