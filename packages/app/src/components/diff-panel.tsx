import { parsePatchFiles } from "@pierre/diffs";
import { FileDiff, type FileDiffMetadata, Virtualizer } from "@pierre/diffs/react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { scopeThreadRef } from "@multi/client-runtime";
import { TurnId, type TurnId as TurnIdType } from "@multi/contracts";
import {
  IconBrowserTabs,
  IconChevronLeftMedium,
  IconChevronRightMedium,
  IconColumnWideHalf,
  IconText1,
} from "central-icons";
import {
  type Dispatch,
  type RefObject,
  type SetStateAction,
  type WheelEvent as ReactWheelEvent,
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";
import { openInPreferredEditor } from "../editor/preferences";
import { useGitStatus } from "~/lib/git-status-state";
import { checkpointDiffQueryOptions } from "~/lib/provider-react-query";
import { cn } from "~/lib/utils";
import { readLocalApi } from "../local-api";
import { resolvePathLinkTarget } from "../lib/terminal-links";
import { parseDiffRouteSearch, stripDiffSearchParams } from "~/app/routes/chat-shell-search";
import { useTheme } from "../hooks/use-theme";
import { buildPatchCacheKey } from "../lib/diff-rendering";
import { resolveDiffThemeName } from "../lib/diff-rendering";
import { useTurnDiffSummaries } from "../hooks/use-turn-diff-summaries";
import { selectProjectByRef, useStore } from "../stores/thread-store";
import { createThreadSelectorByRef } from "../stores/thread-selectors";
import { buildThreadRouteParams, resolveThreadRouteRef } from "~/app/routes/thread-route-targets";
import { useSettings } from "../hooks/use-settings";
import { formatShortTimestamp } from "../lib/timestamp-format";
import { toastManager } from "~/app/toast";
import { DiffPanelLoadingState, DiffPanelShell, type DiffPanelMode } from "./diff-panel-shell";
import { ToggleGroup, Toggle } from "@multi/ui/toggle-group";
import { TabsList, TabsRoot, TabsTab } from "@multi/ui/tabs";
import { useMountEffect } from "~/hooks/use-mount-effect";

type DiffRenderMode = "stacked" | "split";
type DiffThemeType = "light" | "dark";
const ALL_TURNS_TAB_VALUE = "all";

const DIFF_PANEL_UNSAFE_CSS = `
[data-diffs-header] {
  position: sticky !important;
  top: 0;
  z-index: 4;
  border-bottom: 1px solid var(--diffs-bg-separator) !important;
}

[data-title] {
  cursor: var(--multi-button-cursor, pointer);
  transition:
    color 120ms ease,
    text-decoration-color 120ms ease;
  text-decoration: underline;
  text-decoration-color: transparent;
  text-underline-offset: 2px;
}

[data-title]:hover {
  color: var(--diffs-modified-base) !important;
  text-decoration-color: currentColor;
}
`;

type RenderablePatch =
  | {
      kind: "files";
      files: FileDiffMetadata[];
    }
  | {
      kind: "raw";
      text: string;
      reason: string;
    };

function getRenderablePatch(
  patch: string | undefined,
  cacheScope = "diff-panel",
): RenderablePatch | null {
  if (!patch) return null;
  const normalizedPatch = patch.trim();
  if (normalizedPatch.length === 0) return null;

  try {
    const parsedPatches = parsePatchFiles(
      normalizedPatch,
      buildPatchCacheKey(normalizedPatch, cacheScope),
      true,
    );
    const files = parsedPatches.flatMap((parsedPatch) => parsedPatch.files);
    if (files.length > 0) {
      return { kind: "files", files };
    }

    return {
      kind: "raw",
      text: normalizedPatch,
      reason: "Unsupported diff format. Showing raw patch.",
    };
  } catch {
    return {
      kind: "raw",
      text: normalizedPatch,
      reason: "Failed to parse patch. Showing raw patch.",
    };
  }
}

function resolveFileDiffPath(fileDiff: FileDiffMetadata): string {
  const raw = fileDiff.name ?? fileDiff.prevName ?? "";
  if (raw.startsWith("a/") || raw.startsWith("b/")) {
    return raw.slice(2);
  }
  return raw;
}

function buildFileDiffRenderKey(fileDiff: FileDiffMetadata): string {
  return fileDiff.cacheKey ?? `${fileDiff.prevName ?? "none"}:${fileDiff.name}`;
}

function buildRenderableFilesKey(files: readonly FileDiffMetadata[]): string {
  return files
    .map((file) => `${buildFileDiffRenderKey(file)}:${resolveFileDiffPath(file)}`)
    .join("\0");
}

function buildTurnStripItemsKey(
  summaries: readonly {
    readonly completedAt: string;
    readonly turnId: TurnIdType;
  }[],
): string {
  return summaries.map((summary) => `${summary.turnId}:${summary.completedAt}`).join("\0");
}

interface DiffPanelProps {
  mode?: DiffPanelMode;
}

export { DiffWorkerPoolProvider } from "./diff-worker-pool-provider";

export default function DiffPanel({ mode = "inline" }: DiffPanelProps) {
  const navigate = useNavigate();
  const { resolvedTheme } = useTheme();
  const settings = useSettings();
  const [diffRenderMode, setDiffRenderMode] = useState<DiffRenderMode>("stacked");
  const [diffWordWrap, setDiffWordWrap] = useState(settings.diffWordWrap);
  const patchViewportRef = useRef<HTMLDivElement>(null);
  const turnStripRef = useRef<HTMLDivElement>(null);
  const previousDiffOpenRef = useRef(false);
  const [canScrollTurnStripLeft, setCanScrollTurnStripLeft] = useState(false);
  const [canScrollTurnStripRight, setCanScrollTurnStripRight] = useState(false);
  const routeThreadRef = useParams({
    strict: false,
    select: (params) => resolveThreadRouteRef(params),
  });
  const diffSearch = useSearch({
    strict: false,
    select: (search) => parseDiffRouteSearch(search),
  });
  const diffOpen = diffSearch.diff === "1";
  const activeThreadId = routeThreadRef?.threadId ?? null;
  const activeThread = useStore(
    useMemo(() => createThreadSelectorByRef(routeThreadRef), [routeThreadRef]),
  );
  const activeProjectId = activeThread?.projectId ?? null;
  const activeProject = useStore((store) =>
    activeThread && activeProjectId
      ? selectProjectByRef(store, {
          environmentId: activeThread.environmentId,
          projectId: activeProjectId,
        })
      : undefined,
  );
  const activeCwd = activeThread?.worktreePath ?? activeProject?.cwd;
  const gitStatusQuery = useGitStatus({
    environmentId: activeThread?.environmentId ?? null,
    cwd: activeCwd ?? null,
  });
  const isGitRepo = gitStatusQuery.data?.isRepo ?? true;
  const { turnDiffSummaries, inferredCheckpointTurnCountByTurnId } =
    useTurnDiffSummaries(activeThread);
  const orderedTurnDiffSummaries = useMemo(
    () =>
      [...turnDiffSummaries].toSorted((left, right) => {
        const leftTurnCount =
          left.checkpointTurnCount ?? inferredCheckpointTurnCountByTurnId[left.turnId] ?? 0;
        const rightTurnCount =
          right.checkpointTurnCount ?? inferredCheckpointTurnCountByTurnId[right.turnId] ?? 0;
        if (leftTurnCount !== rightTurnCount) {
          return rightTurnCount - leftTurnCount;
        }
        return right.completedAt.localeCompare(left.completedAt);
      }),
    [inferredCheckpointTurnCountByTurnId, turnDiffSummaries],
  );

  const selectedTurnId = diffSearch.diffTurnId ?? null;
  const selectedFilePath = selectedTurnId !== null ? (diffSearch.diffFilePath ?? null) : null;
  const selectedTurn =
    selectedTurnId === null
      ? undefined
      : (orderedTurnDiffSummaries.find((summary) => summary.turnId === selectedTurnId) ??
        orderedTurnDiffSummaries[0]);
  const selectedCheckpointTurnCount =
    selectedTurn &&
    (selectedTurn.checkpointTurnCount ?? inferredCheckpointTurnCountByTurnId[selectedTurn.turnId]);
  const selectedCheckpointRange = useMemo(
    () =>
      typeof selectedCheckpointTurnCount === "number"
        ? {
            fromTurnCount: Math.max(0, selectedCheckpointTurnCount - 1),
            toTurnCount: selectedCheckpointTurnCount,
          }
        : null,
    [selectedCheckpointTurnCount],
  );
  const conversationCheckpointTurnCount = useMemo(() => {
    const turnCounts = orderedTurnDiffSummaries
      .map(
        (summary) =>
          summary.checkpointTurnCount ?? inferredCheckpointTurnCountByTurnId[summary.turnId],
      )
      .filter((value): value is number => typeof value === "number");
    if (turnCounts.length === 0) {
      return undefined;
    }
    const latest = Math.max(...turnCounts);
    return latest > 0 ? latest : undefined;
  }, [inferredCheckpointTurnCountByTurnId, orderedTurnDiffSummaries]);
  const conversationCheckpointRange = useMemo(
    () =>
      !selectedTurn && typeof conversationCheckpointTurnCount === "number"
        ? {
            fromTurnCount: 0,
            toTurnCount: conversationCheckpointTurnCount,
          }
        : null,
    [conversationCheckpointTurnCount, selectedTurn],
  );
  const activeCheckpointRange = selectedTurn
    ? selectedCheckpointRange
    : conversationCheckpointRange;
  const conversationCacheScope = useMemo(() => {
    if (selectedTurn || orderedTurnDiffSummaries.length === 0) {
      return null;
    }
    return `conversation:${orderedTurnDiffSummaries.map((summary) => summary.turnId).join(",")}`;
  }, [orderedTurnDiffSummaries, selectedTurn]);
  const activeCheckpointDiffQuery = useQuery(
    checkpointDiffQueryOptions({
      environmentId: activeThread?.environmentId ?? null,
      threadId: activeThreadId,
      fromTurnCount: activeCheckpointRange?.fromTurnCount ?? null,
      toTurnCount: activeCheckpointRange?.toTurnCount ?? null,
      cacheScope: selectedTurn ? `turn:${selectedTurn.turnId}` : conversationCacheScope,
      enabled: isGitRepo,
    }),
  );
  const selectedTurnCheckpointDiff = selectedTurn
    ? activeCheckpointDiffQuery.data?.diff
    : undefined;
  const conversationCheckpointDiff = selectedTurn
    ? undefined
    : activeCheckpointDiffQuery.data?.diff;
  const isLoadingCheckpointDiff = activeCheckpointDiffQuery.isLoading;
  const checkpointDiffError =
    activeCheckpointDiffQuery.error instanceof Error
      ? activeCheckpointDiffQuery.error.message
      : activeCheckpointDiffQuery.error
        ? "Failed to load checkpoint diff."
        : null;

  const selectedPatch = selectedTurn ? selectedTurnCheckpointDiff : conversationCheckpointDiff;
  const hasResolvedPatch = typeof selectedPatch === "string";
  const hasNoNetChanges = hasResolvedPatch && selectedPatch.trim().length === 0;
  const renderablePatch = useMemo(
    () => getRenderablePatch(selectedPatch, `diff-panel:${resolvedTheme}`),
    [resolvedTheme, selectedPatch],
  );
  const renderableFiles = useMemo(() => {
    if (!renderablePatch || renderablePatch.kind !== "files") {
      return [];
    }
    return renderablePatch.files.toSorted((left, right) =>
      resolveFileDiffPath(left).localeCompare(resolveFileDiffPath(right), undefined, {
        numeric: true,
        sensitivity: "base",
      }),
    );
  }, [renderablePatch]);
  const renderableFilesKey = useMemo(
    () => buildRenderableFilesKey(renderableFiles),
    [renderableFiles],
  );
  const turnStripItemsKey = useMemo(
    () => buildTurnStripItemsKey(orderedTurnDiffSummaries),
    [orderedTurnDiffSummaries],
  );

  const openDiffFileInEditor = useCallback(
    (filePath: string) => {
      const api = readLocalApi();
      if (!api) {
        toastManager.add({
          type: "error",
          title: "Open in editor is unavailable",
        });
        return;
      }
      const targetPath = activeCwd ? resolvePathLinkTarget(filePath, activeCwd) : filePath;
      void openInPreferredEditor(api, targetPath).catch((error) => {
        toastManager.add({
          type: "error",
          title: "Unable to open file",
          description: error instanceof Error ? error.message : "An error occurred.",
        });
      });
    },
    [activeCwd],
  );

  const selectTurn = useCallback(
    (turnId: TurnIdType) => {
      if (!activeThread) return;
      void navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(scopeThreadRef(activeThread.environmentId, activeThread.id)),
        search: (previous) => {
          const rest = stripDiffSearchParams(previous);
          return { ...rest, diff: "1", diffTurnId: turnId };
        },
      });
    },
    [activeThread, navigate],
  );
  const selectWholeConversation = useCallback(() => {
    if (!activeThread) return;
    void navigate({
      to: "/$environmentId/$threadId",
      params: buildThreadRouteParams(scopeThreadRef(activeThread.environmentId, activeThread.id)),
      search: (previous) => {
        const rest = stripDiffSearchParams(previous);
        return { ...rest, diff: "1" };
      },
    });
  }, [activeThread, navigate]);
  const selectedTurnTabValue =
    selectedTurnId === null ? ALL_TURNS_TAB_VALUE : String(selectedTurnId);
  const retryActiveDiffQuery = useCallback(() => {
    void activeCheckpointDiffQuery.refetch();
  }, [activeCheckpointDiffQuery]);
  const selectTurnTab = useCallback(
    (nextValue: string) => {
      if (nextValue === ALL_TURNS_TAB_VALUE) {
        selectWholeConversation();
        return;
      }
      selectTurn(TurnId.make(nextValue));
    },
    [selectTurn, selectWholeConversation],
  );
  const onTurnTabClick = useCallback(
    (tabValue: string) => {
      if (tabValue === selectedTurnTabValue) {
        retryActiveDiffQuery();
      }
    },
    [retryActiveDiffQuery, selectedTurnTabValue],
  );
  const updateTurnStripScrollState = useCallback(() => {
    const element = turnStripRef.current;
    if (!element) {
      setCanScrollTurnStripLeft(false);
      setCanScrollTurnStripRight(false);
      return;
    }

    const maxScrollLeft = Math.max(0, element.scrollWidth - element.clientWidth);
    setCanScrollTurnStripLeft(element.scrollLeft > 4);
    setCanScrollTurnStripRight(element.scrollLeft < maxScrollLeft - 4);
  }, []);
  const scrollTurnStripBy = useCallback((offset: number) => {
    const element = turnStripRef.current;
    if (!element) return;
    element.scrollBy({ left: offset, behavior: "smooth" });
  }, []);
  const onTurnStripWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
    const element = turnStripRef.current;
    if (!element) return;
    if (element.scrollWidth <= element.clientWidth + 1) return;
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;

    event.preventDefault();
    element.scrollBy({ left: event.deltaY, behavior: "auto" });
  }, []);

  const headerRow = (
    <>
      <div className="relative min-w-0 flex-1 [-webkit-app-region:no-drag]">
        <button
          type="button"
          className={cn(
            "absolute left-0 top-1/2 z-20 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded-md border bg-background/90 text-muted-foreground transition-colors",
            canScrollTurnStripLeft
              ? "border-border/70 hover:border-border hover:text-foreground"
              : "cursor-not-allowed border-border/40 text-muted-foreground/40",
          )}
          onClick={() => scrollTurnStripBy(-180)}
          disabled={!canScrollTurnStripLeft}
          aria-label="Scroll turn list left"
        >
          <IconChevronLeftMedium className="size-3.5" />
        </button>
        <button
          type="button"
          className={cn(
            "absolute right-0 top-1/2 z-20 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded-md border bg-background/90 text-muted-foreground transition-colors",
            canScrollTurnStripRight
              ? "border-border/70 hover:border-border hover:text-foreground"
              : "cursor-not-allowed border-border/40 text-muted-foreground/40",
          )}
          onClick={() => scrollTurnStripBy(180)}
          disabled={!canScrollTurnStripRight}
          aria-label="Scroll turn list right"
        >
          <IconChevronRightMedium className="size-3.5" />
        </button>
        <TabsRoot
          value={selectedTurnTabValue}
          onValueChange={(value) => selectTurnTab(String(value))}
          className="min-w-0"
        >
          <TabsList
            ref={turnStripRef}
            className="turn-chip-strip flex gap-1 overflow-x-auto overscroll-x-contain px-8 py-0.5 scrollbar-none"
            style={
              canScrollTurnStripLeft || canScrollTurnStripRight
                ? {
                    maskImage: `linear-gradient(to right, ${canScrollTurnStripLeft ? "transparent 24px, black 72px" : "black"}, ${canScrollTurnStripRight ? "black calc(100% - 72px), transparent calc(100% - 24px)" : "black"})`,
                  }
                : undefined
            }
            onWheel={onTurnStripWheel}
          >
            <TabsTab
              value={ALL_TURNS_TAB_VALUE}
              className={(state) =>
                cn(
                  "shrink-0 rounded-md border px-2 py-1 text-left transition-colors",
                  state.active
                    ? "border-border bg-accent text-accent-foreground"
                    : "border-border/70 bg-background/70 text-muted-foreground/80 hover:border-border hover:text-foreground/80",
                )
              }
              onClick={() => onTurnTabClick(ALL_TURNS_TAB_VALUE)}
            >
              <div className="text-caption font-medium">All turns</div>
            </TabsTab>
            {orderedTurnDiffSummaries.map((summary) => {
              const tabValue = String(summary.turnId);
              return (
                <TabsTab
                  key={summary.turnId}
                  value={tabValue}
                  className={(state) =>
                    cn(
                      "shrink-0 rounded-md border px-2 py-1 text-left transition-colors",
                      state.active
                        ? "border-border bg-accent text-accent-foreground"
                        : "border-border/70 bg-background/70 text-muted-foreground/80 hover:border-border hover:text-foreground/80",
                    )
                  }
                  onClick={() => onTurnTabClick(tabValue)}
                  title={summary.turnId}
                >
                  <div className="flex items-center gap-1">
                    <span className="text-caption font-medium">
                      Turn{" "}
                      {summary.checkpointTurnCount ??
                        inferredCheckpointTurnCountByTurnId[summary.turnId] ??
                        "?"}
                    </span>
                    <span className="text-[9px] leading-tight opacity-70">
                      {formatShortTimestamp(summary.completedAt, settings.timestampFormat)}
                    </span>
                  </div>
                </TabsTab>
              );
            })}
          </TabsList>
        </TabsRoot>
      </div>
      <div className="flex shrink-0 items-center gap-1 [-webkit-app-region:no-drag]">
        <ToggleGroup
          className="shrink-0"
          variant="outline"
          size="xs"
          value={[diffRenderMode]}
          onValueChange={(value) => {
            const next = value[0];
            if (next === "stacked" || next === "split") {
              setDiffRenderMode(next);
            }
          }}
        >
          <Toggle aria-label="Stacked diff view" value="stacked">
            <IconBrowserTabs className="size-3" />
          </Toggle>
          <Toggle aria-label="Split diff view" value="split">
            <IconColumnWideHalf className="size-3" />
          </Toggle>
        </ToggleGroup>
        <Toggle
          aria-label={diffWordWrap ? "Disable diff line wrapping" : "Enable diff line wrapping"}
          title={diffWordWrap ? "Disable line wrapping" : "Enable line wrapping"}
          variant="outline"
          size="xs"
          pressed={diffWordWrap}
          onPressedChange={(pressed) => {
            setDiffWordWrap(Boolean(pressed));
          }}
        >
          <IconText1 className="size-3" />
        </Toggle>
      </div>
    </>
  );

  return (
    <DiffPanelShell mode={mode} header={headerRow}>
      <DiffPanelWordWrapOpenSync
        key={`${diffOpen}:${settings.diffWordWrap}`}
        diffOpen={diffOpen}
        previousDiffOpenRef={previousDiffOpenRef}
        settingsDiffWordWrap={settings.diffWordWrap}
        setDiffWordWrap={setDiffWordWrap}
      />
      <DiffPanelSelectedFileScrollSync
        key={`${selectedFilePath ?? ""}:${renderableFilesKey}`}
        patchViewportRef={patchViewportRef}
        selectedFilePath={selectedFilePath}
      />
      <DiffPanelTurnStripObserver
        turnStripRef={turnStripRef}
        updateTurnStripScrollState={updateTurnStripScrollState}
      />
      <DiffPanelTurnStripScrollStateSync
        key={`${turnStripItemsKey}:${selectedTurnId ?? ""}`}
        updateTurnStripScrollState={updateTurnStripScrollState}
      />
      <DiffPanelSelectedTurnScrollSync
        key={`${selectedTurn?.turnId ?? ""}:${selectedTurnId ?? ""}`}
        turnStripRef={turnStripRef}
      />
      {!activeThread ? (
        <div className="flex flex-1 items-center justify-center px-5 text-center text-xs text-muted-foreground/70">
          Select a thread to inspect turn diffs.
        </div>
      ) : !isGitRepo ? (
        <div className="flex flex-1 items-center justify-center px-5 text-center text-xs text-muted-foreground/70">
          Turn diffs are unavailable because this project is not a git repository.
        </div>
      ) : orderedTurnDiffSummaries.length === 0 ? (
        <div className="flex flex-1 items-center justify-center px-5 text-center text-xs text-muted-foreground/70">
          No completed turns yet.
        </div>
      ) : (
        <>
          <div
            ref={patchViewportRef}
            className="diff-panel-viewport min-h-0 min-w-0 flex-1 overflow-hidden"
          >
            {!renderablePatch ? (
              isLoadingCheckpointDiff ? (
                <DiffPanelLoadingState label="Loading checkpoint diff..." />
              ) : checkpointDiffError ? (
                <div className="flex h-full items-center justify-center px-3 py-2 text-center text-xs text-red-500/80">
                  <p>{checkpointDiffError}</p>
                </div>
              ) : (
                <div className="flex h-full items-center justify-center px-3 py-2 text-xs text-muted-foreground/70">
                  <p>
                    {hasNoNetChanges
                      ? "No net changes in this selection."
                      : "No patch available for this selection."}
                  </p>
                </div>
              )
            ) : renderablePatch.kind === "files" ? (
              <Virtualizer
                className="diff-render-surface h-full min-h-0 overflow-auto px-2 pb-2"
                config={{
                  overscrollSize: 600,
                  intersectionObserverMargin: 1200,
                }}
              >
                {renderableFiles.map((fileDiff) => {
                  const filePath = resolveFileDiffPath(fileDiff);
                  const fileKey = buildFileDiffRenderKey(fileDiff);
                  const themedFileKey = `${fileKey}:${resolvedTheme}`;
                  return (
                    <div
                      key={themedFileKey}
                      data-diff-file-path={filePath}
                      className="diff-render-file mb-2 rounded-md first:mt-2 last:mb-0"
                      onClickCapture={(event) => {
                        const nativeEvent = event.nativeEvent as MouseEvent;
                        const composedPath = nativeEvent.composedPath?.() ?? [];
                        const clickedHeader = composedPath.some((node) => {
                          if (!(node instanceof Element)) return false;
                          return node.hasAttribute("data-title");
                        });
                        if (!clickedHeader) return;
                        openDiffFileInEditor(filePath);
                      }}
                    >
                      <FileDiff
                        fileDiff={fileDiff}
                        options={{
                          diffStyle: diffRenderMode === "split" ? "split" : "unified",
                          lineDiffType: "none",
                          overflow: diffWordWrap ? "wrap" : "scroll",
                          theme: resolveDiffThemeName(resolvedTheme),
                          themeType: resolvedTheme as DiffThemeType,
                          unsafeCSS: DIFF_PANEL_UNSAFE_CSS,
                        }}
                      />
                    </div>
                  );
                })}
              </Virtualizer>
            ) : (
              <div className="h-full overflow-auto p-2">
                <div className="space-y-2">
                  <p className="text-detail text-muted-foreground/75">{renderablePatch.reason}</p>
                  <pre
                    className={cn(
                      "max-h-[72vh] rounded-md border border-border/70 bg-background/70 p-3 font-mono text-detail text-muted-foreground/90",
                      diffWordWrap
                        ? "overflow-auto whitespace-pre-wrap wrap-break-word"
                        : "overflow-auto",
                    )}
                  >
                    {renderablePatch.text}
                  </pre>
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </DiffPanelShell>
  );
}

function DiffPanelWordWrapOpenSync({
  diffOpen,
  previousDiffOpenRef,
  settingsDiffWordWrap,
  setDiffWordWrap,
}: {
  diffOpen: boolean;
  previousDiffOpenRef: RefObject<boolean>;
  settingsDiffWordWrap: boolean;
  setDiffWordWrap: Dispatch<SetStateAction<boolean>>;
}) {
  useMountEffect(() => {
    if (diffOpen && !previousDiffOpenRef.current) {
      setDiffWordWrap(settingsDiffWordWrap);
    }
    previousDiffOpenRef.current = diffOpen;
  });

  return null;
}

function DiffPanelSelectedFileScrollSync({
  patchViewportRef,
  selectedFilePath,
}: {
  patchViewportRef: RefObject<HTMLDivElement | null>;
  selectedFilePath: string | null;
}) {
  useMountEffect(() => {
    if (!selectedFilePath || !patchViewportRef.current) {
      return;
    }
    const target = Array.from(
      patchViewportRef.current.querySelectorAll<HTMLElement>("[data-diff-file-path]"),
    ).find((element) => element.dataset.diffFilePath === selectedFilePath);
    target?.scrollIntoView({ block: "nearest" });
  });

  return null;
}

function DiffPanelTurnStripObserver({
  turnStripRef,
  updateTurnStripScrollState,
}: {
  turnStripRef: RefObject<HTMLDivElement | null>;
  updateTurnStripScrollState: () => void;
}) {
  useMountEffect(() => {
    const element = turnStripRef.current;
    if (!element) return;

    const frameId = window.requestAnimationFrame(() => updateTurnStripScrollState());
    const onScroll = () => updateTurnStripScrollState();

    element.addEventListener("scroll", onScroll, { passive: true });

    const resizeObserver = new ResizeObserver(() => updateTurnStripScrollState());
    resizeObserver.observe(element);

    return () => {
      window.cancelAnimationFrame(frameId);
      element.removeEventListener("scroll", onScroll);
      resizeObserver.disconnect();
    };
  });

  return null;
}

function DiffPanelTurnStripScrollStateSync({
  updateTurnStripScrollState,
}: {
  updateTurnStripScrollState: () => void;
}) {
  useMountEffect(() => {
    const frameId = window.requestAnimationFrame(() => updateTurnStripScrollState());
    return () => {
      window.cancelAnimationFrame(frameId);
    };
  });

  return null;
}

function DiffPanelSelectedTurnScrollSync({
  turnStripRef,
}: {
  turnStripRef: RefObject<HTMLDivElement | null>;
}) {
  useMountEffect(() => {
    const element = turnStripRef.current;
    if (!element) return;

    const selectedTab = element.querySelector<HTMLElement>("[role='tab'][aria-selected='true']");
    selectedTab?.scrollIntoView({
      block: "nearest",
      inline: "nearest",
      behavior: "smooth",
    });
  });

  return null;
}
