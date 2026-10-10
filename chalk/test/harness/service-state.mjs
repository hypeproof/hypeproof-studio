// Only HTTP transport is replaced; the real Service auth and KV reads execute.
import "@hypeproof/service-testkit/test/harness/loader.mjs";
const { default: service } = await import("@hypeproof/service-testkit/src/index.ts");

export function bridgeStateToService(chalk) {
  return {
    async fetch(request, env, ctx) {
      const previous = globalThis.fetch;
      globalThis.fetch = async (input, init) => {
        const upstream = new Request(input, init);
        if (/^\/admin\/chalk\/cohorts\/[^/]+\/(?:state|board|logs(?:\/.*)?)$/.test(new URL(upstream.url).pathname)) {
          return service.fetch(upstream, env, ctx);
        }
        return previous(input, init);
      };
      try { return await chalk.fetch(request, env, ctx); }
      finally { globalThis.fetch = previous; }
    },
  };
}
