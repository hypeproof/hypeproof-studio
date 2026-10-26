// CGP-KNOW-R-003 (REQ-STUDIO-ACTIVITY-MATERIALS) — the activity's 자료 list as the webview receives
// it. Pure and dependency-free, so the host (activityMaterials.ts) and the webview import it.

/** Who put the item on the list. Only a recorded event decides it, never the model's words. */
export type MaterialOrigin = "learner" | "instructor" | "ai";
export const MATERIAL_ORIGIN_LABELS: Record<MaterialOrigin, string> = { learner: "나", instructor: "강사", ai: "AI" };

export interface MaterialItemView {
  /** `me:<id>` (learner), `inbox:<object_id>:<revision>` (instructor), `ai:<path>` (a file the AI wrote into 자료/). */
  id: string;
  kind: "file" | "url" | "note";
  title: string;
  /** Path under the work folder, the full address, or "강사가 보낸 글". */
  detail: string;
  origin: MaterialOrigin;
  originLabel: string;
  /** Recorded add/receipt/AI creation time in milliseconds; absent when not known. */
  addedAt?: number;
  /** Goes with the next message. */
  selected: boolean;
  /** The learner may take it off the list. Never for an instructor's item. */
  removable: boolean;
}

/** A selected item that cannot go with the next message now (gone from the list or unreadable). */
export interface MaterialUnavailableView {
  id: string;
  title: string;
  /** Why, in Korean, for the learner. */
  reason: string;
}

export interface MaterialsView {
  /** The task scope the list and its selection belong to. */
  scope: string;
  items: MaterialItemView[];
  /**
   * Selected items that cannot be sent now. They stay selected and are named above the composer
   * until the learner takes them out; while any is here the host holds the send.
   */
  unavailable?: MaterialUnavailableView[];
  /** How many items one message may carry. */
  maxSelected: number;
}

/** At most this many items go with one message. */
export const MATERIALS_MAX_SELECTED = 3;
/** At most this many learner items per activity. */
export const MATERIALS_MAX_ITEMS = 50;

/** #2641 — the webview reads a dropped file only under this size; the host checks the bytes again (FILE_ATTACH_MAX_BYTES). */
export const MATERIALS_DROP_MAX_BYTES = 100 * 1024;
export const MATERIALS_COPY = {
  note: "고른 자료만 다음 질문과 함께 AI에게 보내요. 고르지 않은 자료는 보내지 않아요.",
  instructorLocked: "강사가 보낸 자료는 목록에서 뺄 수 없어요.",
  /** CGP-KNOW-R-002: the activity home's 자료 view before the host answers, and when it answers with no list. */
  homeLoading: "자료 목록을 불러오는 중이에요.",
  homeUnavailable: "이 작업 폴더에서는 지금 자료 목록을 쓸 수 없어요.",
  tooManySelected: `한 번에 ${MATERIALS_MAX_SELECTED}개까지 넣을 수 있어요. 다른 자료를 먼저 빼 주세요.`,
  tooManyItems: `자료는 ${MATERIALS_MAX_ITEMS}개까지 둘 수 있어요. 쓰지 않는 자료를 먼저 빼 주세요.`,
  notRemovable: "강사가 보낸 자료는 뺄 수 없어요.",
  gone: "이 자료를 찾을 수 없어요. 목록을 다시 불러왔어요.",
  changed: "작업이나 폴더가 바뀌어서 고른 자료를 다시 확인해 주세요.",
  /** A selected file that is gone from 자료/ (deleted, renamed, or the folder itself is gone), or a withdrawn card. */
  goneReason: "찾을 수 없어요. 지워졌거나 이름이 바뀌었어요.",
  /** Above the composer while any selected item cannot be sent. */
  unavailableNote: "보낼 수 없는 자료가 있어요. 그 자료를 빼야 보낼 수 있어요. 빼면 그 자료 없이 보내요.",
  /** The send was held: nothing went, the draft is back in the composer. */
  held: (titles: string[]) => `보내지 않았어요. 고른 자료 중 보낼 수 없는 것이 있어요: ${titles.join(", ")}. '함께 보낼 자료'에서 빼기를 누른 뒤 다시 보내 주세요.`,
  /** The send was held because the selection was made on another task or folder; that selection is dropped. */
  heldChanged: (titles: string[]) => `보내지 않았어요. 다른 작업이나 폴더에서 고른 자료(${titles.join(", ")})는 여기서 보내지 않아요. 고른 것을 지웠으니 다시 보내 주세요.`,
  retryNotice: "고른 자료는 다시 보내지 않았어요. 필요하면 다시 골라 주세요.",
  skipped: (titles: string[]) => `보내지 못한 자료: ${titles.join(", ")}. 목록에서 없어졌거나 읽을 수 없어요.`,
  added: (title: string) => `자료에 넣었어요: ${title}`,
  removed: (title: string) => `목록에서 뺐어요: ${title}. 파일은 작업 폴더에 그대로 있어요.`,
  removedUrl: (title: string) => `목록에서 뺐어요: ${title}`,
  /** #2641 — several files dropped at once: none is added. */
  dropOne: "파일은 한 번에 하나씩 놓아 주세요.",
} as const;
