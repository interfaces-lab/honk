import type {
  DesktopBridge as SharedDesktopBridge,
  EnvironmentApi as SharedEnvironmentApi,
  LocalApi as SharedLocalApi,
} from "@honk/shared/desktop-api";
import type { FilesystemBrowseInput, FilesystemBrowseResult } from "@honk/shared/filesystem";
import type {
  ClientOrchestrationCommand,
  DispatchResult,
  OrchestrationReplayEventsInput,
  OrchestrationReplayEventsResult,
  OrchestrationShellStreamItem,
  OrchestrationSubscribeThreadInput,
  OrchestrationThreadStreamItem,
} from "@honk/shared/orchestration";
import type {
  ServerConfig,
  ServerUpsertKeybindingInput,
  ServerUpsertKeybindingResult,
} from "@honk/shared/server-config";
import type { ServerSettings, ServerSettingsPatch } from "@honk/shared/server-settings";

export interface DesktopAuxEndpoint {
  readonly baseUrl: string;
  readonly bearer: string;
}

type LocalFilesystemApi = {
  browse: (input: FilesystemBrowseInput) => Promise<FilesystemBrowseResult>;
};

type LocalOrchestrationApi = {
  dispatchCommand: (command: ClientOrchestrationCommand) => Promise<DispatchResult>;
  replayEvents: (input: OrchestrationReplayEventsInput) => Promise<OrchestrationReplayEventsResult>;
  subscribeShell: (
    callback: (event: OrchestrationShellStreamItem) => void,
    options?: {
      onResubscribe?: () => void;
    },
  ) => () => void;
  subscribeThread: (
    input: OrchestrationSubscribeThreadInput,
    callback: (event: OrchestrationThreadStreamItem) => void,
    options?: {
      onResubscribe?: () => void;
    },
  ) => () => void;
};

export type LocalServerApi = {
  getConfig: () => Promise<ServerConfig>;
  upsertKeybinding: (input: ServerUpsertKeybindingInput) => Promise<ServerUpsertKeybindingResult>;
  getSettings: () => Promise<ServerSettings>;
  updateSettings: (patch: ServerSettingsPatch) => Promise<ServerSettings>;
};

export interface DesktopBridge extends SharedDesktopBridge<never> {
  readonly getAuxEndpoint?: () => Promise<DesktopAuxEndpoint | null>;
}

export interface LocalApi extends SharedLocalApi<never, LocalServerApi> {}

export interface EnvironmentApi
  extends SharedEnvironmentApi<LocalFilesystemApi, LocalOrchestrationApi> {}
