import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@stylexjs/stylex", () => ({
  create: <T,>(styles: T) => styles,
  createTheme: () => ({}),
  defineVars: <T,>(values: T) => values,
  keyframes: () => "",
  props: () => ({}),
}));

import { IconBuildingBlocks } from "@honk/ui/icons";

import { Chip, ChipIcon } from "./chip";

describe("composer inline chips", () => {
  it("renders the Skills glyph inside a decorative chip icon", () => {
    expect(renderToStaticMarkup(<ChipIcon icon={IconBuildingBlocks} />)).toContain(
      'aria-hidden="true"',
    );
  });

  it("keeps the pointer-only remove control out of the accessibility tree and the tab order", () => {
    const html = renderToStaticMarkup(
      <Chip
        tooltip="packages/app/src/index.ts"
        label="index.ts"
        isSelected={false}
        icon={<ChipIcon icon={IconBuildingBlocks} />}
        onRemove={() => undefined}
      />,
    );

    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain("data-canonical-control-exception");
    expect(html).toContain("index.ts");
  });
});
