import {
  CommandId,
  DEFAULT_MODEL_BY_PROVIDER,
  PROVIDER_DISPLAY_NAMES,
  type ModelSelection,
  type ProviderOptionDescriptor,
  type ProviderOptionSelection,
  type ProviderKind,
  type ServerProvider,
} from "@multi/contracts";
import type { HarnessModelRef, ThinkingLevel } from "~/lib/ui-session-types";
import {
  buildProviderOptionSelectionsFromDescriptors,
  getModelSelectionBooleanOptionValue,
  getModelSelectionStringOptionValue,
  getProviderOptionDescriptors,
  resolveSelectableModel,
} from "@multi/shared/model";

import { readNativeEnvironmentApi } from "./native-runtime-api";
import { getServerConfig } from "../rpc/server-state";
import {
  getDefaultServerModel,
  getProviderModelCapabilities,
  getProviderModels,
  resolveSelectableProvider,
} from "../provider-models";
import { selectProjectsForEnvironment, useStore } from "../store";
import type { Project } from "../types";
import { readStoredWorkspaceCwd } from "./workspace-state";

export interface RuntimeModelItem extends HarnessModelRef {
  key: string;
  name: string;
  supportsFastMode: boolean;
  supportsXhigh: boolean;
}

export interface RuntimeDefaultsRead {
  project: Project | null;
  selection: ModelSelection;
  provider: string | null;
  model: string | null;
  fastMode: boolean;
  fastSupported: boolean;
  thinkingLevel: ThinkingLevel;
  stored: boolean;
  items: RuntimeModelItem[];
  modelRef: RuntimeModelItem | HarnessModelRef | null;
}

const commandId = () => CommandId.make(crypto.randomUUID());

export function readStoredCwd() {
  return readStoredWorkspaceCwd();
}

export function resolveActiveProject(projects: readonly Project[], cwd = readStoredCwd()) {
  return projects.find((item) => item.cwd === cwd) ?? projects[0] ?? null;
}

function key(provider: string, id: string) {
  return `${provider}/${id}`;
}

export function displayModelName(raw: string) {
  const text = raw.trim();
  if (!text) return raw;
  const next = text.replace(/^model\s+/i, "").trim();
  return next.length > 0 ? next : text;
}

export function displayProviderName(provider: string) {
  return provider === "codex" || provider === "claudeAgent"
    ? PROVIDER_DISPLAY_NAMES[provider]
    : provider;
}

function supportsXhigh(caps: ServerProvider["models"][number]["capabilities"]) {
  const descriptor = getReasoningDescriptor(caps);
  return Boolean(
    descriptor?.type === "select" &&
    descriptor.options.some(
      (item) => item.id === "xhigh" || item.id === "max" || item.id === "ultrathink",
    ),
  );
}

const REASONING_OPTION_IDS = ["reasoningEffort", "effort", "reasoning"] as const;

function findOptionDescriptor(
  caps: ServerProvider["models"][number]["capabilities"],
  ids: ReadonlyArray<string>,
): ProviderOptionDescriptor | undefined {
  return caps?.optionDescriptors?.find((descriptor) => ids.includes(descriptor.id));
}

function getReasoningDescriptor(
  caps: ServerProvider["models"][number]["capabilities"],
): ProviderOptionDescriptor | undefined {
  return findOptionDescriptor(caps, REASONING_OPTION_IDS);
}

function hasBooleanOption(
  caps: ServerProvider["models"][number]["capabilities"],
  id: string,
): boolean {
  return caps?.optionDescriptors?.some((descriptor) => descriptor.id === id) ?? false;
}

function getReasoningSelection(selection: ModelSelection | null | undefined): string | undefined {
  for (const id of REASONING_OPTION_IDS) {
    const value = getModelSelectionStringOptionValue(selection, id);
    if (value) return value;
  }
  return undefined;
}

function setOptionSelection(
  options: ReadonlyArray<ProviderOptionSelection> | null | undefined,
  id: string,
  value: string | boolean | undefined,
): Array<ProviderOptionSelection> | undefined {
  const next = (options ?? []).filter((option) => option.id !== id);
  if (typeof value === "string" && value.trim().length > 0) {
    next.push({ id, value });
  } else if (typeof value === "boolean") {
    next.push({ id, value });
  }
  return next.length > 0 ? next : undefined;
}

function withOptions(
  selection: ModelSelection,
  options: ReadonlyArray<ProviderOptionSelection> | undefined,
): ModelSelection {
  return {
    provider: selection.provider,
    model: selection.model,
    ...(options && options.length > 0 ? { options } : {}),
  } as ModelSelection;
}

