// @ts-nocheck
import type { ModelSelection } from "@multi/contracts";
import type { HarnessModelRef, ThinkingLevel } from "~/lib/ui-session-types";
import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";

import { useServerProviders } from "../rpc/server-state";
import { selectProjectsAcrossEnvironments, useStore } from "../store";
import {
  listRuntimeModelsFromProviders,
  readRuntimeDefaults,
  selectionToThinking,
  type RuntimeModelItem,
} from "../lib/runtime-models";

export type ThreadBootStatus = "loading" | "ready" | "error";

interface RuntimeModelState {
  items: RuntimeModelItem[];
  fastMode: boolean;
  fastSupported: boolean;
  loading: boolean;
  status: ThreadBootStatus;
  thinkingLevel: ThinkingLevel;
}

interface RuntimeDefaultState extends RuntimeModelState {
  selection: ModelSelection;
  model: RuntimeModelItem | HarnessModelRef | null;
  stored: boolean;
}

export function useRuntimeModels(cur?: HarnessModelRef | null) {
  const providers = useServerProviders();
  const projects = useStore(useShallow(selectProjectsAcrossEnvironments));

  return useMemo(() => {
    const status: ThreadBootStatus =
      projects.length > 0 || providers.length > 0 ? "ready" : "loading";
    const defs = readRuntimeDefaults(projects, providers, undefined, cur);
    return {
      items: listRuntimeModelsFromProviders(providers, cur),
      fastMode: defs.fastMode,
      fastSupported: defs.fastSupported,
      loading: status === "loading",
      status,
      thinkingLevel: selectionToThinking(defs.selection),
    } satisfies RuntimeModelState;
  }, [cur, projects, providers]);
}

export function useRuntimeDefaults() {
  const providers = useServerProviders();
  const projects = useStore(useShallow(selectProjectsAcrossEnvironments));

  return useMemo(() => {
    const status: ThreadBootStatus =
      projects.length > 0 || providers.length > 0 ? "ready" : "loading";
    const defs = readRuntimeDefaults(projects, providers);
    return {
      items: defs.items,
      fastMode: defs.fastMode,
      fastSupported: defs.fastSupported,
      selection: defs.selection,
      model: defs.modelRef,
      thinkingLevel: defs.thinkingLevel,
      stored: defs.stored,
      loading: status === "loading",
      status,
    } satisfies RuntimeDefaultState;
  }, [projects, providers]);
}
