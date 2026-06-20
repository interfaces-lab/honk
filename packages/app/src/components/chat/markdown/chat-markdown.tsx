import {
  type DiffsHighlighter,
  getFiletypeFromFileName,
  getSharedHighlighter,
  type SupportedLanguages,
} from "@pierre/diffs";
import {
  IconArrowsHide,
  IconCheckmark1,
  IconClipboard,
  IconCrossMediumDefault,
  IconExpandSimple,
  IconZoomIn,
  IconZoomOut,
} from "central-icons";
import mermaid, { type MermaidConfig } from "mermaid";
import { useDebouncedCallback } from "@tanstack/react-pacer";
import {
  type ComponentProps,
  type Dispatch,
  type MouseEvent as ReactMouseEvent,
  isValidElement,
  useId,
  type SetStateAction,
  useState,
  type ReactNode,
  createContext,
  useContext,
} from "react";
import remend from "remend";
import type { Components, UrlTransform } from "streamdown";
import { defaultUrlTransform, Streamdown } from "streamdown";
import { normalizePathSeparators } from "@honk/shared/paths";
import { VscodeEntryIcon } from "../shared/vscode-entry-icon";
import { Button } from "@honk/honkkit/button";
import { Dialog, DialogPopup } from "@honk/honkkit/dialog";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@honk/honkkit/tooltip";
import { toastManager } from "~/app/toast";
import { openInPreferredEditor } from "../../../editor-preferences";
import {
  CURSOR_DARK_THEME,
  CURSOR_LIGHT_THEME,
  resolveDiffThemeName,
  type DiffThemeName,
} from "../../../lib/diff-rendering";
import { fnv1a32 } from "../../../lib/diff-rendering";
import { useTheme } from "../../../hooks/use-theme";
import { resolveMarkdownFileLinkMeta, rewriteMarkdownFileUriHref } from "./file-links";
import { LRUCache } from "./lru-cache";
import { readLocalApi } from "../../../local-api";
import { cn } from "../../../lib/utils";
import { useMountEffect } from "../../../hooks/use-mount-effect";

interface ChatMarkdownProps {
  text: string;
  cwd: string | undefined;
  isStreaming?: boolean;
  className?: string | undefined;
}

