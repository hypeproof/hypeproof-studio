import { patchWebviewState, readWebviewState } from './vscode';

export type PanelName = 'rail' | 'sources';
export const PANEL_LIMITS: Record<PanelName, { min: number; max: number }> = { rail: { min: 200, max: 320 }, sources: { min: 240, max: 400 } };
export const KEY_STEP = 16, KEY_STEP_LARGE = 64;
type Sizes = Partial<Record<PanelName, number>>;

export const clampPanel = (panel: PanelName, value: number) => Math.min(PANEL_LIMITS[panel].max, Math.max(PANEL_LIMITS[panel].min, Math.round(value)));

/** Sizes are remembered per seat: the key is the host's scope digest, never an account id. */
export function loadPanelSizes(scope: string): Sizes {
  const saved = (readWebviewState<{ panelSizes?: Record<string, Sizes> }>().panelSizes ?? {})[scope] ?? {};
  const out: Sizes = {};
  for (const panel of ['rail', 'sources'] as const) if (typeof saved[panel] === 'number' && Number.isFinite(saved[panel])) out[panel] = clampPanel(panel, saved[panel]);
  return out;
}

export function savePanelSizes(scope: string, sizes: Sizes): void {
  const all = readWebviewState<{ panelSizes?: Record<string, Sizes> }>().panelSizes ?? {};
  patchWebviewState({ panelSizes: { ...all, [scope]: sizes } });
}
