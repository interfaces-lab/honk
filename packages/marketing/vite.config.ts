import path from "node:path";
import { fileURLToPath } from "node:url";

import stylex from "@stylexjs/unplugin";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

const marketingDir = path.dirname(fileURLToPath(import.meta.url));
const vercelOutputDir = path.resolve(marketingDir, "../../.vercel/output");
const latestReleaseDownloadBase = "https://github.com/interfaces-lab/honk/releases/latest/download";

export default defineConfig({
  plugins: [
    stylex.vite({
      useCSSLayers: true,
      cssInjectionTarget: (fileName) => /(?:^|\/)index(?:-[^/]+)?\.css$/.test(fileName),
      lightningcssOptions: {
        targets: {
          chrome: 123 << 16,
          edge: 123 << 16,
          firefox: 120 << 16,
          safari: (17 << 16) | (5 << 8),
        },
      },
    }),
    // SPA mode: the server prerenders one shell document and every route renders client-side,
    // while Start keeps file routes and head management for future pages.
    tanstackStart({ spa: { enabled: true } }),
    nitro({
      routeRules: {
        "/download/mac/arm64": {
          redirect: { to: `${latestReleaseDownloadBase}/Honk-arm64.dmg`, status: 302 },
        },
        "/download/mac/x64": {
          redirect: { to: `${latestReleaseDownloadBase}/Honk-x64.dmg`, status: 302 },
        },
      },
      traceDeps: ["react"],
      ...(process.env.VERCEL === "1" ? { output: { dir: vercelOutputDir } } : {}),
    }),
    react(),
    tailwindcss(),
  ],
  optimizeDeps: {
    exclude: ["@honk/ui"],
  },
});
