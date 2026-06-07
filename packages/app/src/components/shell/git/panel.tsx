"use client";

import type { GitFilePatchResult } from "@multi/contracts";
import { Virtualizer as DiffVirtualizer } from "@pierre/diffs/react";
import {
  IconBarsThree,
  IconChevronRightMedium,
  IconDotGrid1x3Horizontal,
  IconSplit,
  IconStepBack,
  IconStop,
} from "central-icons";
import {
  type RefObject,
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

import { Button } from "@multi/multikit/button";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuTrigger,
} from "@multi/multikit/menu";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "@multi/multikit/dialog";

import { formatGitActionErrorDescription } from "~/git/action-error-description";
import {
  type DiffRow,
  type GitPanelModel,
  useDiffStylePreference,
} from "~/hooks/use-environment-git";
import { useMountEffect } from "~/hooks/use-mount-effect";
import {
  GIT_AGENT_ACTIONS,
  GIT_AGENT_ACTION_ORDER,
  GIT_AGENT_PRIMARY_ACTION,
  type GitAgentAction,
} from "~/lib/git-agent-actions";
import { toastManager } from "~/app/toast";
import { useGitViewed } from "~/hooks/use-git-viewed-state";
import { cn } from "~/lib/utils";
import { shellPanelsActions, useSecondaryRail } from "~/stores/shell-panels-store";
import { GitChangesFileTree } from "./git-changes-file-tree";
import { GitDiffCard } from "./git-diff-card";
import {
  WorkbenchChromeActionGroup,
  WorkbenchChromeLabel,
  WorkbenchChromeRow,
  workbenchChromeTextControlVariants,
} from "@multi/multikit/workbench-chrome-row";
import { WorkbenchIconButton, workbenchIconButtonVariants } from "@multi/multikit/workbench-button";
import { RightWorkbenchLayout } from "../shell/right-workbench-layout";

type GitChangesFilter = "uncommitted" | "unstaged" | "staged" | "branch";
const GIT_CHANGES_FILTERS: readonly GitChangesFilter[] = [
  "uncommitted",
  "unstaged",
  "staged",
  "branch",
];

function isGitChangesFilter(value: string): value is GitChangesFilter {
  return (GIT_CHANGES_FILTERS as readonly string[]).includes(value);
}

const GIT_CHANGES_FILTER_LABELS: Record<GitChangesFilter, string> = {
  uncommitted: "Uncommitted",
  unstaged: "Unstaged",
  staged: "Staged",
  branch: "All commits",
};
const GIT_DIFF_VIRTUALIZER_CONFIG = {
  intersectionObserverMargin: 600,
  overscrollSize: 1_000,
} as const;

function showGitActionErrorToast(title: string, error: unknown): void {
  toastManager.add({
    type: "error",
    title,
    description: formatGitActionErrorDescription(error),
  });
}

function resolveGitPanelSelectedId(input: {
  readonly visibleFiles: readonly DiffRow[];
  readonly previousSelectedId: string | null;
  readonly focusId: string | null;
}): string | null {
  if (input.visibleFiles.length === 0) {
    return null;
  }
  if (input.focusId && input.visibleFiles.some((row) => row.id === input.focusId)) {
    return input.focusId;
  }
  if (
    input.previousSelectedId !== null &&
    input.visibleFiles.some((row) => row.id === input.previousSelectedId)
  ) {
    return input.previousSelectedId;
  }
  return input.visibleFiles[0]?.id ?? null;
}

