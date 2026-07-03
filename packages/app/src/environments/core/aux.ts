import type {
  EnvironmentApi,
  LocalApi,
} from "@honk/contracts";
import type { ServerConfigStreamEvent } from "@honk/shared/server-config";
import type {
  OrchestrationEvent,
  OrchestrationShellSnapshot,
} from "@honk/shared/orchestration";
import type {
  GitActionProgressEvent,
  GitRunStackedActionInput,
  GitRunStackedActionResult,
  GitStatusStreamEvent,
} from "@honk/shared/git";
import { applyGitStatusStreamEvent } from "@honk/shared/git";

import type { WsRpcClient } from "~/rpc/ws-rpc-client";

export const DESKTOP_AUX_UNAVAILABLE_ERROR = "desktop aux unavailable in this environment";

export interface CoreAuxEndpoint {
  readonly baseUrl: string;
  readonly bearer: string;
}

export interface CoreAuxStreamSubscriptionOptions {
  readonly onResubscribe?: () => void;
}

export type CoreAuxGitApi = EnvironmentApi["git"] & {
  readonly runStackedAction: WsRpcClient["git"]["runStackedAction"];
};
export type CoreAuxProjectEvent = Extract<
  OrchestrationEvent,
  { readonly type: "project.created" | "project.meta-updated" | "project.deleted" }
>;
type CoreAuxProjectShell = OrchestrationShellSnapshot["projects"][number];
type CoreDispatchCommand = Parameters<EnvironmentApi["orchestration"]["dispatchCommand"]>[0];
type CoreDispatchResult = Awaited<ReturnType<EnvironmentApi["orchestration"]["dispatchCommand"]>>;
type CoreProjectCreateCommand = Extract<CoreDispatchCommand, { readonly type: "project.create" }>;
type CoreProjectMetaUpdateCommand = Extract<
  CoreDispatchCommand,
  { readonly type: "project.meta.update" }
>;
type CoreProjectDeleteCommand = Extract<CoreDispatchCommand, { readonly type: "project.delete" }>;

export interface CoreAuxClient {
  readonly endpoint: CoreAuxEndpoint;
  readonly git: CoreAuxGitApi;
  readonly server: LocalApi["server"];
  readonly listProjects: () => Promise<CoreAuxProjectShell[]>;
  readonly subscribeProjects: (
    listener: (event: CoreAuxProjectEvent) => void,
    options?: CoreAuxStreamSubscriptionOptions,
  ) => () => void;
  readonly createProject: (command: CoreProjectCreateCommand) => Promise<CoreDispatchResult>;
  readonly updateProjectMeta: (
    command: CoreProjectMetaUpdateCommand,
  ) => Promise<CoreDispatchResult>;
  readonly deleteProject: (command: CoreProjectDeleteCommand) => Promise<CoreDispatchResult>;
  readonly subscribeConfig: (
    listener: (event: ServerConfigStreamEvent) => void,
    options?: CoreAuxStreamSubscriptionOptions,
  ) => () => void;
  readonly dispose: () => void;
}

interface SseRequestInput<TPayload, TResult = never> {
  readonly path: string;
  readonly method?: "GET" | "POST";
  readonly body?: unknown;
  readonly signal: AbortSignal;
  readonly onOpen?: () => void;
  readonly onMessage: (event: string, payload: TPayload) => void;
  readonly onResult?: (payload: TResult) => void;
  readonly onError?: (payload: unknown) => void;
}

const STREAM_RETRY_DELAY_MS = 250;

function unavailableError(): Error {
  return new Error(DESKTOP_AUX_UNAVAILABLE_ERROR);
}

function rejectUnavailable<T>(): Promise<T> {
  return Promise.reject(unavailableError());
}

export function createUnavailableCoreAuxServerApi(): LocalApi["server"] {
  return {
    getConfig: () => rejectUnavailable(),
    upsertKeybinding: () => rejectUnavailable(),
    getSettings: () => rejectUnavailable(),
    updateSettings: () => rejectUnavailable(),
  };
}

export async function resolveCoreAuxEndpoint(): Promise<CoreAuxEndpoint | null> {
  if (typeof window === "undefined") {
    return null;
  }
  return window.desktopBridge?.getAuxEndpoint?.() ?? null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function createAuxUrl(endpoint: CoreAuxEndpoint, path: string): string {
  return new URL(path, endpoint.baseUrl).toString();
}

function createStatusStreamPath(input: Parameters<EnvironmentApi["git"]["onStatus"]>[0]): string {
  const searchParams = new URLSearchParams({ cwd: input.cwd });
  if (input.scope) {
    searchParams.set("scope", input.scope);
  }
  return `/git/status/stream?${searchParams.toString()}`;
}

function readPayloadMessage(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) {
    return null;
  }
  const message = Reflect.get(payload, "message");
  return typeof message === "string" && message.trim().length > 0 ? message : null;
}

async function readResponseErrorMessage(response: Response): Promise<string> {
  const fallback = `Desktop aux request failed with HTTP ${response.status}.`;
  try {
    const body = await response.clone().json();
    if (typeof body !== "object" || body === null) {
      return fallback;
    }
    const error = Reflect.get(body, "error");
    const message = readPayloadMessage(error);
    return message ?? fallback;
  } catch {
    return fallback;
  }
}

