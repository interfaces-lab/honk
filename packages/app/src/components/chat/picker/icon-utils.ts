import { ProviderDriverKind } from "@multi/contracts";

import { PROVIDER_OPTIONS } from "../../../session-logic";
import { IconOpenaiCodex, IconCursor, IconClaudeai, IconOpencode } from "central-icons";

export const PROVIDER_ICON_BY_PROVIDER: Partial<
  Record<ProviderDriverKind, typeof IconOpenaiCodex>
> = {
  [ProviderDriverKind.make("codex")]: IconOpenaiCodex,
  [ProviderDriverKind.make("claudeAgent")]: IconClaudeai,
  [ProviderDriverKind.make("opencode")]: IconOpencode,
  [ProviderDriverKind.make("cursor")]: IconCursor,
};

type AvailableProviderOption = {
  value: ProviderDriverKind;
  label: string;
  available: true;
  pickerSidebarBadge?: "new" | "soon";
};

export const AVAILABLE_PROVIDER_OPTIONS: AvailableProviderOption[] = PROVIDER_OPTIONS.filter(
  (option) => option.available,
).map((option) =>
  Object.assign(option, { value: ProviderDriverKind.make(option.value), available: true as const }),
);

export type ModelEsque = {
  slug: string;
  name: string;
  shortName?: string | undefined;
  subProvider?: string | undefined;
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
