import stylex from "@stylexjs/unplugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Mirrors packages/ui/vite.config.ts: StyleX before React, Tailwind after so utilities
// resolve against the emitted --honk-* vars via the bridge. optimizeDeps.exclude is
// mandatory for raw-source @honk/ui — forgetting it silently drops all StyleX styles
// (ADR 0025 §4).
export default defineConfig({
  plugins: [
    stylex.vite({
      useCSSLayers: true,
      // Same lightningcss pin as @honk/ui: keep light-dark() intact so token values
      // declared at :root still resolve under the Shell frame's color-scheme.
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
  resolve: {
    // This source tree still has stale generated .js siblings. Prefer the TS sources
    // so extensionless imports like "./home" render the current app-next home page.
    extensions: [".tsx", ".ts", ".mts", ".jsx", ".js", ".mjs", ".json"],
  },
  // Desktop `pnpm dev` probes and loads `http://127.0.0.1:5173`. Pin host+port so
  // Vite cannot bind ::1-only (Node/macOS localhost default) while the Electron
  // host and readiness probe use IPv4 loopback.
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
  },
});
