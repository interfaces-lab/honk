import {
  type DiffsHighlighter,
  getFiletypeFromFileName,
  getSharedHighlighter,
  type SupportedLanguages,
} from "@pierre/diffs";
import { IconCheckmark1, IconClipboard } from "central-icons";
import { useDebouncedCallback } from "@tanstack/react-pacer";
import {
  type ComponentProps,
  type MouseEvent as ReactMouseEvent,
  isValidElement,
  useCallback,
  memo,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Components, UrlTransform } from "streamdown";
import { defaultUrlTransform, Streamdown } from "streamdown";
import { VscodeEntryIcon } from "../shared/vscode-entry-icon";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@multi/ui/tooltip";
import { toastManager } from "~/app/toast";
import { openInPreferredEditor } from "../../../editor-preferences";
import { resolveDiffThemeName, type DiffThemeName } from "../../../lib/diff-rendering";
import { fnv1a32 } from "../../../lib/diff-rendering";
import { LRUCache } from "../../../lib/lru-cache";
import { useTheme } from "../../../hooks/use-theme";
import { resolveMarkdownFileLinkMeta, rewriteMarkdownFileUriHref } from "../../../markdown-links";
import { readLocalApi } from "../../../local-api";
import { cn } from "../../../lib/utils";

interface ChatMarkdownProps {
  text: string;
  cwd: string | undefined;
  isStreaming?: boolean;
}

const CODE_FENCE_LANGUAGE_REGEX = /(?:^|\s)language-([^\s]+)/;
const CODE_FENCE_LANGUAGE_NAME_REGEX = /^[\w.+#-]+$/;
const CODE_FENCE_LINE_REFERENCE_REGEX = /^\d+(?::\d+)*$/;
const MAX_HIGHLIGHT_CACHE_ENTRIES = 500;
const MAX_HIGHLIGHT_CACHE_MEMORY_BYTES = 50 * 1024 * 1024;
const highlightedCodeCache = new LRUCache<string>(
  MAX_HIGHLIGHT_CACHE_ENTRIES,
  MAX_HIGHLIGHT_CACHE_MEMORY_BYTES,
);
const highlighterPromiseCache = new Map<string, Promise<ResolvedHighlighter>>();

interface ResolvedHighlighter {
  highlighter: DiffsHighlighter;
  language: SupportedLanguages;
}

interface HighlightedCodeState {
  cacheKey: string;
  html: string;
}

function extractFenceLanguage(className: string | undefined): string {
  const match = className?.match(CODE_FENCE_LANGUAGE_REGEX);
  const raw = match?.[1]?.trim() ?? "";
  if (!raw) return "text";

  const normalized = raw.toLowerCase();
  // Shiki doesn't bundle a gitignore grammar; ini is a close match (#685)
  if (normalized === "gitignore") return "ini";

  if (CODE_FENCE_LANGUAGE_NAME_REGEX.test(normalized)) {
    return CODE_FENCE_LINE_REFERENCE_REGEX.test(normalized) ? "text" : normalized;
  }

  return inferFenceLanguageFromFilename(raw) ?? "text";
}

function inferFenceLanguageFromFilename(raw: string): string | undefined {
  const candidates = [raw, ...raw.split(":")].filter((candidate) => candidate.length > 0);
  for (const candidate of candidates) {
    if (!candidate.includes("/") && !candidate.includes("\\") && !candidate.startsWith(".")) {
      continue;
    }

    const basename = candidate.split(/[\\/]/).at(-1)?.toLowerCase();
    if (basename === ".zshrc" || basename === ".zshenv" || basename === ".zprofile") {
      return "zsh";
    }
    if (basename === ".bashrc" || basename === ".bash_profile" || basename === ".profile") {
      return "zsh";
    }

    const language = getFiletypeFromFileName(candidate);
    if (language !== "text") {
      return language;
    }
  }

  return undefined;
}

function nodeToPlainText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map((child) => nodeToPlainText(child)).join("");
  }
  if (isValidElement<{ children?: ReactNode }>(node)) {
    return nodeToPlainText(node.props.children);
  }
  return "";
}

function createHighlightCacheKey(code: string, language: string, themeName: DiffThemeName): string {
  return `${fnv1a32(code).toString(36)}:${code.length}:${language}:${themeName}`;
}

function estimateHighlightedSize(html: string, code: string): number {
  return Math.max(html.length * 2, code.length * 3);
}

