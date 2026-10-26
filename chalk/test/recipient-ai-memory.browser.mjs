import { mkdirSync, writeFileSync } from 'node:fs';
import { recipientMemoryProbe } from '../../extensions/hypeproof-chat/test/lib/recipient-memory-probe.mjs';
// REQ-KNOW-33 / CGP-KNOW-R-018 — Chalk side, computed in headless Chromium (CDP) on the REAL pages served by the app.
// Every send-to-others step states the receiver AI's storage policy, and the line is SEEN, not only present:
//   C1 learner share confirmation (sharing.html, the page's own confirmOutbound)
//   C2 instructor distribution confirmation (manage.html, the page's own dry-run preview → "N명에게 보내기")
//   C3 instructor help feedback save (manage.html, the page's own openShare → "피드백 저장")
// The page scripts run against a stubbed fetch inside the page; nothing leaves the machine. Each line is checked with
// the shared visibility probe at 1420 and 390 px, dark and light, plus forced colours; negative controls then hide the
// line six ways (hidden attribute, display:none, visibility:hidden, zero size + clip, opacity 0, off-screen) and the
// probe must report every one. Without a browser this prints NOT RUN; FOCUS_REQUIRE_BROWSER=1 (CI) makes that a failure.
// Never opens a window or sends OS input.
import assert from 'node:assert/strict';
import '@hypeproof/service-testkit/test/harness/loader.mjs';
import { findChromium, launch } from '../../extensions/hypeproof-chat/test/lib/headless-chromium.mjs';
import { visibleTextProbe } from '../../extensions/hypeproof-chat/test/lib/visible-text.mjs';
const bin = findChromium();
if (!bin) {
  if (process.env.FOCUS_REQUIRE_BROWSER) { console.error('recipient-ai-memory.browser: no headless Chromium and FOCUS_REQUIRE_BROWSER=1'); process.exit(1); }
  console.log('  NOT RUN  recipient-ai-memory.browser (no headless Chromium)');
  process.exit(0);
}
const LINE = '받는 사람의 AI 기억: 확인 안 됨';
const SAFE = ['받는 사람의 AI가 기억하지 않아요', '받는 사람의 AI가 기억할 수 있어요'];
const { default: app } = await import('../src/index.ts');
// about:blank is not a secure context, so crypto.randomUUID is missing there; production serves https, where it exists.
const SECURE = `<script>if (!crypto.randomUUID) crypto.randomUUID = () => ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, (c) => (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16));</script>`;
const page = async (route) => (await (await app.fetch(new Request('https://chalk.test/' + route), { ENVIRONMENT: 'test' })).text()).replace('<head>', '<head>' + SECURE);
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// Brings the page to the send step through its own script. Returns the selector of the disclosure line.
const SCENES = {
  async share(b) {
    await b.evaluate(`(() => { window.fetch = async () => new Response(JSON.stringify({ shares: [] }), { headers: { 'content-type': 'application/json' } });
      document.getElementById('token').value = 'synthetic-token'; document.getElementById('login').requestSubmit(); return 0; })()`);
    await wait(150);
    await b.evaluate(`(() => { const v = (id, x) => { document.getElementById(id).value = x; };
      v('recipient', 'synthetic-teacher'); v('prompt', '버튼 고쳐 줘'); document.getElementById('consent').checked = true;
      window.__send = confirmOutbound('synthetic-teacher', { prompt: '버튼 고쳐 줘' }, document.getElementById('submit')); return 0; })()`);
    await wait(100);
    return { line: '#outbound-ai-memory', exact: true, order: ['#outbound-ai-memory', '#outbound-send'] };
  },
  async distribution(b) {
    await b.evaluate(`(() => {
      const json = (o) => new Response(JSON.stringify(o), { headers: { 'content-type': 'application/json' } });
      window.__posts = [];
      window.fetch = async (url, init = {}) => { if (init.method === 'POST') window.__posts.push([String(url), JSON.parse(init.body)]);
        if (String(url).endsWith('/distributions')) return json({ roster_revision: 1, content_hash: 'h1', revision: 1, expires_at: Date.now() + 3600e3,
          targets: [{ seat_id: 'S1', student_id: '학생1', expect: 'deliverable_now' }, { seat_id: 'S2', student_id: '학생2', expect: 'offline_until_reconnect' }] });
        return json({}); };
      token = 'synthetic-token'; cohort = 'c1';
      opsData = { run: { class_run_id: 'run-1', roster_revision: 1 }, seats: [{ seat_id: 'S1', student_id: '학생1' }, { seat_id: 'S2', student_id: '학생2' }] };
      picked.add('S1'); picked.add('S2');
      document.getElementById('ops-dist-kind').value = 'material'; document.getElementById('ops-dist-title').value = '오늘 자료'; document.getElementById('ops-dist-body').value = '본문';
      distObject = distFrom({ object_id: 'o1', revision: 1, content_hash: 'h1', kind: 'material', title: '오늘 자료', body: '본문', links: [] });
      // What an instructor sees once seats are chosen and the composer is open (the page sets these on selection).
      document.body.classList.add('has-selection');
      for (const id of ['ops', 'ops-bulk', 'ops-dist']) { const n = document.getElementById(id); n.hidden = false; if ('open' in n) n.open = true; }
      document.getElementById('ops-dist-preview').hidden = false;
      return 0; })()`);
    await b.evaluate(`document.getElementById('ops-dist-preview').onclick().then(() => 0)`);
    await wait(100);
    const state = await b.evaluate(`({ shown: !document.getElementById('ops-dist-confirm').hidden, go: document.getElementById('ops-dist-go').textContent, posts: window.__posts.map(([u, b]) => b.dry_run) })`);
    assert.equal(state.shown, true, 'the page script opened the distribution confirmation');
    assert.equal(state.go, '2명에게 보내기');
    assert.deepEqual(state.posts, [true], 'only the dry run was posted; nothing was sent');
    return { line: '#ops-dist-ai-memory', exact: true, order: ['#ops-dist-ai-memory', '#ops-dist-go'] };
  },
  async feedback(b) {
    await b.evaluate(`(() => {
      const json = (o) => new Response(JSON.stringify(o), { headers: { 'content-type': 'application/json' } });
      window.fetch = async () => json({ id: 'share-1', student_id: '학생1', session_id: 'sess-1', status: 'open', revision: 1, feedback: '', next_action: '',
        expires_at: Math.floor(Date.now() / 1000) + 3600, content: { question: '버튼이 안 눌려요' }, response: null });
      token = 'synthetic-token'; cohort = 'c1';
      return openShare('share-1').then(() => 0); })()`);
    await wait(100);
    assert.equal(await b.evaluate(`document.getElementById('detail').hidden`), false, 'the page script opened the share record');
    return { line: '#feedback-ai-memory', exact: false, order: ['#feedback-ai-memory', '#feedback button'] };
  },
};
const ROUTE = { share: 'sharing', distribution: 'manage', feedback: 'manage' };
const MUTATIONS = {
  'hidden attribute': `e.hidden = true`,
  'display:none': `e.style.display = 'none'`,
  'visibility:hidden': `e.style.visibility = 'hidden'`,
  'zero size + clip': `Object.assign(e.style, { position: 'absolute', width: '1px', height: '1px', overflow: 'hidden', clip: 'rect(0 0 0 0)' })`,
  'opacity 0': `e.style.opacity = '0'`,
  'off-screen': `Object.assign(e.style, { position: 'absolute', left: '-9999px' })`,
};

