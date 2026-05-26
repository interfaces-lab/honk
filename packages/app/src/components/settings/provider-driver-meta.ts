import {
  ClaudeSettings,
  CodexSettings,
  CursorSdkSettings,
  CursorSettings,
  OpenCodeSettings,
  ProviderDriverKind,
} from "@multi/contracts";
import type { Schema } from "effect";
import {
  IconClaudeai,
  IconCursor,
  IconOpenaiCodex,
  IconOpencode,
  type CentralIconBaseProps,
} from "central-icons";
import type { ComponentType } from "react";

type ProviderDriverIcon = ComponentType<CentralIconBaseProps>;

type ProviderSettingsSchema = {
  readonly fields: Readonly<Record<string, Schema.Top>>;
} & Schema.Top;

/**
 * Browser-safe provider definition. This is deliberately shaped like the
 * future provider package client export: the core web app gets a schema with
 * field annotations plus provider-level presentation metadata, then renders
 * settings generically.
 */
export interface DriverOption {
  readonly value: ProviderDriverKind;
  readonly label: string;
  readonly icon: ProviderDriverIcon;
  readonly settingsSchema: ProviderSettingsSchema;
  /** Optional short label rendered as a `variant="warning"` badge next to the instance title. */
  readonly badgeLabel?: string;
}

export const DRIVER_OPTIONS: readonly DriverOption[] = [
  {
    value: ProviderDriverKind.make("codex"),
    label: "Codex",
    icon: IconOpenaiCodex,
    settingsSchema: CodexSettings,
  },
  {
    value: ProviderDriverKind.make("claudeAgent"),
    label: "Claude",
    icon: IconClaudeai,
    settingsSchema: ClaudeSettings,
  },
  {
    value: ProviderDriverKind.make("opencode"),
    label: "OpenCode",
    icon: IconOpencode,
    settingsSchema: OpenCodeSettings,
  },
  {
    value: ProviderDriverKind.make("cursor"),
    label: "Cursor",
    icon: IconCursor,
    settingsSchema: CursorSettings,
  },
  {
    value: ProviderDriverKind.make("cursorSdk"),
    label: "Cursor SDK",
    icon: IconCursor,
    settingsSchema: CursorSdkSettings,
    badgeLabel: "SDK",
  },
];

const DRIVER_OPTION_BY_VALUE: Partial<Record<ProviderDriverKind, DriverOption>> =
  Object.fromEntries(DRIVER_OPTIONS.map((definition) => [definition.value, definition]));

/**
 * Look up the driver metadata for an instance's `driver` field. Accepts
 * Returns `undefined` for fork / unknown drivers so callers can decide how
 * to render them — typically by falling back to a generic card.
 */
export function getDriverOption(driver: ProviderDriverKind | undefined): DriverOption | undefined {
  if (driver === undefined) return undefined;
  return DRIVER_OPTION_BY_VALUE[driver];
}
