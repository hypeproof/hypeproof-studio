/** Shared recovery signal; importing it must not load store/network dependencies. */
export class AutomationPublicationWithdrawnError extends Error {
  constructor() { super('이전에 철회한 게시 요청이에요. 내용을 다시 확인한 뒤 공유를 요청해 주세요.'); }
}