function getHighlighterPromise(language: string): Promise<ResolvedHighlighter> {
  const cached = highlighterPromiseCache.get(language);
  if (cached) return cached;

  const supportedLanguage = language as SupportedLanguages;
  const promise = getSharedHighlighter({
    themes: [resolveDiffThemeName("dark"), resolveDiffThemeName("light")],
    langs: [supportedLanguage],
    preferredHighlighter: "shiki-js",
  })
    .then((highlighter) => ({ highlighter, language: supportedLanguage }))
    .catch((error) => {
      if (language === "text") {
        highlighterPromiseCache.delete(language);
        throw error;
      }
      // Language not supported by Shiki. Keep this promise cached so future renders use text too.
      return getHighlighterPromise("text");
    });
  highlighterPromiseCache.set(language, promise);
  return promise;
}

async function getHighlightedCodeHtml(
  code: string,
  language: string,
  themeName: DiffThemeName,
): Promise<string> {
  const { highlighter, language: resolvedLanguage } = await getHighlighterPromise(language);
  try {
    return highlighter.codeToHtml(code, { lang: resolvedLanguage, theme: themeName });
  } catch (error) {
    console.warn(
      `Code highlighting failed for language "${resolvedLanguage}", falling back to plain text.`,
      error instanceof Error ? error.message : error,
    );
    return highlighter.codeToHtml(code, { lang: "text", theme: themeName });
  }
}

function MarkdownCodeBlock({ code, children }: { code: string; children: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const resetCopied = useDebouncedCallback(() => setCopied(false), { wait: 1200 });
  const handleCopy = useCallback(() => {
    if (typeof navigator === "undefined" || navigator.clipboard == null) {
      return;
    }
    void navigator.clipboard
      .writeText(code)
      .then(() => {
        setCopied(true);
        resetCopied();
      })
      .catch(() => undefined);
  }, [code, resetCopied]);

  return (
    <div className="chat-markdown-codeblock relative my-[0.625em] mb-[0.85em] text-sm/5">
      <button
        type="button"
        className="chat-markdown-copy-button pointer-events-none absolute top-2 right-2 z-[1] inline-flex size-6 items-center justify-center rounded-[3px] border border-(--multi-markdown-request-border) bg-[color-mix(in_srgb,var(--background)_82%,transparent)] text-muted-foreground opacity-0 transition-[opacity,color,border-color] duration-150 ease-out hover:border-[color-mix(in_srgb,var(--multi-markdown-request-border)_70%,var(--foreground))] hover:text-foreground"
        onClick={handleCopy}
        title={copied ? "Copied" : "Copy code"}
        aria-label={copied ? "Copied" : "Copy code"}
      >
        {copied ? <IconCheckmark1 className="size-3" /> : <IconClipboard className="size-3" />}
      </button>
      {children}
    </div>
  );
}

function PlainCodeBlock({
  className,
  code,
  codeProps,
}: {
  className: string | undefined;
  code: string;
  codeProps?: ComponentProps<"code"> | undefined;
}) {
  return (
    <pre className="m-0 max-w-full overflow-x-auto rounded-lg border border-(--multi-markdown-code-border) bg-(--multi-markdown-code-background) px-4 py-3.5">
      <code {...codeProps} className={className}>
        {code}
      </code>
    </pre>
  );
}

interface ShikiCodeBlockProps {
  className: string | undefined;
  code: string;
  codeProps?: ComponentProps<"code"> | undefined;
  themeName: DiffThemeName;
}

function ShikiCodeBlock({ className, code, codeProps, themeName }: ShikiCodeBlockProps) {
  const language = extractFenceLanguage(className);
  const cacheKey = createHighlightCacheKey(code, language, themeName);
  const cachedHighlightedHtml = highlightedCodeCache.get(cacheKey);
  const [highlightedCode, setHighlightedCode] = useState<HighlightedCodeState | null>(null);

  useEffect(() => {
    if (highlightedCodeCache.get(cacheKey) != null) {
      return undefined;
    }

    let isCurrent = true;
    void getHighlightedCodeHtml(code, language, themeName).then(
      (html) => {
        if (!isCurrent) return;
        highlightedCodeCache.set(cacheKey, html, estimateHighlightedSize(html, code));
        setHighlightedCode({ cacheKey, html });
      },
      (error) => {
        if (!isCurrent) return;
        console.warn(
          "Code highlighting failed, falling back to plain text.",
          error instanceof Error ? error.message : error,
        );
        setHighlightedCode(null);
      },
    );

    return () => {
      isCurrent = false;
    };
  }, [cacheKey, code, language, themeName]);

  if (cachedHighlightedHtml != null) {
    return (
      <div
        className="chat-markdown-shiki"
        dangerouslySetInnerHTML={{ __html: cachedHighlightedHtml }}
      />
    );
  }

  if (highlightedCode?.cacheKey === cacheKey) {
    return (
      <div
        className="chat-markdown-shiki"
        dangerouslySetInnerHTML={{ __html: highlightedCode.html }}
      />
    );
  }

  return <PlainCodeBlock className={className} code={code} codeProps={codeProps} />;
}

interface MarkdownFileLinkProps {
  href: string;
  targetPath: string;
  displayPath: string;
  filePath: string;
  label: string;
  theme: "light" | "dark";
  className?: string | undefined;
}

const MARKDOWN_LINK_HREF_PATTERN = /\[[^\]]*]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g;

