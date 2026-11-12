// Headless Chromium over CDP, for smokes that must read computed styles (the cascade), not
// declarations. Never opens a window and never touches the desktop: chrome-headless-shell only,
// a throwaway profile, pseudo-classes forced through the DevTools protocol (no synthetic input).
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

export function findChromium() {
  for (const env of [process.env.HEADLESS_CHROMIUM, process.env.CHROME_PATH]) if (env && existsSync(env)) return env;
  const roots = [join(homedir(), 'Library/Caches/ms-playwright'), join(homedir(), '.cache/ms-playwright')];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    const dirs = readdirSync(root).filter((d) => d.startsWith('chromium_headless_shell-')).sort().reverse();
    for (const d of dirs) {
      try {
        const out = execFileSync('find', [join(root, d), '-name', 'chrome-headless-shell', '-type', 'f'], { encoding: 'utf8' }).trim().split('\n')[0];
        if (out) return out;
      } catch { /* try the next one */ }
    }
  }
  // CI runners (ubuntu-latest) ship Google Chrome on PATH; `--headless=new` is applied by launch().
  for (const name of ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser']) {
    for (const dir of (process.env.PATH ?? '').split(delimiter)) {
      const candidate = join(dir, name);
      if (dir && existsSync(candidate)) return candidate;
    }
  }
  return null;
}

// A cold Chrome start on a busy CI runner can take longer than a warm local one: wait up to
// 30 s, then retry once with a fresh profile before failing.
export async function launch(bin, attempt = 1) {
  const profile = mkdtempSync(join(tmpdir(), 'hp-headless-'));
  // A full Chrome/Chromium needs --headless=new; chrome-headless-shell is headless already.
  const headless = /chrome-headless-shell$/.test(bin) ? [] : ['--headless=new'];
  const child = spawn(bin, [...headless, '--remote-debugging-port=0', '--no-sandbox', '--disable-gpu', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
  let port = 0;
  for (let i = 0; i < 300 && !port; i++) {
    await new Promise((r) => setTimeout(r, 100));
    try { port = Number(readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0]); } catch { /* not yet */ }
  }
  if (!port) {
    child.kill();
    if (attempt < 2) return launch(bin, attempt + 1);
    throw new Error('headless Chromium did not start');
  }
  const tabs = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const ws = new WebSocket(tabs.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0;
  const pending = new Map();
  const listeners = new Set();
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.method) for (const fn of [...listeners]) fn(m);
    if (m.id && pending.has(m.id)) { const [res, rej] = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); }
  };
  // `sessionId` addresses an attached target (an out-of-process iframe); omit it for the page itself.
  const send = (method, params = {}, sessionId) => new Promise((res, rej) => { const i = ++id; pending.set(i, [res, rej]); ws.send(JSON.stringify({ id: i, method, params, ...(sessionId ? { sessionId } : {}) })); });
  // Resolves with the first protocol event for which `match` is true; rejects after `ms`.
  const waitForEvent = (match, what, ms = 15000) => new Promise((res, rej) => {
    const t = setTimeout(() => { listeners.delete(fn); rej(new Error(`timed out after ${ms} ms waiting for ${what}`)); }, ms);
    const fn = (m) => { if (match(m)) { clearTimeout(t); listeners.delete(fn); res(m); } };
    listeners.add(fn);
  });
  await send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
  await send('Page.enable'); await send('DOM.enable'); await send('CSS.enable'); await send('Runtime.enable');
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'evaluate failed');
    return r.result.value;
  };
  return {
    send, evaluate, waitForEvent,
    // One document at a time. `forcedColors` and `dark` are media emulation, not class names.
    async load(html, { width = 1420, height = 800, forcedColors = false, dark = true } = {}) {
      await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
      await send('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: forcedColors ? 'active' : 'none' }, { name: 'prefers-color-scheme', value: dark ? 'dark' : 'light' }] });
      const { frameTree } = await send('Page.getFrameTree');
      await send('Page.setDocumentContent', { frameId: frameTree.frame.id, html });
      await new Promise((r) => setTimeout(r, 50));
    },
    // Matches `selector` and forces :focus-visible on the first hit, then reads computed styles.
    async focusVisibleStyle(selector, props = ['outline-width', 'outline-style', 'outline-color', 'outline-offset'], states = [], focus = true) {
      const { root } = await send('DOM.getDocument', { depth: 0 });
      const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector });
      if (!nodeId) throw new Error(`no element for ${selector}`);
      await send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [...(focus ? ['focus-visible'] : []), ...states] });
      const { object } = await send('DOM.resolveNode', { nodeId });
      const r = await send('Runtime.callFunctionOn', {
        objectId: object.objectId, returnByValue: true,
        functionDeclaration: `function (props) { const s = getComputedStyle(this); const o = {}; for (const p of props) o[p] = p === 'descendant-colors' ? [...this.querySelectorAll('*')].map(e => getComputedStyle(e).color) : s.getPropertyValue(p); return o; }`,
        arguments: [{ value: props }],
      });
      await send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [] });
      return r.result.value;
    },
    async close() {
      try { ws.close(); } catch { /* gone */ }
      const exited = new Promise((r) => child.once('exit', r));
      child.kill();
      await Promise.race([exited, new Promise((r) => setTimeout(r, 3000))]);
      try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); } catch { /* temp dir, the OS clears it */ }
    },
  };
}
