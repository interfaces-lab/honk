import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { normalizeAdditionalExtensionPaths } from "../src/extension-paths";

describe("normalizeAdditionalExtensionPaths", () => {
  it("expands an extensions directory to extension entries", () => {
    const cwd = mkdtempSync(join(tmpdir(), "honk-extension-paths-"));
    const extensionsDir = join(cwd, "extensions");
    mkdirSync(join(extensionsDir, "pi-extensions"), { recursive: true });
    mkdirSync(join(extensionsDir, "tools"));
    writeFileSync(join(extensionsDir, "local.ts"), "export default function () {}\n");
    writeFileSync(join(extensionsDir, "README.md"), "ignore me\n");

    expect(normalizeAdditionalExtensionPaths(["extensions"], cwd)).toEqual([
      join(extensionsDir, "local.ts"),
      join(extensionsDir, "pi-extensions"),
      join(extensionsDir, "tools"),
    ]);
  });

  it("expands extensions/* entries because pi package sources do not glob local paths", () => {
    const cwd = mkdtempSync(join(tmpdir(), "honk-extension-paths-"));
    const extensionsDir = join(cwd, "extensions");
    mkdirSync(join(extensionsDir, "pi-extensions"), { recursive: true });

    expect(normalizeAdditionalExtensionPaths(["extensions/*"], cwd)).toEqual([
      join(extensionsDir, "pi-extensions"),
    ]);
  });

  it("leaves non-extension paths unchanged", () => {
    expect(normalizeAdditionalExtensionPaths(["./custom-extension.ts"], "/tmp/project")).toEqual([
      "./custom-extension.ts",
    ]);
  });
});
