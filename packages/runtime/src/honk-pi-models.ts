import type { AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";
import { register as registerAnthropicTransport } from "@earendil-works/pi-ai/anthropic";
import { register as registerOpenAICodexResponsesTransport } from "@earendil-works/pi-ai/openai-codex-responses";
import { register as registerOpenAIResponsesTransport } from "@earendil-works/pi-ai/openai-responses";

type ModelRegistryFactory = {
  readonly create: (authStorage: AuthStorage, modelsJsonPath: string) => ModelRegistry;
};

export const HONK_PI_SUPPORTED_PROVIDER_IDS = [
  "anthropic",
  "openai-codex",
  "openai",
  "cursor",
] as const;

const HONK_PI_SUPPORTED_PROVIDER_ID_SET: ReadonlySet<string> = new Set(
  HONK_PI_SUPPORTED_PROVIDER_IDS,
);

export type HonkPiSupportedProviderId = (typeof HONK_PI_SUPPORTED_PROVIDER_IDS)[number];

export function isHonkPiSupportedProviderId(
  providerId: string,
): providerId is HonkPiSupportedProviderId {
  return HONK_PI_SUPPORTED_PROVIDER_ID_SET.has(providerId);
}

let honkPiTransportsRegistered = false;

export function registerHonkPiTransports(): void {
  if (honkPiTransportsRegistered) {
    return;
  }
  honkPiTransportsRegistered = true;
  registerAnthropicTransport();
  registerOpenAICodexResponsesTransport();
  registerOpenAIResponsesTransport();
}

export function createHonkPiModelRegistry(
  modelRegistryFactory: ModelRegistryFactory,
  authStorage: AuthStorage,
  modelsJsonPath: string,
): ModelRegistry {
  registerHonkPiTransports();
  return modelRegistryFactory.create(authStorage, modelsJsonPath);
}
