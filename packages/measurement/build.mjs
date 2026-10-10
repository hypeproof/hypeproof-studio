// Temporary compatibility lane; the Service release owns all executable CLI bytes.
import { cp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const releasedDist = fileURLToPath(new URL('./', import.meta.resolve('@hypeproof/measurement')));
await cp(releasedDist, 'dist', { recursive: true });
