import stylex from "@stylexjs/unplugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import pkg from "./package.json" with { type: "json" };

const currentDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(currentDir, "../..");
const appDir = resolve(repoRoot, "packages/app");
const desktopOutDir = resolve(currentDir, "out");

const port = Number(process.env.PORT ?? 5733);
const host = process.env.HOST?.trim() || "localhost";
const configuredHttpUrl = process.env.VITE_HTTP_URL?.trim();
const sidecarPort = process.env.HONK_OPENCODE_PORT?.trim();
const resolvedHttpUrl =
  configuredHttpUrl ?? (sidecarPort ? `http://127.0.0.1:${sidecarPort}` : undefined);
const sourcemapEnv = process.env.HONK_WEB_SOURCEMAP?.trim().toLowerCase();

const buildSourcemap =
  sourcemapEnv === "1" || sourcemapEnv === "true"
    ? true
    : sourcemapEnv === "hidden"
      ? "hidden"
      : false;

export default defineConfig({
  main: {
    build: {
      outDir: "out/main",
      sourcemap: buildSourcemap,
      emptyOutDir: true,
      externalizeDeps: {
        // Workspace packages ship raw TypeScript, so bundle them into Electron main.
        exclude: ["@honk/shared"],
        include: ["sqlite3"],
      },
      lib: {
        entry: "src/main/index.ts",
        formats: ["es"],
      },
      rolldownOptions: {
        output: {
          entryFileNames: "index.js",
          chunkFileNames: "[name]-[hash].js",
        },
      },
    },
  },
  preload: {
    build: {
      outDir: "out/preload",
      sourcemap: buildSourcemap,
      emptyOutDir: true,
      lib: {
        entry: {
          index: "src/preload/index.ts",
          "browser-webview": "src/preload/browser-webview.ts",
        },
        formats: ["cjs"],
      },
      rolldownOptions: {
        output: {
          entryFileNames: "[name].js",
          chunkFileNames: "[name]-[hash].cjs",
        },
      },
    },
  },
  renderer: {
    root: appDir,
    plugins: [
      stylex.vite({
        useCSSLayers: true,
        lightningcssOptions: {
          targets: {
            chrome: 123 << 16,
            edge: 123 << 16,
            firefox: 120 << 16,
            safari: (17 << 16) | (5 << 8),
          },
        },
      }),
      react(),
      tailwindcss(),
    ],
    optimizeDeps: {
      exclude: ["@honk/ui"],
    },
    define: {
      "import.meta.env.VITE_HTTP_URL": JSON.stringify(resolvedHttpUrl ?? ""),
      "import.meta.env.APP_VERSION": JSON.stringify(pkg.version),
    },
    resolve: {
      // @honk/ui is consumed as raw workspace source and has its own React dev dependency.
      // Force every renderer module through the app's React instance so hooks share one dispatcher.
      dedupe: ["react", "react-dom"],
      extensions: [".tsx", ".ts", ".mts", ".jsx", ".js", ".mjs", ".json"],
    },
    server: {
      host,
      port,
      strictPort: true,
      fs: {
        allow: [repoRoot],
      },
      hmr: {
        protocol: "ws",
        host,
      },
    },
    build: {
      outDir: resolve(desktopOutDir, "renderer"),
      emptyOutDir: true,
      sourcemap: buildSourcemap,
      // electron-vite resolves its default HTML entry from the desktop package root, while this
      // renderer lives in packages/app. Pin the actual entry so dev and production use the same
      // cross-package renderer root instead of probing packages/desktop/src/renderer.
      rolldownOptions: {
        input: resolve(appDir, "index.html"),
      },
    },
  },
});
