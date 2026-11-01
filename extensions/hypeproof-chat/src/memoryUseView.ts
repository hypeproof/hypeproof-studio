// REQ-STUDIO-MEMORY-USE (CGP-KNOW-R-026 / REQ-KNOW-44) — the "기억 사용 N" chip as the webview sees it. Dependency-free,
// so both the host (memoryUse.ts) and the webview import it.

/**
 * One item an answer's request carried, resolved against the memory files now. `same`: the file still holds the words
 * that were sent; `changed`: it was edited since (today's words are shown); `gone`: it was deleted (no words are kept).
 */
export interface MemoryUseEntry { id: string; state: "same" | "changed" | "gone"; text: string | null; excluded: boolean }

export const MEMORY_USE_COPY = {
  chip: (n: number) => `기억 사용 ${n}`,
  listLabel: "이 답변에 쓴 기억",
  intro: "이 답변을 만들 때 AI에게 함께 보낸 기억이에요.",
  changed: "이 답변 뒤에 내용이 바뀌었어요. 지금 내용을 보여 드려요.",
  gone: "지운 기억이에요. 다음 요청부터는 보내지 않아요.",
  exclude: "이 작업에서 빼기",
  include: "다시 쓰기",
  excluded: "이 작업에서는 빼 두었어요. 다음 요청부터 보내지 않아요.",
  loading: "기억을 불러오는 중이에요…",
  failed: "기억을 불러오지 못했어요. 작업을 다시 열고 시도해 주세요.",
  /** CGP-KNOW-D-026 (DES-KNOW-44) — the chip opens the 작업 자료 shelf on this tab; the other tab keeps the sources. */
  tabSources: "출처",
  tabMemory: "기억",
  tabsLabel: "작업 자료 보기",
  chipHint: "이 답변에 쓴 기억을 작업 자료에서 보기",
} as const;