export function GitPanel(props: {
  git: GitPanelModel;
  workspaceKey: string | null;
  onAgentAction: (action: GitAgentAction) => void;
  onStopAgentAction: (() => void) | null;
  stoppingAgentAction: boolean;
  pendingAgentAction: GitAgentAction | null;
}) {
  const git = props.git;

  switch (git.view.kind) {
    case "loading":
      return (
        <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
          <div className="h-3 w-24 animate-pulse rounded bg-muted/40" />
          <div className="h-3 w-full animate-pulse rounded bg-muted/30" />
          <div className="h-3 w-full animate-pulse rounded bg-muted/30" />
        </div>
      );
    case "idle":
      return (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-4 py-8 text-center">
          <p className="text-body font-medium text-foreground/85">No workspace selected</p>
          <p className="max-w-xs text-detail text-muted-foreground/72">
            Open a workspace to review changes.
          </p>
        </div>
      );
    case "error":
      return (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-4 py-8 text-center">
          <p className="text-body font-medium text-destructive/90">Git error</p>
          <p className="max-w-xs text-detail text-muted-foreground/80">{git.view.message}</p>
        </div>
      );
    case "no-repo":
      return <GitPanelNoRepo git={git} />;
    case "clean":
      return (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-4 py-12 text-center">
          <p className="text-body font-medium text-foreground/85">Working tree clean</p>
          <p className="max-w-72 text-detail text-muted-foreground/72">
            No staged or unstaged changes in this repository.
          </p>
        </div>
      );
    case "changed":
      return (
        <GitPanelInner
          git={git}
          workspaceKey={props.workspaceKey}
          onAgentAction={props.onAgentAction}
          onStopAgentAction={props.onStopAgentAction}
          stoppingAgentAction={props.stoppingAgentAction}
          pendingAgentAction={props.pendingAgentAction}
        />
      );
    default: {
      const _exhaustive: never = git.view;
      return _exhaustive;
    }
  }
}

function GitPanelNoRepo({ git }: { git: GitPanelModel }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-4 py-10 text-center">
      <div className="space-y-1 px-4 py-3">
        <p className="text-body font-medium text-foreground/85">No repository</p>
        <p className="max-w-72 text-detail text-muted-foreground/72">
          Initialize Git in this project to track changes and review diffs.
        </p>
      </div>
      <InitGitButton git={git} />
    </div>
  );
}

function InitGitButton({ git }: { git: GitPanelModel }) {
  const handleClick = () => {
    void git.init().catch((error: unknown) =>
      showGitActionErrorToast("Could not initialize Git", error),
    );
  };

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={handleClick}
      className="bg-multi-active/40 text-body font-medium text-foreground hover:bg-multi-hover"
    >
      Init Git
    </Button>
  );
}

function GitPanelChangesRail({
  active,
  rows,
  selectedId,
  onSelect,
}: {
  active: boolean;
  rows: readonly DiffRow[];
  selectedId: string | null;
  onSelect: (file: DiffRow) => void;
}) {
  return (
    <GitChangesFileTree
      active={active}
      rows={rows}
      selectedId={selectedId}
      onSelect={onSelect}
      className="no-drag min-h-0 min-h-36 flex-1 border-b-0 bg-transparent"
    />
  );
}

const GitDiffCardRow = memo(function GitDiffCardRow({
  file,
  selected,
  expanded,
  diffStyle,
  patch,
  diffRequested,
  loaded,
  loading,
  error,
  viewed,
  onToggleViewed,
  onRevert,
  requestPrefetchForIdRef,
  gitRef,
}: {
  file: DiffRow;
  selected: boolean;
  expanded: boolean;
  diffStyle: "unified" | "split";
  patch: GitFilePatchResult | null;
  diffRequested: boolean;
  loaded: boolean;
  loading: boolean;
  error: string | null;
  viewed: boolean;
  onToggleViewed: (path: string) => void;
  onRevert: (file: DiffRow) => void;
  requestPrefetchForIdRef: RefObject<(id: string) => void>;
  gitRef: RefObject<GitPanelModel>;
}) {
  const onExpandedChange = (open: boolean) => {
    gitRef.current.toggleExpand(file.id, open);
  };
  const handleToggleViewed = () => {
    onToggleViewed(file.path);
  };
  const handleRevert = () => {
    onRevert(file);
  };

  return (
    <GitDiffCard
      file={file}
      selected={selected}
      expanded={expanded}
      onExpandedChange={onExpandedChange}
      patch={patch}
      diffRequested={diffRequested}
      loaded={loaded}
      loading={loading}
      error={error}
      diffStyle={diffStyle}
      viewed={viewed}
      onToggleViewed={handleToggleViewed}
      onRevert={handleRevert}
      requestPrefetchForIdRef={requestPrefetchForIdRef}
    />
  );
});