const CODE_FENCE_LANGUAGE_REGEX = /(?:^|\s)language-([^\s]+)/;
const CODE_FENCE_LANGUAGE_NAME_REGEX = /^[\w.+#-]+$/;
const CODE_FENCE_LINE_REFERENCE_REGEX = /^\d+(?::\d+)*$/;
const PATH_SEPARATOR_REGEX = /[\\/]/;
const MARKDOWN_CODE_FENCE_BOUNDARY_REGEX = /^[ \t]{0,3}(`{3,}|~{3,})/;
const MERMAID_BLOCK_HEADER_REGEX =
  /^[ \t]{0,3}(?:(?:graph|flowchart)[ \t]+(?:TD|TB|LR|BT|RL)|stateDiagram(?:-v2)?)[ \t]*$/i;
const MERMAID_ZOOM_STEP = 0.15;
const MERMAID_MIN_ZOOM = 0.5;
const MERMAID_MAX_ZOOM = 3;
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

interface MermaidBlockState {
  cacheKey: string;
  error: string | null;
  svg: string | null;
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

  return (
    inferLanguageFromFilename(raw, {
      fallback: undefined,
      requirePathLikeCandidate: true,
    }) ?? "text"
  );
}

function inferLanguageFromFilename(
  raw: string,
  options: {
    fallback: string | undefined;
    requirePathLikeCandidate: boolean;
  },
): string | undefined {
  const candidates = [raw, ...raw.split(":")].filter((candidate) => candidate.length > 0);
  for (const candidate of candidates) {
    if (
      options.requirePathLikeCandidate &&
      !PATH_SEPARATOR_REGEX.test(candidate) &&
      !candidate.startsWith(".")
    ) {
      continue;
    }

    const basename = candidate.split(/[\\/]/).at(-1)?.toLowerCase();
    // Shiki doesn't bundle a gitignore grammar; ini is a close match (#685)
    if (basename === ".gitignore") {
      return "ini";
    }
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

  return options.fallback;
}

export function inferCodeLanguageFromFilePath(filePath: string | null | undefined): string {
  const normalized = filePath?.trim();
  if (!normalized) {
    return "text";
  }

  return (
    inferLanguageFromFilename(normalized, {
      fallback: "text",
      requirePathLikeCandidate: false,
    }) ?? "text"
  );
}

function isMermaidFenceLanguage(language: string): boolean {
  return language === "mermaid" || language === "mmd";
}

function normalizeStandaloneMermaidBlocks(text: string): string {
  const lines = text.split("\n");
  const normalized: string[] = [];
  let isInsideFence = false;
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    if (MARKDOWN_CODE_FENCE_BOUNDARY_REGEX.test(line)) {
      isInsideFence = !isInsideFence;
      normalized.push(line);
      index += 1;
      continue;
    }

    if (!isInsideFence && MERMAID_BLOCK_HEADER_REGEX.test(line)) {
      const blockLines = [line];
      let nextIndex = index + 1;
      while (nextIndex < lines.length) {
        const nextLine = lines[nextIndex] ?? "";
        if (nextLine.trim() === "") break;
        blockLines.push(nextLine);
        nextIndex += 1;
      }

      if (blockLines.length > 1) {
        normalized.push("```mermaid", ...blockLines, "```");
        index = nextIndex;
        continue;
      }
    }

    normalized.push(line);
    index += 1;
  }

  return normalized.join("\n");
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

function getCssVariableValue(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

function createMermaidConfig(themeName: DiffThemeName): MermaidConfig {
  const isDarkTheme = themeName.includes("dark");
  const foreground = isDarkTheme ? "#f2f2f3" : "#333337";
  const secondary = isDarkTheme ? "#aaaab0" : "#707078";
  const background = isDarkTheme ? "#242426" : "#ffffff";
  const border = isDarkTheme ? "#4a4a50" : "#d9d9df";
  const accent = isDarkTheme ? "#5fc7df" : "#067a93";
  const fontFamily = getCssVariableValue("--honk-font-ui", "system-ui, sans-serif");

  return {
    startOnLoad: false,
    securityLevel: "strict",
    theme: "base",
    themeVariables: {
      primaryColor: background,
      primaryTextColor: foreground,
      primaryBorderColor: border,
      lineColor: border,
      secondaryColor: background,
      tertiaryColor: background,
      background,
      mainBkg: background,
      secondBkg: background,
      tertiaryBkg: background,
      textColor: foreground,
      edgeLabelBackground: background,
      nodeBorder: border,
      clusterBkg: background,
      clusterBorder: border,
      titleColor: foreground,
      darkMode: isDarkTheme,
      fontFamily,
      noteTextColor: foreground,
      noteBkgColor: background,
      noteBorderColor: border,
      actorTextColor: foreground,
      actorBorder: border,
      actorBkg: background,
      signalColor: secondary,
      signalTextColor: foreground,
      activationBorderColor: border,
      activationBkgColor: background,
      labelTextColor: foreground,
      loopTextColor: foreground,
      altBackground: background,
      fillType0: accent,
      fillType1: secondary,
      fillType2: border,
      fillType3: background,
      fillType4: foreground,
    },
  };
}

function clampMermaidZoom(zoom: number): number {
  return Math.min(MERMAID_MAX_ZOOM, Math.max(MERMAID_MIN_ZOOM, zoom));
}

async function getHighlightedCodeHtml(
  code: string,
  language: string,
  themeName: DiffThemeName,
): Promise<string> {
  const { highlighter, language: resolvedLanguage } = await getHighlighterPromise(language);
  try {
    return highlighter.codeToHtml(code, {
      lang: resolvedLanguage,
      theme: themeName,
    });
  } catch (error) {
    console.warn(
      `Code highlighting failed for language "${resolvedLanguage}", falling back to plain text.`,
      error instanceof Error ? error.message : error,
    );
    return highlighter.codeToHtml(code, { lang: "text", theme: themeName });
  }
}

function MermaidSvgView({
  svg,
  fullscreen = false,
  zoom = 1,
}: {
  svg: string;
  fullscreen?: boolean | undefined;
  zoom?: number | undefined;
}) {
  const zoomStyle = { transform: `scale(${zoom})` };
  const svgMarkup = { __html: svg };

  return (
    <div
      className={cn(
        "min-w-max origin-center p-3",
        "[&_svg]:mx-auto [&_svg]:block [&_svg]:h-auto [&_svg]:min-w-[480px]",
        "[&_svg]:[--accent:var(--honk-fg-cyan-primary,var(--primary))] [&_svg]:[--bg:var(--vscode-editor-background)] [&_svg]:[--border:var(--honk-stroke-primary,var(--vscode-widget-border))] [&_svg]:[--fg:var(--honk-fg-primary)] [&_svg]:[--line:var(--honk-stroke-secondary,var(--vscode-widget-border))] [&_svg]:[--muted:var(--honk-fg-secondary)] [&_svg]:[--surface:var(--honk-bg-tertiary,var(--vscode-editor-background))]",
        fullscreen
          ? "flex size-full min-h-0 min-w-0 items-center justify-center overflow-auto p-12 [&_svg]:max-w-none"
          : "[&_svg]:max-w-full",
      )}
    >
      <div
        className="origin-center transition-transform duration-150 ease-out"
        style={zoomStyle}
        dangerouslySetInnerHTML={svgMarkup}
      />
    </div>
  );
}

function MermaidIconButton({
  children,
  label,
  onClick,
}: {
  children: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      size="icon-sm"
      variant="ghost"
      className="size-6 min-h-6 min-w-6 flex-[0_0_24px] rounded-[4px] border-0 bg-transparent p-0 text-(--honk-fg-secondary) hover:bg-(--vscode-list-hoverBackground) hover:text-(--honk-fg-primary) [&_svg]:size-3.5 [&_svg]:shrink-0"
      aria-label={label}
      title={label}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

function MermaidCodeBlock({ code, themeName }: { code: string; themeName: DiffThemeName }) {
  const reactId = useId();
  const cacheKey = `${fnv1a32(code).toString(36)}:${themeName}`;
  const [rendered, setRendered] = useState<MermaidBlockState | null>(null);
  const [fullscreenOpen, setFullscreenOpen] = useState(false);
  const [fullscreenZoom, setFullscreenZoom] = useState(1);
  const zoomIn = () =>
    setFullscreenZoom((current) => clampMermaidZoom(current + MERMAID_ZOOM_STEP));
  const zoomOut = () =>
    setFullscreenZoom((current) => clampMermaidZoom(current - MERMAID_ZOOM_STEP));
  const resetZoom = () => setFullscreenZoom(1);
  const openFullscreen = () => setFullscreenOpen(true);
  const closeFullscreen = () => setFullscreenOpen(false);

  if (rendered?.cacheKey === cacheKey && rendered.svg) {
    return (
      <Dialog open={fullscreenOpen} onOpenChange={setFullscreenOpen}>
        <div
          className="relative w-full overflow-auto rounded-[6px] bg-(--vscode-editor-background) text-detail text-(--honk-fg-primary) leading-(--honk-leading-detail) [contain:paint]"
          data-renderer="mermaid"
        >
          <div className="absolute top-1 right-1 z-10 flex items-center gap-1 rounded-[4px] bg-(--vscode-editor-background) p-1">
            <MermaidIconButton label="Expand diagram" onClick={openFullscreen}>
              <IconExpandSimple className="size-3.5" aria-hidden />
            </MermaidIconButton>
          </div>
          <MermaidSvgView svg={rendered.svg} />
        </div>
        <DialogPopup
          aria-label="Mermaid Diagram"
          className="h-[calc(100vh-32px)] max-h-[calc(100vh-32px)] w-[calc(100vw-32px)] max-w-[calc(100vw-32px)] rounded-[8px] border-0 bg-(--vscode-editor-background) shadow-none"
          showCloseButton={false}
          bottomStickOnMobile={false}
        >
          <div className="absolute top-1 right-1 z-10 flex items-center gap-1 rounded-[4px] bg-(--vscode-editor-background) p-1">
            <MermaidIconButton label="Zoom out" onClick={zoomOut}>
              <IconZoomOut className="size-3.5" aria-hidden />
            </MermaidIconButton>
            <MermaidIconButton label="Reset zoom" onClick={resetZoom}>
              <IconArrowsHide className="size-3.5" aria-hidden />
            </MermaidIconButton>
            <MermaidIconButton label="Zoom in" onClick={zoomIn}>
              <IconZoomIn className="size-3.5" aria-hidden />
            </MermaidIconButton>
            <MermaidIconButton label="Close" onClick={closeFullscreen}>
              <IconCrossMediumDefault className="size-3.5" aria-hidden />
            </MermaidIconButton>
          </div>
          <div className="relative size-full min-h-0 min-w-0 overflow-hidden">
            <MermaidSvgView svg={rendered.svg} fullscreen zoom={fullscreenZoom} />
          </div>
        </DialogPopup>
      </Dialog>
    );
  }

  const renderSync = (
    <MermaidRenderSync
      key={cacheKey}
      cacheKey={cacheKey}
      chart={code.trim()}
      reactId={reactId}
      setRendered={setRendered}
      themeName={themeName}
    />
  );

  if (rendered?.cacheKey === cacheKey && rendered.error) {
    return (
      <>
        {renderSync}
        <div className="w-full overflow-auto rounded-[6px] border border-[color-mix(in_srgb,var(--destructive)_45%,var(--vscode-widget-border))] bg-[color-mix(in_srgb,var(--destructive)_7%,var(--vscode-editor-background))] p-3 text-detail leading-(--honk-leading-detail) text-(--honk-fg-primary) [contain:paint]">
          <div className="mb-1 font-semibold text-destructive">Mermaid Syntax Error</div>
          <div className="text-(--honk-fg-secondary)">{rendered.error}</div>
          <pre className="mt-2 whitespace-pre-wrap">
            <code>{code}</code>
          </pre>
        </div>
      </>
    );
  }

  return (
    <>
      {renderSync}
      <div className="w-full overflow-auto rounded-[6px] bg-(--vscode-editor-background) p-3 text-detail leading-(--honk-leading-detail) text-(--honk-fg-secondary) [contain:paint]">
        Rendering diagram...
      </div>
    </>
  );
}

function MermaidRenderSync({
  cacheKey,
  chart,
  reactId,
  setRendered,
  themeName,
}: {
  cacheKey: string;
  chart: string;
  reactId: string;
  setRendered: Dispatch<SetStateAction<MermaidBlockState | null>>;
  themeName: DiffThemeName;
}) {
  useMountEffect(() => {
    if (!chart) {
      setRendered({ cacheKey, error: "Mermaid diagram is empty.", svg: null });
      return;
    }

    let isCurrent = true;
    setRendered((current) => (current?.cacheKey === cacheKey ? current : null));

    const id = `honk-mermaid-${reactId.replace(/[^a-zA-Z0-9_-]/g, "")}-${Math.abs(
      fnv1a32(chart),
    ).toString(36)}`;
    mermaid.initialize(createMermaidConfig(themeName));
    void mermaid
      .render(id, chart)
      .then(({ svg }) => {
        if (!isCurrent) return;
        setRendered({ cacheKey, error: null, svg });
      })
      .catch((error: unknown) => {
        if (!isCurrent) return;
        const message =
          error instanceof Error ? error.message : "Could not render Mermaid diagram.";
        setRendered({ cacheKey, error: message, svg: null });
      });

    return () => {
      isCurrent = false;
    };
  });

  return null;
}

function MarkdownCodeBlock({ code, children }: { code: string; children: ReactNode }) {
  const [copied, setCopied] = useState(false);
  const resetCopied = useDebouncedCallback(() => setCopied(false), {
    wait: 1200,
  });
  const handleCopy = () => {
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
  };

  return (
    <div className="chat-markdown-codeblock relative my-[0.5em] mb-[0.65em]">
      <Button
        type="button"
        size="icon-sm"
        variant="outline"
        className="chat-markdown-copy-button pointer-events-none absolute top-1.5 right-1.5 z-[1] size-6 rounded-[3px] border-(--honk-markdown-request-border) bg-[color-mix(in_srgb,var(--background)_82%,transparent)] text-muted-foreground opacity-0 hover:border-[color-mix(in_srgb,var(--honk-markdown-request-border)_70%,var(--foreground))] hover:text-foreground [&_svg]:size-3"
        onClick={handleCopy}
        title={copied ? "Copied" : "Copy code"}
        aria-label={copied ? "Copied" : "Copy code"}
      >
        {copied ? <IconCheckmark1 className="size-3" /> : <IconClipboard className="size-3" />}
      </Button>
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
    <pre className="chat-markdown-plain-pre">
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

  const cachedHighlightedMarkup =
    cachedHighlightedHtml != null ? { __html: cachedHighlightedHtml } : null;
  const highlightedMarkup =
    highlightedCode?.cacheKey === cacheKey ? { __html: highlightedCode.html } : null;

  if (cachedHighlightedMarkup != null) {
    return (
      <div className="chat-markdown-shiki" dangerouslySetInnerHTML={cachedHighlightedMarkup} />
    );
  }

  if (highlightedMarkup != null) {
    return <div className="chat-markdown-shiki" dangerouslySetInnerHTML={highlightedMarkup} />;
  }

  return (
    <>
      <ShikiCodeBlockHighlightLoader
        key={cacheKey}
        cacheKey={cacheKey}
        code={code}
        language={language}
        setHighlightedCode={setHighlightedCode}
        themeName={themeName}
      />
      <PlainCodeBlock className={className} code={code} codeProps={codeProps} />
    </>
  );
}

export function FileCodeBlock({
  code,
  filePath,
  className,
}: {
  code: string;
  filePath: string | null | undefined;
  className?: string | undefined;
}) {
  const { resolvedTheme } = useTheme();
  const language = inferCodeLanguageFromFilePath(filePath);
  const diffThemeName = resolveDiffThemeName(resolvedTheme);

  return (
    <div className={cn("chat-markdown w-full min-w-0", className)}>
      <MarkdownCodeBlock code={code}>
        <ShikiCodeBlock className={`language-${language}`} code={code} themeName={diffThemeName} />
      </MarkdownCodeBlock>
    </div>
  );
}

function ShikiCodeBlockHighlightLoader({
  cacheKey,
  code,
  language,
  setHighlightedCode,
  themeName,
}: {
  cacheKey: string;
  code: string;
  language: string;
  setHighlightedCode: (highlightedCode: HighlightedCodeState | null) => void;
  themeName: DiffThemeName;
}) {
  useMountEffect(() => {
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
  });

  return null;
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
const MARKDOWN_LINK_PATTERN = /(\[[^\]]*]\()([^\s)]+)((?:\s+["'][^"']*["'])?\))/g;

function pathParentSegments(path: string): string[] {
  const normalized = normalizePathSeparators(path);
  const segments = normalized.split("/").filter((segment) => segment.length > 0);
  return segments.slice(0, -1);
}

function buildFileLinkParentSuffixByPath(filePaths: ReadonlyArray<string>): Map<string, string> {
  const groups = new Map<string, Set<string>>();
  for (const filePath of filePaths) {
    const pathSegments = normalizePathSeparators(filePath)
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

function rewriteMarkdownFileUriLinks(text: string): string {
  return text.replace(
    MARKDOWN_LINK_PATTERN,
    (match, prefix: string, href: string, suffix: string) => {
      const rewrittenHref = rewriteMarkdownFileUriHref(href);
      if (!rewrittenHref) return match;
      return `${prefix}${rewrittenHref}${suffix}`;
    },
  );
}

function copyMarkdownPathValue(value: string, title: string) {
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
}

function MarkdownFileLinkAnchor({
  href,
  targetPath,
  displayPath,
  filePath,
  label,
  theme,
  className,
}: MarkdownFileLinkProps) {
  const handleOpen = () => {
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
  };

  const handleClick = (event: ReactMouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    event.stopPropagation();
    handleOpen();
  };

  const handleContextMenu = async (event: ReactMouseEvent<HTMLAnchorElement>) => {
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
      copyMarkdownPathValue(displayPath, "Relative path");
      return;
    }
    if (clicked === "copy-full") {
      copyMarkdownPathValue(targetPath, "Full path");
    }
  };

  return (
    <a
      href={href}
      className={cn(
        "chat-markdown-file-link inline-flex max-w-full min-w-0 items-center gap-1 align-middle text-(--honk-markdown-link-foreground) no-underline transition-colors duration-150 ease-out select-text hover:text-(--honk-markdown-link-active-foreground) active:text-(--honk-markdown-link-active-foreground)",
        className,
      )}
      onClick={handleClick}
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
  );
}

function MarkdownFileLink(props: MarkdownFileLinkProps) {
  return (
    <Tooltip>
      <TooltipTrigger>
        <MarkdownFileLinkAnchor {...props} />
      </TooltipTrigger>
      <TooltipPopup side="top" className="max-w-2xl font-mono text-detail">
        <div className="markdown-file-link-tooltip-scroll overflow-x-auto whitespace-nowrap">
          {props.displayPath}
        </div>
      </TooltipPopup>
    </Tooltip>
  );
}

type MarkdownFileLinkMeta = NonNullable<ReturnType<typeof resolveMarkdownFileLinkMeta>>;

interface ChatMarkdownRenderContextValue {
  markdownFileLinkMetaByHref: ReadonlyMap<string, MarkdownFileLinkMeta>;
  fileLinkParentSuffixByPath: ReadonlyMap<string, string>;
  resolvedTheme: "light" | "dark";
  isStreaming: boolean;
  diffThemeName: DiffThemeName;
}

const ChatMarkdownRenderContext = createContext<ChatMarkdownRenderContextValue | null>(null);

function useChatMarkdownRenderContext(): ChatMarkdownRenderContextValue {
  const context = useContext(ChatMarkdownRenderContext);
  if (context === null) {
    throw new Error("Chat markdown render components require ChatMarkdownRenderContext.");
  }
  return context;
}

const markdownUrlTransform: UrlTransform = (href, key, node) => {
  return rewriteMarkdownFileUriHref(href) ?? defaultUrlTransform(href, key, node);
};

function ChatMarkdownAnchor({
  node: _node,
  href,
  ...props
}: ComponentProps<"a"> & { node?: unknown }) {
  const { markdownFileLinkMetaByHref, fileLinkParentSuffixByPath, resolvedTheme } =
    useChatMarkdownRenderContext();
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
          "text-(--honk-markdown-link-foreground) no-underline transition-colors duration-150 ease-out select-text hover:text-(--honk-markdown-link-active-foreground) active:text-(--honk-markdown-link-active-foreground) [&_code]:text-(--honk-markdown-link-foreground)",
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
}

function ChatMarkdownCode({
  node: _node,
  className,
  children,
  "data-block": dataBlock,
  ...props
}: ComponentProps<"code"> & {
  node?: unknown;
  "data-block"?: string | boolean | undefined;
}) {
  const { isStreaming, diffThemeName } = useChatMarkdownRenderContext();
  const code = nodeToPlainText(children);
  const language = extractFenceLanguage(className);
  if (dataBlock == null) {
    return (
      <code {...props} className={cn("chat-markdown-inline-code", className)}>
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

  if (isMermaidFenceLanguage(language)) {
    return <MermaidCodeBlock code={code} themeName={diffThemeName} />;
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
}

function ChatMarkdownParagraph({
  node: _node,
  className,
  ...props
}: ComponentProps<"p"> & { node?: unknown }) {
  const { isStreaming } = useChatMarkdownRenderContext();
  return <p {...props} className={cn("my-1.5", !isStreaming && "text-pretty", className)} />;
}

function ChatMarkdownHeading1({
  node: _node,
  className,
  ...props
}: ComponentProps<"h1"> & { node?: unknown }) {
  return (
    <h1
      {...props}
      className={cn(
        "my-1.5 font-semibold text-conversation-normalized text-honk-fg-primary text-balance",
        className,
      )}
    />
  );
}

function ChatMarkdownHeading2({
  node: _node,
  className,
  ...props
}: ComponentProps<"h2"> & { node?: unknown }) {
  return (
    <h2
      {...props}
      className={cn(
        "my-1.5 font-semibold text-conversation-normalized text-honk-fg-primary text-balance",
        className,
      )}
    />
  );
}

function ChatMarkdownHeading3({
  node: _node,
  className,
  ...props
}: ComponentProps<"h3"> & { node?: unknown }) {
  return (
    <h3
      {...props}
      className={cn(
        "my-1.5 font-semibold text-conversation-normalized text-honk-fg-primary text-balance",
        className,
      )}
    />
  );
}

function ChatMarkdownHeading4({
  node: _node,
  className,
  ...props
}: ComponentProps<"h4"> & { node?: unknown }) {
  return (
    <h4
      {...props}
      className={cn(
        "my-1.5 font-semibold text-conversation-normalized text-honk-fg-primary text-balance",
        className,
      )}
    />
  );
}

function ChatMarkdownHeading5({
  node: _node,
  className,
  ...props
}: ComponentProps<"h5"> & { node?: unknown }) {
  return (
    <h5
      {...props}
      className={cn(
        "my-1.5 font-semibold text-conversation-normalized text-honk-fg-secondary text-balance",
        className,
      )}
    />
  );
}

function ChatMarkdownHeading6({
  node: _node,
  className,
  ...props
}: ComponentProps<"h6"> & { node?: unknown }) {
  return (
    <h6
      {...props}
      className={cn(
        "my-1.5 font-semibold text-conversation-normalized text-honk-fg-secondary text-balance",
        className,
      )}
    />
  );
}

function ChatMarkdownUnorderedList({
  node: _node,
  className,
  ...props
}: ComponentProps<"ul"> & { node?: unknown }) {
  return (
    <ul {...props} className={cn("my-1.5 flex list-disc flex-col gap-1.5 ps-[2em]", className)} />
  );
}

function ChatMarkdownOrderedList({
  node: _node,
  className,
  ...props
}: ComponentProps<"ol"> & { node?: unknown }) {
  return (
    <ol
      {...props}
      className={cn("my-1.5 flex list-decimal flex-col gap-1.5 ps-[2em]", className)}
    />
  );
}

function ChatMarkdownListItem({
  node: _node,
  className,
  ...props
}: ComponentProps<"li"> & { node?: unknown }) {
  return (
    <li
      {...props}
      className={cn("mb-0 ps-[0.1em] marker:text-(--honk-markdown-marker-foreground)", className)}
    />
  );
}

function ChatMarkdownHorizontalRule({
  node: _node,
  className,
  ...props
}: ComponentProps<"hr"> & { node?: unknown }) {
  return (
    <hr
      {...props}
      className={cn(
        "my-4 max-w-full border-0 border-t border-(--honk-markdown-rule-color)",
        className,
      )}
    />
  );
}

function ChatMarkdownBlockquote({
  node: _node,
  className,
  ...props
}: ComponentProps<"blockquote"> & { node?: unknown }) {
  return (
    <blockquote
      {...props}
      className={cn(
        "my-2 border-l-[3px] border-(--honk-markdown-blockquote-border) bg-(--honk-markdown-blockquote-background) py-2 pr-0 pl-4 text-(--honk-markdown-blockquote-foreground)",
        className,
      )}
    />
  );
}

function ChatMarkdownKbd({
  node: _node,
  className,
  ...props
}: ComponentProps<"kbd"> & { node?: unknown }) {
  return (
    <kbd
      {...props}
      className={cn(
        "rounded-[3px] border border-(--honk-markdown-kbd-border) border-b-(--honk-markdown-kbd-bottom-border) bg-(--honk-markdown-kbd-background) px-[3px] py-px align-middle font-mono text-[0.85em] text-(--honk-markdown-kbd-foreground) shadow-[inset_0_-1px_0_var(--honk-markdown-widget-shadow)]",
        className,
      )}
    />
  );
}

function ChatMarkdownStrong({
  node: _node,
  className,
  ...props
}: ComponentProps<"strong"> & { node?: unknown }) {
  return <strong {...props} className={cn("font-semibold", className)} />;
}

function ChatMarkdownBold({
  node: _node,
  className,
  ...props
}: ComponentProps<"b"> & { node?: unknown }) {
  return <b {...props} className={cn("font-semibold", className)} />;
}

function ChatMarkdownDeleted({
  node: _node,
  className,
  ...props
}: ComponentProps<"del"> & { node?: unknown }) {
  return <del {...props} className={cn("text-muted-foreground line-through", className)} />;
}

function ChatMarkdownImage({
  node: _node,
  className,
  alt,
  ...props
}: ComponentProps<"img"> & { node?: unknown }) {
  return (
    <img
      {...props}
      alt={typeof alt === "string" ? alt : ""}
      className={cn(
        "h-auto max-w-full rounded-lg align-middle shadow-[0_0_0_1px_rgba(0,0,0,0.1)] dark:shadow-[0_0_0_1px_rgba(255,255,255,0.1)]",
        className,
      )}
    />
  );
}

/*
 * Cursor parity: the table lives in a bordered, rounded scroll container and
 * draws an inner grid only (right/bottom strokes, trimmed on the last
 * column/row via markdown.css).
 */
function ChatMarkdownTable({
  node: _node,
  className,
  ...props
}: ComponentProps<"table"> & { node?: unknown }) {
  return (
    <div className="my-[1em] max-w-full overflow-x-auto rounded-md border border-(--honk-markdown-request-border)">
      <table {...props} className={cn("w-max min-w-full border-collapse text-left", className)} />
    </div>
  );
}

function ChatMarkdownTableHeaderCell({
  node: _node,
  className,
  ...props
}: ComponentProps<"th"> & { node?: unknown }) {
  return (
    <th
      {...props}
      className={cn(
        "border-r border-b border-(--honk-markdown-request-border) px-[9px] py-[5px] align-top font-semibold whitespace-nowrap",
        className,
      )}
    />
  );
}

function ChatMarkdownTableDataCell({
  node: _node,
  className,
  ...props
}: ComponentProps<"td"> & { node?: unknown }) {
  return (
    <td
      {...props}
      className={cn(
        "border-r border-b border-(--honk-markdown-request-border) px-[9px] py-[5px] align-top",
        className,
      )}
    />
  );
}

const CHAT_MARKDOWN_COMPONENTS: Components = {
  a: ChatMarkdownAnchor,
  code: ChatMarkdownCode,
  p: ChatMarkdownParagraph,
  h1: ChatMarkdownHeading1,
  h2: ChatMarkdownHeading2,
  h3: ChatMarkdownHeading3,
  h4: ChatMarkdownHeading4,
  h5: ChatMarkdownHeading5,
  h6: ChatMarkdownHeading6,
  ul: ChatMarkdownUnorderedList,
  ol: ChatMarkdownOrderedList,
  li: ChatMarkdownListItem,
  hr: ChatMarkdownHorizontalRule,
  blockquote: ChatMarkdownBlockquote,
  kbd: ChatMarkdownKbd,
  strong: ChatMarkdownStrong,
  b: ChatMarkdownBold,
  del: ChatMarkdownDeleted,
  img: ChatMarkdownImage,
  table: ChatMarkdownTable,
  th: ChatMarkdownTableHeaderCell,
  td: ChatMarkdownTableDataCell,
};

function prepareChatMarkdownSource(text: string, isStreaming: boolean): string {
  const normalized = rewriteMarkdownFileUriLinks(normalizeStandaloneMermaidBlocks(text));
  return isStreaming ? remend(normalized) : normalized;
}

function ChatMarkdown({ text, cwd, isStreaming = false, className }: ChatMarkdownProps) {
  const { resolvedTheme } = useTheme();
  const diffThemeName = resolveDiffThemeName(resolvedTheme);
  const markdownText = prepareChatMarkdownSource(text, isStreaming);
  const markdownFileLinkMetaByHref = (() => {
    const metaByHref = new Map<
      string,
      NonNullable<ReturnType<typeof resolveMarkdownFileLinkMeta>>
    >();
    for (const href of extractMarkdownLinkHrefs(markdownText)) {
      const normalizedHref = normalizeMarkdownLinkHrefKey(href);
      if (metaByHref.has(normalizedHref)) continue;
      const meta = resolveMarkdownFileLinkMeta(normalizedHref, cwd);
      if (meta) {
        metaByHref.set(normalizedHref, meta);
      }
    }
    return metaByHref;
  })();
  const fileLinkParentSuffixByPath = buildFileLinkParentSuffixByPath(
    [...markdownFileLinkMetaByHref.values()].map((meta) => meta.filePath),
  );
  const renderContext: ChatMarkdownRenderContextValue = {
    markdownFileLinkMetaByHref,
    fileLinkParentSuffixByPath,
    resolvedTheme,
    isStreaming,
    diffThemeName,
  };

  return (
    <ChatMarkdownRenderContext.Provider value={renderContext}>
      <div
        className={cn(
          "chat-markdown w-full min-w-0 whitespace-normal",
          "text-conversation",
          "text-honk-fg-primary",
          className,
        )}
      >
        <Streamdown
          mode={isStreaming ? "streaming" : "static"}
          parseIncompleteMarkdown={isStreaming}
          components={CHAT_MARKDOWN_COMPONENTS}
          shikiTheme={[CURSOR_LIGHT_THEME, CURSOR_DARK_THEME]}
          urlTransform={markdownUrlTransform}
          animated={false}
          controls={false}
          className="chat-markdown-streamdown space-y-0"
        >
          {markdownText}
        </Streamdown>
      </div>
    </ChatMarkdownRenderContext.Provider>
  );
}

export default ChatMarkdown;
