import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";
import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import pkg from "./package.json" with { type: "json" };

const currentDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(currentDir, "../..");
const appDir = resolve(repoRoot, "packages/app");
const appSrcDir = resolve(appDir, "src");
const rendererRoot = resolve(currentDir, "src/renderer");
const desktopOutDir = resolve(currentDir, "out");
const serverDistDir = resolve(repoRoot, "packages/server/dist");
const serverClientDistDir = resolve(serverDistDir, "client");

const port = Number(process.env.PORT ?? 5733);
const host = process.env.HOST?.trim() || "localhost";
const configuredHttpUrl = process.env.VITE_HTTP_URL?.trim();
const configuredWsUrl = process.env.VITE_WS_URL?.trim();
const inferredBackendPort = process.env.HONK_PORT?.trim();
const resolvedHttpUrl =
  configuredHttpUrl ??
  (inferredBackendPort ? `http://127.0.0.1:${inferredBackendPort}` : undefined);
const resolvedWsUrl =
  configuredWsUrl ?? (inferredBackendPort ? `ws://127.0.0.1:${inferredBackendPort}` : undefined);
const sourcemapEnv = process.env.HONK_WEB_SOURCEMAP?.trim().toLowerCase();

const buildSourcemap =
  sourcemapEnv === "1" || sourcemapEnv === "true"
    ? true
    : sourcemapEnv === "hidden"
      ? "hidden"
      : false;

function isWithinPath(parentPath: string, candidatePath: string): boolean {
  const relativePath = relative(parentPath, candidatePath);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function shouldCopyDesktopServerFile(source: string): boolean {
  return !isWithinPath(serverClientDistDir, source) && !source.endsWith(".map");
}

function resolveDevProxyTarget(wsUrl: string | undefined): string | undefined {
  if (!wsUrl) {
    return undefined;
  }

  try {
    const url = new URL(wsUrl);
    if (url.protocol === "ws:") {
      url.protocol = "http:";
    } else if (url.protocol === "wss:") {
      url.protocol = "https:";
    }
    url.pathname = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return undefined;
  }
}

const devProxyTarget = resolveDevProxyTarget(resolvedWsUrl);
const reactCompilerBabelPlugin = await babel({
  exclude: ["**/node_modules/**"],
  parserOpts: { plugins: ["typescript", "jsx"] },
  presets: [reactCompilerPreset()],
});

export default defineConfig({
  main: {
    plugins: [
      {
        name: "honk:copy-server-dist",
        apply: "build",
        async writeBundle() {
          const targetDir = resolve(desktopOutDir, "server");
          await rm(targetDir, { recursive: true, force: true });
          await mkdir(targetDir, { recursive: true });
          await cp(serverDistDir, targetDir, {
            recursive: true,
            filter: shouldCopyDesktopServerFile,
          });
        },
      },
    ],
    build: {
      outDir: "out/main",
      sourcemap: buildSourcemap,
      emptyOutDir: true,
      externalizeDeps: {
        exclude: ["@honk/runtime"],
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
    root: rendererRoot,
    publicDir: resolve(appDir, "public"),
    plugins: [
      tanstackRouter({
        target: "react",
        routesDirectory: resolve(appSrcDir, "routes"),
        generatedRouteTree: resolve(appSrcDir, "routeTree.gen.ts"),
      }),
      react(),
      reactCompilerBabelPlugin,
      tailwindcss(),
    ],
    optimizeDeps: {
      include: [
        "@pierre/diffs",
        "@pierre/diffs/react",
        "@pierre/diffs/worker/worker.js",
        "monaco-editor",
      ],
    },
    define: {
      "import.meta.env.VITE_HTTP_URL": JSON.stringify(resolvedHttpUrl ?? ""),
      "import.meta.env.VITE_WS_URL": JSON.stringify(resolvedWsUrl ?? ""),
      "import.meta.env.APP_VERSION": JSON.stringify(pkg.version),
    },
    resolve: {
      alias: {
        "@xterm/addon-fit": resolve(appDir, "node_modules/@xterm/addon-fit"),
        "@xterm/xterm/css/xterm.css": resolve(appDir, "node_modules/@xterm/xterm/css/xterm.css"),
        "@xterm/xterm": resolve(appDir, "node_modules/@xterm/xterm"),
        "~": appSrcDir,
      },
    },
    server: {
      host,
      port,
      strictPort: true,
      fs: {
        allow: [repoRoot],
      },
      ...(devProxyTarget
        ? {
            proxy: {
              "/.well-known": {
                target: devProxyTarget,
                changeOrigin: true,
              },
              "/api": {
                target: devProxyTarget,
                changeOrigin: true,
              },
              "/attachments": {
                target: devProxyTarget,
                changeOrigin: true,
              },
            },
          }
        : {}),
      hmr: {
        protocol: "ws",
        host,
      },
    },
    build: {
      outDir: resolve(desktopOutDir, "renderer"),
      emptyOutDir: true,
      sourcemap: buildSourcemap,
    },
  },
});
