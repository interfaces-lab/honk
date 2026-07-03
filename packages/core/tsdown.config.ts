// Bundle the workspace source (@honk/api resolves to .ts) into a single runnable
// entry; everything else (effect, @effect/platform-node, @lydell/node-pty, the
// harness SDKs, node:sqlite) stays external and resolves from node_modules at
// runtime — same posture as @honk/server's bin bundle. defineConfig is only a
// typing helper, so we export the plain object to avoid resolving tsdown from
// this package (the binary is invoked from @honk/server's node_modules).
function isBundledWorkspacePackage(id: string): boolean {
  return id.startsWith("@honk/");
}

export default {
  entry: ["src/main.ts"],
  format: ["esm"],
  platform: "node",
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
};
