import { renderToStaticMarkup } from "react-dom/server";
import type { CSSProperties } from "react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@stylexjs/stylex", () => ({
  create: <T,>(styles: T) => styles,
  createTheme: <T,>(_variables: unknown, values: T) => values,
  defineVars: <T,>(values: T) => values,
  props: (...styles: (CSSProperties | false | null | undefined)[]) => {
    const merged = Object.assign({}, ...styles.filter(Boolean));
    const attribute = (property: keyof CSSProperties): string | undefined => {
      const value = merged[property];
      return typeof value === "string" || typeof value === "number" ? String(value) : undefined;
    };
    return {
      "data-block-start": attribute("marginBlockStart") ?? attribute("marginBlock"),
      "data-block-end": attribute("marginBlockEnd") ?? attribute("marginBlock"),
      "data-gap": attribute("gap"),
      "data-font-size": attribute("fontSize"),
      "data-line-height": attribute("lineHeight"),
      "data-background-color": attribute("backgroundColor"),
      "data-color": attribute("color"),
      "data-font-family": attribute("fontFamily"),
    };
  },
}));

import { Prose } from "./prose";

describe("Prose", () => {
  it("treats list items as markdown spacing boundaries", () => {
    const html = renderToStaticMarkup(
      <Prose>
        <Prose.Heading level={2}>Changed</Prose.Heading>
        <Prose.List>
          <Prose.ListItem>
            <Prose.Paragraph>packages/app/src/tool-artifact.tsx</Prose.Paragraph>
            <Prose.List>
              <Prose.ListItem>
                <Prose.Paragraph>Trims and parses each patch independently.</Prose.Paragraph>
              </Prose.ListItem>
            </Prose.List>
          </Prose.ListItem>
        </Prose.List>
      </Prose>,
    );

    expect(
      html.match(/data-slot="prose-paragraph" data-block-start="0" data-block-end="0"/g),
    ).toHaveLength(2);
    expect(html).toMatch(/data-slot="prose-list" data-block-start="8px"[^>]*data-gap="8px"/);
    expect(html).toMatch(/data-slot="prose-list" data-block-start="4px"[^>]*data-gap="8px"/);
  });

  it("keeps typography relative to the interface prose root", () => {
    const html = renderToStaticMarkup(
      <Prose>
        <Prose.Heading level={1}>Heading one</Prose.Heading>
        <Prose.Heading level={2}>Heading two</Prose.Heading>
        <Prose.Heading level={3}>Heading three</Prose.Heading>
      </Prose>,
    );

    expect(html).toContain('data-slot="prose" data-font-size="14px" data-line-height="1.6"');
    expect(html).toContain('data-font-size="1.571em" data-line-height="1.42"');
    expect(html).toContain('data-font-size="1.428em" data-line-height="1.42"');
    expect(html).toContain('data-font-size="1.214em" data-line-height="1.42"');
  });

  it("uses one paint treatment for inline and fenced code", () => {
    const html = renderToStaticMarkup(
      <Prose>
        <Prose.InlineCode>inline</Prose.InlineCode>
        <Prose.CodeBlock>fenced</Prose.CodeBlock>
      </Prose>,
    );
    const treatments = [
      ...html.matchAll(
        /data-background-color="([^"]+)" data-color="([^"]+)" data-font-family="([^"]+)"/g,
      ),
    ];

    expect(treatments).toHaveLength(2);
    expect(treatments[0]?.slice(1)).toEqual(treatments[1]?.slice(1));
    expect(treatments[0]?.[1]).not.toBe("transparent");
  });
});
