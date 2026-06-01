import { ProviderInstanceId } from "@multi/contracts";
import { it, assert, vi } from "@effect/vitest";
import { assertFailure } from "@effect/vitest/utils";

import { Effect, Layer, Stream } from "effect";

import { ClaudeAdapter } from "../../src/provider/ClaudeAdapter.service.ts";
import { CodexAdapter } from "../../src/provider/CodexAdapter.service.ts";
import { CursorAdapter } from "../../src/provider/CursorAdapter.service.ts";
import { ProviderAdapterRegistry } from "../../src/provider/ProviderAdapterRegistry.service.ts";
import { makeProviderAdapterRegistryLive } from "../../src/provider/ProviderAdapterRegistry.ts";
import { ProviderUnsupportedError, type ProviderAdapterError } from "../../src/provider/Errors.ts";
import type { ProviderAdapterShape } from "../../src/provider/ProviderAdapter.service.ts";
import { ServerSettingsService } from "../../src/server-settings.ts";
import * as NodeServices from "@effect/platform-node/NodeServices";

const fakeCodexAdapter: ProviderAdapterShape<ProviderAdapterError> = {
  provider: "codex",
  capabilities: { sessionModelSwitch: "in-session" },
  startSession: vi.fn(),
  sendTurn: vi.fn(),
  interruptTurn: vi.fn(),
  respondToRequest: vi.fn(),
  respondToUserInput: vi.fn(),
  stopSession: vi.fn(),
  listSessions: vi.fn(),
  hasSession: vi.fn(),
  readThread: vi.fn(),
  rollbackThread: vi.fn(),
  stopAll: vi.fn(),
  streamEvents: Stream.empty,
};

const fakeClaudeAdapter: ProviderAdapterShape<ProviderAdapterError> = {
  provider: "claudeAgent",
  capabilities: { sessionModelSwitch: "in-session" },
  startSession: vi.fn(),
  sendTurn: vi.fn(),
  interruptTurn: vi.fn(),
  respondToRequest: vi.fn(),
  respondToUserInput: vi.fn(),
  stopSession: vi.fn(),
  listSessions: vi.fn(),
  hasSession: vi.fn(),
  readThread: vi.fn(),
  rollbackThread: vi.fn(),
  stopAll: vi.fn(),
  streamEvents: Stream.empty,
};

const fakeCursorAdapter: ProviderAdapterShape<ProviderAdapterError> = {
  provider: "cursor",
  capabilities: { sessionModelSwitch: "in-session" },
  startSession: vi.fn(),
  sendTurn: vi.fn(),
  interruptTurn: vi.fn(),
  respondToRequest: vi.fn(),
  respondToUserInput: vi.fn(),
  stopSession: vi.fn(),
  listSessions: vi.fn(),
  hasSession: vi.fn(),
  readThread: vi.fn(),
  rollbackThread: vi.fn(),
  stopAll: vi.fn(),
  streamEvents: Stream.empty,
};

const layer = it.layer(
  Layer.mergeAll(
    makeProviderAdapterRegistryLive({
      adapters: [fakeCodexAdapter, fakeClaudeAdapter, fakeCursorAdapter],
    }).pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(CodexAdapter, fakeCodexAdapter),
          Layer.succeed(ClaudeAdapter, fakeClaudeAdapter),
          Layer.succeed(CursorAdapter, fakeCursorAdapter),
          ServerSettingsService.layerTest(),
        ),
      ),
    ),
    NodeServices.layer,
  ),
);

layer("ProviderAdapterRegistryLive", (it) => {
  it.effect("resolves a registered provider adapter", () =>
    Effect.gen(function* () {
      const registry = yield* ProviderAdapterRegistry;
      const codex = yield* registry.getByInstance(ProviderInstanceId.make("codex"));
      const claude = yield* registry.getByInstance(ProviderInstanceId.make("claudeAgent"));
      const cursor = yield* registry.getByInstance(ProviderInstanceId.make("cursor"));
      assert.equal(codex, fakeCodexAdapter);
      assert.equal(claude, fakeClaudeAdapter);
      assert.equal(cursor, fakeCursorAdapter);

      const instances = yield* registry.listInstances();
      assert.deepEqual(instances, ["codex", "claudeAgent", "cursor"]);
    }),
  );

  it.effect("fails with ProviderUnsupportedError for unknown providers", () =>
    Effect.gen(function* () {
      const registry = yield* ProviderAdapterRegistry;
      const adapter = yield* registry
        .getByInstance(ProviderInstanceId.make("unknown"))
        .pipe(Effect.result);
      assertFailure(adapter, new ProviderUnsupportedError({ provider: "unknown" }));
    }),
  );
});

const customInstanceLayer = it.layer(
  makeProviderAdapterRegistryLive({
    adapters: [fakeCodexAdapter, fakeClaudeAdapter, fakeCursorAdapter],
  }).pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(CodexAdapter, fakeCodexAdapter),
        Layer.succeed(ClaudeAdapter, fakeClaudeAdapter),
        Layer.succeed(CursorAdapter, fakeCursorAdapter),
        ServerSettingsService.layerTest({
          providerInstances: {
            codex_personal: {
              driver: "codex",
              displayName: "Personal Codex",
            },
          },
        }),
      ),
    ),
    Layer.provideMerge(NodeServices.layer),
  ),
);

customInstanceLayer("ProviderAdapterRegistryLive custom instances", (it) => {
  it.effect("resolves custom instances to the provider driver adapter", () =>
    Effect.gen(function* () {
      const registry = yield* ProviderAdapterRegistry;
      const defaultCodex = yield* registry.getByInstance(ProviderInstanceId.make("codex"));
      const personalCodex = yield* registry.getByInstance(
        ProviderInstanceId.make("codex_personal"),
      );

      assert.equal(defaultCodex, personalCodex);

      const personalInfo = yield* registry.getInstanceInfo(
        ProviderInstanceId.make("codex_personal"),
      );
      assert.equal(personalInfo.driverKind, "codex");
      assert.equal(personalInfo.displayName, "Personal Codex");
    }),
  );
});