function GitPanelInner(props: {
  git: GitPanelModel;
  workspaceKey: string | null;
  onAgentAction: (action: GitAgentAction) => void;
  onStopAgentAction: (() => void) | null;
  stoppingAgentAction: boolean;
  pendingAgentAction: GitAgentAction | null;
}) {
  const git = props.git;
  const files = git.rows;
  const viewed = useGitViewed(git.cwd);
  const { open: gitRailOpen } = useSecondaryRail(props.workspaceKey, "git");
  const [diffStyle, setDiffStyle] = useDiffStylePreference();
  const [pending, setPending] = useState<DiffRow | null>(null);
  const [discardAllPending, setDiscardAllPending] = useState(false);
  const [editorMenuOpen, setEditorMenuOpen] = useState(false);
  const [commitMenuOpen, setCommitMenuOpen] = useState(false);
  const [changesFilter, setChangesFilter] = useState<GitChangesFilter>("uncommitted");
  const visibleFiles = useMemo(
    () =>
      changesFilter === "unstaged"
        ? files.filter((row) => row.unstaged)
        : changesFilter === "staged"
          ? files.filter((row) => row.staged)
          : files,
    [changesFilter, files],
  );
  const visibleTotals = useMemo(
    () =>
      visibleFiles.reduce(
        (totals, row) => ({
          add: totals.add + row.add,
          del: totals.del + row.del,
        }),
        { add: 0, del: 0 },
      ),
    [visibleFiles],
  );
  const [selectedId, setSelectedId] = useState<string | null>(() =>
    resolveGitPanelSelectedId({
      visibleFiles,
      previousSelectedId: null,
      focusId: git.focusId,
    }),
  );

  useEffect(() => {
    setSelectedId((current) =>
      resolveGitPanelSelectedId({
        visibleFiles,
        previousSelectedId: current,
        focusId: git.focusId,
      }),
    );
  }, [git.focusId, visibleFiles]);
  const allDiffCardsCollapsed =
    visibleFiles.length > 0 && visibleFiles.every((row) => !git.expandedIds.has(row.id));
  const gitRef = useRef(git);
  gitRef.current = git;

  const deckRootRef = useRef<HTMLDivElement>(null);
  const prefetchRef = useRef<(id: string) => void>((id) => {
    void id;
  });
  prefetchRef.current = (id: string) => {
    git.requestDiff(id);
  };

  const pendingDiscardPaths = pending === null ? null : [pending.path];

  const confirmDiscard = () => {
    if (pendingDiscardPaths === null) return;
    void git
      .discard(pendingDiscardPaths)
      .catch((error: unknown) => showGitActionErrorToast("Could not discard changes", error));
    setPending(null);
  };

  const confirmDiscardAll = () => {
    const allPaths = files.map((f) => f.path);
    void git
      .discard(allPaths)
      .catch((error: unknown) => showGitActionErrorToast("Could not discard changes", error));
    setDiscardAllPending(false);
  };

  const handleCommitAndPush = () => {
    if (props.pendingAgentAction) return;
    props.onAgentAction(GIT_AGENT_PRIMARY_ACTION);
  };

  const handleSelectFile = (file: DiffRow) => {
    git.requestDiff(file.id);
    setSelectedId(file.id);
  };

  const handleToggleRail = () => {
    shellPanelsActions.toggleSecondaryRail(props.workspaceKey, "git");
  };

  const handleDiscardAll = () => {
    setDiscardAllPending(true);
  };

  const handleRefresh = () => {
    void git.refresh();
  };

  const handleRevertFile = (file: DiffRow) => {
    setPending(file);
  };

  const handlePendingDialogOpenChange = (open: boolean) => {
    if (!open) setPending(null);
  };

  const handleDiscardAllDialogOpenChange = (open: boolean) => {
    setDiscardAllPending(open);
  };

  const changesRail = (
    <GitPanelChangesRail
      active={gitRailOpen}
      rows={visibleFiles}
      selectedId={selectedId}
      onSelect={handleSelectFile}
    />
  );

  return (
    <>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <LocalBranchBar
          branch={git.branch}
          onCommitAndPush={handleCommitAndPush}
          onAgentAction={props.onAgentAction}
          onStopAgentAction={props.onStopAgentAction}
          stoppingAgentAction={props.stoppingAgentAction}
          diffStyle={diffStyle}
          onDiffStyle={setDiffStyle}
          editorMenuOpen={editorMenuOpen}
          onEditorMenuOpen={setEditorMenuOpen}
          commitMenuOpen={commitMenuOpen}
          onCommitMenuOpen={setCommitMenuOpen}
          pendingAgentAction={props.pendingAgentAction}
        />
        <ChangesHeader
          railOpen={gitRailOpen}
          onToggleRail={handleToggleRail}
          filter={changesFilter}
          onFilterChange={setChangesFilter}
          count={visibleFiles.length}
          add={visibleTotals.add}
          del={visibleTotals.del}
          onExpandAll={git.expandAll}
          onCollapseAll={git.collapseAll}
          allCollapsed={allDiffCardsCollapsed}
          onDiscardAll={handleDiscardAll}
          onRefresh={handleRefresh}
        />
        <RightWorkbenchLayout
          workspaceKey={props.workspaceKey}
          tab="git"
          railHostClassName="bg-(--multi-shell-sidebar-bg) shadow-[inset_-1px_0_0_color-mix(in_srgb,var(--multi-stroke-quaternary)_78%,transparent)]"
          rail={changesRail}
        >
          <div
            ref={deckRootRef}
            className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-(--multi-workbench-editor-surface-background)"
          >
            {selectedId ? (
              <SelectedGitDiffSync
                key={selectedId}
                selectedId={selectedId}
                deckRootRef={deckRootRef}
                gitRef={gitRef}
              />
            ) : null}
            {visibleFiles.length === 0 ? (
              <div className="flex flex-1 items-center justify-center text-detail text-muted-foreground/60">
                {changesFilter === "staged"
                  ? "No staged changes."
                  : changesFilter === "unstaged"
                    ? "No unstaged changes."
                    : "No files to compare."}
              </div>
            ) : (
              <DiffVirtualizer
                className="git-diff-scroll-root h-full min-h-0 overflow-x-hidden overflow-y-auto overscroll-contain bg-(--multi-git-diff-editor-background) px-0 pb-0 [overflow-anchor:none] scrollbar-gutter-stable"
                contentClassName="min-w-0"
                config={GIT_DIFF_VIRTUALIZER_CONFIG}
              >
                {visibleFiles.map((file) => (
                  <GitDiffCardRow
                    key={file.id}
                    file={file}
                    selected={selectedId === file.id}
                    expanded={git.expandedIds.has(file.id)}
                    patch={git.patchesByPath.get(file.path) ?? null}
                    diffRequested={git.activeDiffIds.has(file.id)}
                    loaded={git.patchesByPath.has(file.path)}
                    loading={git.diffLoadingByPath.has(file.path)}
                    error={git.diffErrorByPath.get(file.path) ?? null}
                    diffStyle={diffStyle}
                    viewed={viewed.isViewed(file.path)}
                    onToggleViewed={viewed.toggleViewed}
                    onRevert={handleRevertFile}
                    requestPrefetchForIdRef={prefetchRef}
                    gitRef={gitRef}
                  />
                ))}
              </DiffVirtualizer>
            )}
          </div>
        </RightWorkbenchLayout>
      </div>
      <DiscardDialog
        open={pending !== null}
        path={pending?.path ?? ""}
        onConfirm={confirmDiscard}
        onOpenChange={handlePendingDialogOpenChange}
      />
      <DiscardAllDialog
        open={discardAllPending}
        count={files.length}
        onConfirm={confirmDiscardAll}
        onOpenChange={handleDiscardAllDialogOpenChange}
      />
    </>
  );
}

