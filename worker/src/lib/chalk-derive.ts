// #1469 (E3-3) — pure derive functions for runbook and handout.
// Both functions are deterministic: same opsHtml + opsSha256 → same output bytes.
import { parsePlan } from './chalk-plan/parser.ts';

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Extract inner HTML of a section by key.
function sectionHtml(html: string, key: string): string | null {
  const re = new RegExp(
    `<[^>]*data-chalk-section=["']${key}["'][^>]*>([\\s\\S]*?)</section>`,
    'i',
  );
  const m = re.exec(html);
  return m ? (m[1] ?? null) : null;
}

// Strip HTML comments and the section's own <h2> from a raw section body.
// The ops skeleton embeds authoring comments ("고정: …", "자율: …") and each
// section carries its own <h2> label — both must be absent from derived output.
function cleanSectionBody(body: string): string {
  return body
    .replace(/<!--[\s\S]*?-->/g, '')   // remove HTML comments
    .replace(/<h2[^>]*>[\s\S]*?<\/h2>/gi, '')  // remove section's own h2
    .trim();
}

// Strip HTML comments and tags from a parsed cell value (parsePlan cleanText does not strip HTML).
function cleanValue(s: string | null | undefined): string {
  if (!s) return '';
  return s.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

const STYLE = `
  body { font-family: sans-serif; max-width: 960px; margin: 2rem auto; padding: 0 1rem; }
  h1, h2 { margin-top: 1.5rem; }
  h2 { font-size: 1.1rem; border-bottom: 1px solid #ddd; padding-bottom: 0.25rem; }
  table { border-collapse: collapse; width: 100%; margin-bottom: 1rem; }
  th, td { border: 1px solid #ccc; padding: 0.4rem 0.6rem; text-align: left; vertical-align: top; }
  thead th { background: #f5f5f5; }
  td { white-space: pre-line; }
  .block-break { background: #fafafa; }
  .stale-warning { background: #fff3cd; border: 1px solid #ffc107; padding: 0.5rem; border-radius: 4px; margin-bottom: 1rem; }
  .schedule-wrap { overflow-x: auto; }
  .schedule-wrap table th:nth-child(1), .schedule-wrap table td:nth-child(1),
  .schedule-wrap table th:nth-child(7), .schedule-wrap table td:nth-child(7) { white-space: nowrap; }
`.trim();

// Extract human-readable course title from lesson HTML.
// Source: <section data-chalk-section="meta"> → <th>과목</th><td>TITLE</td>
// Returns "(강의 이름 미정)" when not found or empty.
export function extractCourseTitleFromLesson(lessonHtml: string): string {
  if (!lessonHtml) return '(강의 이름 미정)';
  const m = /과목<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/i.exec(lessonHtml);
  if (!m) return '(강의 이름 미정)';
  const title = cleanValue(m[1]);
  return title || '(강의 이름 미정)';
}

// ── Runbook (진행자 런북) ──────────────────────────────────────────────────────
// Includes all 8 sections. Schedule thead has 7 columns:
// 시작–끝 | 블록 | 메인 강사 할 일 | 학습자 할 일 | 보조·부모 할 일 | 의도 한 줄 | 연결 단계
export function deriveRunbook(opsHtml: string, opsSha256: string, courseTitle: string): string {
  const plan = parsePlan(opsHtml, 'ops');
  const { meta, blocks = [] } = plan;
  const course = courseTitle || meta.course || '';

  const clean = (key: string) => cleanSectionBody(sectionHtml(opsHtml, key) ?? '');
  const headerHtml = clean('header');
  const operationsHtml = clean('operations');
  const outcomesHtml = clean('outcomes');
  const materialsHtml = clean('materials');
  const risksHtml = clean('risks');
  const consentHtml = clean('consent');
  const postHtml = clean('post-deliverables');

  const assistantHeader = meta.familySession ? '부모 할 일' : '보조 할 일';

  const blockRows = blocks.map((b) => {
    const isBreak = b.kind === 'break';

    const activity = cleanValue(b.fields.activity);
    const asset = cleanValue(b.fields.asset);
    const artifact = cleanValue(b.fields.artifact);

    const blockContent = isBreak
      ? `쉬는 시간 (${b.durationMin ?? ''}분)`
      : [
          activity ? `활동: ${activity}` : '',
          asset ? `에셋: ${asset}` : '',
          artifact ? `산출물: ${artifact}` : '',
        ].filter(Boolean).join('\n');

    const facilitatorContent = isBreak ? '' : [
      cleanValue(b.fields.exitCriteria) ? `종료 기준: ${cleanValue(b.fields.exitCriteria)}` : '',
      cleanValue(b.fields.ifStuck) ? `막힐 때: ${cleanValue(b.fields.ifStuck)}` : '',
      cleanValue(b.fields.ifAhead) ? `빠를 때: ${cleanValue(b.fields.ifAhead)}` : '',
      cleanValue(b.fields.ifBehind) ? `느릴 때: ${cleanValue(b.fields.ifBehind)}` : '',
    ].filter(Boolean).join('\n');

    const assistantContent = meta.familySession
      ? cleanValue(b.roles.parent?.text)
      : cleanValue(b.roles.assistant);

    const cls = isBreak ? ' class="block-break"' : '';
    return `<tr${cls}>
      <td>${esc(b.start ?? '')}</td>
      <td>${esc(blockContent)}</td>
      <td>${esc(facilitatorContent)}</td>
      <td>${esc(cleanValue(b.roles.learner))}</td>
      <td>${esc(assistantContent)}</td>
      <td>${esc(cleanValue(b.fields.intent))}</td>
      <td>${esc(b.stepRefs.join(', '))}</td>
    </tr>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="ko" data-chalk-kind="runbook" data-chalk-derived-from="${esc(opsSha256)}">
<head><meta charset="utf-8"><title>런북 — ${esc(course)}</title><style>${STYLE}</style></head>
<body>
<h1>진행자 런북 — ${esc(course)}</h1>

<h2>운영 계획 개요</h2>
${headerHtml}

<h2>운영 방식</h2>
${operationsHtml}

<h2>최종 결과물</h2>
${outcomesHtml}

<h2>사전 준비물</h2>
${materialsHtml}

<h2>진행 큐시트</h2>
<div class="schedule-wrap">
<table>
<thead><tr><th>시작–끝</th><th>블록</th><th>메인 강사 할 일</th><th>학습자 할 일</th><th>${esc(assistantHeader)}</th><th>의도 한 줄</th><th>연결 단계</th></tr></thead>
<tbody>
${blockRows}
</tbody>
</table>
</div>

<h2>위험·문제 대응</h2>
${risksHtml}

<h2>동의</h2>
${consentHtml}

<h2>사후 정리</h2>
${postHtml}
</body>
</html>`;
}

// ── Handout (참가자 안내문) ────────────────────────────────────────────────────
// Allowlist: header, outcomes, break rows (no times), learner/parent columns,
// learner/parent materials, consent, post-deliverables.
// Forbidden: operations, facilitator col, exit-criteria/if-stuck/if-ahead/if-behind,
//            risks, instructor materials, block start times (시각).
export function deriveHandout(opsHtml: string, opsSha256: string, courseTitle: string): string {
  const plan = parsePlan(opsHtml, 'ops');
  const { meta, blocks = [] } = plan;
  const course = courseTitle || meta.course || '';

  const clean = (key: string) => cleanSectionBody(sectionHtml(opsHtml, key) ?? '');
  const headerHtml = clean('header');
  const outcomesHtml = clean('outcomes');
  const rawMaterialsHtml = clean('materials');
  const consentHtml = clean('consent');
  const postHtml = clean('post-deliverables');

  // Handout schedule: learner only for non-family; learner + parent for family.
  // "보조강사칸" is forbidden in handout (only parent is allowed for family sessions).
  const showParent = meta.familySession;

  // Schedule: learner/parent columns only; no start times, no facilitator, no intent.
  const scheduleRows = blocks
    .filter((b) => b.kind !== 'buffer')
    .map((b) => {
      const isBreak = b.kind === 'break';

      const blockLabel = isBreak
        ? `쉬는 시간 (${b.durationMin ?? ''}분)`
        : (cleanValue(b.fields.artifact) || cleanValue(b.fields.activity) || b.key);

      const parentContent = cleanValue(b.roles.parent?.text);

      const cls = isBreak ? ' class="block-break"' : '';
      return `<tr${cls}>
      <td>${esc(blockLabel)}</td>
      <td>${esc(cleanValue(b.roles.learner))}</td>
      ${showParent ? `<td>${esc(parentContent)}</td>` : ''}
    </tr>`;
    }).join('\n');

  const scheduleHeader = `<tr><th>활동 / 산출물</th><th>학습자 할 일</th>${showParent ? '<th>보호자 할 일</th>' : ''}</tr>`;

  // Materials: learner and parent only. Skip section if empty.
  const learnerMaterialsHtml = extractMaterialsByOwner(rawMaterialsHtml, ['learner', 'parent']);
  const materialsSection = learnerMaterialsHtml
    ? `\n<h2>준비물</h2>\n${learnerMaterialsHtml}` : '';
  // Consent: skip section if empty (no li items).
  const consentIsEmpty = !cleanValue(consentHtml);
  const consentSection = consentIsEmpty ? '' : `\n<h2>동의</h2>\n${consentHtml}`;

  return `<!DOCTYPE html>
<html lang="ko" data-chalk-kind="handout" data-chalk-derived-from="${esc(opsSha256)}">
<head><meta charset="utf-8"><title>참가자 안내문 — ${esc(course)}</title><style>${STYLE}</style></head>
<body>
<h1>참가자 안내문 — ${esc(course)}</h1>

<h2>수업 안내</h2>
${headerHtml}

<h2>최종 결과물</h2>
${outcomesHtml}

<h2>일정</h2>
<table>
<thead>${scheduleHeader}</thead>
<tbody>
${scheduleRows}
</tbody>
</table>
${materialsSection}
${consentSection}

<h2>사후 정리</h2>
${postHtml}
</body>
</html>`;
}

function extractMaterialsByOwner(materialsHtml: string, owners: string[]): string {
  if (!materialsHtml) return '';
  // Extract list items with matching data-owner attribute.
  const ownerPattern = owners.map((o) => esc(o)).join('|');
  const re = new RegExp(
    `<(?:li|tr)([^>]*data-owner=["'](?:${ownerPattern})["'][^>]*)>([\\s\\S]*?)<\\/(?:li|tr)>`,
    'gi',
  );
  const matches: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(materialsHtml)) !== null) {
    matches.push(`<li${m[1]}>${m[2]}</li>`);
  }
  if (matches.length === 0) return '';
  return `<ul>${matches.join('')}</ul>`;
}
