import { describe, expect, it, vi } from "vitest";

vi.mock("@stylexjs/stylex", () => ({
  createTheme: <T>(_variables: unknown, values: T) => values,
  defineVars: <T extends Readonly<Record<string, unknown>>>(values: T) =>
    Object.fromEntries(Object.keys(values).map((name) => [name, `var(${name})`])) as {
      [Key in keyof T]: string;
    },
}));

import { fontVars, proseDefaults } from "./tokens.stylex";

describe("prose typography tokens", () => {
  it("follows the interface typography variable with relative Cursor metrics", () => {
    expect(proseDefaults["--honk-prose-size"]).toBe(fontVars["--honk-text-title"]);
    expect(proseDefaults["--honk-prose-leading"]).toBe("1.6");
    expect(proseDefaults["--honk-prose-inline-code-size"]).toBe("0.9em");
    expect(proseDefaults["--honk-prose-heading-1-size"]).toBe("1.571em");
    expect(proseDefaults["--honk-prose-heading-2-size"]).toBe("1.428em");
    expect(proseDefaults["--honk-prose-heading-3-size"]).toBe("1.214em");
  });

  it("uses Cursor's compact markdown rhythm", () => {
    expect(proseDefaults["--honk-prose-flow-gap"]).toBe("8px");
    expect(proseDefaults["--honk-prose-tight-gap"]).toBe("4px");
    expect(proseDefaults["--honk-prose-heading-1-gap"]).toBe("20px");
    expect(proseDefaults["--honk-prose-section-gap"]).toBe("16px");
    expect(proseDefaults["--honk-prose-list-indent"]).toBe("2em");
  });
});