function scrollDiffCardIntoView(scroller: HTMLElement, target: HTMLElement): void {
  const scrollerRect = scroller.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const padding = 8;
  const viewportTop = scrollerRect.top + padding;
  const viewportBottom = scrollerRect.bottom - padding;
  let nextTop = scroller.scrollTop;

  if (targetRect.height >= viewportBottom - viewportTop || targetRect.top < viewportTop) {
    nextTop -= viewportTop - targetRect.top;
  } else if (targetRect.bottom > viewportBottom) {
    nextTop += targetRect.bottom - viewportBottom;
  } else {
    return;
  }

  scroller.scrollTo({ top: Math.max(0, nextTop) });
}

function SelectedGitDiffSync(props: {
  readonly selectedId: string;
  readonly deckRootRef: { readonly current: HTMLDivElement | null };
  readonly gitRef: { readonly current: GitPanelModel };
}) {
  useMountEffect(() => {
    let settleFrame: number | null = null;
    const frame = requestAnimationFrame(() => {
      props.gitRef.current.toggleExpand(props.selectedId, true);

      const scrollMountedCard = (remainingFrames: number) => {
        const root = props.deckRootRef.current;
        if (!root) return;

        const escaped = CSS.escape(props.selectedId);
        const target = root.querySelector<HTMLElement>(`[data-diff-card-id="${escaped}"]`);
        if (!target) {
          if (remainingFrames > 0) {
            settleFrame = requestAnimationFrame(() => scrollMountedCard(remainingFrames - 1));
          }
          return;
        }

        const scroller = root.querySelector<HTMLElement>(".git-diff-scroll-root");
        if (scroller) {
          scrollDiffCardIntoView(scroller, target);
          return;
        }

        target.scrollIntoView({ block: "nearest", behavior: "auto" });
      };
      settleFrame = requestAnimationFrame(() => scrollMountedCard(3));
    });

    return () => {
      cancelAnimationFrame(frame);
      if (settleFrame !== null) {
        cancelAnimationFrame(settleFrame);
      }
    };
  });

  return null;
}