function errorFromPayload(payload: unknown): Error {
  return new Error(readPayloadMessage(payload) ?? "Desktop aux stream failed.");
}

function dispatchResultFromProjectEvent(event: CoreAuxProjectEvent): CoreDispatchResult {
  return { sequence: event.sequence };
}

function makeHeaders(endpoint: CoreAuxEndpoint, contentType?: string): HeadersInit {
  return {
    accept: "application/json, text/event-stream",
    authorization: `Bearer ${endpoint.bearer}`,
    ...(contentType ? { "content-type": contentType } : {}),
  };
}

function dispatchSseMessage<TPayload, TResult>(
  event: string,
  dataLines: readonly string[],
  input: Pick<SseRequestInput<TPayload, TResult>, "onMessage" | "onResult" | "onError">,
): void {
  if (dataLines.length === 0) {
    return;
  }
  const payload = JSON.parse(dataLines.join("\n"));
  if (event === "result" && input.onResult) {
    input.onResult(payload);
    return;
  }
  if (event === "error" && input.onError) {
    input.onError(payload);
    return;
  }
  input.onMessage(event, payload);
}

export function createCoreAuxClient(endpoint: CoreAuxEndpoint | null): CoreAuxClient | null {
  if (!endpoint) {
    return null;
  }
  const auxEndpoint = endpoint;

  let disposed = false;
  const abortControllers = new Set<AbortController>();

  function makeAbortController(): AbortController {
    if (disposed) {
      throw new Error("Desktop aux client disposed.");
    }
    const controller = new AbortController();
    abortControllers.add(controller);
    return controller;
  }

  function releaseAbortController(controller: AbortController): void {
    abortControllers.delete(controller);
  }

  async function requestJson<TResult>(
    path: string,
    init?: { readonly method?: "GET" | "POST"; readonly body?: unknown },
  ): Promise<TResult> {
    const controller = makeAbortController();
    try {
      const hasBody = init?.body !== undefined;
      const response = await fetch(createAuxUrl(auxEndpoint, path), {
        method: init?.method ?? "GET",
        headers: makeHeaders(auxEndpoint, hasBody ? "application/json" : undefined),
        ...(hasBody ? { body: JSON.stringify(init.body) } : {}),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(await readResponseErrorMessage(response));
      }
      return await response.json();
    } finally {
      releaseAbortController(controller);
    }
  }

  async function consumeSse<TPayload, TResult = never>(
    input: SseRequestInput<TPayload, TResult>,
  ): Promise<void> {
    const hasBody = input.body !== undefined;
    const response = await fetch(createAuxUrl(auxEndpoint, input.path), {
      method: input.method ?? "GET",
      headers: makeHeaders(auxEndpoint, hasBody ? "application/json" : undefined),
      ...(hasBody ? { body: JSON.stringify(input.body) } : {}),
      signal: input.signal,
    });
    if (!response.ok) {
      throw new Error(await readResponseErrorMessage(response));
    }
    if (!response.body) {
      throw new Error("Desktop aux stream response did not include a body.");
    }

    input.onOpen?.();
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let event = "message";
    let dataLines: string[] = [];

    const flushLine = (rawLine: string): void => {
      const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
      if (line === "") {
        dispatchSseMessage(event, dataLines, input);
        event = "message";
        dataLines = [];
        return;
      }
      if (line.startsWith(":")) {
        return;
      }
      const separatorIndex = line.indexOf(":");
      const field = separatorIndex === -1 ? line : line.slice(0, separatorIndex);
      const rawValue = separatorIndex === -1 ? "" : line.slice(separatorIndex + 1);
      const value = rawValue.startsWith(" ") ? rawValue.slice(1) : rawValue;
      if (field === "event") {
        event = value || "message";
        return;
      }
      if (field === "data") {
        dataLines.push(value);
      }
    };

    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex >= 0) {
        flushLine(buffer.slice(0, newlineIndex));
        buffer = buffer.slice(newlineIndex + 1);
        newlineIndex = buffer.indexOf("\n");
      }
    }

    buffer += decoder.decode();
    if (buffer.length > 0) {
      flushLine(buffer);
    }
    dispatchSseMessage(event, dataLines, input);
  }

  function subscribeSse<TPayload>(
    path: string,
    onMessage: (event: string, payload: TPayload) => void,
    options?: CoreAuxStreamSubscriptionOptions,
  ): () => void {
    let active = true;
    let openedOnce = false;
    let currentController: AbortController | null = null;

    void (async () => {
      for (;;) {
        if (!active || disposed) {
          return;
        }

        const controller = makeAbortController();
        currentController = controller;
        try {
          if (openedOnce) {
            options?.onResubscribe?.();
          }
          await consumeSse<TPayload>({
            path,
            signal: controller.signal,
            onOpen: () => {
              openedOnce = true;
            },
            onMessage,
          });
        } catch (error) {
          if (!active || disposed || controller.signal.aborted) {
            return;
          }
          console.warn("Desktop aux stream failed", error);
        } finally {
          releaseAbortController(controller);
          if (currentController === controller) {
            currentController = null;
          }
        }

        if (active && !disposed) {
          await sleep(STREAM_RETRY_DELAY_MS);
        }
      }
    })();

    return () => {
      active = false;
      currentController?.abort();
    };
  }

  const git: CoreAuxGitApi = {
    pull: (input) => requestJson("/git/pull", { method: "POST", body: input }),
    refreshStatus: (input) =>
      requestJson("/git/status/refresh", { method: "POST", body: input }),
    onStatus: (input, callback, options) => {
      let currentStatus: Awaited<ReturnType<EnvironmentApi["git"]["refreshStatus"]>> | null = null;
      return subscribeSse<GitStatusStreamEvent>(
        createStatusStreamPath(input),
        (event, payload) => {
          if (event !== "message") {
            return;
          }
          currentStatus = applyGitStatusStreamEvent(currentStatus, payload);
          callback(currentStatus);
        },
        options,
      );
    },
    listBranches: (input) => requestJson("/git/branches", { method: "POST", body: input }),
    createWorktree: (input) =>
      requestJson("/git/worktrees/create", { method: "POST", body: input }),
    removeWorktree: async (input) => {
      await requestJson("/git/worktrees/remove", { method: "POST", body: input });
    },
    createBranch: (input) =>
      requestJson("/git/branches/create", { method: "POST", body: input }),
    checkout: (input) => requestJson("/git/checkout", { method: "POST", body: input }),
    init: async (input) => {
      await requestJson("/git/init", { method: "POST", body: input });
    },
    resolvePullRequest: (input) =>
      requestJson("/git/pull-request/resolve", { method: "POST", body: input }),
    preparePullRequestThread: (input) =>
      requestJson("/git/pull-request/prepare-thread", { method: "POST", body: input }),
    discardPaths: async (input) => {
      await requestJson("/git/discard-paths", { method: "POST", body: input });
    },
    getFilePatch: (input) => requestJson("/git/file-patch", { method: "POST", body: input }),
    getFileImage: (input) => requestJson("/git/file-image", { method: "POST", body: input }),
    runStackedAction: async (
      input: GitRunStackedActionInput,
      options?: { readonly onProgress?: (event: GitActionProgressEvent) => void },
    ): Promise<GitRunStackedActionResult> => {
      const controller = makeAbortController();
      let result: GitRunStackedActionResult | null = null;
      try {
        await consumeSse<GitActionProgressEvent, GitRunStackedActionResult>({
          path: "/git/run-stacked-action/stream",
          method: "POST",
          body: input,
          signal: controller.signal,
          onMessage: (event, payload) => {
            if (event === "message") {
              options?.onProgress?.(payload);
            }
          },
          onResult: (payload) => {
            result = payload;
          },
          onError: (payload) => {
            throw errorFromPayload(payload);
          },
        });
      } finally {
        releaseAbortController(controller);
      }

      if (result) {
        return result;
      }
      throw new Error("Git action stream completed without a final result.");
    },
  };

  const server: LocalApi["server"] = {
    getConfig: () => requestJson("/config"),
    upsertKeybinding: (input) =>
      requestJson("/keybindings/upsert", { method: "POST", body: input }),
    getSettings: () => requestJson("/settings"),
    updateSettings: (patch) =>
      requestJson("/settings/update", { method: "POST", body: patch }),
  };

  const listProjects = (): Promise<CoreAuxProjectShell[]> => requestJson("/projects");

  const createProject = async (
    command: CoreProjectCreateCommand,
  ): Promise<CoreDispatchResult> =>
    dispatchResultFromProjectEvent(
      await requestJson("/projects/create", { method: "POST", body: command }),
    );

  const updateProjectMeta = async (
    command: CoreProjectMetaUpdateCommand,
  ): Promise<CoreDispatchResult> =>
    dispatchResultFromProjectEvent(
      await requestJson("/projects/meta-update", { method: "POST", body: command }),
    );

  const deleteProject = async (
    command: CoreProjectDeleteCommand,
  ): Promise<CoreDispatchResult> =>
    dispatchResultFromProjectEvent(
      await requestJson("/projects/delete", { method: "POST", body: command }),
    );

  return {
    endpoint: auxEndpoint,
    git,
    server,
    listProjects,
    subscribeProjects: (listener, options) =>
      subscribeSse<CoreAuxProjectEvent>(
        "/projects/stream",
        (event, payload) => {
          if (event === "message") {
            listener(payload);
          }
        },
        options,
      ),
    createProject,
    updateProjectMeta,
    deleteProject,
    subscribeConfig: (listener, options) =>
      subscribeSse<ServerConfigStreamEvent>(
        "/config/stream",
        (event, payload) => {
          if (event === "message") {
            listener(payload);
          }
        },
        options,
      ),
    dispose: () => {
      disposed = true;
      for (const controller of abortControllers) {
        controller.abort();
      }
      abortControllers.clear();
    },
  };
}
