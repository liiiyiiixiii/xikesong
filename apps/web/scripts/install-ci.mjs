import { root, npm, binary } from '../../../scripts/workspace-runtime.mjs';
// Compatibility entry point: installation always uses the workspace root lock.
npm(['ci'], root);
binary('vinext');
