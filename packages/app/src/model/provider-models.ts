import {
  type ModelCapabilities,
  ProviderDriverKind,
  type ProviderOptionDescriptor,
  type ServerProviderModel,
} from "@multi/contracts";
import { createModelCapabilities, normalizeModelSlug } from "@multi/shared/model";

const EMPTY_CAPABILITIES: ModelCapabilities = createModelCapabilities({
  optionDescriptors: [],
});
const CURSOR_FAST_MODE_DESCRIPTOR: Extract<ProviderOptionDescriptor, { type: "boolean" }> = {
  id: "fastMode",
  label: "Fast Mode",
  type: "boolean",
};

function isCursorComposerModel(provider: ProviderDriverKind, slug: string | null | undefined) {
  return provider === ProviderDriverKind.make("cursor") && slug?.startsWith("composer-") === true;
}

function getCursorComposerModelCapabilities(
  capabilities: ModelCapabilities,
  slug: string | null | undefined,
): ModelCapabilities {
  const fastModeDescriptor = capabilities.optionDescriptors?.find(
    (descriptor) => descriptor.type === "boolean" && descriptor.id === "fastMode",
  );
  return createModelCapabilities({
    optionDescriptors: fastModeDescriptor
      ? [fastModeDescriptor]
      : slug?.endsWith("-fast")
        ? []
        : [CURSOR_FAST_MODE_DESCRIPTOR],
  });
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
  const capabilities =
    models.find((candidate) => candidate.slug === slug)?.capabilities ?? EMPTY_CAPABILITIES;
  if (isCursorComposerModel(provider, slug)) {
    return getCursorComposerModelCapabilities(capabilities, slug);
  }
  return capabilities;
}
