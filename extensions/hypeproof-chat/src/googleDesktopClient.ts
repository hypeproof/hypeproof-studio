import { constants } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { GOOGLE_DESKTOP_RESOURCE, parsePackagedGoogleDesktop } from './googleDesktopClientSchema.mjs';

/** Only the installed extension's resource can supply a release Desktop client. */
export async function loadPackagedGoogleDesktopClient(extensionDirectory: string, expectedClientId: string): Promise<string | undefined> {
  let file: fs.FileHandle | undefined;
  try {
    const root = await fs.realpath(extensionDirectory);
    const directory = path.join(root, 'oauth');
    const stat = await fs.lstat(directory).catch(error => { if (error.code === 'ENOENT') return undefined; throw error; });
    if (!stat) return undefined;
    if (!stat.isDirectory() || stat.isSymbolicLink() || (process.platform !== 'win32' && (stat.mode & 0o022))) throw new Error('Unsafe resource directory');
    const resource = path.join(directory, GOOGLE_DESKTOP_RESOURCE);
    const before = await fs.lstat(resource).catch(error => { if (error.code === 'ENOENT') return undefined; throw error; });
    if (!before) return undefined;
    if (!before.isFile() || before.isSymbolicLink()) throw new Error('Unsafe resource');
    file = await fs.open(resource, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const current = await file.stat();
    if (!current.isFile() || current.size > 8192 || before.ino !== current.ino || before.dev !== current.dev || (process.platform !== 'win32' && ((current.mode & 0o022) || ![0, process.getuid?.()].includes(current.uid)))) throw new Error('Unsafe resource');
    return parsePackagedGoogleDesktop(await file.readFile('utf8'), expectedClientId).clientSecret;
  } catch { throw new Error('Google 연결용 설치 설정을 확인하지 못했어요. 운영자에게 앱 설치를 확인해 달라고 요청해 주세요.'); }
  finally { await file?.close().catch(() => {}); }
}
