import type {
  OpenCodeClient,
  OpenCodeProviderAuthMethod,
  OpenCodeProviderAuthPrompt,
  OpenCodeProviderInventory,
} from "@honk/opencode";
import { useSyncExternalStore } from "react";

import { errorMessage } from "./error-message";

export type ProviderPromptCursor = {
  readonly index: number;
  readonly prompt: OpenCodeProviderAuthPrompt;
};

export type OpenAiFlow =
  | { readonly kind: "idle" }
  | { readonly kind: "choosing"; readonly methods: readonly OpenCodeProviderAuthMethod[] }
  | {
      readonly kind: "prompt";
      readonly method: OpenCodeProviderAuthMethod;
      readonly inputs: Readonly<Record<string, string>>;
      readonly cursor: ProviderPromptCursor;
    }
  | { readonly kind: "authorizing"; readonly methodIndex: number; readonly label: string }
  | {
      readonly kind: "code";
      readonly methodIndex: number;
      readonly url: string;
      readonly instructions: string;
    }
  | { readonly kind: "waiting"; readonly instructions: string }
  | { readonly kind: "apiKey" }
  | { readonly kind: "disconnecting" };

export type OpenCodeGoFlow =
  | { readonly kind: "idle" }
  | { readonly kind: "apiKey" }
  | { readonly kind: "saving" };

export type AnthropicState =
  | { readonly kind: "checking" }
  | { readonly kind: "importing" }
  | { readonly kind: "connected" }
  | { readonly kind: "unavailable" }
  | { readonly kind: "failed"; readonly message: string };

export type ProviderAuthSnapshot = {
  readonly phase: "unavailable" | "loading" | "ready";
  readonly inventory: OpenCodeProviderInventory;
  readonly openAiConnected: boolean;
  readonly openAi: OpenAiFlow;
  readonly openCodeGoConnected: boolean;
  readonly openCodeGo: OpenCodeGoFlow;
  readonly anthropic: AnthropicState;
  readonly errorMessage: string | null;
};

export type ProviderAuthCoordinator = {
  readonly getSnapshot: () => ProviderAuthSnapshot;
  readonly subscribe: (listener: () => void) => () => void;
  readonly start: () => Promise<void>;
  readonly refresh: (options?: { readonly force?: boolean }) => Promise<void>;
  readonly startOpenAi: () => Promise<void>;
  readonly chooseOpenAiMethod: (methodIndex: number) => Promise<void>;
  readonly submitOpenAiPrompt: (value: string) => Promise<void>;
  readonly submitOpenAiCode: (code: string) => Promise<void>;
  readonly submitOpenAiApiKey: (value: string) => Promise<void>;
  readonly cancelOpenAi: () => void;
  readonly disconnectOpenAi: () => Promise<void>;
  readonly startOpenCodeGo: () => Promise<void>;
  readonly submitOpenCodeGoApiKey: (value: string) => Promise<void>;
  readonly cancelOpenCodeGo: () => void;
  readonly dispose: () => void;
};

const EMPTY_INVENTORY: OpenCodeProviderInventory = Object.freeze({ providers: Object.freeze([]) });
const IDLE_FLOW: OpenAiFlow = Object.freeze({ kind: "idle" });
const IDLE_OPEN_CODE_GO_FLOW: OpenCodeGoFlow = Object.freeze({ kind: "idle" });
const UNAVAILABLE_SNAPSHOT: ProviderAuthSnapshot = Object.freeze({
  phase: "unavailable",
  inventory: EMPTY_INVENTORY,
  openAiConnected: false,
  openAi: IDLE_FLOW,
  openCodeGoConnected: false,
  openCodeGo: IDLE_OPEN_CODE_GO_FLOW,
  anthropic: Object.freeze({ kind: "checking" }),
  errorMessage: null,
});

function providerConnected(inventory: OpenCodeProviderInventory, providerID: string): boolean {
  return inventory.providers.some((provider) => provider.id === providerID && provider.connected);
}

