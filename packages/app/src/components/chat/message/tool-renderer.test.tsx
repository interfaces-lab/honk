import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  hasRenderableText,
  hasShellToolPotentialOutput,
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
    expect(
      resolveEffectiveToolCallDensity("compact-all-grouped", { status: "pending" }),
    ).toBe("detailed");
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
});
