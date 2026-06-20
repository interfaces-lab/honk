import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { applyCodexPatch, formatFileDiff } from "../src/codex-apply-patch-extension";

function lines(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `line ${index + 1}`);
}

describe("formatFileDiff", () => {
  it("emits a compact hunk for a small change in a large file", () => {
    const oldLines = lines(200);
    const newLines = [...oldLines];
    newLines[99] = "line 100 changed";

    const diff = formatFileDiff("big.ts", `${oldLines.join("\n")}\n`, `${newLines.join("\n")}\n`);

    expect(diff).toContain("diff --git a/big.ts b/big.ts");
    expect(diff).toContain("@@ -97,7 +97,7 @@");
    expect(diff).toContain(" line 97");
    expect(diff).toContain("-line 100");
    expect(diff).toContain("+line 100 changed");
    expect(diff).not.toContain(" line 1\n");
    expect(diff).not.toContain(" line 200");
    expect(diff.split("\n")).toHaveLength(12);
  });

  it("splits distant changes into separate hunks", () => {
    const oldLines = lines(120);
    const newLines = [...oldLines];
    newLines[9] = "line 10 changed";
    newLines[89] = "line 90 changed";

    const diff = formatFileDiff("spread.ts", oldLines.join("\n"), newLines.join("\n"));

    expect(diff.match(/^@@ /gm)).toHaveLength(2);
    expect(diff).toContain("@@ -7,7 +7,7 @@");
    expect(diff).toContain("@@ -87,7 +87,7 @@");
    expect(diff).not.toContain(" line 50\n");
  });
});

describe("applyCodexPatch", () => {
  it("returns a unified patch for the applied change", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "honk-apply-patch-"));
    try {
      await writeFile(join(cwd, "example.ts"), "export const value = 1;\n", "utf8");

      const result = await applyCodexPatch({
        cwd,
        patchText: `*** Begin Patch
*** Update File: example.ts
@@
-export const value = 1;
+export const value = 2;
*** End Patch`,
      });

      expect(result.status).toBe("success");
      expect(result.patch).toContain("diff --git a/example.ts b/example.ts");
      expect(result.patch).toContain("--- a/example.ts");
      expect(result.patch).toContain("+++ b/example.ts");
      expect(result.patch).toContain("-export const value = 1;");
      expect(result.patch).toContain("+export const value = 2;");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("returns the applied patch hunks instead of a full-file generated diff", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "honk-apply-patch-"));
    try {
      await writeFile(join(cwd, "big.ts"), `${lines(200).join("\n")}\n`, "utf8");

      const result = await applyCodexPatch({
        cwd,
        patchText: `*** Begin Patch
*** Update File: big.ts
@@
 line 99
-line 100
+line 100 changed
 line 101
*** End Patch`,
      });

      expect(result.status).toBe("success");
      expect(result.patch).toContain("diff --git a/big.ts b/big.ts");
      expect(result.patch).toContain(" line 99");
      expect(result.patch).toContain("-line 100");
      expect(result.patch).toContain("+line 100 changed");
      expect(result.patch).not.toContain(" line 1\n");
      expect(result.patch).not.toContain(" line 200");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
