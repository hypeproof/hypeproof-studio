// CGP-KNOW-R-002 (REQ-STUDIO-ACTIVITY-HOME) — the activity home's two views, 작업 (tasks) and 자료
// (materials), in the task workspace rail. Switching is local presentation only: it posts nothing
// to the host, never remounts the conversation, and so cannot touch the composer draft.
//
// The chosen view is remembered per seat in the webview state (the same store as the panel sizes,
// CGP-SHELL-R-012), keyed by the host's scope digest, never an account id. A webview view's state
// survives hiding the panel and reloading the window, which is what "reopen" means here.

import { createContext } from 'react';
import { patchWebviewState, readWebviewState } from './vscode';

export type HomeView = 'tasks' | 'materials';
export const HOME_VIEWS: readonly HomeView[] = ['tasks', 'materials'];
export const HOME_VIEW_LABEL: Record<HomeView, string> = { tasks: '작업', materials: '자료' };
/** Remembered seats; the oldest choice is dropped first. */
export const HOME_VIEW_MAX_SCOPES = 50;

type Saved = { activityHomeView?: Record<string, unknown> };

/** Anything but a stored 'materials' (missing, corrupt, another type) is the default 작업 view. */
export function loadHomeView(scope: string): HomeView {
  const saved = readWebviewState<Saved>().activityHomeView;
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return 'tasks';
  return Object.prototype.hasOwnProperty.call(saved, scope) && saved[scope] === 'materials' ? 'materials' : 'tasks';
}

export function saveHomeView(scope: string, view: HomeView): void {
  const saved = readWebviewState<Saved>().activityHomeView;
  // No prototype: a scope string is only ever a key here, whatever it spells.
  const all: Record<string, HomeView> = Object.create(null);
  if (saved && typeof saved === 'object' && !Array.isArray(saved)) {
    for (const [key, value] of Object.entries(saved)) if (key !== scope && (value === 'tasks' || value === 'materials')) all[key] = value;
  }
  all[scope] = view;
  const keys = Object.keys(all);
  for (const key of keys.slice(0, Math.max(0, keys.length - HOME_VIEW_MAX_SCOPES))) delete all[key];
  patchWebviewState({ activityHomeView: all });
}

/** A horizontal tablist: Left/Right move along the two tabs and wrap; Home/End jump. Anything else is not ours. */
export function nextHomeView(current: HomeView, key: string): HomeView | null {
  const at = HOME_VIEWS.indexOf(current);
  if (key === 'ArrowRight') return HOME_VIEWS[(at + 1) % HOME_VIEWS.length];
  if (key === 'ArrowLeft') return HOME_VIEWS[(at + HOME_VIEWS.length - 1) % HOME_VIEWS.length];
  if (key === 'Home') return HOME_VIEWS[0];
  if (key === 'End') return HOME_VIEWS[HOME_VIEWS.length - 1];
  return null;
}

/** Longest activity title drawn above the tabs, in grapheme clusters; the line also ellipsizes. */
export const ACTIVITY_TITLE_MAX = 80;
// C0/C1 controls, bidi marks, embeddings, overrides and isolates, U+2028/2029, zero-width space, soft hyphen,
// the BOM and Hangul fillers. ZWJ and ZWNJ (U+200C/U+200D) stay so emoji and scripts are not broken.
const TITLE_UNSAFE = /[\u0000-\u001F\u007F-\u009F\u00AD\u061C\u115F\u1160\u180E\u200B\u200E\u200F\u2028-\u202E\u2060-\u2069\u3164\uFEFF\uFFA0]/gu;

/**
 * CGP-KNOW-D-002 — the activity's name as the title above the 작업/자료 tabs. The name comes from the host
 * (the saved activity), so it is cleaned, not trusted: invisible and direction-changing characters are dropped,
 * whitespace runs become one space, and a long name is cut between grapheme clusters with "…". Empty → ''.
 */
export function activityTitleText(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  // Whitespace first (a tab or line break is a word gap, not nothing), then the invisible characters.
  const text = raw.normalize('NFC').replace(/\s+/gu, ' ').replace(TITLE_UNSAFE, '').replace(/ {2,}/gu, ' ').trim();
  // Grapheme clusters where the runtime has them, so a ZWJ emoji is never cut in half; code points otherwise.
  const parts = typeof Intl.Segmenter === 'function' ? Array.from(new Intl.Segmenter('ko', { granularity: 'grapheme' }).segment(text), part => part.segment) : Array.from(text);
  return parts.length > ACTIVITY_TITLE_MAX ? parts.slice(0, ACTIVITY_TITLE_MAX - 1).join('').trimEnd() + '…' : text;
}

/**
 * True inside a task workspace whose rail draws the 자료 view. The chat column then leaves out its
 * own 자료 card, so the list has one place in the activity home. Classroom seats have no task
 * workspace, so their layout keeps the card where it was.
 */
export const ActivityHomeContext = createContext<{ materialsHome: boolean }>({ materialsHome: false });