function pathParentSegments(path: string): string[] {
  const normalized = path.replaceAll("\\", "/");
  const segments = normalized.split("/").filter((segment) => segment.length > 0);
  return segments.slice(0, -1);
}

function buildFileLinkParentSuffixByPath(filePaths: ReadonlyArray<string>): Map<string, string> {
  const groups = new Map<string, Set<string>>();
  for (const filePath of filePaths) {
    const pathSegments = filePath
      .replaceAll("\\", "/")
      .split("/")
      .filter((segment) => segment.length > 0);
    const basename = pathSegments[pathSegments.length - 1];
    if (!basename) continue;
    const group = groups.get(basename) ?? new Set<string>();
    group.add(filePath);
    groups.set(basename, group);
  }

  const suffixByPath = new Map<string, string>();
  for (const group of groups.values()) {
    const uniquePaths = [...group];
    if (uniquePaths.length < 2) continue;

    const parentSegmentsByPath = new Map(
      uniquePaths.map((filePath) => [filePath, pathParentSegments(filePath)]),
    );
    const minUniqueDepthByPath = new Map<string, number>();

    for (const filePath of uniquePaths) {
      const segments = parentSegmentsByPath.get(filePath) ?? [];
      let resolvedDepth = segments.length;
      for (let depth = 1; depth <= segments.length; depth += 1) {
        const candidate = segments.slice(-depth).join("/");
        const collision = uniquePaths.some((otherPath) => {
          if (otherPath === filePath) return false;
          const otherSegments = parentSegmentsByPath.get(otherPath) ?? [];
          return otherSegments.slice(-depth).join("/") === candidate;
        });
        if (!collision) {
          resolvedDepth = depth;
          break;
        }
      }
      minUniqueDepthByPath.set(filePath, resolvedDepth);
    }

    for (const filePath of uniquePaths) {
      const segments = parentSegmentsByPath.get(filePath) ?? [];
      if (segments.length === 0) continue;
      const minUniqueDepth = minUniqueDepthByPath.get(filePath) ?? 1;
      const suffixDepth = Math.min(segments.length, Math.max(minUniqueDepth, 2));
      suffixByPath.set(filePath, segments.slice(-suffixDepth).join("/"));
    }
  }

  return suffixByPath;
}

function extractMarkdownLinkHrefs(text: string): string[] {
  const hrefs: string[] = [];
  for (const match of text.matchAll(MARKDOWN_LINK_HREF_PATTERN)) {
    const href = match[1]?.trim();
    if (!href) continue;
    hrefs.push(href);
  }
  return hrefs;
}

function normalizeMarkdownLinkHrefKey(href: string): string {
  return rewriteMarkdownFileUriHref(href.trim()) ?? href.trim();
}

