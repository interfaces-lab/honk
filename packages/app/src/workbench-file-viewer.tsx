import type { OpenCodeClient } from "@honk/opencode";
import { normalizePathSeparators } from "@honk/shared/paths";
import { Button, Icon, IconButton, Spinner, Text } from "@honk/ui";
import { IconArrowRotateClockwise } from "@honk/ui/icons";
import { colorVars, fontVars, spaceVars } from "@honk/ui/tokens.stylex";
import * as stylex from "@stylexjs/stylex";
import * as React from "react";

import { useAppearance } from "./appearance-store";
import { errorMessage } from "./error-message";
import { readResolvedTheme, useResolvedTheme } from "./lib/use-resolved-theme";
import { getBoundOpenCodeClient } from "./watch-registry";

// Read-only by construction: OpenCode V2 ships no write route, so this surface renders content and
// nothing else. `files.read` trims trailing whitespace and cannot distinguish a missing path from an
// empty file, so an empty read is resolved against a `files.list` of the parent directory before it
// is reported as either "File not found" or "Empty file".

const FILE_VIEWER_RESOURCE_GRACE_MS = 30_000;
// Render cost scales with characters, not bytes on disk, so the cap is measured on what was decoded.
const FILE_VIEWER_MAX_CHARACTERS = 2_000_000;
const NOT_CONNECTED_MESSAGE = "Honk is not connected to OpenCode.";

type FileViewerState =
  | { readonly phase: "loading" }
  | { readonly phase: "ready"; readonly text: string }
  | { readonly phase: "empty" }
  | { readonly phase: "missing" }
  | { readonly phase: "binary"; readonly mimeType: string | undefined }
  | { readonly phase: "oversized"; readonly characters: number }
  | { readonly phase: "error"; readonly message: string };

type FileViewerResource = {
  readonly getSnapshot: () => FileViewerState;
  readonly subscribe: (listener: () => void) => () => void;
  readonly refresh: () => void;
  readonly observeThreadRunning: (isRunning: boolean) => void;
};

type FileViewerClient = Pick<OpenCodeClient, "files">;
type FileViewerClientResolver = () => FileViewerClient | null;

const LOADING_STATE: FileViewerState = Object.freeze({ phase: "loading" });
const fileViewerResources = new Map<string, FileViewerResource>();

function createFileViewerResource(
  directory: string,
  path: string,
  resolveClient: FileViewerClientResolver = getBoundOpenCodeClient,
): FileViewerResource {
  let snapshot = LOADING_STATE;
  let requested = false;
  let generation = 0;
  let lastThreadRunning: boolean | undefined;
  let releaseTimer: ReturnType<typeof setTimeout> | null = null;
  const listeners = new Set<() => void>();

  const publish = (next: FileViewerState): void => {
    snapshot = Object.freeze(next);
    for (const listener of listeners) listener();
  };

  const refresh = (): void => {
    requested = true;
    // Any in-flight read belongs to the previous generation and must not land after this one.
    generation += 1;
    const currentGeneration = generation;
    const client = resolveClient();
    if (client === null) {
      publish({ phase: "error", message: NOT_CONNECTED_MESSAGE });
      return;
    }
    // A reread of an already-rendered file keeps it on screen instead of flashing the spinner; a
    // run that rewrote the file swaps the content in place.
    if (snapshot.phase !== "ready") publish(LOADING_STATE);
    void readFileState(client, directory, path).then(
      (state) => {
        if (currentGeneration !== generation) return;
        publish(state);
      },
      (error: unknown) => {
        if (currentGeneration !== generation) return;
        publish({ phase: "error", message: errorMessage(error) });
      },
    );
  };

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      if (releaseTimer !== null) {
        clearTimeout(releaseTimer);
        releaseTimer = null;
      }
      listeners.add(listener);
      if (!requested) refresh();
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          releaseTimer = setTimeout(() => {
            if (listeners.size === 0) fileViewerResources.delete(resourceKey(directory, path));
          }, FILE_VIEWER_RESOURCE_GRACE_MS);
        }
      };
    },
    refresh,
    observeThreadRunning(isRunning) {
      // The agent may have rewritten this file during the run that just finished.
      if (lastThreadRunning === true && !isRunning) refresh();
      lastThreadRunning = isRunning;
    },
  };
}

