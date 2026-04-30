import type { EnvironmentId, GitListBranchesResult } from "@multi/contracts";
import type { WsRpcClient } from "~/rpc/ws-rpc-client";
import { getWsRpcClientForEnvironment } from "~/ws-rpc-client";

import { readNativeEnvironmentApi, readNativeRuntimeApi } from "./native-runtime-api";

const BRANCH_PAGE_SIZE = 100;

interface NativeGitApiCandidate {
  refreshStatus?: WsRpcClient["git"]["refreshStatus"];
  onStatus?: WsRpcClient["git"]["onStatus"];
  init?: WsRpcClient["git"]["init"];
  discardPaths?: (input: { cwd: string; paths: string[] }) => Promise<void>;
  getFilePatch?: (input: { cwd: string; path: string }) => Promise<{ unifiedDiff: string }>;
  runStackedAction?: WsRpcClient["git"]["runStackedAction"];
  listBranches?: WsRpcClient["git"]["listBranches"];
  checkout?: WsRpcClient["git"]["checkout"];
  pull?: WsRpcClient["git"]["pull"];
  preparePullRequestThread?: WsRpcClient["git"]["preparePullRequestThread"];
}

function readMethod<K extends keyof NativeGitApiCandidate>(
  methodName: K,
  candidates: ReadonlyArray<NativeGitApiCandidate | null | undefined>,
): NonNullable<NativeGitApiCandidate[K]> | null {
  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    const method = candidate[methodName];
    if (typeof method === "function") {
      return method as NonNullable<NativeGitApiCandidate[K]>;
    }
  }

  return null;
}

function readWsGit(environmentId?: EnvironmentId | null): WsRpcClient["git"] | null {
  try {
    return getWsRpcClientForEnvironment(environmentId ?? null).git;
  } catch {
    return null;
  }
}

function assertMethod<T>(method: T | null, label: string): T {
  if (method) {
    return method;
  }

  throw new Error(`${label} is unavailable in this environment.`);
}

export interface NativeGitApi {
  refreshStatus: WsRpcClient["git"]["refreshStatus"];
  onStatus: WsRpcClient["git"]["onStatus"];
  init: WsRpcClient["git"]["init"];
  discardPaths: (input: { cwd: string; paths: string[] }) => Promise<void>;
  getFilePatch: (input: { cwd: string; path: string }) => Promise<{ unifiedDiff: string }>;
  runStackedAction: (input: {
    cwd: string;
    action: "commit" | "commit_push" | "push";
    commitMessage?: string;
    featureBranch?: boolean;
  }) => Promise<void>;
  listBranches: (input: {
    cwd: string;
    query?: string;
    pageParam?: number;
  }) => Promise<GitListBranchesResult>;
  checkout: (input: { cwd: string; branch: string }) => Promise<void>;
  pull: (input: { cwd: string }) => Promise<void>;
  preparePullRequestThread: WsRpcClient["git"]["preparePullRequestThread"];
}

export function readNativeGitApi(environmentId?: EnvironmentId | null): NativeGitApi | null {
  const runtimeGit = readNativeRuntimeApi(environmentId, {
    allowPrimaryEnvironmentFallback: true,
  })?.git as NativeGitApiCandidate | null | undefined;
  const environmentGit = readNativeEnvironmentApi(environmentId, {
    allowPrimaryEnvironmentFallback: true,
  })?.git as NativeGitApiCandidate | null | undefined;
  const wsGit = readWsGit(environmentId);
  const candidates = [runtimeGit, environmentGit, wsGit];

  const refreshStatus = readMethod("refreshStatus", candidates);
  const onStatus = readMethod("onStatus", candidates);
  const init = readMethod("init", candidates);

  if (!refreshStatus || !onStatus || !init) {
    return null;
  }

  return {
    refreshStatus,
    onStatus,
    init,
    discardPaths: async (input) => {
      const discardPaths = assertMethod(
        readMethod("discardPaths", candidates),
        "Git discard paths API",
      );
      await discardPaths(input);
    },
    getFilePatch: async (input) => {
      const getFilePatch = assertMethod(
        readMethod("getFilePatch", candidates),
        "Git file patch API",
      );
      return getFilePatch(input);
    },
    runStackedAction: async (input) => {
      const runStackedAction = assertMethod(
        readMethod("runStackedAction", candidates),
        "Git stacked action API",
      );
      await runStackedAction({
        actionId: crypto.randomUUID(),
        cwd: input.cwd,
        action: input.action,
        ...(input.commitMessage ? { commitMessage: input.commitMessage } : {}),
        ...(input.featureBranch ? { featureBranch: true } : {}),
      });
    },
    listBranches: async (input) => {
      const listBranches = assertMethod(
        readMethod("listBranches", candidates),
        "Git list branches API",
      );
      return listBranches({
        cwd: input.cwd,
        cursor: input.pageParam ?? 0,
        limit: BRANCH_PAGE_SIZE,
        ...(input.query && input.query.trim().length > 0 ? { query: input.query.trim() } : {}),
      });
    },
    checkout: async (input) => {
      const checkout = assertMethod(readMethod("checkout", candidates), "Git checkout API");
      await checkout(input);
    },
    pull: async (input) => {
      const pull = assertMethod(readMethod("pull", candidates), "Git pull API");
      await pull(input);
    },
    preparePullRequestThread: async (input) => {
      const preparePullRequestThread = assertMethod(
        readMethod("preparePullRequestThread", candidates),
        "Git pull request preparation API",
      );
      return preparePullRequestThread(input);
    },
  };
}
