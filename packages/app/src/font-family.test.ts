import { describe, expect, it } from "vitest";

import { fontFamilyCssValue, normalizeFontFamily } from "./font-family";

describe("font family values", () => {
  it("normalizes safe local family names", () => {
    expect(normalizeFontFamily("  JetBrains Mono  ")).toBe("JetBrains Mono");
    expect(normalizeFontFamily("A".repeat(500))).toHaveLength(500);
  });

  it.each(["", "A".repeat(501), "Bad; color: red", "Bad}", "url(font.woff2)", "Bad\nFont"])(
    "rejects unsafe family %j",
    (family) => {
      expect(normalizeFontFamily(family)).toBeNull();
    },
  );

  it("quotes a selected family before the trusted fallback stack", () => {
    expect(fontFamilyCssValue('Operator "Mono"', "Menlo, monospace")).toBe(
      '"Operator \\"Mono\\"", Menlo, monospace',
    );
    expect(fontFamilyCssValue("url(font.woff2)", "Menlo, monospace")).toBe("Menlo, monospace");
  });
});
