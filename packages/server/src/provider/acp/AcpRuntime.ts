import { Cause, Deferred, Effect, Exit, Layer, Queue, Ref, Scope, Context, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import * as EffectAcpClient from "effect-acp/client";
import * as EffectAcpErrors from "effect-acp/errors";
import type * as EffectAcpSchema from "effect-acp/schema";
import type * as EffectAcpProtocol from "effect-acp/protocol";

import {
  configOptionCurrentValueMatches,
  configOptionsWithCurrentValue,
  extractModelConfigId,
  findSessionConfigOption,
  sessionConfigOptionsFromSetup,
  validateSessionConfigOptionValue,
} from "./AcpConfigOption.ts";
import {
  closeActiveAssistantSegment,
  handleSessionUpdate,
  initialAcpAssistantSegmentState,
  type AcpAssistantSegmentState,
  type AcpParsedSessionEvent,
} from "./AcpEvent.ts";
import { parseSessionModeState, updateModeState, type AcpSessionModeState } from "./AcpSession.ts";
import type { AcpToolCallState } from "./AcpTool.ts";

export interface AcpSpawnInput {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
}

export interface AcpRuntimeOptions {
  readonly spawn: AcpSpawnInput;
  readonly cwd: string;
  readonly resumeSessionId?: string;
  readonly clientCapabilities?: EffectAcpSchema.InitializeRequest["clientCapabilities"];
  readonly clientInfo: {
    readonly name: string;
    readonly version: string;
  };
  readonly authMethodId: string;
  readonly requestLogger?: (event: AcpRequestLogEvent) => Effect.Effect<void, never>;
  readonly protocolLogging?: {
    readonly logIncoming?: boolean;
    readonly logOutgoing?: boolean;
    readonly logger?: (event: EffectAcpProtocol.AcpProtocolLogEvent) => Effect.Effect<void, never>;
  };
}

export interface AcpRequestLogEvent {
  readonly method: string;
  readonly payload: unknown;
  readonly status: "started" | "succeeded" | "failed";
  readonly result?: unknown;
  readonly cause?: Cause.Cause<EffectAcpErrors.AcpError>;
}

export interface AcpRuntimeStartResult {
  readonly sessionId: string;
  readonly initializeResult: EffectAcpSchema.InitializeResponse;
  readonly sessionSetupResult:
    | EffectAcpSchema.LoadSessionResponse
    | EffectAcpSchema.NewSessionResponse
    | EffectAcpSchema.ResumeSessionResponse;
  readonly modelConfigId: string | undefined;
}

export interface AcpRuntimeShape {
  readonly handleRequestPermission: EffectAcpClient.AcpClientShape["handleRequestPermission"];
  readonly handleElicitation: EffectAcpClient.AcpClientShape["handleElicitation"];
  readonly handleReadTextFile: EffectAcpClient.AcpClientShape["handleReadTextFile"];
  readonly handleWriteTextFile: EffectAcpClient.AcpClientShape["handleWriteTextFile"];
  readonly handleCreateTerminal: EffectAcpClient.AcpClientShape["handleCreateTerminal"];
  readonly handleTerminalOutput: EffectAcpClient.AcpClientShape["handleTerminalOutput"];
  readonly handleTerminalWaitForExit: EffectAcpClient.AcpClientShape["handleTerminalWaitForExit"];
  readonly handleTerminalKill: EffectAcpClient.AcpClientShape["handleTerminalKill"];
  readonly handleTerminalRelease: EffectAcpClient.AcpClientShape["handleTerminalRelease"];
  readonly handleSessionUpdate: EffectAcpClient.AcpClientShape["handleSessionUpdate"];
  readonly handleElicitationComplete: EffectAcpClient.AcpClientShape["handleElicitationComplete"];
  readonly handleUnknownExtRequest: EffectAcpClient.AcpClientShape["handleUnknownExtRequest"];
  readonly handleUnknownExtNotification: EffectAcpClient.AcpClientShape["handleUnknownExtNotification"];
  readonly handleExtRequest: EffectAcpClient.AcpClientShape["handleExtRequest"];
  readonly handleExtNotification: EffectAcpClient.AcpClientShape["handleExtNotification"];
  readonly start: () => Effect.Effect<AcpRuntimeStartResult, EffectAcpErrors.AcpError>;
  readonly getEvents: () => Stream.Stream<AcpParsedSessionEvent, never>;
  readonly getModeState: Effect.Effect<AcpSessionModeState | undefined>;
  readonly getConfigOptions: Effect.Effect<ReadonlyArray<EffectAcpSchema.SessionConfigOption>>;
  readonly prompt: (
    payload: Omit<EffectAcpSchema.PromptRequest, "sessionId">,
  ) => Effect.Effect<EffectAcpSchema.PromptResponse, EffectAcpErrors.AcpError>;
  readonly cancel: Effect.Effect<void, EffectAcpErrors.AcpError>;
  readonly setMode: (
    modeId: string,
  ) => Effect.Effect<EffectAcpSchema.SetSessionModeResponse, EffectAcpErrors.AcpError>;
  readonly setConfigOption: (
    configId: string,
    value: string | boolean,
  ) => Effect.Effect<EffectAcpSchema.SetSessionConfigOptionResponse, EffectAcpErrors.AcpError>;
  readonly setModel: (model: string) => Effect.Effect<void, EffectAcpErrors.AcpError>;
  readonly request: (
    method: string,
    payload: unknown,
  ) => Effect.Effect<unknown, EffectAcpErrors.AcpError>;
  readonly notify: (
    method: string,
    payload: unknown,
  ) => Effect.Effect<void, EffectAcpErrors.AcpError>;
}

interface AcpStartedState extends AcpRuntimeStartResult {}

type AcpStartState =
  | { readonly _tag: "NotStarted" }
  | {
      readonly _tag: "Starting";
      readonly deferred: Deferred.Deferred<AcpRuntimeStartResult, EffectAcpErrors.AcpError>;
    }
  | { readonly _tag: "Started"; readonly result: AcpStartedState };

export class AcpRuntime extends Context.Service<AcpRuntime, AcpRuntimeShape>()(
  "t3/provider/acp/AcpRuntime",
) {
  static layer(
    options: AcpRuntimeOptions,
  ): Layer.Layer<AcpRuntime, EffectAcpErrors.AcpError, ChildProcessSpawner.ChildProcessSpawner> {
    return Layer.effect(AcpRuntime, makeAcpRuntime(options));
  }
}

const makeAcpRuntime = (
  options: AcpRuntimeOptions,
): Effect.Effect<
  AcpRuntimeShape,
  EffectAcpErrors.AcpError,
  ChildProcessSpawner.ChildProcessSpawner | Scope.Scope
> =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const runtimeScope = yield* Scope.Scope;
    const eventQueue = yield* Queue.unbounded<AcpParsedSessionEvent>();
    const modeStateRef = yield* Ref.make<AcpSessionModeState | undefined>(undefined);
    const toolCallsRef = yield* Ref.make(new Map<string, AcpToolCallState>());
    const assistantSegmentRef = yield* Ref.make<AcpAssistantSegmentState>(
      initialAcpAssistantSegmentState(),
    );
    const configOptionsRef = yield* Ref.make(sessionConfigOptionsFromSetup(undefined));
    const startStateRef = yield* Ref.make<AcpStartState>({ _tag: "NotStarted" });

    const logRequest = (event: AcpRequestLogEvent) =>
      options.requestLogger ? options.requestLogger(event) : Effect.void;

    const runLoggedRequest = <A>(
      method: string,
      payload: unknown,
      effect: Effect.Effect<A, EffectAcpErrors.AcpError>,
    ): Effect.Effect<A, EffectAcpErrors.AcpError> =>
      logRequest({ method, payload, status: "started" }).pipe(
        Effect.flatMap(() =>
          effect.pipe(
            Effect.tap((result) =>
              logRequest({
                method,
                payload,
                status: "succeeded",
                result,
              }),
            ),
            Effect.onError((cause) =>
              logRequest({
                method,
                payload,
                status: "failed",
                cause,
              }),
            ),
          ),
        ),
      );

    const child = yield* spawner
      .spawn(
        ChildProcess.make(options.spawn.command, [...options.spawn.args], {
          ...(options.spawn.cwd ? { cwd: options.spawn.cwd } : {}),
          ...(options.spawn.env ? { env: { ...process.env, ...options.spawn.env } } : {}),
          detached: false,
          forceKillAfter: "2 seconds",
          shell: process.platform === "win32",
        }),
      )
      .pipe(
        Effect.provideService(Scope.Scope, runtimeScope),
        Effect.mapError(
          (cause) =>
            new EffectAcpErrors.AcpSpawnError({
              command: options.spawn.command,
              cause,
            }),
        ),
      );

    const acpContext = yield* Layer.build(
      EffectAcpClient.layerChildProcess(child, {
        ...(options.protocolLogging?.logIncoming !== undefined
          ? { logIncoming: options.protocolLogging.logIncoming }
          : {}),
        ...(options.protocolLogging?.logOutgoing !== undefined
          ? { logOutgoing: options.protocolLogging.logOutgoing }
          : {}),
        ...(options.protocolLogging?.logger ? { logger: options.protocolLogging.logger } : {}),
      }),
    ).pipe(Effect.provideService(Scope.Scope, runtimeScope));

    const acp = yield* Effect.service(EffectAcpClient.AcpClient).pipe(Effect.provide(acpContext));

    yield* acp.handleSessionUpdate((notification) =>
      handleSessionUpdate({
        queue: eventQueue,
        modeStateRef,
        toolCallsRef,
        assistantSegmentRef,
        params: notification,
      }),
    );

    const initializeClientCapabilities = {
      fs: {
        readTextFile: false,
        writeTextFile: false,
        ...options.clientCapabilities?.fs,
      },
      terminal: options.clientCapabilities?.terminal ?? false,
      ...(options.clientCapabilities?.auth ? { auth: options.clientCapabilities.auth } : {}),
      ...(options.clientCapabilities?.elicitation
        ? { elicitation: options.clientCapabilities.elicitation }
        : {}),
      ...(options.clientCapabilities?._meta ? { _meta: options.clientCapabilities._meta } : {}),
    } satisfies NonNullable<EffectAcpSchema.InitializeRequest["clientCapabilities"]>;

    const getStartedState = Effect.gen(function* () {
      const state = yield* Ref.get(startStateRef);
      if (state._tag === "Started") {
        return state.result;
      }
      return yield* new EffectAcpErrors.AcpTransportError({
        detail: "ACP runtime has not been started",
        cause: new Error("ACP runtime has not been started"),
      });
    });

    const updateConfigOptionsAfterSuccessfulWrite = (
      configId: string,
      value: string | boolean,
      response: EffectAcpSchema.SetSessionConfigOptionResponse,
    ): Effect.Effect<void> =>
      Ref.update(configOptionsRef, (currentOptions) => {
        const responseOptions = sessionConfigOptionsFromSetup(response);
        const nextOptions = responseOptions.length > 0 ? responseOptions : currentOptions;
        return configOptionsWithCurrentValue(nextOptions, configId, value);
      });

    const updateCurrentModeId = (modeId: string): Effect.Effect<void> =>
      Ref.update(modeStateRef, (current) => (current ? updateModeState(current, modeId) : current));

    const setConfigOption = (
      configId: string,
      value: string | boolean,
    ): Effect.Effect<EffectAcpSchema.SetSessionConfigOptionResponse, EffectAcpErrors.AcpError> =>
      Ref.get(configOptionsRef).pipe(
        Effect.flatMap((configOptions) =>
          validateSessionConfigOptionValue({ configOptions, configId, value }),
        ),
        Effect.flatMap(() => getStartedState),
        Effect.flatMap((started) =>
          Ref.get(configOptionsRef).pipe(
            Effect.flatMap((configOptions) => {
              const existing = findSessionConfigOption(configOptions, configId);
              if (existing && configOptionCurrentValueMatches(existing, value)) {
                return Effect.succeed({
                  configOptions,
                } satisfies EffectAcpSchema.SetSessionConfigOptionResponse);
              }
              const requestPayload =
                typeof value === "boolean"
                  ? ({
                      sessionId: started.sessionId,
                      configId,
                      type: "boolean",
                      value,
                    } satisfies EffectAcpSchema.SetSessionConfigOptionRequest)
                  : ({
                      sessionId: started.sessionId,
                      configId,
                      value: String(value),
                    } satisfies EffectAcpSchema.SetSessionConfigOptionRequest);
              return runLoggedRequest(
                "session/set_config_option",
                requestPayload,
                acp.agent.setSessionConfigOption(requestPayload),
              ).pipe(
                Effect.tap((response) =>
                  updateConfigOptionsAfterSuccessfulWrite(configId, value, response),
                ),
              );
            }),
          ),
        ),
      );

    const startOnce = Effect.gen(function* () {
      const initializePayload = {
        protocolVersion: 1,
        clientCapabilities: initializeClientCapabilities,
        clientInfo: options.clientInfo,
      } satisfies EffectAcpSchema.InitializeRequest;

      const initializeResult = yield* runLoggedRequest(
        "initialize",
        initializePayload,
        acp.agent.initialize(initializePayload),
      );

      const authenticatePayload = {
        methodId: options.authMethodId,
      } satisfies EffectAcpSchema.AuthenticateRequest;

      yield* runLoggedRequest(
        "authenticate",
        authenticatePayload,
        acp.agent.authenticate(authenticatePayload),
      );

      let sessionId: string;
      let sessionSetupResult:
        | EffectAcpSchema.LoadSessionResponse
        | EffectAcpSchema.NewSessionResponse
        | EffectAcpSchema.ResumeSessionResponse;
      if (options.resumeSessionId) {
        const loadPayload = {
          sessionId: options.resumeSessionId,
          cwd: options.cwd,
          mcpServers: [],
        } satisfies EffectAcpSchema.LoadSessionRequest;
        const resumed = yield* runLoggedRequest(
          "session/load",
          loadPayload,
          acp.agent.loadSession(loadPayload),
        ).pipe(Effect.exit);
        if (Exit.isSuccess(resumed)) {
          sessionId = options.resumeSessionId;
          sessionSetupResult = resumed.value;
        } else {
          const createPayload = {
            cwd: options.cwd,
            mcpServers: [],
          } satisfies EffectAcpSchema.NewSessionRequest;
          const created = yield* runLoggedRequest(
            "session/new",
            createPayload,
            acp.agent.createSession(createPayload),
          );
          sessionId = created.sessionId;
          sessionSetupResult = created;
        }
      } else {
        const createPayload = {
          cwd: options.cwd,
          mcpServers: [],
        } satisfies EffectAcpSchema.NewSessionRequest;
        const created = yield* runLoggedRequest(
          "session/new",
          createPayload,
          acp.agent.createSession(createPayload),
        );
        sessionId = created.sessionId;
        sessionSetupResult = created;
      }

      yield* Ref.set(modeStateRef, parseSessionModeState(sessionSetupResult));
      yield* Ref.set(configOptionsRef, sessionConfigOptionsFromSetup(sessionSetupResult));

      const nextState = {
        sessionId,
        initializeResult,
        sessionSetupResult,
        modelConfigId: extractModelConfigId(sessionSetupResult),
      } satisfies AcpStartedState;
      return nextState;
    });

    const start = Effect.gen(function* () {
      const deferred = yield* Deferred.make<AcpRuntimeStartResult, EffectAcpErrors.AcpError>();
      const effect = yield* Ref.modify(startStateRef, (state) => {
        switch (state._tag) {
          case "Started":
            return [Effect.succeed(state.result), state] as const;
          case "Starting":
            return [Deferred.await(state.deferred), state] as const;
          case "NotStarted":
            return [
              startOnce.pipe(
                Effect.tap((result) =>
                  Ref.set(startStateRef, { _tag: "Started", result }).pipe(
                    Effect.andThen(Deferred.succeed(deferred, result)),
                  ),
                ),
                Effect.onError((cause) =>
                  Deferred.failCause(deferred, cause).pipe(
                    Effect.andThen(Ref.set(startStateRef, { _tag: "NotStarted" })),
                  ),
                ),
              ),
              { _tag: "Starting", deferred } satisfies AcpStartState,
            ] as const;
        }
      });
      return yield* effect;
    });

    return {
      handleRequestPermission: acp.handleRequestPermission,
      handleElicitation: acp.handleElicitation,
      handleReadTextFile: acp.handleReadTextFile,
      handleWriteTextFile: acp.handleWriteTextFile,
      handleCreateTerminal: acp.handleCreateTerminal,
      handleTerminalOutput: acp.handleTerminalOutput,
      handleTerminalWaitForExit: acp.handleTerminalWaitForExit,
      handleTerminalKill: acp.handleTerminalKill,
      handleTerminalRelease: acp.handleTerminalRelease,
      handleSessionUpdate: acp.handleSessionUpdate,
      handleElicitationComplete: acp.handleElicitationComplete,
      handleUnknownExtRequest: acp.handleUnknownExtRequest,
      handleUnknownExtNotification: acp.handleUnknownExtNotification,
      handleExtRequest: acp.handleExtRequest,
      handleExtNotification: acp.handleExtNotification,
      start: () => start,
      getEvents: () => Stream.fromQueue(eventQueue),
      getModeState: Ref.get(modeStateRef),
      getConfigOptions: Ref.get(configOptionsRef),
      prompt: (payload) =>
        getStartedState.pipe(
          Effect.flatMap((started) => {
            const requestPayload = {
              sessionId: started.sessionId,
              ...payload,
            } satisfies EffectAcpSchema.PromptRequest;
            return closeActiveAssistantSegment({
              queue: eventQueue,
              assistantSegmentRef,
            }).pipe(
              Effect.andThen(
                runLoggedRequest(
                  "session/prompt",
                  requestPayload,
                  acp.agent.prompt(requestPayload),
                ),
              ),
              Effect.tap(() =>
                closeActiveAssistantSegment({
                  queue: eventQueue,
                  assistantSegmentRef,
                }),
              ),
            );
          }),
        ),
      cancel: getStartedState.pipe(
        Effect.flatMap((started) => acp.agent.cancel({ sessionId: started.sessionId })),
      ),
      setMode: (modeId) =>
        Ref.get(modeStateRef).pipe(
          Effect.flatMap((modeState) => {
            if (modeState?.currentModeId === modeId) {
              return Effect.succeed({} satisfies EffectAcpSchema.SetSessionModeResponse);
            }
            return getStartedState.pipe(
              Effect.flatMap((started) => {
                const requestPayload = {
                  sessionId: started.sessionId,
                  modeId,
                } satisfies EffectAcpSchema.SetSessionModeRequest;
                return runLoggedRequest(
                  "session/set_mode",
                  requestPayload,
                  acp.agent.setSessionMode(requestPayload),
                ).pipe(
                  Effect.tap(() => updateCurrentModeId(modeId)),
                  Effect.as({} satisfies EffectAcpSchema.SetSessionModeResponse),
                );
              }),
            );
          }),
        ),
      setConfigOption,
      setModel: (model) =>
        getStartedState.pipe(
          Effect.flatMap((started) => {
            const modelConfigId = started.modelConfigId ?? "model";
            const requestPayload = {
              sessionId: started.sessionId,
              modelId: model,
            } satisfies EffectAcpSchema.SetSessionModelRequest;
            return runLoggedRequest(
              "session/set_model",
              requestPayload,
              acp.agent.setSessionModel(requestPayload),
            ).pipe(
              Effect.tap(() =>
                Ref.update(configOptionsRef, (current) =>
                  configOptionsWithCurrentValue(current, modelConfigId, model),
                ),
              ),
              Effect.asVoid,
            );
          }),
        ),
      request: (method, payload) =>
        runLoggedRequest(method, payload, acp.raw.request(method, payload)),
      notify: acp.raw.notify,
    } satisfies AcpRuntimeShape;
  });
