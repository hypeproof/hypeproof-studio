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

/**
 * True inside a task workspace whose rail draws the 자료 view. The chat column then leaves out its
 * own 자료 card, so the list has one place in the activity home. Classroom seats have no task
 * workspace, so their layout keeps the card where it was.
 */
export const ActivityHomeContext = createContext<{ materialsHome: boolean }>({ materialsHome: false });
