"use client";

import {
  IconChevronLeftMedium,
  IconBarsThree,
  IconBranch,
  IconChevronRightMedium,
  IconDotGrid1x3Horizontal,
  IconFolder1,
  IconSplit,
  IconStop,
} from "central-icons";
import { Virtualizer } from "@pierre/diffs/react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { useNavigate, useSearch } from "@tanstack/react-router";

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

import { isElectron } from "~/env";
import {
  type DiffRow,
  type GitPanelModel,
  useDiffStylePreference,
} from "~/hooks/use-environment-git";
import {
  GIT_AGENT_ACTIONS,
  GIT_AGENT_ACTION_ORDER,
  GIT_AGENT_PRIMARY_ACTION,
  type GitAgentAction,
} from "~/lib/git-agent-actions";
import { useGitViewed } from "~/hooks/use-git-viewed-state";
import { parseDiffRouteSearch, stripDiffSearchParams } from "~/diff-route-search";
import { cn } from "~/lib/utils";
import ReviewDiffPanel from "~/components/diff-panel";
import { DiffWorkerPoolProvider } from "~/components/diff-worker-pool-provider";
import { shellPanelsActions, useSecondaryRail } from "~/stores/shell-panels-store";
import { GitChangesFileTree } from "./git-changes-file-tree";
import { GitDiffCard } from "./git-diff-card";
import { WorkbenchChromeRow } from "../shell/workbench-chrome-row";
import { WorkbenchIconButton, WorkbenchTextButton } from "../shell/workbench-icon-button";
import { RightWorkbenchLayout } from "../shell/right-workbench-layout";

type GitChangesFilter = "uncommitted" | "unstaged" | "staged" | "branch";

const GIT_CHANGES_FILTERS: readonly GitChangesFilter[] = [
  "uncommitted",
  "unstaged",
  "staged",
  "branch",
];

const GIT_CHANGES_FILTER_LABELS: Record<GitChangesFilter, string> = {
  uncommitted: "Uncommitted",
  unstaged: "Unstaged",
  staged: "Staged",
  branch: "All commits",
};

export function GitPanel(props: {
  git: GitPanelModel;
  onAgentAction: (action: GitAgentAction) => void;
  onStopAgentAction: (() => void) | null;
  stoppingAgentAction: boolean;
  pendingAgentAction: GitAgentAction | null;
}) {
  const git = props.git;
  const reviewingTurnDiff =
    useSearch({ strict: false, select: (search) => parseDiffRouteSearch(search).diff }) === "1";

  if (!isElectron) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-4 py-8 text-center">
        <p className="text-body font-medium text-foreground/85">Source control</p>
        <p className="max-w-72 text-detail text-muted-foreground/72">
          Git status and diffs are available in the Multi desktop app.
        </p>
      </div>
    );
  }

  if (reviewingTurnDiff && git.view.kind !== "changed") {
    return <GitReviewOnlyPanel />;
  }

  switch (git.view.kind) {
    case "idle":
    case "loading":
      return (
        <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
          <div className="h-3 w-24 animate-pulse rounded bg-muted/40" />
          <div className="h-3 w-full animate-pulse rounded bg-muted/30" />
          <div className="h-3 w-full animate-pulse rounded bg-muted/30" />
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
      return (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-4 py-10 text-center">
          <div className="space-y-1 px-4 py-3">
            <p className="text-body font-medium text-foreground/85">No repository</p>
            <p className="max-w-72 text-detail text-muted-foreground/72">
              Initialize Git in this project to track changes and review diffs.
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              void git
                .init()
                .catch((error: unknown) =>
                  toast.error(error instanceof Error ? error.message : String(error)),
                );
            }}
            className="rounded-multi-control border border-multi-border/60 bg-multi-active/40 px-3 py-2 text-body font-medium text-foreground transition-colors hover:bg-multi-hover"
          >
            Init Git
          </button>
        </div>
      );
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
          reviewingTurnDiff={reviewingTurnDiff}
          onAgentAction={props.onAgentAction}
          onStopAgentAction={props.onStopAgentAction}
          stoppingAgentAction={props.stoppingAgentAction}
          pendingAgentAction={props.pendingAgentAction}
        />
      );
  }
}

