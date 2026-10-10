// Only HTTP transport is replaced; the real Service auth and KV reads execute.
import "../../../worker/test/harness/loader.mjs";
const { default: service } = await import("../../../worker/src/index.ts");

export function bridgeStateToService(chalk) {
  return {
    async fetch(request, env, ctx) {
      const previous = globalThis.fetch;
      globalThis.fetch = async (input, init) => {
        const upstream = new Request(input, init);
        if (/^\/admin\/chalk\/cohorts\/[^/]+\/state$/.test(new URL(upstream.url).pathname)) {
          return service.fetch(upstream, env, ctx);
        }
        return previous(input, init);
      };
      try { return await chalk.fetch(request, env, ctx); }
      finally { globalThis.fetch = previous; }
    },
  };
}
