import { detectMode } from '../server/sandbox.js';
const mode = detectMode();
console.log(`Integration runtime: ${mode.label}`);
if (mode.mode === 'none') { console.error('BLOCKED: prepare Linux Docker/runsc or bubblewrap. Portable tests cannot verify containment.'); process.exitCode = 1; }
