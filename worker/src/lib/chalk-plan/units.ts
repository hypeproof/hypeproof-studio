// #1466 (E2-7) — planUnits: stable-key unit extraction for revision diff.
// Pure function: same input → same output. No side effects, no I/O.
// Delegates structural extraction to parsePlan so both paths share one spec.

import { parsePlan } from './index.ts';

export interface PlanUnit {
  /** Stable key for this unit (e.g. "meta:chalk:format", "flow/s-2:teacher"). */
  key: string;
  /** Normalized text: tags stripped, whitespace collapsed to single space. */
  text: string;
}

// Strip HTML tags and collapse whitespace.
function normalize(raw: string): string {
  return raw.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}


const LESSON_NAMED_SECTIONS = new Set([
  'meta', 'objectives', 'essential-question', 'evidence',
  'flow', 'key-questions', 'prohibited-moves', 'materials', 'safety', 'bridging', 'support',
]);

/**
 * Extract stable-key units from a plan HTML for diffing.
 * Structural extraction (flow steps, stucks, objectives, evidence,
 * key-questions, prohibited-moves) is delegated to parsePlan so that
 * planUnits and the check pipeline share one spec.
 */
export function planUnits(html: string, file: string): PlanUnit[] {
  const units: PlanUnit[] = [];

  // 1. head meta tags: meta:<name>
  const metaRe = /<meta\s[^>]*name="(chalk:[^"]*)"[^>]*content="([^"]*)"[^>]*/gi;
  let metaM: RegExpExecArray | null;
  while ((metaM = metaRe.exec(html)) !== null) {
    units.push({ key: `meta:${metaM[1] ?? ''}`, text: (metaM[2] ?? '').trim() });
  }

  // Delegate structural extraction to parsePlan (lesson only).
  // ops plans skip pedagogy content sections.
  if (file === 'lesson') {
    const parsed = parsePlan(html, 'lesson');

    // 2. flow steps — parser reads <th data-chalk-field="title"> and
    //    <td data-chalk-role="teacher|learner|assistant|parent">
    for (const step of parsed.steps) {
      if (step.title !== null) {
        units.push({ key: `flow/${step.id}:title`, text: step.title });
      }
      if (step.durationMin !== null) {
        units.push({ key: `flow/${step.id}:duration-min`, text: String(step.durationMin) });
      }
      if (step.cells.teacher !== undefined) {
        units.push({ key: `flow/${step.id}:teacher`, text: step.cells.teacher });
      }
      if (step.cells.assistant !== undefined) {
        units.push({ key: `flow/${step.id}:assistant`, text: step.cells.assistant });
      }
      if (step.cells.learner !== undefined) {
        units.push({ key: `flow/${step.id}:learner`, text: step.cells.learner });
      }
      if (step.cells.parent !== undefined) {
        units.push({ key: `flow/${step.id}:parent`, text: step.cells.parent.text });
      }
      if (step.requires.length > 0) {
        units.push({ key: `flow/${step.id}:requires`, text: step.requires.join(' ') });
      }
      if (step.forbids.length > 0) {
        units.push({ key: `flow/${step.id}:forbids`, text: step.forbids.join(' ') });
      }
    }

    // 3. support (stuck items) — parser reads <div data-chalk-stuck> fields
    for (const stuck of parsed.stucks) {
      if (stuck.expectedStuck !== null) {
        units.push({ key: `support/${stuck.id}:expected-stuck`, text: stuck.expectedStuck });
      }
      if (stuck.signal !== null) {
        units.push({ key: `support/${stuck.id}:signal`, text: stuck.signal });
      }
      if (stuck.minSupport !== null) {
        units.push({ key: `support/${stuck.id}:min-support`, text: stuck.minSupport });
      }
      if (stuck.expectedResponse !== null) {
        units.push({ key: `support/${stuck.id}:expected-response`, text: stuck.expectedResponse });
      }
    }

    // 4. objectives
    for (const obj of parsed.objectives) {
      const id = obj.id ?? `obj-${parsed.objectives.indexOf(obj) + 1}`;
      units.push({ key: `objectives/${id}`, text: obj.text });
    }

    // 5. evidence
    for (const ev of parsed.evidence) {
      const id = ev.id ?? `ev-${parsed.evidence.indexOf(ev) + 1}`;
      units.push({ key: `evidence/${id}`, text: ev.text });
    }

    // 6. prohibited-moves: <li data-chalk-move="Px" data-chalk-step="s-y">
    for (const pm of parsed.prohibitedMoves) {
      const stepPart = pm.stepId ? `/${pm.stepId}` : '';
      units.push({ key: `prohibited-moves/${pm.family}${stepPart}`, text: pm.text });
    }

    // 7. key-questions
    for (const kq of parsed.keyQuestions) {
      const idx = parsed.keyQuestions.indexOf(kq) + 1;
      units.push({ key: `key-questions/kq-${idx}`, text: kq.text });
    }

    // 8. essential-question
    if (parsed.essentialQuestion) {
      units.push({ key: 'essential-question', text: parsed.essentialQuestion });
    }

    // 9. safety
    if (parsed.safety !== null) {
      units.push({ key: 'safety', text: parsed.safety });
    }

    // 10. bridging opener
    if (parsed.bridgingOpener !== null) {
      units.push({ key: 'bridging', text: parsed.bridgingOpener });
    }
  } else {
    // ops: capture section text verbatim for any section present
    const sectionRe = /<section[^>]*data-chalk-section="([^"]*)"[^>]*>([\s\S]*?)<\/section>/gi;
    let sM: RegExpExecArray | null;
    while ((sM = sectionRe.exec(html)) !== null) {
      const sKey = sM[1] ?? '';
      units.push({ key: sKey, text: normalize(sM[2] ?? '') });
    }
  }

  // 11. all other named sections not handled above (lesson only): whole section text
  if (file === 'lesson') {
    const sectionRe = /<section[^>]*data-chalk-section="([^"]*)"[^>]*>([\s\S]*?)<\/section>/gi;
    let sM: RegExpExecArray | null;
    while ((sM = sectionRe.exec(html)) !== null) {
      const sKey = sM[1] ?? '';
      if (!LESSON_NAMED_SECTIONS.has(sKey)) {
        units.push({ key: sKey, text: normalize(sM[2] ?? '') });
      }
    }
  }

  return units;
}