function GitPanelInner(props: {
  git: GitPanelModel;
  reviewingTurnDiff: boolean;
  onAgentAction: (action: GitAgentAction) => void;
  onStopAgentAction: (() => void) | null;
  stoppingAgentAction: boolean;
  pendingAgentAction: GitAgentAction | null;
}) {
  const git = props.git;
  const files = git.rows;
  const viewed = useGitViewed(git.cwd);
  const navigate = useNavigate();
  const { open: gitRailOpen, width: gitRailWidth } = useSecondaryRail(git.cwd, "git");
  const [diffStyle, setDiffStyle] = useDiffStylePreference();
  const [pending, setPending] = useState<DiffRow | null>(null);
  const [discardAllPending, setDiscardAllPending] = useState(false);
  const [editorMenuOpen, setEditorMenuOpen] = useState(false);
  const [commitMenuOpen, setCommitMenuOpen] = useState(false);
  const [changesFilter, setChangesFilter] = useState<GitChangesFilter>("uncommitted");
  const visibleFiles = useMemo(() => {
    if (changesFilter === "unstaged") return files.filter((row) => row.unstaged);
    if (changesFilter === "staged") return files.filter((row) => row.staged);
    return files;
  }, [changesFilter, files]);
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
  const filesKey = useMemo(() => visibleFiles.map((row) => row.id).join("\n"), [visibleFiles]);
  const [selectedId, setSelectedId] = useState<string | null>(() => visibleFiles[0]?.id ?? null);
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

  useEffect(() => {
    if (visibleFiles.length === 0) {
      setSelectedId(null);
      return;
    }

    setSelectedId((previous) => {
      if (git.focusId && visibleFiles.some((row) => row.id === git.focusId)) {
        return git.focusId;
      }

      return previous !== null && visibleFiles.some((row) => row.id === previous)
        ? previous
        : visibleFiles[0]!.id;
    });
  }, [filesKey, git.focusId, visibleFiles]);

  useEffect(() => {
    if (!selectedId) return;
    gitRef.current.toggleExpand(selectedId, true);
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId) return;
    const root = deckRootRef.current;
    if (!root) return;

    requestAnimationFrame(() => {
      const escaped = CSS.escape(selectedId);
      root.querySelector(`[data-diff-card-id="${escaped}"]`)?.scrollIntoView({
        block: "nearest",
        behavior: "smooth",
      });
    });
  }, [selectedId]);

  const confirmDiscard = useCallback(() => {
    if (!pending) return;
    void git
      .discard([pending.path])
      .catch((error: unknown) =>
        toast.error(error instanceof Error ? error.message : String(error)),
      );
    setPending(null);
  }, [git, pending]);

  const confirmDiscardAll = useCallback(() => {
    const allPaths = files.map((f) => f.path);
    void git
      .discard(allPaths)
      .catch((error: unknown) =>
        toast.error(error instanceof Error ? error.message : String(error)),
      );
    setDiscardAllPending(false);
  }, [git, files]);

  const { onAgentAction } = props;
  const handleCommitAndPush = useCallback(() => {
    if (props.pendingAgentAction) return;
    onAgentAction(GIT_AGENT_PRIMARY_ACTION);
  }, [onAgentAction, props.pendingAgentAction]);

  const handleSelectFile = useCallback((file: DiffRow) => {
    setSelectedId(file.id);
  }, []);
  const closeReview = useCallback(() => {
    void navigate({
      to: ".",
      replace: true,
      search: (previous) => stripDiffSearchParams(previous),
    });
  }, [navigate]);

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
          onToggleRail={() => shellPanelsActions.toggleSecondaryRail(git.cwd, "git")}
          filter={changesFilter}
          onFilterChange={setChangesFilter}
          count={visibleFiles.length}
          add={visibleTotals.add}
          del={visibleTotals.del}
          onExpandAll={git.expandAll}
          onCollapseAll={git.collapseAll}
          allCollapsed={allDiffCardsCollapsed}
          onDiscardAll={() => setDiscardAllPending(true)}
          onRefresh={() => void git.refresh()}
        />
        {props.reviewingTurnDiff ? <ReviewModeHeader onClose={closeReview} /> : null}
        <RightWorkbenchLayout
          cwd={git.cwd}
          tab="git"
          railHostClassName="bg-(--multi-shell-sidebar-bg) shadow-[inset_-1px_0_0_color-mix(in_srgb,var(--multi-stroke-quaternary)_78%,transparent)]"
          rail={
            <GitChangesFileTree
              rows={visibleFiles}
              selectedId={selectedId}
              onSelect={handleSelectFile}
              className="no-drag min-h-0 min-h-36 flex-1 border-b-0 bg-transparent"
            />
          }
        >
          <div
            ref={deckRootRef}
            className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-(--glass-editor-surface-background)"
          >
            {props.reviewingTurnDiff ? (
              <GitReviewDiffSurface layoutKey={diffLayoutKey} />
            ) : visibleFiles.length === 0 ? (
              <div className="flex flex-1 items-center justify-center text-detail text-muted-foreground/60">
                {changesFilter === "staged"
                  ? "No staged changes."
                  : changesFilter === "unstaged"
                    ? "No unstaged changes."
                    : "No files to compare."}
              </div>
            ) : (
              <Virtualizer
                className="bg-multi-git-diff-editor-background h-full min-h-0 overflow-x-hidden overflow-y-auto overscroll-contain px-0 pb-0 pt-1 scrollbar-gutter-stable"
                config={{
                  overscrollSize: 640,
                  intersectionObserverMargin: 900,
                }}
              >
                {visibleFiles.map((file) => (
                  <GitDiffCard
                    key={file.id}
                    file={file}
                    selected={selectedId === file.id}
                    expanded={git.expandedIds.has(file.id)}
                    onExpandedChange={(open) => git.toggleExpand(file.id, open)}
                    patch={git.patchesByPath.get(file.path) ?? null}
                    loaded={git.patchesByPath.has(file.path)}
                    loading={git.diffLoadingByPath.has(file.path)}
                    error={git.diffErrorByPath.get(file.path) ?? null}
                    diffStyle={diffStyle}
                    viewed={viewed.isViewed(file.path)}
                    onToggleViewed={() => viewed.toggleViewed(file.path)}
                    onRevert={() => setPending(file)}
                    requestPrefetchForIdRef={prefetchRef}
                    diffLayoutKey={diffLayoutKey}
                  />
                ))}
              </Virtualizer>
            )}
          </div>
        </RightWorkbenchLayout>
      </div>
      <DiscardDialog
        open={pending !== null}
        path={pending?.path ?? ""}
        onConfirm={confirmDiscard}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
      />
      <DiscardAllDialog
        open={discardAllPending}
        count={files.length}
        onConfirm={confirmDiscardAll}
        onOpenChange={setDiscardAllPending}
      />
    </>
  );
}

