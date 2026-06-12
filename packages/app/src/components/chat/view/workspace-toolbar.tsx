import type { EnvironmentId, GitBranch, ProjectId, ScopedProjectRef } from "@honk/contracts";
import { dedupeRemoteBranchesWithLocalMatches, isTemporaryWorktreeBranch } from "@honk/shared/git";
import { normalizeSearchQuery } from "@honk/shared/search-ranking";
import { Button } from "@honk/multikit/button";
import { Input } from "@honk/multikit/input";
import { MiddleTruncate } from "@pierre/truncate/react";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuTrigger,
  workbenchMenuLabelClassName,
} from "@honk/multikit/menu";
import {
  WorkbenchChromeActionGroup,
  workbenchChromeTextControlVariants,
} from "@honk/multikit/workbench-chrome-row";
import { useInfiniteQuery } from "@tanstack/react-query";
import {
  IconBranch,
  IconBranchSimple,
  IconCheckmark1Small,
  IconChevronDownSmall,
  IconFolder1,
  IconFolderAddRight,
  IconGit,
} from "central-icons";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import { gitBranchSearchInfiniteQueryOptions } from "../../../lib/git-react-query";
import { resolveMissingStoredBranch } from "./branch-selection";
import { cn } from "../../../lib/utils";
import { parsePullRequestReference } from "~/git/pull-request-reference";
import { scopedProjectKey, scopeProjectRef } from "~/lib/environment-scope";

type BranchEnvMode = "local" | "worktree";

function stopMenuSearchBubbling(event: KeyboardEvent) {
  event.stopPropagation();
}

interface WorkspaceToolbarProps {
  environmentId: EnvironmentId;
  cwd: string | null;
  workspaceName: string;
  workspacePath: string | null;
  projects: ReadonlyArray<WorkspaceToolbarProject>;
  activeProjectRef: ScopedProjectRef | null;
  envMode: BranchEnvMode;
  activeWorktreePath: string | null;
  activeThreadBranch: string | null;
  currentGitBranch: string | null;
  hasLocalChanges: boolean;
  isGitRepo: boolean;
  canChangeEnvMode: boolean;
  disabled: boolean;
  onEnvModeChange: (mode: BranchEnvMode, branch: string | null) => void;
  onProjectSelect: (projectRef: ScopedProjectRef) => Promise<void> | void;
  onOpenFolder: () => void;
  onBranchSelect: (branch: GitBranch) => Promise<void> | void;
  onCheckoutPullRequest: (reference: string) => void;
  onStoredBranchAvailabilityChange?: (missingBranch: string | null) => void;
}

interface BranchMenuSection {
  title: string;
  branches: GitBranch[];
}

export interface WorkspaceToolbarProject {
  id: ProjectId;
  environmentId: EnvironmentId;
  name: string;
  cwd: string;
}

function formatFallbackWorkspaceName(path: string): string {
  const segments = path.split(/[\\/]/).filter(Boolean);
  return segments.at(-1) ?? "Workspace";
}

function branchSelectionKey(branch: GitBranch): string {
  return `${branch.name}:${branch.worktreePath ?? ""}:${branch.remoteName ?? ""}:${
    branch.isRemote ? "remote" : "local"
  }`;
}

function buildBranchMenuSections(branches: ReadonlyArray<GitBranch>): BranchMenuSection[] {
  const seen = new Set<string>();
  const take = (title: string, predicate: (branch: GitBranch) => boolean): BranchMenuSection => {
    const sectionBranches: GitBranch[] = [];
    for (const branch of branches) {
      const key = branchSelectionKey(branch);
      if (seen.has(key) || !predicate(branch)) continue;
      seen.add(key);
      sectionBranches.push(branch);
    }
    return { title, branches: sectionBranches };
  };

  return [
    take("Default", (branch) => branch.isDefault),
    take("Current", (branch) => branch.current),
    take("Worktrees", (branch) => branch.worktreePath !== null),
    take("Created by Honk", (branch) => isTemporaryWorktreeBranch(branch.name)),
    take("Your branches", (branch) => branch.isRemote !== true),
    take("Other branches", () => true),
  ].filter((section) => section.branches.length > 0);
}

