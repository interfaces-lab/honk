import type {
  IntegrationAttempt,
  IntegrationAttemptStatus,
  IntegrationInfo,
  IntegrationMethod,
  IntegrationSelectPrompt,
  IntegrationTextPrompt,
} from "@opencode-ai/sdk/v2/client";

export type OpenCodeProviderAuthPrompt = IntegrationTextPrompt | IntegrationSelectPrompt;
export type OpenCodeProviderAuthMethod = Exclude<IntegrationMethod, { readonly type: "env" }>;
export type OpenCodeProvider = IntegrationInfo;
export type OpenCodeProviderInventory = readonly OpenCodeProvider[];
export type OpenCodeProviderAuthorization = IntegrationAttempt;

export type OpenCodeProviderApi = {
  readonly list: () => Promise<OpenCodeProviderInventory>;
  readonly connectOauth: (
    integrationID: string,
    methodID: string,
    inputs: Readonly<Record<string, string>>,
  ) => Promise<OpenCodeProviderAuthorization>;
  readonly oauthStatus: (attemptID: string) => Promise<IntegrationAttemptStatus>;
  readonly completeOauth: (attemptID: string, code?: string) => Promise<void>;
  readonly cancelOauth: (attemptID: string) => Promise<void>;
  readonly setApiKey: (integrationID: string, value: string) => Promise<void>;
  readonly removeCredential: (credentialID: string) => Promise<void>;
};
