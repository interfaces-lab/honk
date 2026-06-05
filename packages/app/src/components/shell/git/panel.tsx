"use client";

import type { GitFilePatchResult } from "@multi/contracts";
import {
  IconBarsThree,
  IconBranch,
  IconChevronRightMedium,
  IconDotGrid1x3Horizontal,
  IconFolder1,
  IconSplit,
  IconStepBack,
  IconStop,
} from "central-icons";
import {
  type ComponentType,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

import { Button } from "@multi/ui/button";
import { Menu, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "@multi/ui/menu";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "@multi/ui/dialog";

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
import { WorkbenchChromeRow } from "../shell/workbench-chrome-row";
import { WorkbenchIconButton } from "@multi/ui/workbench-button";
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
    <button
      type="button"
      onClick={handleClick}
      className="select-none rounded-multi-control border border-multi-border/60 bg-multi-active/40 px-3 py-2 text-body font-medium text-foreground transition-colors hover:bg-multi-hover"
    >
      Init Git
    </button>
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

function GitDiffCardRow({
  file,
  selected,
  expanded,
  diffStyle,
  diffLayoutKey,
  patch,
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
  diffLayoutKey: string;
  patch: GitFilePatchResult | null;
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
      loaded={loaded}
      loading={loading}
      error={error}
      diffStyle={diffStyle}
      viewed={viewed}
      onToggleViewed={handleToggleViewed}
      onRevert={handleRevert}
      requestPrefetchForIdRef={requestPrefetchForIdRef}
      diffLayoutKey={diffLayoutKey}
    />
  );
}

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
  const { open: gitRailOpen, width: gitRailWidth } = useSecondaryRail(props.workspaceKey, "git");
  const [diffStyle, setDiffStyle] = useDiffStylePreference();
  const [pending, setPending] = useState<DiffRow | null>(null);
  const [discardAllPending, setDiscardAllPending] = useState(false);
  const [editorMenuOpen, setEditorMenuOpen] = useState(false);
  const [commitMenuOpen, setCommitMenuOpen] = useState(false);
  const [changesFilter, setChangesFilter] = useState<GitChangesFilter>("uncommitted");
  const visibleFiles =
    changesFilter === "unstaged"
      ? files.filter((row) => row.unstaged)
      : changesFilter === "staged"
        ? files.filter((row) => row.staged)
        : files;
  const visibleTotals = visibleFiles.reduce(
    (totals, row) => ({
      add: totals.add + row.add,
      del: totals.del + row.del,
    }),
    { add: 0, del: 0 },
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
  const diffLayoutKey = gitRailOpen ? `rail:${gitRailWidth}` : "rail:closed";
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
              <div className="h-full min-h-0 overflow-x-hidden overflow-y-auto overscroll-contain bg-(--multi-git-diff-editor-background) px-0 pb-0 [overflow-anchor:none] scrollbar-gutter-stable">
                {visibleFiles.map((file) => (
                  <GitDiffCardRow
                    key={file.id}
                    file={file}
                    selected={selectedId === file.id}
                    expanded={git.expandedIds.has(file.id)}
                    patch={git.patchesByPath.get(file.path) ?? null}
                    loaded={git.patchesByPath.has(file.path)}
                    loading={git.diffLoadingByPath.has(file.path)}
                    error={git.diffErrorByPath.get(file.path) ?? null}
                    diffStyle={diffStyle}
                    viewed={viewed.isViewed(file.path)}
                    onToggleViewed={viewed.toggleViewed}
                    onRevert={handleRevertFile}
                    requestPrefetchForIdRef={prefetchRef}
                    diffLayoutKey={diffLayoutKey}
                    gitRef={gitRef}
                  />
                ))}
              </div>
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

function SelectedGitDiffSync(props: {
  readonly selectedId: string;
  readonly deckRootRef: { readonly current: HTMLDivElement | null };
  readonly gitRef: { readonly current: GitPanelModel };
}) {
  useMountEffect(() => {
    const frame = requestAnimationFrame(() => {
      props.gitRef.current.toggleExpand(props.selectedId, true);
      const root = props.deckRootRef.current;
      if (!root) return;

      const escaped = CSS.escape(props.selectedId);
      root.querySelector(`[data-diff-card-id="${escaped}"]`)?.scrollIntoView({
        block: "nearest",
        behavior: "smooth",
      });
    });

    return () => cancelAnimationFrame(frame);
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

  const toggleEditorMenu = () => {
    props.onEditorMenuOpen(!props.editorMenuOpen);
  };
  const closeEditorMenu = () => {
    props.onEditorMenuOpen(false);
  };
  const selectUnifiedDiff = () => {
    props.onDiffStyle("unified");
    props.onEditorMenuOpen(false);
  };
  const selectSplitDiff = () => {
    props.onDiffStyle("split");
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
  const toggleCommitMenu = () => {
    if (isAgentActionPending) return;
    props.onCommitMenuOpen(!props.commitMenuOpen);
  };
  const closeCommitMenu = () => {
    props.onCommitMenuOpen(false);
  };

  return (
    <div className="no-drag flex shrink-0 items-center gap-(--multi-workbench-sub-chrome-action-gap)">
      <div className="no-drag relative shrink-0">
        <WorkbenchIconButton
          onClick={toggleEditorMenu}
          aria-label="Editor Options"
          title="Editor Options"
          chrome="panel"
        >
          <IconDotGrid1x3Horizontal className="size-4" />
        </WorkbenchIconButton>
        {props.editorMenuOpen ? (
          <>
            <button
              type="button"
              className="fixed inset-0 z-40 cursor-default border-0 bg-transparent p-0"
              aria-label="Close editor options"
              onClick={closeEditorMenu}
            />
            <div
              className="absolute top-full right-0 z-50 mt-1 min-w-44 rounded-multi-control border border-multi-stroke-secondary bg-multi-bg-elevated p-[3px] text-multi-fg-primary shadow-multi-popup"
              role="menu"
            >
              <MenuItem
                label="Unified Diff"
                active={props.diffStyle === "unified"}
                icon={UnifiedDiffMenuIcon}
                onClick={selectUnifiedDiff}
              />
              <MenuItem
                label="Split Diff"
                active={props.diffStyle === "split"}
                icon={SplitDiffMenuIcon}
                onClick={selectSplitDiff}
              />
            </div>
          </>
        ) : null}
      </div>
      <div className="no-drag relative min-w-0 shrink-0">
        <div
          className="group no-drag inline-flex h-(--multi-workbench-action-size) min-w-0 select-none overflow-hidden rounded-multi-control border border-primary bg-primary text-body font-medium text-primary-foreground shadow-sm data-[pending=true]:border-rose-500/90 data-[pending=true]:bg-rose-500/90"
          data-pending={isAgentActionPending || undefined}
        >
          <button
            type="button"
            className="inline-flex h-full min-w-0 select-none items-center justify-center gap-1.5 px-2 text-inherit transition-colors hover:bg-primary/90 disabled:cursor-default disabled:opacity-70 disabled:hover:bg-transparent group-data-[pending=true]:hover:bg-rose-500/90"
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
          </button>
          <button
            type="button"
            className="inline-flex h-full w-6 shrink-0 select-none items-center justify-center border-l border-primary-foreground/18 text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-default disabled:opacity-70 disabled:hover:bg-transparent data-[open=true]:bg-primary/90"
            disabled={isAgentActionPending}
            onClick={toggleCommitMenu}
            aria-label="Open commit menu"
            aria-expanded={props.commitMenuOpen}
            aria-haspopup="menu"
            data-open={props.commitMenuOpen || undefined}
            title="Open commit menu"
          >
            <IconChevronRightMedium className="size-3 rotate-90" />
          </button>
        </div>
        {props.commitMenuOpen ? (
          <>
            <button
              type="button"
              className="fixed inset-0 z-40 cursor-default border-0 bg-transparent p-0"
              aria-label="Close commit menu"
              onClick={closeCommitMenu}
            />
            <div
              className="absolute top-full right-0 z-50 mt-1 min-w-44 rounded-multi-control border border-multi-stroke-secondary bg-multi-bg-elevated p-[3px] text-multi-fg-primary shadow-multi-popup"
              role="menu"
            >
              {GIT_AGENT_ACTION_ORDER.map((action) => (
                <GitAgentActionMenuItem
                  key={action}
                  action={action}
                  pendingAgentAction={props.pendingAgentAction}
                  onAgentAction={props.onAgentAction}
                  onCommitMenuOpen={props.onCommitMenuOpen}
                />
              ))}
            </div>
          </>
        ) : null}
      </div>
    </div>
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
    <MenuItem label={GIT_AGENT_ACTIONS[props.action].label} onClick={handleClick} />
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
    <WorkbenchChromeRow variant="panel" gap="loose" trailing={trailing}>
      <span className="no-drag inline-flex h-(--multi-workbench-action-size) shrink-0 items-center text-body font-medium text-multi-fg-secondary">
        Local
      </span>
      <button
        type="button"
        onClick={copyBranch}
        className="no-drag inline-flex h-(--multi-workbench-action-size) min-w-0 select-none items-center gap-(--multi-workbench-sub-chrome-action-gap) overflow-hidden rounded-multi-control px-1.5 text-body font-medium text-multi-fg-primary transition-colors hover:bg-multi-bg-quaternary hover:text-multi-fg-primary"
        title="Copy branch name"
      >
        <IconBranch className="size-4 shrink-0 text-multi-icon-tertiary" />
        <span className="truncate font-mono">{props.branch ?? "detached"}</span>
      </button>
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
    <div className="flex shrink-0 items-center gap-(--multi-workbench-sub-chrome-action-gap)">
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
    </div>
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
    <WorkbenchChromeRow variant="panel" gap="loose" trailing={trailing}>
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
        className="no-drag inline-flex h-(--multi-workbench-action-size) min-w-0 max-w-64 select-none items-center gap-1 overflow-hidden rounded-multi-control px-1.5 text-body font-medium text-multi-fg-secondary tabular-nums outline-hidden transition-colors hover:bg-multi-bg-quaternary hover:text-multi-fg-primary data-popup-open:bg-multi-bg-quaternary data-popup-open:text-multi-fg-primary focus-visible:ring-1 focus-visible:ring-multi-stroke-focused focus-visible:ring-inset"
        aria-label="Change filter"
      >
        <IconFolder1 className="size-4 shrink-0 text-multi-icon-tertiary" aria-hidden />
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
    <div className="flex h-(--multi-workbench-action-size) shrink-0 items-center gap-1.5 text-body font-medium tabular-nums">
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
    </div>
  );
}

function UnifiedDiffMenuIcon() {
  return <IconBarsThree className="size-3" />;
}

function SplitDiffMenuIcon() {
  return <IconSplit className="size-3" />;
}

function MenuItem(props: {
  label: string;
  onClick: () => void;
  active?: boolean | undefined;
  icon?: ComponentType<{ className?: string | undefined }> | undefined;
}) {
  const Icon = props.icon;
  return (
    <button
      type="button"
      onClick={props.onClick}
      role="menuitem"
      className="group flex w-full min-w-0 items-center gap-1.5 rounded-sm px-1.5 py-1 text-left text-detail text-multi-fg-secondary transition-colors hover:bg-multi-bg-quaternary hover:text-multi-fg-primary data-[active=true]:bg-multi-bg-quaternary data-[active=true]:text-multi-fg-primary"
      data-active={props.active || undefined}
    >
      {Icon ? (
        <span className="inline-flex w-3.5 shrink-0 justify-center text-multi-icon-tertiary group-data-[active=true]:text-multi-icon-primary">
          <Icon className="size-3" />
        </span>
      ) : null}
      <span className="min-w-0 flex-1 truncate">{props.label}</span>
    </button>
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
