import { ProviderDriverKind, type ServerProvider } from "@multi/contracts";
import type { Stream } from "effect";
import type { ProviderAdapterError } from "./Errors.ts";
import type { ProviderAdapterShape } from "./ProviderAdapter.service.ts";
import type { ServerProviderShape } from "./ServerProvider.service.ts";

export type ProviderSnapshotSource = {
  readonly provider: ProviderDriverKind;
  readonly getSnapshot: ServerProviderShape["getSnapshot"];
  readonly refresh: ServerProviderShape["refresh"];
  readonly streamChanges: Stream.Stream<ServerProvider>;
};

const CODEX_PROVIDER = ProviderDriverKind.make("codex");
const CLAUDE_PROVIDER = ProviderDriverKind.make("claudeAgent");
const CURSOR_PROVIDER = ProviderDriverKind.make("cursor");

type BuiltInProviderServiceMap = {
  readonly codex: ServerProviderShape;
  readonly claudeAgent: ServerProviderShape;
  readonly cursor: ServerProviderShape;
};
type BuiltInAdapterMap = {
  readonly codex: ProviderAdapterShape<ProviderAdapterError>;
  readonly claudeAgent: ProviderAdapterShape<ProviderAdapterError>;
  readonly cursor: ProviderAdapterShape<ProviderAdapterError>;
};

export const BUILT_IN_PROVIDER_ORDER = [
  CODEX_PROVIDER,
  CLAUDE_PROVIDER,
  CURSOR_PROVIDER,
] as const satisfies ReadonlyArray<ProviderDriverKind>;

export function createBuiltInProviderSources(
  services: BuiltInProviderServiceMap,
): ReadonlyArray<ProviderSnapshotSource> {
  return [
    {
      provider: CODEX_PROVIDER,
      getSnapshot: services.codex.getSnapshot,
      refresh: services.codex.refresh,
      streamChanges: services.codex.streamChanges,
    },
    {
      provider: CLAUDE_PROVIDER,
      getSnapshot: services.claudeAgent.getSnapshot,
      refresh: services.claudeAgent.refresh,
      streamChanges: services.claudeAgent.streamChanges,
    },
    {
      provider: CURSOR_PROVIDER,
      getSnapshot: services.cursor.getSnapshot,
      refresh: services.cursor.refresh,
      streamChanges: services.cursor.streamChanges,
    },
  ];
}

export function createBuiltInAdapterList(
  adapters: BuiltInAdapterMap,
): ReadonlyArray<ProviderAdapterShape<ProviderAdapterError>> {
  return [
    adapters.codex,
    adapters.claudeAgent,
    adapters.cursor,
  ];
}
