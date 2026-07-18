import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  getRenderableToolPatch,
  sourceArtifactPatch,
  toolArtifactCanExpand,
  ToolArtifactPreview,
} from "./tool-artifact";
import { toolArtifact } from "./tool-artifact-normalizer";
import { ToolMessage } from "./tool-message";
import type { ToolPart } from "./tool-part-projection";
import { toolOutput } from "./tool-presentation";

function completedTool(
  tool: string,
  input: Record<string, unknown>,
  output: string,
  metadata: Record<string, unknown> = {},
  title = tool,
): ToolPart {
  return {
    id: `part-${tool}`,
    sessionID: "session-1",
    messageID: "message-1",
    type: "tool",
    callID: `call-${tool}`,
    tool,
    state: {
      status: "completed",
      input,
      output,
      title,
      metadata,
      time: { start: 1, end: 2 },
    },
  };
}

function runningTool(tool: string, metadata: Record<string, unknown>): ToolPart {
  return {
    id: `part-${tool}`,
    sessionID: "session-1",
    messageID: "message-1",
    type: "tool",
    callID: `call-${tool}`,
    tool,
    state: {
      status: "running",
      input: {},
      title: tool,
      metadata,
      time: { start: 1 },
    },
  } as ToolPart;
}

describe("tool artifact normalization", () => {
  it("keeps the newest rolling command output visible", () => {
    const rollingOutput = `stale:${"x".repeat(2_400)}:newest`;
    const output = toolOutput(runningTool("bash", { output: rollingOutput }));

    expect(output?.startsWith("…")).toBe(true);
    expect(output).toContain(":newest");
    expect(output).not.toContain("stale:");
  });

  it("normalizes OpenCode's structured read display into a source artifact", () => {
    const content = `export const value = "${"x".repeat(3_000)}";`;
    const part = completedTool("read", { filePath: "src/value.ts" }, content, {
      display: {
        type: "file",
        path: "/repo/src/value.ts",
        text: "export const value = 1;\nexport const other = 2;",
        lineStart: 41,
        lineEnd: 42,
        totalLines: 80,
        truncated: true,
      },
    });

    expect(toolArtifact(part)).toEqual({
      kind: "source",
      operation: "read",
      path: "/repo/src/value.ts",
      contents: "export const value = 1;\nexport const other = 2;",
      lineStart: 41,
      lineEnd: 42,
      totalLines: 80,
      truncated: true,
      files: [{ path: "/repo/src/value.ts", additions: 0, deletions: 0 }],
    });
    expect(toolOutput(part)).toBeUndefined();
    expect(
      toolOutput(completedTool("edit", { filePath: "src/value.ts" }, "Edit applied")),
    ).toBeUndefined();
  });

  it("builds a context-only Pierre patch with the original read line range", () => {
    const patch = sourceArtifactPatch(
      {
        kind: "source",
        operation: "read",
        path: "src/value.ts",
        contents: "one\ntwo\nthree\nfour\nfive",
        lineStart: 41,
        lineEnd: 45,
        totalLines: 90,
        truncated: true,
        files: [{ path: "src/value.ts", additions: 0, deletions: 0 }],
      },
      false,
    );
    const renderable = getRenderableToolPatch(patch);

    expect(patch).toContain("@@ -41,4 +41,4 @@");
    expect(renderable?.kind).toBe("files");
    if (renderable?.kind !== "files") return;
    expect(renderable.files[0]?.hunks[0]?.additionStart).toBe(41);
    expect(renderable.files[0]?.hunks[0]?.unifiedLineCount).toBe(4);
  });

  it("normalizes OpenCode edit metadata into a parseable file patch", () => {
    const part = completedTool("edit", { filePath: "src/value.ts" }, "Edit applied", {
      diff: "@@ -1 +1 @@\n-export const value = 1;\n+export const value = 2;",
    });

    expect(toolArtifact(part)).toEqual({
      kind: "diff",
      patch: [
        "--- a/src/value.ts",
        "+++ b/src/value.ts",
        "@@ -1 +1 @@",
        "-export const value = 1;",
        "+export const value = 2;",
      ].join("\n"),
      files: [{ path: "src/value.ts", additions: 1, deletions: 1 }],
    });
  });

  it("accepts OpenCode's filediff metadata projection", () => {
    const artifact = toolArtifact(
      completedTool("edit", {}, "Edit applied", {
        filediff: {
          file: "src/value.ts",
          patch: "@@ -1 +1 @@\n-export const value = 1;\n+export const value = 2;",
          additions: 1,
          deletions: 1,
        },
      }),
    );

    expect(artifact).toMatchObject({
      kind: "diff",
      files: [{ path: "src/value.ts", additions: 1, deletions: 1 }],
    });
  });

  it("preserves every apply_patch file instead of flattening it to a file summary", () => {
    const part = completedTool("apply_patch", {}, "Done", {
      files: [
        {
          relativePath: "src/a.ts",
          patch: "@@ -1 +1 @@\n-old a\n+new a",
          additions: 1,
          deletions: 1,
        },
        {
          relativePath: "src/b.ts",
          patch: "@@ -2 +2 @@\n-old b\n+new b",
          additions: 1,
          deletions: 1,
        },
      ],
    });
    const artifact = toolArtifact(part);

    expect(artifact?.kind).toBe("diff");
    if (artifact?.kind !== "diff") return;
    expect(artifact.files.map((file) => file.path)).toEqual(["src/a.ts", "src/b.ts"]);
    expect(artifact.patch).toContain("+++ b/src/a.ts");
    expect(artifact.patch).toContain("+++ b/src/b.ts");
  });

  it("uses completed write content as a source preview when no prior content was observed", () => {
    const part = completedTool(
      "write",
      { filePath: "src/new.ts", content: "const one = 1;\nconst two = 2;\n" },
      "Wrote src/new.ts",
    );
    const artifact = toolArtifact(part);

    expect(artifact).toEqual({
      kind: "source",
      operation: "write",
      path: "src/new.ts",
      contents: "const one = 1;\nconst two = 2;\n",
      lineStart: 1,
      lineEnd: 3,
      totalLines: 3,
      truncated: false,
      files: [{ path: "src/new.ts", additions: 0, deletions: 0 }],
    });
  });

  it("uses an observed write diff instead of inferring file history", () => {
    const artifact = toolArtifact(
      completedTool("write", { filePath: "src/value.ts", content: "const value = 2;" }, "Done", {
        diff: "@@ -1 +1 @@\n-const value = 1;\n+const value = 2;",
      }),
    );

    expect(artifact).toMatchObject({
      kind: "diff",
      files: [{ path: "src/value.ts", additions: 1, deletions: 1 }],
    });
  });
});

