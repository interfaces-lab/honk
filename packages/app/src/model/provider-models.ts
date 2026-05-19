import {
  type ModelCapabilities,
  ProviderDriverKind,
  type ServerProviderModel,
} from "@multi/contracts";
import { createModelCapabilities, normalizeModelSlug } from "@multi/shared/model";

const EMPTY_CAPABILITIES: ModelCapabilities = createModelCapabilities({
  optionDescriptors: [],
});

function isCursorComposerModel(provider: ProviderDriverKind, slug: string | null | undefined) {
  return provider === ProviderDriverKind.make("cursor") && slug?.startsWith("composer-") === true;
}

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
  provider: ProviderDriverKind,
): ModelCapabilities {
  const slug = normalizeModelSlug(model);
  if (isCursorComposerModel(provider, slug)) {
    return EMPTY_CAPABILITIES;
  }
  return models.find((candidate) => candidate.slug === slug)?.capabilities ?? EMPTY_CAPABILITIES;
}
