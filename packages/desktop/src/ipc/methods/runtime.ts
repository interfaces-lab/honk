import {
  AgentCredentialConfigureInput,
  AgentPreferences,
  AgentPreferencesPatch,
  DesktopExtensionUiRespondInput,
  HonkRuntimeHostEvent,
  HonkRuntimeHostSnapshot,
  RuntimeGetThreadSessionFileInput,
  RuntimeGetThreadSessionFileResult,
  RuntimeListSkillsInput,
  RuntimeListSkillsResult,
  ThreadAgentRuntimeAbortInput,
  ThreadAgentRuntimeCompactInput,
  ThreadAgentRuntimeHydrateInput,
  ThreadAgentRuntimeSetThreadFocusInput,
  ThreadAgentRuntimeSendTurnInput,
  TurnId,
} from "@honk/contracts";
import type { DesktopRuntimeHost } from "@honk/runtime";
import * as EffectLogger from "@honk/shared/effect-logger";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as DesktopAppIdentity from "../../app/desktop-app-identity";
import * as DesktopEnvironment from "../../app/desktop-environment";
import * as ElectronShell from "../../electron/electron-shell";
import * as ElectronWindow from "../../electron/electron-window";
import * as IpcChannels from "../channels";
import { makeIpcMethod } from "../desktop-ipc";
import { ingestRuntimeHostEvent, installRuntimeIngestion } from "../../runtime/runtime-ingestion";

export { installRuntimeIngestion };

let runtimeHost: DesktopRuntimeHost | null = null;
const encodeHostEvent = Schema.encodeUnknownSync(HonkRuntimeHostEvent);
const elog = EffectLogger.create({ service: "desktop.runtime.ipc" });

const getRuntimeHost = Effect.gen(function* () {
  if (runtimeHost) {
    return runtimeHost;
  }

  const appIdentity = yield* DesktopAppIdentity.DesktopAppIdentity;
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const userDataPath = yield* appIdentity.resolveUserDataPath;
  const Runtime = yield* Effect.promise(() => import("@honk/runtime"));
  runtimeHost = new Runtime.DesktopRuntimeHost({
    agentDir: environment.path.join(userDataPath, "pi-agent"),
  });
  yield* elog.info("runtime host created");
  return runtimeHost;
});

const requireRuntimeHost = Effect.flatMap(getRuntimeHost, (host) =>
  host ? Effect.succeed(host) : Effect.die(new Error("Desktop runtime host is unavailable.")),
);

const logRuntimeFailure = (
  message: string,
  input: { readonly threadId?: string },
  error: unknown,
) =>
  elog.error(message, {
    ...(input.threadId ? { threadId: input.threadId } : {}),
    cause: error instanceof Error ? error.message : String(error),
  });

export const installRuntimeHostEventBridge = Effect.acquireRelease(
  Effect.gen(function* () {
    const electronWindow = yield* ElectronWindow.ElectronWindow;
    const host = yield* getRuntimeHost;
    const unsubscribe = host.onHostEvent((event) => {
      if (event.type === "runtime-event" && event.event.type === "runtime.error") {
        void Effect.runPromise(
          elog.error("runtime host reported error", {
            threadId: event.event.threadId,
            runtimeSessionId: event.event.runtimeSessionId,
            turnId: event.event.turnId,
            detail: event.event.summary ?? event.event.text,
          }),
        );
      }
      ingestRuntimeHostEvent(event);
      Effect.runSync(
        electronWindow.sendAll(IpcChannels.RUNTIME_HOST_EVENT_CHANNEL, encodeHostEvent(event)),
      );
    });
    void host
      .getHostSnapshot()
      .then((snapshot) => ingestRuntimeHostEvent({ type: "snapshot", snapshot }))
      .catch((error: unknown) => {
        void Effect.runPromise(
          elog.error("failed to ingest runtime host snapshot", {
            cause: error instanceof Error ? error.message : String(error),
          }),
        );
      });
    return unsubscribe;
  }),
  (unsubscribe) => Effect.sync(unsubscribe),
);

