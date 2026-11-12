#!/usr/bin/env node
import { constants } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GOOGLE_DESKTOP_RESOURCE, parseGoogleDesktopSource } from '../extensions/hypeproof-chat/src/googleDesktopClientSchema.mjs';
const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const within = (root, file) => { const relative = path.relative(root, file); return !relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative)); };
const failure = () => new Error('Desktop OAuth packaging refused. Check the protected source and external application staging directory.');

/** Explicit POSIX build-operator step; no environment discovery or default injection. */
export async function packageGoogleDesktopClient({ credentialFile, extensionDirectory }) {
  let source, target, createdPath;
  try {
    if (process.platform === 'win32') throw failure(); // Package on a POSIX build host; the resource is portable.
    if (!path.isAbsolute(credentialFile) || !path.isAbsolute(extensionDirectory)) throw failure();
    const [input, output, repo] = await Promise.all([fs.realpath(credentialFile), fs.realpath(extensionDirectory), fs.realpath(sourceRoot)]);
    if (within(repo, input) || within(repo, output) || within(output, input)) throw failure();
    if ((await fs.lstat(credentialFile)).isSymbolicLink() || (await fs.lstat(extensionDirectory)).isSymbolicLink()) throw failure();
    const manifest = JSON.parse(await fs.readFile(path.join(output, 'package.json'), 'utf8'));
    if (manifest.name !== 'hypeproof-chat' || manifest.publisher !== 'hypeproof' || path.basename(output) !== 'hypeproof-chat') throw failure();
    const outputStat = await fs.stat(output);
    if ((outputStat.mode & 0o022) || ![0, process.getuid()].includes(outputStat.uid)) throw failure();
    const parentStat = await fs.stat(path.dirname(input));
    if ((parentStat.mode & 0o077) || ![0, process.getuid()].includes(parentStat.uid)) throw failure();
    source = await fs.open(input, constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = await source.stat();
    if (!stat.isFile() || stat.size > 16384 || (stat.mode & 0o077) || ![0, process.getuid()].includes(stat.uid)) throw failure();
    const value = parseGoogleDesktopSource(await source.readFile('utf8'));
    const directory = path.join(output, 'oauth');
    await fs.mkdir(directory, { mode: 0o755 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
    const directoryStat = await fs.lstat(directory);
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink() || (directoryStat.mode & 0o022) || ![0, process.getuid()].includes(directoryStat.uid)) throw failure();
    const outputPath = path.join(directory, GOOGLE_DESKTOP_RESOURCE);
    target = await fs.open(outputPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o644);
    createdPath = outputPath;
    await target.writeFile(JSON.stringify(value) + '\n');
    await target.sync();
    return { packaged: true };
  } catch {
    await target?.close().catch(() => {}); target = undefined;
    if (createdPath) await fs.unlink(createdPath).catch(() => {});
    throw failure();
  }
  finally { await source?.close().catch(() => {}); await target?.close().catch(() => {}); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 4 || args[0] !== '--credential-file' || args[2] !== '--extension-dir') {
    process.stderr.write('Usage: node scripts/package-google-desktop-client.mjs --credential-file ABSOLUTE_PROTECTED_JSON --extension-dir ABSOLUTE_STAGED_EXTENSION\n');process.exitCode = 1;
  } else {
    try { await packageGoogleDesktopClient({ credentialFile: args[1], extensionDirectory: args[3] }); process.stdout.write('Desktop OAuth configuration packaged. No user tokens were included.\n'); }
    catch { process.stderr.write(failure().message + '\n'); process.exitCode = 1; }
  }
}