const MarkdownFileLink = memo(function MarkdownFileLink({
  href,
  targetPath,
  displayPath,
  filePath,
  label,
  theme,
  className,
}: MarkdownFileLinkProps) {
  const handleOpen = useCallback(() => {
    const api = readLocalApi();
    if (!api) {
      toastManager.add({
        type: "error",
        title: "Open in editor is unavailable",
      });
      return;
    }

    void openInPreferredEditor(api, targetPath).catch((error) => {
      toastManager.add({
        type: "error",
        title: "Unable to open file",
        description: error instanceof Error ? error.message : "An error occurred.",
      });
    });
  }, [targetPath]);

  const handleCopy = useCallback((value: string, title: string) => {
    if (typeof window === "undefined" || !navigator.clipboard?.writeText) {
      toastManager.add({
        type: "error",
        title: `Failed to copy ${title.toLowerCase()}`,
        description: "Clipboard API unavailable.",
      });
      return;
    }

    void navigator.clipboard.writeText(value).then(
      () => {
        toastManager.add({
          type: "success",
          title: `${title} copied`,
          description: value,
        });
      },
      (error) => {
        toastManager.add({
          type: "error",
          title: `Failed to copy ${title.toLowerCase()}`,
          description: error instanceof Error ? error.message : "An error occurred.",
        });
      },
    );
  }, []);

  const handleContextMenu = useCallback(
    async (event: ReactMouseEvent<HTMLAnchorElement>) => {
      event.preventDefault();
      event.stopPropagation();

      const api = readLocalApi();
      if (!api) return;

      const clicked = await api.contextMenu.show(
        [
          { id: "open", label: "Open in editor" },
          { id: "copy-relative", label: "Copy relative path" },
          { id: "copy-full", label: "Copy full path" },
        ] as const,
        { x: event.clientX, y: event.clientY },
      );

      if (clicked === "open") {
        handleOpen();
        return;
      }
      if (clicked === "copy-relative") {
        handleCopy(displayPath, "Relative path");
        return;
      }
      if (clicked === "copy-full") {
        handleCopy(targetPath, "Full path");
      }
    },
    [displayPath, handleCopy, handleOpen, targetPath],
  );

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <a
            href={href}
            className={cn(
              "chat-markdown-file-link inline-flex max-w-full min-w-0 items-center gap-1 align-middle no-underline",
              className,
            )}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              handleOpen();
            }}
            onContextMenu={handleContextMenu}
          >
            <VscodeEntryIcon
              pathValue={filePath}
              kind="file"
              theme={theme}
              className="chat-markdown-file-link-icon size-3.5 shrink-0 text-current"
            />
            <span className="chat-markdown-file-link-label min-w-0 truncate">{label}</span>
          </a>
        }
      />
      <TooltipPopup
        side="top"
        className="max-w-[min(40rem,calc(100vw-2rem))] font-mono text-detail"
      >
        <div className="markdown-file-link-tooltip-scroll overflow-x-auto whitespace-nowrap">
          {displayPath}
        </div>
      </TooltipPopup>
    </Tooltip>
  );
}, areMarkdownFileLinkPropsEqual);

function areMarkdownFileLinkPropsEqual(
  previous: Readonly<MarkdownFileLinkProps>,
  next: Readonly<MarkdownFileLinkProps>,
): boolean {
  return (
    previous.href === next.href &&
    previous.targetPath === next.targetPath &&
    previous.displayPath === next.displayPath &&
    previous.filePath === next.filePath &&
    previous.label === next.label &&
    previous.theme === next.theme &&
    previous.className === next.className
  );
}

