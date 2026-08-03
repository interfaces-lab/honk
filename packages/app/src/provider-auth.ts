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

type OpenCodeOauthMethod = Extract<OpenCodeProviderAuthMethod, { readonly type: "oauth" }>;

export type OpenAiFlow =
  | { readonly kind: "idle" }
  | { readonly kind: "choosing"; readonly methods: readonly OpenCodeProviderAuthMethod[] }
  | {
      readonly kind: "prompt";
      readonly method: OpenCodeOauthMethod;
      readonly inputs: Readonly<Record<string, string>>;
      readonly cursor: ProviderPromptCursor;
    }
  | { readonly kind: "authorizing"; readonly label: string }
  | {
      readonly kind: "code";
      readonly attemptID: string;
      readonly url: string;
      readonly instructions: string;
    }
  | { readonly kind: "waiting"; readonly attemptID: string; readonly instructions: string }
  | { readonly kind: "apiKey" }
  | { readonly kind: "disconnecting" };

export type OpenCodeGoFlow =
  | { readonly kind: "idle" }
  | { readonly kind: "apiKey" }
  | { readonly kind: "saving" };

export type ProviderAuthSnapshot = {
  readonly phase: "unavailable" | "loading" | "ready";
  readonly inventory: OpenCodeProviderInventory;
  readonly openAiConnected: boolean;
  readonly openAi: OpenAiFlow;
  readonly openCodeGoConnected: boolean;
  readonly openCodeGo: OpenCodeGoFlow;
  // Local Claude Code CLI auth. null means no desktop bridge (web host) or the
  // probe returned "unknown"; callers must not gate model rows on null.
  readonly claudeConnected: boolean | null;
  readonly errorMessage: string | null;
};

export type ProviderAuthCoordinator = {
  readonly getSnapshot: () => ProviderAuthSnapshot;
  readonly subscribe: (listener: () => void) => () => void;
  readonly start: () => Promise<void>;
  readonly refresh: () => Promise<void>;
  readonly refreshClaude: () => Promise<void>;
  readonly startOpenAi: () => Promise<void>;
  readonly chooseOpenAiMethod: (methodID: string) => Promise<void>;
  readonly submitOpenAiPrompt: (value: string) => Promise<void>;
  readonly submitOpenAiCode: (code: string) => Promise<void>;
  readonly submitOpenAiApiKey: (value: string) => Promise<void>;
  readonly cancelOpenAi: () => Promise<void>;
  readonly disconnectOpenAi: () => Promise<void>;
  readonly startOpenCodeGo: () => Promise<void>;
  readonly submitOpenCodeGoApiKey: (value: string) => Promise<void>;
  readonly cancelOpenCodeGo: () => void;
  readonly dispose: () => void;
};

const EMPTY_INVENTORY: OpenCodeProviderInventory = Object.freeze([]);
const IDLE_FLOW: OpenAiFlow = Object.freeze({ kind: "idle" });
const IDLE_OPEN_CODE_GO_FLOW: OpenCodeGoFlow = Object.freeze({ kind: "idle" });
const UNAVAILABLE_SNAPSHOT: ProviderAuthSnapshot = Object.freeze({
  phase: "unavailable",
  inventory: EMPTY_INVENTORY,
  openAiConnected: false,
  openAi: IDLE_FLOW,
  openCodeGoConnected: false,
  openCodeGo: IDLE_OPEN_CODE_GO_FLOW,
  claudeConnected: null,
  errorMessage: null,
});

function providerConnected(inventory: OpenCodeProviderInventory, providerID: string): boolean {
  return inventory.some(
    (provider) => provider.id === providerID && provider.connections.length > 0,
  );
}

// Desktop-only probe over the preload bridge; the claude CLI's auth store is
// invisible to the OpenCode sidecar. Maps "unknown" and missing bridge to null.
async function readDesktopClaudeConnected(): Promise<boolean | null> {
  if (typeof window === "undefined") return null;
  const probe = window.desktopBridge?.getClaudeAuthStatus;
  if (probe === undefined) return null;
  const status = await probe().catch(() => "unknown" as const);
  if (status === "connected") return true;
  if (status === "disconnected") return false;
  return null;
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
  method: OpenCodeOauthMethod,
  start: number,
  inputs: Readonly<Record<string, string>>,
): number | null {
  const prompts = method.prompts ?? [];
  for (let index = start; index < prompts.length; index += 1) {
    const prompt = prompts[index];
    if (prompt !== undefined && isProviderAuthPromptVisible(prompt, inputs)) return index;
  }
  return null;
}

