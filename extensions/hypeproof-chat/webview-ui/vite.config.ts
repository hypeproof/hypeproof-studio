import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// CGP-CHAT-R-022: KaTeX's @font-face rules list woff2, woff and ttf for each face. The webview is
// Chromium (Electron), which always takes woff2, so the woff and ttf sources are dropped from the
// CSS here, and the font files no stylesheet references any more are left out of the build below.
const woff2Only = {
  postcssPlugin: "hps-woff2-only",
  AtRule: {
    "font-face": (rule: { walkDecls: (prop: string, fn: (d: { value: string }) => void) => void }) => {
      rule.walkDecls("src", decl => {
        const woff2 = decl.value.split(/,(?=\s*url\()/).filter(part => /format\(["']?woff2["']?\)/.test(part));
        if (woff2.length) decl.value = woff2.join(",");
      });
    },
  },
};

const dropUnreferencedFonts = {
  name: "hps-drop-unreferenced-fonts",
  generateBundle(_options: unknown, bundle: Record<string, { type: string; fileName: string; source?: unknown }>) {
    const css = Object.values(bundle).filter(f => f.fileName.endsWith(".css")).map(f => String(f.source ?? "")).join("\n");
    for (const [key, file] of Object.entries(bundle)) {
      const base = file.fileName.split("/").pop()!;
      // "X.woff" must not match inside "X.woff2".
      const referenced = new RegExp(base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?![\\w])").test(css);
      if (/\.(woff|ttf)$/.test(base) && !referenced) delete bundle[key];
    }
  },
};

export default defineConfig({
  plugins: [react(), dropUnreferencedFonts],
  base: "./",
  css: { postcss: { plugins: [woff2Only] } },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // CGP-CHAT-R-022: the chat CSP allows fonts from the webview's own cspSource only (no data:),
    // so the bundled KaTeX fonts stay files instead of being inlined.
    assetsInlineLimit: (file: string) => (/\.(woff2?|ttf)$/.test(file) ? false : undefined),
    rollupOptions: {
      output: {
        entryFileNames: "assets/[name].js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/[name].[ext]",
      },
    },
  },
});
