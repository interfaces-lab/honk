/**
 * ProviderServiceLive - Cross-provider orchestration layer.
 *
 * Routes validated transport/API calls to provider adapters through
 * `ProviderAdapterRegistry` and `ProviderSessionDirectory`, and exposes a
 * unified provider event stream for subscribers.
 *
 * It does not implement provider protocol details (adapter concern).
 *
 * @module ProviderServiceLive
 */
import {
  ModelSelection,
  NonNegativeInt,
  ThreadId,
  defaultInstanceIdForDriver,
  ProviderInterruptTurnInput,
  ProviderThreadReadInput,
  ProviderRespondToRequestInput,
  ProviderRespondToUserInputInput,
  ProviderSendTurnInput,
  ProviderSessionStartInput,
  ProviderStopSessionInput,
  ProviderDriverKind,
  ProviderInstanceId,
  DEFAULT_PROJECTLESS_CWD,
  type ProviderRuntimeEvent,
  type ProviderSession,
} from "@multi/contracts";
import { Effect, Layer, Option, PubSub, Ref, Schema, SchemaIssue, Stream } from "effect";

import {
  increment,
  providerMetricAttributes,
  providerRuntimeEventsTotal,
  providerSessionsTotal,
  providerTurnDuration,
  providerTurnsTotal,
  providerTurnMetricAttributes,
  withMetrics,
} from "../observability/Metrics.ts";
import { type ProviderAdapterError, ProviderValidationError } from "./Errors.ts";
import type { ProviderAdapterShape } from "./ProviderAdapter.service.ts";
import { ProviderAdapterRegistry } from "./ProviderAdapterRegistry.service.ts";
import { ProviderService, type ProviderServiceShape } from "./ProviderService.service.ts";
import {
  ProviderSessionDirectory,
  type ProviderRuntimeBinding,
} from "./ProviderSessionDirectory.service.ts";
import { type EventNdjsonLogger, makeEventNdjsonLogger } from "./EventNdjsonLogger.ts";
import { AnalyticsService } from "../telemetry/AnalyticsService.service.ts";
import { ServerConfig } from "../config.ts";
import { coerceAccessibleProjectCwd } from "../project/AccessibleProjectCwd.ts";

export interface ProviderServiceLiveOptions {
  readonly canonicalEventLogPath?: string;
  readonly canonicalEventLogger?: EventNdjsonLogger;
}

const ProviderRollbackConversationInput = Schema.Struct({
  threadId: ThreadId,
  numTurns: NonNegativeInt,
});
const decodeProviderInterruptTurnInput = Schema.decodeUnknownEffect(ProviderInterruptTurnInput);
const decodeProviderRollbackConversationInput = Schema.decodeUnknownEffect(
  ProviderRollbackConversationInput,
);
const decodeProviderThreadReadInput = Schema.decodeUnknownEffect(ProviderThreadReadInput);
const decodeProviderRespondToRequestInput = Schema.decodeUnknownEffect(
  ProviderRespondToRequestInput,
);
const decodeProviderRespondToUserInputInput = Schema.decodeUnknownEffect(
  ProviderRespondToUserInputInput,
);
const decodeProviderSendTurnInput = Schema.decodeUnknownEffect(ProviderSendTurnInput);
const decodeProviderSessionStartInput = Schema.decodeUnknownEffect(ProviderSessionStartInput);
const decodeProviderStopSessionInput = Schema.decodeUnknownEffect(ProviderStopSessionInput);
const isModelSelection = Schema.is(ModelSelection);

function toValidationError(
  operation: string,
  issue: string,
  cause?: unknown,
): ProviderValidationError {
  return new ProviderValidationError({
    operation,
    issue,
    ...(cause !== undefined ? { cause } : {}),
  });
}

const decodeInputOrValidationError = <A>(input: {
  readonly operation: string;
  readonly decode: (payload: unknown) => Effect.Effect<A, Schema.SchemaError>;
  readonly payload: unknown;
}) =>
  input.decode(input.payload).pipe(
    Effect.mapError(
      (schemaError) =>
        new ProviderValidationError({
          operation: input.operation,
          issue: SchemaIssue.makeFormatterDefault()(schemaError.issue),
          cause: schemaError,
        }),
    ),
  );

function toRuntimeStatus(session: ProviderSession): "starting" | "running" | "stopped" | "error" {
  switch (session.status) {
    case "connecting":
      return "starting";
    case "error":
      return "error";
    case "closed":
      return "stopped";
    case "ready":
    case "running":
    default:
      return "running";
  }
}