export function createProviderAuthCoordinator(
  client: OpenCodeClient,
  openUrl: (url: string) => Promise<void> = openProviderAuthUrl,
  readClaudeConnected: () => Promise<boolean | null> = readDesktopClaudeConnected,
): ProviderAuthCoordinator {
  let active = true;
  let operationSequence = 0;
  let refreshFlight: Promise<void> | null = null;
  let claudeFlight: Promise<void> | null = null;
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
    completed: "openai" | "opencode",
  ): Promise<void> => {
    const inventory = await client.providers.list();
    if (!current(sequence)) return;
    publish({
      ...snapshot,
      phase: "ready",
      inventory,
      openAiConnected: providerConnected(inventory, "openai"),
      openCodeGoConnected: providerConnected(inventory, "opencode"),
      ...(completed === "openai" ? { openAi: IDLE_FLOW } : { openCodeGo: IDLE_OPEN_CODE_GO_FLOW }),
      errorMessage: null,
    });
  };

  const refresh = (): Promise<void> => {
    if (refreshFlight !== null) return refreshFlight;
    const sequence = ++operationSequence;
    publish({ ...snapshot, phase: "loading", errorMessage: null });
    // The claude probe is local desktop IPC, independent of the sidecar.
    // Publish it on its own so a slow or failed inventory fetch cannot
    // discard its answer.
    const claudeProbe = readClaudeConnected()
      .catch(() => null)
      .then((claudeConnected) => {
        if (current(sequence) && claudeConnected !== snapshot.claudeConnected) {
          publish({ ...snapshot, claudeConnected });
        }
      });
    const flight = client.providers
      .list()
      .then((inventory) => {
        if (!current(sequence)) return;
        publish({
          ...snapshot,
          phase: "ready",
          inventory,
          openAiConnected: providerConnected(inventory, "openai"),
          openCodeGoConnected: providerConnected(inventory, "opencode"),
          errorMessage: null,
        });
      })
      .catch((cause: unknown) => {
        if (!current(sequence)) return;
        publish({ ...snapshot, phase: "ready", errorMessage: errorMessage(cause) });
      })
      .then(() => claudeProbe)
      .finally(() => {
        if (refreshFlight === flight) refreshFlight = null;
      });
    refreshFlight = flight;
    return flight;
  };

  // Claude-only re-probe. The local claude CLI's auth store can change at any
  // time behind the app's back, so surfaces gated on it (the model picker)
  // re-check on open. Leaves phase and the provider inventory untouched so
  // rows never flicker back through "loading".
  const refreshClaude = (): Promise<void> => {
    if (claudeFlight !== null) return claudeFlight;
    const flight = readClaudeConnected()
      .catch(() => null)
      .then((claudeConnected) => {
        if (active && claudeConnected !== snapshot.claudeConnected) {
          publish({ ...snapshot, claudeConnected });
        }
      })
      .finally(() => {
        if (claudeFlight === flight) claudeFlight = null;
      });
    claudeFlight = flight;
    return flight;
  };

  const authorize = async (
    method: OpenCodeOauthMethod,
    inputs: Readonly<Record<string, string>>,
  ): Promise<void> => {
    const sequence = ++operationSequence;
    publish({
      ...snapshot,
      openAi: { kind: "authorizing", label: method.label },
      errorMessage: null,
    });
    try {
      const authorization = await client.providers.connectOauth("openai", method.id, inputs);
      if (!current(sequence)) {
        await client.providers.cancelOauth(authorization.attemptID);
        return;
      }
      await openUrl(authorization.url);
      if (!current(sequence)) {
        await client.providers.cancelOauth(authorization.attemptID);
        return;
      }
      if (authorization.mode === "code") {
        publish({
          ...snapshot,
          openAi: {
            kind: "code",
            attemptID: authorization.attemptID,
            url: authorization.url,
            instructions: authorization.instructions,
          },
        });
        return;
      }
      publish({
        ...snapshot,
        openAi: {
          kind: "waiting",
          attemptID: authorization.attemptID,
          instructions: authorization.instructions,
        },
      });
      while (current(sequence)) {
        const status = await client.providers.oauthStatus(authorization.attemptID);
        if (status.status === "complete") break;
        if (status.status === "failed") throw new Error(status.message);
        if (status.status === "expired") throw new Error("Authorization expired.");
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      if (!current(sequence)) return;
      await verifyProviders(sequence, "openai");
    } catch (cause) {
      reportOpenAiError(sequence, cause);
    }
  };

  const startOpenAi = async (): Promise<void> => {
    await refresh();
    if (!active) return;
    const methods = snapshot.inventory
      .find((provider) => provider.id === "openai")
      ?.methods.filter((method): method is OpenCodeProviderAuthMethod => method.type !== "env");
    publish({
      ...snapshot,
      openAi: { kind: "choosing", methods: methods ?? [] },
      errorMessage: null,
    });
  };

  const chooseOpenAiMethod = async (methodID: string): Promise<void> => {
    const flow = snapshot.openAi;
    if (flow.kind !== "choosing") return;
    const method = flow.methods.find((candidate) =>
      candidate.type === "key" ? methodID === "key" : candidate.id === methodID,
    );
    if (method === undefined) return;
    if (method.type === "key") {
      publish({ ...snapshot, openAi: { kind: "apiKey" }, errorMessage: null });
      return;
    }
    if (method.type !== "oauth") return;
    const first = nextProviderAuthPromptIndex(method, 0, {});
    if (first !== null) {
      publish({
        ...snapshot,
        openAi: {
          kind: "prompt",
          method,
          inputs: Object.freeze({}),
          cursor: { index: first, prompt: (method.prompts ?? [])[first]! },
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
        openAi: {
          ...flow,
          inputs,
          cursor: { index: next, prompt: (flow.method.prompts ?? [])[next]! },
        },
      });
      return;
    }
    await authorize(flow.method, inputs);
  };

  const submitOpenAiCode = async (code: string): Promise<void> => {
    const flow = snapshot.openAi;
    if (flow.kind !== "code") return;
    const sequence = ++operationSequence;
    publish({
      ...snapshot,
      openAi: { kind: "waiting", attemptID: flow.attemptID, instructions: flow.instructions },
    });
    try {
      await client.providers.completeOauth(flow.attemptID, code.trim());
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
      openAi: { kind: "authorizing", label: "API key" },
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
      const credentials =
        snapshot.inventory
          .find((provider) => provider.id === "openai")
          ?.connections.filter((connection) => connection.type === "credential") ?? [];
      await Promise.all(
        credentials.map((credential) => client.providers.removeCredential(credential.id)),
      );
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
      await client.providers.setApiKey("opencode", key);
      await verifyProviders(sequence, "opencode");
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
    refreshClaude,
    startOpenAi,
    chooseOpenAiMethod,
    submitOpenAiPrompt,
    submitOpenAiCode,
    submitOpenAiApiKey,
    async cancelOpenAi() {
      const flow = snapshot.openAi;
      operationSequence += 1;
      publish({ ...snapshot, openAi: IDLE_FLOW, errorMessage: null });
      if (flow.kind === "code" || flow.kind === "waiting") {
        try {
          await client.providers.cancelOauth(flow.attemptID);
        } catch (cause) {
          if (active) publish({ ...snapshot, errorMessage: errorMessage(cause) });
        }
      }
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
  refreshClaude: () => run((coordinator) => coordinator.refreshClaude()),
  startOpenAi: () => run((coordinator) => coordinator.startOpenAi()),
  chooseOpenAiMethod: (methodID: string) =>
    run((coordinator) => coordinator.chooseOpenAiMethod(methodID)),
  submitOpenAiPrompt: (value: string) =>
    run((coordinator) => coordinator.submitOpenAiPrompt(value)),
  submitOpenAiCode: (code: string) => run((coordinator) => coordinator.submitOpenAiCode(code)),
  submitOpenAiApiKey: (value: string) =>
    run((coordinator) => coordinator.submitOpenAiApiKey(value)),
  cancelOpenAi: () => run((coordinator) => coordinator.cancelOpenAi()),
  disconnectOpenAi: () => run((coordinator) => coordinator.disconnectOpenAi()),
  startOpenCodeGo: () => run((coordinator) => coordinator.startOpenCodeGo()),
  submitOpenCodeGoApiKey: (value: string) =>
    run((coordinator) => coordinator.submitOpenCodeGoApiKey(value)),
  cancelOpenCodeGo: () => boundCoordinator?.cancelOpenCodeGo(),
});
