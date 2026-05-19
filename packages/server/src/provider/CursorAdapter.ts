/**
 * CursorAdapterLive — Cursor CLI (`agent acp`) via ACP.
 *
 * @module CursorAdapterLive
 */
import * as nodePath from "node:path";

import {
  ApprovalRequestId,
  defaultInstanceIdForDriver,
  ProviderDriverKind,
  type ProviderOptionSelection,
  type CursorSettings,
  EventId,
  type ProviderApprovalDecision,
  type ProviderInteractionMode,
  type ProviderRuntimeEvent,
  type ProviderSession,
  type ProviderUserInputAnswers,
  RuntimeRequestId,
  type RuntimeMode,
  type ThreadId,
  TurnId,
} from "@multi/contracts";
import {
  DateTime,
  Deferred,
  Effect,
  Exit,
  Fiber,
  FileSystem,
  Layer,
  Option,
  PubSub,
  Random,
  Scope,
  Semaphore,
  Stream,
  SynchronizedRef,
} from "effect";
import { ChildProcessSpawner } from "effect/unstable/process";
import type * as EffectAcpErrors from "effect-acp/errors";
import type * as EffectAcpSchema from "effect-acp/schema";

import { resolveAttachmentPath } from "../attachment-store.ts";
import { ServerConfig } from "../config.ts";
import { ServerSettingsService } from "../server-settings.ts";
import { resolveCursorSettings } from "./provider-settings.ts";
import {
  ProviderAdapterProcessError,
  ProviderAdapterRequestError,
  ProviderAdapterSessionNotFoundError,
  ProviderAdapterValidationError,
} from "./Errors.ts";
import { acpPermissionOutcome, mapAcpToAdapterError } from "./acp/AcpAdapterSupport.ts";
import {
  type AcpSessionRuntimeShape,
  type AcpSessionRuntimeStartResult,
} from "./acp/AcpSessionRuntime.ts";
import {
  makeAcpAssistantItemEvent,
  makeAcpContentDeltaEvent,
  makeAcpPlanUpdatedEvent,
  makeAcpRequestOpenedEvent,
  makeAcpRequestResolvedEvent,
  makeAcpToolCallEvent,
} from "./acp/AcpCoreRuntimeEvents.ts";
import {
  type AcpSessionMode,
  type AcpSessionModeState,
  parsePermissionRequest,
} from "./acp/AcpRuntimeModel.ts";
import { makeAcpNativeLoggers } from "./acp/AcpNativeLogging.ts";
import {
  applyCursorAcpModelSelection,
  makeCursorAcpRuntime,
  resolveCursorAcpSpawnCliModelId,
} from "./acp/CursorAcpSupport.ts";
import {
  CursorAskQuestionRequest,
  CursorCreatePlanRequest,
  CursorUpdateTodosRequest,
  extractAskQuestions,
  extractPlanMarkdown,
  extractTodosAsPlan,
  toCursorAskQuestionAnswers,
} from "./acp/CursorAcpExtension.ts";
import { CursorAdapter, type CursorAdapterShape } from "./CursorAdapter.service.ts";
import { resolveCursorAcpBaseModelId } from "./CursorProvider.ts";
import { type EventNdjsonLogger, makeEventNdjsonLogger } from "./EventNdjsonLogger.ts";
import { actionFromAcpPermissionKind, shouldPromptForAction } from "./runtime-permission-policy.ts";

const PROVIDER = ProviderDriverKind.make("cursor");
const PROVIDER_INSTANCE_ID = defaultInstanceIdForDriver(PROVIDER);
const CURSOR_RESUME_VERSION = 1 as const;
const ACP_PLAN_MODE_ALIASES = ["plan", "architect"];
const ACP_IMPLEMENT_MODE_ALIASES = ["code", "agent", "default", "chat", "implement"];
const ACP_APPROVAL_MODE_ALIASES = ["ask"];

export interface CursorAdapterLiveOptions {
  readonly nativeEventLogPath?: string;
  readonly nativeEventLogger?: EventNdjsonLogger;
}

interface PendingApproval {
  readonly decision: Deferred.Deferred<ProviderApprovalDecision>;
  readonly kind: string | "unknown";
}

interface PendingUserInput {
  readonly answers: Deferred.Deferred<ProviderUserInputAnswers>;
}

interface CursorSessionContext {
  readonly threadId: ThreadId;
  session: ProviderSession;
  scope: Scope.Closeable;
  acp: AcpSessionRuntimeShape;
  notificationFiber: Fiber.Fiber<void, never> | undefined;
  readonly pendingApprovals: Map<ApprovalRequestId, PendingApproval>;
  readonly pendingUserInputs: Map<ApprovalRequestId, PendingUserInput>;
  readonly turns: Array<{ id: TurnId; items: Array<unknown> }>;
  readonly interruptedTurnIds: Set<TurnId>;
  lastPlanFingerprint: string | undefined;
  activeTurnId: TurnId | undefined;
  stopped: boolean;
  cliModelSlug: string | undefined;
  modelOptions: ReadonlyArray<ProviderOptionSelection> | undefined;
  cursorSettings: CursorSettings;
}

function settlePendingApprovalsAsCancelled(
  pendingApprovals: ReadonlyMap<ApprovalRequestId, PendingApproval>,
): Effect.Effect<void> {
  const pendingEntries = Array.from(pendingApprovals.values());
  return Effect.forEach(
    pendingEntries,
    (pending) => Deferred.succeed(pending.decision, "cancel").pipe(Effect.ignore),
    {
      discard: true,
    },
  );
}

