import { defineConfig } from "tsdown";

const shared = {
  outDir: "dist-electron",
  sourcemap: true,
};

function isWorkspacePackage(id: string): boolean {
  return id.startsWith("@multi/");
}

function isBareImport(id: string): boolean {
  return !id.startsWith(".") && !id.startsWith("/") && !id.startsWith("\0");
}

export default defineConfig([
  {
    ...shared,
    format: "esm",
    entry: ["src/main.ts"],
    clean: true,
    outExtensions: () => ({ js: ".mjs" }),
    deps: {
      alwaysBundle: isWorkspacePackage,
      neverBundle: (id) => isBareImport(id) && !isWorkspacePackage(id),
    },
  },
  {
    ...shared,
    format: "cjs",
    entry: ["src/preload.ts"],
    outExtensions: () => ({ js: ".cjs" }),
  },
]);
