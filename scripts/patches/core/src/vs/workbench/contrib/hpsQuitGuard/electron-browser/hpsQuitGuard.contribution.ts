/*---------------------------------------------------------------------------------------------
 *  HypeProof Studio. Canonical source: hypeproof-studio scripts/patches/core/.
 *  Added to VS Code by scripts/patches/core/hps-quit-guard.patch.
 *--------------------------------------------------------------------------------------------*/

// REQ-STUDIO-QUIT-GUARD: wires hpsRunQuitGuard into the workbench shutdown veto. All decisions
// live in ../common/hpsQuitGuardCore.ts; this file only supplies the services.

import { timeout } from '../../../../base/common/async.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { INativeHostService } from '../../../../platform/native/common/native.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { ILifecycleService } from '../../../services/lifecycle/common/lifecycle.js';
import { HPS_QUIT_GUARD_COMMAND, hpsGuardsShutdown, hpsRunQuitGuard } from '../common/hpsQuitGuardCore.js';

class HpsQuitGuardContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.hpsQuitGuard';

	constructor(
		@ILifecycleService lifecycleService: ILifecycleService,
		@ICommandService private readonly commandService: ICommandService,
		@INativeHostService private readonly nativeHostService: INativeHostService,
	) {
		super();

		this._register(lifecycleService.onBeforeShutdown(e => {
			if (!hpsGuardsShutdown(e.reason)) {
				return;
			}
			e.veto(hpsRunQuitGuard(e.reason, {
				queryPrompt: () => this.commandService.executeCommand(HPS_QUIT_GUARD_COMMAND),
				showMessageBox: options => this.nativeHostService.showMessageBox(options),
				timeout: ms => timeout(ms),
			}), 'veto.hpsQuitGuard');
		}));
	}
}

registerWorkbenchContribution2(HpsQuitGuardContribution.ID, HpsQuitGuardContribution, WorkbenchPhase.AfterRestored);
