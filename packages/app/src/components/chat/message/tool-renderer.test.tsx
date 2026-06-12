import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  hasRenderableText,
  hasShellToolPotentialOutput,
  isEditStatusSummary,
  resolveEffectiveToolCallDensity,
  resolveStreamingShellOutput,
  ToolCallRenderer,
} from "./tool-renderer";

describe("tool renderer shell output helpers", () => {
  it("detects renderable shell output without trimming the full string", () => {
    expect(hasRenderableText(null)).toBe(false);
    expect(hasRenderableText(" \n\t\r")).toBe(false);
    expect(hasRenderableText("\n  pushed to origin")).toBe(true);
  });

  it("uses output presence as the collapsed shell expansion predicate", () => {
    expect(hasShellToolPotentialOutput(null)).toBe(false);
    expect(hasShellToolPotentialOutput("")).toBe(false);
    expect(hasShellToolPotentialOutput(" \n")).toBe(true);
  });

  it("shows only the latest complete output lines while a large command is streaming", () => {
    const output = `${"x".repeat(12_010)}\nlatest line`;

    expect(resolveStreamingShellOutput(output, true)).toEqual({
      text: "latest line",
      truncated: true,
    });
    expect(resolveStreamingShellOutput(output, false)).toEqual({
      text: output,
      truncated: false,
    });
  });
});

