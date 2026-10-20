import { MarkdownText } from './MarkdownText';
import { CodeBlockScope } from './CodeBlock';
import type { ReplyChoices as Choices } from './replyChoiceParser';

export function ReplyChoices({ question, onPick, onWrite }: { question: Choices; onPick: (answer: string) => void; onWrite: () => void }) {
  return <div className="hps-reply-question">
    {/* CGP-CHAT-R-008: before/after are separate texts, so their code blocks get separate scopes. */}
    <CodeBlockScope id="q-before"><MarkdownText text={question.before} /></CodeBlockScope>
    {/* CGP-CHAT-R-007: choices and help are controls, never part of a quoted answer. */}
    <div className="hps-reply-choices" role="group" aria-label="답변 선택" data-quote-skip="">
      {question.options.map(option => <button type="button" key={option.number} onClick={() => onPick(`${option.number}. ${option.label}`)}>
        <span className="hps-choice-number" aria-hidden="true">{option.number}</span><span>{option.label}</span>
      </button>)}
    </div>
    <div className="hps-choice-help" data-quote-skip=""><span>선택하면 입력창에 들어갑니다.</span><button type="button" onClick={onWrite}>직접 입력</button></div>
    {question.after && <CodeBlockScope id="q-after"><MarkdownText text={question.after} /></CodeBlockScope>}
  </div>;
}