function GitReviewOnlyPanel() {
  const navigate = useNavigate();
  const closeReview = useCallback(() => {
    void navigate({
      to: ".",
      replace: true,
      search: (previous) => stripDiffSearchParams(previous),
    });
  }, [navigate]);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <ReviewModeHeader onClose={closeReview} />
      <GitReviewDiffSurface />
    </div>
  );
}

function ReviewModeHeader(props: { onClose: () => void }) {
  return (
    <WorkbenchChromeRow
      variant="panel"
      gap="loose"
      trailing={
        <WorkbenchTextButton onClick={props.onClose} className="max-w-24" title="Close Review">
          Close
        </WorkbenchTextButton>
      }
    >
      <span className="no-drag shrink-0 text-detail font-medium text-multi-fg-secondary">
        Review
      </span>
      <span className="min-w-0 truncate text-detail text-multi-fg-primary">
        Turn checkpoint diff
      </span>
    </WorkbenchChromeRow>
  );
}

function GitReviewDiffSurface(props: { layoutKey?: string }) {
  return (
    <DiffWorkerPoolProvider>
      <ReviewDiffPanel key={props.layoutKey} mode="sheet" />
    </DiffWorkerPoolProvider>
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
  const pendingActionDetails = props.pendingAgentAction
    ? GIT_AGENT_ACTIONS[props.pendingAgentAction]
    : null;
  const isAgentActionPending = props.pendingAgentAction !== null;

  return (
    <WorkbenchChromeRow
      variant="panel"
      gap="loose"
      trailing={
        <div className="no-drag flex shrink-0 items-center gap-(--multi-workbench-sub-chrome-action-gap)">
          <div className="no-drag relative shrink-0">
            <WorkbenchIconButton
              onClick={() => props.onEditorMenuOpen(!props.editorMenuOpen)}
              aria-label="Editor Options"
              title="Editor Options"
              chrome="panel"
            >
              <IconDotGrid1x3Horizontal className="size-3.5" />
            </WorkbenchIconButton>
            {props.editorMenuOpen && (
              <>
                <button
                  type="button"
                  className="fixed inset-0 z-40 cursor-default border-0 bg-transparent p-0"
                  aria-label="Close editor options"
                  onClick={() => props.onEditorMenuOpen(false)}
                />
                <div
                  className="absolute top-full right-0 z-50 mt-1 min-w-44 rounded-multi-control border border-multi-stroke-secondary bg-multi-bg-elevated p-[3px] text-multi-fg-primary shadow-multi-popup"
                  role="menu"
                >
                  <MenuItem
                    label="Unified Diff"
                    active={props.diffStyle === "unified"}
                    icon={<IconBarsThree className="size-3" />}
                    onClick={() => {
                      props.onDiffStyle("unified");
                      props.onEditorMenuOpen(false);
                    }}
                  />
                  <MenuItem
                    label="Split Diff"
                    active={props.diffStyle === "split"}
                    icon={<IconSplit className="size-3" />}
                    onClick={() => {
                      props.onDiffStyle("split");
                      props.onEditorMenuOpen(false);
                    }}
                  />
                </div>
              </>
            )}
          </div>
          <div className="no-drag relative min-w-0 shrink-0">
            <div
              className="group no-drag inline-flex h-(--multi-workbench-action-size) min-w-0 overflow-hidden rounded-multi-control border border-primary bg-primary text-body font-medium text-primary-foreground shadow-sm data-[pending=true]:border-rose-500/90 data-[pending=true]:bg-rose-500/90"
              data-pending={isAgentActionPending || undefined}
            >
              <button
                type="button"
                className="inline-flex h-full min-w-0 items-center justify-center gap-1.5 px-2 text-inherit transition-colors hover:bg-primary/90 disabled:cursor-default disabled:opacity-70 disabled:hover:bg-transparent group-data-[pending=true]:hover:bg-rose-500/90"
                disabled={
                  isAgentActionPending &&
                  (props.onStopAgentAction === null || props.stoppingAgentAction)
                }
                aria-busy={isAgentActionPending || undefined}
                aria-label={isAgentActionPending ? "Stop Git action" : undefined}
                onClick={() => {
                  if (isAgentActionPending) {
                    props.onStopAgentAction?.();
                    return;
                  }
                  props.onCommitMenuOpen(false);
                  props.onCommitAndPush();
                }}
              >
                {isAgentActionPending ? <IconStop className="size-3" /> : null}
                {props.stoppingAgentAction
                  ? "Stopping..."
                  : (pendingActionDetails?.loadingLabel ?? "Commit & Push")}
              </button>
              <button
                type="button"
                className="inline-flex h-full w-6 shrink-0 items-center justify-center border-l border-primary-foreground/18 text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-default disabled:opacity-70 disabled:hover:bg-transparent data-[open=true]:bg-primary/90"
                disabled={isAgentActionPending}
                onClick={() => {
                  if (isAgentActionPending) return;
                  props.onCommitMenuOpen(!props.commitMenuOpen);
                }}
                aria-label="Open commit menu"
                aria-expanded={props.commitMenuOpen}
                aria-haspopup="menu"
                data-open={props.commitMenuOpen || undefined}
                title="Open commit menu"
              >
                <IconChevronRightMedium className="size-3 rotate-90" />
              </button>
            </div>
            {props.commitMenuOpen && (
              <>
                <button
                  type="button"
                  className="fixed inset-0 z-40 cursor-default border-0 bg-transparent p-0"
                  aria-label="Close commit menu"
                  onClick={() => props.onCommitMenuOpen(false)}
                />
                <div
                  className="absolute top-full right-0 z-50 mt-1 min-w-44 rounded-multi-control border border-multi-stroke-secondary bg-multi-bg-elevated p-[3px] text-multi-fg-primary shadow-multi-popup"
                  role="menu"
                >
                  {GIT_AGENT_ACTION_ORDER.map((action) => (
                    <MenuItem
                      key={action}
                      label={GIT_AGENT_ACTIONS[action].label}
                      onClick={() => {
                        if (props.pendingAgentAction !== null) return;
                        props.onAgentAction(action);
                        props.onCommitMenuOpen(false);
                      }}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      }
    >
      <span className="no-drag shrink-0 text-body font-medium text-multi-fg-secondary">Local</span>
      <button
        type="button"
        onClick={copyBranch}
        className="no-drag inline-flex h-(--multi-workbench-action-size) min-w-0 items-center gap-(--multi-workbench-sub-chrome-action-gap) overflow-hidden rounded-multi-control px-1.5 text-body font-medium text-multi-fg-primary transition-colors hover:bg-multi-bg-quaternary hover:text-multi-fg-primary"
        title="Copy branch name"
      >
        <IconBranch className="size-3 shrink-0 text-multi-icon-tertiary" />
        <span className="truncate font-mono">{props.branch ?? "detached"}</span>
      </button>
    </WorkbenchChromeRow>
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
  const toggleAll = props.allCollapsed ? props.onExpandAll : props.onCollapseAll;
  const toggleAllLabel = props.allCollapsed ? "Expand all" : "Collapse all";

  return (
    <WorkbenchChromeRow
      variant="panel"
      gap="loose"
      trailing={
        <div className="flex shrink-0 items-center gap-(--multi-workbench-sub-chrome-action-gap)">
          <WorkbenchIconButton
            onClick={props.onDiscardAll}
            aria-label="Discard all changes"
            title="Discard all changes"
            chrome="panel"
          >
            <IconChevronLeftMedium className="size-3.5 shrink-0" />
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
      }
    >
      <WorkbenchIconButton
        onClick={props.onToggleRail}
        aria-label={props.railOpen ? "Hide changes list" : "Show changes list"}
        aria-pressed={props.railOpen}
        active={props.railOpen}
        title={props.railOpen ? "Hide changes list" : "Show changes list"}
        chrome="panel"
      >
        <IconBarsThree className="size-3.5 shrink-0" aria-hidden />
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

  return (
    <Menu>
      <MenuTrigger
        type="button"
        className="no-drag inline-flex h-(--multi-workbench-action-size) min-w-0 max-w-64 items-center gap-1 overflow-hidden rounded-multi-control px-1.5 text-body font-medium text-multi-fg-secondary tabular-nums outline-hidden transition-colors hover:bg-multi-bg-quaternary hover:text-multi-fg-primary data-popup-open:bg-multi-bg-quaternary data-popup-open:text-multi-fg-primary focus-visible:ring-1 focus-visible:ring-multi-stroke-focused focus-visible:ring-inset"
        aria-label="Change filter"
      >
        <IconFolder1 className="size-3.5 shrink-0 text-multi-icon-tertiary" aria-hidden />
        <span className="min-w-0 truncate">{label}</span>
        <IconChevronRightMedium
          className="size-3 shrink-0 rotate-90 text-multi-icon-tertiary"
          aria-hidden
        />
      </MenuTrigger>
      <MenuPopup align="start" variant="workbench">
        <MenuRadioGroup
          value={props.filter}
          onValueChange={(value) => {
            const filter = value as GitChangesFilter;
            if (!GIT_CHANGES_FILTERS.includes(filter) || filter === props.filter) return;
            props.onFilterChange(filter);
          }}
        >
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

function MenuItem(props: {
  label: string;
  onClick: () => void;
  active?: boolean | undefined;
  icon?: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      role="menuitem"
      className="group flex w-full min-w-0 items-center gap-1.5 rounded-sm px-1.5 py-1 text-left text-detail text-multi-fg-secondary transition-colors hover:bg-multi-bg-quaternary hover:text-multi-fg-primary data-[active=true]:bg-multi-bg-quaternary data-[active=true]:text-multi-fg-primary"
      data-active={props.active || undefined}
    >
      {props.icon ? (
        <span className="inline-flex w-3.5 shrink-0 justify-center text-multi-icon-tertiary group-data-[active=true]:text-multi-icon-primary">
          {props.icon}
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
          <Button type="button" variant="ghost" onClick={() => props.onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => {
              props.onConfirm();
              props.onOpenChange(false);
            }}
          >
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
          <Button type="button" variant="ghost" onClick={() => props.onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={() => {
              props.onConfirm();
              props.onOpenChange(false);
            }}
          >
            Discard
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
