// Types for the subscription process helper (process.mjs), so the TypeScript gate can import it.
export function subscriptionEnv(base?: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
export function terminateProcessTree(proc: unknown): void;