describe("tool artifact rendering", () => {
  it("uses one collapsed context line and three expanded context lines", () => {
    const patch = [
      "--- a/value.ts",
      "+++ b/value.ts",
      "@@ -1,9 +1,9 @@",
      " one",
      " two",
      " three",
      " four",
      "-old",
      "+new",
      " six",
      " seven",
      " eight",
      " nine",
    ].join("\n");
    const collapsed = getRenderableToolPatch(patch, 1);
    const expanded = getRenderableToolPatch(patch, 3);

    expect(collapsed?.kind).toBe("files");
    expect(expanded?.kind).toBe("files");
    if (collapsed?.kind !== "files" || expanded?.kind !== "files") return;
    expect(collapsed.files[0]?.unifiedLineCount).toBe(7);
    expect(expanded.files[0]?.unifiedLineCount).toBe(9);
  });

  it("does not hide large diffs behind an unobserved local threshold", () => {
    const large = getRenderableToolPatch(
      [
        "--- a/big.ts",
        "+++ b/big.ts",
        "@@ -0,0 +1,650 @@",
        ...Array.from({ length: 650 }, (_, index) => `+line ${String(index + 1)}`),
      ].join("\n"),
    );

    expect(large?.kind).toBe("files");
  });

  it("offers disclosure only when an edit exceeds the four-row collapsed preview", () => {
    const short = toolArtifact(
      completedTool("edit", { filePath: "value.ts" }, "Done", {
        diff: "@@ -1 +1 @@\n-old\n+new",
      }),
    );
    const long = toolArtifact(
      completedTool("edit", { filePath: "value.ts" }, "Done", {
        diff: "@@ -1,3 +1,3 @@\n-old one\n-old two\n+new one\n+new two\n same",
      }),
    );

    expect(short === undefined ? null : toolArtifactCanExpand(short)).toBe(false);
    expect(long === undefined ? null : toolArtifactCanExpand(long)).toBe(true);
  });

  it("renders a structured read as a Pierre source preview without a duplicate output strip", () => {
    const html = renderToStaticMarkup(
      <ToolMessage
        part={completedTool("read", { filePath: "src/value.ts" }, "human-facing output", {
          display: {
            type: "file",
            path: "src/value.ts",
            text: "export const value = 1;",
            lineStart: 1,
            lineEnd: 1,
            totalLines: 20,
            truncated: true,
          },
        })}
      />,
    );

    expect(html).toContain(">Read<");
    expect(html).toContain('data-tool-status="done"');
    expect(html).not.toContain(">Reading<");
    expect(html).toContain('data-tool-artifact="source"');
    expect(html).toContain('data-pierre-tool-source=""');
    expect(html).toContain("src/value.ts · lines 1–1");
    expect(html).not.toContain("truncated");
    expect(html).not.toContain("human-facing output");
    expect(html).not.toContain("data-work-preview-output");
  });

  it("renders completed write content in the source card without inventing diff stats", () => {
    const html = renderToStaticMarkup(
      <ToolMessage
        part={completedTool(
          "write",
          {
            filePath: "src/value.ts",
            content: "export const value = 1;\nexport const other = 2;",
          },
          "Wrote src/value.ts",
          { filepath: "/repo/src/value.ts", exists: true },
          "src/value.ts",
        )}
      />,
    );

    expect(html).toContain(">Edited<");
    expect(html).toContain("src/value.ts");
    expect(html).not.toContain("lines 1–2");
    expect(html).toContain('data-tool-artifact="source"');
    expect(html).toContain('data-pierre-tool-source=""');
    expect(html).not.toContain('data-pierre-tool-diff=""');
    expect(html).not.toContain("data-diff-stats");
    expect(html).not.toContain("Wrote src/value.ts");
    expect(html).not.toContain("data-work-preview-output");
  });

  it("keeps completed artifacts out of a collapsed compact work group", () => {
    const html = renderToStaticMarkup(
      <ToolMessage
        allowDisclosure={false}
        part={completedTool("read", { filePath: "src/value.ts" }, "human-facing output", {
          display: {
            type: "file",
            path: "src/value.ts",
            text: "export const value = 1;",
            lineStart: 1,
            lineEnd: 1,
            totalLines: 1,
            truncated: false,
          },
        })}
      />,
    );

    expect(html).toContain('data-tool-status="done"');
    expect(html).not.toContain("data-tool-artifact");
    expect(html).not.toContain("data-pierre-tool-source");
  });

  it("shows an honest raw fallback when Pierre cannot parse a diff", () => {
    const html = renderToStaticMarkup(
      <ToolArtifactPreview
        artifact={{
          kind: "diff",
          patch: "not a unified patch",
          files: [{ path: "value.ts", additions: 0, deletions: 0 }],
        }}
        isExpanded={false}
      />,
    );

    expect(html).toContain("Showing raw patch");
    expect(html).toContain("not a unified patch");
  });

  it("renders a resolved task as a live tray disclosure without the redundant raw output", () => {
    const html = renderToStaticMarkup(
      <ToolMessage
        part={completedTool(
          "task",
          { description: "Review the transcript", subagent_type: "honk-sidekick-high" },
          "Background task started",
        )}
        stateOverride="running"
        taskSelected
        onOpenTask={() => undefined}
      />,
    );

    expect(html).toContain('data-tool-status="running"');
    expect(html).toContain("Working");
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('aria-label="Working Review the transcript. Minimize work details"');
    expect(html).toContain('aria-controls="task-tool-region:part-task"');
    expect(html).not.toContain("Background task started");
    expect(html).not.toContain("data-work-preview-output");
  });

  it("keeps a task failure available when no child transcript exists", () => {
    const part: ToolPart = {
      id: "part-task-error",
      sessionID: "session-1",
      messageID: "message-1",
      type: "tool",
      callID: "call-task-error",
      tool: "task",
      state: {
        status: "error",
        input: { description: "Review the transcript" },
        error: "The delegated task could not start",
        metadata: {},
        time: { start: 1, end: 2 },
      },
    };
    const html = renderToStaticMarkup(<ToolMessage part={part} defaultExpanded />);

    expect(html).toContain('data-tool-status="failed"');
    expect(html).toContain("Work failed");
    expect(html).toContain("The delegated task could not start");
    expect(html).not.toContain("work details");
  });
});
