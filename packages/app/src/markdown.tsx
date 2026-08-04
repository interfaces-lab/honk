// Streaming markdown for assistant prose. Streamdown owns incremental CommonMark parsing while
// every visible HTML leaf is restyled through honk's token vocabulary; the transcript never
// inherits Streamdown's product chrome, icon set, or decorative controls.

import * as stylex from "@stylexjs/stylex";
import { Prose } from "@honk/ui";
import { proseCodeBlockStyle } from "@honk/ui/prose-code-block";
import { honkTheme, type ThemeMode } from "@honk/ui/theme";
import { colorVars, fontVars } from "@honk/ui/tokens.stylex";
import * as React from "react";
import { codeToHtml, type ShikiTransformer, type ThemeRegistrationRaw } from "shiki";
import { type Components, defaultRemarkPlugins, Streamdown } from "streamdown";

const styles = stylex.create({
  // Shiki emits its own <pre>; this wrapper only owns width/overflow so the highlighted
  // block behaves in a flex column. The <pre> itself receives @honk/ui's code-block style below.
  highlightWrap: {
    width: "100%",
    minWidth: 0,
    maxWidth: "100%",
  },
  // Wide diagrams scroll horizontally instead of widening the transcript column.
  diagram: {
    width: "100%",
    minWidth: 0,
    maxWidth: "100%",
    overflowX: "auto",
  },
  diagramPlaceholder: {
    fontFamily: fontVars["--honk-font-family-ui"],
    fontSize: fontVars["--honk-text-detail"],
    lineHeight: fontVars["--honk-leading-detail"],
    color: colorVars["--honk-color-text-muted"],
  },
});

// Fenced code runs through Shiki. Both arms of a light/dark pair bake into the token spans via
// defaultColor "light-dark()", so the shell's root CSS color-scheme resolves the theme with no
// per-render theme prop, .dark class, or client re-highlight on theme switch.
function createHonkShikiTheme(mode: ThemeMode): ThemeRegistrationRaw {
  const colors = honkTheme.colors[mode];
  return {
    name: `honk-${mode}`,
    type: mode,
    colors: {
      "editor.background": colors.bgBase,
      "editor.foreground": colors.textPrimary,
    },
    settings: [
      {
        scope: ["comment", "punctuation.definition.comment", "string.comment"],
        settings: { foreground: colors.syntaxComment, fontStyle: "italic" },
      },
      {
        scope: ["keyword", "storage", "storage.type", "keyword.control"],
        settings: { foreground: colors.syntaxKeyword },
      },
      {
        scope: ["string", "string.quoted", "string.template"],
        settings: { foreground: colors.syntaxString },
      },
      {
        scope: ["constant.numeric", "constant.language", "constant.character"],
        settings: { foreground: colors.syntaxNumber },
      },
      {
        scope: ["entity.name.function", "support.function", "meta.function-call"],
        settings: { foreground: colors.syntaxFunction },
      },
      {
        scope: ["entity.name.type", "entity.name.class", "support.type", "support.class"],
        settings: { foreground: colors.syntaxType },
      },
      {
        scope: ["variable.other.property", "support.variable.property", "meta.object-literal.key"],
        settings: { foreground: colors.syntaxProperty },
      },
      {
        scope: ["punctuation", "meta.brace", "meta.delimiter"],
        settings: { foreground: colors.syntaxPunctuation },
      },
      {
        scope: ["invalid", "invalid.illegal"],
        settings: { foreground: colors.errFg },
      },
    ],
  };
}

const SHIKI_THEMES = {
  light: createHonkShikiTheme("light"),
  dark: createHonkShikiTheme("dark"),
} as const;
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

function rememberInCache(cache: Map<string, string>, key: string, value: string): void {
  if (cache.size >= MAX_HIGHLIGHT_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, value);
}