function settlePendingUserInputsAsEmptyAnswers(
  pendingUserInputs: ReadonlyMap<ApprovalRequestId, PendingUserInput>,
): Effect.Effect<void> {
  const pendingEntries = Array.from(pendingUserInputs.values());
  return Effect.forEach(
    pendingEntries,
    (pending) => Deferred.succeed(pending.answers, {}).pipe(Effect.ignore),
    {
      discard: true,
    },
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseCursorResume(raw: unknown): { sessionId: string } | undefined {
  if (!isRecord(raw)) return undefined;
  if (raw.schemaVersion !== CURSOR_RESUME_VERSION) return undefined;
  if (typeof raw.sessionId !== "string" || !raw.sessionId.trim()) return undefined;
  return { sessionId: raw.sessionId.trim() };
}

function normalizeModeSearchText(mode: AcpSessionMode): string {
  return [mode.id, mode.name, mode.description]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join(" ")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function findModeByAliases(
  modes: ReadonlyArray<AcpSessionMode>,
  aliases: ReadonlyArray<string>,
): AcpSessionMode | undefined {
  const normalizedAliases = aliases.map((alias) => alias.toLowerCase());
  for (const alias of normalizedAliases) {
    const exact = modes.find((mode) => {
      const id = mode.id.toLowerCase();
      const name = mode.name.toLowerCase();
      return id === alias || name === alias;
    });
    if (exact) {
      return exact;
    }
  }
  for (const alias of normalizedAliases) {
    const partial = modes.find((mode) => normalizeModeSearchText(mode).includes(alias));
    if (partial) {
      return partial;
    }
  }
  return undefined;
}

function isPlanMode(mode: AcpSessionMode): boolean {
  return findModeByAliases([mode], ACP_PLAN_MODE_ALIASES) !== undefined;
}

function resolveRequestedModeId(input: {
  readonly interactionMode: ProviderInteractionMode | undefined;
  readonly runtimeMode: RuntimeMode;
  readonly modeState: AcpSessionModeState | undefined;
}): string | undefined {
  const modeState = input.modeState;
  if (!modeState) {
    return undefined;
  }

  if (input.interactionMode === "plan") {
    return findModeByAliases(modeState.availableModes, ACP_PLAN_MODE_ALIASES)?.id;
  }

  if (input.runtimeMode === "approval-required") {
    return (
      findModeByAliases(modeState.availableModes, ACP_APPROVAL_MODE_ALIASES)?.id ??
      findModeByAliases(modeState.availableModes, ACP_IMPLEMENT_MODE_ALIASES)?.id ??
      modeState.availableModes.find((mode) => !isPlanMode(mode))?.id ??
      modeState.currentModeId
    );
  }

  return (
    findModeByAliases(modeState.availableModes, ACP_IMPLEMENT_MODE_ALIASES)?.id ??
    findModeByAliases(modeState.availableModes, ACP_APPROVAL_MODE_ALIASES)?.id ??
    modeState.availableModes.find((mode) => !isPlanMode(mode))?.id ??
    modeState.currentModeId
  );
}

function applyRequestedSessionConfiguration<E>(input: {
  readonly runtime: AcpSessionRuntimeShape;
  readonly runtimeMode: RuntimeMode;
  readonly interactionMode: ProviderInteractionMode | undefined;
  readonly modelSelection:
    | {
        readonly model: string;
        readonly options?: ReadonlyArray<ProviderOptionSelection> | null | undefined;
      }
    | undefined;
  readonly mapError: (context: {
    readonly cause: EffectAcpErrors.AcpError;
    readonly method: "session/set_config_option" | "session/set_mode" | "session/set_model";
  }) => E;
}): Effect.Effect<void, E> {
  return Effect.gen(function* () {
    if (input.modelSelection) {
      yield* applyCursorAcpModelSelection({
        runtime: input.runtime,
        model: input.modelSelection.model,
        selections: input.modelSelection.options,
        mapError: ({ cause, method }) =>
          input.mapError({
            cause,
            method,
          }),
      });
    }

    const requestedModeId = resolveRequestedModeId({
      interactionMode: input.interactionMode,
      runtimeMode: input.runtimeMode,
      modeState: yield* input.runtime.getModeState,
    });
    if (!requestedModeId) {
      return;
    }

    yield* input.runtime.setMode(requestedModeId).pipe(
      Effect.mapError((cause) =>
        input.mapError({
          cause,
          method: "session/set_mode",
        }),
      ),
    );
  });
}

function selectAutoApprovedPermissionOption(
  request: EffectAcpSchema.RequestPermissionRequest,
): string | undefined {
  const allowAlwaysOption = request.options.find((option) => option.kind === "allow_always");
  if (typeof allowAlwaysOption?.optionId === "string" && allowAlwaysOption.optionId.trim()) {
    return allowAlwaysOption.optionId.trim();
  }

  const allowOnceOption = request.options.find((option) => option.kind === "allow_once");
  if (typeof allowOnceOption?.optionId === "string" && allowOnceOption.optionId.trim()) {
    return allowOnceOption.optionId.trim();
  }

  return undefined;
}

function makeCursorAdapter(options?: CursorAdapterLiveOptions) {
  return Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const childProcessSpawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const serverConfig = yield* Effect.service(ServerConfig);
    const serverSettingsService = yield* ServerSettingsService;
    const nativeEventLogger =
      options?.nativeEventLogger ??
      (options?.nativeEventLogPath !== undefined
        ? yield* makeEventNdjsonLogger(options.nativeEventLogPath, {
            stream: "native",
          })
        : undefined);
    const managedNativeEventLogger =
      options?.nativeEventLogger === undefined ? nativeEventLogger : undefined;

    const sessions = new Map<ThreadId, CursorSessionContext>();
    const threadLocksRef = yield* SynchronizedRef.make(new Map<string, Semaphore.Semaphore>());
    const runtimeEventPubSub = yield* PubSub.unbounded<ProviderRuntimeEvent>();

    const nowIso = Effect.map(DateTime.now, DateTime.formatIso);
    const nextEventId = Effect.map(Random.nextUUIDv4, (id) => EventId.make(id));
    const makeEventStamp = () => Effect.all({ eventId: nextEventId, createdAt: nowIso });

    const offerRuntimeEvent = (
      event: Omit<ProviderRuntimeEvent, "providerInstanceId"> & {
        readonly providerInstanceId?: ProviderRuntimeEvent["providerInstanceId"];
      },
    ) =>
      PubSub.publish(runtimeEventPubSub, {
        ...event,
        providerInstanceId: event.providerInstanceId ?? PROVIDER_INSTANCE_ID,
      } as ProviderRuntimeEvent).pipe(Effect.asVoid);

    const getThreadSemaphore = (threadId: string) =>
      SynchronizedRef.modifyEffect(threadLocksRef, (current) => {
        const existing: Option.Option<Semaphore.Semaphore> = Option.fromNullishOr(
          current.get(threadId),
        );
        return Option.match(existing, {
          onNone: () =>
            Semaphore.make(1).pipe(
              Effect.map((semaphore) => {
                const next = new Map(current);
                next.set(threadId, semaphore);
                return [semaphore, next] as const;
              }),
            ),
          onSome: (semaphore) => Effect.succeed([semaphore, current] as const),
        });
      });

    const withThreadLock = <A, E, R>(threadId: string, effect: Effect.Effect<A, E, R>) =>
      Effect.flatMap(getThreadSemaphore(threadId), (semaphore) => semaphore.withPermit(effect));

    const logNative = (
      threadId: ThreadId,
      method: string,
      payload: unknown,
      _source: "acp.jsonrpc" | "acp.cursor.extension",
    ) =>
      Effect.gen(function* () {
        if (!nativeEventLogger) return;
        const observedAt = new Date().toISOString();
        yield* nativeEventLogger.write(
          {
            observedAt,
            event: {
              id: crypto.randomUUID(),
              kind: "notification",
              provider: PROVIDER,
              createdAt: observedAt,
              method,
              threadId,
              payload,
            },
          },
          threadId,
        );
      });

    const emitPlanUpdate = (
      ctx: CursorSessionContext,
      payload: {
        readonly explanation?: string | null;
        readonly plan: ReadonlyArray<{
          readonly step: string;
          readonly status: "pending" | "inProgress" | "completed";
        }>;
      },
      rawPayload: unknown,
      source: "acp.jsonrpc" | "acp.cursor.extension",
      method: string,
    ) =>
      Effect.gen(function* () {
        const fingerprint = `${ctx.activeTurnId ?? "no-turn"}:${JSON.stringify(payload)}`;
        if (ctx.lastPlanFingerprint === fingerprint) {
          return;
        }
        ctx.lastPlanFingerprint = fingerprint;
        yield* offerRuntimeEvent(
          makeAcpPlanUpdatedEvent({
            stamp: yield* makeEventStamp(),
            provider: PROVIDER,
            threadId: ctx.threadId,
            turnId: ctx.activeTurnId,
            payload,
            source,
            method,
            rawPayload,
          }),
        );
      });

    const forkCursorAcpNotificationStream = (
      ctx: CursorSessionContext,
      acp: AcpSessionRuntimeShape,
    ) =>
      Stream.runDrain(
        Stream.mapEffect(acp.getEvents(), (event) =>
          Effect.gen(function* () {
            switch (event._tag) {
              case "ModeChanged":
                return;
              case "AssistantItemStarted":
                yield* offerRuntimeEvent(
                  makeAcpAssistantItemEvent({
                    stamp: yield* makeEventStamp(),
                    provider: PROVIDER,
                    threadId: ctx.threadId,
                    turnId: ctx.activeTurnId,
                    itemId: event.itemId,
                    lifecycle: "item.started",
                  }),
                );
                return;
              case "AssistantItemCompleted":
                yield* offerRuntimeEvent(
                  makeAcpAssistantItemEvent({
                    stamp: yield* makeEventStamp(),
                    provider: PROVIDER,
                    threadId: ctx.threadId,
                    turnId: ctx.activeTurnId,
                    itemId: event.itemId,
                    lifecycle: "item.completed",
                  }),
                );
                return;
              case "PlanUpdated":
                yield* logNative(ctx.threadId, "session/update", event.rawPayload, "acp.jsonrpc");
                yield* emitPlanUpdate(
                  ctx,
                  event.payload,
                  event.rawPayload,
                  "acp.jsonrpc",
                  "session/update",
                );
                return;
              case "ToolCallUpdated":
                yield* logNative(ctx.threadId, "session/update", event.rawPayload, "acp.jsonrpc");
                yield* offerRuntimeEvent(
                  makeAcpToolCallEvent({
                    stamp: yield* makeEventStamp(),
                    provider: PROVIDER,
                    threadId: ctx.threadId,
                    turnId: ctx.activeTurnId,
                    toolCall: event.toolCall,
                    rawPayload: event.rawPayload,
                  }),
                );
                return;
              case "ContentDelta":
                yield* logNative(ctx.threadId, "session/update", event.rawPayload, "acp.jsonrpc");
                yield* offerRuntimeEvent(
                  makeAcpContentDeltaEvent({
                    stamp: yield* makeEventStamp(),
                    provider: PROVIDER,
                    threadId: ctx.threadId,
                    turnId: ctx.activeTurnId,
                    ...(event.itemId ? { itemId: event.itemId } : {}),
                    text: event.text,
                    rawPayload: event.rawPayload,
                  }),
                );
                return;
            }
          }),
        ),
      ).pipe(Effect.forkChild);

    const registerCursorAcpHandlersAndStart = (params: {
      readonly acp: AcpSessionRuntimeShape;
      readonly threadId: ThreadId;
      readonly runtimeMode: RuntimeMode;
      readonly pendingApprovals: Map<ApprovalRequestId, PendingApproval>;
      readonly pendingUserInputs: Map<ApprovalRequestId, PendingUserInput>;
      readonly activeTurnId: () => TurnId | undefined;
    }): Effect.Effect<AcpSessionRuntimeStartResult, EffectAcpErrors.AcpError> =>
      Effect.gen(function* () {
        yield* params.acp.handleExtRequest(
          "cursor/ask_question",
          CursorAskQuestionRequest,
          (requestParams) =>
            Effect.gen(function* () {
              yield* logNative(
                params.threadId,
                "cursor/ask_question",
                requestParams,
                "acp.cursor.extension",
              );
              const requestId = ApprovalRequestId.make(crypto.randomUUID());
              const runtimeRequestId = RuntimeRequestId.make(requestId);
              const answers = yield* Deferred.make<ProviderUserInputAnswers>();
              params.pendingUserInputs.set(requestId, { answers });
              yield* Effect.logInfo("cursor.ask-question.requested", {
                threadId: params.threadId,
                requestId,
                toolCallId: requestParams.toolCallId,
                questionIds: requestParams.questions.map((question) => question.id),
                optionIdsByQuestionId: Object.fromEntries(
                  requestParams.questions.map((question) => [
                    question.id,
                    question.options.map((option) => option.id),
                  ]),
                ),
              });
              yield* offerRuntimeEvent({
                type: "user-input.requested",
                ...(yield* makeEventStamp()),
                provider: PROVIDER,
                threadId: params.threadId,
                turnId: params.activeTurnId(),
                requestId: runtimeRequestId,
                payload: { questions: extractAskQuestions(requestParams) },
                raw: {
                  source: "acp.cursor.extension",
                  method: "cursor/ask_question",
                  payload: requestParams,
                },
              });
              const resolved = yield* Deferred.await(answers);
              const cursorResolved = toCursorAskQuestionAnswers(requestParams, resolved);
              yield* Effect.logInfo("cursor.ask-question.answers-received", {
                threadId: params.threadId,
                requestId,
                toolCallId: requestParams.toolCallId,
                answerKeys: Object.keys(resolved),
                answers: resolved,
                cursorAnswers: cursorResolved,
              });
              params.pendingUserInputs.delete(requestId);
              yield* offerRuntimeEvent({
                type: "user-input.resolved",
                ...(yield* makeEventStamp()),
                provider: PROVIDER,
                threadId: params.threadId,
                turnId: params.activeTurnId(),
                requestId: runtimeRequestId,
                payload: { answers: resolved },
              });
              return { answers: cursorResolved };
            }),
        );
        yield* params.acp.handleExtRequest(
          "cursor/create_plan",
          CursorCreatePlanRequest,
          (requestParams) =>
            Effect.gen(function* () {
              yield* logNative(
                params.threadId,
                "cursor/create_plan",
                requestParams,
                "acp.cursor.extension",
              );
              yield* offerRuntimeEvent({
                type: "turn.proposed.completed",
                ...(yield* makeEventStamp()),
                provider: PROVIDER,
                threadId: params.threadId,
                turnId: params.activeTurnId(),
                payload: { planMarkdown: extractPlanMarkdown(requestParams) },
                raw: {
                  source: "acp.cursor.extension",
                  method: "cursor/create_plan",
                  payload: requestParams,
                },
              });
              return { accepted: true } as const;
            }),
        );
        yield* params.acp.handleExtNotification(
          "cursor/update_todos",
          CursorUpdateTodosRequest,
          (requestParams) =>
            Effect.gen(function* () {
              yield* logNative(
                params.threadId,
                "cursor/update_todos",
                requestParams,
                "acp.cursor.extension",
              );
              const ctx = sessions.get(params.threadId);
              if (ctx) {
                yield* emitPlanUpdate(
                  ctx,
                  extractTodosAsPlan(requestParams),
                  requestParams,
                  "acp.cursor.extension",
                  "cursor/update_todos",
                );
              }
            }),
        );
        yield* params.acp.handleRequestPermission((requestParams) =>
          Effect.gen(function* () {
            yield* logNative(
              params.threadId,
              "session/request_permission",
              requestParams,
              "acp.jsonrpc",
            );
            if (params.runtimeMode === "full-access") {
              const autoApprovedOptionId = selectAutoApprovedPermissionOption(requestParams);
              if (autoApprovedOptionId !== undefined) {
                return {
                  outcome: {
                    outcome: "selected" as const,
                    optionId: autoApprovedOptionId,
                  },
                };
              }
            }
            const permissionRequest = parsePermissionRequest(requestParams);
            if (
              !shouldPromptForAction(
                params.runtimeMode,
                actionFromAcpPermissionKind(permissionRequest.kind),
              )
            ) {
              const autoApprovedOptionId = selectAutoApprovedPermissionOption(requestParams);
              if (autoApprovedOptionId !== undefined) {
                return {
                  outcome: {
                    outcome: "selected" as const,
                    optionId: autoApprovedOptionId,
                  },
                };
              }
            }
            const requestId = ApprovalRequestId.make(crypto.randomUUID());
            const runtimeRequestId = RuntimeRequestId.make(requestId);
            const decision = yield* Deferred.make<ProviderApprovalDecision>();
            params.pendingApprovals.set(requestId, {
              decision,
              kind: permissionRequest.kind,
            });
            yield* offerRuntimeEvent(
              makeAcpRequestOpenedEvent({
                stamp: yield* makeEventStamp(),
                provider: PROVIDER,
                threadId: params.threadId,
                turnId: params.activeTurnId(),
                requestId: runtimeRequestId,
                permissionRequest,
                detail: permissionRequest.detail ?? JSON.stringify(requestParams).slice(0, 2000),
                args: requestParams,
                source: "acp.jsonrpc",
                method: "session/request_permission",
                rawPayload: requestParams,
              }),
            );
            const resolved = yield* Deferred.await(decision);
            params.pendingApprovals.delete(requestId);
            yield* offerRuntimeEvent(
              makeAcpRequestResolvedEvent({
                stamp: yield* makeEventStamp(),
                provider: PROVIDER,
                threadId: params.threadId,
                turnId: params.activeTurnId(),
                requestId: runtimeRequestId,
                permissionRequest,
                decision: resolved,
              }),
            );
            return {
              outcome:
                resolved === "cancel"
                  ? ({ outcome: "cancelled" } as const)
                  : {
                      outcome: "selected" as const,
                      optionId: acpPermissionOutcome(resolved),
                    },
            };
          }),
        );
        return yield* params.acp.start();
      });

    const reconnectCursorAcp = (params: {
      readonly ctx: CursorSessionContext;
      readonly spawnModel: string | null | undefined;
      readonly spawnSelections: ReadonlyArray<ProviderOptionSelection> | undefined;
      readonly runtimeMode: RuntimeMode;
      readonly interactionMode: ProviderInteractionMode | undefined;
      readonly modelSelection:
        | {
            readonly model: string;
            readonly options?: ReadonlyArray<ProviderOptionSelection> | null | undefined;
          }
        | undefined;
    }) =>
      Effect.gen(function* () {
        const { ctx } = params;
        if (ctx.notificationFiber) {
          yield* Fiber.interrupt(ctx.notificationFiber);
          ctx.notificationFiber = undefined;
        }
        yield* Effect.ignore(Scope.close(ctx.scope, Exit.void));

        const sessionScope = yield* Scope.make("sequential");
        const resumeCursor = parseCursorResume(ctx.session.resumeCursor);
        const resumeSessionId = resumeCursor?.sessionId;
        const sessionCwd = ctx.session.cwd?.trim();
        if (!sessionCwd) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "sendTurn",
            issue: "Cursor session cwd is missing; cannot reconnect ACP process.",
          });
        }
        const acpNativeLoggers = makeAcpNativeLoggers({
          nativeEventLogger,
          provider: PROVIDER,
          threadId: ctx.threadId,
        });

        const acp = yield* makeCursorAcpRuntime({
          cursorSettings: ctx.cursorSettings,
          childProcessSpawner,
          cwd: sessionCwd,
          ...(resumeSessionId ? { resumeSessionId } : {}),
          ...(params.spawnModel !== undefined ? { spawnModel: params.spawnModel } : {}),
          ...(params.spawnSelections !== undefined
            ? { spawnSelections: params.spawnSelections }
            : {}),
          clientInfo: { name: "multi", version: "0.0.0" },
          ...acpNativeLoggers,
        }).pipe(
          Effect.provideService(Scope.Scope, sessionScope),
          Effect.mapError(
            (cause) =>
              new ProviderAdapterProcessError({
                provider: PROVIDER,
                threadId: ctx.threadId,
                detail: cause.message,
                cause,
              }),
          ),
        );

        const started = yield* registerCursorAcpHandlersAndStart({
          acp,
          threadId: ctx.threadId,
          runtimeMode: params.runtimeMode,
          pendingApprovals: ctx.pendingApprovals,
          pendingUserInputs: ctx.pendingUserInputs,
          activeTurnId: () => ctx.activeTurnId,
        }).pipe(
          Effect.mapError((error) =>
            mapAcpToAdapterError(PROVIDER, ctx.threadId, "session/reconnect", error),
          ),
        );

        yield* applyRequestedSessionConfiguration({
          runtime: acp,
          runtimeMode: params.runtimeMode,
          interactionMode: params.interactionMode,
          modelSelection: params.modelSelection,
          mapError: ({ cause, method }) =>
            mapAcpToAdapterError(PROVIDER, ctx.threadId, method, cause),
        });

        ctx.scope = sessionScope;
        ctx.acp = acp;
        ctx.cliModelSlug = resolveCursorAcpSpawnCliModelId({
          model: params.spawnModel,
          selections: params.spawnSelections,
        });
        if (params.spawnSelections !== undefined) {
          ctx.modelOptions = params.spawnSelections;
        }
        ctx.session = {
          ...ctx.session,
          resumeCursor: {
            schemaVersion: CURSOR_RESUME_VERSION,
            sessionId: started.sessionId,
          },
          updatedAt: yield* nowIso,
          ...(params.modelSelection?.model !== undefined
            ? { model: params.modelSelection.model }
            : {}),
        };

        ctx.notificationFiber = yield* forkCursorAcpNotificationStream(ctx, acp);
      });

    const requireSession = (
      threadId: ThreadId,
    ): Effect.Effect<CursorSessionContext, ProviderAdapterSessionNotFoundError> => {
      const ctx = sessions.get(threadId);
      if (!ctx || ctx.stopped) {
        return Effect.fail(
          new ProviderAdapterSessionNotFoundError({ provider: PROVIDER, threadId }),
        );
      }
      return Effect.succeed(ctx);
    };

    const stopSessionInternal = (ctx: CursorSessionContext) =>
      Effect.gen(function* () {
        if (ctx.stopped) return;
        ctx.stopped = true;
        yield* settlePendingApprovalsAsCancelled(ctx.pendingApprovals);
        yield* settlePendingUserInputsAsEmptyAnswers(ctx.pendingUserInputs);
        if (ctx.notificationFiber) {
          yield* Fiber.interrupt(ctx.notificationFiber);
        }
        yield* Effect.ignore(Scope.close(ctx.scope, Exit.void));
        sessions.delete(ctx.threadId);
        yield* offerRuntimeEvent({
          type: "session.exited",
          ...(yield* makeEventStamp()),
          provider: PROVIDER,
          threadId: ctx.threadId,
          payload: { exitKind: "graceful" },
        });
      });

    const startSession: CursorAdapterShape["startSession"] = (input) =>
      withThreadLock(
        input.threadId,
        Effect.gen(function* () {
          if (input.provider !== undefined && input.provider !== PROVIDER) {
            return yield* new ProviderAdapterValidationError({
              provider: PROVIDER,
              operation: "startSession",
              issue: `Expected provider '${PROVIDER}' but received '${input.provider}'.`,
            });
          }
          if (!input.cwd?.trim()) {
            return yield* new ProviderAdapterValidationError({
              provider: PROVIDER,
              operation: "startSession",
              issue: "cwd is required and must be non-empty.",
            });
          }

          const cwd = nodePath.resolve(input.cwd.trim());
          const cursorModelSelection = input.modelSelection;
          const existing = sessions.get(input.threadId);
          if (existing && !existing.stopped) {
            yield* stopSessionInternal(existing);
          }

          const cursorSettings = yield* serverSettingsService.getSettings.pipe(
            Effect.map((settings) => resolveCursorSettings(settings, input.providerInstanceId)),
            Effect.mapError(
              (error) =>
                new ProviderAdapterProcessError({
                  provider: PROVIDER,
                  threadId: input.threadId,
                  detail: error.message,
                  cause: error,
                }),
            ),
          );

          const pendingApprovals = new Map<ApprovalRequestId, PendingApproval>();
          const pendingUserInputs = new Map<ApprovalRequestId, PendingUserInput>();
          const sessionScope = yield* Scope.make("sequential");
          let sessionScopeTransferred = false;
          yield* Effect.addFinalizer(() =>
            sessionScopeTransferred ? Effect.void : Scope.close(sessionScope, Exit.void),
          );
          let ctx!: CursorSessionContext;

          const resumeSessionId = parseCursorResume(input.resumeCursor)?.sessionId;
          const spawnSelections = cursorModelSelection?.options;
          const acpNativeLoggers = makeAcpNativeLoggers({
            nativeEventLogger,
            provider: PROVIDER,
            threadId: input.threadId,
          });

          const acp = yield* makeCursorAcpRuntime({
            cursorSettings,
            childProcessSpawner,
            cwd,
            ...(resumeSessionId ? { resumeSessionId } : {}),
            ...(cursorModelSelection?.model !== undefined
              ? { spawnModel: cursorModelSelection.model }
              : {}),
            ...(spawnSelections !== undefined ? { spawnSelections } : {}),
            clientInfo: { name: "multi", version: "0.0.0" },
            ...acpNativeLoggers,
          }).pipe(
            Effect.provideService(Scope.Scope, sessionScope),
            Effect.mapError(
              (cause) =>
                new ProviderAdapterProcessError({
                  provider: PROVIDER,
                  threadId: input.threadId,
                  detail: cause.message,
                  cause,
                }),
            ),
          );
          const started = yield* registerCursorAcpHandlersAndStart({
            acp,
            threadId: input.threadId,
            runtimeMode: input.runtimeMode,
            pendingApprovals,
            pendingUserInputs,
            activeTurnId: () => ctx?.activeTurnId,
          }).pipe(
            Effect.mapError((error) =>
              mapAcpToAdapterError(PROVIDER, input.threadId, "session/start", error),
            ),
          );

          yield* applyRequestedSessionConfiguration({
            runtime: acp,
            runtimeMode: input.runtimeMode,
            interactionMode: undefined,
            modelSelection: cursorModelSelection,
            mapError: ({ cause, method }) =>
              mapAcpToAdapterError(PROVIDER, input.threadId, method, cause),
          });

          const now = yield* nowIso;
          const session: ProviderSession = {
            provider: PROVIDER,
            providerInstanceId: input.providerInstanceId,
            status: "ready",
            runtimeMode: input.runtimeMode,
            cwd,
            model: cursorModelSelection?.model,
            threadId: input.threadId,
            resumeCursor: {
              schemaVersion: CURSOR_RESUME_VERSION,
              sessionId: started.sessionId,
            },
            createdAt: now,
            updatedAt: now,
          };

          ctx = {
            threadId: input.threadId,
            session,
            scope: sessionScope,
            acp,
            notificationFiber: undefined,
            pendingApprovals,
            pendingUserInputs,
            turns: [],
            interruptedTurnIds: new Set(),
            lastPlanFingerprint: undefined,
            activeTurnId: undefined,
            stopped: false,
            cliModelSlug: resolveCursorAcpSpawnCliModelId({
              model: cursorModelSelection?.model,
              selections: spawnSelections,
            }),
            modelOptions: spawnSelections,
            cursorSettings,
          };

          ctx.notificationFiber = yield* forkCursorAcpNotificationStream(ctx, acp);
          sessions.set(input.threadId, ctx);
          sessionScopeTransferred = true;

          yield* offerRuntimeEvent({
            type: "session.started",
            ...(yield* makeEventStamp()),
            provider: PROVIDER,
            threadId: input.threadId,
            payload: { resume: started.initializeResult },
          });
          yield* offerRuntimeEvent({
            type: "session.state.changed",
            ...(yield* makeEventStamp()),
            provider: PROVIDER,
            threadId: input.threadId,
            payload: { state: "ready", reason: "Cursor ACP session ready" },
          });
          yield* offerRuntimeEvent({
            type: "thread.started",
            ...(yield* makeEventStamp()),
            provider: PROVIDER,
            threadId: input.threadId,
            payload: { providerThreadId: started.sessionId },
          });

          return session;
        }).pipe(Effect.scoped),
      );

    const sendTurn: CursorAdapterShape["sendTurn"] = (input) =>
      Effect.gen(function* () {
        const ctx = yield* requireSession(input.threadId);
        const turnId = TurnId.make(crypto.randomUUID());
        const turnModelSelection = input.modelSelection;
        const model = turnModelSelection?.model ?? ctx.session.model;
        const turnOptions = turnModelSelection?.options ?? ctx.modelOptions;
        const resolvedModel = resolveCursorAcpBaseModelId(model);
        const nextCliModelSlug = resolveCursorAcpSpawnCliModelId({
          model,
          selections: turnOptions,
        });
        if (nextCliModelSlug !== ctx.cliModelSlug) {
          yield* reconnectCursorAcp({
            ctx,
            spawnModel: model,
            spawnSelections: turnOptions,
            runtimeMode: ctx.session.runtimeMode,
            interactionMode: input.interactionMode,
            modelSelection:
              model === undefined
                ? undefined
                : {
                    model,
                    options: turnOptions,
                  },
          });
        }
        yield* applyRequestedSessionConfiguration({
          runtime: ctx.acp,
          runtimeMode: ctx.session.runtimeMode,
          interactionMode: input.interactionMode,
          modelSelection:
            model === undefined
              ? undefined
              : {
                  model,
                  options: turnModelSelection?.options,
                },
          mapError: ({ cause, method }) =>
            mapAcpToAdapterError(PROVIDER, input.threadId, method, cause),
        });
        ctx.activeTurnId = turnId;
        ctx.lastPlanFingerprint = undefined;
        if (turnModelSelection?.options !== undefined) {
          ctx.modelOptions = turnModelSelection.options;
        }
        ctx.session = {
          ...ctx.session,
          activeTurnId: turnId,
          updatedAt: yield* nowIso,
        };

        yield* offerRuntimeEvent({
          type: "turn.started",
          ...(yield* makeEventStamp()),
          provider: PROVIDER,
          threadId: input.threadId,
          turnId,
          payload: { model: resolvedModel },
        });

        const promptParts: Array<EffectAcpSchema.ContentBlock> = [];
        if (input.input?.trim()) {
          promptParts.push({ type: "text", text: input.input.trim() });
        }
        if (input.attachments && input.attachments.length > 0) {
          for (const attachment of input.attachments) {
            const attachmentPath = resolveAttachmentPath({
              attachmentsDir: serverConfig.attachmentsDir,
              attachment,
            });
            if (!attachmentPath) {
              return yield* new ProviderAdapterRequestError({
                provider: PROVIDER,
                method: "session/prompt",
                detail: `Invalid attachment id '${attachment.id}'.`,
              });
            }
            const bytes = yield* fileSystem.readFile(attachmentPath).pipe(
              Effect.mapError(
                (cause) =>
                  new ProviderAdapterRequestError({
                    provider: PROVIDER,
                    method: "session/prompt",
                    detail: cause.message,
                    cause,
                  }),
              ),
            );
            promptParts.push({
              type: "image",
              data: Buffer.from(bytes).toString("base64"),
              mimeType: attachment.mimeType,
            });
          }
        }

        if (promptParts.length === 0) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "sendTurn",
            issue: "Turn requires non-empty text or attachments.",
          });
        }

        const promptExit = yield* ctx.acp
          .prompt({
            prompt: promptParts,
          })
          .pipe(
            Effect.mapError((error) =>
              mapAcpToAdapterError(PROVIDER, input.threadId, "session/prompt", error),
            ),
            Effect.exit,
          );
        if (Exit.isFailure(promptExit)) {
          if (ctx.interruptedTurnIds.delete(turnId)) {
            return {
              threadId: input.threadId,
              turnId,
              resumeCursor: ctx.session.resumeCursor,
            };
          }
          return yield* Effect.failCause(promptExit.cause);
        }
        if (ctx.interruptedTurnIds.delete(turnId)) {
          return {
            threadId: input.threadId,
            turnId,
            resumeCursor: ctx.session.resumeCursor,
          };
        }

        const result = promptExit.value;
        ctx.turns.push({ id: turnId, items: [{ prompt: promptParts, result }] });
        ctx.session = {
          ...ctx.session,
          activeTurnId: undefined,
          updatedAt: yield* nowIso,
          model: resolvedModel,
        };
        ctx.activeTurnId = undefined;

        yield* offerRuntimeEvent({
          type: "turn.completed",
          ...(yield* makeEventStamp()),
          provider: PROVIDER,
          threadId: input.threadId,
          turnId,
          payload: {
            state: result.stopReason === "cancelled" ? "cancelled" : "completed",
            stopReason: result.stopReason ?? null,
          },
        });

        return {
          threadId: input.threadId,
          turnId,
          resumeCursor: ctx.session.resumeCursor,
        };
      });

    const interruptTurn: CursorAdapterShape["interruptTurn"] = (threadId, turnId) =>
      Effect.gen(function* () {
        const ctx = yield* requireSession(threadId);
        yield* settlePendingApprovalsAsCancelled(ctx.pendingApprovals);
        yield* settlePendingUserInputsAsEmptyAnswers(ctx.pendingUserInputs);
        const activeTurnId = ctx.activeTurnId ?? turnId;
        if (activeTurnId !== undefined) {
          ctx.interruptedTurnIds.add(activeTurnId);
        }
        ctx.activeTurnId = undefined;
        ctx.session = {
          ...ctx.session,
          activeTurnId: undefined,
          updatedAt: yield* nowIso,
        };
        if (activeTurnId !== undefined) {
          yield* offerRuntimeEvent({
            type: "turn.aborted",
            ...(yield* makeEventStamp()),
            provider: PROVIDER,
            threadId,
            turnId: activeTurnId,
            payload: { reason: "Interrupted by user." },
          });
        }
        yield* stopSessionInternal(ctx);
      });

    const respondToRequest: CursorAdapterShape["respondToRequest"] = (
      threadId,
      requestId,
      decision,
    ) =>
      Effect.gen(function* () {
        const ctx = yield* requireSession(threadId);
        const pending = ctx.pendingApprovals.get(requestId);
        if (!pending) {
          return yield* new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "session/request_permission",
            detail: `Unknown pending approval request: ${requestId}`,
          });
        }
        yield* Deferred.succeed(pending.decision, decision);
      });

    const respondToUserInput: CursorAdapterShape["respondToUserInput"] = (
      threadId,
      requestId,
      answers,
    ) =>
      Effect.gen(function* () {
        const ctx = yield* requireSession(threadId);
        const pending = ctx.pendingUserInputs.get(requestId);
        if (!pending) {
          yield* Effect.logWarning("cursor.ask-question.respond.unknown-request", {
            threadId,
            requestId,
            answerKeys: Object.keys(answers),
            answers,
            pendingRequestIds: Array.from(ctx.pendingUserInputs.keys()),
          });
          return yield* new ProviderAdapterRequestError({
            provider: PROVIDER,
            method: "cursor/ask_question",
            detail: `Unknown pending user-input request: ${requestId}`,
          });
        }
        yield* Effect.logInfo("cursor.ask-question.respond", {
          threadId,
          requestId,
          answerKeys: Object.keys(answers),
          answers,
        });
        yield* Deferred.succeed(pending.answers, answers);
      });

    const readThread: CursorAdapterShape["readThread"] = (threadId) =>
      Effect.gen(function* () {
        const ctx = yield* requireSession(threadId);
        return { threadId, turns: ctx.turns };
      });

    const rollbackThread: CursorAdapterShape["rollbackThread"] = (threadId, numTurns) =>
      Effect.gen(function* () {
        const ctx = yield* requireSession(threadId);
        if (!Number.isInteger(numTurns) || numTurns < 1) {
          return yield* new ProviderAdapterValidationError({
            provider: PROVIDER,
            operation: "rollbackThread",
            issue: "numTurns must be an integer >= 1.",
          });
        }
        const nextLength = Math.max(0, ctx.turns.length - numTurns);
        ctx.turns.splice(nextLength);
        return { threadId, turns: ctx.turns };
      });

    const stopSession: CursorAdapterShape["stopSession"] = (threadId) =>
      withThreadLock(
        threadId,
        Effect.gen(function* () {
          const ctx = yield* requireSession(threadId);
          yield* stopSessionInternal(ctx);
        }),
      );

    const listSessions: CursorAdapterShape["listSessions"] = () =>
      Effect.sync(() => Array.from(sessions.values(), (c) => ({ ...c.session })));

    const hasSession: CursorAdapterShape["hasSession"] = (threadId) =>
      Effect.sync(() => {
        const c = sessions.get(threadId);
        return c !== undefined && !c.stopped;
      });

    const stopAll: CursorAdapterShape["stopAll"] = () =>
      Effect.forEach(sessions.values(), stopSessionInternal, { discard: true });

    yield* Effect.addFinalizer(() =>
      Effect.forEach(sessions.values(), stopSessionInternal, { discard: true }).pipe(
        Effect.tap(() => PubSub.shutdown(runtimeEventPubSub)),
        Effect.tap(() => managedNativeEventLogger?.close() ?? Effect.void),
      ),
    );

    const streamEvents = Stream.fromPubSub(runtimeEventPubSub);

    return {
      provider: PROVIDER,
      capabilities: { sessionModelSwitch: "in-session" },
      startSession,
      sendTurn,
      interruptTurn,
      readThread,
      rollbackThread,
      respondToRequest,
      respondToUserInput,
      stopSession,
      listSessions,
      hasSession,
      stopAll,
      streamEvents,
    } satisfies CursorAdapterShape;
  });
}

export const CursorAdapterLive = Layer.effect(CursorAdapter, makeCursorAdapter());

export function makeCursorAdapterLive(opts?: CursorAdapterLiveOptions) {
  return Layer.effect(CursorAdapter, makeCursorAdapter(opts));
}