export interface DiffChange {
  key: string;
  field?: string;
  kind: 'added' | 'removed' | 'changed';
  before: string | null;
  after: string | null;
  truncated?: true;
}

const TRUNC = 1000;

function truncate(s: string | null): { text: string | null; truncated?: true } {
  if (s === null) return { text: null };
  if (s.length <= TRUNC) return { text: s };
  return { text: s.slice(0, TRUNC), truncated: true };
}

/** Diff two snapshots from planUnits(). Returns changed units only. */
export function diffUnits(before: PlanUnit[], after: PlanUnit[]): DiffChange[] {
  const beforeMap = new Map(before.map(u => [u.key, u.text]));
  const afterMap = new Map(after.map(u => [u.key, u.text]));
  const changes: DiffChange[] = [];

  for (const [key, afterText] of afterMap) {
    const bText = beforeMap.get(key);
    if (bText === undefined) {
      const { text: a, truncated } = truncate(afterText);
      const c: DiffChange = { key, kind: 'added', before: null, after: a };
      if (truncated) c.truncated = true;
      changes.push(c);
    } else if (bText !== afterText) {
      const { text: b, truncated: tb } = truncate(bText);
      const { text: a, truncated: ta } = truncate(afterText);
      const c: DiffChange = { key, kind: 'changed', before: b, after: a };
      if (tb || ta) c.truncated = true;
      changes.push(c);
    }
  }
  for (const [key, bText] of beforeMap) {
    if (!afterMap.has(key)) {
      const { text: b, truncated } = truncate(bText);
      const c: DiffChange = { key, kind: 'removed', before: b, after: null };
      if (truncated) c.truncated = true;
      changes.push(c);
    }
  }

  return changes;
}
