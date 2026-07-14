// Streaming markdown for assistant prose. Streamdown owns incremental CommonMark parsing while
// every visible HTML leaf is restyled through honk's token vocabulary; the transcript never
// inherits Streamdown's product chrome, icon set, or decorative controls.

import * as stylex from "@stylexjs/stylex";
import { Prose } from "@honk/ui";
import { proseCodeBlockStyle } from "@honk/ui/prose-code-block";
import * as React from "react";
import type { ShikiTransformer } from "shiki";
import { type Components, Streamdown } from "streamdown";

const styles = stylex.create({
  // Shiki emits its own <pre>; this wrapper only owns width/overflow so the highlighted
  // block behaves in a flex column. The <pre> itself receives @honk/ui's code-block style below.
  highlightWrap: {
    width: "100%",
    minWidth: 0,
    maxWidth: "100%",
  },
});

// Fenced code runs through Shiki. Both arms of a light/dark pair are baked into the token spans
// via defaultColor "light-dark()", so the CSS `color-scheme` the shell already sets on the root
// resolves the theme — no per-render theme prop, no `.dark` class, no client-side re-highlight on
// theme switch (matches how the rest of the shell reads light-dark() token pairs).
const SHIKI_THEMES = { light: "github-light", dark: "github-dark" } as const;
const HIGHLIGHT_FENCE_LANGUAGE_REGEX = /language-([\w.+#-]+)/;
const MAX_HIGHLIGHT_CACHE_ENTRIES = 500;
const highlightCache = new Map<string, string>();

// Shiki paints its own container chrome (background, padding) from the theme. Strip it and re-tag
// the <pre> with honk's token styling so highlighted and plain-fallback blocks look identical;
// only the per-token foreground colors survive from Shiki.
const HIGHLIGHT_PRE_CLASS = stylex.props(proseCodeBlockStyle).className ?? "";
const SHIKI_TRANSFORMERS: ShikiTransformer[] = [
  {
    pre(node) {
      this.addClassToHast(node, HIGHLIGHT_PRE_CLASS);
      node.properties.style = undefined;
    },
  },
];

function extractFenceLanguage(className: string | undefined): string {
  const raw = className?.match(HIGHLIGHT_FENCE_LANGUAGE_REGEX)?.[1]?.toLowerCase();
  if (!raw) return "text";
  // Shiki doesn't bundle a gitignore grammar; ini is a close match.
  if (raw === "gitignore") return "ini";
  return raw;
}

function nodeToPlainText(node: React.ReactNode): string {
  if (typeof node === "string") return node;
  if (typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeToPlainText).join("");
  if (React.isValidElement(node)) {
    return nodeToPlainText((node.props as { children?: React.ReactNode }).children);
  }
  return "";
}

function rememberHighlightedHtml(key: string, html: string): void {
  if (highlightCache.size >= MAX_HIGHLIGHT_CACHE_ENTRIES) {
    const oldest = highlightCache.keys().next().value;
    if (oldest !== undefined) highlightCache.delete(oldest);
  }
  highlightCache.set(key, html);
}

// shiki is a heavy grammar/theme registry; import it lazily so it code-splits out of first paint.
async function highlightCodeToHtml(code: string, language: string): Promise<string> {
  const { codeToHtml } = await import("shiki");
  try {
    return await codeToHtml(code, {
      lang: language,
      themes: SHIKI_THEMES,
      defaultColor: "light-dark()",
      transformers: SHIKI_TRANSFORMERS,
    });
  } catch {
    // Unknown/unloadable grammar — fall back to plaintext so the block still renders styled.
    return codeToHtml(code, {
      lang: "text",
      themes: SHIKI_THEMES,
      defaultColor: "light-dark()",
      transformers: SHIKI_TRANSFORMERS,
    });
  }
}

// Streaming blocks render plain (unhighlighted) until the fence closes; highlighting a partial
// block would reflow on every token. Consumers signal streaming through this context.
const MarkdownStreamingContext = React.createContext(false);

type MarkdownProps<Tag extends keyof React.JSX.IntrinsicElements> =
  React.ComponentPropsWithoutRef<Tag> & { readonly node?: unknown };

function stripRendererProps<Tag extends keyof React.JSX.IntrinsicElements>(
  props: MarkdownProps<Tag>,
): Omit<MarkdownProps<Tag>, "className" | "node" | "style"> {
  const { className: _className, node: _node, style: _style, ...rest } = props;
  return rest;
}

function Paragraph(props: MarkdownProps<"p">): React.ReactElement {
  return <Prose.Paragraph {...stripRendererProps(props)} />;
}

function Heading1(props: MarkdownProps<"h1">): React.ReactElement {
  return <Prose.Heading level={1} {...stripRendererProps(props)} />;
}

function Heading2(props: MarkdownProps<"h2">): React.ReactElement {
  return <Prose.Heading level={2} {...stripRendererProps(props)} />;
}

function Heading3(props: MarkdownProps<"h3">): React.ReactElement {
  return <Prose.Heading level={3} {...stripRendererProps(props)} />;
}

function UnorderedList(props: MarkdownProps<"ul">): React.ReactElement {
  return <Prose.List {...stripRendererProps(props)} />;
}

function OrderedList(props: MarkdownProps<"ol">): React.ReactElement {
  return <Prose.List ordered {...stripRendererProps(props)} />;
}

function ListItem(props: MarkdownProps<"li">): React.ReactElement {
  return <Prose.ListItem {...stripRendererProps(props)} />;
}

function Anchor(props: MarkdownProps<"a">): React.ReactElement {
  return <Prose.Link {...stripRendererProps(props)} />;
}

function Strong(props: MarkdownProps<"strong">): React.ReactElement {
  return <Prose.Strong {...stripRendererProps(props)} />;
}

function PlainCodeBlock({ code }: { readonly code: string }): React.ReactElement {
  return (
    <Prose.CodeBlock>
      <code>{code}</code>
    </Prose.CodeBlock>
  );
}

function ShikiCodeBlock({
  code,
  language,
}: {
  readonly code: string;
  readonly language: string;
}): React.ReactElement {
  const cacheKey = `${language}\0${code}`;
  const [html, setHtml] = React.useState<string | null>(() => highlightCache.get(cacheKey) ?? null);

  React.useEffect(() => {
    const cached = highlightCache.get(cacheKey);
    if (cached != null) {
      setHtml(cached);
      return undefined;
    }
    setHtml(null);
    let active = true;
    void highlightCodeToHtml(code, language).then(
      (result) => {
        if (!active) return;
        rememberHighlightedHtml(cacheKey, result);
        setHtml(result);
      },
      () => {
        if (active) setHtml(null);
      },
    );
    return () => {
      active = false;
    };
  }, [cacheKey, code, language]);

  if (html != null) {
    // Shiki output is trusted, self-generated markup — token spans with inline colors only.
    return (
      <div {...stylex.props(styles.highlightWrap)} dangerouslySetInnerHTML={{ __html: html }} />
    );
  }
  return <PlainCodeBlock code={code} />;
}

// Streamdown routes both inline `code` and fenced blocks through this single component; the default
// `pre` marks fenced children with `data-block`, which is our inline/block discriminator.
function Code(
  props: MarkdownProps<"code"> & { readonly "data-block"?: string | boolean },
): React.ReactElement {
  const { "data-block": dataBlock, children, className } = props;
  const isStreaming = React.useContext(MarkdownStreamingContext);

  if (dataBlock == null) {
    return <Prose.InlineCode {...stripRendererProps<"code">(props)} />;
  }

  const code = nodeToPlainText(children);
  if (isStreaming) {
    return <PlainCodeBlock code={code} />;
  }
  return <ShikiCodeBlock code={code} language={extractFenceLanguage(className)} />;
}

function Blockquote(props: MarkdownProps<"blockquote">): React.ReactElement {
  return <Prose.Blockquote {...stripRendererProps(props)} />;
}

function HorizontalRule(props: MarkdownProps<"hr">): React.ReactElement {
  return <Prose.Rule {...stripRendererProps(props)} />;
}

function Table(props: MarkdownProps<"table">): React.ReactElement {
  return <Prose.Table {...stripRendererProps(props)} />;
}

function TableHeader(props: MarkdownProps<"th">): React.ReactElement {
  return <Prose.TableHeader {...stripRendererProps(props)} />;
}

function TableData(props: MarkdownProps<"td">): React.ReactElement {
  return <Prose.TableData {...stripRendererProps(props)} />;
}

function Image(props: MarkdownProps<"img">): React.ReactElement {
  return <Prose.Image {...stripRendererProps(props)} />;
}

const MARKDOWN_COMPONENTS: Components = {
  p: Paragraph,
  h1: Heading1,
  h2: Heading2,
  h3: Heading3,
  h4: Heading3,
  h5: Heading3,
  h6: Heading3,
  ul: UnorderedList,
  ol: OrderedList,
  li: ListItem,
  a: Anchor,
  strong: Strong,
  code: Code,
  blockquote: Blockquote,
  hr: HorizontalRule,
  table: Table,
  th: TableHeader,
  td: TableData,
  img: Image,
};

function Markdown({
  text,
  isStreaming = false,
}: {
  readonly text: string;
  readonly isStreaming?: boolean;
}): React.ReactElement {
  return (
    <Prose>
      <MarkdownStreamingContext.Provider value={isStreaming}>
        <Streamdown
          mode={isStreaming ? "streaming" : "static"}
          animated={false}
          controls={false}
          components={MARKDOWN_COMPONENTS}
        >
          {text}
        </Streamdown>
      </MarkdownStreamingContext.Provider>
    </Prose>
  );
}

export { Markdown };
