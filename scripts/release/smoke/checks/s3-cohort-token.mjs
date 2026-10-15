// S3. Token → cohort.
// The real check will reuse the opening of e2e/unified-release/public.mjs: open a short session on the
// synthetic acceptance cohort, mint a code, read the cohort back, revoke in finally. It writes to the
// production Service, so it stays NOT_RUN until that port is reviewed and a cohort-scoped issuer exists.
export default {
  id: 'S3',
  name: 'Token -> cohort',
  async run({env}) {
    if (!env.HPS_ACCEPTANCE_ISSUER) {
      return {result: 'NOT_RUN', detail: 'no credential (HPS_ACCEPTANCE_ISSUER)'};
    }
    return {result: 'NOT_RUN', detail: 'not implemented yet (port of public.mjs pending)'};
  },
};
