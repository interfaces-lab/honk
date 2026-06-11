import { describe, expect, it } from "vitest";

import { isWorkbenchTab, WORKBENCH_TABS } from "./workbench-tabs";

describe("workbench tabs", () => {
  it("accepts the browser tab", () => {
    expect(WORKBENCH_TABS).toContain("browser");
    expect(isWorkbenchTab("browser")).toBe(true);
  });
});
