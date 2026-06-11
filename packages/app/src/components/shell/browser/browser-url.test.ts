import { describe, expect, it } from "vitest";

import { isLikelyBrowserUrl, normalizeBrowserNavigationInput } from "./browser-url";

describe("browser URL normalization", () => {
  it("keeps allowed schemes", () => {
    expect(normalizeBrowserNavigationInput("https://example.com/path")).toBe(
      "https://example.com/path",
    );
    expect(normalizeBrowserNavigationInput("http://example.com")).toBe("http://example.com");
    expect(normalizeBrowserNavigationInput("file:///tmp/index.html")).toBe(
      "file:///tmp/index.html",
    );
    expect(normalizeBrowserNavigationInput("about:blank")).toBe("about:blank");
  });

  it("adds http for localhost shortcuts", () => {
    expect(normalizeBrowserNavigationInput("localhost:5173")).toBe("http://localhost:5173");
    expect(normalizeBrowserNavigationInput("127.0.0.1:3000/app")).toBe(
      "http://127.0.0.1:3000/app",
    );
  });

  it("adds https for bare domains", () => {
    expect(normalizeBrowserNavigationInput("example.com")).toBe("https://example.com");
    expect(normalizeBrowserNavigationInput("docs.example.com/path")).toBe(
      "https://docs.example.com/path",
    );
  });

  it("searches terms and email-like values", () => {
    expect(normalizeBrowserNavigationInput("hello world")).toBe(
      "https://www.google.com/search?q=hello%20world",
    );
    expect(normalizeBrowserNavigationInput("user@example.com")).toBe(
      "https://www.google.com/search?q=user%40example.com",
    );
  });

  it("trims whitespace and ignores empty input", () => {
    expect(normalizeBrowserNavigationInput("  example.com  ")).toBe("https://example.com");
    expect(normalizeBrowserNavigationInput("   ")).toBeNull();
  });

  it("matches Cursor's likely URL predicate", () => {
    expect(isLikelyBrowserUrl("example.com")).toBe(true);
    expect(isLikelyBrowserUrl("localhost:5173")).toBe(true);
    expect(isLikelyBrowserUrl("hello world")).toBe(false);
    expect(isLikelyBrowserUrl("user@example.com")).toBe(false);
  });
});
