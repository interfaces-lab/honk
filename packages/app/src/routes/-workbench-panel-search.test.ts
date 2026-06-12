import { describe, expect, it } from "vitest";

import { parseWorkbenchPanelSearch } from "./-workbench-panel-search";

describe("workbench panel search", () => {
  it("keeps valid workbench panel values", () => {
    expect(parseWorkbenchPanelSearch({ panel: "terminal" })).toEqual({ panel: "terminal" });
    expect(parseWorkbenchPanelSearch({ panel: "browser" })).toEqual({ panel: "browser" });
  });

  it("normalizes invalid workbench panel values to empty search", () => {
    expect(parseWorkbenchPanelSearch({ panel: "unknown" })).toEqual({});
  });
});
