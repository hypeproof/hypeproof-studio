import assert from 'node:assert/strict';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtemp } from 'node:fs/promises';
import test from 'node:test';

import { evaluateDuringElectronStartup, failLaunchAfterCleanup, readAcrossReload } from './app.ts';

const contextDestroyed = () => new Error(
  'electronApplication.evaluate: Execution context was destroyed, most likely because of a navigation.',
);

test('startup evaluation retries a transient context replacement then succeeds', async () => {
  let attempts = 0;
  const waits = [];
  const result = await evaluateDuringElectronStartup(
    async () => {
      attempts += 1;
      if (attempts < 3) throw contextDestroyed();
      return 'ready';
    },
    async delayMs => { waits.push(delayMs); },
  );

  assert.equal(result, 'ready');
  assert.equal(attempts, 3);
  assert.deepEqual(waits, [100, 200]);
});

test('startup evaluation stops after the bounded transient retry count', async () => {
  const persistent = contextDestroyed();
  let attempts = 0;
  const waits = [];

  await assert.rejects(
    evaluateDuringElectronStartup(
      async () => {
        attempts += 1;
        throw persistent;
      },
      async delayMs => { waits.push(delayMs); },
    ),
    error => error === persistent,
  );
  assert.equal(attempts, 4);
  assert.deepEqual(waits, [100, 200, 300]);
});

test('startup evaluation does not retry or mask an unexpected failure', async () => {
  const unexpected = new Error('Electron process exited during launch');
  let attempts = 0;
  const waits = [];

  await assert.rejects(
    evaluateDuringElectronStartup(
      async () => {
        attempts += 1;
        throw unexpected;
      },
      async delayMs => { waits.push(delayMs); },
    ),
    error => error === unexpected,
  );
  assert.equal(attempts, 1);
  assert.deepEqual(waits, []);
});

test('startup evaluation rejects a hung attempt on its fixture-owned deadline', async () => {
  const outcome = await Promise.race([
    evaluateDuringElectronStartup(() => new Promise(() => {}), undefined, 25).then(() => 'resolved', error => error),
    new Promise(resolve => setTimeout(() => resolve('still-pending'), 100)),
  ]);

  assert.notEqual(outcome, 'still-pending');
  assert(outcome instanceof Error);
  assert.match(outcome.message, /Electron startup evaluation did not settle within 25ms/);
});

test('startup evaluation accepts an ordinary operation slower than 75ms', async () => {
  const result = await evaluateDuringElectronStartup(
    () => new Promise(resolve => setTimeout(() => resolve('ready'), 100)),
  );
  assert.equal(result, 'ready');
});

test('failed launch closes the app, removes an owned profile, and preserves the app files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hps-launch-cleanup-'));
  const profile = join(root, 'owned-profile');
  const appFile = join(root, 'HypeProof Studio.app');
  mkdirSync(profile);
  writeFileSync(appFile, 'original app');
  let closes = 0;
  const primary = new Error('initialization failed');

  try {
    await assert.rejects(
      failLaunchAfterCleanup(primary, { close: async () => { closes += 1; } }, profile, true),
      error => error === primary,
    );
    assert.equal(closes, 1);
    assert.equal(existsSync(profile), false);
    assert.equal(existsSync(appFile), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('failed restart closes the app but preserves a reused profile', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hps-launch-reused-'));
  const profile = join(root, 'reused-profile');
  mkdirSync(profile);
  writeFileSync(join(profile, 'retained.txt'), 'keep');
  let closes = 0;
  const primary = new Error('restart initialization failed');

  try {
    await assert.rejects(
      failLaunchAfterCleanup(primary, { close: async () => { closes += 1; } }, profile, false),
      error => error === primary,
    );
    assert.equal(closes, 1);
    assert.equal(existsSync(join(profile, 'retained.txt')), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('an owned profile is preserved when close fails and exit is unconfirmed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hps-launch-close-failed-'));
  const profile = join(root, 'owned-profile');
  mkdirSync(profile);
  writeFileSync(join(profile, 'retained.txt'), 'keep while process state is unknown');
  const primary = new Error('initialization failed');
  const closeFailure = new Error('close failed');

  try {
    await assert.rejects(
      failLaunchAfterCleanup(primary, { close: async () => { throw closeFailure; } }, profile, true),
      error => error instanceof AggregateError
        && error.errors[0] === primary
        && error.errors[1] === closeFailure,
    );
    assert.equal(existsSync(join(profile, 'retained.txt')), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a hung close rejects on its fixture-owned deadline and preserves the profile', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hps-launch-close-hung-'));
  const profile = join(root, 'owned-profile');
  mkdirSync(profile);
  const primary = new Error('initialization failed');

  try {
    const outcome = await Promise.race([
      failLaunchAfterCleanup(primary, { close: async () => new Promise(() => {}) }, profile, true, undefined, 25)
        .then(() => 'resolved', error => error),
      new Promise(resolve => setTimeout(() => resolve('still-pending'), 100)),
    ]);
    assert.notEqual(outcome, 'still-pending');
    assert(outcome instanceof AggregateError);
    assert.equal(outcome.errors[0], primary);
    assert.match(outcome.errors[1].message, /Electron app close did not settle within 25ms/);
    assert.equal(existsSync(profile), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a confirmed close slower than 75ms still permits owned profile cleanup', async () => {
  const root = await mkdtemp(join(tmpdir(), 'hps-launch-close-slow-'));
  const profile = join(root, 'owned-profile');
  mkdirSync(profile);
  const primary = new Error('initialization failed');

  try {
    await assert.rejects(
      failLaunchAfterCleanup(
        primary,
        { close: async () => new Promise(resolve => setTimeout(resolve, 100)) },
        profile,
        true,
      ),
      error => error === primary,
    );
    assert.equal(existsSync(profile), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('profile removal failures stay visible alongside the primary launch failure', async () => {
  const primary = new Error('initialization failed');
  const removeFailure = new Error('remove failed');

  await assert.rejects(
    failLaunchAfterCleanup(
      primary,
      { close: async () => {} },
      '/fixture-owned-profile',
      true,
      () => { throw removeFailure; },
    ),
    error => {
      assert(error instanceof AggregateError);
      assert.deepEqual(error.errors, [primary, removeFailure]);
      assert.equal(error.cause, primary);
      assert.match(error.message, /initialization failed.*remove failed/);
      return true;
    },
  );
});

test('a workbench read inside a folder-switch reload is pending, then the real value', async () => {
  let reads = 0;
  const read = async () => {
    reads += 1;
    if (reads === 1) throw new Error('locator.evaluateAll: ' + contextDestroyed().message.split(': ')[1]);
    return 0;
  };
  assert.equal(await readAcrossReload(read, -1), -1);
  assert.equal(await readAcrossReload(read, -1), 0);
});

test('a workbench read keeps every other error', async () => {
  await assert.rejects(
    readAcrossReload(async () => { throw new Error('locator.evaluateAll: Target page, context or browser has been closed'); }, -1),
    /has been closed/,
  );
});
