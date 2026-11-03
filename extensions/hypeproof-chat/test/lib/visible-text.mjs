// In-page probe: is a line of text actually SEEN, not just present in the DOM? Run it with the headless helper's
// evaluate() (test/lib/headless-chromium.mjs). Shared by the extension smokes and the Chalk browser tests.
// For every element matching `selector` it returns { text, problems[] }; an empty problems list means visible.
// Caught: a `hidden` attribute on the element or an ancestor, display:none, visibility other than visible,
// opacity (the product along the ancestor chain), zero or collapsed size, clip / clip-path, an overflow-clipping
// ancestor that cuts the line, off-screen positioning or transforms, another element painted over it,
// transparent text, text below `minFont` px, and contrast under 4.5:1 against the composited background
// (skipped in forced-colours mode, where the system palette decides).
export const visibleTextProbe = (selector, { minFont = 12 } = {}) => `(() => {
  const SEL = ${JSON.stringify(selector)}, MIN_FONT = ${Number(minFont)};
  const rgba = (c) => { const m = (c.match(/[\\d.]+/g) || []).map(Number); return m.length >= 3 ? [m[0], m[1], m[2], m.length > 3 ? m[3] : 1] : [0, 0, 0, 0]; };
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  const over = (top, under) => { const a = top[3]; return [0, 1, 2].map((i) => top[i] * a + under[i] * (1 - a)).concat(1); };
  const forced = matchMedia('(forced-colors: active)').matches;
  const backdrop = (e) => {
    const layers = [];
    for (let n = e; n && n.nodeType === 1; n = n.parentElement) { const c = rgba(getComputedStyle(n).backgroundColor); if (c[3] > 0) { layers.push(c); if (c[3] >= 1) break; } }
    let base = [255, 255, 255, 1];
    for (const l of layers.reverse()) base = over(l, base);
    return base;
  };
  return [...document.querySelectorAll(SEL)].map((e) => {
    const problems = [], s = getComputedStyle(e);
    const hiddenBy = e.closest('[hidden]');
    if (hiddenBy) problems.push('hidden attribute on ' + hiddenBy.tagName + (hiddenBy.id ? '#' + hiddenBy.id : ''));
    let opacity = 1;
    for (let n = e; n && n.nodeType === 1; n = n.parentElement) {
      const c = getComputedStyle(n), name = n.tagName + (n.id ? '#' + n.id : '');
      if (c.display === 'none') problems.push('display:none on ' + name);
      if (c.clipPath && c.clipPath !== 'none') problems.push('clip-path on ' + name);
      if (c.clip && c.clip !== 'auto') problems.push('clip on ' + name);
      opacity *= Number(c.opacity);
    }
    if (opacity < 0.9) problems.push('opacity ' + opacity.toFixed(2));
    if (s.visibility !== 'visible') problems.push('visibility:' + s.visibility);
    if (e.checkVisibility && !e.checkVisibility({ opacityProperty: true, visibilityProperty: true, contentVisibilityAuto: true })) problems.push('checkVisibility() false');
    const font = parseFloat(s.fontSize);
    if (!(font >= MIN_FONT)) problems.push('font ' + font + 'px < ' + MIN_FONT);
    e.scrollIntoView({ block: 'center', inline: 'nearest' });
    const r = e.getBoundingClientRect();
    if (r.width < 20 || r.height < Math.max(font, 1) * 0.8) problems.push('collapsed box ' + Math.round(r.width) + 'x' + Math.round(r.height));
    if (e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1) problems.push('text overflows its own box');
    for (let n = e.parentElement; n && n !== document.documentElement; n = n.parentElement) {
      const c = getComputedStyle(n);
      if (c.overflowX === 'visible' && c.overflowY === 'visible') continue;
      const b = n.getBoundingClientRect();
      if (r.left < b.left - 1 || r.right > b.right + 1 || r.top < b.top - 1 || r.bottom > b.bottom + 1) { problems.push('cut by overflow of ' + n.tagName + (n.id ? '#' + n.id : '')); break; }
    }
    if (r.left < -1 || r.top < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1) problems.push('off-screen at ' + Math.round(r.left) + ',' + Math.round(r.top));
    const range = document.createRange(); range.selectNodeContents(e);
    const first = [...range.getClientRects()].find((q) => q.width > 0 && q.height > 0);
    if (!first) problems.push('no painted text box');
    else {
      const hit = document.elementFromPoint(first.left + Math.min(first.width / 2, 8), first.top + first.height / 2);
      if (!hit || !(hit === e || e.contains(hit))) problems.push('covered by ' + (hit ? hit.tagName + (hit.id ? '#' + hit.id : '') + '.' + hit.className : 'nothing (outside the viewport)'));
    }
    const fg = rgba(s.color);
    if (fg[3] === 0) problems.push('transparent text');
    else if (!forced) {
      const bg = backdrop(e), text = over(fg, bg), [a, b] = [lum(text), lum(bg)].sort((x, y) => y - x), ratio = (a + 0.05) / (b + 0.05);
      if (ratio < 4.5) problems.push('contrast ' + ratio.toFixed(2) + ':1 (' + s.color + ' on rgb(' + bg.slice(0, 3).map(Math.round).join(',') + '))');
    }
    return { text: e.textContent.trim(), problems };
  });
})()`;
