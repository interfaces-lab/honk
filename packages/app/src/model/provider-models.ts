import {
  type ModelCapabilities,
  ProviderDriverKind,
  type ServerProviderModel,
} from "@multi/contracts";
import { createModelCapabilities, normalizeModelSlug } from "@multi/shared/model";

const EMPTY_CAPABILITIES: ModelCapabilities = createModelCapabilities({
  optionDescriptors: [],
});

export function formatProviderDriverKindLabel(provider: ProviderDriverKind): string {
  return provider
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function getProviderModelCapabilities(
  models: ReadonlyArray<ServerProviderModel>,
  model: string | null | undefined,
  _provider: ProviderDriverKind,
): ModelCapabilities {
  const slug = normalizeModelSlug(model);
  return models.find((candidate) => candidate.slug === slug)?.capabilities ?? EMPTY_CAPABILITIES;
}