export function toModelItem(
  provider: ProviderKind,
  item: ServerProvider["models"][number],
): RuntimeModelItem {
  return {
    key: key(provider, item.slug),
    provider,
    id: item.slug,
    name: item.name,
    reasoning:
      Boolean(getReasoningDescriptor(item.capabilities)) ||
      hasBooleanOption(item.capabilities, "thinking"),
    supportsFastMode: hasBooleanOption(item.capabilities, "fastMode"),
    supportsXhigh: supportsXhigh(item.capabilities),
  };
}

function fallbackModel(selection: ModelSelection): HarnessModelRef {
  return {
    provider: selection.provider,
    id: selection.model,
    name: selection.model,
    reasoning:
      Boolean(getReasoningSelection(selection)) ||
      getModelSelectionBooleanOptionValue(selection, "thinking") === true,
  };
}

function selectableOptions(
  providers: readonly ServerProvider[],
  provider: ProviderKind,
): ReadonlyArray<{ slug: string; name: string }> {
  return getProviderModels(providers, provider).map((item) => ({
    slug: item.slug,
    name: item.name,
  }));
}

export function resolveRuntimeSelection(
  providers: readonly ServerProvider[],
  selection: ModelSelection | null | undefined,
  requested?: ProviderKind | null,
): ModelSelection {
  const provider = resolveSelectableProvider(
    providers,
    requested ?? selection?.provider ?? "codex",
  );
  const prev = selection?.provider === provider ? selection : null;
  const model =
    resolveSelectableModel(provider, prev?.model ?? null, selectableOptions(providers, provider)) ??
    getDefaultServerModel(providers, provider) ??
    DEFAULT_MODEL_BY_PROVIDER[provider];
  const caps = getProviderModelCapabilities(
    getProviderModels(providers, provider),
    model,
    provider,
  );
  const descriptors = getProviderOptionDescriptors({
    caps,
    selections: prev?.provider === provider ? prev.options : undefined,
  });
  const options = buildProviderOptionSelectionsFromDescriptors(descriptors);

  return {
    provider,
    model,
    ...(options ? { options } : {}),
  };
}

export function filterRuntimeModels(items: readonly RuntimeModelItem[], query: string) {
  const input = query.trim().toLowerCase();
  if (!input) return [...items];

  const tokens = input.split(/\s+/).filter(Boolean);
  return items
    .filter((item) => {
      const text =
        `${item.provider} ${displayProviderName(item.provider)} ${item.id} ${item.name}`.toLowerCase();
      return tokens.every((token) => text.includes(token));
    })
    .toSorted((left, right) =>
      `${displayProviderName(left.provider)} ${left.name}`.localeCompare(
        `${displayProviderName(right.provider)} ${right.name}`,
      ),
    );
}

export function selectionToThinking(selection: ModelSelection | null | undefined): ThinkingLevel {
  if (!selection) return "off";
  if (getModelSelectionBooleanOptionValue(selection, "thinking") === false) return "off";
  switch (getReasoningSelection(selection)) {
    case "low":
      return "low";
    case "medium":
      return "medium";
    case "high":
      return "high";
    case "max":
    case "ultrathink":
      return "xhigh";
    default:
      return getModelSelectionBooleanOptionValue(selection, "thinking") === true ? "medium" : "off";
  }
}

export function selectionToFastMode(selection: ModelSelection | null | undefined) {
  return getModelSelectionBooleanOptionValue(selection, "fastMode") === true;
}

export function selectionSupportsFastMode(
  providers: readonly ServerProvider[],
  selection: ModelSelection | null | undefined,
) {
  if (!selection) return false;
  return (
    getProviderModelCapabilities(
      getProviderModels(providers, selection.provider),
      selection.model,
      selection.provider,
    ).optionDescriptors?.some((descriptor) => descriptor.id === "fastMode") ?? false
  );
}

export function applyThinking(selection: ModelSelection, level: ThinkingLevel): ModelSelection {
  const reasoningValue =
    level === "off"
      ? undefined
      : level === "minimal" || level === "low"
        ? "low"
        : level === "medium"
          ? "medium"
          : level === "xhigh"
            ? "max"
            : "high";
  const id =
    selection.provider === "codex"
      ? "reasoningEffort"
      : selection.provider === "cursor"
        ? "reasoning"
        : "effort";
  let options = setOptionSelection(selection.options, id, reasoningValue);
  if (selection.options?.some((option) => option.id === "thinking")) {
    options = setOptionSelection(options, "thinking", level !== "off");
  }
  return withOptions(selection, options);
}

export function applyFastMode(selection: ModelSelection, on: boolean): ModelSelection {
  return withOptions(selection, setOptionSelection(selection.options, "fastMode", on));
}

