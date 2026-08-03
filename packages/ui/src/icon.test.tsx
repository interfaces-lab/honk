import { renderToStaticMarkup } from "react-dom/server";
import { IconGlobe } from "central-icons";
import { describe, expect, it } from "vitest";
import { vi } from "vitest";

vi.mock("@stylexjs/stylex", () => ({
  create: <T,>(styles: T) => styles,
  createTheme: <T,>(_variables: unknown, values: T) => values,
  defineVars: <T,>(values: T) => values,
  props: () => ({}),
}));

import { Icon } from "./icon";

describe("Icon", () => {
  it("renders Central Icons as raw paths instead of the unsupported mask fallback", () => {
    const html = renderToStaticMarkup(<Icon icon={IconGlobe} />);

    expect(html).not.toContain("<mask");
    expect(html).not.toContain('mask="url(');
    expect(html).toContain("<path");
  });
});