function ChatMarkdown({ text, cwd, isStreaming = false }: ChatMarkdownProps) {
  const { resolvedTheme } = useTheme();
  const diffThemeName = resolveDiffThemeName(resolvedTheme);
  const markdownFileLinkMetaByHref = useMemo(() => {
    const metaByHref = new Map<
      string,
      NonNullable<ReturnType<typeof resolveMarkdownFileLinkMeta>>
    >();
    for (const href of extractMarkdownLinkHrefs(text)) {
      const normalizedHref = normalizeMarkdownLinkHrefKey(href);
      if (metaByHref.has(normalizedHref)) continue;
      const meta = resolveMarkdownFileLinkMeta(normalizedHref, cwd);
      if (meta) {
        metaByHref.set(normalizedHref, meta);
      }
    }
    return metaByHref;
  }, [cwd, text]);
  const fileLinkParentSuffixByPath = useMemo(() => {
    const filePaths = [...markdownFileLinkMetaByHref.values()].map((meta) => meta.filePath);
    return buildFileLinkParentSuffixByPath(filePaths);
  }, [markdownFileLinkMetaByHref]);
  const markdownUrlTransform = useCallback<UrlTransform>((href, key, node) => {
    return rewriteMarkdownFileUriHref(href) ?? defaultUrlTransform(href, key, node);
  }, []);
  const markdownComponents = useMemo<Components>(
    () => ({
      a({ node: _node, href, ...props }) {
        const normalizedHref = href ? normalizeMarkdownLinkHrefKey(href) : "";
        const fileLinkMeta = normalizedHref ? markdownFileLinkMetaByHref.get(normalizedHref) : null;
        if (!fileLinkMeta) {
          return (
            <a
              {...props}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                "text-(--multi-markdown-link-foreground) no-underline transition-colors duration-150 ease-out select-text hover:text-(--multi-markdown-link-active-foreground) active:text-(--multi-markdown-link-active-foreground) [&_code]:text-(--multi-markdown-link-foreground)",
                props.className,
              )}
            />
          );
        }

        const parentSuffix = fileLinkParentSuffixByPath.get(fileLinkMeta.filePath);
        const labelParts = [fileLinkMeta.basename];
        if (typeof parentSuffix === "string" && parentSuffix.length > 0) {
          labelParts.push(parentSuffix);
        }
        if (fileLinkMeta.line) {
          labelParts.push(
            `L${fileLinkMeta.line}${fileLinkMeta.column ? `:C${fileLinkMeta.column}` : ""}`,
          );
        }

        return (
          <MarkdownFileLink
            href={href ?? fileLinkMeta.targetPath}
            targetPath={fileLinkMeta.targetPath}
            displayPath={fileLinkMeta.displayPath}
            filePath={fileLinkMeta.filePath}
            label={labelParts.join(" · ")}
            theme={resolvedTheme}
            className={props.className}
          />
        );
      },
      code({
        node: _node,
        className,
        children,
        "data-block": dataBlock,
        ...props
      }: ComponentProps<"code"> & {
        node?: unknown;
        "data-block"?: string | boolean | undefined;
      }) {
        const code = nodeToPlainText(children);
        if (dataBlock == null) {
          return (
            <code
              {...props}
              className={cn(
                "rounded-[3px] bg-(--multi-markdown-code-background) px-[0.3em] py-[0.1em] font-mono text-multi-code text-(--multi-markdown-preformat-foreground)",
                className,
              )}
            >
              {children}
            </code>
          );
        }

        if (isStreaming) {
          return (
            <MarkdownCodeBlock code={code}>
              <PlainCodeBlock className={className} code={code} codeProps={props} />
            </MarkdownCodeBlock>
          );
        }

        return (
          <MarkdownCodeBlock code={code}>
            <ShikiCodeBlock
              className={className}
              code={code}
              codeProps={props}
              themeName={diffThemeName}
            />
          </MarkdownCodeBlock>
        );
      },
      p({ node: _node, className, ...props }) {
        return <p {...props} className={cn("mt-0 mb-[0.85em] text-pretty", className)} />;
      },
      h1({ node: _node, className, ...props }) {
        return (
          <h1
            {...props}
            className={cn(
              "mt-4 mb-1.5 text-[clamp(18px,calc(var(--conversation-text-font-size)*1.45),22px)]/[1.25] font-semibold text-foreground text-balance",
              className,
            )}
          />
        );
      },
      h2({ node: _node, className, ...props }) {
        return (
          <h2
            {...props}
            className={cn(
              "mt-4 mb-2 flex items-center gap-3 text-[max(13px,calc(var(--conversation-text-font-size)*1.02))]/[1.35] font-semibold text-[color-mix(in_srgb,var(--foreground)_78%,transparent)] text-balance after:h-px after:min-w-6 after:flex-1 after:bg-(--multi-markdown-rule-color) after:content-['']",
              className,
            )}
          />
        );
      },
      h3({ node: _node, className, ...props }) {
        return (
          <h3
            {...props}
            className={cn(
              "mt-3 mb-1 text-[max(13px,var(--conversation-text-font-size))]/[1.4] font-[550] text-[color-mix(in_srgb,var(--foreground)_74%,transparent)] text-balance",
              className,
            )}
          />
        );
      },
      h4({ node: _node, className, ...props }) {
        return (
          <h4
            {...props}
            className={cn(
              "mt-2.5 mb-1 text-conversation font-[550] text-[color-mix(in_srgb,var(--foreground)_72%,transparent)] text-balance",
              className,
            )}
          />
        );
      },
      h5({ node: _node, className, ...props }) {
        return (
          <h5
            {...props}
            className={cn(
              "mt-2.5 mb-1 text-[max(12px,calc(var(--conversation-text-font-size)*0.92))]/[1.4] font-[550] text-[color-mix(in_srgb,var(--foreground)_68%,transparent)] text-balance",
              className,
            )}
          />
        );
      },
      h6({ node: _node, className, ...props }) {
        return (
          <h6
            {...props}
            className={cn(
              "mt-2.5 mb-1 text-[max(12px,calc(var(--conversation-text-font-size)*0.92))]/[1.4] font-[550] text-[color-mix(in_srgb,var(--foreground)_58%,transparent)] text-balance",
              className,
            )}
          />
        );
      },
      ul({ node: _node, className, ...props }) {
        return (
          <ul
            {...props}
            className={cn(
              "mt-0 mb-[0.85em] flex list-disc flex-col gap-[0.25em] pl-[1.15em]",
              className,
            )}
          />
        );
      },
      ol({ node: _node, className, ...props }) {
        return (
          <ol
            {...props}
            className={cn(
              "mt-0 mb-[0.85em] flex list-decimal flex-col gap-[0.25em] pl-[1.15em]",
              className,
            )}
          />
        );
      },
      li({ node: _node, className, ...props }) {
        return (
          <li
            {...props}
            className={cn(
              "mb-0 pl-[0.1em] marker:text-(--multi-markdown-marker-foreground)",
              className,
            )}
          />
        );
      },
      hr({ node: _node, className, ...props }) {
        return (
          <hr
            {...props}
            className={cn(
              "my-4 max-w-[min(100%,var(--multi-markdown-prose-max-width))] border-0 border-t border-(--multi-markdown-rule-color)",
              className,
            )}
          />
        );
      },
      blockquote({ node: _node, className, ...props }) {
        return (
          <blockquote
            {...props}
            className={cn(
              "mt-1 mb-[0.85em] border-l-2 border-(--multi-markdown-blockquote-border) bg-(--multi-markdown-blockquote-background) py-0 pr-0 pl-4 text-(--multi-markdown-blockquote-foreground) italic",
              className,
            )}
          />
        );
      },
      kbd({ node: _node, className, ...props }) {
        return (
          <kbd
            {...props}
            className={cn(
              "rounded-[3px] border border-(--multi-markdown-kbd-border) border-b-(--multi-markdown-kbd-bottom-border) bg-(--multi-markdown-kbd-background) px-[3px] py-px align-middle font-mono text-[0.85em] text-(--multi-markdown-kbd-foreground) shadow-[inset_0_-1px_0_var(--multi-markdown-widget-shadow)]",
              className,
            )}
          />
        );
      },
      strong({ node: _node, className, ...props }) {
        return <strong {...props} className={cn("font-semibold", className)} />;
      },
      b({ node: _node, className, ...props }) {
        return <b {...props} className={cn("font-semibold", className)} />;
      },
      del({ node: _node, className, ...props }) {
        return <del {...props} className={cn("text-muted-foreground line-through", className)} />;
      },
      img({ node: _node, className, ...props }) {
        return (
          <img
            {...props}
            className={cn(
              "h-auto max-w-full rounded-lg align-middle shadow-[0_0_0_1px_rgba(0,0,0,0.1)] dark:shadow-[0_0_0_1px_rgba(255,255,255,0.1)]",
              className,
            )}
          />
        );
      },
      pre({ node: _node, className, ...props }) {
        return (
          <pre
            {...props}
            className={cn(
              "m-0 max-w-full overflow-x-auto rounded-lg border border-(--multi-markdown-code-border) bg-(--multi-markdown-code-background) px-4 py-3.5",
              className,
            )}
          />
        );
      },
      table({ node: _node, className, ...props }) {
        return (
          <table {...props} className={cn("mb-3 w-full border-collapse text-left", className)} />
        );
      },
      th({ node: _node, className, ...props }) {
        return (
          <th
            {...props}
            className={cn("border border-(--multi-markdown-request-border) px-1.5 py-1", className)}
          />
        );
      },
      td({ node: _node, className, ...props }) {
        return (
          <td
            {...props}
            className={cn("border border-(--multi-markdown-request-border) px-1.5 py-1", className)}
          />
        );
      },
    }),
    [
      diffThemeName,
      fileLinkParentSuffixByPath,
      isStreaming,
      markdownFileLinkMetaByHref,
      resolvedTheme,
    ],
  );

  return (
    <div
      className={cn(
        "chat-markdown w-full min-w-0 whitespace-normal",
        "text-conversation",
        "text-multi-fg-primary",
      )}
    >
      <Streamdown
        mode={isStreaming ? "streaming" : "static"}
        parseIncompleteMarkdown={isStreaming}
        components={markdownComponents}
        urlTransform={markdownUrlTransform}
        animated={false}
        controls={false}
        className="chat-markdown-streamdown space-y-0"
      >
        {text}
      </Streamdown>
    </div>
  );
}

export default memo(ChatMarkdown);
