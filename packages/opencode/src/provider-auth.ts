import type { ProviderAuthAuthorization, ProviderAuthMethod } from "@opencode-ai/sdk/v2/client";

export const MANAGED_ANTHROPIC_PLUGIN_SPEC = "opencode-anthropic-login-via-cli@1.4.0";
export const MANAGED_ANTHROPIC_METHOD_LABEL = "Claude Code (auto)";

export type OpenCodeInteractiveProviderID = "openai";
export type OpenCodeManagedProviderID = "anthropic";
export type OpenCodeProviderID = OpenCodeInteractiveProviderID | OpenCodeManagedProviderID;
export type OpenCodeProviderAuthPrompt = NonNullable<ProviderAuthMethod["prompts"]>[number];
export type OpenCodeProviderAuthorization = Readonly<ProviderAuthAuthorization>;
export type OpenCodeProviderAuthMethod = Readonly<
  Omit<ProviderAuthMethod, "prompts"> & {
    readonly index: number;
    readonly prompts: readonly OpenCodeProviderAuthPrompt[];
  }
>;

export type OpenCodeProvider = {
  readonly id: string;
  readonly name: string;
  readonly connected: boolean;
};

export type OpenCodeProviderInventory = {
  readonly providers: readonly OpenCodeProvider[];
};

export type ManagedAnthropicImport =
  | { readonly kind: "connected"; readonly inventory: OpenCodeProviderInventory }
  | { readonly kind: "unavailable"; readonly inventory: OpenCodeProviderInventory }
  | {
      readonly kind: "failed";
      readonly inventory: OpenCodeProviderInventory;
      readonly message: string;
    };

export type OpenCodeProviderApi = {
  readonly list: () => Promise<OpenCodeProviderInventory>;
  readonly authMethods: (
    providerID: OpenCodeProviderID,
  ) => Promise<readonly OpenCodeProviderAuthMethod[]>;
  readonly authorizeOauth: (
    providerID: OpenCodeProviderID,
    methodIndex: number,
    inputs: Readonly<Record<string, string>>,
  ) => Promise<OpenCodeProviderAuthorization>;
  readonly completeOauth: (
    providerID: OpenCodeProviderID,
    methodIndex: number,
    code?: string,
  ) => Promise<void>;
  readonly setApiKey: (providerID: OpenCodeInteractiveProviderID, value: string) => Promise<void>;
  readonly removeAuth: (providerID: OpenCodeInteractiveProviderID) => Promise<void>;
  readonly ensureManagedAnthropicImport: () => Promise<ManagedAnthropicImport>;
};

export type ManagedAnthropicDependencies = Pick<
  OpenCodeProviderApi,
  "list" | "authMethods" | "authorizeOauth" | "completeOauth"
>;

function providerConnected(inventory: OpenCodeProviderInventory, providerID: string): boolean {
  return inventory.providers.some((provider) => provider.id === providerID && provider.connected);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) return error.message;
  return typeof error === "string" && error.trim().length > 0
    ? error
    : "Managed Anthropic import failed.";
}

export function createManagedAnthropicImport(
  api: ManagedAnthropicDependencies,
): () => Promise<ManagedAnthropicImport> {
  let inFlight: Promise<ManagedAnthropicImport> | null = null;
  let observedConnected = false;
  let episodeAttempted = false;
  let episodeResult: ManagedAnthropicImport | null = null;

  const run = async (): Promise<ManagedAnthropicImport> => {
    const inventory = await api.list();
    if (providerConnected(inventory, "anthropic")) {
      observedConnected = true;
      episodeAttempted = false;
      episodeResult = null;
      return { kind: "connected", inventory };
    }

    if (observedConnected) {
      observedConnected = false;
      episodeAttempted = false;
      episodeResult = null;
    }

    if (episodeAttempted) {
      if (episodeResult?.kind === "failed") {
        return { kind: "failed", inventory, message: episodeResult.message };
      }
      return { kind: "unavailable", inventory };
    }

    episodeAttempted = true;
    try {
      const methods = await api.authMethods("anthropic");
      const method = methods.find(
        (candidate) =>
          candidate.type === "oauth" && candidate.label === MANAGED_ANTHROPIC_METHOD_LABEL,
      );
      if (method === undefined) {
        episodeResult = { kind: "unavailable", inventory };
        return episodeResult;
      }

      const authorization = await api.authorizeOauth("anthropic", method.index, {});
      if (authorization.method !== "auto") {
        throw new Error(
          `${MANAGED_ANTHROPIC_METHOD_LABEL} returned ${authorization.method}; auto handoff is required.`,
        );
      }

      await api.completeOauth("anthropic", method.index);
      const refreshed = await api.list();
      if (!providerConnected(refreshed, "anthropic")) {
        episodeResult = { kind: "unavailable", inventory: refreshed };
        return episodeResult;
      }

      observedConnected = true;
      episodeAttempted = false;
      episodeResult = null;
      return { kind: "connected", inventory: refreshed };
    } catch (error) {
      episodeResult = { kind: "failed", inventory, message: errorMessage(error) };
      return episodeResult;
    }
  };

  return () => {
    if (inFlight !== null) return inFlight;
    inFlight = run().finally(() => {
      inFlight = null;
    });
    return inFlight;
  };
}
