import type { GitBranch } from "@multi/contracts";
import { useCallback, useState, type Dispatch, type SetStateAction } from "react";

import { toastManager } from "~/app/toast";
import { formatGitActionErrorDescription } from "~/git/action-error-description";
import {
  type DraftId as ComposerDraftId,
  type DraftThreadEnvMode,
} from "../../../stores/chat-drafts";
import { type PullRequestDialogState } from "./thread-lifecycle";

interface SetDraftThreadContextOptions {
  branch?: string | null;
  worktreePath?: string | null;
  envMode?: DraftThreadEnvMode;
}

export interface UseThreadBranchWorktreeArgs {
  draftId: ComposerDraftId | null;
  isLocalDraftThread: boolean;
  activeProjectCwd: string | null;
  activeThreadBranch: string | null;
  activeThreadWorktreePath: string | null;
  envMode: DraftThreadEnvMode;
  setDraftThreadContext: (draftId: ComposerDraftId, options: SetDraftThreadContextOptions) => void;
  checkoutBranchMutation: {
    mutateAsync: (branchName: string) => Promise<unknown>;
  };
  setPullRequestDialogState: Dispatch<SetStateAction<PullRequestDialogState | null>>;
}

export interface UseThreadBranchWorktreeReturn {
  unavailableBaseBranch: string | null;
  handleStoredBranchAvailabilityChange: (missingBranch: string | null) => void;
  handleBranchEnvModeChange: (mode: DraftThreadEnvMode, branch: string | null) => void;
  handleBranchSelect: (branch: GitBranch) => Promise<void>;
  openPullRequestBranchDialog: (reference: string) => void;
}

/**
 * Owns the branch toolbar state and handlers. Stays local to drafts; server
 * threads do not show the branch toolbar (callers gate on `isLocalDraftThread`).
 */
export function useThreadBranchWorktree(
  args: UseThreadBranchWorktreeArgs,
): UseThreadBranchWorktreeReturn {
  const {
    draftId,
    isLocalDraftThread,
    activeProjectCwd,
    activeThreadBranch,
    activeThreadWorktreePath,
    envMode,
    setDraftThreadContext,
    checkoutBranchMutation,
    setPullRequestDialogState,
  } = args;

  const [unavailableBaseBranch, setUnavailableBaseBranch] = useState<string | null>(null);

  const handleStoredBranchAvailabilityChange = useCallback((missingBranch: string | null) => {
    setUnavailableBaseBranch((current) => (current === missingBranch ? current : missingBranch));
  }, []);

  function handleBranchEnvModeChange(mode: DraftThreadEnvMode, branch: string | null) {
    const nextBranch = mode === "worktree" ? (branch ?? activeThreadBranch) : activeThreadBranch;
    if (!isLocalDraftThread || !draftId) {
      return;
    }
    setDraftThreadContext(draftId, {
      envMode: mode,
      branch: nextBranch,
      worktreePath: activeThreadWorktreePath,
    });
  }

  async function handleBranchSelect(branch: GitBranch) {
    if (!activeProjectCwd) {
      return;
    }
    const reuseExistingWorktree = Boolean(branch.worktreePath);
    const nextWorktreePath =
      branch.worktreePath && branch.worktreePath !== activeProjectCwd ? branch.worktreePath : null;
    const nextEnvMode: DraftThreadEnvMode = nextWorktreePath
      ? "worktree"
      : envMode === "worktree"
        ? "worktree"
        : "local";

    try {
      if (nextEnvMode === "local" && !reuseExistingWorktree) {
        await checkoutBranchMutation.mutateAsync(branch.name);
      }
    } catch (error) {
      toastManager.add({
        type: "error",
        title: `Could not checkout ${branch.name}`,
        description: formatGitActionErrorDescription(error, "Git checkout failed."),
      });
      return;
    }

    if (isLocalDraftThread && draftId) {
      setDraftThreadContext(draftId, {
        branch: branch.name,
        worktreePath: nextWorktreePath,
        envMode: nextEnvMode,
      });
    }
  }

  function openPullRequestBranchDialog(reference: string) {
    setPullRequestDialogState({
      initialReference: reference,
      key: Date.now(),
    });
  }

  return {
    unavailableBaseBranch,
    handleStoredBranchAvailabilityChange,
    handleBranchEnvModeChange,
    handleBranchSelect,
    openPullRequestBranchDialog,
  };
}