async function openProviderAuthUrl(url: string): Promise<void> {
  const openExternal = window.desktopBridge?.openExternal;
  if (openExternal !== undefined) {
    await openExternal(url);
    return;
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

export function isProviderAuthPromptVisible(
  prompt: OpenCodeProviderAuthPrompt,
  inputs: Readonly<Record<string, string>>,
): boolean {
  if (prompt.when === undefined) return true;
  const current = inputs[prompt.when.key];
  if (current === undefined) return false;
  return prompt.when.op === "eq" ? current === prompt.when.value : current !== prompt.when.value;
}

export function nextProviderAuthPromptIndex(
  method: OpenCodeProviderAuthMethod,
  start: number,
  inputs: Readonly<Record<string, string>>,
): number | null {
  for (let index = start; index < method.prompts.length; index += 1) {
    const prompt = method.prompts[index];
    if (prompt !== undefined && isProviderAuthPromptVisible(prompt, inputs)) return index;
  }
  return null;
}

export function createProviderAuthCoordinator(
  client: OpenCodeClient,
  openUrl: (url: string) => Promise<void> = openProviderAuthUrl,
): ProviderAuthCoordinator {
  let active = true;
  let operationSequence = 0;
  let refreshFlight: Promise<void> | null = null;
  let snapshot: ProviderAuthSnapshot = UNAVAILABLE_SNAPSHOT;
  const listeners = new Set<() => void>();

  const publish = (next: ProviderAuthSnapshot): void => {
    if (!active) return;
    snapshot = Object.freeze(next);
    for (const listener of listeners) listener();
  };
  const current = (sequence: number): boolean => active && sequence === operationSequence;
  const reportOpenAiError = (sequence: number, cause: unknown): void => {
    if (current(sequence)) {
      publish({ ...snapshot, openAi: IDLE_FLOW, errorMessage: errorMessage(cause) });
    }
  };
  const reportOpenCodeGoError = (sequence: number, cause: unknown): void => {
    if (current(sequence)) {
      publish({
        ...snapshot,
        openCodeGo: IDLE_OPEN_CODE_GO_FLOW,
        errorMessage: errorMessage(cause),
      });
    }
  };
  const verifyProviders = async (
    sequence: number,
    completed: "openai" | "opencode-go",
  ): Promise<void> => {
    const inventory = await client.providers.list();
    if (!current(sequence)) return;
    publish({
      ...snapshot,
      phase: "ready",
      inventory,
      openAiConnected: providerConnected(inventory, "openai"),
      openCodeGoConnected: providerConnected(inventory, "opencode-go"),
      ...(completed === "openai" ? { openAi: IDLE_FLOW } : { openCodeGo: IDLE_OPEN_CODE_GO_FLOW }),
      errorMessage: null,
    });
  };

  const refresh = (options?: { readonly force?: boolean }): Promise<void> => {
    if (refreshFlight !== null) return refreshFlight;
    const sequence = ++operationSequence;
    publish({
      ...snapshot,
      phase: "loading",
      anthropic: { kind: "importing" },
      errorMessage: null,
    });
    const flight = client.providers
      .ensureManagedAnthropicImport(options)
      .then((result) => {
        if (!current(sequence)) return;
        const anthropic: AnthropicState =
          result.kind === "connected"
            ? { kind: "connected" }
            : result.kind === "failed"
              ? { kind: "failed", message: result.message }
              : { kind: "unavailable" };
        publish({
          phase: "ready",
          inventory: result.inventory,
          openAiConnected: providerConnected(result.inventory, "openai"),
          openAi: snapshot.openAi,
          openCodeGoConnected: providerConnected(result.inventory, "opencode-go"),
          openCodeGo: snapshot.openCodeGo,
          anthropic,
          errorMessage: result.kind === "failed" ? result.message : null,
        });
      })
      .catch((cause: unknown) => {
        if (!current(sequence)) return;
        const message = errorMessage(cause);
        publish({
          ...snapshot,
          phase: "ready",
          anthropic: { kind: "failed", message },
          errorMessage: message,
        });
      })
      .finally(() => {
        if (refreshFlight === flight) refreshFlight = null;
      });
    refreshFlight = flight;
    return flight;
  };

  const authorize = async (
    method: OpenCodeProviderAuthMethod,
    inputs: Readonly<Record<string, string>>,
  ): Promise<void> => {
    const sequence = ++operationSequence;
    publish({
      ...snapshot,
      openAi: { kind: "authorizing", methodIndex: method.index, label: method.label },
      errorMessage: null,
    });
    try {
      const authorization = await client.providers.authorizeOauth("openai", method.index, inputs);
      if (!current(sequence)) return;
      await openUrl(authorization.url);
      if (!current(sequence)) return;
      if (authorization.method === "code") {
        publish({
          ...snapshot,
          openAi: {
            kind: "code",
            methodIndex: method.index,
            url: authorization.url,
            instructions: authorization.instructions,
          },
        });
        return;
      }
      publish({
        ...snapshot,
        openAi: { kind: "waiting", instructions: authorization.instructions },
      });
      await client.providers.completeOauth("openai", method.index);
      await verifyProviders(sequence, "openai");
    } catch (cause) {
      reportOpenAiError(sequence, cause);
    }
  };

  const startOpenAi = async (): Promise<void> => {
    await refresh();
    if (!active) return;
    const sequence = ++operationSequence;
    try {
      const methods = await client.providers.authMethods("openai");
      if (!current(sequence)) return;
      publish({ ...snapshot, openAi: { kind: "choosing", methods }, errorMessage: null });
    } catch (cause) {
      reportOpenAiError(sequence, cause);
    }
  };

  const chooseOpenAiMethod = async (methodIndex: number): Promise<void> => {
    const flow = snapshot.openAi;
    if (flow.kind !== "choosing") return;
    const method = flow.methods.find((candidate) => candidate.index === methodIndex);
    if (method === undefined) return;
    if (method.type === "api") {
      publish({ ...snapshot, openAi: { kind: "apiKey" }, errorMessage: null });
      return;
    }
    const first = nextProviderAuthPromptIndex(method, 0, {});
    if (first !== null) {
      publish({
        ...snapshot,
        openAi: {
          kind: "prompt",
          method,
          inputs: Object.freeze({}),
          cursor: { index: first, prompt: method.prompts[first]! },
        },
        errorMessage: null,
      });
      return;
    }
    await authorize(method, {});
  };

  const submitOpenAiPrompt = async (value: string): Promise<void> => {
    const flow = snapshot.openAi;
    if (flow.kind !== "prompt") return;
    const inputs = Object.freeze({ ...flow.inputs, [flow.cursor.prompt.key]: value });
    const next = nextProviderAuthPromptIndex(flow.method, flow.cursor.index + 1, inputs);
    if (next !== null) {
      publish({
        ...snapshot,
        openAi: { ...flow, inputs, cursor: { index: next, prompt: flow.method.prompts[next]! } },
      });
      return;
    }
    await authorize(flow.method, inputs);
  };

  const submitOpenAiCode = async (code: string): Promise<void> => {
    const flow = snapshot.openAi;
    if (flow.kind !== "code") return;
    const sequence = ++operationSequence;
    publish({ ...snapshot, openAi: { kind: "waiting", instructions: flow.instructions } });
    try {
      await client.providers.completeOauth("openai", flow.methodIndex, code.trim());
      await verifyProviders(sequence, "openai");
    } catch (cause) {
      reportOpenAiError(sequence, cause);
    }
  };

  const submitOpenAiApiKey = async (value: string): Promise<void> => {
    const key = value.trim();
    if (snapshot.openAi.kind !== "apiKey" || key.length === 0) return;
    const sequence = ++operationSequence;
    publish({
      ...snapshot,
      openAi: { kind: "authorizing", methodIndex: -1, label: "API key" },
      errorMessage: null,
    });
    try {
      await client.providers.setApiKey("openai", key);
      await verifyProviders(sequence, "openai");
    } catch (cause) {
      reportOpenAiError(sequence, cause);
    }
  };

  const disconnectOpenAi = async (): Promise<void> => {
    if (!snapshot.openAiConnected) return;
    const sequence = ++operationSequence;
    publish({ ...snapshot, openAi: { kind: "disconnecting" }, errorMessage: null });
    try {
      await client.providers.removeAuth("openai");
      await verifyProviders(sequence, "openai");
    } catch (cause) {
      reportOpenAiError(sequence, cause);
    }
  };

  const startOpenCodeGo = async (): Promise<void> => {
    await refresh();
    if (!active) return;
    operationSequence += 1;
    publish({ ...snapshot, openCodeGo: { kind: "apiKey" }, errorMessage: null });
  };

  const submitOpenCodeGoApiKey = async (value: string): Promise<void> => {
    const key = value.trim();
    if (snapshot.openCodeGo.kind !== "apiKey" || key.length === 0) return;
    const sequence = ++operationSequence;
    publish({ ...snapshot, openCodeGo: { kind: "saving" }, errorMessage: null });
    try {
      await client.providers.setApiKey("opencode-go", key);
      await verifyProviders(sequence, "opencode-go");
    } catch (cause) {
      reportOpenCodeGoError(sequence, cause);
    }
  };

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start: () => refresh(),
    refresh,
    startOpenAi,
    chooseOpenAiMethod,
    submitOpenAiPrompt,
    submitOpenAiCode,
    submitOpenAiApiKey,
    cancelOpenAi() {
      operationSequence += 1;
      publish({ ...snapshot, openAi: IDLE_FLOW, errorMessage: null });
    },
    disconnectOpenAi,
    startOpenCodeGo,
    submitOpenCodeGoApiKey,
    cancelOpenCodeGo() {
      operationSequence += 1;
      publish({ ...snapshot, openCodeGo: IDLE_OPEN_CODE_GO_FLOW, errorMessage: null });
    },
    dispose() {
      active = false;
      operationSequence += 1;
      listeners.clear();
    },
  };
}

const providerAuthListeners = new Set<() => void>();
let boundCoordinator: ProviderAuthCoordinator | null = null;
let unlistenCoordinator: (() => void) | null = null;

function emitProviderAuth(): void {
  for (const listener of providerAuthListeners) listener();
}

export function bindProviderAuthClient(client: OpenCodeClient | null): void {
  unlistenCoordinator?.();
  unlistenCoordinator = null;
  boundCoordinator?.dispose();
  boundCoordinator = client === null ? null : createProviderAuthCoordinator(client);
  if (boundCoordinator !== null) {
    unlistenCoordinator = boundCoordinator.subscribe(emitProviderAuth);
    void boundCoordinator.start();
  }
  emitProviderAuth();
}

export function useProviderAuth(): ProviderAuthSnapshot {
  return useSyncExternalStore(
    (listener) => {
      providerAuthListeners.add(listener);
      return () => providerAuthListeners.delete(listener);
    },
    () => boundCoordinator?.getSnapshot() ?? UNAVAILABLE_SNAPSHOT,
    () => UNAVAILABLE_SNAPSHOT,
  );
}

function run(action: (coordinator: ProviderAuthCoordinator) => Promise<void>): Promise<void> {
  return boundCoordinator === null ? Promise.resolve() : action(boundCoordinator);
}

export const providerAuthActions = Object.freeze({
  refresh: () => run((coordinator) => coordinator.refresh()),
  retryAnthropic: () => run((coordinator) => coordinator.refresh({ force: true })),
  startOpenAi: () => run((coordinator) => coordinator.startOpenAi()),
  chooseOpenAiMethod: (methodIndex: number) =>
    run((coordinator) => coordinator.chooseOpenAiMethod(methodIndex)),
  submitOpenAiPrompt: (value: string) =>
    run((coordinator) => coordinator.submitOpenAiPrompt(value)),
  submitOpenAiCode: (code: string) => run((coordinator) => coordinator.submitOpenAiCode(code)),
  submitOpenAiApiKey: (value: string) =>
    run((coordinator) => coordinator.submitOpenAiApiKey(value)),
  cancelOpenAi: () => boundCoordinator?.cancelOpenAi(),
  disconnectOpenAi: () => run((coordinator) => coordinator.disconnectOpenAi()),
  startOpenCodeGo: () => run((coordinator) => coordinator.startOpenCodeGo()),
  submitOpenCodeGoApiKey: (value: string) =>
    run((coordinator) => coordinator.submitOpenCodeGoApiKey(value)),
  cancelOpenCodeGo: () => boundCoordinator?.cancelOpenCodeGo(),
});