describe("tool renderer conversation density", () => {
  it("forces detailed layout while approval is pending", () => {
    expect(resolveEffectiveToolCallDensity("compact-all-grouped", { status: "pending" })).toBe(
      "detailed",
    );
  });

  it("renders pending-approval shells as detailed cards at compact density", () => {
    const html = renderToStaticMarkup(
      <ToolCallRenderer
        toolCall={{
          tool: {
            case: "shellToolCall",
            value: {
              action: "Running",
              details: "git push origin main",
              command: "git push origin main",
              output: "Pushing to origin",
            },
          },
        }}
        approval={{ status: "pending" }}
        conversationDensity="compact-all-grouped"
      />,
    );

    expect(html).toContain("data-shell-tool-call-output");
  });

  it("renders compact shells as text-only lines", () => {
    const html = renderToStaticMarkup(
      <ToolCallRenderer
        toolCall={{
          tool: {
            case: "shellToolCall",
            value: {
              action: "Ran",
              details: "git status --short",
              command: "git status --short",
              output: "M file.ts",
            },
          },
        }}
        conversationDensity="compact-all-grouped"
      />,
    );

    expect(html).toContain("data-tool-call-line");
    expect(html).not.toContain("data-shell-tool-call-body");
    expect(html).not.toContain("data-shell-tool-call-output");
  });

  it("renders detailed shells with collapsed output preview blocks", () => {
    const html = renderToStaticMarkup(
      <ToolCallRenderer
        toolCall={{
          tool: {
            case: "shellToolCall",
            value: {
              action: "Ran",
              details: "git status --short",
              command: "git status --short",
              output: "M file.ts",
            },
          },
        }}
        conversationDensity="detailed"
      />,
    );

    expect(html).toContain("data-shell-tool-call");
    expect(html).toContain("data-shell-tool-call-output");
    expect(html).toContain("M file.ts");
  });

  it("renders grep search rows with matched file counts derived from output", () => {
    const html = renderToStaticMarkup(
      <ToolCallRenderer
        toolCall={{
          tool: {
            case: "grepToolCall",
            value: {
              action: "Grepped",
              details: "ToolSearchArtifact",
              output: [
                "packages/app/src/session-logic.ts",
                " 42: export interface ToolSearchArtifact {",
              ].join("\n"),
              artifacts: [
                {
                  type: "search",
                  flavor: "grep",
                  query: "ToolSearchArtifact",
                  output: [
                    "packages/app/src/session-logic.ts",
                    " 42: export interface ToolSearchArtifact {",
                  ].join("\n"),
                  totalMatched: 2,
                  totalIndexedFiles: 100,
                },
              ],
            },
          },
        }}
        defaultExpanded
      />,
    );

    expect(html).toContain("data-search-tool-call");
    expect(html).toContain('data-search-tool-flavor="grep"');
    expect(html).toContain("2 matches in 1 file");
    expect(html).not.toContain("100 files");
    expect(html).toContain("packages/app/src/session-logic.ts");
  });

  it("renders find search rows with visible result counts from totalMatched", () => {
    const html = renderToStaticMarkup(
      <ToolCallRenderer
        toolCall={{
          tool: {
            case: "globToolCall",
            value: {
              action: "Searched",
              details: "tool renderer",
              output: [
                "packages/app/src/components/chat/message/tool-renderer.tsx  [modified in git]",
                "packages/app/src/components/chat/message/search-output.ts",
              ].join("\n"),
              artifacts: [
                {
                  type: "search",
                  flavor: "find",
                  query: "tool renderer",
                  output: [
                    "packages/app/src/components/chat/message/tool-renderer.tsx  [modified in git]",
                    "packages/app/src/components/chat/message/search-output.ts",
                  ].join("\n"),
                  totalMatched: 40,
                  totalIndexedFiles: 100,
                  hasMore: true,
                },
              ],
            },
          },
        }}
        defaultExpanded
      />,
    );

    expect(html).toContain("data-search-tool-call");
    expect(html).toContain('data-search-tool-flavor="find"');
    expect(html).toContain("2 of 40 files + more");
    expect(html).not.toContain("100 files");
    expect(html).toContain("modified in git");
  });

  it("renders detailed edits with diff artifacts in a bordered preview", () => {
    const html = renderToStaticMarkup(
      <ToolCallRenderer
        toolCall={{
          tool: {
            case: "editToolCall",
            value: {
              action: "Edited",
              details: "math.ts",
              path: "math.ts",
              stats: { additions: 4, deletions: 1 },
              artifacts: [
                {
                  type: "diff",
                  format: "unified",
                  source: "preview",
                  files: [{ path: "math.ts", additions: 4, deletions: 1 }],
                  unifiedDiff: "@@ -1,3 +1,3 @@\n-old line\n+new line\n",
                },
              ],
            },
          },
        }}
        conversationDensity="detailed"
      />,
    );

    expect(html).toContain("border-honk-stroke-secondary");
    expect(html).toContain("-old line");
  });

  it("does not auto-open bordered previews for runtime status-only edit output", () => {
    const status = "Successfully replaced 2 block(s) in packages/app/src/chat-view.tsx";
    expect(isEditStatusSummary(status)).toBe(true);

    const html = renderToStaticMarkup(
      <ToolCallRenderer
        toolCall={{
          tool: {
            case: "editToolCall",
            value: {
              action: "Edited",
              details: "chat-view.tsx",
              path: "chat-view.tsx",
              output: status,
              stats: { additions: 2, deletions: 0 },
            },
          },
        }}
        conversationDensity="detailed"
      />,
    );

    expect(html).not.toContain("border-honk-stroke-secondary");
    expect(html).not.toContain(status);
  });

  it("renders compact grouped edits as header-only lines until expanded", () => {
    const html = renderToStaticMarkup(
      <ToolCallRenderer
        toolCall={{
          tool: {
            case: "editToolCall",
            value: {
              action: "Edited",
              details: "math.ts",
              path: "math.ts",
              output: "@@ -1 +1 @@\n-old\n+new",
              stats: { additions: 1, deletions: 1 },
            },
          },
        }}
        conversationDensity="compact-all-grouped"
      />,
    );

    expect(html).toContain("data-tool-call-line");
    expect(html).not.toContain("border-honk-stroke-secondary");
  });

  it("switches shell markers when density changes without changing tool payload", () => {
    const toolCall = {
      tool: {
        case: "shellToolCall" as const,
        value: {
          action: "Ran",
          details: "git status --short",
          command: "git status --short",
          output: "M file.ts",
        },
      },
    };
    const compactHtml = renderToStaticMarkup(
      <ToolCallRenderer toolCall={toolCall} conversationDensity="compact-all-grouped" />,
    );
    const detailedHtml = renderToStaticMarkup(
      <ToolCallRenderer toolCall={toolCall} conversationDensity="detailed" />,
    );

    expect(compactHtml).toContain("data-tool-call-line");
    expect(compactHtml).not.toContain("data-shell-tool-call-output");
    expect(detailedHtml).toContain("data-shell-tool-call");
    expect(detailedHtml).toContain("data-shell-tool-call-output");
  });
});