export function listRuntimeModelsFromProviders(
  providers: readonly ServerProvider[],
  cur?: HarnessModelRef | null,
) {
  const items = providers
    .filter((provider) => provider.enabled)
    .flatMap((provider) => provider.models.map((item) => toModelItem(provider.provider, item)));
  const keys = new Set(items.map((item) => item.key));
  if (cur && !keys.has(key(cur.provider, cur.id))) {
    items.push({
      key: key(cur.provider, cur.id),
      provider: cur.provider,
      id: cur.id,
      name: cur.name ?? cur.id,
      reasoning: Boolean(cur.reasoning),
      supportsFastMode: false,
      supportsXhigh: false,
    });
  }
  return items.toSorted((left, right) =>
    `${displayProviderName(left.provider)} ${left.name}`.localeCompare(
      `${displayProviderName(right.provider)} ${right.name}`,
    ),
  );
}

export function resolveRuntimeModel(
  providers: readonly ServerProvider[],
  selection: ModelSelection,
  cur?: HarnessModelRef | null,
) {
  const items = listRuntimeModelsFromProviders(providers, cur);
  return (
    items.find((item) => item.provider === selection.provider && item.id === selection.model) ??
    cur ??
    fallbackModel(selection)
  );
}

export function readRuntimeDefaults(
  projects: readonly Project[],
  providers: readonly ServerProvider[],
  cwd = readStoredCwd(),
  cur?: HarnessModelRef | null,
) {
  const project = resolveActiveProject(projects, cwd);
  const selection = resolveRuntimeSelection(providers, project?.defaultModelSelection);
  const modelRef = resolveRuntimeModel(providers, selection, cur);
  return {
    project,
    selection,
    provider: modelRef?.provider ?? null,
    model: modelRef?.id ?? null,
    fastMode: selectionToFastMode(selection),
    fastSupported: selectionSupportsFastMode(providers, selection),
    thinkingLevel: selectionToThinking(selection),
    stored: project?.defaultModelSelection !== null,
    items: listRuntimeModelsFromProviders(providers, cur),
    modelRef,
  };
}

export async function writeRuntimeDefaultModel(model: HarnessModelRef) {
  const state = useStore.getState();
  const project = resolveActiveProject(
    selectProjectsForEnvironment(state, state.activeEnvironmentId),
  );
  if (!project) return;
  const orchestration = readNativeEnvironmentApi(project.environmentId)?.orchestration;
  if (!orchestration) return;
  const providers = getServerConfig()?.providers ?? [];
  const current = project.defaultModelSelection;
  const next = resolveRuntimeSelection(providers, {
    provider: model.provider as ProviderKind,
    model: model.id,
    ...(current?.provider === model.provider && current.options
      ? { options: current.options }
      : {}),
  });
  await orchestration.dispatchCommand({
    type: "project.meta.update",
    commandId: commandId(),
    projectId: project.id,
    defaultModelSelection: next,
  });
}

export async function clearRuntimeDefaultModel() {
  const state = useStore.getState();
  const project = resolveActiveProject(
    selectProjectsForEnvironment(state, state.activeEnvironmentId),
  );
  if (!project) return;
  const orchestration = readNativeEnvironmentApi(project.environmentId)?.orchestration;
  if (!orchestration) return;
  await orchestration.dispatchCommand({
    type: "project.meta.update",
    commandId: commandId(),
    projectId: project.id,
    defaultModelSelection: null,
  });
}

export async function writeRuntimeDefaultThinkingLevel(level: ThinkingLevel) {
  const state = useStore.getState();
  const project = resolveActiveProject(
    selectProjectsForEnvironment(state, state.activeEnvironmentId),
  );
  if (!project) return;
  const orchestration = readNativeEnvironmentApi(project.environmentId)?.orchestration;
  if (!orchestration) return;
  const providers = getServerConfig()?.providers ?? [];
  const selection = resolveRuntimeSelection(providers, project.defaultModelSelection);
  await orchestration.dispatchCommand({
    type: "project.meta.update",
    commandId: commandId(),
    projectId: project.id,
    defaultModelSelection: resolveRuntimeSelection(providers, applyThinking(selection, level)),
  });
}

export async function writeRuntimeDefaultFastMode(on: boolean) {
  const state = useStore.getState();
  const project = resolveActiveProject(
    selectProjectsForEnvironment(state, state.activeEnvironmentId),
  );
  if (!project) return;
  const orchestration = readNativeEnvironmentApi(project.environmentId)?.orchestration;
  if (!orchestration) return;
  const providers = getServerConfig()?.providers ?? [];
  const selection = resolveRuntimeSelection(providers, project.defaultModelSelection);
  await orchestration.dispatchCommand({
    type: "project.meta.update",
    commandId: commandId(),
    projectId: project.id,
    defaultModelSelection: resolveRuntimeSelection(providers, applyFastMode(selection, on)),
  });
}