function BranchIconWithState(props: { hasLocalChanges: boolean }) {
  return (
    <span className="relative inline-flex size-3.5 shrink-0 items-center justify-center text-honk-icon-tertiary">
      <IconBranchSimple className="size-3.5" aria-hidden />
      {props.hasLocalChanges ? (
        <span
          className="absolute right-0 top-0 size-1 rounded-full bg-[var(--vscode-gitDecoration-modifiedResourceForeground,var(--honk-accent-primary))]"
          aria-hidden
        />
      ) : null}
    </span>
  );
}

export function WorkspaceToolbar(props: WorkspaceToolbarProps) {
  const { onStoredBranchAvailabilityChange } = props;
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [envModeOpen, setEnvModeOpen] = useState(false);
  const [branchOpen, setBranchOpen] = useState(false);
  const [branchQuery, setBranchQuery] = useState("");
  const branchFocusFrameRef = useRef<number | null>(null);
  const hasWorkspace = props.cwd !== null;
  const branchQueryEnabled = props.isGitRepo && hasWorkspace;

  const branchesQuery = useInfiniteQuery(
    gitBranchSearchInfiniteQueryOptions({
      environmentId: props.environmentId,
      cwd: props.cwd,
      query: branchQuery,
      enabled: branchQueryEnabled,
    }),
  );
  const branches = dedupeRemoteBranchesWithLocalMatches(
    (branchesQuery.data?.pages ?? []).flatMap((page) => page.branches),
  );
  const currentBranch =
    props.currentGitBranch ??
    branches.find((branch) => branch.current)?.name ??
    branches.find((branch) => branch.isDefault)?.name ??
    null;
  const selectedBranch =
    props.envMode === "worktree" && props.activeWorktreePath === null
      ? (props.activeThreadBranch ?? currentBranch)
      : (currentBranch ?? props.activeThreadBranch);
  const storedBranchForAvailability =
    props.envMode === "worktree" && props.activeWorktreePath === null
      ? props.activeThreadBranch
      : null;
  const branchesReady = branchesQuery.isSuccess;
  const missingStoredBranch = resolveMissingStoredBranch(
    storedBranchForAvailability,
    branches,
    branchesReady,
  );
  useEffect(() => {
    onStoredBranchAvailabilityChange?.(missingStoredBranch);
  }, [missingStoredBranch, onStoredBranchAvailabilityChange]);
  const workspacePath = props.workspacePath ?? props.cwd;
  const workspaceLabel =
    props.workspaceName.trim() ||
    (workspacePath ? formatFallbackWorkspaceName(workspacePath) : "Open Folder...");
  const envModeLabel = props.envMode === "worktree" ? "New branch/worktree" : "Local(default)";
  const branchButtonLabel = selectedBranch
    ? props.envMode === "worktree" && props.activeWorktreePath === null
      ? missingStoredBranch
        ? `From ${selectedBranch} (unavailable)`
        : `From ${selectedBranch}`
      : selectedBranch
    : "Branch";
  const normalizedBranchQuery = branchQuery.trim();
  const parsedPullRequestReference = parsePullRequestReference(normalizedBranchQuery);
  const normalizedBranchSearch = normalizeSearchQuery(normalizedBranchQuery);
  const filteredBranches = branches.filter((branch) => {
    return (
      normalizedBranchSearch.length === 0 ||
      normalizeSearchQuery(branch.name).includes(normalizedBranchSearch)
    );
  });
  const branchMenuSections = buildBranchMenuSections(filteredBranches);
  const showPullRequestItem = parsedPullRequestReference !== null;
  const selectedBranchHasLocalChanges = Boolean(
    props.hasLocalChanges && selectedBranch !== null && selectedBranch === currentBranch,
  );
  const workspaceMenuLabel =
    props.cwd === null || props.projects.length === 0 ? "Open Folder..." : "Workspaces";
  const openFolderDescription =
    props.projects.length === 0 ? "Choose a folder" : "Add another workspace";

  const focusBranchInput = (node: HTMLInputElement | null) => {
    if (branchFocusFrameRef.current !== null) {
      window.cancelAnimationFrame(branchFocusFrameRef.current);
      branchFocusFrameRef.current = null;
    }
    if (!node || !branchOpen) {
      return;
    }
    branchFocusFrameRef.current = window.requestAnimationFrame(() => {
      branchFocusFrameRef.current = null;
      if (!node.isConnected) {
        return;
      }
      node.focus();
      node.select();
    });
  };

  const selectEnvMode = (mode: BranchEnvMode) => {
    props.onEnvModeChange(mode, mode === "worktree" ? selectedBranch : null);
    setEnvModeOpen(false);
  };

  const selectBranch = (branch: GitBranch) => {
    setBranchOpen(false);
    void props.onBranchSelect(branch);
  };

  const handleBranchOpenChange = (open: boolean) => {
    setBranchOpen(open);
    if (open) {
      setBranchQuery("");
    }
  };

  const selectProject = (project: WorkspaceToolbarProject) => {
    setWorkspaceOpen(false);
    const projectRef = scopeProjectRef(project.environmentId, project.id);
    void props.onProjectSelect(projectRef);
  };

  const openFolder = () => {
    setWorkspaceOpen(false);
    props.onOpenFolder();
  };

  return (
    <WorkbenchChromeActionGroup overflow className="min-w-0 shrink justify-start text-body">
      <Menu open={workspaceOpen} onOpenChange={setWorkspaceOpen}>
        <MenuTrigger
          render={
            <Button
              size="sm"
              variant="ghost"
              className={cn(
                workbenchChromeTextControlVariants(),
                "max-w-[11rem] shrink [&_svg]:size-3.5",
              )}
              title={workspacePath ? `${workspaceLabel}\n${workspacePath}` : "Open Folder..."}
              aria-label={`Workspace: ${workspaceLabel}`}
            />
          }
        >
          <IconFolder1 className="size-3.5 shrink-0 text-honk-icon-tertiary" aria-hidden />
          <MiddleTruncate className="min-w-0" split="leaf-path">
            {workspaceLabel}
          </MiddleTruncate>
          <IconChevronDownSmall
            className={cn(
              "size-3.5 shrink-0 text-honk-icon-tertiary transition-transform duration-150",
              workspaceOpen ? "rotate-180" : "",
            )}
            aria-hidden
          />
        </MenuTrigger>
        <MenuPopup
          align="start"
          side="bottom"
          variant="workbench"
          className="w-72 overflow-hidden p-0 [&>div]:flex [&>div]:max-h-[min(24rem,var(--available-height))] [&>div]:min-h-0 [&>div]:flex-col [&>div]:overflow-hidden [&>div]:p-0"
        >
          <div className="min-h-0 flex-1 overflow-y-auto p-1">
            <div className={workbenchMenuLabelClassName}>{workspaceMenuLabel}</div>
            {props.projects.map((project) => {
              const projectRef = scopeProjectRef(project.environmentId, project.id);
              const isActive =
                props.activeProjectRef !== null &&
                scopedProjectKey(projectRef) === scopedProjectKey(props.activeProjectRef);
              const projectLabel = project.name.trim() || formatFallbackWorkspaceName(project.cwd);
              return (
                <MenuItem
                  key={scopedProjectKey(projectRef)}
                  variant="workbench"
                  className={cn(
                    "h-auto py-1.5",
                    isActive && "bg-honk-bg-tertiary text-honk-fg-primary",
                  )}
                  onClick={() => selectProject(project)}
                >
                  <IconFolder1 className="size-3.5 shrink-0 text-honk-icon-tertiary" aria-hidden />
                  <span className="grid min-w-0 flex-1 text-left">
                    <MiddleTruncate className="min-w-0" split="leaf-path">
                      {projectLabel}
                    </MiddleTruncate>
                    <MiddleTruncate
                      className="min-w-0 text-detail text-honk-fg-tertiary"
                      split="leaf-path"
                    >
                      {project.cwd}
                    </MiddleTruncate>
                  </span>
                  {isActive ? (
                    <IconCheckmark1Small
                      className="size-3.5 shrink-0 text-honk-fg-primary"
                      aria-hidden
                    />
                  ) : null}
                </MenuItem>
              );
            })}
            <div className="border-honk-stroke-tertiary mt-1 border-t pt-1">
              <MenuItem variant="workbench" className="h-auto py-1.5" onClick={openFolder}>
                <IconFolderAddRight
                  className="size-3.5 shrink-0 text-honk-icon-tertiary"
                  aria-hidden
                />
                <span className="grid min-w-0 flex-1 text-left">
                  <span className="truncate">Open Folder...</span>
                  <span className="truncate text-detail text-honk-fg-tertiary">
                    {openFolderDescription}
                  </span>
                </span>
              </MenuItem>
            </div>
          </div>
        </MenuPopup>
      </Menu>

      {props.isGitRepo && hasWorkspace ? (
        <>
          <Menu open={envModeOpen} onOpenChange={setEnvModeOpen}>
            <MenuTrigger
              render={
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={props.disabled || !props.canChangeEnvMode}
                  className={cn(
                    workbenchChromeTextControlVariants(),
                    "max-w-[12rem] shrink disabled:opacity-50 [&_svg]:size-3.5 [&_svg]:text-honk-icon-tertiary",
                  )}
                  aria-label={`Environment mode: ${envModeLabel}`}
                  title="Choose where the agent runs"
                />
              }
            >
              {props.envMode === "worktree" ? (
                <IconBranch className="size-3.5 shrink-0" aria-hidden />
              ) : (
                <IconGit className="size-3.5 shrink-0" aria-hidden />
              )}
              <span className="min-w-0 truncate">{envModeLabel}</span>
              {props.canChangeEnvMode ? (
                <IconChevronDownSmall
                  className={cn(
                    "size-3.5 shrink-0 transition-transform duration-150",
                    envModeOpen ? "rotate-180" : "",
                  )}
                  aria-hidden
                />
              ) : null}
            </MenuTrigger>
            <MenuPopup align="start" side="bottom" variant="workbench" className="w-64">
              <MenuItem
                variant="workbench"
                className="h-auto py-1.5"
                onClick={() => selectEnvMode("local")}
              >
                <IconGit className="size-3.5 shrink-0 text-honk-icon-tertiary" aria-hidden />
                <span className="grid min-w-0 flex-1 text-left">
                  <span className="truncate">Local</span>
                  <span className="truncate text-detail text-honk-fg-tertiary">
                    Use the current checkout
                  </span>
                </span>
                {props.envMode === "local" ? (
                  <IconCheckmark1Small
                    className="size-3.5 shrink-0 text-honk-fg-primary"
                    aria-hidden
                  />
                ) : null}
              </MenuItem>
              <MenuItem
                variant="workbench"
                className="h-auto py-1.5"
                onClick={() => selectEnvMode("worktree")}
              >
                <IconBranch className="size-3.5 shrink-0 text-honk-icon-tertiary" aria-hidden />
                <span className="grid min-w-0 flex-1 text-left">
                  <span className="truncate">New branch/worktree</span>
                  <span className="truncate text-detail text-honk-fg-tertiary">
                    Create an isolated branch on send
                  </span>
                </span>
                {props.envMode === "worktree" ? (
                  <IconCheckmark1Small
                    className="size-3.5 shrink-0 text-honk-fg-primary"
                    aria-hidden
                  />
                ) : null}
              </MenuItem>
            </MenuPopup>
          </Menu>

          <Menu open={branchOpen} onOpenChange={handleBranchOpenChange}>
            <MenuTrigger
              render={
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={props.disabled || branchesQuery.isError}
                  className={cn(
                    workbenchChromeTextControlVariants(),
                    "max-w-[11rem] shrink disabled:opacity-50",
                    missingStoredBranch ? "text-honk-fg-red-primary" : "text-honk-fg-secondary",
                  )}
                  aria-label={`Branch selector: ${branchButtonLabel}`}
                  title={
                    missingStoredBranch
                      ? `Base branch "${missingStoredBranch}" is no longer available. Choose another branch.`
                      : "Switch base branch"
                  }
                />
              }
            >
              <BranchIconWithState hasLocalChanges={selectedBranchHasLocalChanges} />
              <span className="min-w-0 truncate">{branchButtonLabel}</span>
              <IconChevronDownSmall
                className={cn(
                  "size-3.5 shrink-0 text-honk-icon-tertiary transition-transform duration-150",
                  branchOpen ? "rotate-180" : "",
                )}
                aria-hidden
              />
            </MenuTrigger>
            <MenuPopup
              align="start"
              side="bottom"
              variant="workbench"
              className="w-72 overflow-hidden p-0 [&>div]:flex [&>div]:max-h-[min(24rem,var(--available-height))] [&>div]:min-h-0 [&>div]:flex-col [&>div]:overflow-hidden [&>div]:p-0"
            >
              <div className="border-honk-stroke-tertiary shrink-0 border-b p-1.5">
                <Input
                  ref={focusBranchInput}
                  placeholder="Search branches..."
                  size="sm"
                  value={branchQuery}
                  onChange={(event) => setBranchQuery(event.target.value)}
                  onKeyDown={(event) => {
                    stopMenuSearchBubbling(event);
                    if (event.key === "Escape") {
                      event.preventDefault();
                      setBranchOpen(false);
                    }
                  }}
                />
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-1">
                {missingStoredBranch ? (
                  <div className="border-honk-stroke-tertiary mb-1 border-b px-2 py-2">
                    <p className="font-honk text-body text-honk-fg-red-primary">
                      Base branch &ldquo;{missingStoredBranch}&rdquo; is no longer available.
                    </p>
                    <p className="mt-1 font-honk text-detail text-honk-fg-tertiary">
                      It may have been deleted on the remote. Choose another branch below.
                    </p>
                  </div>
                ) : null}
                {showPullRequestItem && parsedPullRequestReference ? (
                  <MenuItem
                    variant="workbench"
                    onClick={() => {
                      setBranchOpen(false);
                      props.onCheckoutPullRequest(parsedPullRequestReference);
                    }}
                  >
                    <span>Checkout Pull Request</span>
                  </MenuItem>
                ) : null}
                {branchMenuSections.map((section) => (
                  <div key={section.title}>
                    <div className={workbenchMenuLabelClassName}>{section.title}</div>
                    {section.branches.map((branch) => {
                      const branchHasLocalChanges = props.hasLocalChanges && branch.current;
                      return (
                        <MenuItem
                          key={branchSelectionKey(branch)}
                          variant="workbench"
                          className={cn(
                            branch.name === selectedBranch &&
                              "bg-honk-bg-tertiary text-honk-fg-primary",
                          )}
                          onClick={() => selectBranch(branch)}
                        >
                          <BranchIconWithState hasLocalChanges={branchHasLocalChanges} />
                          <span className="min-w-0 flex-1 truncate text-left">{branch.name}</span>
                          {branchHasLocalChanges ? (
                            <span className="shrink-0 text-detail text-honk-fg-tertiary">
                              with changes
                            </span>
                          ) : null}
                          {branch.name === selectedBranch ? (
                            <IconCheckmark1Small
                              className="size-3.5 shrink-0 text-honk-fg-primary"
                              aria-hidden
                            />
                          ) : null}
                        </MenuItem>
                      );
                    })}
                  </div>
                ))}
                {branchesQuery.isFetching && branchMenuSections.length === 0 ? (
                  <div className="px-2 py-4 text-center font-honk text-body text-honk-fg-tertiary">
                    Loading branches...
                  </div>
                ) : null}
                {branchMenuSections.length === 0 &&
                !showPullRequestItem &&
                !branchesQuery.isFetching ? (
                  <div className="px-2 py-4 text-center font-honk text-body text-honk-fg-tertiary">
                    No branches found
                  </div>
                ) : null}
              </div>
            </MenuPopup>
          </Menu>
        </>
      ) : null}
    </WorkbenchChromeActionGroup>
  );
}
