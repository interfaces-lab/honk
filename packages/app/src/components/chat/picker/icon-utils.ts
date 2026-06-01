import { ProviderDriverKind } from "@multi/contracts";

import { IconClaudeai, IconOpenaiCodex, IconCursor } from "central-icons";

export const PROVIDER_ICON_BY_PROVIDER: Partial<
  Record<ProviderDriverKind, typeof IconOpenaiCodex>
> = {
  [ProviderDriverKind.make("codex")]: IconOpenaiCodex,
  [ProviderDriverKind.make("claudeAgent")]: IconClaudeai,
  [ProviderDriverKind.make("cursor")]: IconCursor,
};

export type ModelEsque = {
  slug: string;
  name: string;
  shortName?: string | undefined;
  subProvider?: string | undefined;
  selectable?: boolean | undefined;
};

export function getDisplayModelName(
  model: ModelEsque,
  options?: { preferShortName?: boolean },
): string {
  if (options?.preferShortName && model.shortName) {
    return model.shortName;
  }
  return model.name;
}

export function getTriggerDisplayModelName(model: ModelEsque): string {
  return getDisplayModelName(model, { preferShortName: true });
}

export function getTriggerDisplayModelLabel(model: ModelEsque): string {
  const title = getTriggerDisplayModelName(model);
  return model.subProvider ? `${model.subProvider} · ${title}` : title;
}
