/** REQ-KNOW-09: describe the immutable content of one outward action, never remembered consent. */
export const OUTBOUND_EXCLUDED = "포함하지 않는 것: AI 기억, 개인 메모";
/** `memory`: a memory-store file the learner selected by hand (REQ-KNOW-51). Without it a memory path refuses the dialog. */
export interface OutboundItem { name: string; bytes: number; memory?: true }
export interface OutboundSection { recipient: string; items: readonly OutboundItem[] }
/** `also`: a second send the same action makes to another recipient (e.g. the session record after a gallery publish). Each is its own block. */
/** `notes`: plain facts about where the content shows up that are not bytes the app sends (e.g. the server adds the learner's name). */
export interface OutboundManifest { recipient: string; items: readonly OutboundItem[]; public?: boolean; notes?: readonly string[]; also?: readonly OutboundSection[] }
export type OutboundConfirmation = (manifest: OutboundManifest) => Promise<boolean>;
export const contentBytes = (value: string): number => new TextEncoder().encode(value).byteLength;
/** Native dialogs and React text still need control/bidi isolation; never interpret names as markup. */
export function outboundLabel(value: string): string {
  return value.normalize("NFKC").replace(/[\u0000-\u001f\u007f-\u009f\u2028-\u202e\u2066-\u2069]/g, "�").slice(0, 500);
}
/** REQ-KNOW-51: what a learner-selected memory file says in the item list. */
export const MEMORY_SELECTED_LABEL = "AI 기억 파일 · 내가 직접 고름";
// A memory path is excluded by default: an item that names one without the learner's selection refuses the whole dialog.
const validSection = (s: OutboundSection) => !!s.recipient.trim() && s.items.length > 0 && s.items.length <= 500 && s.items.every(i => !!i.name.trim() && Number.isSafeInteger(i.bytes) && i.bytes >= 0 && (i.memory === true || !memoryOutboundPath(i.name)));
const itemLines = (items: readonly OutboundItem[]) => items.map(i => `• ${outboundLabel(i.name)} (${i.bytes.toLocaleString("ko-KR")} 바이트)${i.memory === true ? ` · ${MEMORY_SELECTED_LABEL}` : ""}`);
export function outboundDetails(manifest: OutboundManifest): string | null {
  const also = manifest.also ?? [];
  const notes = manifest.notes ?? [];
  if (!validSection(manifest) || also.length > 100 || !also.every(validSection) || notes.length > 5 || notes.some(t => !t.trim())) return null;
  return [
    `받는 곳: ${outboundLabel(manifest.recipient)}`, ...(manifest.public ? ["누구나 볼 수 있어요"] : []), ...notes.map(outboundLabel), "보낼 항목:", ...itemLines(manifest.items),
    ...also.flatMap(s => ["", `함께 보내는 것 — 받는 곳: ${outboundLabel(s.recipient)}`, ...itemLines(s.items)]),
    "", OUTBOUND_EXCLUDED,
  ].join("\n");
}
/** One line per recorded event the observation assessment would send: what it is and the size of exactly that JSON. */
export function observationOutboundItems(events: readonly unknown[]): OutboundItem[] {
  const label: Record<string, string> = { user: "내가 보낸 말", assistant: "AI의 답", tool_request: "AI가 요청한 도구 사용", correction: "내가 고친 것", student_text: "내가 쓴 글" };
  return events.map((e, i) => { const kind = typeof (e as { kind?: unknown })?.kind === "string" ? (e as { kind: string }).kind : ""; return { name: `기록 ${i + 1} · ${label[kind] ?? "작업 기록"}`, bytes: contentBytes(JSON.stringify(e)) }; });
}
const MEMORY_NAMES = ["wiki", "notes", "memory", "memories", "개인 메모", "ai 기억"];
const pathKey = (value: string) => value.replace(/\\/g, "/").normalize("NFKC").toLowerCase().replace(/^\/+|\/+$/g, "");
/**
 * REQ-KNOW-51: a file of an app-owned memory or note store (the team-brain wiki, the profile's configured wiki directory,
 * `memory/`, `.hypeproof/memory/`, personal notes). Excluded from every outbound payload unless the learner selects it.
 */
// Windows drops trailing dots and spaces from a name, so `wiki.` and `wiki ` open the wiki folder there; `./` is no folder.
const segmentKey = (segment: string) => segment.replace(/[. ]+$/, "");
const dirKey = (value: string) => pathKey(value).split("/").filter(p => p && p !== ".").map(segmentKey).join("/");
export function memoryOutboundPath(file: string, memoryDirectories: readonly string[] = []): boolean {
  const normalized = dirKey(file), parts = normalized.split("/");
  const configured = memoryDirectories.map(dirKey).filter(Boolean);
  return parts.some(p => MEMORY_NAMES.includes(p) || configured.includes(p)) || configured.some(dir => normalized === dir || normalized.startsWith(dir + "/"));
}
/** A dot file or dot directory anywhere on the path (after NFKC): never sent, and never selectable. */
export const dotOutboundPath = (file: string): boolean => pathKey(file).split("/").some(p => p.startsWith("."));
/** App-owned memory/note stores and dot paths are never silently included in whole-folder publication. */
export function privateOutboundPath(file: string, wikiDirectory = "wiki"): boolean {
  return dotOutboundPath(file) || memoryOutboundPath(file, [wikiDirectory]);
}