let checked = 0;
for (const [name, scene] of Object.entries(SCENES)) {
  for (const mode of [{ dark: true }, { dark: false }, { dark: true, forcedColors: true }]) {
    // Only the first document loaded into a headless target runs its scripts: one browser per scene and mode.
    const b = await launch(bin);
    try {
      await b.load(await page(ROUTE[name]), { width: 1420, height: 900, ...mode });
      const { line, exact, order } = await scene(b);
      for (const width of [1420, 390]) {
        await b.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
        await wait(60);
        const id = `${name} ${mode.forcedColors ? 'forced' : mode.dark ? 'dark' : 'light'} @${width}`;
        const found = await b.evaluate(visibleTextProbe(line));
        assert.equal(found.length, 1, `${id}: one disclosure element`);
        const text = found[0].text;
        assert.ok(exact ? text === LINE : text.split('\n').includes(LINE) || text.endsWith(LINE), `${id}: unknown policy shown — ${JSON.stringify(text)}`);
        for (const s of SAFE) assert.ok(!text.includes(s), `${id}: safe wording never shown`);
        assert.deepEqual(found[0].problems, [], `${id}: disclosure must be visible — ${found[0].problems.join('; ')}`);
        if (order) assert.equal(await b.evaluate(`!!(document.querySelector(${JSON.stringify(order[0])}).compareDocumentPosition(document.querySelector(${JSON.stringify(order[1])})) & Node.DOCUMENT_POSITION_FOLLOWING)`), true, `${id}: line comes before the send button`);
        assert.deepEqual(await b.evaluate(recipientMemoryProbe(line)), [[]], `${id}: visible neutral information icon`);
        if(process.env.RECIPIENT_MEMORY_ARTIFACT_DIR) {
          mkdirSync(process.env.RECIPIENT_MEMORY_ARTIFACT_DIR,{recursive:true});
          const shot=await b.send('Page.captureScreenshot',{format:'png'});
          writeFileSync(`${process.env.RECIPIENT_MEMORY_ARTIFACT_DIR}/chalk-${name}-${mode.forcedColors?'forced':mode.dark?'dark':'light'}-${width}.png`,Buffer.from(shot.data,'base64'));
        }
        checked++;
      }
      if (!mode.forcedColors && mode.dark) {
        // Negative controls: the probe must see each way of hiding the line.
        for (const [label, mutate] of Object.entries(MUTATIONS)) {
          const problems = await b.evaluate(`(() => { const e = document.querySelector(${JSON.stringify(line)}), before = e.getAttribute('style'), wasHidden = e.hidden;
            ${mutate}; const r = (${visibleTextProbe(line)})[0].problems;
            e.hidden = wasHidden; if (before === null) e.removeAttribute('style'); else e.setAttribute('style', before); return r; })()`);
          assert.ok(problems.length > 0, `${name}: probe missed "${label}"`);
        }
      }
    } finally { await b.close(); }
  }
}
console.log(`  ok   recipient-ai-memory.browser: ${checked} visible disclosure checks (learner share, distribution confirm, help feedback), 6 hiding controls each`);
