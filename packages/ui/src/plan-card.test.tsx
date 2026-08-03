import { renderToStaticMarkup } from "react-dom/server";
import type { CSSProperties, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@stylexjs/stylex", () => ({
  create: <T,>(styles: T) => styles,
  createTheme: <T,>(_variables: unknown, values: T) => values,
  defineVars: <T,>(values: T) => values,
  props: (style: CSSProperties) => ({ "data-align-items": style.alignItems }),
}));

vi.mock("./text", () => ({
  Text: ({
    children,
    size,
    style,
    tone,
    truncate,
  }: {
    children?: ReactNode;
    size?: string;
    style?: CSSProperties;
    tone?: string;
    truncate?: boolean;
  }) => (
    <span
      data-size={size}
      data-tone={tone}
      data-truncate={truncate === true ? "true" : "false"}
      data-overflow-wrap={style?.overflowWrap}
    >
      {children}
    </span>
  ),
}));

import { PlanCard } from "./plan-card";

describe("PlanCard", () => {
  it("keeps the full plan title and summary untruncated", () => {
    const html = renderToStaticMarkup(
      <PlanCard
        title="A title long enough to wrap across several lines"
        summary="A summary long enough to wrap across several lines without losing its ending"
      />,
    );

    expect(html).not.toContain('data-truncate="true"');
    expect(html).toContain('data-align-items="flex-start"');
    expect(html.match(/data-overflow-wrap="anywhere"/g)).toHaveLength(2);
    expect(html).toContain('data-size="lg" data-tone="inherit" data-truncate="false"');
    expect(html).toContain('data-size="base" data-tone="muted" data-truncate="false"');
    expect(html).toContain("A title long enough to wrap across several lines");
    expect(html).toContain(
      "A summary long enough to wrap across several lines without losing its ending",
    );
  });
});
