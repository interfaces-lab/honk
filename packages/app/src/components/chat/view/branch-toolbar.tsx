import type { EnvironmentId, GitBranch } from "@multi/contracts";
import { dedupeRemoteBranchesWithLocalMatches } from "@multi/shared/git";
import { Input } from "@multi/ui/input";
import { Popover, PopoverPopup, PopoverTrigger } from "@multi/ui/popover";
import { useInfiniteQuery } from "@tanstack/react-query";
import { IconBranchSimple, IconChevronRightMedium } from "central-icons";
import { useCallback, useMemo, useRef, useState } from "react";

import { gitBranchSearchInfiniteQueryOptions } from "../../../lib/git-react-query";
import { cn } from "../../../lib/utils";
import { parsePullRequestReference } from "~/git/pull-request-reference";

type BranchEnvMode = "local" | "worktree";

interface BranchToolbarProps {
  environmentId: EnvironmentId;
  cwd: string | null;
  envMode: BranchEnvMode;
  activeWorktreePath: string | null;
  activeThreadBranch: string | null;
  currentGitBranch: string | null;
  isGitRepo: boolean;
  canChangeEnvMode: boolean;
  disabled: boolean;
  onEnvModeChange: (mode: BranchEnvMode, branch: string | null) => void;
  onBranchSelect: (branch: GitBranch) => Promise<void> | void;
  onCheckoutPullRequest: (reference: string) => void;
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
  const showPullRequestItem = parsedPullRequestReference !== null;

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
    <div className="mb-2 flex w-full items-center justify-start gap-1 px-1">
      <Popover open={envModeOpen} onOpenChange={setEnvModeOpen}>
        <PopoverTrigger
          render={
            <button
              type="button"
              disabled={props.disabled || !props.canChangeEnvMode}
              className={toolbarButtonClass}
            />
          }
        >
          <span>{props.envMode === "worktree" ? "New worktree" : "Current checkout"}</span>
          {props.canChangeEnvMode ? (
            <IconChevronRightMedium className="size-3 rotate-90 opacity-70" aria-hidden />
          ) : null}
        </PopoverTrigger>
        <PopoverPopup align="start" side="top" sideOffset={6} instant className="w-44 p-1">
          <button
            type="button"
            className={envModeMenuItemClass(props.envMode === "local")}
            onClick={() => selectEnvMode("local")}
          >
            Current checkout
          </button>
          <button
            type="button"
            className={envModeMenuItemClass(props.envMode === "worktree")}
            onClick={() => selectEnvMode("worktree")}
          >
            New worktree
          </button>
        </PopoverPopup>
      </Popover>

      <Popover
        open={branchOpen}
        onOpenChange={(open) => {
          setBranchOpen(open);
          if (open) {
            setBranchQuery("");
          }
        }}
      >
        <PopoverTrigger
          render={
            <button
              type="button"
              disabled={props.disabled || branchesQuery.isError}
              className={cn(toolbarButtonClass, "max-w-64")}
            />
          }
        >
          <IconBranchSimple className="size-3.5 shrink-0 text-multi-icon-tertiary" aria-hidden />
          <span className="min-w-0 truncate">{branchButtonLabel}</span>
          <IconChevronRightMedium className="size-3 rotate-90 opacity-70" aria-hidden />
        </PopoverTrigger>
        <PopoverPopup
          align="start"
          side="top"
          sideOffset={6}
          instant
          className="w-72 overflow-hidden p-0"
        >
          <div data-slot="combobox-popup" className="flex max-h-96 min-h-0 flex-col">
            <div className="border-multi-stroke-tertiary border-b p-1.5">
              <Input
                ref={focusBranchInput}
                placeholder="Search branches..."
                size="sm"
                value={branchQuery}
                onChange={(event) => setBranchQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    setBranchOpen(false);
                  }
                }}
              />
            </div>
            <div className="min-h-0 overflow-y-auto p-1">
              {showPullRequestItem && parsedPullRequestReference ? (
                <button
                  type="button"
                  className={branchItemClass(false)}
                  onClick={() => {
                    setBranchOpen(false);
                    props.onCheckoutPullRequest(parsedPullRequestReference);
                  }}
                >
                  <span>Checkout Pull Request</span>
                </button>
              ) : null}
              {filteredBranches.map((branch) => (
                <button
                  type="button"
                  key={`${branch.name}:${branch.worktreePath ?? ""}`}
                  className={branchItemClass(branch.name === selectedBranch)}
                  onClick={() => selectBranch(branch)}
                >
                  <span className="min-w-0 truncate">{branch.name}</span>
                </button>
              ))}
              {filteredBranches.length === 0 && !showPullRequestItem ? (
                <div className="px-2 py-4 text-center text-detail text-multi-fg-tertiary">
                  No branches found
                </div>
              ) : null}
            </div>
          </div>
        </PopoverPopup>
      </Popover>
    </div>
  );
}

const toolbarButtonClass =
  "inline-flex h-7 min-w-0 shrink-0 cursor-(--multi-button-cursor) select-none items-center gap-1.5 rounded-full border border-transparent bg-multi-bg-quaternary px-2.5 text-detail font-normal leading-none text-multi-fg-secondary shadow-none outline-none transition-[background-color,color,opacity,transform] duration-100 ease-out hover:bg-multi-bg-tertiary hover:text-multi-fg-primary focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-0 active:scale-[0.96] disabled:cursor-default disabled:opacity-50 disabled:hover:bg-multi-bg-quaternary disabled:hover:text-multi-fg-secondary motion-reduce:transition-none motion-reduce:active:scale-100";

function envModeMenuItemClass(selected: boolean): string {
  return cn(
    "flex h-7 w-full select-none items-center rounded-multi-control px-2 text-left text-body outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-0",
    selected
      ? "bg-multi-bg-tertiary text-multi-fg-primary"
      : "text-multi-fg-secondary hover:bg-multi-bg-quaternary hover:text-multi-fg-primary",
  );
}

function branchItemClass(selected: boolean): string {
  return cn(
    "flex h-7 w-full select-none items-center rounded-multi-control px-2 text-left text-body outline-none focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-0",
    selected
      ? "bg-multi-bg-tertiary text-multi-fg-primary"
      : "text-multi-fg-secondary hover:bg-multi-bg-quaternary hover:text-multi-fg-primary",
  );
}
