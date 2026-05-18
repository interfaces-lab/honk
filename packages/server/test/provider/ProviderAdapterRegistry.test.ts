import { ProviderInstanceId } from "@multi/contracts";
import { it, assert, vi } from "@effect/vitest";
import { assertFailure } from "@effect/vitest/utils";

import { Effect, Layer, Stream } from "effect";

import { ClaudeAdapter } from "../../src/provider/ClaudeAdapter.service.ts";
import type { ClaudeAdapterShape } from "../../src/provider/ClaudeAdapter.service.ts";
import { CodexAdapter } from "../../src/provider/CodexAdapter.service.ts";
import type { CodexAdapterShape } from "../../src/provider/CodexAdapter.service.ts";
import { AmpAdapter } from "../../src/provider/AmpAdapter.service.ts";
import type { AmpAdapterShape } from "../../src/provider/AmpAdapter.service.ts";
import { CursorAdapter } from "../../src/provider/CursorAdapter.service.ts";
import type { CursorAdapterShape } from "../../src/provider/CursorAdapter.service.ts";
import { OpenCodeAdapter } from "../../src/provider/OpenCodeAdapter.service.ts";
import type { OpenCodeAdapterShape } from "../../src/provider/OpenCodeAdapter.service.ts";
import { ProviderAdapterRegistry } from "../../src/provider/ProviderAdapterRegistry.service.ts";
import { ProviderAdapterRegistryLive } from "../../src/provider/ProviderAdapterRegistry.ts";
import { ProviderUnsupportedError } from "../../src/provider/Errors.ts";
import { ServerSettingsService } from "../../src/server-settings.ts";
import * as NodeServices from "@effect/platform-node/NodeServices";

const fakeCodexAdapter: CodexAdapterShape = {
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

const fakeClaudeAdapter: ClaudeAdapterShape = {
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

const fakeOpenCodeAdapter: OpenCodeAdapterShape = {
  provider: "opencode",
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

const fakeAmpAdapter: AmpAdapterShape = {
  provider: "amp",
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

const fakeCursorAdapter: CursorAdapterShape = {
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
    Layer.provide(
      ProviderAdapterRegistryLive,
      Layer.mergeAll(
        Layer.succeed(CodexAdapter, fakeCodexAdapter),
        Layer.succeed(ClaudeAdapter, fakeClaudeAdapter),
        Layer.succeed(AmpAdapter, fakeAmpAdapter),
        Layer.succeed(OpenCodeAdapter, fakeOpenCodeAdapter),
        Layer.succeed(CursorAdapter, fakeCursorAdapter),
        ServerSettingsService.layerTest(),
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
      const amp = yield* registry.getByInstance(ProviderInstanceId.make("amp"));
      const openCode = yield* registry.getByInstance(ProviderInstanceId.make("opencode"));
      const cursor = yield* registry.getByInstance(ProviderInstanceId.make("cursor"));
      assert.equal(codex, fakeCodexAdapter);
      assert.equal(claude, fakeClaudeAdapter);
      assert.equal(amp, fakeAmpAdapter);
      assert.equal(openCode, fakeOpenCodeAdapter);
      assert.equal(cursor, fakeCursorAdapter);

      const instances = yield* registry.listInstances();
      assert.deepEqual(instances, ["codex", "claudeAgent", "amp", "opencode", "cursor"]);
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
