// Existing geometry/accessibility probes inspect computed static values. Expand only the
// new --ds-* transport aliases; never substitute contextual HP or host theme variables.
import { readFileSync } from 'node:fs';
export const tokenURL = new URL('../../webview-ui/src/designTokens.css', import.meta.url);
import { staticTokens } from "./expand-design-tokens.mjs";
export { staticTokens };
export function readDesignFile(file, encoding = 'utf8') {
  const text = readFileSync(file, encoding);
  return /\.css$/.test(String(file)) ? staticTokens(readFileSync(tokenURL, 'utf8'))(text).replace(/^@import "\.\/designTokens\.css";\n\n/, '') : text;
}
