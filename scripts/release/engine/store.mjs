import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash, randomUUID} from 'node:crypto';
import {initialState, applyEvent} from './core.mjs';

export function inspectFile(filename) {
  const absolute = path.resolve(filename);
  const fd = fs.openSync(absolute, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size <= 0) throw new Error(`nonempty regular file required: ${absolute}`);
    const hash = createHash('sha256');
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let size = 0;
    for (let n; (n = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0;) {
      hash.update(buffer.subarray(0, n));
      size += n;
    }
    const after = fs.fstatSync(fd);
    if (size !== stat.size || stat.mtimeMs !== after.mtimeMs || stat.ctimeMs !== after.ctimeMs) throw new Error(`file changed while hashing: ${absolute}`);
    return {path: absolute, sha256: hash.digest('hex'), size};
  } finally { fs.closeSync(fd); }
}

export function checkFile(record) {
  if (!record || typeof record.path !== 'string' || !/^[a-f0-9]{64}$/.test(record.sha256) || !Number.isSafeInteger(record.size) || record.size <= 0) throw new Error('invalid file evidence');
  const actual = inspectFile(record.path);
  if (actual.sha256 !== record.sha256 || actual.size !== record.size) throw new Error(`file digest/size mismatch: ${record.path}`);
}

export function readState(directory) {
  try {
    const state = JSON.parse(fs.readFileSync(path.join(directory, 'ledger.json'), 'utf8'));
    if (state.schema !== 'hps-release-ledger/1' || !Number.isSafeInteger(state.revision)) throw new Error('invalid ledger schema');
    return state;
  } catch (error) {
    if (error.code === 'ENOENT') return initialState();
    throw error;
  }
}

function atomicWrite(filename, value) {
  const temporary = `${filename}.${randomUUID()}.tmp`;
  let fd;
  try {
    fd = fs.openSync(temporary, 'wx', 0o600);
    fs.writeFileSync(fd, JSON.stringify(value, null, 2) + '\n');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(temporary, filename);
    const directory = fs.openSync(path.dirname(filename), 'r');
    try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

function liveClaims(directory) {
  const claims = [];
  for (const filename of fs.readdirSync(directory).filter(name => /^writer-[a-f0-9-]+\.claim\.json$/.test(name))) {
    const location = path.join(directory, filename);
    let claim;
    try { claim = JSON.parse(fs.readFileSync(location, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') continue; throw new Error(`LEDGER_BUSY: unreadable claim ${location}`); }
    if (claim.hostname !== os.hostname() || !Number.isSafeInteger(claim.pid) || claim.pid <= 0 ||
      (claim.ticket !== null && (!Number.isSafeInteger(claim.ticket) || claim.ticket <= 0))) throw new Error(`LEDGER_BUSY: foreign or invalid claim ${location}`);
    let alive = true;
    try { process.kill(claim.pid, 0); }
    catch (error) { if (error.code === 'ESRCH') alive = false; else if (error.code !== 'EPERM') throw error; }
    if (!alive) {
      // Each process uses an unrepeatable filename. Concurrent recovery cannot unlink
      // a new owner's claim (the ABA race of deleting a shared writer.lock path).
      try { fs.unlinkSync(location); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    } else claims.push({...claim, filename});
  }
  return claims;
}

// Lamport-style bakery admission for one local filesystem. Publish a choosing claim,
// then a ticket, and enter only when no choosing/lower ticket remains. A later writer
// observes our ticket and cannot overtake us. Dead same-host PIDs are recoverable;
// live, unknown and foreign owners are never evicted by a clock or timeout.
export function transact(directory, operation) {
  fs.mkdirSync(directory, {recursive: true, mode: 0o700});
  const filename = `writer-${randomUUID()}.claim.json`;
  const location = path.join(directory, filename);
  const claim = {pid: process.pid, hostname: os.hostname(), ticket: null};
  atomicWrite(location, claim);
  try {
    claim.ticket = Math.max(0, ...liveClaims(directory).map(c => c.ticket ?? 0)) + 1;
    if (!Number.isSafeInteger(claim.ticket)) throw new Error('LEDGER_BUSY: ticket range exhausted');
    atomicWrite(location, claim);
    const ahead = liveClaims(directory).some(c => c.filename !== filename &&
      (c.ticket === null || c.ticket < claim.ticket || (c.ticket === claim.ticket && c.filename < filename)));
    if (ahead) throw new Error('LEDGER_BUSY: another local writer is choosing or owns the ledger; retry this event later');
    const state = readState(directory);
    const outcome = operation(state);
    if (outcome.state !== state) atomicWrite(path.join(directory, 'ledger.json'), outcome.state);
    return outcome.result;
  } finally {
    fs.unlinkSync(location);
  }
}

export function ingest(directory, event, policy, options = {}) {
  return transact(directory, state => applyEvent(state, event, policy, {checkFile, ...options}));
}

export {atomicWrite};
