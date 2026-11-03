/*---------------------------------------------------------------------------------------------
 *  HypeProof Studio. Canonical source: hypeproof-studio scripts/patches/core/.
 *  Added to VS Code by scripts/patches/core/hps-quit-guard.patch. Keep it import-free so the
 *  Studio repo can test it with plain Node.
 *--------------------------------------------------------------------------------------------*/

// REQ-STUDIO-QUIT-GUARD (CGP-SHELL-D-003 / DES-SHELL-03): a "safe default" message box is one
// whose default button (Enter) is also its cancel button (Esc). VS Code's HIG reordering in
// massageMessageBoxOptions always makes button 0 the default and moves the cancel button to
// slot 1 (macOS/Linux) or last (Windows), so Enter would land on the destructive button.
// For a safe-default box the order the caller gave is kept and Enter = Esc = the safe button.
// No upstream caller sets defaultId, so this path is inert for every existing dialog.

export interface HpsSafeDefaultOptions {
	readonly buttons?: string[];
	readonly defaultId?: number;
	readonly cancelId?: number;
	readonly title?: string;
}

export function hpsIsSafeDefaultDialog(options: HpsSafeDefaultOptions): boolean {
	const count = options.buttons?.length ?? 0;
	const id = options.defaultId;
	return count >= 2
		&& typeof id === 'number'
		&& Number.isInteger(id)
		&& id >= 0
		&& id < count
		&& id === options.cancelId;
}

/**
 * massageMessageBoxOptions for a safe-default box: same button order, same default and cancel
 * index, identity buttonIndeces. The rest matches the upstream tail (mnemonics, noLink, title).
 */
export function hpsMassageSafeDefaultDialog<T extends HpsSafeDefaultOptions>(
	options: T,
	nameLong: string,
	mnemonic: (label: string) => string,
): { options: T & { buttons: string[]; defaultId: number; cancelId: number; noLink: boolean; title: string }; buttonIndeces: number[] } {
	const buttons = (options.buttons ?? []).map(mnemonic);
	const id = options.defaultId as number;
	return {
		options: { ...options, buttons, defaultId: id, cancelId: id, noLink: true, title: options.title || nameLong },
		buttonIndeces: buttons.map((_, index) => index),
	};
}
