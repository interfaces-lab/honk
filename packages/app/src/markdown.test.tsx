import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Markdown } from "./markdown";

describe("Markdown", () => {
  it("keeps nested assistant lists inside the Prose spacing boundary", () => {
    const html = renderToStaticMarkup(
      <Markdown
        text={`## Changed

- \`packages/app/src/tool-artifact-normalizer.ts\`

  - Keeps patches attached to their individual files instead of flattening them.

- \`packages/app/src/tool-artifact.tsx\`

  - Trims and parses each file patch independently.`}
      />,
    );

    expect(html).toContain('data-slot="prose-heading"');
    expect(html.match(/data-slot="prose-list"/g)).toHaveLength(3);
    expect(html.match(/data-slot="prose-list-item"/g)).toHaveLength(4);
    expect(html.match(/data-slot="prose-paragraph"/g)).toHaveLength(2);
    expect(html).toMatch(
      /data-slot="prose-list-item"[^>]*>\s*<p data-slot="prose-paragraph"[^>]*><code[^>]*>packages\/app\/src\/tool-artifact-normalizer\.ts<\/code><\/p>\s*<ul data-slot="prose-list"/,
    );
  });

  it("renders fenced code with selectable editor rows and hidden line numbers", () => {
    const html = renderToStaticMarkup(
      <Markdown
        isStreaming
        text={`\`\`\`ts
const first = 1;
const second = 2;
\`\`\``}
      />,
    );

    expect(html).toContain('data-line-number="1"');
    expect(html).toContain('data-line-number="2"');
    expect(html).toContain('aria-hidden="true" data-slot="code-line-number"');
    expect(html).toContain("const first = 1;");
    expect(html).toContain("const second = 2;");
  });

  it("renders workspace links as file references when the workbench can open them", () => {
    const html = renderToStaticMarkup(
      <Markdown
        text={`[cursor-parity-handbook.md](docs/cursor-parity-handbook.md)

[effect.md](spec/effect.md)`}
        onOpenFile={() => undefined}
      />,
    );

    expect(html).toContain('href="docs/cursor-parity-handbook.md"');
    expect(html).toContain('title="Open docs/cursor-parity-handbook.md in workbench"');
    expect(html).toMatch(/<a[^>]*><code[^>]*>cursor-parity-handbook\.md<\/code><\/a>/);
    expect(html).toContain('href="spec/effect.md"');
    expect(html).toContain('title="Open spec/effect.md in workbench"');
    expect(html).not.toContain('target="_blank"');
  });

  it("keeps external links as regular prose links", () => {
    const html = renderToStaticMarkup(
      <Markdown text="[OpenAI](https://openai.com)" onOpenFile={() => undefined} />,
    );

    expect(html).toContain('href="https://openai.com/"');
    expect(html).not.toContain("<code");
    expect(html).not.toContain("in workbench");
  });

  it("keeps an explicitly code-styled file link to one code element", () => {
    const html = renderToStaticMarkup(
      <Markdown
        text="[`cursor-parity-handbook.md`](docs/cursor-parity-handbook.md)"
        onOpenFile={() => undefined}
      />,
    );

    expect(html.match(/<code/g)).toHaveLength(1);
    expect(html).toContain('title="Open docs/cursor-parity-handbook.md in workbench"');
  });
});
