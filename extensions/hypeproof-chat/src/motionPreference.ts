/** CGP-DS-D-012: explicit host preferences override the OS; absence follows the OS. */
export function reduceMotionForced(setting: unknown): boolean | undefined {
  return setting === "on" ? true : setting === "off" ? false : undefined;
}

/** Set the initial preference before first paint. Only known booleans become attributes. */
export function withReducedMotionAttr(html: string, forced: boolean | undefined): string {
  return typeof forced === "boolean"
    ? html.replace(/<html\b/, `<html data-reduced-motion="${forced}"`)
    : html;
}
