import {
  AgentCredentialConfigureInput,
  DesktopExtensionUiRespondInput,
  HonkRuntimeHostEvent,
  HonkRuntimeHostSnapshot,
  RuntimeGetThreadSessionFileInput,
  RuntimeGetThreadSessionFileResult,
  RuntimeListSkillsInput,
  RuntimeListSkillsResult,
  ThreadAgentRuntimeCloneInput,
  ThreadAgentRuntimeAbortInput,
  ThreadAgentRuntimeCompactInput,
  ThreadAgentRuntimeHydrateInput,
  ThreadAgentRuntimeQueueFollowUpInput,
  ThreadAgentRuntimeQueuedFollowUpIdInput,
  ThreadAgentRuntimeReorderQueuedFollowUpInput,
  ThreadAgentRuntimeSetThreadFocusInput,
  ThreadAgentRuntimeSendTurnInput,
  ThreadAgentRuntimeUpdateQueuedFollowUpInput,
  TurnId,
} from "@honk/contracts";
import {
  AgentPreferences,
  AgentPreferencesPatch,
} from "@honk/shared/agent-model-policy";
import type { BrowserAutomationController } from "@honk/shared/browser-automation";
import type { DesktopRuntimeHost } from "@honk/runtime";
import * as EffectLogger from "@honk/shared/effect-logger";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import * as DesktopAppIdentity from "../../app/desktop-app-identity";
import * as DesktopEnvironment from "../../app/desktop-environment";
import * as DesktopBrowserAutomation from "../../browser/browser-automation";
import * as ElectronShell from "../../electron/electron-shell";
import * as ElectronWindow from "../../electron/electron-window";
import * as IpcChannels from "../channels";
import { makeIpcMethod } from "../desktop-ipc";
import { ingestRuntimeHostEvent, installRuntimeIngestion } from "../../runtime/runtime-ingestion";

export { installRuntimeIngestion };

let runtimeHost: DesktopRuntimeHost | null = null;
const encodeHostEvent = Schema.encodeUnknownSync(HonkRuntimeHostEvent);
const elog = EffectLogger.create({ service: "desktop.runtime.ipc" });

function browserAutomationControllerFor(
  browserAutomation: DesktopBrowserAutomation.DesktopBrowserAutomationShape,
): BrowserAutomationController {
  return {
    status: (threadId) => Effect.runPromise(browserAutomation.status(threadId)),
    open: (threadId, input) => Effect.runPromise(browserAutomation.open(threadId, input)),
    navigate: (threadId, input) => Effect.runPromise(browserAutomation.navigate(threadId, input)),
    snapshot: (threadId) => Effect.runPromise(browserAutomation.snapshot(threadId)),
    click: (threadId, input) => Effect.runPromise(browserAutomation.click(threadId, input)),
    type: (threadId, input) => Effect.runPromise(browserAutomation.type(threadId, input)),
    press: (threadId, input) => Effect.runPromise(browserAutomation.press(threadId, input)),
    scroll: (threadId, input) => Effect.runPromise(browserAutomation.scroll(threadId, input)),
    evaluate: (threadId, input) => Effect.runPromise(browserAutomation.evaluate(threadId, input)),
    waitFor: (threadId, input) => Effect.runPromise(browserAutomation.waitFor(threadId, input)),
  };
}

