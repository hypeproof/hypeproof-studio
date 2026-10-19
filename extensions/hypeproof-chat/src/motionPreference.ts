/**
 * CGP-DS-R-015: an explicit reduce-motion preference wins over the OS default.
 *
 * VS Code's `workbench.reduceMotion` is "on" | "off" | "auto". "on" stops nonessential motion in
 * every Studio webview even when the OS has motion enabled. "auto" (and anything unknown) follows
 * the OS through `prefers-reduced-motion`. "off" also follows the OS rather than forcing motion
 * back on: re-enabling animation against an OS accessibility setting is the riskier direction.
 */
export function reduceMotionForced(setting: unknown): boolean {
  return setting === "on";
}

/** Mark the webview root so tokens.css can stop motion before the first paint. */
export function withReducedMotionAttr(html: string, forced: boolean): string {
  return forced ? html.replace(/<html\b/, '<html data-reduced-motion="true"') : html;
}
