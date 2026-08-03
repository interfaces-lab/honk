import { describe, expect, it } from "vitest";

import { normalizeBrowserNavigationInput } from "./browser-url";

describe("normalizeBrowserNavigationInput", () => {
  it("normalizes URLs, localhost shortcuts, domains, and searches", () => {
    expect(normalizeBrowserNavigationInput("https://example.test/path")).toBe(
      "https://example.test/path",
    );
    expect(normalizeBrowserNavigationInput("localhost:5173")).toBe("http://localhost:5173");
    expect(normalizeBrowserNavigationInput("example.test")).toBe("https://example.test");
    expect(normalizeBrowserNavigationInput("open code docs")).toBe(
      "https://www.google.com/search?q=open%20code%20docs",
    );
  });
});
