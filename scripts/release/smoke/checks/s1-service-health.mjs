// S1. The production Service is up and identifies its version.
// GET <service>/v1/health → 200, ok === true, version present and not 'unknown'. Read-only.
export default {
  id: 'S1',
  name: 'Service health',
  async run({serviceUrl}) {
    const response = await fetch(`${serviceUrl}/v1/health`, {signal: AbortSignal.timeout(15000)});
    if (!response.ok) return {result: 'FAIL', detail: `HTTP ${response.status}`};
    const body = await response.json();
    if (body.ok !== true) return {result: 'FAIL', detail: `ok=${body.ok}`};
    if (!body.version || body.version === 'unknown') return {result: 'FAIL', detail: 'no version'};
    return {result: 'PASS', detail: `${body.service} ${body.version} (${body.env})`, version: body.version};
  },
};