function LocalBranchBarTrailing(props: {
  onCommitAndPush: () => void;
  onAgentAction: (action: GitAgentAction) => void;
  onStopAgentAction: (() => void) | null;
  stoppingAgentAction: boolean;
  diffStyle: "unified" | "split";
  onDiffStyle: (next: "unified" | "split") => void;
  editorMenuOpen: boolean;
  onEditorMenuOpen: (open: boolean) => void;
  commitMenuOpen: boolean;
  onCommitMenuOpen: (open: boolean) => void;
  pendingAgentAction: GitAgentAction | null;
}) {
  const pendingActionDetails = props.pendingAgentAction
    ? GIT_AGENT_ACTIONS[props.pendingAgentAction]
    : null;
  const isAgentActionPending = props.pendingAgentAction !== null;

  const handleDiffStyleChange = (value: string) => {
    if (value !== "unified" && value !== "split") return;
    props.onDiffStyle(value);
    props.onEditorMenuOpen(false);
  };
  const handlePrimaryCommitAction = () => {
    if (isAgentActionPending) {
      props.onStopAgentAction?.();
      return;
    }
    props.onCommitMenuOpen(false);
    props.onCommitAndPush();
  };
  const handleCommitMenuOpenChange = (open: boolean) => {
    if (isAgentActionPending && open) return;
    props.onCommitMenuOpen(open);
  };

  return (
    <WorkbenchChromeActionGroup gap="sub">
      <div className="no-drag relative shrink-0">
        <Menu open={props.editorMenuOpen} onOpenChange={props.onEditorMenuOpen}>
          <MenuTrigger
            type="button"
            className={workbenchIconButtonVariants({ chrome: "panel" })}
            aria-label="Editor Options"
            title="Editor Options"
            data-active={false}
            data-chrome="panel"
            data-slot="workbench-icon-button"
            data-tab-system={false}
          >
            <IconDotGrid1x3Horizontal className="size-4" />
          </MenuTrigger>
          <MenuPopup align="end" variant="workbench">
            <MenuRadioGroup value={props.diffStyle} onValueChange={handleDiffStyleChange}>
              <MenuRadioItem value="unified" variant="workbench">
                <IconBarsThree className="size-3" />
                Unified Diff
              </MenuRadioItem>
              <MenuRadioItem value="split" variant="workbench">
                <IconSplit className="size-3" />
                Split Diff
              </MenuRadioItem>
            </MenuRadioGroup>
          </MenuPopup>
        </Menu>
      </div>
      <Menu open={props.commitMenuOpen} onOpenChange={handleCommitMenuOpenChange}>
        <div
          className="group no-drag inline-flex h-(--multi-workbench-action-size) min-w-0 select-none overflow-hidden rounded-multi-control border border-primary bg-primary text-body font-medium text-primary-foreground shadow-sm data-[pending=true]:border-destructive data-[pending=true]:bg-destructive"
          data-pending={isAgentActionPending || undefined}
        >
          <Button
            type="button"
            variant={isAgentActionPending ? "destructive" : "default"}
            className="inline-flex h-full min-w-0 select-none items-center justify-center gap-(--multi-workbench-text-control-gap) rounded-none border-0 px-(--multi-workbench-text-control-padding-inline) text-inherit shadow-none before:hidden transition-colors hover:bg-primary/90 disabled:cursor-default disabled:opacity-70 disabled:hover:bg-transparent group-data-[pending=true]:hover:bg-destructive/90"
            disabled={
              isAgentActionPending &&
              (props.onStopAgentAction === null || props.stoppingAgentAction)
            }
            aria-busy={isAgentActionPending || undefined}
            aria-label={isAgentActionPending ? "Stop Git action" : undefined}
            onClick={handlePrimaryCommitAction}
          >
            {isAgentActionPending ? <IconStop className="size-3" /> : null}
            {props.stoppingAgentAction
              ? "Stopping..."
              : (pendingActionDetails?.loadingLabel ?? "Commit & Push")}
          </Button>
          <MenuTrigger
            type="button"
            className="inline-flex h-full w-6 shrink-0 select-none items-center justify-center border-l border-primary-foreground/18 text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-default disabled:opacity-70 disabled:hover:bg-transparent data-[popup-open]:bg-primary/90"
            disabled={isAgentActionPending}
            aria-label="Open commit menu"
            title="Open commit menu"
          >
            <IconChevronRightMedium className="size-3 rotate-90" />
          </MenuTrigger>
        </div>
        <MenuPopup align="end" variant="workbench">
          {GIT_AGENT_ACTION_ORDER.map((action) => (
            <GitAgentActionMenuItem
              key={action}
              action={action}
              pendingAgentAction={props.pendingAgentAction}
              onAgentAction={props.onAgentAction}
              onCommitMenuOpen={props.onCommitMenuOpen}
            />
          ))}
        </MenuPopup>
      </Menu>
    </WorkbenchChromeActionGroup>
  );
}

