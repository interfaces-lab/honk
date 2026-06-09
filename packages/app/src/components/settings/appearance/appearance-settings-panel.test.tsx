import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AppearanceSettingsPanel } from "./appearance-settings-panel";

describe("AppearanceSettingsPanel", () => {
  it("renders tool call density in the Agent Window section", () => {
    const html = renderToStaticMarkup(<AppearanceSettingsPanel />);

    expect(html).toContain("Tool call density");
    expect(html).toContain('aria-label="Tool call density"');
    expect(html).toContain("Adjust how much detail is shown for tool calls.");
    expect(html).toContain('data-density-preview="combined"');
  });
});
