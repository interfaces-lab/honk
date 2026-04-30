// @ts-nocheck
import { CommandId, type ServerProvider } from "@multi/contracts";
import type { HarnessDescriptor, HarnessKind } from "~/lib/ui-session-types";
import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";

import { readNativeEnvironmentApi, readNativeApi } from "./native-runtime-api";
import { getServerConfig, useServerProviders } from "../rpc/server-state";
import { getDefaultServerModel } from "../provider-models";
import { selectProjectsAcrossEnvironments, useStore } from "../store";
import { readStoredWorkspaceCwd } from "./workspace-state";

export interface HarnessState {
  descriptors: HarnessDescriptor[];
  defaultKind: HarnessKind;
  loading: boolean;
  error: string | null;
}

function storedCwd() {
  return readStoredWorkspaceCwd();
}

function toKind(provider: "codex" | "claudeAgent"): HarnessKind {
  return provider === "claudeAgent" ? "claudeCode" : "codex";
}

function toProvider(kind: HarnessKind) {
  return kind === "claudeCode" ? "claudeAgent" : "codex";
}

function toDescriptor(provider: ServerProvider): HarnessDescriptor {
  const next = {
    kind: toKind(provider.provider),
    label: provider.provider === "claudeAgent" ? "Claude" : "Codex",
    available: provider.installed,
    enabled: provider.enabled,
    capabilities: {
      modelPicker: true,
      thinkingLevels: true,
      commands: true,
      interactive: true,
      fileAttachments: true,
    },
  } satisfies HarnessDescriptor;

  if (provider.version) {
    return { ...next, version: provider.version };
  }
  if (provider.message) {
    return { ...next, reason: provider.message };
  }
  return next;
}

export function useHarnessList(): HarnessState {
  const providers = useServerProviders();
  const projects = useStore(useShallow(selectProjectsAcrossEnvironments));

  return useMemo(() => {
    const descriptors = providers.map(toDescriptor);
    const project =
      projects.find((item) => item.cwd === storedCwd()) ??
      projects.find((item) => item.defaultModelSelection !== null) ??
      projects[0] ??
      null;
    const defaultKind = project?.defaultModelSelection?.provider
      ? toKind(project.defaultModelSelection.provider)
      : (descriptors.find((item) => item.enabled)?.kind ?? "codex");

    return {
      descriptors,
      defaultKind,
      loading: providers.length === 0,
      error: null,
    } satisfies HarnessState;
  }, [projects, providers]);
}

export function useHarnessDescriptor(kind: HarnessKind): HarnessDescriptor | null {
  const { descriptors } = useHarnessList();
  return useMemo(() => descriptors.find((item) => item.kind === kind) ?? null, [descriptors, kind]);
}

export async function setHarnessEnabled(kind: HarnessKind, enabled: boolean): Promise<void> {
  const api = readNativeApi();
  if (!api) return;
  const provider = toProvider(kind);
  await api.server.updateSettings({
    providers: {
      [provider]: { enabled },
    },
  });
}

export async function setDefaultHarness(kind: HarnessKind): Promise<void> {
  const localApi = readNativeApi();
  const projects = selectProjectsAcrossEnvironments(useStore.getState());
  const project = projects.find((item) => item.cwd === storedCwd()) ?? projects[0] ?? null;
  if (!localApi || !project) return;
  const providers = getServerConfig()?.providers ?? (await localApi.server.getConfig()).providers;
  const orchestration = readNativeEnvironmentApi(project.environmentId)?.orchestration;
  if (!orchestration) return;
  const provider = toProvider(kind);
  await orchestration.dispatchCommand({
    type: "project.meta.update",
    commandId: CommandId.makeUnsafe(crypto.randomUUID()),
    projectId: project.id,
    defaultModelSelection: {
      provider,
      model: getDefaultServerModel(providers, provider),
    },
  });
}
