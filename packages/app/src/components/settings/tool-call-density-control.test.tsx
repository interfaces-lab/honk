import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ToolCallRenderer } from "../chat/message/tool-renderer";
import {
  PREVIEW_EDIT_TOOL_CALL,
  PREVIEW_SHELL_TOOL_CALL,
  ToolCallDensityPreview,
} from "./tool-call-density-control";

describe("ToolCallDensityPreview", () => {
  it("renders all three density preview modes", () => {
    const compact = renderToStaticMarkup(<ToolCallDensityPreview density="compact-all-grouped" />);
    const balanced = renderToStaticMarkup(<ToolCallDensityPreview density="compact-ungrouped" />);
    const detailed = renderToStaticMarkup(<ToolCallDensityPreview density="detailed" />);

    expect(compact).toContain('data-density-preview="combined"');
    expect(compact).toContain("data-work-group-header");
    expect(compact).toContain("Worked for briefly");
    expect(compact).toContain("2 files, ran 2 commands");

    expect(balanced).toContain('data-density-preview="rows"');
    expect(detailed).toContain('data-density-preview="cards"');
  });

  it("matches ToolCallRenderer markers for ungrouped fixture rows", () => {
    for (const density of ["compact-ungrouped", "detailed"] as const) {
      const preview = renderToStaticMarkup(<ToolCallDensityPreview density={density} />);
      const edit = renderToStaticMarkup(
        <ToolCallRenderer toolCall={PREVIEW_EDIT_TOOL_CALL} conversationDensity={density} />,
      );
      const shell = renderToStaticMarkup(
        <ToolCallRenderer toolCall={PREVIEW_SHELL_TOOL_CALL} conversationDensity={density} />,
      );

      if (density === "detailed") {
        expect(preview).toContain("border-multi-stroke-secondary");
        expect(edit).toContain("border-multi-stroke-secondary");
        expect(preview).toContain("data-shell-tool-call");
        expect(shell).toContain("data-shell-tool-call");
      } else {
        expect(preview).toContain("data-tool-call-line");
        expect(edit).toContain("data-tool-call-line");
        expect(shell).toContain("data-tool-call-line");
        expect(preview).not.toContain("data-shell-tool-call-output");
      }
    }
  });
});
