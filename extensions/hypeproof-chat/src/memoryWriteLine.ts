// REQ-STUDIO-MEMORY-WRITE-LINE (CGP-KNOW-R-027 / REQ-KNOW-45, CGP-KNOW-D-027 / DES-KNOW-45) — the words and the label
// shape of the timeline line a memory write leaves in the turn that caused it. Dependency-free: the host writes the
// label, the webview and its tests only accept a label this module could have produced.

export const MEMORY_WRITE_ID_PREFIX = "memwrite-";

export const MEMORY_WRITE_COPY = {
  written: "기억에 남겼어요: ",
  undone: "되돌렸어요: ",
  restored: "이전 기억으로 되돌렸어요: ",
  undo: "되돌리기",
  expand: "전체 보기",
  collapse: "접기",
  /** The file changed after the write, or the write is no longer known: nothing is touched. */
  changed: "그 사이 기억 파일이 바뀌어서 되돌리지 않았어요. 기억 목록에서 직접 확인해 주세요.",
  unknown: "이 기억은 지금 되돌릴 수 없어요. 기억 목록에서 직접 지울 수 있어요.",
  failed: "기억을 되돌리지 못했어요. 기억 목록에서 확인해 주세요.",
} as const;

/** The longest item a line carries (characters); a longer item is cut with an ellipsis. The file keeps the whole item. */
export const MEMORY_WRITE_ITEM_MAX = 400;
const LABEL_MAX = 480;
// C0/C1 controls, bidi marks/embeddings/overrides/isolates, U+2028/2029, BOM, zero-width characters.
const UNSAFE = /[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u202a-\u202e\u2028\u2029\u2060-\u2069\ufeff]/gu;

/** An item as the line quotes it: one run of text, no control or direction characters, cut at the maximum. */
export function memoryWriteItem(raw: unknown): string {
  const flat = (typeof raw === "string" ? raw : "").replace(/\s+/gu, " ").replace(UNSAFE, "").trim();
  const chars = Array.from(flat);
  return chars.length > MEMORY_WRITE_ITEM_MAX ? `${chars.slice(0, MEMORY_WRITE_ITEM_MAX - 1).join("")}…` : flat;
}

export type MemoryWriteKind = "written" | "undone" | "restored";
const PREFIX: Record<MemoryWriteKind, string> = { written: MEMORY_WRITE_COPY.written, undone: MEMORY_WRITE_COPY.undone, restored: MEMORY_WRITE_COPY.restored };

export function memoryWriteLabel(kind: MemoryWriteKind, item: unknown): string {
  return `${PREFIX[kind]}${memoryWriteItem(item)}`;
}

export function isMemoryWriteId(id: unknown): id is string {
  return typeof id === "string" && id.startsWith(MEMORY_WRITE_ID_PREFIX) && id.length > MEMORY_WRITE_ID_PREFIX.length && id.length <= 80;
}

export interface MemoryWriteLineView { kind: MemoryWriteKind; item: string }

/** The parts of a stored line, or null when the label is not one this host wrote. */
export function memoryWriteLineView(label: unknown): MemoryWriteLineView | null {
  if (typeof label !== "string" || label.length > LABEL_MAX || new RegExp(UNSAFE.source, "u").test(label)) return null;
  for (const kind of ["written", "undone", "restored"] as const) {
    if (label.startsWith(PREFIX[kind]) && label.length > PREFIX[kind].length) return { kind, item: label.slice(PREFIX[kind].length) };
  }
  return null;
}
