import type { EnvironmentId, GitBranch } from "@multi/contracts";
import { dedupeRemoteBranchesWithLocalMatches, isTemporaryWorktreeBranch } from "@multi/shared/git";
import { Menu as BaseMenu } from "@base-ui/react/menu";
import { Button } from "@multi/ui/button";
import { Input } from "@multi/ui/input";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuTrigger,
  workbenchMenuItemClassName,
  workbenchMenuLabelClassName,
  workbenchMenuPopupClassName,
} from "@multi/ui/menu";
import { useInfiniteQuery } from "@tanstack/react-query";
import {
  IconBranch,
  IconBranchSimple,
  IconCheckmark1Small,
  IconChevronDownSmall,
  IconFolder1,
  IconGit,
} from "central-icons";
import { useCallback, useMemo, useRef, useState, type KeyboardEvent } from "react";

import { gitBranchSearchInfiniteQueryOptions } from "../../../lib/git-react-query";
import { cn } from "../../../lib/utils";
import { parsePullRequestReference } from "~/git/pull-request-reference";

type BranchEnvMode = "local" | "worktree";

function stopMenuSearchBubbling(event: KeyboardEvent) {
  event.stopPropagation();
}

interface BranchToolbarProps {
  environmentId: EnvironmentId;
  cwd: string | null;
  workspaceName: string;
  workspacePath: string;
  envMode: BranchEnvMode;
  activeWorktreePath: string | null;
  activeThreadBranch: string | null;
  currentGitBranch: string | null;
  hasLocalChanges: boolean;
  isGitRepo: boolean;
  canChangeEnvMode: boolean;
  disabled: boolean;
  onEnvModeChange: (mode: BranchEnvMode, branch: string | null) => void;
  onBranchSelect: (branch: GitBranch) => Promise<void> | void;
  onCheckoutPullRequest: (reference: string) => void;
}

interface BranchMenuSection {
  title: string;
  branches: GitBranch[];
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
    take("Created by Multi", (branch) => isTemporaryWorktreeBranch(branch.name)),
    take("Your branches", (branch) => branch.isRemote !== true),
    take("Other branches", () => true),
  ].filter((section) => section.branches.length > 0);
}

function BranchIconWithState(props: { hasLocalChanges: boolean }) {
  return (
    <span className="relative inline-flex size-3.5 shrink-0 items-center justify-center text-multi-icon-tertiary">
      <IconBranchSimple className="size-3.5" aria-hidden />
      {props.hasLocalChanges ? (
        <span
          className="absolute right-0 top-0 size-1 rounded-full bg-[var(--vscode-gitDecoration-modifiedResourceForeground,var(--multi-accent-primary))]"
          aria-hidden
        />
      ) : null}
    </span>
  );
}