function toRuntimePayloadFromSession(
  session: ProviderSession,
  extra?: {
    readonly modelSelection?: unknown;
    readonly lastRuntimeEvent?: string;
    readonly lastRuntimeEventAt?: string;
  },
): Record<string, unknown> {
  return {
    cwd: session.cwd ?? null,
    model: session.model ?? null,
    activeTurnId: session.activeTurnId ?? null,
    lastError: session.lastError ?? null,
    ...(extra?.modelSelection !== undefined ? { modelSelection: extra.modelSelection } : {}),
    ...(extra?.lastRuntimeEvent !== undefined ? { lastRuntimeEvent: extra.lastRuntimeEvent } : {}),
    ...(extra?.lastRuntimeEventAt !== undefined
      ? { lastRuntimeEventAt: extra.lastRuntimeEventAt }
      : {}),
  };
}

function readPersistedModelSelection(
  runtimePayload: ProviderRuntimeBinding["runtimePayload"],
): ModelSelection | undefined {
  if (!runtimePayload || typeof runtimePayload !== "object" || Array.isArray(runtimePayload)) {
    return undefined;
  }
  const raw = "modelSelection" in runtimePayload ? runtimePayload.modelSelection : undefined;
  return isModelSelection(raw) ? raw : undefined;
}

function readPersistedCwd(
  runtimePayload: ProviderRuntimeBinding["runtimePayload"],
): string | undefined {
  if (!runtimePayload || typeof runtimePayload !== "object" || Array.isArray(runtimePayload)) {
    return undefined;
  }
  const rawCwd = "cwd" in runtimePayload ? runtimePayload.cwd : undefined;
  if (typeof rawCwd !== "string") return undefined;
  const trimmed = rawCwd.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

const makeProviderService = Effect.fn("makeProviderService")(function* (
  options?: ProviderServiceLiveOptions,
) {
  const analytics = yield* Effect.service(AnalyticsService);
  const canonicalEventLogger =
    options?.canonicalEventLogger ??
    (options?.canonicalEventLogPath !== undefined
      ? yield* makeEventNdjsonLogger(options.canonicalEventLogPath, {
          stream: "canonical",
        })
      : undefined);

  const registry = yield* ProviderAdapterRegistry;
  const directory = yield* ProviderSessionDirectory;
  const runtimeEventPubSub = yield* PubSub.unbounded<ProviderRuntimeEvent>();
  const serverConfigOption = yield* Effect.serviceOption(ServerConfig);
  const providerCwdFallbacks = [
    {
      label: "server.cwd",
      cwd: Option.match(serverConfigOption, {
        onNone: () => DEFAULT_PROJECTLESS_CWD,
        onSome: (serverConfig) => serverConfig.cwd,
      }),
    },
  ] as const;

  const coerceProviderCwd = (input: {
    readonly operation: string;
    readonly cwd: string | undefined;
    readonly threadId: ThreadId;
  }) =>
    coerceAccessibleProjectCwd({
      operation: input.operation,
      candidates: input.cwd === undefined ? [] : [{ label: "provider.cwd", cwd: input.cwd }],
      fallbackCwds: providerCwdFallbacks,
      threadId: input.threadId,
    });

  const publishRuntimeEvent = (event: ProviderRuntimeEvent): Effect.Effect<void> =>
    Effect.succeed(event).pipe(
      Effect.tap((canonicalEvent) =>
        canonicalEventLogger
          ? canonicalEventLogger.write(canonicalEvent, canonicalEvent.threadId)
          : Effect.void,
      ),
      Effect.flatMap((canonicalEvent) => PubSub.publish(runtimeEventPubSub, canonicalEvent)),
      Effect.asVoid,
    );

  const upsertSessionBinding = (
    session: ProviderSession,
    threadId: ThreadId,
    extra?: {
      readonly modelSelection?: unknown;
      readonly lastRuntimeEvent?: string;
      readonly lastRuntimeEventAt?: string;
    },
  ) =>
    directory.upsert({
      threadId,
      provider: session.provider,
      providerInstanceId: session.providerInstanceId,
      runtimeMode: session.runtimeMode,
      status: toRuntimeStatus(session),
      ...(session.resumeCursor !== undefined ? { resumeCursor: session.resumeCursor } : {}),
      runtimePayload: toRuntimePayloadFromSession(session, extra),
    });

  const subscribedAdapters = yield* Ref.make(
    new Map<ProviderInstanceId, ProviderAdapterShape<ProviderAdapterError>>(),
  );

  const getAdapterEntries = Ref.get(subscribedAdapters).pipe(
    Effect.map((map) => Array.from(map.entries())),
  );

  const processRuntimeEvent = (
    source: {
      readonly instanceId: ProviderInstanceId;
      readonly provider: ProviderSession["provider"];
    },
    event: ProviderRuntimeEvent,
  ): Effect.Effect<void, ProviderValidationError> => {
    if (event.provider !== source.provider) {
      return Effect.fail(
        toValidationError(
          "ProviderService.streamEvents",
          `Provider instance '${source.instanceId}' is backed by '${source.provider}' but emitted '${event.provider}'.`,
        ),
      );
    }
    const canonicalEvent = { ...event, providerInstanceId: source.instanceId };
    return increment(providerRuntimeEventsTotal, {
      provider: canonicalEvent.provider,
      eventType: canonicalEvent.type,
    }).pipe(Effect.andThen(publishRuntimeEvent(canonicalEvent)));
  };

  const reconcileInstanceSubscriptions = Effect.gen(function* () {
    const previous = yield* Ref.get(subscribedAdapters);
    const currentIds = yield* registry.listInstances();
    const next = new Map<ProviderInstanceId, ProviderAdapterShape<ProviderAdapterError>>();
    for (const id of currentIds) {
      const adapterOption = yield* registry
        .getByInstance(id)
        .pipe(Effect.tapError(Effect.logWarning), Effect.option);
      if (Option.isNone(adapterOption)) continue;
      const adapter = adapterOption.value;
      next.set(id, adapter);
      if (previous.get(id) !== adapter) {
        yield* Stream.runForEach(adapter.streamEvents, (event) =>
          processRuntimeEvent(
            { instanceId: id, provider: ProviderDriverKind.make(adapter.provider) },
            event,
          ),
        ).pipe(Effect.forkScoped);
      }
    }
    yield* Ref.set(subscribedAdapters, next);
  });

  const instanceChanges = yield* registry.subscribeChanges;
  yield* reconcileInstanceSubscriptions;
  yield* Stream.runForEach(
    Stream.fromSubscription(instanceChanges),
    () => reconcileInstanceSubscriptions,
  ).pipe(Effect.forkScoped);

  const recoverSessionForThread = Effect.fn("recoverSessionForThread")(function* (input: {
    readonly binding: ProviderRuntimeBinding;
    readonly operation: string;
  }) {
    yield* Effect.annotateCurrentSpan({
      "provider.operation": "recover-session",
      "provider.kind": input.binding.provider,
      "provider.instance_id": input.binding.providerInstanceId ?? input.binding.provider,
      "provider.thread_id": input.binding.threadId,
    });
    return yield* Effect.gen(function* () {
      const bindingInstanceId = ProviderInstanceId.make(
        input.binding.providerInstanceId ?? input.binding.provider,
      );
      const adapter = yield* registry.getByInstance(bindingInstanceId);
      const hasResumeCursor =
        input.binding.resumeCursor !== null && input.binding.resumeCursor !== undefined;
      const hasActiveSession = yield* adapter.hasSession(input.binding.threadId);
      if (hasActiveSession) {
        const activeSessions = yield* adapter.listSessions();
        const existing = activeSessions.find(
          (session) => session.threadId === input.binding.threadId,
        );
        if (existing) {
          yield* upsertSessionBinding(
            { ...existing, providerInstanceId: bindingInstanceId },
            input.binding.threadId,
          );
          yield* analytics.record("provider.session.recovered", {
            provider: existing.provider,
            strategy: "adopt-existing",
            hasResumeCursor: existing.resumeCursor !== undefined,
          });
          return { adapter, session: existing } as const;
        }
      }

      if (!hasResumeCursor) {
        return yield* toValidationError(
          input.operation,
          `Cannot recover thread '${input.binding.threadId}' because no provider resume state is persisted.`,
        );
      }

      const persistedCwd = readPersistedCwd(input.binding.runtimePayload);
      const persistedModelSelection = readPersistedModelSelection(input.binding.runtimePayload);
      const effectiveCwd = yield* coerceProviderCwd({
        operation: "ProviderService.recoverSessionForThread",
        cwd: persistedCwd,
        threadId: input.binding.threadId,
      });

      const resumed = yield* adapter.startSession({
        threadId: input.binding.threadId,
        provider: input.binding.provider,
        providerInstanceId: bindingInstanceId,
        ...(effectiveCwd ? { cwd: effectiveCwd } : {}),
        ...(persistedModelSelection ? { modelSelection: persistedModelSelection } : {}),
        ...(hasResumeCursor ? { resumeCursor: input.binding.resumeCursor } : {}),
        runtimeMode: input.binding.runtimeMode ?? "full-access",
      });
      if (resumed.provider !== adapter.provider) {
        return yield* toValidationError(
          input.operation,
          `Adapter/provider mismatch while recovering thread '${input.binding.threadId}'. Expected '${adapter.provider}', received '${resumed.provider}'.`,
        );
      }

      const resumedWithInstance = { ...resumed, providerInstanceId: bindingInstanceId };
      yield* upsertSessionBinding(resumedWithInstance, input.binding.threadId);
      yield* analytics.record("provider.session.recovered", {
        provider: resumed.provider,
        strategy: "resume-thread",
        hasResumeCursor: resumed.resumeCursor !== undefined,
      });
      return { adapter, session: resumedWithInstance } as const;
    }).pipe(
      withMetrics({
        counter: providerSessionsTotal,
        attributes: providerMetricAttributes(input.binding.provider, {
          operation: "recover",
        }),
      }),
    );
  });

  const resolveRoutableSession = Effect.fn("resolveRoutableSession")(function* (input: {
    readonly threadId: ThreadId;
    readonly operation: string;
    readonly allowRecovery: boolean;
  }) {
    const bindingOption = yield* directory.getBinding(input.threadId);
    const binding = Option.getOrUndefined(bindingOption);
    if (!binding) {
      return yield* toValidationError(
        input.operation,
        `Cannot route thread '${input.threadId}' because no persisted provider binding exists.`,
      );
    }
    const instanceId = ProviderInstanceId.make(binding.providerInstanceId ?? binding.provider);
    const adapter = yield* registry.getByInstance(instanceId);

    const hasRequestedSession = yield* adapter.hasSession(input.threadId);
    if (hasRequestedSession) {
      return { adapter, instanceId, threadId: input.threadId, isActive: true } as const;
    }

    if (!input.allowRecovery) {
      return { adapter, instanceId, threadId: input.threadId, isActive: false } as const;
    }

    const recovered = yield* recoverSessionForThread({ binding, operation: input.operation });
    return {
      adapter: recovered.adapter,
      instanceId,
      threadId: input.threadId,
      isActive: true,
    } as const;
  });

  const stopStaleSessionsForThread = Effect.fn("stopStaleSessionsForThread")(function* (input: {
    readonly threadId: ThreadId;
    readonly currentInstanceId: ProviderInstanceId;
  }) {
    const adapterEntries = yield* getAdapterEntries;
    yield* Effect.forEach(
      adapterEntries,
      ([instanceId, adapter]) =>
        instanceId === input.currentInstanceId
          ? Effect.void
          : Effect.gen(function* () {
              const hasSession = yield* adapter.hasSession(input.threadId);
              if (!hasSession) {
                return;
              }

              yield* adapter.stopSession(input.threadId).pipe(
                Effect.tap(() =>
                  analytics.record("provider.session.stopped", {
                    provider: adapter.provider,
                  }),
                ),
                Effect.catchCause((cause) =>
                  Effect.logWarning("provider.session.stop-stale-failed", {
                    threadId: input.threadId,
                    provider: adapter.provider,
                    cause,
                  }),
                ),
              );
            }),
      { discard: true },
    );
  });

  const startSession: ProviderServiceShape["startSession"] = Effect.fn("startSession")(
    function* (threadId, rawInput) {
      const parsed = yield* decodeInputOrValidationError({
        operation: "ProviderService.startSession",
        decode: decodeProviderSessionStartInput,
        payload: rawInput,
      });

      const input = {
        ...parsed,
        threadId,
        provider: parsed.provider ?? "codex",
      };
      yield* Effect.annotateCurrentSpan({
        "provider.operation": "start-session",
        "provider.kind": input.provider,
        "provider.thread_id": threadId,
        "provider.runtime_mode": input.runtimeMode,
      });
      return yield* Effect.gen(function* () {
        const persistedBinding = Option.getOrUndefined(yield* directory.getBinding(threadId));
        const effectiveResumeCursor =
          input.discardResumeCursor === true
            ? undefined
            : (input.resumeCursor ??
              (persistedBinding?.providerInstanceId === input.providerInstanceId
                ? persistedBinding.resumeCursor
                : undefined));
        const rawEffectiveCwd =
          input.cwd ??
          (persistedBinding?.providerInstanceId === input.providerInstanceId
            ? readPersistedCwd(persistedBinding.runtimePayload)
            : undefined);
        const effectiveCwd = yield* coerceProviderCwd({
          operation: "ProviderService.startSession",
          cwd: rawEffectiveCwd,
          threadId,
        });
        yield* Effect.annotateCurrentSpan({
          "provider.resume_cursor.source":
            input.resumeCursor !== undefined
              ? "request"
              : input.discardResumeCursor === true
                ? "discarded"
              : effectiveResumeCursor !== undefined &&
                  persistedBinding?.providerInstanceId === input.providerInstanceId
                ? "persisted"
                : "none",
          "provider.resume_cursor.present": effectiveResumeCursor !== undefined,
          "provider.cwd.source":
            input.cwd !== undefined
              ? "request"
              : rawEffectiveCwd !== undefined &&
                  persistedBinding?.providerInstanceId === input.providerInstanceId
                ? "persisted"
                : "none",
          "provider.cwd.effective": effectiveCwd ?? "",
        });
        const instanceInfo = yield* registry.getInstanceInfo(input.providerInstanceId);
        if (!instanceInfo.enabled) {
          return yield* toValidationError(
            "ProviderService.startSession",
            `Provider instance '${input.providerInstanceId}' is disabled in Multi settings.`,
          );
        }
        const adapter = yield* registry.getByInstance(input.providerInstanceId);
        const session = yield* adapter.startSession({
          ...input,
          provider: instanceInfo.driverKind,
          ...(effectiveCwd !== undefined ? { cwd: effectiveCwd } : {}),
          ...(effectiveResumeCursor !== undefined ? { resumeCursor: effectiveResumeCursor } : {}),
        });

        if (session.provider !== adapter.provider) {
          return yield* toValidationError(
            "ProviderService.startSession",
            `Adapter/provider mismatch: requested '${adapter.provider}', received '${session.provider}'.`,
          );
        }

        yield* stopStaleSessionsForThread({
          threadId,
          currentInstanceId: input.providerInstanceId,
        });
        const sessionWithInstance = {
          ...session,
          providerInstanceId: input.providerInstanceId,
        };
        yield* upsertSessionBinding(sessionWithInstance, threadId, {
          modelSelection: input.modelSelection,
        });
        yield* analytics.record("provider.session.started", {
          provider: sessionWithInstance.provider,
          runtimeMode: input.runtimeMode,
          hasResumeCursor: sessionWithInstance.resumeCursor !== undefined,
          hasCwd: typeof effectiveCwd === "string" && effectiveCwd.trim().length > 0,
          hasModel:
            typeof input.modelSelection?.model === "string" &&
            input.modelSelection.model.trim().length > 0,
        });

        return sessionWithInstance;
      }).pipe(
        withMetrics({
          counter: providerSessionsTotal,
          attributes: providerMetricAttributes(input.provider, {
            operation: "start",
          }),
        }),
      );
    },
  );

  const sendTurn: ProviderServiceShape["sendTurn"] = Effect.fn("sendTurn")(function* (rawInput) {
    const parsed = yield* decodeInputOrValidationError({
      operation: "ProviderService.sendTurn",
      decode: decodeProviderSendTurnInput,
      payload: rawInput,
    });

    const input = {
      ...parsed,
      attachments: parsed.attachments ?? [],
    };
    if (!input.input && input.attachments.length === 0) {
      return yield* toValidationError(
        "ProviderService.sendTurn",
        "Either input text or at least one attachment is required",
      );
    }
    yield* Effect.annotateCurrentSpan({
      "provider.operation": "send-turn",
      "provider.thread_id": input.threadId,
      "provider.interaction_mode": input.interactionMode,
      "provider.attachment_count": input.attachments.length,
    });
    let metricProvider = "unknown";
    let metricModel = input.modelSelection?.model;
    return yield* Effect.gen(function* () {
      const routed = yield* resolveRoutableSession({
        threadId: input.threadId,
        operation: "ProviderService.sendTurn",
        allowRecovery: true,
      });
      metricProvider = routed.adapter.provider;
      metricModel = input.modelSelection?.model;
      yield* Effect.annotateCurrentSpan({
        "provider.kind": routed.adapter.provider,
        ...(input.modelSelection?.model ? { "provider.model": input.modelSelection.model } : {}),
      });
      const turn = yield* routed.adapter.sendTurn(input);
      yield* directory.upsert({
        threadId: input.threadId,
        provider: ProviderDriverKind.make(routed.adapter.provider),
        providerInstanceId: routed.instanceId,
        status: "running",
        ...(turn.resumeCursor !== undefined ? { resumeCursor: turn.resumeCursor } : {}),
        runtimePayload: {
          ...(input.modelSelection !== undefined ? { modelSelection: input.modelSelection } : {}),
          activeTurnId: turn.turnId,
          lastRuntimeEvent: "provider.sendTurn",
          lastRuntimeEventAt: new Date().toISOString(),
        },
      });
      yield* analytics.record("provider.turn.sent", {
        provider: ProviderDriverKind.make(routed.adapter.provider),
        model: input.modelSelection?.model,
        interactionMode: input.interactionMode,
        attachmentCount: input.attachments.length,
        hasInput: typeof input.input === "string" && input.input.trim().length > 0,
      });
      return turn;
    }).pipe(
      withMetrics({
        counter: providerTurnsTotal,
        timer: providerTurnDuration,
        attributes: () =>
          providerTurnMetricAttributes({
            provider: metricProvider,
            model: metricModel,
            extra: {
              operation: "send",
            },
          }),
      }),
    );
  });

  const interruptTurn: ProviderServiceShape["interruptTurn"] = Effect.fn("interruptTurn")(
    function* (rawInput) {
      const input = yield* decodeInputOrValidationError({
        operation: "ProviderService.interruptTurn",
        decode: decodeProviderInterruptTurnInput,
        payload: rawInput,
      });
      let metricProvider = "unknown";
      return yield* Effect.gen(function* () {
        const routed = yield* resolveRoutableSession({
          threadId: input.threadId,
          operation: "ProviderService.interruptTurn",
          allowRecovery: false,
        });
        metricProvider = routed.adapter.provider;
        yield* Effect.annotateCurrentSpan({
          "provider.operation": "interrupt-turn",
          "provider.kind": routed.adapter.provider,
          "provider.thread_id": input.threadId,
          "provider.turn_id": input.turnId,
        });
        if (!routed.isActive) {
          return;
        }
        yield* routed.adapter.interruptTurn(routed.threadId, input.turnId);
        yield* analytics.record("provider.turn.interrupted", {
          provider: routed.adapter.provider,
        });
      }).pipe(
        withMetrics({
          counter: providerTurnsTotal,
          outcomeAttributes: () =>
            providerMetricAttributes(metricProvider, {
              operation: "interrupt",
            }),
        }),
      );
    },
  );

  const respondToRequest: ProviderServiceShape["respondToRequest"] = Effect.fn("respondToRequest")(
    function* (rawInput) {
      const input = yield* decodeInputOrValidationError({
        operation: "ProviderService.respondToRequest",
        decode: decodeProviderRespondToRequestInput,
        payload: rawInput,
      });
      let metricProvider = "unknown";
      return yield* Effect.gen(function* () {
        const routed = yield* resolveRoutableSession({
          threadId: input.threadId,
          operation: "ProviderService.respondToRequest",
          allowRecovery: true,
        });
        metricProvider = routed.adapter.provider;
        yield* Effect.annotateCurrentSpan({
          "provider.operation": "respond-to-request",
          "provider.kind": routed.adapter.provider,
          "provider.thread_id": input.threadId,
          "provider.request_id": input.requestId,
        });
        yield* routed.adapter.respondToRequest(routed.threadId, input.requestId, input.decision);
        yield* analytics.record("provider.request.responded", {
          provider: routed.adapter.provider,
          decision: input.decision,
        });
      }).pipe(
        withMetrics({
          counter: providerTurnsTotal,
          outcomeAttributes: () =>
            providerMetricAttributes(metricProvider, {
              operation: "approval-response",
            }),
        }),
      );
    },
  );

  const respondToUserInput: ProviderServiceShape["respondToUserInput"] = Effect.fn(
    "respondToUserInput",
  )(function* (rawInput) {
    const input = yield* decodeInputOrValidationError({
      operation: "ProviderService.respondToUserInput",
      decode: decodeProviderRespondToUserInputInput,
      payload: rawInput,
    });
    let metricProvider = "unknown";
    return yield* Effect.gen(function* () {
      const routed = yield* resolveRoutableSession({
        threadId: input.threadId,
        operation: "ProviderService.respondToUserInput",
        allowRecovery: true,
      });
      metricProvider = routed.adapter.provider;
      yield* Effect.annotateCurrentSpan({
        "provider.operation": "respond-to-user-input",
        "provider.kind": routed.adapter.provider,
        "provider.thread_id": input.threadId,
        "provider.request_id": input.requestId,
      });
      yield* routed.adapter.respondToUserInput(routed.threadId, input.requestId, input.answers);
    }).pipe(
      withMetrics({
        counter: providerTurnsTotal,
        outcomeAttributes: () =>
          providerMetricAttributes(metricProvider, {
            operation: "user-input-response",
          }),
      }),
    );
  });

  const stopSession: ProviderServiceShape["stopSession"] = Effect.fn("stopSession")(
    function* (rawInput) {
      const input = yield* decodeInputOrValidationError({
        operation: "ProviderService.stopSession",
        decode: decodeProviderStopSessionInput,
        payload: rawInput,
      });
      let metricProvider = "unknown";
      return yield* Effect.gen(function* () {
        const routed = yield* resolveRoutableSession({
          threadId: input.threadId,
          operation: "ProviderService.stopSession",
          allowRecovery: false,
        });
        metricProvider = routed.adapter.provider;
        yield* Effect.annotateCurrentSpan({
          "provider.operation": "stop-session",
          "provider.kind": routed.adapter.provider,
          "provider.thread_id": input.threadId,
        });
        const persistStopped = directory.upsert({
          threadId: input.threadId,
          provider: ProviderDriverKind.make(routed.adapter.provider),
          providerInstanceId: routed.instanceId,
          status: "stopped",
          runtimePayload: {
            activeTurnId: null,
          },
        });
        if (routed.isActive) {
          yield* routed.adapter
            .stopSession(routed.threadId)
            .pipe(
              Effect.catchCause((cause) =>
                persistStopped.pipe(Effect.andThen(Effect.failCause(cause))),
              ),
            );
        }
        yield* persistStopped;
        yield* analytics.record("provider.session.stopped", {
          provider: routed.adapter.provider,
        });
      }).pipe(
        withMetrics({
          counter: providerSessionsTotal,
          outcomeAttributes: () =>
            providerMetricAttributes(metricProvider, {
              operation: "stop",
            }),
        }),
      );
    },
  );

  const listSessions: ProviderServiceShape["listSessions"] = Effect.fn("listSessions")(
    function* () {
      const adapterEntries = yield* getAdapterEntries;
      const sessionsByProvider = yield* Effect.forEach(adapterEntries, ([instanceId, adapter]) =>
        adapter
          .listSessions()
          .pipe(
            Effect.map((sessions) =>
              sessions.map((session) => ({ ...session, providerInstanceId: instanceId })),
            ),
          ),
      );
      const activeSessions = sessionsByProvider.flatMap((sessions) => sessions);
      const persistedBindings = yield* directory.listThreadIds().pipe(
        Effect.flatMap((threadIds) =>
          Effect.forEach(
            threadIds,
            (threadId) =>
              directory
                .getBinding(threadId)
                .pipe(Effect.orElseSucceed(() => Option.none<ProviderRuntimeBinding>())),
            { concurrency: "unbounded" },
          ),
        ),
        Effect.orElseSucceed(() => [] as Array<Option.Option<ProviderRuntimeBinding>>),
      );
      const bindingsByThreadId = new Map<ThreadId, ProviderRuntimeBinding>();
      for (const bindingOption of persistedBindings) {
        const binding = Option.getOrUndefined(bindingOption);
        if (binding) {
          bindingsByThreadId.set(binding.threadId, binding);
        }
      }

      return activeSessions.map((session) => {
        const binding = bindingsByThreadId.get(session.threadId);
        if (!binding) {
          return session;
        }

        const overrides: {
          resumeCursor?: ProviderSession["resumeCursor"];
          runtimeMode?: ProviderSession["runtimeMode"];
        } = {};
        if (session.resumeCursor === undefined && binding.resumeCursor !== undefined) {
          overrides.resumeCursor = binding.resumeCursor;
        }
        if (binding.runtimeMode !== undefined) {
          overrides.runtimeMode = binding.runtimeMode;
        }
        return Object.assign({}, session, overrides);
      });
    },
  );

  const getCapabilities: ProviderServiceShape["getCapabilities"] = (provider) =>
    registry
      .getByInstance(defaultInstanceIdForDriver(provider))
      .pipe(Effect.map((adapter) => adapter.capabilities));

  const readThread: ProviderServiceShape["readThread"] = Effect.fn("readThread")(
    function* (rawInput) {
      const input = yield* decodeInputOrValidationError({
        operation: "ProviderService.readThread",
        decode: decodeProviderThreadReadInput,
        payload: rawInput,
      });
      let metricProvider = "unknown";
      return yield* Effect.gen(function* () {
        const routed = yield* resolveRoutableSession({
          threadId: input.threadId,
          operation: "ProviderService.readThread",
          allowRecovery: true,
        });
        metricProvider = routed.adapter.provider;
        yield* Effect.annotateCurrentSpan({
          "provider.operation": "read-thread",
          "provider.kind": routed.adapter.provider,
          "provider.thread_id": input.threadId,
          ...(input.providerThreadId ? { "provider.native_thread_id": input.providerThreadId } : {}),
        });
        return yield* routed.adapter.readThread(input);
      }).pipe(
        withMetrics({
          counter: providerTurnsTotal,
          outcomeAttributes: () =>
            providerMetricAttributes(metricProvider, {
              operation: "read-thread",
            }),
        }),
      );
    },
  );

  const rollbackConversation: ProviderServiceShape["rollbackConversation"] = Effect.fn(
    "rollbackConversation",
  )(function* (rawInput) {
    const input = yield* decodeInputOrValidationError({
      operation: "ProviderService.rollbackConversation",
      decode: decodeProviderRollbackConversationInput,
      payload: rawInput,
    });
    if (input.numTurns === 0) {
      return;
    }
    let metricProvider = "unknown";
    return yield* Effect.gen(function* () {
      const routed = yield* resolveRoutableSession({
        threadId: input.threadId,
        operation: "ProviderService.rollbackConversation",
        allowRecovery: true,
      });
      metricProvider = routed.adapter.provider;
      yield* Effect.annotateCurrentSpan({
        "provider.operation": "rollback-conversation",
        "provider.kind": routed.adapter.provider,
        "provider.thread_id": input.threadId,
        "provider.rollback_turns": input.numTurns,
      });
      yield* routed.adapter.rollbackThread(routed.threadId, input.numTurns);
      yield* analytics.record("provider.conversation.rolled_back", {
        provider: routed.adapter.provider,
        turns: input.numTurns,
      });
    }).pipe(
      withMetrics({
        counter: providerTurnsTotal,
        outcomeAttributes: () =>
          providerMetricAttributes(metricProvider, {
            operation: "rollback",
          }),
      }),
    );
  });

  const runStopAll = Effect.fn("runStopAll")(function* () {
    const threadIds = yield* directory.listThreadIds();
    const adapterEntries = yield* getAdapterEntries;
    const activeSessions = yield* Effect.forEach(adapterEntries, ([instanceId, adapter]) =>
      adapter
        .listSessions()
        .pipe(
          Effect.map((sessions) =>
            sessions.map((session) => ({ ...session, providerInstanceId: instanceId })),
          ),
        ),
    ).pipe(Effect.map((sessionsByAdapter) => sessionsByAdapter.flatMap((sessions) => sessions)));
    yield* Effect.forEach(activeSessions, (session) =>
      upsertSessionBinding(session, session.threadId, {
        lastRuntimeEvent: "provider.stopAll",
        lastRuntimeEventAt: new Date().toISOString(),
      }),
    ).pipe(Effect.asVoid);
    yield* Effect.forEach(adapterEntries, ([, adapter]) => adapter.stopAll()).pipe(Effect.asVoid);
    yield* Effect.forEach(threadIds, (threadId) =>
      directory.getProvider(threadId).pipe(
        Effect.flatMap((providerInstanceId) =>
          registry.getInstanceInfo(ProviderInstanceId.make(providerInstanceId)).pipe(
            Effect.flatMap((instanceInfo) =>
              directory.upsert({
                threadId,
                provider: instanceInfo.driverKind,
                providerInstanceId: instanceInfo.instanceId,
                status: "stopped",
                runtimePayload: {
                  activeTurnId: null,
                  lastRuntimeEvent: "provider.stopAll",
                  lastRuntimeEventAt: new Date().toISOString(),
                },
              }),
            ),
          ),
        ),
      ),
    ).pipe(Effect.asVoid);
    yield* analytics.record("provider.sessions.stopped_all", {
      sessionCount: threadIds.length,
    });
    yield* analytics.flush;
  });

  yield* Effect.addFinalizer(() =>
    Effect.catch(runStopAll(), (cause) =>
      Effect.logWarning("failed to stop provider service", { cause }),
    ),
  );

  return {
    startSession,
    sendTurn,
    interruptTurn,
    respondToRequest,
    respondToUserInput,
    stopSession,
    listSessions,
    getCapabilities,
    readThread,
    rollbackConversation,
    // Each access creates a fresh PubSub subscription so that multiple
    // consumers (ProviderRuntimeIngestion, CheckpointReactor, etc.) each
    // independently receive all runtime events.
    get streamEvents(): ProviderServiceShape["streamEvents"] {
      return Stream.fromPubSub(runtimeEventPubSub);
    },
  } satisfies ProviderServiceShape;
});

export const ProviderServiceLive = Layer.effect(ProviderService, makeProviderService());

export function makeProviderServiceLive(options?: ProviderServiceLiveOptions) {
  return Layer.effect(ProviderService, makeProviderService(options));
}
