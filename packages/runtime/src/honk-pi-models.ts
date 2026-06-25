import type { AuthStorage, ModelRegistry } from "@earendil-works/pi-coding-agent";

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

export function createHonkPiModelRegistry(
  modelRegistryFactory: ModelRegistryFactory,
  authStorage: AuthStorage,
  modelsJsonPath: string,
): ModelRegistry {
  return modelRegistryFactory.create(authStorage, modelsJsonPath);
}
