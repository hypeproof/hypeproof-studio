/** A local label for finding a conversation again, never an extra model request. */
export interface TaskTitleMessage { role: string; content: string }

const MAX_TITLE_LENGTH = 48;
const MAX_INPUT_LENGTH = 12000;

function proseLines(content: string): string[] {
  return content.slice(0, MAX_INPUT_LENGTH).normalize('NFKC')
    .replace(/```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)/g, '')
    .split(/\r?\n/);
}

function plainText(line: string): string {
  return line.replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/[^\s<>]+/g, '')
    .replace(/<[^>]*>/g, '')
    .replace(/\*\*|__|`/g, '')
    .replace(/^[\s#>]+/, '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

function meaningfulTitle(line: string): string | null {
  const text = plainText(line).replace(/^[-*+]\s+/, '').replace(/^[*_](.*)[*_]$/, '$1').trim();
  const words = text.replace(/[.!?。！？…]+$/g, '').trim();
  if (!/[\p{L}]/u.test(words) || /^(?:안녕(?:하세요)?|반가워(?:요)?|네|예|아니요|좋아(?:요)?|오케이|도와줘|도와주세요|시작(?:해|하자|할게요)?|hi|hello|hey|ok(?:ay)?|yes|no|help(?: me)?)$/i.test(words)) return null;
  const points = Array.from(text);
  return points.length <= MAX_TITLE_LENGTH ? text : `${points.slice(0, MAX_TITLE_LENGTH - 1).join('').trimEnd()}…`;
}

function selectedNumber(content: string): number | null {
  const text = content.normalize('NFKC').trim();
  const match = text.match(/^(?:\((\d{1,2})\)|(\d{1,2}))(?:번)?(?:으로|로)?(?:\s*(?:할게요|해주세요|선택(?:할게요|합니다)?))?[.!]?$/);
  return match ? Number(match[1] ?? match[2]) : null;
}

function numberedOption(line: string): { number: number; label: string } | null {
  const match = plainText(line.normalize('NFKC')).match(/^(?:[-*+]\s+)?(?:\((\d{1,2})\)|(\d{1,2})[.)、:]|(\d{1,2})번[.)、:]?)\s*(.+)$/);
  return match ? { number: Number(match[1] ?? match[2] ?? match[3]), label: match[4].trim() } : null;
}

function selectedOption(messages: readonly TaskTitleMessage[], index: number, choice: { number: number; label?: string }): string | null {
  for (let previous = index - 1; previous >= 0; previous--) {
    const message = messages[previous];
    if (message.role === 'user') break;
    if (message.role !== 'assistant') continue;
    const options = new Map<number, string>();
    for (const line of proseLines(message.content)) {
      const option = numberedOption(line);
      if (!option) continue;
      if (options.has(option.number)) return null; // Two lists cannot identify one selected option reliably.
      options.set(option.number, option.label);
    }
    const label = options.get(choice.number);
    // Clickable replies carry the full numbered label. Require an exact match,
    // so an ordinary numbered request cannot be mistaken for a menu selection.
    return options.size >= 2 && label && (choice.label === undefined || choice.label === label) ? meaningfulTitle(label) : null;
  }
  return null;
}

/** Start the two-turn naming window at the first useful request, not introductory greetings. */
export function suggestTaskTitle(messages: readonly TaskTitleMessage[]): string | null {
  let title: string | null = null;
  let userTurns = 0;
  for (let index = 0; index < messages.length && userTurns < 2; index++) {
    const message = messages[index];
    if (message.role !== 'user') continue;
    const number = selectedNumber(message.content);
    const choice = number !== null ? { number } : numberedOption(message.content);
    const selected = choice ? selectedOption(messages, index, choice) : null;
    if (selected) title = selected;
    else if (number === null && !title) {
      for (const line of proseLines(message.content)) {
        title = meaningfulTitle(line);
        if (title) break;
      }
    }
    // Once a topic exists, only the following user turn may refine it.
    if (title) userTurns++;
  }
  return title;
}
