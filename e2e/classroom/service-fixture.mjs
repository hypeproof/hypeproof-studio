// Consumer integration: real App snapshot builders injected into the public Service test fixture.
// The Service package never reads a Studio checkout or substitutes its own App implementation.
import '@hypeproof/service-testkit/test/harness/loader.mjs';
import { localOps as serviceOps, OPS_ALL } from '@hypeproof/service-testkit/test/harness/classroom-ops.mjs';
import { freezeSnapshot, freezeCollection } from '../../extensions/hypeproof-chat/src/evidenceSnapshot.ts';

export { OPS_ALL };
export function localOps(options = {}) {
  return serviceOps({ ...options, app: { freezeSnapshot, freezeCollection } });
}
