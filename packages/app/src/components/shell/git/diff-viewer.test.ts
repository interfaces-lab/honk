import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(__dirname, "diff-viewer.tsx"), "utf8");
const gitDiffCardSource = readFileSync(resolve(__dirname, "git-diff-card.tsx"), "utf8");
const pierreFileDiffHookSource = readFileSync(
  resolve(
    __dirname,
    "../../../../node_modules/@pierre/diffs/dist/react/utils/useFileDiffInstance.js",
  ),
  "utf8",
);

describe("DiffViewer", () => {
  it("renders PatchDiff through the outer Pierre virtualizer context", () => {
    expect(source).toContain("<PatchDiff");
    expect(source).not.toContain("<CodeView");
    expect(source).not.toContain("VirtualizerContext");
    expect(source).not.toContain("value={undefined}");
  });

  it("does not make each expanded card a nested scroll container", () => {
    expect(gitDiffCardSource).toContain(
      'className="min-h-0 min-w-0 bg-(--multi-git-diff-editor-background) select-text"',
    );
    expect(gitDiffCardSource).not.toContain(
      "min-h-0 min-w-0 flex-1 overflow-auto bg-(--multi-git-diff-editor-background) select-text",
    );
    expect(gitDiffCardSource).not.toContain(
      "min-h-0 min-w-0 flex-1 overflow-hidden bg-(--multi-git-diff-editor-background) select-text",
    );
    expect(source).not.toContain("overflow-y-auto");
    expect(source).not.toContain("overscroll-contain");
  });

  it("keeps Pierre source behavior that virtualizes PatchDiff when a virtualizer exists", () => {
    expect(pierreFileDiffHookSource).toContain("const simpleVirtualizer = useVirtualizer()");
    expect(pierreFileDiffHookSource).toContain("new VirtualizedFileDiff");
    expect(pierreFileDiffHookSource).toContain("new FileDiff");
  });
});
