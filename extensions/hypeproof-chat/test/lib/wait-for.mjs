// Bounded polling for browser smokes: use it where a test changed something and the page shows the
// result one or more renders later. A fixed sleep there is a guess that a loaded CI runner loses.
//
// waitFor never throws on a timeout and never decides pass or fail. It returns the last value it read,
// so the caller's own assertion runs next and fails with its own message. On a timeout it first prints
// what it was waiting for and the rendered page, because the assertion message alone does not show that.
/**
 * @param {{ evaluate(expression: string): Promise<unknown> }} browser from lib/headless-chromium.mjs launch()
 * @param {string} expression page expression; the wait ends when it is truthy. A throw counts as "not yet".
 * @param {string} what the case and the state waited for, printed on a timeout
 * @param {{ ms?: number, every?: number, dump?: string }} [options] `dump` is the selector whose HTML is printed
 * @returns {Promise<unknown>} the last value read (falsy after a timeout)
 */
export async function waitFor(browser, expression, what, { ms = 5000, every = 20, dump = '#root' } = {}) {
  let value, lastError;
  for (const end = Date.now() + ms; ; ) {
    try { value = await browser.evaluate(expression); lastError = undefined; } catch (error) { value = undefined; lastError = String(error); }
    if (value) return value;
    if (Date.now() > end) break;
    await new Promise((r) => setTimeout(r, every));
  }
  const html = await browser.evaluate(`(document.querySelector(${JSON.stringify(dump)})?.outerHTML ?? document.documentElement.outerHTML).slice(0, 3000)`).catch((error) => `page not readable: ${error}`);
  console.error(`waitFor: ${what} did not happen within ${ms} ms (last value: ${JSON.stringify(value)}${lastError ? `, last error: ${lastError}` : ''}). Page:\n${html}`);
  return value;
}
