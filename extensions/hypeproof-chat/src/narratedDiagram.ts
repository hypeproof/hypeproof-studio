// CGP-LEARN-R-009 / D-009 — narrated diagrams: Studio's own built-in drawings, narrated in three instructor beats.
//
// The lesson names a drawing (`diagram`, an enum the Service pins) and writes three beats; it never carries geometry,
// colours, SVG or HTML. Everything drawn here is this file: boxes, arrows, colour ROLES (resolved to tokens by CSS) and
// marker positions on a 640x400 artboard. Only the shapes scale with the rail; every word is HTML at 14 px or more
// (decisions/CGP-LEARN-R-009.md: a 640 px artboard in a 280 px rail would draw SVG text at about 6 px). The node labels
// are a separate, localisable table keyed by node id, drawn as a legend under the art with the same letters as the boxes.
// Pure and DOM-free, so the webview and the Node tests share it.

export type ColorRole = "text" | "muted" | "accent" | "line" | "surface";
export const COLOR_ROLES: readonly ColorRole[] = ["text", "muted", "accent", "line", "surface"];

export interface DiagramNode { id: string; letter: string; x: number; y: number; w: number; h: number }
export interface DiagramArrow { id: string; from: [number, number]; to: [number, number] }
/** One beat's drawing state: which parts are emphasised (accent) and where its numbered marker sits. */
export interface BeatState { emphasis: readonly string[]; marker: [number, number] }
export interface DiagramDef { nodes: readonly DiagramNode[]; arrows: readonly DiagramArrow[]; beats: readonly [BeatState, BeatState, BeatState] }

export const ARTBOARD = { width: 640, height: 400 } as const;
/** DES-CGP-LEARN-09: the reserved control area (이전 / 다음), outside the art. */
export const CONTROL_AREA = { width: 120, height: 120 } as const;
export const MARKER_RADIUS = 28;
/** The box letters, in artboard units: 40 x (240 / 640) = 15 px in the narrowest rail content (~240 px). */
export const LETTER_UNITS = 40;

export type DiagramId = "page_request" | "html_to_page";
export const DIAGRAM_IDS: readonly DiagramId[] = ["page_request", "html_to_page"];

export const DIAGRAMS: Readonly<Record<DiagramId, DiagramDef>> = {
  // 웹 페이지가 열리는 과정: the browser asks, the server finds the file, the page comes back.
  page_request: {
    nodes: [
      { id: "browser", letter: "A", x: 40, y: 140, w: 180, h: 120 },
      { id: "server", letter: "B", x: 420, y: 140, w: 180, h: 120 },
    ],
    arrows: [
      { id: "request", from: [220, 170], to: [420, 170] },
      { id: "response", from: [420, 230], to: [220, 230] },
    ],
    beats: [
      { emphasis: ["browser", "request"], marker: [320, 130] },
      { emphasis: ["server"], marker: [510, 110] },
      { emphasis: ["response", "browser"], marker: [320, 270] },
    ],
  },
  // HTML이 화면이 되기까지: code is read by the browser and drawn as a page.
  html_to_page: {
    nodes: [
      { id: "code", letter: "A", x: 24, y: 140, w: 160, h: 120 },
      { id: "browser", letter: "B", x: 240, y: 140, w: 160, h: 120 },
      { id: "page", letter: "C", x: 456, y: 140, w: 160, h: 120 },
    ],
    arrows: [
      { id: "read", from: [184, 200], to: [240, 200] },
      { id: "draw", from: [400, 200], to: [456, 200] },
    ],
    beats: [
      { emphasis: ["code"], marker: [104, 110] },
      { emphasis: ["read", "browser"], marker: [320, 110] },
      { emphasis: ["draw", "page"], marker: [536, 110] },
    ],
  },
};

/** The localisable text layer: the diagram's name and each node's label, keyed by node id. Never inside the geometry. */
export const DIAGRAM_TEXT: Readonly<Record<DiagramId, { name: string; nodes: Readonly<Record<string, string>> }>> = {
  page_request: { name: "웹 페이지가 열리는 과정", nodes: { browser: "브라우저", server: "서버" } },
  html_to_page: { name: "HTML이 화면이 되기까지", nodes: { code: "HTML 코드", browser: "브라우저", page: "화면" } },
};

/** The three beats' fixed roles, in order (REQ-CGP-LEARN-09 (a)). */
export const BEAT_ROLES = ["시작", "변화", "결과"] as const;

/**
 * "2 / 3 장면 · 변화": the position in the instructor's three beats, in the "N / M 장면" shape the SX audit allows as a
 * position (never a bare "2 / 3", which reads as a score).
 */
export const beatLabel = (index: number): string => `${index + 1} / 3 장면 · ${BEAT_ROLES[index]}`;
export const beatMove = (index: number, by: number): number => Math.min(2, Math.max(0, index + by));

/** The SVG's accessible name: the diagram, and the letter of every box with its label (the legend's mapping). */
export function diagramAriaLabel(id: DiagramId): string {
  const t = DIAGRAM_TEXT[id];
  const parts = DIAGRAMS[id].nodes.map((n) => `${n.letter} ${t.nodes[n.id]}`);
  return `${t.name} 그림. ${parts.join(", ")}`;
}

/** The role each part takes in a beat: accent when the beat emphasises it, else muted (boxes) or line (arrows). */
export function partRole(id: DiagramId, beat: number, part: string, kind: "node" | "arrow"): ColorRole {
  const b = DIAGRAMS[id].beats[Math.min(2, Math.max(0, beat))];
  return b.emphasis.includes(part) ? "accent" : kind === "node" ? "muted" : "line";
}

/** Every part inside the artboard and clear of the reserved control area, and every emphasis names a part (tests). */
export function geometryProblems(id: DiagramId): string[] {
  const d = DIAGRAMS[id], out: string[] = [];
  const parts = new Set([...d.nodes.map((n) => n.id), ...d.arrows.map((a) => a.id)]);
  const inBoard = (x: number, y: number) => x >= 0 && y >= 0 && x <= ARTBOARD.width && y <= ARTBOARD.height;
  const inControl = (x: number, y: number) => x > ARTBOARD.width - CONTROL_AREA.width && y > ARTBOARD.height - CONTROL_AREA.height;
  for (const n of d.nodes) for (const [x, y] of [[n.x, n.y], [n.x + n.w, n.y + n.h]] as const) {
    if (!inBoard(x, y)) out.push(`${id}.${n.id} leaves the artboard`);
    if (inControl(x, y)) out.push(`${id}.${n.id} enters the control area`);
  }
  for (const a of d.arrows) for (const [x, y] of [a.from, a.to]) if (!inBoard(x, y)) out.push(`${id}.${a.id} leaves the artboard`);
  for (const [i, b] of d.beats.entries()) {
    for (const p of b.emphasis) if (!parts.has(p)) out.push(`${id} beat ${i + 1} emphasises unknown ${p}`);
    const [x, y] = b.marker;
    if (!inBoard(x - MARKER_RADIUS, y - MARKER_RADIUS) || !inBoard(x + MARKER_RADIUS, y + MARKER_RADIUS)) out.push(`${id} marker ${i + 1} leaves the artboard`);
  }
  if (new Set(d.nodes.map((n) => n.letter)).size !== d.nodes.length) out.push(`${id} letters repeat`);
  return out;
}
