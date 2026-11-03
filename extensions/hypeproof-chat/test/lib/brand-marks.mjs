// Shared HP brand-mark auditors for REQ-STUDIO-BRAND-MARKS (CGP-DS-R-032 / REQ-CGP-DS-38).
// Used by brand-marks.smoke.mjs (packaged assets) and startup-brand-computed.smoke.mjs (rendered DOM).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
export const EXT = path.join(ROOT, 'extensions/hypeproof-chat');
// Third-party names that would make an SVG or data: image a vendor mark. Word-ish boundaries keep
// "-apple-system" in a font stack and CSS `cursor:` out of scope; neither list is a mark.
export const VENDOR = /(?<![a-z-])(openai|chatgpt|gpt-?\d|anthropic|claude|codex|vscodium|codium|vs ?code|visual studio|microsoft|github|octocat|copilot|google|gemini|cursor(?!\s*:)|replit|windsurf|codeium)(?![a-z])/i;
// Codicons that draw a vendor's logo. VS Code's built-in set contains these alongside generic glyphs.
export const VENDOR_CODICONS = new Set(['github', 'github-alt', 'github-inverted', 'github-action', 'github-project', 'mark-github', 'octoface', 'copilot', 'copilot-large', 'copilot-warning', 'copilot-blocked', 'copilot-error', 'copilot-not-connected', 'copilot-snooze', 'copilot-unavailable', 'copilot-warning-large', 'vscode', 'vscode-insiders', 'azure', 'azure-devops', 'chrome', 'python', 'gist', 'gist-fork', 'gist-new', 'gist-private', 'gist-secret', 'twitter', 'mcp']);
export const IMAGE = /\.(svg|png|jpe?g|gif|webp|ico|icns|bmp|avif)$/i;
// Directories whose files are packaged into the app or its built-in extension.
export const SHIPPED = ['assets', 'extensions/hypeproof-chat/media', 'extensions/hypeproof-chat/webview-ui/src', 'extensions/hypeproof-chat/webview-ui/styles', 'extensions/hypeproof-chat/src'];
// Rasters cannot be read for a mark; each one must be named here after a person looked at it. None today.
const REVIEWED_RASTERS = new Set();
export const HP_BRAND = ['assets/brand/hypeproof-mark.svg', 'assets/brand/hypeproof-watermark.svg', 'assets/brand/hypeproof_cnl.svg', 'assets/brand/hypeproof_cnl_w80_b8.svg', 'assets/brand/hypeproof_clt.svg'];

export const walk = (dir) => fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.name === 'node_modules' ? [] : e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]) : [];
export const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');

/** Decode a data: URI to its text (SVG) or report that it is an opaque raster. */
export function decodeDataUri(uri) {
  const m = /^data:([^,;]+)((?:;[^,;]+)*),(.*)$/s.exec(uri);
  if (!m) return null;
  const body = /;base64/i.test(m[2]) ? Buffer.from(m[3], 'base64').toString('utf8') : decodeURIComponent(m[3]);
  return { type: m[1].toLowerCase(), body };
}

/** Every reason a packaged file set fails the rule; empty when it passes. */
export function auditFiles(files, readText = (f) => fs.readFileSync(f, 'utf8')) {
  const bad = [];
  for (const f of files) {
    const name = rel(f);
    if (IMAGE.test(f)) {
      if (VENDOR.test(path.basename(f))) bad.push(`${name}: file name names a third-party brand`);
      if (/\.svg$/i.test(f)) { const t = readText(f); const hit = VENDOR.exec(t); if (hit) bad.push(`${name}: SVG names ${hit[1]}`); }
      else if (!REVIEWED_RASTERS.has(name)) bad.push(`${name}: unreviewed raster image (its mark cannot be read)`);
      continue;
    }
    if (!/\.(tsx?|css|html|json|mjs)$/i.test(f)) continue;
    const text = readText(f);
    for (const [uri] of text.matchAll(/data:image\/[a-z+.-]+(?:;[a-z0-9=-]+)*,[^"'`)\s]+/gi)) {
      let d; try { d = decodeDataUri(uri); } catch { d = null; }
      if (!d) continue;
      if (d.type === 'image/svg+xml') { const hit = VENDOR.exec(d.body); if (hit) bad.push(`${name}: inline SVG names ${hit[1]}`); }
    }
  }
  return bad;
}

/** Image imports in webview source must resolve to an HP brand asset. */
export function auditImports(files, readText = (f) => fs.readFileSync(f, 'utf8')) {
  const bad = [];
  for (const f of files.filter((x) => /\.(tsx?|css)$/.test(x))) {
    const text = readText(f);
    for (const m of text.matchAll(/(?:from\s+|import\s+|url\()\s*["']?([^"')\s]+\.(?:svg|png|jpe?g|gif|webp|ico|avif))["']?/gi)) {
      const target = rel(path.resolve(path.dirname(f), m[1]));
      if (!HP_BRAND.includes(target)) bad.push(`${rel(f)} imports ${m[1]} (${target}), not an HP brand asset`);
    }
  }
  return bad;
}

/** Codicon ids a manifest or host source sets; vendor glyphs are refused. */
export function auditCodicons(texts) {
  const bad = [];
  for (const [name, text] of texts) for (const m of text.matchAll(/\$\(([a-z0-9-]+)(?:~[a-z]+)?\)/g)) if (VENDOR_CODICONS.has(m[1])) bad.push(`${name}: codicon $(${m[1]}) is a vendor mark`);
  return bad;
}

