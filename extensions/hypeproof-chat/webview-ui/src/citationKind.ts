/** CGP-CHAT-R-014: use event metadata only; URL/domain/title never establish source kind. */
export function citationKindLabel(kind: unknown): string {
  switch (kind) {
    case 'web': return '웹';
    case 'lesson': return '수업 자료';
    case 'file': return '내 파일';
    default: return '출처';
  }
}
