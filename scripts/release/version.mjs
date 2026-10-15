// Release version naming (#1608 follow-up). Format: v<year>.<month*100+day>.<n>.
//   2026-10-13 → v2026.1013.0, the second release that day → v2026.1013.1, 2026-01-05 → v2026.105.0
// No leading zero (0105): the in-app updater (isUpdateVersion) rejects it as malformed and would never
// update to that release. No 4th number or "_": scripts/resolve-version.sh rejects them. A "-" or "+"
// suffix is ignored by the updater's comparison, so it cannot tell two releases of one day apart.
// rc tags add -rc.N to the version they are a candidate for.

export function versionFor(day, stableTags) {
  const [y, m, d] = day.split('-').map(Number);
  if (!y || !m || !d) throw new Error(`not a YYYY-MM-DD date: ${day}`);
  const prefix = `v${y}.${m * 100 + d}.`;
  const used = stableTags.filter(t => t.startsWith(prefix) && /^\d+$/.test(t.slice(prefix.length)))
    .map(t => Number(t.slice(prefix.length)));
  return `${prefix}${used.length ? Math.max(...used) + 1 : 0}`;
}

export function nextRcTag(version, allTags) {
  const re = new RegExp(`^${version.replace(/\./g, '\\.')}-rc\\.(\\d+)$`);
  const used = allTags.map(t => t.match(re)?.[1]).filter(Boolean).map(Number);
  return `${version}-rc.${used.length ? Math.max(...used) + 1 : 1}`;
}