async function readFileState(
  client: FileViewerClient,
  directory: string,
  path: string,
): Promise<FileViewerState> {
  const content = await client.files.read(path, { directory });
  if (content.kind === "binary") {
    return { phase: "binary", mimeType: content.mimeType };
  }
  if (content.text.length > FILE_VIEWER_MAX_CHARACTERS) {
    return { phase: "oversized", characters: content.text.length };
  }
  if (content.text.length > 0) return { phase: "ready", text: content.text };
  return (await fileExists(client, directory, path)) ? { phase: "empty" } : { phase: "missing" };
}

// `files.read` answers "" for a missing path, an unreadable path, and a genuinely empty file alike,
// so existence is settled by listing the parent directory.
async function fileExists(
  client: FileViewerClient,
  directory: string,
  path: string,
): Promise<boolean> {
  const separator = path.lastIndexOf("/");
  const parent = separator < 0 ? "" : path.slice(0, separator);
  const listed = await client.files.list(parent === "" ? undefined : parent, { directory });
  return listed.data.some(
    (entry) => normalizePathSeparators(entry.path).replace(/\/+$/, "") === path,
  );
}

function resourceKey(directory: string, path: string): string {
  return `${directory}\n${path}`;
}

function fileViewerResourceFor(directory: string, path: string): FileViewerResource {
  const key = resourceKey(directory, path);
  const existing = fileViewerResources.get(key);
  if (existing !== undefined) return existing;
  const created = createFileViewerResource(directory, path);
  fileViewerResources.set(key, created);
  return created;
}

// Fixed Cursor workbench geometry for the breadcrumb row below tabs.
const BREADCRUMB_ROW_HEIGHT = "32px";
// Fixed Cursor geometry for the breadcrumb control's internal line box.
const BREADCRUMB_TRAIL_HEIGHT = "22px";

