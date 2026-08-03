import stylex from "@stylexjs/unplugin";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Dev playground only — @honk/ui ships raw source; real consumers bring their own
// unplugin + optimizeDeps.exclude. StyleX must run before React;
// Tailwind runs after StyleX so utilities resolve against the emitted --honk-* vars
// via the bridge (src/tailwind.css), matching the @honk/app plugin order.
export default defineConfig({
  root: "dev",
  plugins: [
    stylex.vite({
      useCSSLayers: true,
      // The unplugin post-processes its CSS with lightningcss using browserslist DEFAULTS,
      // which downlevels light-dark() into the var(--lightningcss-light/dark) polyfill — and
      // that BREAKS the token system: tokens are custom properties declared at :root, and
      // var() inside a custom-property value resolves where the property is DECLARED, not
      // where it's used. The polyfill's helper toggles ride the color-scheme declarations
      // (the Shell frame, deeper in the tree), so at :root both fallbacks substitute and every color
      // token computes as two colors → invalid → transparent. light-dark() is Baseline 2024;
      // pin the first supporting engines ((major << 16) | (minor << 8)) so it passes through
      // and color-scheme keeps driving the themes.
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
});
