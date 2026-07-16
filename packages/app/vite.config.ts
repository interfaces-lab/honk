import babel from "@rolldown/plugin-babel";
import stylex from "@stylexjs/unplugin";
import tailwindcss from "@tailwindcss/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// oxlint-disable-next-line eslint/no-control-regex -- rolldown virtual module id
const rolldownRuntimeModulePattern = new RegExp("^\\u0000rolldown/runtime\\.js$");

// Match packages/ui plugin order. StyleX before React, Tailwind after. optimizeDeps.exclude
// for raw-source @honk/ui is mandatory. Forgetting it silently drops all StyleX styles.
export default defineConfig({
  plugins: [
    stylex.vite({
      useCSSLayers: true,
      // Pin lightningcss like @honk/ui so light-dark() tokens still resolve under Shell color-scheme.
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
    babel({
      // plugin-babel only auto-enables TS/JSX for CWD-relative globs. Workspace packages need this.
      exclude: [/[/\\]node_modules[/\\]/, rolldownRuntimeModulePattern],
      parserOpts: { plugins: ["typescript", "jsx"] },
      presets: [reactCompilerPreset()],
    }),
    tailwindcss(),
  ],
  optimizeDeps: {
    exclude: ["@honk/ui"],
  },
  resolve: {
    // @honk/ui is raw workspace source and keeps its own preview React install. The app must
    // always resolve UI primitives and Base UI onto the renderer's React singleton.
    dedupe: ["react", "react-dom"],
    // Prefer TS over stale generated .js siblings for extensionless imports.
    extensions: [".tsx", ".ts", ".mts", ".jsx", ".js", ".mjs", ".json"],
  },
  // Pin IPv4 loopback. Desktop probes 127.0.0.1 while Node may otherwise bind ::1-only.
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
  },
});