const styles = stylex.create({
  root: {
    display: "flex",
    flexDirection: "column",
    flexGrow: 1,
    minWidth: 0,
    minHeight: 0,
    // Cursor's `breadcrumb.background` resolves to editorBackground (spec JS 882955), so the
    // breadcrumbs row and the code below it share one surface instead of stacking two chromes.
    backgroundColor: colorVars["--honk-color-bg-base"],
  },
  // Cursor gives breadcrumbs their own full-width row below the tab strip rather than sharing the
  // title row: `.breadcrumbs-below-tabs{height:32px;padding-bottom:6px;padding-top:6px}`.
  breadcrumbBar: {
    flexShrink: 0,
    boxSizing: "border-box",
    display: "flex",
    alignItems: "center",
    height: BREADCRUMB_ROW_HEIGHT,
    // oxlint-disable-next-line honk/design-no-raw-values -- Cursor-exact `.breadcrumbs-below-tabs` block padding (spec CSS 279770); the smallest spacing token is the 8px gutter
    paddingBlock: "6px",
    paddingInlineStart: spaceVars["--honk-space-gutter"],
    // oxlint-disable-next-line honk/design-no-raw-values -- Cursor-exact `.breadcrumbs-extra-actions{padding-right:14px}` closing the row (spec CSS 280390); no 14px spacing token exists
    paddingInlineEnd: "14px",
    gap: spaceVars["--honk-space-gutter"],
    // The workbench base size the breadcrumb `.9em` scale is measured against (spec CSS 482373).
    fontSize: fontVars["--honk-font-size-body"],
  },
  // `.breadcrumbs-below-tabs .breadcrumbs-control{flex:1 100%;height:22px}` (spec CSS 443452), with
  // the widget itself pinned to 18px leading (spec CSS 1166788).
  breadcrumbTrail: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: "100%",
    minWidth: 0,
    display: "flex",
    alignItems: "center",
    overflow: "hidden",
    height: BREADCRUMB_TRAIL_HEIGHT,
    lineHeight: fontVars["--honk-leading-body"],
    color: colorVars["--honk-color-text-muted"],
  },
  breadcrumbSegment: {
    minWidth: 0,
    // `.monaco-breadcrumb-item{max-width:80%}` (spec CSS 444308) keeps one long segment from
    // evicting the rest of the trail.
    maxWidth: "80%",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    // oxlint-disable-next-line honk/design-no-raw-values -- Cursor sizes breadcrumb labels at `.9em` of the 13px base (~11.7px, spec CSS 482373); the em-relative scale is what keeps them subordinate, and no 11.7px token exists
    fontSize: "0.9em",
  },
  // Honk has no tab strip naming the open file inside this panel and no hover/focus states on the
  // trail, so the file segment carries the emphasis Cursor spends on focus underlines.
  breadcrumbFile: {
    flexShrink: 0,
    color: colorVars["--honk-color-text-primary"],
  },
  // Cursor replaces the registered chevron codicon with a literal slash:
  // `.monaco-breadcrumb-item:before{content:"/";font-size:.9em;opacity:1;padding:0 6px}`.
  breadcrumbSeparator: {
    flexShrink: 0,
    // oxlint-disable-next-line honk/design-no-raw-values -- 0.9em keeps the slash at Cursor's breadcrumb-relative type scale (spec CSS 480343); no font token owns an em-relative separator size
    fontSize: "0.9em",
    // oxlint-disable-next-line honk/design-no-raw-values -- Cursor-exact separator padding from the same rule (spec CSS 480343); no 6px spacing token exists
    paddingInline: "6px",
  },
  center: {
    flexGrow: 1,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: spaceVars["--honk-space-gutter"],
    padding: spaceVars["--honk-space-panel-pad"],
    textAlign: "center",
  },
  // Cursor ships Monaco's own font defaults untouched (spec JS 1009203), which on macOS are 12px at
  // the 1.5 golden line-height ratio (spec JS 1425741) = 18px. Honk already tokenizes both, and
  // Monaco reads them off this element rather than having a family hardcoded.
  editor: {
    flexGrow: 1,
    minWidth: 0,
    minHeight: 0,
    overflow: "hidden",
    fontFamily: fontVars["--honk-font-family-mono"],
    fontSize: fontVars["--honk-font-size-code"],
    lineHeight: fontVars["--honk-leading-code"],
  },
});

function WorkbenchFileViewer({
  path,
  directory,
  isThreadRunning,
  isVisible,
}: {
  readonly path: string;
  readonly directory: string;
  readonly isThreadRunning: boolean;
  readonly isVisible: boolean;
}): React.ReactElement {
  const resource = fileViewerResourceFor(directory, path);
  const state = React.useSyncExternalStore(
    resource.subscribe,
    resource.getSnapshot,
    resource.getSnapshot,
  );
  React.useEffect(() => {
    resource.observeThreadRunning(isThreadRunning);
  }, [isThreadRunning, resource]);
  // Inactive panels stay mounted under `display: none`. Latch on the first reveal so Monaco only
  // sets up in a laid-out box; once revealed the tab keeps its editor across later switches.
  const [wasVisible, setWasVisible] = React.useState(isVisible);
  if (isVisible && !wasVisible) setWasVisible(true);

  return (
    <div {...stylex.props(styles.root)}>
      <div {...stylex.props(styles.breadcrumbBar)}>
        <FileBreadcrumbs path={path} />
        <IconButton
          type="button"
          size="sm"
          variant="quiet"
          aria-label="Reload file"
          title="Reload file"
          onClick={resource.refresh}
        >
          <Icon icon={IconArrowRotateClockwise} size="sm" tone="muted" />
        </IconButton>
      </div>
      <FileViewerBody path={path} state={state} isMounted={wasVisible} onRetry={resource.refresh} />
    </div>
  );
}

