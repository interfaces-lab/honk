import { describe, expect, it } from "vitest";

import { buildAppearanceBaseColors } from "./appearance-colors";

describe("buildAppearanceBaseColors", () => {
  it("matches Cursor glass tint outputs for dark 210/60", () => {
    expect(buildAppearanceBaseColors("dark", 210, 60)).toEqual({
      "--honk-base-sidebar": "#0A1826",
      "--honk-base-chrome": "#0E141A",
      "--honk-base-editor": "#11181F",
      "--honk-base-accent": "#59A0E7",
      "--honk-base-focus": "#E4E4E4",
    });
  });
});
