// Diff guard (orchestrator spec §6.2): what one save changed, and whether it
// stayed inside the 정보블록. The page is the homepage harness template
// (svc-harness homepage-sections.md); each edit plants the answer.
//
// Run: node --experimental-strip-types test/diff-guard.smoke.mjs

import assert from "node:assert/strict";

const { diffGuard, DIFF_SUMMARY_MAX, REWRITE_RATIO, INFO_BLOCK_START, INFO_BLOCK_END } = await import("../src/diffGuard.ts");

const page = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>망원 꽃방</title><style>
:root{--ink:#1d2433;--bg:#fff;--soft:#f2f5f8;--accent:#1f5fbf;--gap:clamp(16px,4vw,40px);--max:1040px}
*{box-sizing:border-box}
body{margin:0;font:16px/1.6 system-ui,sans-serif;color:var(--ink);background:var(--bg);word-break:keep-all;overflow-wrap:anywhere}
.sec{max-width:var(--max);margin:0 auto;padding:var(--gap)}
.price{width:100%;border-collapse:collapse}.price td{padding:10px 0}
.hours{display:grid;grid-template-columns:auto 1fr;gap:4px 16px;margin:0}
</style></head><body>
<nav aria-label="바로가기"><a href="#about">소개</a><a href="#menu">메뉴·가격</a><a href="#info">영업시간·위치</a><a href="#contact">문의</a></nav>
<main>
<header class="hero"><div class="sec"><p class="muted">꽃집 · 망원동</p><h1>망원 꽃방</h1><p>계절 꽃으로 만드는 작은 다발.</p></div></header>
<section id="about" class="sec"><h2>소개</h2><p>망원시장 골목의 작은 꽃집입니다. 그날 들어온 꽃으로 다발을 만듭니다.</p></section>
${INFO_BLOCK_START}
<section id="menu" class="sec"><h2>메뉴·가격</h2><table class="price"><tr><td>계절 다발</td><td>25,000원</td></tr><tr><td>화분</td><td>18,000원</td></tr></table></section>
<section id="info" class="sec grid"><div><h2>영업시간</h2><dl class="hours"><dt>월–금</dt><dd>10:00–19:00</dd><dt>토</dt><dd>10:00–17:00</dd><dt>일</dt><dd>휴무</dd></dl></div><div><h2>오시는 길</h2><address>서울시 마포구 예시로 12</address></div></section>
<section id="contact" class="sec"><h2>문의·예약</h2><p>전화 <a href="tel:0200000000">02-000-0000</a></p></section>
${INFO_BLOCK_END}
<aside class="sec notice"><h2>공지</h2><p>추석 연휴는 쉽니다.</p></aside>
<!-- 섹션 끝 -->
</main>
<footer class="sec muted"><small>망원 꽃방</small></footer>
</body></html>`;

const guard = (after, extra = {}) => diffGuard({ path: "index.html", before: extra.before ?? page, after, tool: extra.tool ?? "Edit", archivedPath: extra.archivedPath });
const hours = (html) => html.replace("<dt>토</dt><dd>10:00–17:00</dd>", "<dt>토</dt><dd>10:00–16:00</dd>");

// ─── Inside or outside the 정보블록 ──────────────────────────────────────────
{
  // Positive control: the learner's "토요일은 4시까지" — one value in the block.
  const r = guard(hours(page));
  assert.equal(r.verdict, "inside");
  assert.equal(r.inside_info_block, true);
  assert.deepEqual(r.touched_sections, ["#info"]);
  assert.ok(r.changed_ratio > 0 && r.changed_ratio < 0.05, `a one-value edit is a small share: ${r.changed_ratio}`);
  assert.match(r.summary, /정보블록 안만 바뀌었습니다\(#info/);

  // Negative control: the same kind of edit outside the block.
  const hero = guard(page.replace("계절 꽃으로 만드는 작은 다발.", "매일 아침 새로 들여온 꽃."));
  assert.deepEqual([hero.verdict, hero.inside_info_block, hero.outside_sections], ["partial", false, ["header.hero"]]);

  // One change inside and one outside is not inside.
  const both = guard(hours(page).replace("추석 연휴는 쉽니다.", "설 연휴는 쉽니다."));
  assert.deepEqual([both.inside_info_block, both.touched_sections, both.outside_sections], [false, ["#info", "aside.sec"], ["aside.sec"]]);

  // The markers are the boundary: an insertion just inside the end marker is
  // inside, just after it is not, and removing a marker is a change outside.
  const parking = '<section id="parking" class="sec"><h2>주차</h2><p>건물 뒤 2대</p></section>\n';
  assert.equal(guard(page.replace(INFO_BLOCK_END, parking + INFO_BLOCK_END)).inside_info_block, true, "inserted at the end of the block");
  assert.equal(guard(page.replace(INFO_BLOCK_END + "\n", INFO_BLOCK_END + "\n" + parking)).inside_info_block, false, "inserted after the block");
  assert.equal(guard(page.replace(INFO_BLOCK_START + "\n", parking + INFO_BLOCK_START + "\n")).inside_info_block, false, "inserted before the block");
  assert.equal(guard(page.replace(INFO_BLOCK_END + "\n", "")).inside_info_block, false, "the marker itself removed");
  const editPlusInsert = guard(hours(page).replace(INFO_BLOCK_END + "\n", INFO_BLOCK_END + "\n" + parking));
  assert.deepEqual([editPlusInsert.inside_info_block, editPlusInsert.outside_sections], [false, ["main"]], "an edit inside plus a section added outside");
  assert.deepEqual([guard(page).verdict, guard(page).inside_info_block], ["unchanged", null], "nothing changed: no inside claim");

  // A file without one well-formed block: no inside/outside claim at all.
  const noBlock = page.replace(INFO_BLOCK_START + "\n", "").replace(INFO_BLOCK_END + "\n", "");
  const nb = guard(hours(noBlock), { before: noBlock });
  assert.deepEqual([nb.inside_info_block, nb.verdict, nb.outside_sections], [null, "partial", ["#info"]]);
  const twoBlocks = page + INFO_BLOCK_START + INFO_BLOCK_END;
  assert.equal(guard(hours(twoBlocks), { before: twoBlocks }).inside_info_block, null, "two blocks: not well formed");
  console.log("✓ 정보블록 — a block-only edit is inside; outside, mixed, marker and missing-block edits are not");
}

// ─── How much changed ────────────────────────────────────────────────────────
{
  // A whole-file rewrite: the coach regenerated the page instead of editing it.
  const regenerated = `<!DOCTYPE html>
<html lang="ko">
<head>
  <meta charset="UTF-8">
  <title>망원 꽃방 | 계절 꽃다발</title>
  <style>
    body { font-family: sans-serif; margin: 0; color: #333; }
    .hero { background: linear-gradient(135deg, #ffd1dc, #fff0f5); padding: 64px 24px; text-align: center; }
    .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 16px; }
  </style>
</head>
<body>
  <header class="hero"><h1>망원 꽃방</h1><p>당신의 하루를 꽃으로</p></header>
  <section class="cards">
    <div class="card"><h3>계절 다발</h3><p>25,000원부터</p></div>
    <div class="card"><h3>영업시간</h3><p>평일 10시–19시, 토 10시–16시</p></div>
  </section>
  <footer>© 2026 망원 꽃방</footer>
</body>
</html>`;
  const archivedPath = ".hypeproof/history/index-20261014-153012.html";
  const w = guard(regenerated, { tool: "Write", archivedPath });
  assert.ok(w.changed_ratio > REWRITE_RATIO, `a whole-file rewrite changes more than half: ${w.changed_ratio}`);
  assert.equal(w.verdict, "rewrite");
  assert.match(w.summary, /부분 수정 요청이었다면 되돌리고 Edit 으로 고친 뒤 다시 확인하세요/);
  assert.ok(w.summary.endsWith(`이전 버전: ${archivedPath}`), "the archived copy is named so the coach can restore it");

  // Positive control for the ratio: adding a section loses nothing that existed.
  const added = guard(page.replace("<!-- 섹션 끝 -->", '<section id="gallery" class="sec"><h2>갤러리</h2></section>\n<!-- 섹션 끝 -->'));
  assert.deepEqual([added.changed_ratio, added.verdict, added.added_lines], [0, "partial", 1]);
  assert.match(added.summary, /기존 내용은 그대로 두고 새 줄 1개를 더했습니다/);

  // Formatting is not content: re-indenting changes nothing, and the same page
  // written on one line still diffs by tag (the edit stays inside the block).
  assert.equal(guard(page.replace(/\n/g, "\n    ")).verdict, "unchanged");
  const oneLine = page.replace(/\n/g, "");
  const ol = guard(hours(oneLine), { before: oneLine });
  assert.deepEqual([ol.verdict, ol.touched_sections], ["inside", ["#info"]]);
  assert.ok(ol.changed_ratio < 0.05, `one long line is not one big change: ${ol.changed_ratio}`);

  // A large page: a small edit stays exact; a rewrite is estimated and still a rewrite.
  const big = (tag) => page.replace("<!-- 섹션 끝 -->", Array.from({ length: 450 }, (_, i) =>
    `<section id="${tag}${i}" class="sec"><h2>${tag} ${i}</h2><p>내용 ${tag}${i}; 계속</p></section>`).join("\n") + "\n<!-- 섹션 끝 -->");
  const small = guard(hours(big("a")), { before: big("a") });
  assert.deepEqual([small.verdict, small.approximate], ["inside", false]);
  const rewritten = guard(big("b"), { before: big("a") });
  assert.equal(rewritten.approximate, true, "too large for the exact diff");
  assert.ok(rewritten.changed_ratio > REWRITE_RATIO && rewritten.verdict === "rewrite", `estimated rewrite: ${rewritten.changed_ratio}`);
  assert.match(rewritten.summary, /약 \d+%/, "an estimate says so");
  assert.ok(rewritten.touched_sections.length <= 20 && rewritten.touched_count > 400, "lists are capped, counts are not");
  console.log(`✓ ratio — rewrite ${w.changed_ratio} > ${REWRITE_RATIO}, added section 0, formatting unchanged, large files estimated`);
}

// ─── The summary fits the hook ───────────────────────────────────────────────
{
  const many = page.replace("<!-- 섹션 끝 -->", Array.from({ length: 40 }, (_, i) => `<section id="long-section-name-${i}-${"x".repeat(30)}" class="sec"><p>${i}</p></section>`).join("\n") + "\n<!-- 섹션 끝 -->");
  const archivedPath = ".hypeproof/history/index-20261014-153012.html";
  for (const [before, after] of [[many, many.replace(/<p>(\d+)<\/p>/g, "<p>$1!</p>")], [page, "x"], [page, page], ["", page]]) {
    const r = diffGuard({ path: "index.html", before, after, archivedPath });
    assert.ok(r.summary.length <= DIFF_SUMMARY_MAX, `summary is ${r.summary.length} characters`);
    if (r.verdict !== "unchanged") assert.ok(r.summary.endsWith(archivedPath), "the restore path survives the cut");
  }
  console.log(`✓ summary ≤ ${DIFF_SUMMARY_MAX} characters, the archived path kept whole`);
}