export const getRuntimeHostSnapshot = makeIpcMethod({
  channel: IpcChannels.RUNTIME_GET_HOST_SNAPSHOT_CHANNEL,
  payload: Schema.Void,
  result: HonkRuntimeHostSnapshot,
  handler: () =>
    Effect.flatMap(requireRuntimeHost, (host) => Effect.promise(() => host.getHostSnapshot())),
});

export const getRuntimePreferences = makeIpcMethod({
  channel: IpcChannels.RUNTIME_GET_PREFERENCES_CHANNEL,
  payload: Schema.Void,
  result: AgentPreferences,
  handler: () =>
    Effect.flatMap(requireRuntimeHost, (host) => Effect.promise(() => host.getPreferences())),
});

export const updateRuntimePreferences = makeIpcMethod({
  channel: IpcChannels.RUNTIME_UPDATE_PREFERENCES_CHANNEL,
  payload: AgentPreferencesPatch,
  result: AgentPreferences,
  handler: (patch) =>
    Effect.flatMap(requireRuntimeHost, (host) =>
      Effect.promise(() => host.updatePreferences(patch)),
    ),
});

function createRuntimeCredentialLoginCallbacks(
  shell: ElectronShell.ElectronShellShape,
): Parameters<DesktopRuntimeHost["configureCredential"]>[1] {
  return {
    onAuth: (info) => {
      void Effect.runPromise(shell.openExternal(info.url));
    },
    onDeviceCode: (info) => {
      void Effect.runPromise(shell.copyText(info.userCode));
      void Effect.runPromise(shell.openExternal(info.verificationUri));
    },
    onPrompt: async () => {
      throw new Error("This OAuth login prompt is not available in the desktop settings window.");
    },
    onProgress: () => undefined,
    onSelect: async (prompt) =>
      prompt.options.find((option) => option.id === "device_code")?.id ?? prompt.options[0]?.id,
  };
}

export const configureRuntimeCredential = makeIpcMethod({
  channel: IpcChannels.RUNTIME_CONFIGURE_CREDENTIAL_CHANNEL,
  payload: AgentCredentialConfigureInput,
  result: HonkRuntimeHostSnapshot,
  handler: (input) =>
    Effect.gen(function* () {
      yield* elog.info("runtime credential configure started", {
        authProviderId: input.authProviderId,
      });
      const host = yield* requireRuntimeHost;
      const shell = yield* ElectronShell.ElectronShell;
      const callbacks = createRuntimeCredentialLoginCallbacks(shell);
      return yield* Effect.tryPromise(() => host.configureCredential(input, callbacks)).pipe(
        Effect.tapError((error: unknown) =>
          elog.error("runtime credential configure failed", {
            authProviderId: input.authProviderId,
            cause: error instanceof Error ? error.message : String(error),
          }),
        ),
      );
    }),
});

export const hydrateRuntimeThread = makeIpcMethod({
  channel: IpcChannels.RUNTIME_HYDRATE_THREAD_CHANNEL,
  payload: ThreadAgentRuntimeHydrateInput,
  result: Schema.Void,
  handler: (input) =>
    Effect.gen(function* () {
      yield* elog.info("runtime thread hydrate started", { threadId: input.threadId });
      const host = yield* requireRuntimeHost;
      yield* Effect.promise(() => host.hydrateThread(input)).pipe(
        Effect.tapError((error) =>
          logRuntimeFailure("runtime thread hydrate failed", input, error),
        ),
      );
    }),
});

export const setRuntimeThreadFocus = makeIpcMethod({
  channel: IpcChannels.RUNTIME_SET_THREAD_FOCUS_CHANNEL,
  payload: ThreadAgentRuntimeSetThreadFocusInput,
  result: Schema.Void,
  handler: (input) =>
    Effect.gen(function* () {
      const host = yield* requireRuntimeHost;
      yield* Effect.promise(() => host.setThreadFocus(input)).pipe(
        Effect.tapError((error) =>
          logRuntimeFailure("runtime thread focus update failed", input, error),
        ),
      );
    }),
});