const getRuntimeHost = Effect.gen(function* () {
  if (runtimeHost) {
    return runtimeHost;
  }

  const appIdentity = yield* DesktopAppIdentity.DesktopAppIdentity;
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const browserAutomation = yield* DesktopBrowserAutomation.DesktopBrowserAutomation;
  const userDataPath = yield* appIdentity.resolveUserDataPath;
  const Runtime = yield* Effect.promise(() => import("@honk/runtime"));
  runtimeHost = new Runtime.DesktopRuntimeHost({
    agentDir: environment.path.join(userDataPath, "pi-agent"),
    browserAutomation: browserAutomationControllerFor(browserAutomation),
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
      if (event.type === "runtime-ingestion-records") {
        return;
      }
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
  trace: false,
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

export const cloneRuntimeThread = makeIpcMethod({
  channel: IpcChannels.RUNTIME_CLONE_THREAD_CHANNEL,
  payload: ThreadAgentRuntimeCloneInput,
  result: Schema.Void,
  handler: (input) =>
    Effect.gen(function* () {
      yield* elog.info("runtime thread clone started", {
        threadId: input.sourceThreadId,
        targetThreadId: input.targetThreadId,
      });
      const host = yield* requireRuntimeHost;
      yield* Effect.promise(() => host.cloneThread(input)).pipe(
        Effect.tapError((error) =>
          logRuntimeFailure(
            "runtime thread clone failed",
            { threadId: input.sourceThreadId },
            error,
          ),
        ),
      );
      yield* elog.debug("runtime thread clone completed", {
        threadId: input.sourceThreadId,
        targetThreadId: input.targetThreadId,
      });
    }),
});

export const setRuntimeThreadFocus = makeIpcMethod({
  channel: IpcChannels.RUNTIME_SET_THREAD_FOCUS_CHANNEL,
  payload: ThreadAgentRuntimeSetThreadFocusInput,
  result: Schema.Void,
  trace: false,
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

export const enqueueRuntimeFollowUp = makeIpcMethod({
  channel: IpcChannels.RUNTIME_ENQUEUE_FOLLOW_UP_CHANNEL,
  payload: ThreadAgentRuntimeQueueFollowUpInput,
  result: Schema.Void,
  handler: (input) =>
    Effect.gen(function* () {
      const host = yield* requireRuntimeHost;
      yield* Effect.promise(() => host.enqueueFollowUp(input)).pipe(
        Effect.tapError((error) =>
          logRuntimeFailure("runtime follow-up enqueue failed", input, error),
        ),
      );
    }),
});

export const updateQueuedRuntimeFollowUp = makeIpcMethod({
  channel: IpcChannels.RUNTIME_UPDATE_QUEUED_FOLLOW_UP_CHANNEL,
  payload: ThreadAgentRuntimeUpdateQueuedFollowUpInput,
  result: Schema.Void,
  handler: (input) =>
    Effect.gen(function* () {
      const host = yield* requireRuntimeHost;
      yield* Effect.promise(() => host.updateQueuedFollowUp(input)).pipe(
        Effect.tapError((error) =>
          logRuntimeFailure("runtime queued follow-up update failed", input, error),
        ),
      );
    }),
});

export const removeQueuedRuntimeFollowUp = makeIpcMethod({
  channel: IpcChannels.RUNTIME_REMOVE_QUEUED_FOLLOW_UP_CHANNEL,
  payload: ThreadAgentRuntimeQueuedFollowUpIdInput,
  result: Schema.Void,
  handler: (input) =>
    Effect.gen(function* () {
      const host = yield* requireRuntimeHost;
      yield* Effect.promise(() => host.removeQueuedFollowUp(input)).pipe(
        Effect.tapError((error) =>
          logRuntimeFailure("runtime queued follow-up remove failed", input, error),
        ),
      );
    }),
});

export const reorderQueuedRuntimeFollowUp = makeIpcMethod({
  channel: IpcChannels.RUNTIME_REORDER_QUEUED_FOLLOW_UP_CHANNEL,
  payload: ThreadAgentRuntimeReorderQueuedFollowUpInput,
  result: Schema.Void,
  handler: (input) =>
    Effect.gen(function* () {
      const host = yield* requireRuntimeHost;
      yield* Effect.promise(() => host.reorderQueuedFollowUp(input)).pipe(
        Effect.tapError((error) =>
          logRuntimeFailure("runtime queued follow-up reorder failed", input, error),
        ),
      );
    }),
});

export const sendQueuedRuntimeFollowUpNow = makeIpcMethod({
  channel: IpcChannels.RUNTIME_SEND_QUEUED_FOLLOW_UP_NOW_CHANNEL,
  payload: ThreadAgentRuntimeQueuedFollowUpIdInput,
  result: Schema.Void,
  handler: (input) =>
    Effect.gen(function* () {
      const host = yield* requireRuntimeHost;
      yield* Effect.promise(() => host.sendQueuedFollowUpNow(input)).pipe(
        Effect.tapError((error) =>
          logRuntimeFailure("runtime queued follow-up send-now failed", input, error),
        ),
      );
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
        Effect.tapError((error) =>
          logRuntimeFailure("runtime thread compact failed", input, error),
        ),
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
