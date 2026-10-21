/*---------------------------------------------------------------------------------------------
 *  HypeProof Studio. Canonical source: hypeproof-studio scripts/patches/core/.
 *  Added to VS Code by scripts/patches/core/hps-quit-guard.patch. Keep it import-free and
 *  erasable-only (no enums, no parameter properties) so the Studio repo can test it with
 *  `node --experimental-strip-types`.
 *--------------------------------------------------------------------------------------------*/

// REQ-STUDIO-QUIT-GUARD (CGP-SHELL-R-004 / REQ-SHELL-04, CGP-SHELL-D-003 / DES-SHELL-03).
//
// When a window closes or the app quits, the workbench asks the hypeproof-chat extension
// whether anything would stop. The extension answers with the dialog copy, or with nothing
// when no coach turn, preview build or unsent message is active. The core owns the shape:
// two buttons, the safe one first, and Enter = Esc = the safe one. The extension cannot
// reorder them or make the destructive button the default.

/** Internal extension command; the leading underscore keeps it out of the command palette. */
export const HPS_QUIT_GUARD_COMMAND = '_hypeproof.quitGuard.prompt';

/** How long the core waits for the extension before letting the shutdown go ahead. */
export const HPS_QUIT_GUARD_TIMEOUT_MS = 2000;

/** ShutdownReason.CLOSE and ShutdownReason.QUIT (services/lifecycle/common/lifecycle.ts). */
export const HPS_SHUTDOWN_CLOSE = 1;
export const HPS_SHUTDOWN_QUIT = 2;

/** Index of the destructive button. Only this response lets the shutdown proceed. */
export const HPS_QUIT_BUTTON_INDEX = 1;

const MAX_MESSAGE = 60;
const MAX_DETAIL_LINE = 80;
const MAX_DETAIL_LINES = 2;
const MAX_LABEL = 16;

export interface HpsQuitPrompt {
	readonly message: string;
	readonly detail: string;
	readonly continueLabel: string;
	readonly quitLabel: string;
}

export interface HpsQuitMessageBox {
	readonly type: 'warning';
	readonly message: string;
	readonly detail: string;
	readonly buttons: string[];
	readonly defaultId: number;
	readonly cancelId: number;
}

export interface HpsQuitGuardDeps {
	queryPrompt(): Promise<unknown>;
	showMessageBox(options: HpsQuitMessageBox): Promise<{ response: number }>;
	timeout(ms: number): Promise<void>;
}

/** Reload and workspace switches keep the extension host's work alive or are not user exits. */
export function hpsGuardsShutdown(reason: number): boolean {
	return reason === HPS_SHUTDOWN_CLOSE || reason === HPS_SHUTDOWN_QUIT;
}

// C0/C1 controls, bidi embeddings/overrides/isolates, marks, and line/paragraph separators.
// eslint-disable-next-line no-control-regex
const UNSAFE = /[\u0000-\u0009\u000B-\u001F\u007F-\u009F\u061C\u200B-\u200F\u2028\u2029\u202A-\u202E\u2060-\u2069\uFEFF]/g;

function clean(value: unknown, max: number): string | undefined {
	if (typeof value !== 'string') {
		return undefined;
	}
	const text = value.normalize('NFC').replace(UNSAFE, '').replace(/\n/g, ' ').trim();
	if (!text) {
		return undefined;
	}
	return Array.from(text).slice(0, max).join('');
}

/** Validates the extension's answer. Anything that is not a well-formed prompt means "no dialog". */
export function hpsReadQuitPrompt(raw: unknown): HpsQuitPrompt | undefined {
	if (!raw || typeof raw !== 'object') {
		return undefined;
	}
	const value = raw as Record<string, unknown>;
	const message = clean(value.message, MAX_MESSAGE);
	const continueLabel = clean(value.continueLabel, MAX_LABEL);
	const quitLabel = clean(value.quitLabel, MAX_LABEL);
	if (!message || !continueLabel || !quitLabel || continueLabel === quitLabel || typeof value.detail !== 'string') {
		return undefined;
	}
	const lines = value.detail.split('\n')
		.map(line => clean(line, MAX_DETAIL_LINE))
		.filter((line): line is string => !!line)
		.slice(0, MAX_DETAIL_LINES);
	if (lines.length === 0) {
		return undefined;
	}
	return { message, detail: lines.join('\n'), continueLabel, quitLabel };
}

/** The native message box: safe button first, and it is both the default (Enter) and cancel (Esc). */
export function hpsQuitMessageBox(prompt: HpsQuitPrompt): HpsQuitMessageBox {
	return {
		type: 'warning',
		message: prompt.message,
		detail: prompt.detail,
		buttons: [prompt.continueLabel, prompt.quitLabel],
		defaultId: 0,
		cancelId: 0,
	};
}

/**
 * Resolves to the veto: true keeps the window and everything running.
 * Never rejects. A rejected veto makes VS Code show a shutdown error and stay open, and an
 * unreachable extension host (crashed, hung) must not trap the learner in the app.
 */
export async function hpsRunQuitGuard(reason: number, deps: HpsQuitGuardDeps): Promise<boolean> {
	if (!hpsGuardsShutdown(reason)) {
		return false;
	}
	let raw: unknown;
	try {
		raw = await Promise.race([
			deps.queryPrompt(),
			deps.timeout(HPS_QUIT_GUARD_TIMEOUT_MS).then(() => undefined),
		]);
	} catch {
		return false;
	}
	const prompt = hpsReadQuitPrompt(raw);
	if (!prompt) {
		return false;
	}
	try {
		const { response } = await deps.showMessageBox(hpsQuitMessageBox(prompt));
		return response !== HPS_QUIT_BUTTON_INDEX;
	} catch {
		return false;
	}
}