export function BranchToolbar(props: BranchToolbarProps) {
  const [envModeOpen, setEnvModeOpen] = useState(false);
  const [branchOpen, setBranchOpen] = useState(false);
  const [branchQuery, setBranchQuery] = useState("");
  const branchFocusFrameRef = useRef<number | null>(null);

  const branchesQuery = useInfiniteQuery(
    gitBranchSearchInfiniteQueryOptions({
      environmentId: props.environmentId,
      cwd: props.cwd,
      query: branchQuery,
      enabled: props.isGitRepo && props.cwd !== null,
    }),
  );
  const branches = useMemo(
    () =>
      dedupeRemoteBranchesWithLocalMatches(
        (branchesQuery.data?.pages ?? []).flatMap((page) => page.branches),
      ),
    [branchesQuery.data],
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
  const workspaceLabel =
    props.workspaceName.trim() || formatFallbackWorkspaceName(props.workspacePath);
  const envModeLabel = props.envMode === "worktree" ? "New branch/worktree" : "Local";
  const branchButtonLabel = selectedBranch
    ? props.envMode === "worktree" && props.activeWorktreePath === null
      ? `From ${selectedBranch}`
      : selectedBranch
    : "Branch";
  const normalizedBranchQuery = branchQuery.trim();
  const parsedPullRequestReference = parsePullRequestReference(normalizedBranchQuery);
  const normalizedBranchSearch = normalizedBranchQuery.toLowerCase();
  const filteredBranches = useMemo(
    () =>
      branches.filter((branch) => {
        return (
          normalizedBranchSearch.length === 0 ||
          branch.name.toLowerCase().includes(normalizedBranchSearch)
        );
      }),
    [branches, normalizedBranchSearch],
  );
  const branchMenuSections = useMemo(
    () => buildBranchMenuSections(filteredBranches),
    [filteredBranches],
  );
  const showPullRequestItem = parsedPullRequestReference !== null;
  const selectedBranchHasLocalChanges = Boolean(
    props.hasLocalChanges && selectedBranch !== null && selectedBranch === currentBranch,
  );

  const focusBranchInput = useCallback(
    (node: HTMLInputElement | null) => {
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
    },
    [branchOpen],
  );

  const selectEnvMode = useCallback(
    (mode: BranchEnvMode) => {
      props.onEnvModeChange(mode, mode === "worktree" ? selectedBranch : null);
      setEnvModeOpen(false);
    },
    [props, selectedBranch],
  );

  const selectBranch = useCallback(
    (branch: GitBranch) => {
      setBranchOpen(false);
      void props.onBranchSelect(branch);
    },
    [props],
  );

  if (!props.isGitRepo || !props.cwd) {
    return null;
  }

  return (
    <div className="mb-2 flex w-full min-w-0 items-center justify-start gap-1 px-1 text-[12px]">
      <div
        className="inline-flex h-6 min-w-0 max-w-[11rem] shrink items-center gap-1.5 rounded-multi-control px-1.5 text-multi-fg-secondary"
        title={`${workspaceLabel}\n${props.workspacePath}`}
        aria-label={`Workspace ${workspaceLabel}`}
      >
        <IconFolder1 className="size-3.5 shrink-0 text-multi-icon-tertiary" aria-hidden />
        <span className="hidden shrink-0 text-multi-fg-tertiary sm:inline">Workspace</span>
        <span className="min-w-0 truncate text-multi-fg-secondary">{workspaceLabel}</span>
      </div>

      <Menu open={envModeOpen} onOpenChange={setEnvModeOpen}>
        <MenuTrigger
          render={
            <Button
              size="sm"
              variant="ghost"
              disabled={props.disabled || !props.canChangeEnvMode}
              className="h-6 min-w-0 max-w-[12rem] shrink-0 rounded-multi-control px-1.5 font-normal text-[12px] text-multi-fg-secondary shadow-none before:hidden hover:bg-multi-bg-quaternary hover:text-multi-fg-primary disabled:opacity-50 data-popup-open:bg-multi-bg-quaternary data-popup-open:text-multi-fg-primary [&_svg]:size-3.5 [&_svg]:text-multi-icon-tertiary"
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
            <IconGit className="size-3.5 shrink-0 text-multi-icon-tertiary" aria-hidden />
            <span className="grid min-w-0 flex-1 text-left">
              <span className="truncate">Local</span>
              <span className="truncate text-[11px] text-multi-fg-tertiary">
                Use the current checkout
              </span>
            </span>
            {props.envMode === "local" ? (
              <IconCheckmark1Small
                className="size-3.5 shrink-0 text-multi-fg-primary"
                aria-hidden
              />
            ) : null}
          </MenuItem>
          <MenuItem
            variant="workbench"
            className="h-auto py-1.5"
            onClick={() => selectEnvMode("worktree")}
          >
            <IconBranch className="size-3.5 shrink-0 text-multi-icon-tertiary" aria-hidden />
            <span className="grid min-w-0 flex-1 text-left">
              <span className="truncate">New branch/worktree</span>
              <span className="truncate text-[11px] text-multi-fg-tertiary">
                Create an isolated branch on send
              </span>
            </span>
            {props.envMode === "worktree" ? (
              <IconCheckmark1Small
                className="size-3.5 shrink-0 text-multi-fg-primary"
                aria-hidden
              />
            ) : null}
          </MenuItem>
        </MenuPopup>
      </Menu>

      <BaseMenu.Root
        open={branchOpen}
        onOpenChange={(open) => {
          setBranchOpen(open);
          if (open) {
            setBranchQuery("");
          }
        }}
      >
        <BaseMenu.Trigger
          render={
            <Button
              size="sm"
              variant="ghost"
              disabled={props.disabled || branchesQuery.isError}
              className="h-6 min-w-0 max-w-[11rem] shrink rounded-multi-control px-1.5 font-normal text-[12px] text-multi-fg-secondary shadow-none before:hidden hover:bg-multi-bg-quaternary hover:text-multi-fg-primary disabled:opacity-50 data-popup-open:bg-multi-bg-quaternary data-popup-open:text-multi-fg-primary"
              aria-label={`Branch selector: ${branchButtonLabel}`}
              title="Switch base branch"
            />
          }
        >
          <BranchIconWithState hasLocalChanges={selectedBranchHasLocalChanges} />
          <span className="min-w-0 max-w-[125px] truncate">{branchButtonLabel}</span>
          <IconChevronDownSmall
            className={cn(
              "size-3.5 shrink-0 text-multi-icon-tertiary transition-transform duration-150",
              branchOpen ? "rotate-180" : "",
            )}
            aria-hidden
          />
        </BaseMenu.Trigger>
        <BaseMenu.Portal>
          <BaseMenu.Positioner align="start" className="z-[70] outline-none" side="bottom" sideOffset={4}>
            <BaseMenu.Popup
              className={cn(workbenchMenuPopupClassName, "w-72 overflow-hidden p-0")}
              data-slot="menu-popup"
            >
              <div className="flex max-h-[min(24rem,var(--available-height))] min-h-0 flex-col">
                <div className="border-multi-stroke-tertiary shrink-0 border-b p-1.5">
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
                <div className="min-h-0 overflow-y-auto p-1">
                  {showPullRequestItem && parsedPullRequestReference ? (
                    <BaseMenu.Item
                      className={workbenchMenuItemClassName}
                      onClick={() => {
                        setBranchOpen(false);
                        props.onCheckoutPullRequest(parsedPullRequestReference);
                      }}
                    >
                      <span>Checkout Pull Request</span>
                    </BaseMenu.Item>
                  ) : null}
                  {branchMenuSections.map((section) => (
                    <div key={section.title}>
                      <div className={workbenchMenuLabelClassName}>{section.title}</div>
                      {section.branches.map((branch) => {
                        const branchHasLocalChanges = props.hasLocalChanges && branch.current;
                        return (
                          <BaseMenu.Item
                            key={branchSelectionKey(branch)}
                            className={cn(
                              workbenchMenuItemClassName,
                              branch.name === selectedBranch &&
                                "bg-multi-bg-tertiary text-multi-fg-primary",
                            )}
                            onClick={() => selectBranch(branch)}
                          >
                            <BranchIconWithState hasLocalChanges={branchHasLocalChanges} />
                            <span className="min-w-0 flex-1 truncate text-left">{branch.name}</span>
                            {branchHasLocalChanges ? (
                              <span className="shrink-0 text-[11px] text-multi-fg-tertiary">
                                with changes
                              </span>
                            ) : null}
                            {branch.name === selectedBranch ? (
                              <IconCheckmark1Small
                                className="size-3.5 shrink-0 text-multi-fg-primary"
                                aria-hidden
                              />
                            ) : null}
                          </BaseMenu.Item>
                        );
                      })}
                    </div>
                  ))}
                  {branchesQuery.isFetching && branchMenuSections.length === 0 ? (
                    <div className="px-2 py-4 text-center font-multi text-[12px] leading-4 text-multi-fg-tertiary">
                      Loading branches...
                    </div>
                  ) : null}
                  {branchMenuSections.length === 0 &&
                  !showPullRequestItem &&
                  !branchesQuery.isFetching ? (
                    <div className="px-2 py-4 text-center font-multi text-[12px] leading-4 text-multi-fg-tertiary">
                      No branches found
                    </div>
                  ) : null}
                </div>
              </div>
            </BaseMenu.Popup>
          </BaseMenu.Positioner>
        </BaseMenu.Portal>
      </BaseMenu.Root>
    </div>
  );
}
