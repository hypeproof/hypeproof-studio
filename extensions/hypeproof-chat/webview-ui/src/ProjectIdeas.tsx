import type { ProjectIdea } from "./projectIdeasModel";
import "./projectIdeas.css";

/**
 * CGP-SHELL-R-020 / DES-SHELL-19 — up to six example ideas after the learner said they have no idea
 * what to make. "이걸로 시작" only prepares an editable draft (never sends); "내가 정할래요" closes
 * the list and returns to the composer. "내가 정할래요" sits right after the list, at the newest end
 * of the conversation, so it is visible without scrolling.
 */
export function ProjectIdeas(props: {
  ideas: readonly ProjectIdea[];
  picked: string | null;
  disabled: boolean;
  onPick: (idea: ProjectIdea) => void;
  onOwn: () => void;
}) {
  return (
    <section className="hps-project-ideas" aria-label="만들어 볼 수 있는 예시" data-project-ideas="">
      <p className="hps-project-ideas-label">이런 걸 만들어 볼 수도 있어요</p>
      <p className="hps-project-ideas-help">고르면 입력창에 들어가요. 고친 뒤 직접 보내 주세요.</p>
      <ul className="hps-project-ideas-list">
        {props.ideas.map((idea) => (
          <li key={idea.id}>
            <button type="button" className="hps-project-idea" data-idea={idea.id} aria-pressed={props.picked === idea.id}
              disabled={props.disabled} onClick={() => props.onPick(idea)}>
              <span className="hps-project-idea-title">{idea.title}</span>
              <span className="hps-project-idea-use">이걸로 시작</span>
            </button>
          </li>
        ))}
      </ul>
      {/* After the list, next to the composer: the conversation follows its newest end, so this
          stays in view without scrolling even when the list is taller than the pane. */}
      <button type="button" className="hps-project-ideas-own" onClick={props.onOwn}>내가 정할래요</button>
    </section>
  );
}
