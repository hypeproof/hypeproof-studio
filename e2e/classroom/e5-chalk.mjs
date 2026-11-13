// Shared parts of the E5 (#3775–#3778) instructor browser checks: the REAL Chalk worker behind a local HTTP server, forwarding
// to the REAL Service router + SQLite from the Service testkit, and a Chromium page per instructor.
import { createServer } from 'node:http';
import { once } from 'node:events';
import { chromium } from '@playwright/test';
import { localOps, OPS_ALL } from './service-fixture.mjs';
import { signInChalk, withHeaderConnection } from '../../chalk/test/harness/connect.mjs';

export { OPS_ALL };

export async function e5Stack(options = {}) {
  const local = await localOps(options), chalk = withHeaderConnection((await import('../../chalk/src/index.ts')).default);
  const realFetch = globalThis.fetch;
  globalThis.fetch = (url, init) => String(url).startsWith('https://service.test') ? local.app.fetch(new Request(url, init), local.env, { waitUntil() {} }) : realFetch(url, init);
  const server = createServer(async (req, res) => {
    try {
      const parts = []; for await (const p of req) parts.push(p); const body = Buffer.concat(parts);
      const r = await chalk.fetch(new Request('http://localhost' + req.url, { method: req.method, headers: req.headers, ...(body.length ? { body } : {}) }), { ...local.env, HPS_SERVICE_ORIGIN: 'https://service.test' }, {});
      res.writeHead(r.status, Object.fromEntries(r.headers)); res.end(Buffer.from(await r.arrayBuffer()));
    } catch (e) { res.writeHead(500); res.end(String(e)); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const origin = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 1200 }, permissions: ['clipboard-read', 'clipboard-write'] });
  const errors = [];
  /** A fresh /manage tab connected as `token` (one Lab connection per tab). `ready` = the selector that proves the page settled. */
  async function instructor(token, ready = '#ops-state') {
    const page = await context.newPage(); page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(origin + '/manage'); await signInChalk(page, token);
    await page.locator('#cohort').fill(local.cohort); await page.locator('#prefix').fill('student-');
    await page.locator('#connect button').first().click(); await page.locator('#status').filter({ hasText: '연결됨' }).waitFor();
    await page.locator('#refresh').click(); await page.locator(ready).first().waitFor();
    return page;
  }
  const close = async () => { await browser.close(); server.close(); local.close(); globalThis.fetch = realFetch; };
  return { local, origin, browser, context, errors, instructor, close };
}

/** Wait until `fn()` holds, refreshing the page's board between tries (the board polls every 10 s; tests do not wait for that). */
export async function until(page, fn, what, tries = 40) {
  for (let i = 0; i < tries; i++) { if (await fn()) return; await page.locator('#refresh').click(); await page.waitForTimeout(150); }
  throw new Error('timed out: ' + what);
}
