import { ThreadId } from "@multi/contracts";
import { describe, expect, it } from "vitest";

import { resolveWorkbenchBrowserThreadId } from "./workbench-browser-scope";

describe("resolveWorkbenchBrowserThreadId", () => {
  it("returns the default workbench scope when cwd is missing", () => {
    expect(resolveWorkbenchBrowserThreadId(null)).toBe(ThreadId.make("workbench:browser:default"));
    expect(resolveWorkbenchBrowserThreadId("   ")).toBe(ThreadId.make("workbench:browser:default"));
  });

  it("scopes browser thread ids to workspace cwd", () => {
    expect(resolveWorkbenchBrowserThreadId("/repo")).toBe(ThreadId.make("workbench:browser:/repo"));
  });
});