export const sendRuntimeTurn = makeIpcMethod({
  channel: IpcChannels.RUNTIME_SEND_TURN_CHANNEL,
  payload: ThreadAgentRuntimeSendTurnInput,
  result: TurnId,
  handler: (input) =>
    Effect.gen(function* () {
      yield* elog.info("runtime turn send started", { threadId: input.threadId });
      const host = yield* requireRuntimeHost;
      const turnId = yield* Effect.promise(() => host.sendTurn(input)).pipe(
        Effect.tapError((error) => logRuntimeFailure("runtime turn send failed", input, error)),
      );
      yield* elog.debug("runtime turn send completed", { threadId: input.threadId, turnId });
      return turnId;
    }),
});

export const compactRuntimeThread = makeIpcMethod({
  channel: IpcChannels.RUNTIME_COMPACT_THREAD_CHANNEL,
  payload: ThreadAgentRuntimeCompactInput,
  result: Schema.Void,
  handler: (input) =>
    Effect.gen(function* () {
      yield* elog.info("runtime thread compact started", { threadId: input.threadId });
      const host = yield* requireRuntimeHost;
      yield* Effect.promise(() => host.compactThread(input)).pipe(
        Effect.tapError((error) => logRuntimeFailure("runtime thread compact failed", input, error)),
      );
      yield* elog.debug("runtime thread compact completed", { threadId: input.threadId });
    }),
});

export const abortRuntimeThread = makeIpcMethod({
  channel: IpcChannels.RUNTIME_ABORT_CHANNEL,
  payload: ThreadAgentRuntimeAbortInput,
  result: Schema.Void,
  handler: (input) =>
    Effect.gen(function* () {
      yield* elog.info("runtime thread abort started", { threadId: input.threadId });
      const host = yield* requireRuntimeHost;
      yield* Effect.promise(() => host.abort(input)).pipe(
        Effect.tapError((error) => logRuntimeFailure("runtime thread abort failed", input, error)),
      );
    }),
});

export const respondToRuntimeExtensionUiRequest = makeIpcMethod({
  channel: IpcChannels.RUNTIME_RESPOND_EXTENSION_UI_CHANNEL,
  payload: DesktopExtensionUiRespondInput,
  result: Schema.Void,
  handler: (input) =>
    Effect.gen(function* () {
      yield* elog.debug("runtime extension ui response", { threadId: input.threadId });
      const host = yield* requireRuntimeHost;
      yield* Effect.promise(() => host.respondToExtensionUiRequest(input)).pipe(
        Effect.tapError((error) =>
          logRuntimeFailure("runtime extension ui response failed", input, error),
        ),
      );
    }),
});

export const listRuntimeSkills = makeIpcMethod({
  channel: IpcChannels.RUNTIME_LIST_SKILLS_CHANNEL,
  payload: RuntimeListSkillsInput,
  result: RuntimeListSkillsResult,
  handler: (input) =>
    Effect.gen(function* () {
      const host = yield* requireRuntimeHost;
      return yield* Effect.promise(() => host.listSkills(input)).pipe(
        Effect.tapError((error: unknown) =>
          elog.error("runtime skills list failed", {
            cwd: input.cwd,
            cause: error instanceof Error ? error.message : String(error),
          }),
        ),
      );
    }),
});

export const getRuntimeThreadSessionFile = makeIpcMethod({
  channel: IpcChannels.RUNTIME_GET_THREAD_SESSION_FILE_CHANNEL,
  payload: RuntimeGetThreadSessionFileInput,
  result: RuntimeGetThreadSessionFileResult,
  handler: (input) =>
    Effect.gen(function* () {
      const host = yield* requireRuntimeHost;
      return yield* Effect.promise(() => host.getThreadSessionFile(input)).pipe(
        Effect.tapError((error) =>
          logRuntimeFailure("runtime thread session file lookup failed", input, error),
        ),
      );
    }),
});
