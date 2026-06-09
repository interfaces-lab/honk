import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DefaultResourceLoader } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";

import { applyFffEnvironment, resolveFffExtensionPaths } from "../src/fff-extension";

describe("fff extension loading", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      const tempDir = tempDirs.pop();
      if (tempDir && existsSync(tempDir)) {
        rmSync(tempDir, { recursive: true, force: true });
      }
    }
  });

  function createTempDir(): string {
    const tempDir = mkdtempSync(join(tmpdir(), "multi-fff-extension-"));
    tempDirs.push(tempDir);
    return tempDir;
  }

  it("loads pi-fff under noExtensions and registers override tool names", async () => {
    const previousMode = process.env.PI_FFF_MODE;
    const previousMultiGrep = process.env.PI_FFF_MULTIGREP;
    delete process.env.PI_FFF_MODE;
    delete process.env.PI_FFF_MULTIGREP;
    applyFffEnvironment();

    try {
      const tempDir = createTempDir();
      const loader = new DefaultResourceLoader({
        cwd: tempDir,
        agentDir: tempDir,
        noExtensions: true,
        noSkills: true,
        noPromptTemplates: true,
        noThemes: true,
        additionalExtensionPaths: resolveFffExtensionPaths(),
      });

      await loader.reload();

      const extensionsResult = loader.getExtensions();
      const toolNames = new Set(
        extensionsResult.extensions.flatMap((extension) => [...extension.tools.keys()]),
      );
      expect(extensionsResult.errors).toEqual([]);
      expect(toolNames.has("grep")).toBe(true);
      expect(toolNames.has("find")).toBe(true);
      expect(toolNames.has("ffgrep")).toBe(false);
      expect(toolNames.has("fffind")).toBe(false);
    } finally {
      if (previousMode === undefined) {
        delete process.env.PI_FFF_MODE;
      } else {
        process.env.PI_FFF_MODE = previousMode;
      }
      if (previousMultiGrep === undefined) {
        delete process.env.PI_FFF_MULTIGREP;
      } else {
        process.env.PI_FFF_MULTIGREP = previousMultiGrep;
      }
    }
  });
});
