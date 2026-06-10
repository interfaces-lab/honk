import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AppearanceSettingsPanel } from "./appearance-settings-panel";

describe("AppearanceSettingsPanel", () => {
  it("renders tool call density in the Chat section", () => {
    const html = renderToStaticMarkup(<AppearanceSettingsPanel />);

    expect(html).toContain("Chat");
    expect(html).toContain("Tool Call Density");
    expect(html).toContain('aria-label="Tool Call Density"');
    expect(html).toContain("Adjust how much detail is shown for tool calls");
    expect(html).toContain("Compact");
    expect(html).toContain("Detailed");
    expect(html).not.toContain("Balanced");
    expect(html).not.toContain('data-density-preview="combined"');
  });
});