// The trail is static text: this panel has no explorer to navigate into, and Cursor's own picker
// contract does not exist here, so rendering segments as buttons would promise a target honk cannot
// open. The full path stays reachable through the row's title.
function FileBreadcrumbs({ path }: { readonly path: string }): React.ReactElement {
  const segments = path.split("/").filter((segment) => segment !== "");
  return (
    <div {...stylex.props(styles.breadcrumbTrail)} title={path}>
      {segments.map((segment, index) => (
        <React.Fragment key={`${index}:${segment}`}>
          {index === 0 ? null : (
            <span aria-hidden {...stylex.props(styles.breadcrumbSeparator)}>
              /
            </span>
          )}
          <span
            {...stylex.props(
              styles.breadcrumbSegment,
              index === segments.length - 1 && styles.breadcrumbFile,
            )}
          >
            {segment}
          </span>
        </React.Fragment>
      ))}
    </div>
  );
}

function FileViewerBody({
  path,
  state,
  isMounted,
  onRetry,
}: {
  readonly path: string;
  readonly state: FileViewerState;
  readonly isMounted: boolean;
  readonly onRetry: () => void;
}): React.ReactElement {
  if (state.phase === "loading" || !isMounted) {
    return <FileViewerLoading />;
  }
  if (state.phase === "error") {
    return <FileViewerNotice title="Can't open file" detail={state.message} onRetry={onRetry} />;
  }
  // Never auto-close the tab: a file deleted on another branch should still be where the user left
  // it, saying so.
  if (state.phase === "missing") {
    return <FileViewerNotice title="File not found" detail={path} mono onRetry={onRetry} />;
  }
  // An empty file is a watermark, not a failure. Cursor's watermark is a centered column at
  // `opacity:.5` over `editorWatermark.foreground` = transparent(foreground, .6 dark / .68 light)
  // (spec CSS 485957 / JS 30861416) — the ~0.34 effective alpha honk's faint tone already carries —
  // sized like its 13px shortcut rows (spec CSS 487400). The keybinding grid under Cursor's glyph is
  // dropped: honk has no commands to advertise here. The breadcrumbs above already name the file.
  if (state.phase === "empty") {
    return (
      <div {...stylex.props(styles.center)}>
        <Text as="p" size="base" tone="faint">
          Empty file
        </Text>
      </div>
    );
  }
  // Retrying cannot change either verdict, so neither offers the control.
  if (state.phase === "binary") {
    return (
      <FileViewerNotice
        title="Binary file"
        detail={
          state.mimeType === undefined
            ? "Honk shows text files only."
            : `${state.mimeType} — Honk shows text files only.`
        }
      />
    );
  }
  if (state.phase === "oversized") {
    return (
      <FileViewerNotice
        title="File too large"
        detail={`${formatCount(state.characters)} characters — Honk shows files up to ${formatCount(
          FILE_VIEWER_MAX_CHARACTERS,
        )}.`}
      />
    );
  }

  return <MonacoFileView path={path} text={state.text} />;
}

type Monaco = typeof import("monaco-editor/editor/editor.api");
type MonacoEditor = import("monaco-editor/editor/editor.api").editor.IStandaloneCodeEditor;
type MonacoModel = import("monaco-editor/editor/editor.api").editor.ITextModel;
type MonacoLoadState =
  | { readonly phase: "loading" }
  | { readonly phase: "ready"; readonly monaco: Monaco }
  | { readonly phase: "error"; readonly message: string };