function GitAgentActionMenuItem(props: {
  action: GitAgentAction;
  pendingAgentAction: GitAgentAction | null;
  onAgentAction: (action: GitAgentAction) => void;
  onCommitMenuOpen: (open: boolean) => void;
}) {
  const handleClick = () => {
    if (props.pendingAgentAction !== null) return;
    props.onAgentAction(props.action);
    props.onCommitMenuOpen(false);
  };

  return (
    <MenuItem onClick={handleClick} variant="workbench">
      {GIT_AGENT_ACTIONS[props.action].label}
    </MenuItem>
  );
}

function LocalBranchBar(props: {
  branch: string | null;
  onCommitAndPush: () => void;
  onAgentAction: (action: GitAgentAction) => void;
  onStopAgentAction: (() => void) | null;
  stoppingAgentAction: boolean;
  diffStyle: "unified" | "split";
  onDiffStyle: (next: "unified" | "split") => void;
  editorMenuOpen: boolean;
  onEditorMenuOpen: (open: boolean) => void;
  commitMenuOpen: boolean;
  onCommitMenuOpen: (open: boolean) => void;
  pendingAgentAction: GitAgentAction | null;
}) {
  const copyBranch = () => {
    if (!props.branch) return;
    void navigator.clipboard.writeText(props.branch);
    toast.success("Branch copied");
  };
  const trailing = <LocalBranchBarTrailing {...props} />;

  return (
    <WorkbenchChromeRow variant="panel" trailing={trailing}>
      <WorkbenchChromeLabel>Local</WorkbenchChromeLabel>
      <Button
        type="button"
        variant="ghost"
        onClick={copyBranch}
        className={workbenchChromeTextControlVariants({ tone: "primary" })}
        title="Copy branch name"
      >
        <span className="truncate">{props.branch ?? "detached"}</span>
      </Button>
    </WorkbenchChromeRow>
  );
}

function ChangesHeaderTrailing(props: {
  allCollapsed: boolean;
  onDiscardAll: () => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
}) {
  const toggleAll = props.allCollapsed ? props.onExpandAll : props.onCollapseAll;
  const toggleAllLabel = props.allCollapsed ? "Expand all" : "Collapse all";

  return (
    <WorkbenchChromeActionGroup gap="sub">
      <WorkbenchIconButton
        onClick={props.onDiscardAll}
        aria-label="Discard all changes"
        title="Discard all changes"
        chrome="panel"
      >
        <IconStepBack className="size-4 shrink-0" />
      </WorkbenchIconButton>
      <WorkbenchIconButton
        onClick={toggleAll}
        aria-label={toggleAllLabel}
        title={toggleAllLabel}
        chrome="panel"
      >
        {props.allCollapsed ? (
          <IconChevronRightMedium className="size-3 rotate-90" />
        ) : (
          <IconChevronRightMedium className="size-3" />
        )}
      </WorkbenchIconButton>
    </WorkbenchChromeActionGroup>
  );
}

