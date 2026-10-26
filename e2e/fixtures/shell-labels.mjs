// Palette and menu labels of VS Code core commands, as the shipped Korean shell renders them
// (CGP-SHELL-R-006). Derived from the same catalog install.mjs bakes into the app (the bundled
// Korean pack plus overrides.json), so a reworded pack or override changes the lookup, not a
// string in a test. Extension command titles come from the extension manifest instead
// (commandLabel in app.ts).
import fs from 'node:fs';
import path from 'node:path';
import {translations} from '../../scripts/patches/core/korean/install.mjs';

// The app a native e2e drives is not always the Korean shell: the hosted native job drives an
// official app that only the packaging hooks (stamp-mac-app.sh, run-build.sh, build-windows.yml)
// turn into Korean. So the locale is a run-time fact, detected from the running workbench
// (<html lang>, set from the resolved NLS language) with the app's out/nls.messages.ko.json as
// the fallback. Default is Korean (the shipped shell) until a caller detects otherwise.
let locale = 'ko';
export function setShellLocale(next) {
  if (next !== 'ko' && next !== 'en') throw new Error(`unknown shell locale ${next}`);
  locale = next;
  return locale;
}
export const shellLocale = () => locale;
/** Pure decision: the workbench's <html lang> wins; the pack file only decides when lang is empty. */
export function localeFromProbe({lang, packPresent} = {}) {
  const tag = String(lang || '').toLowerCase();
  if (tag) return tag === 'ko' || tag.startsWith('ko-') ? 'ko' : 'en';
  return packPresent ? 'ko' : 'en';
}
/** Whether a packaged app (.app bundle or Windows install dir) carries the Korean NLS pack. */
export function appHasKoreanPack(appPath) {
  const resources = path.join(appPath, process.platform === 'darwin' ? 'Contents/Resources/app' : 'resources/app');
  return fs.existsSync(path.join(resources, 'out', 'nls.messages.ko.json'));
}
/** Read the running workbench's locale (target.evaluate) and make it the active one. */
export async function detectShellLocale(target, appPath) {
  let lang = '';
  try { lang = await target.evaluate('document.documentElement.lang'); } catch { /* fall back to the pack file */ }
  let packPresent = false;
  try { packPresent = appPath ? appHasKoreanPack(appPath) : false; } catch { /* absent */ }
  return setShellLocale(localeFromProbe({lang, packPresent}));
}

// Exactly the English strings the native e2e used before the Korean shell.
const EN_CORE = {
  'workbench.action.files.openFolder': 'File: Open Folder...',
  'workbench.action.toggleSidebarVisibility': 'View: Toggle Primary Side Bar Visibility',
  'workbench.action.reloadWindow': 'Developer: Reload Window',
  'workbench.action.revertAndCloseActiveEditor': 'View: Revert and Close Editor',
  'workbench.action.closeWindow': 'Close Window',
};
const EN_MENU = {file: ['File'], exit: ['Exit']};
const EN_CATALOG_LABELS = {'open': ['Open']};
const EN_MESSAGES = {confirmUrl: name => `Allow '${name}' extension`};

const AC = 'vs/platform/action/common/actionCommonCategories';
// command id -> [category key in actionCommonCategories | null, module, key]
const CORE = {
  'workbench.action.files.openFolder': ['file', 'vs/workbench/browser/actions/workspaceActions', 'openFolder'],
  'workbench.action.toggleSidebarVisibility': ['view', 'vs/workbench/browser/actions/layoutActions', 'toggleSidebar'],
  'workbench.action.reloadWindow': ['developer', 'vs/workbench/browser/actions/windowActions', 'reloadWindow'],
  'workbench.action.revertAndCloseActiveEditor': ['view', 'vs/workbench/browser/parts/editor/editorActions', 'revertAndCloseActiveEditor'],
  'workbench.action.closeWindow': [null, 'vs/workbench/electron-browser/actions/windowActions', 'closeWindow'],
};
// Menu items: label key per menu (titlebar menu on Windows/Linux). "&&" marks the mnemonic.
const MENU = {
  file: ['vs/workbench/browser/parts/titlebar/menubarControl', 'mFile'],
  exit: ['vs/workbench/electron-browser/desktop.contribution', 'miExit'],
};

function message(module, key) {
  const text = translations[module]?.[key];
  if (typeof text !== 'string' || !text) throw new Error(`Korean shell catalog has no ${module}:${key}`);
  return text;
}

/** "{Category}: {Title}" palette text of a core command, in the shipped Korean shell. */
export function coreCommandLabel(commandId) {
  if (locale === 'en') {
    if (!EN_CORE[commandId]) throw new Error(`no core command label registered for ${commandId}`);
    return EN_CORE[commandId];
  }
  const entry = CORE[commandId];
  if (!entry) throw new Error(`no core command label registered for ${commandId}`);
  const [category, module, key] = entry;
  const title = message(module, key);
  return category ? `${message(AC, category)}: ${title}` : title;
}

/** The texts a label with a "&&" mnemonic may show: marker removed, with and without a "(X)" accelerator suffix. */
export function catalogLabels(module, key) {
  if (locale === 'en') {
    const en = EN_CATALOG_LABELS[key];
    if (!en) throw new Error(`no English label registered for ${key}`);
    return en;
  }
  const raw = message(module, key);
  return [...new Set([raw.replace(/&&/g, ''), raw.replace(/\(&&\w\)/g, '').replace(/&&/g, '')])];
}

/** A catalog sentence with its {0}, {1} placeholders filled. */
export function catalogMessage(module, key, ...args) {
  if (locale === 'en') {
    if (!EN_MESSAGES[key]) throw new Error(`no English message registered for ${key}`);
    return EN_MESSAGES[key](...args);
  }
  return message(module, key).replace(/\{(\d+)\}/g, (_, i) => String(args[Number(i)]));
}

/** The texts a menu entry may show (see catalogLabels). */
export function menuLabels(name) {
  const entry = MENU[name];
  if (!entry) throw new Error(`no menu label registered for ${name}`);
  if (locale === 'en') return EN_MENU[name];
  return catalogLabels(...entry);
}

/** Titles the "open folder" picker may carry: the native dialog title and the palette title without the ellipsis. */
export function openFolderDialogTitles() {
  return [...new Set([
    'Open Folder',
    message('vs/platform/dialogs/electron-main/dialogMainService', 'openFolder'),
    coreCommandLabel('workbench.action.files.openFolder').replace(/^[^:]*:\s*/, '').replace(/\.\.\.$/, ''),
  ])];
}
