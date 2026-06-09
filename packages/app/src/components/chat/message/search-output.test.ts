import { describe, expect, it } from "vitest";

import { parseFindOutput, parseGrepOutput } from "./search-output";

describe("search output parser", () => {
  it("parses pi-fff grouped grep output with file annotations", () => {
    expect(
      parseGrepOutput(
        [
          "packages/app/src/session-logic.ts  [modified in git]",
          " 42: export interface ToolSearchArtifact {",
          " 43-   type: \"search\";",
          "",
          "packages/runtime/src/display-timeline-projection.ts",
          " 101: function projectRuntimeToolDisplay() {}",
        ].join("\n"),
      ),
    ).toEqual({
      kind: "grep",
      files: [
        {
          path: "packages/app/src/session-logic.ts",
          annotation: "modified in git",
          lines: [
            {
              lineNumber: 42,
              separator: ":",
              text: "export interface ToolSearchArtifact {",
            },
            {
              lineNumber: 43,
              separator: "-",
              text: "  type: \"search\";",
            },
          ],
        },
        {
          path: "packages/runtime/src/display-timeline-projection.ts",
          lines: [
            {
              lineNumber: 101,
              separator: ":",
              text: "function projectRuntimeToolDisplay() {}",
            },
          ],
        },
      ],
    });
  });

  it("parses find output paths and strips trailing annotations", () => {
    expect(
      parseFindOutput(
        [
          "packages/app/src/components/chat/message/tool-renderer.tsx  [often touched file]",
          "packages/runtime/src/fff-extension.ts  [modified in git]",
          "",
          "[38 more matches available. cursor=\"1\" to continue]",
        ].join("\n"),
      ),
    ).toEqual({
      kind: "find",
      files: [
        {
          path: "packages/app/src/components/chat/message/tool-renderer.tsx",
          annotation: "often touched file",
        },
        {
          path: "packages/runtime/src/fff-extension.ts",
          annotation: "modified in git",
        },
      ],
    });
  });

  it("falls back for unstructured grep output", () => {
    expect(parseGrepOutput("No matches found")).toEqual({
      kind: "fallback",
      text: "No matches found",
    });
  });
});
