import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { renderComponent } from './sx-render.mjs';
import { chatPanelProps, chatConfig } from './sx-screen-fixtures.mjs';
import { findChromium, launch } from './lib/headless-chromium.mjs';
const bin = findChromium();
if (!bin) { if (process.env.FOCUS_REQUIRE_BROWSER === '1') throw Error('Chromium required'); console.log('NOT RUN class window layout: no Chromium'); process.exit(0); }
const browser = await launch(bin);
const css = ['designTokens.css', 'tokens.css', 'styles.css', 'focusGeometry.css'].map(f => readFileSync(new URL('../webview-ui/src/' + f, import.meta.url), 'utf8')).join('\n');
const evidence = process.env.CLASS_WINDOW_EVIDENCE;
if (evidence) mkdirSync(evidence, { recursive: true });
try {
  for (const seat of ['classroom', 'personal']) {
    const config = chatConfig(3, { activity: { id: 'a', kind: seat, name: '내 작업', verified: true, workspace: '/w' }, classWindow: seat === 'classroom' ? { id: 'run', noticeId: 'layout-notice', startsAt: Date.now() - 3600000, endsAt: Date.now() + 599000 } : null });
    const markup = await renderComponent('ChatPanel', chatPanelProps({ config }));
    for (const width of [320, 800, 1420]) for (const dark of [false, true]) for (const forcedColors of [false, true]) {
      await browser.load(`<html><head><style>${css}</style></head><body class="${dark ? 'vscode-dark' : 'vscode-light'}" style="--vscode-foreground:${dark ? '#cccccc' : '#333333'};--vscode-sideBar-background:${dark ? '#1e1e1e' : '#f3f3f3'}"><div class="hps-shell" data-chat-detail="${seat}">${markup}</div></body></html>`, { width, dark, forcedColors });
      const m = await browser.evaluate(`(() => { const e = document.querySelector('.hps-class-window'); if (!e) return null; const s = getComputedStyle(e), r = e.getBoundingClientRect(), p = e.parentElement.getBoundingClientRect(); let bg = e; while (bg.parentElement && getComputedStyle(bg).backgroundColor === 'rgba(0, 0, 0, 0)') bg = bg.parentElement; return { background: getComputedStyle(bg).backgroundColor, text: e.textContent, font: parseFloat(s.fontSize), display: s.display, visibility: s.visibility, color: s.color, width:r.width, height:r.height, left:r.left, right:r.right, parentRight:p.right, scroll:e.scrollWidth, client:e.clientWidth, role:e.getAttribute('role'), afterHeader:e.previousElementSibling?.matches('.hps-header'), icon:e.querySelector(':scope > svg')?.getBoundingClientRect().width, iconColor:getComputedStyle(e.querySelector(':scope > svg')).color, warn:(()=>{const p=document.createElement('i');p.style.color='var(--hp-text-warn-default)';document.body.appendChild(p);const c=getComputedStyle(p).color;p.remove();return c})(), button:e.querySelector('button')?.getBoundingClientRect().height, label:e.querySelector('button')?.getAttribute('aria-label'), lines:(()=>{const range=document.createRange();range.selectNodeContents(e.querySelector('span'));return new Set([...range.getClientRects()].map(r=>r.top)).size})() }; })()`);
      const context = JSON.stringify({seat,width,dark,forcedColors,m});
      if (seat === 'personal') assert.equal(m, null, context);
      else {
        assert.ok(m, context); assert.match(m.text, /수업이 10분 뒤에 끝나요/); assert.equal(m.role, 'status');
        if(!forcedColors){assert.equal(m.iconColor,m.warn,'clock uses the amber warn token '+context);assert.notEqual(m.iconColor,m.color,'clock is amber, not text colour '+context);}
        assert.ok(m.font >= 14 && m.height > 0 && m.width > 0, context);
        assert.equal(m.afterHeader,true,context);assert.equal(m.icon,16,context);assert.ok(m.button>=44,context);assert.equal(m.label,'수업 종료 안내 닫기');assert.equal(m.lines,1,context);
        const ring=await browser.focusVisibleStyle('.hps-class-window button');assert.equal(ring['outline-width'],'2px');assert.equal(ring['outline-style'],'solid');
        assert.notEqual(m.display, 'none'); assert.equal(m.visibility, 'visible');
        assert.ok(m.scroll <= m.client + 1 && m.left >= 0 && m.right <= Math.min(width,m.parentRight) + 1, context);
        assert.notEqual(m.color, 'rgba(0, 0, 0, 0)', context);
        if (!forcedColors) {
          const lum = color => { const values = color.match(/[\d.]+/g).slice(0,3).map(Number).map(v => v/255).map(v => v <= .04045 ? v/12.92 : ((v+.055)/1.055)**2.4); return values[0]*.2126 + values[1]*.7152 + values[2]*.0722; };
          const a=lum(m.color), b=lum(m.background);
          assert.ok((Math.max(a,b)+.05)/(Math.min(a,b)+.05) >= 4.5, context);
        }
      }
      if (evidence && !forcedColors) {
        const shot = await browser.send('Page.captureScreenshot', { format: 'png' });
        writeFileSync(`${evidence}/${seat}-${width}-${dark ? 'dark' : 'light'}.png`, Buffer.from(shot.data,'base64'));
      }
    }
  }
  console.log('PASS actual ChatPanel class notice: personal/classroom × 320/800/1420 × light/dark × forced colors');
} finally { await browser.close(); }