function ChangesHeader(props: {
  railOpen: boolean;
  onToggleRail: () => void;
  filter: GitChangesFilter;
  onFilterChange: (filter: GitChangesFilter) => void;
  count: number;
  add: number;
  del: number;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  allCollapsed: boolean;
  onDiscardAll: () => void;
  onRefresh: () => void;
}) {
  const trailing = (
    <ChangesHeaderTrailing
      allCollapsed={props.allCollapsed}
      onDiscardAll={props.onDiscardAll}
      onExpandAll={props.onExpandAll}
      onCollapseAll={props.onCollapseAll}
    />
  );

  return (
    <WorkbenchChromeRow variant="panel" trailing={trailing}>
      <WorkbenchIconButton
        onClick={props.onToggleRail}
        aria-label={props.railOpen ? "Hide changes list" : "Show changes list"}
        aria-pressed={props.railOpen}
        active={props.railOpen}
        title={props.railOpen ? "Hide changes list" : "Show changes list"}
        chrome="panel"
      >
        <IconBarsThree className="size-4 shrink-0" aria-hidden />
      </WorkbenchIconButton>
      <ChangesFilterMenu
        count={props.count}
        filter={props.filter}
        onFilterChange={props.onFilterChange}
      />
      <DiffTotals add={props.add} del={props.del} />
    </WorkbenchChromeRow>
  );
}

function ChangesFilterMenu(props: {
  count: number;
  filter: GitChangesFilter;
  onFilterChange: (filter: GitChangesFilter) => void;
}) {
  const label =
    props.filter === "branch"
      ? GIT_CHANGES_FILTER_LABELS.branch
      : `${props.count} ${GIT_CHANGES_FILTER_LABELS[props.filter]} Change${props.count === 1 ? "" : "s"}`;
  const handleFilterChange = (value: string) => {
    if (!isGitChangesFilter(value) || value === props.filter) return;
    props.onFilterChange(value);
  };

  return (
    <Menu>
      <MenuTrigger
        type="button"
        className={cn(workbenchChromeTextControlVariants({ tabular: true }), "max-w-64")}
        aria-label="Change filter"
      >
        <span className="min-w-0 truncate">{label}</span>
        <IconChevronRightMedium
          className="size-3 shrink-0 rotate-90 text-multi-icon-tertiary"
          aria-hidden
        />
      </MenuTrigger>
      <MenuPopup align="start" variant="workbench">
        <MenuRadioGroup value={props.filter} onValueChange={handleFilterChange}>
          {GIT_CHANGES_FILTERS.map((filter) => (
            <MenuRadioItem key={filter} value={filter} variant="workbench">
              {GIT_CHANGES_FILTER_LABELS[filter]}
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuPopup>
    </Menu>
  );
}

function DiffTotals(props: { add: number; del: number }) {
  return (
    <WorkbenchChromeActionGroup gap="sub" className="tabular-nums">
      <span
        className={cn(
          "inline-flex justify-end text-multi-diff-addition",
          props.add === 0 && "invisible",
        )}
      >
        +{props.add}
      </span>
      <span
        className={cn(
          "inline-flex justify-end text-multi-diff-deletion",
          props.del === 0 && "invisible",
        )}
      >
        -{props.del}
      </span>
    </WorkbenchChromeActionGroup>
  );
}

function DiscardAllDialog(props: {
  open: boolean;
  count: number;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
}) {
  const handleCancel = () => {
    props.onOpenChange(false);
  };
  const handleConfirm = () => {
    props.onConfirm();
    props.onOpenChange(false);
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPopup className="max-w-md" showCloseButton>
        <DialogHeader>
          <DialogTitle>Discard all changes?</DialogTitle>
          <DialogDescription>
            Revert all {props.count} file{props.count === 1 ? "" : "s"} to the last committed
            version. This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={handleCancel}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" onClick={handleConfirm}>
            Discard All
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function DiscardDialog(props: {
  open: boolean;
  path: string;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
}) {
  const handleCancel = () => {
    props.onOpenChange(false);
  };
  const handleConfirm = () => {
    props.onConfirm();
    props.onOpenChange(false);
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPopup className="max-w-md" showCloseButton>
        <DialogHeader>
          <DialogTitle>Discard changes?</DialogTitle>
          <DialogDescription>
            Revert <span className="font-mono text-foreground/90">{props.path}</span> to the last
            committed version. This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={handleCancel}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" onClick={handleConfirm}>
            Discard
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
