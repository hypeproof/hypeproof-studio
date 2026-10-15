// S2. Production Chalk is up and identifies its version. Same rule as S1. Read-only.
export default {
  id: 'S2',
  name: 'Chalk health',
  async run({chalkUrl}) {
    const response = await fetch(`${chalkUrl}/health`, {signal: AbortSignal.timeout(15000)});
    if (!response.ok) return {result: 'FAIL', detail: `HTTP ${response.status}`};
    const body = await response.json();
    if (body.ok !== true) return {result: 'FAIL', detail: `ok=${body.ok}`};
    if (!body.version || body.version === 'unknown') return {result: 'FAIL', detail: 'no version'};
    return {result: 'PASS', detail: `${body.service} ${body.version} (${body.env})`, version: body.version};
  },
};