function MonacoFileView({
  path,
  text,
}: {
  readonly path: string;
  readonly text: string;
}): React.ReactElement {
  const theme = useResolvedTheme();
  const appearance = useAppearance();
  const containerRef = React.useRef<HTMLDivElement>(null);
  const editorRef = React.useRef<MonacoEditor | null>(null);
  const modelRef = React.useRef<MonacoModel | null>(null);
  const textRef = React.useRef(text);
  const [loadState, setLoadState] = React.useState<MonacoLoadState>({ phase: "loading" });

  React.useEffect(() => {
    const controller = new AbortController();
    const load = async (): Promise<void> => {
      const { loadMonaco } = await import("./lib/monaco");
      const monaco = await loadMonaco();
      if (!controller.signal.aborted) setLoadState({ phase: "ready", monaco });
    };
    void load().catch((error: unknown) => {
      if (!controller.signal.aborted) {
        setLoadState({ phase: "error", message: errorMessage(error) });
      }
    });
    return () => controller.abort();
  }, []);

  React.useEffect(() => {
    if (loadState.phase !== "ready" || containerRef.current === null) return;
    const uri = loadState.monaco.Uri.file(path);
    const existingModel = loadState.monaco.editor.getModel(uri);
    const model =
      existingModel ?? loadState.monaco.editor.createModel(textRef.current, undefined, uri);
    if (model.getValue() !== textRef.current) model.setValue(textRef.current);
    const computedStyle = getComputedStyle(containerRef.current);
    const editor = loadState.monaco.editor.create(containerRef.current, {
      model,
      readOnly: true,
      domReadOnly: true,
      automaticLayout: true,
      // Cursor ships the minimap off — a deliberate deviation from upstream VS Code, whose default
      // is on (spec JS 982150) — and sticky scroll on, capped at 5 lines (spec JS 979232).
      minimap: { enabled: false },
      stickyScroll: { enabled: true, maxLineCount: 5 },
      wordWrap: "off",
      renderLineHighlight: "line",
      scrollBeyondLastLine: false,
      fontSize: Number.parseFloat(computedStyle.fontSize),
      fontFamily: computedStyle.fontFamily,
      lineHeight: Number.parseFloat(computedStyle.lineHeight),
      theme: `honk-${readResolvedTheme()}`,
      quickSuggestions: false,
      suggestOnTriggerCharacters: false,
      parameterHints: { enabled: false },
      hover: { enabled: "off" },
      links: false,
      codeLens: false,
      colorDecorators: false,
      lightbulb: { enabled: loadState.monaco.editor.ShowLightbulbIconMode.Off },
      inlayHints: { enabled: "off" },
      occurrencesHighlight: "off",
      selectionHighlight: false,
    });
    editorRef.current = editor;
    modelRef.current = model;
    return () => {
      editor.dispose();
      if (loadState.monaco.editor.getModel(uri) === model) model.dispose();
      editorRef.current = null;
      modelRef.current = null;
    };
  }, [loadState, path]);

  React.useEffect(() => {
    textRef.current = text;
    if (modelRef.current !== null && modelRef.current.getValue() !== text) {
      modelRef.current.setValue(text);
    }
  }, [text]);

  React.useEffect(() => {
    if (loadState.phase === "ready") loadState.monaco.editor.setTheme(`honk-${theme}`);
  }, [loadState, theme]);

  React.useEffect(() => {
    if (editorRef.current === null || containerRef.current === null) return;
    const computedStyle = getComputedStyle(containerRef.current);
    editorRef.current.updateOptions({
      fontSize: Number.parseFloat(computedStyle.fontSize),
      fontFamily: computedStyle.fontFamily,
      lineHeight: Number.parseFloat(computedStyle.lineHeight),
    });
  }, [appearance.codeFontFamily, appearance.codeFontSize]);

  if (loadState.phase === "loading") return <FileViewerLoading />;
  if (loadState.phase === "error") {
    return <FileViewerNotice title="Can't open file" detail={loadState.message} />;
  }
  return <div ref={containerRef} {...stylex.props(styles.editor)} />;
}

function FileViewerLoading(): React.ReactElement {
  return (
    <div {...stylex.props(styles.center)}>
      <Spinner label="Loading file" tone="muted" />
    </div>
  );
}

function FileViewerNotice({
  title,
  detail,
  mono = false,
  onRetry,
}: {
  readonly title: string;
  readonly detail: string;
  readonly mono?: boolean;
  readonly onRetry?: () => void;
}): React.ReactElement {
  return (
    <div {...stylex.props(styles.center)}>
      <Text as="p" size="sm" tone="muted" weight="regular">
        {title}
      </Text>
      <Text as="p" size="xs" tone="faint" family={mono ? "mono" : "ui"}>
        {detail}
      </Text>
      {onRetry === undefined ? null : (
        <Button size="sm" variant="quiet" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

function formatCount(value: number): string {
  return value.toLocaleString();
}

export { createFileViewerResource, FILE_VIEWER_MAX_CHARACTERS, WorkbenchFileViewer };
export type { FileViewerState };
