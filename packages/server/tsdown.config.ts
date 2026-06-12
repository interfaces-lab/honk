import { defineConfig } from "tsdown";

function isBundledWorkspacePackage(id: string): boolean {
  if (id.startsWith("@honk/")) {
    return true;
  }

  return false;
}

export default defineConfig({
  entry: ["src/bin.ts"],
  format: ["esm", "cjs"],
  checks: {
    legacyCjs: false,
  },
  outDir: "dist",
  sourcemap: true,
  clean: true,
  deps: {
    alwaysBundle: isBundledWorkspacePackage,
    onlyBundle: false,
  },
  banner: {
    js: "#!/usr/bin/env node\n",
  },
});
