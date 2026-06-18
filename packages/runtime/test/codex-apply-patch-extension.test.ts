import { describe, expect, it } from "vitest";

import { formatFileDiff } from "../src/codex-apply-patch-extension";

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
