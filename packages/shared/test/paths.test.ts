import { describe, expect, it } from "vitest";

import { basename } from "../src/paths";

describe("basename", () => {
  it.each([
    ["", ""],
    ["/", "/"],
    ["\\\\", "\\\\"],
    ["/workspace/honk/", "honk"],
    ["C:\\workspace\\honk\\", "honk"],
    ["C:\\", "C:"],
  ])("renders %j as %j", (path, expected) => {
    expect(basename(path)).toBe(expected);
  });
});
