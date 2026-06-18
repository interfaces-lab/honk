import path from "node:path";
import { fileURLToPath } from "node:url";

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
    tailwindcss(),
    tanstackStart(),
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
  ],
  resolve: {
    alias: {
      "~": path.resolve(marketingDir, "../app/src"),
    },
  },
});
