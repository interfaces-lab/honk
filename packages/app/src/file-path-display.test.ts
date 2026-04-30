import { describe, expect, it } from "vitest";

import { formatWorkspaceRelativePath } from "./file-path-display";

describe("formatWorkspaceRelativePath", () => {
  it("formats absolute workspace paths from the workspace root", () => {
    expect(
      formatWorkspaceRelativePath(
        "C:/Users/mike/dev-stuff/multi/packages/app/src/session-logic.ts:501",
        "C:/Users/mike/dev-stuff/multi",
      ),
    ).toBe("multi/packages/app/src/session-logic.ts:501");
  });

  it("prefixes relative paths with the workspace root label", () => {
    expect(
      formatWorkspaceRelativePath(
        "packages/app/src/session-logic.ts:501",
        "C:/Users/mike/dev-stuff/multi",
      ),
    ).toBe("multi/packages/app/src/session-logic.ts:501");
  });

  it("keeps paths already rooted at the workspace label stable", () => {
    expect(
      formatWorkspaceRelativePath(
        "multi/packages/app/src/session-logic.ts:501",
        "C:/Users/mike/dev-stuff/multi",
      ),
    ).toBe("multi/packages/app/src/session-logic.ts:501");
  });

  it("preserves columns when present", () => {
    expect(
      formatWorkspaceRelativePath(
        "/C:/Users/mike/dev-stuff/multi/packages/app/src/session-logic.ts:501:9",
        "C:/Users/mike/dev-stuff/multi",
      ),
    ).toBe("multi/packages/app/src/session-logic.ts:501:9");
  });
});