async function highlightCodeToHtml(code: string, language: string): Promise<string> {
  try {
    return await codeToHtml(code, {
      lang: language,
      themes: SHIKI_THEMES,
      defaultColor: "light-dark()",
      transformers: SHIKI_TRANSFORMERS,
    });
  } catch {
    // Unknown or unloadable grammar. Fall back to plaintext so the block still renders styled.
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
const MarkdownOpenFileContext = React.createContext<((path: string) => void) | undefined>(
  undefined,
);
const WORKSPACE_FILE_LINK_QUERY = "__honk_workspace_file";

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
  const onOpenFile = React.useContext(MarkdownOpenFileContext);
  const linkProps = stripRendererProps(props);
  const file = workspaceFileLink(linkProps.href);
  const renderedLinkProps =
    file === null || file.href === linkProps.href ? linkProps : { ...linkProps, href: file.href };
  if (file === null || onOpenFile === undefined) {
    return <Prose.Link {...renderedLinkProps} />;
  }

  const isAlreadyInlineCode =
    React.Children.count(renderedLinkProps.children) === 1 &&
    React.isValidElement(renderedLinkProps.children) &&
    renderedLinkProps.children.type === Code;
  return (
    <Prose.Link
      {...renderedLinkProps}
      rel={undefined}
      target={undefined}
      title={renderedLinkProps.title ?? `Open ${file.path} in workbench`}
      onClick={(event) => {
        renderedLinkProps.onClick?.(event);
        if (event.defaultPrevented) return;
        event.preventDefault();
        onOpenFile(file.path);
      }}
    >
      {isAlreadyInlineCode ? (
        renderedLinkProps.children
      ) : (
        <Prose.InlineCode>{renderedLinkProps.children}</Prose.InlineCode>
      )}
    </Prose.Link>
  );
}

function workspaceFileLink(
  href: string | undefined,
): { readonly href: string; readonly path: string } | null {
  const marker = `?${WORKSPACE_FILE_LINK_QUERY}=`;
  const query = href?.startsWith(`/${marker}`) ? 1 : href?.startsWith(`./${marker}`) ? 2 : -1;
  if (href !== undefined && query >= 0) {
    const original = new URLSearchParams(href.slice(query + 1)).get(WORKSPACE_FILE_LINK_QUERY);
    const path = workspaceFilePath(original ?? undefined);
    if (original !== null && path !== null) return { href: original, path };
  }

  const path = workspaceFilePath(href);
  return href === undefined || path === null ? null : { href, path };
}

function workspaceFilePath(href: string | undefined): string | null {
  const value = href?.trim();
  if (
    value === undefined ||
    value.length === 0 ||
    value.startsWith("#") ||
    value.startsWith("//")
  ) {
    return null;
  }
  if (!/^[A-Za-z]:[\\/]/.test(value) && /^[A-Za-z][A-Za-z\d+.-]*:/.test(value)) return null;

  const path = value.split(/[?#]/, 1)[0]?.trim();
  if (path === undefined || path.length === 0) return null;
  try {
    const decoded = decodeURIComponent(path);
    return decoded.startsWith("./") ? decoded.slice(2) : decoded;
  } catch {
    return path.startsWith("./") ? path.slice(2) : path;
  }
}

type MarkdownSyntaxNode = {
  type: string;
  url?: string;
  children?: MarkdownSyntaxNode[];
};

// Streamdown's URL hardener resolves `./file` to `/file` and blocks the bare repository paths agents
// naturally emit (`docs/file.md`). Encode relative file links before the hardener runs, then Anchor
// restores the original href; unsafe schemes still follow Streamdown's unchanged blocking policy.
function remarkWorkspaceFileLinks() {
  return (tree: MarkdownSyntaxNode): void => {
    const visit = (node: MarkdownSyntaxNode): void => {
      if (
        node.type === "link" &&
        workspaceFilePath(node.url) !== null &&
        node.url !== undefined &&
        !node.url.startsWith("/")
      ) {
        node.url = `./?${WORKSPACE_FILE_LINK_QUERY}=${encodeURIComponent(node.url)}`;
      }
      node.children?.forEach(visit);
    };
    visit(tree);
  };
}

const MARKDOWN_REMARK_PLUGINS = [...Object.values(defaultRemarkPlugins), remarkWorkspaceFileLinks];

function Strong(props: MarkdownProps<"strong">): React.ReactElement {
  return <Prose.Strong {...stripRendererProps(props)} />;
}

function PlainCodeBlock({ code }: { readonly code: string }): React.ReactElement {
  return (
    <Prose.CodeBlock tabIndex={0}>
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
  const cachedHtml = highlightCache.get(cacheKey) ?? null;
  const [highlighted, setHighlighted] = React.useState<{
    readonly cacheKey: string;
    readonly html: string;
  } | null>(null);
  const html = cachedHtml ?? (highlighted?.cacheKey === cacheKey ? highlighted.html : null);

  React.useEffect(() => {
    if (cachedHtml !== null) return undefined;
    let active = true;
    void highlightCodeToHtml(code, language).then(
      (result) => {
        if (!active) return;
        rememberInCache(highlightCache, cacheKey, result);
        setHighlighted({ cacheKey, html: result });
      },
      () => undefined,
    );
    return () => {
      active = false;
    };
  }, [cacheKey, cachedHtml, code, language]);

  if (html != null) {
    // Shiki output is trusted self-generated markup: token spans with inline colors only.
    return (
      <div {...stylex.props(styles.highlightWrap)} dangerouslySetInnerHTML={{ __html: html }} />
    );
  }
  return <PlainCodeBlock code={code} />;
}

// Mermaid fences render through beautiful-mermaid, the deterministic SVG generator Cursor's
// chat uses. It loads on the first diagram. Colors are honk theme vars, so the SVG follows
// light and dark without a re-render.
const mermaidSvgCache = new Map<string, string>();
let mermaidModulePromise: Promise<typeof import("beautiful-mermaid")> | null = null;

function loadMermaidRenderer(): Promise<typeof import("beautiful-mermaid")> {
  mermaidModulePromise ??= import("beautiful-mermaid").catch((error: unknown) => {
    mermaidModulePromise = null;
    throw error;
  });
  return mermaidModulePromise;
}

// The generated SVG lands in the live DOM, so strip remote-resource references the diagram
// source could smuggle into label markup before rendering.
function sanitizeMermaidSource(source: string): string {
  return source
    .replace(/<(img|image|use|feimage)\b[^>]*>/gi, "")
    .replace(/url\((['"]?)https?:[^)]*\1\)/gi, "none")
    .replace(/srcset\s*=\s*(["'])[^"']*\1/gi, "");
}

function MermaidDiagram({
  code,
  isStreaming,
}: {
  readonly code: string;
  readonly isStreaming: boolean;
}): React.ReactElement {
  const cachedSvg = mermaidSvgCache.get(code) ?? null;
  const [rendered, setRendered] = React.useState<{
    readonly code: string;
    readonly svg: string | null;
  } | null>(null);
  const svg = cachedSvg ?? (rendered?.code === code ? rendered.svg : null);

  // Render only once the fence closes; partial sources fail to parse on every token.
  React.useEffect(() => {
    if (isStreaming || cachedSvg !== null) return undefined;
    let active = true;
    void loadMermaidRenderer()
      .then(({ renderMermaidSVG }) => {
        const result = renderMermaidSVG(sanitizeMermaidSource(code), {
          bg: "var(--honk-color-bg-base)",
          fg: "var(--honk-color-text-primary)",
          accent: "var(--honk-color-accent)",
          muted: "var(--honk-color-text-muted)",
          font: "var(--honk-font-family-ui)",
          transparent: true,
        });
        if (!active) return;
        rememberInCache(mermaidSvgCache, code, result);
        setRendered({ code, svg: result });
      })
      .catch(() => {
        if (active) setRendered({ code, svg: null });
      });
    return () => {
      active = false;
    };
  }, [code, cachedSvg, isStreaming]);

  if (svg != null) {
    // beautiful-mermaid output is trusted self-generated markup: SVG shapes and sanitized labels.
    return <div {...stylex.props(styles.diagram)} dangerouslySetInnerHTML={{ __html: svg }} />;
  }
  if (!isStreaming && rendered?.code === code) {
    // The source failed to parse as mermaid; show it as the code block it is.
    return <PlainCodeBlock code={code} />;
  }
  return <div {...stylex.props(styles.diagramPlaceholder)}>Rendering diagram…</div>;
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
  const language = extractFenceLanguage(className);
  if (language === "mermaid") {
    return <MermaidDiagram code={code} isStreaming={isStreaming} />;
  }
  if (isStreaming) {
    return <PlainCodeBlock code={code} />;
  }
  return <ShikiCodeBlock code={code} language={language} />;
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

// Memoized so a streamed delta re-parses only the growing message part, not every visible
// markdown block. Streaming text renders immediately without a mount-local reveal animation.
const Markdown = React.memo(function Markdown({
  text,
  isStreaming = false,
  onOpenFile,
}: {
  readonly text: string;
  readonly isStreaming?: boolean;
  readonly onOpenFile?: ((path: string) => void) | undefined;
}): React.ReactElement {
  return (
    <Prose>
      <MarkdownOpenFileContext.Provider value={onOpenFile}>
        <MarkdownStreamingContext.Provider value={isStreaming}>
          <Streamdown
            mode={isStreaming ? "streaming" : "static"}
            controls={false}
            components={MARKDOWN_COMPONENTS}
            remarkPlugins={MARKDOWN_REMARK_PLUGINS}
          >
            {text}
          </Streamdown>
        </MarkdownStreamingContext.Provider>
      </MarkdownOpenFileContext.Provider>
    </Prose>
  );
});

export { Markdown };
