import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    exclude: ["test/pi-source/**", "**/node_modules/**", "**/dist/**"],
  },
});
