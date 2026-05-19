import {
  defaultInstanceIdForDriver,
  type ProviderDriverKind,
  type ProviderInstanceId,
  type ServerProvider,
  type ServerProviderModel,
  type ServerProviderState,
} from "@multi/contracts";
import type { UnifiedSettings } from "@multi/contracts/settings";

import { formatProviderDriverKindLabel } from "./provider-models";

export interface ProviderInstanceEntry {
  readonly instanceId: ProviderInstanceId;
  readonly driverKind: ProviderDriverKind;
  readonly displayName: string;
  readonly accentColor?: string | undefined;
  readonly continuationGroupKey?: string | undefined;
  readonly enabled: boolean;
  readonly installed: boolean;
  readonly status: ServerProviderState;
  readonly isDefault: boolean;
  readonly isAvailable: boolean;
  readonly snapshot: ServerProvider;
  readonly models: ReadonlyArray<ServerProviderModel>;
}

function humanizeInstanceId(instanceId: ProviderInstanceId): string {
  return instanceId
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .split(" ")
    .filter((token) => token.length > 0)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(" ");
}

function driverKindLabel(driverKind: ProviderDriverKind): string {
  return formatProviderDriverKindLabel(driverKind);
}

export function normalizeProviderAccentColor(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return /^#[0-9a-fA-F]{6}$/u.test(trimmed) ? trimmed : undefined;
}

function resolveInstanceDisplayName(
  snapshot: ServerProvider,
  instanceId: ProviderInstanceId,
  driverKind: ProviderDriverKind,
  isDefault: boolean,
): string {
  const trimmedSnapshotName = snapshot.displayName?.trim();
  const kindLabel = driverKindLabel(driverKind);
  if (trimmedSnapshotName && trimmedSnapshotName !== kindLabel) {
    return trimmedSnapshotName;
  }
  if (!isDefault) {
    const humanized = humanizeInstanceId(instanceId);
    if (humanized.length > 0) return humanized;
  }
  return trimmedSnapshotName || kindLabel;
}

function deriveProviderInstanceEntries(
  providers: ReadonlyArray<ServerProvider>,
): ReadonlyArray<ProviderInstanceEntry> {
  return providers.map((snapshot) => {
    const instanceId = snapshot.instanceId;
    const driverKind = snapshot.driver;
    const defaultId = defaultInstanceIdForDriver(driverKind);
    const isDefault = instanceId === defaultId;
    const displayName = resolveInstanceDisplayName(snapshot, instanceId, driverKind, isDefault);
    return {
      instanceId,
      driverKind,
      displayName,
      accentColor: normalizeProviderAccentColor(snapshot.accentColor),
      continuationGroupKey: snapshot.continuation?.groupKey,
      enabled: snapshot.enabled,
      installed: snapshot.installed,
      status: snapshot.status,
      isDefault,
      isAvailable: true,
      snapshot,
      models: snapshot.models,
    } satisfies ProviderInstanceEntry;
  });
}

function resolveProviderInstanceEnabled(
  settings: UnifiedSettings,
  entry: Pick<ProviderInstanceEntry, "instanceId" | "driverKind" | "enabled" | "isDefault">,
): boolean {
  const instance = settings.providerInstances?.[entry.instanceId];
  if (instance?.driver === entry.driverKind) {
    return instance.enabled ?? true;
  }

  if (entry.isDefault) {
    const defaultProviderConfigs = settings.providers as Record<
      string,
      { readonly enabled: boolean } | undefined
    >;
    return defaultProviderConfigs[entry.driverKind]?.enabled ?? entry.enabled;
  }

  return entry.enabled;
}

function normalizeProviderInstanceEntryState(
  settings: UnifiedSettings,
  entry: ProviderInstanceEntry,
): ProviderInstanceEntry {
  const enabled = resolveProviderInstanceEnabled(settings, entry);
  const status = enabled ? entry.status : ("disabled" as const);
  if (enabled === entry.enabled && status === entry.status) {
    return entry;
  }

  return {
    ...entry,
    enabled,
    status,
    snapshot: {
      ...entry.snapshot,
      enabled,
      status,
    },
  };
}

function deriveProviderInstanceEntriesForSettings(
  settings: UnifiedSettings,
  providers: ReadonlyArray<ServerProvider>,
): ReadonlyArray<ProviderInstanceEntry> {
  return deriveProviderInstanceEntries(providers).map((entry) =>
    normalizeProviderInstanceEntryState(settings, entry),
  );
}

function sortProviderInstanceEntries(
  entries: ReadonlyArray<ProviderInstanceEntry>,
): ReadonlyArray<ProviderInstanceEntry> {
  const byKind = new Map<ProviderDriverKind, ProviderInstanceEntry[]>();
  for (const entry of entries) {
    const bucket = byKind.get(entry.driverKind);
    if (bucket) {
      bucket.push(entry);
    } else {
      byKind.set(entry.driverKind, [entry]);
    }
  }
  const sorted: ProviderInstanceEntry[] = [];
  for (const bucket of byKind.values()) {
    const defaults = bucket.filter((entry) => entry.isDefault);
    const customs = bucket.filter((entry) => !entry.isDefault);
    sorted.push(...defaults, ...customs);
  }
  return sorted;
}

export function resolveProviderInstanceEntriesForSettings(
  settings: UnifiedSettings,
  providers: ReadonlyArray<ServerProvider>,
): ReadonlyArray<ProviderInstanceEntry> {
  return sortProviderInstanceEntries(deriveProviderInstanceEntriesForSettings(settings, providers));
}
