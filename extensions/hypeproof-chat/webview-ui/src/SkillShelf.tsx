// CGP-AGENT-R-020 (Jay, 2026-11-14) — "이 수업의 스킬": the lesson's learner skill cards as a read-only shelf above the
// composer, collapsed by default. Each card shows its name and one-line summary and one "써 보기" button that puts the
// card's starter prompt into the draft through the same rule as a starter chip (a manual draft is kept) and never
// sends. There is no install, enable or source control: Studio never shows the coach's SKILL.md or Profile.skills.
// All text is React text, never HTML. 44px targets and the 14px caption floor come from tokens (styles.css).

import type { SkillCard } from "../../src/lessonSkillCards";

export const SKILL_SHELF_TITLE = "이 수업의 스킬";
export const SKILL_SHELF_HINT = "‘써 보기’를 누르면 입력창에 들어가요. 고쳐서 보내세요.";
export const SKILL_TRY_LABEL = "써 보기";

export function SkillShelf({ cards, onTry, disabled }: { cards: SkillCard[]; onTry: (prompt: string) => void; disabled?: boolean }) {
  if (!cards.length) return null;
  return (
    <details className="hps-skill-shelf" data-skill-cards={cards.length}>
      <summary className="hps-skill-shelf-summary">{SKILL_SHELF_TITLE} ({cards.length})</summary>
      <p className="hps-skill-shelf-hint">{SKILL_SHELF_HINT}</p>
      <ul className="hps-skill-shelf-list">
        {cards.map((card, i) => (
          <li key={i} className="hps-skill-card">
            <div className="hps-skill-card-text">
              <strong className="hps-skill-card-name">{card.name}</strong>
              <span className="hps-skill-card-summary">{card.summary}</span>
            </div>
            <button type="button" className="hps-skill-card-try" disabled={disabled} aria-label={`${SKILL_TRY_LABEL}: ${card.name}`} onClick={() => onTry(card.prompt)}>{SKILL_TRY_LABEL}</button>
          </li>
        ))}
      </ul>
    </details>
  );
}
