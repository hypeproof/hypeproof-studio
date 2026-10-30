// CGP-KNOW-D-011 (DES-KNOW-20) — the 내 작품 drawer's pure rules, shared by MyWorksDrawer.tsx and its tests.

export type WorksLayout = 'list' | 'grid';
/** At this window width and below the drawer is the list only (DES-KNOW-20 "at 320px list only"; the rail's own fold point). */
export const WORKS_LIST_ONLY_MAX = 360;
export const worksLayout = (choice: WorksLayout, viewport: number): WorksLayout => viewport <= WORKS_LIST_ONLY_MAX ? 'list' : choice;

export const IMAGE_FILE = /\.(png|jpe?g|gif|webp)$/i;
const PAGE = /\.html?$/i;
const CODE = /\.(m?[jt]sx?|css|json|py|sh|c|cpp|h|java|rb|go|rs)$/i;
/** The type glyph for a file without a thumbnail. Shape, not colour, tells the kinds apart. */
export function worksGlyph(path: string): 'image' | 'globe' | 'code' | 'file' {
  return IMAGE_FILE.test(path) ? 'image' : PAGE.test(path) ? 'globe' : CODE.test(path) ? 'code' : 'file';
}
/** "sub/dir/name.png" → name "name.png", folder "sub/dir". */
export function worksName(path: string): { name: string; folder: string } {
  const cut = path.lastIndexOf('/');
  return cut < 0 ? { name: path, folder: '' } : { name: path.slice(cut + 1), folder: path.slice(0, cut) };
}
/** Only an inline raster image is ever rendered; anything else (a URL, SVG, a script) keeps the glyph. */
export function thumbnailSrc(value: unknown): string | null {
  return typeof value === 'string' && value.length <= 1024 * 1024 && /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+=*$/.test(value) ? value : null;
}

/** Match only paths already present in the provenance inventory, preserving its order and objects. */
export function filterWorks<T extends { path: string }>(entries: readonly T[], query: string): readonly T[] {
  const fold = (text: string) => text.normalize('NFC').toLocaleLowerCase('ko-KR');
  const needle = fold(query.trim());
  return needle ? entries.filter(entry => fold(entry.path).includes(needle)) : entries;
}
