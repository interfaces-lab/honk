import type {
  GitCheckoutInput,
  GitCheckoutResult,
  GitCreateBranchInput,
  GitCreateBranchResult,
  GitCreateWorktreeInput,
  GitCreateWorktreeResult,
  GitDiscardPathsInput,
  GitFileImageInput,
  GitFileImageResult,
  GitFilePatchInput,
  GitFilePatchResult,
  GitInitInput,
  GitListBranchesInput,
  GitListBranchesResult,
  GitPreparePullRequestThreadInput,
  GitPreparePullRequestThreadResult,
  GitPullInput,
  GitPullRequestRefInput,
  GitPullResult,
  GitRemoveWorktreeInput,
  GitResolvePullRequestResult,
  GitStatusInput,
  GitStatusResult,
} from "./git";
import type { FilesystemBrowseInput, FilesystemBrowseResult } from "./filesystem";
import type {
  DispatchResult,
  ClientOrchestrationCommand,
  OrchestrationReplayEventsInput,
  OrchestrationReplayEventsResult,
  OrchestrationShellStreamItem,
  OrchestrationSubscribeThreadInput,
  OrchestrationThreadStreamItem,
} from "./orchestration";
import type { HonkRuntimeApi } from "./runtime";
import type {
  ServerConfig,
  ServerUpsertKeybindingInput,
  ServerUpsertKeybindingResult,
} from "./server";
import type { ServerSettings, ServerSettingsPatch } from "./settings";
import type {
  DesktopBridge as SharedDesktopBridge,
  EnvironmentApi as SharedEnvironmentApi,
  LocalApi as SharedLocalApi,
} from "@honk/shared/desktop-api";

export {
  ContextMenuItemSchema,
  DesktopActiveWorkStateSchema,
  DesktopAppBrandingSchema,
  DesktopAppStageLabelSchema,
  DesktopEnvironmentBootstrapSchema,
  DesktopRendererDiagnosticInputSchema,
  DesktopRendererDiagnosticLevelSchema,
  DesktopRuntimeArchSchema,
  DesktopRuntimeInfoSchema,
  DesktopServerExposureModeSchema,
  DesktopServerExposureStateSchema,
  DesktopThemeSchema,
  DesktopUpdateActionResultSchema,
  DesktopUpdateCheckResultSchema,
  DesktopUpdateStateSchema,
  DesktopUpdateStatusSchema,
  DesktopWindowChromeStateSchema,
  PickFolderOptionsSchema,
} from "@honk/shared/desktop-api";

export type {
  ContextMenuItem,
  ContextMenuItemSchemaType,
  DesktopActiveWorkState,
  DesktopAppBranding,
  DesktopAppStageLabel,
  DesktopEnvironmentBootstrap,
  DesktopRendererDiagnosticInput,
  DesktopRendererDiagnosticLevel,
  DesktopRuntimeArch,
  DesktopRuntimeInfo,
  DesktopServerExposureMode,
  DesktopServerExposureState,
  DesktopTheme,
  DesktopUpdateActionResult,
  DesktopUpdateCheckResult,
  DesktopUpdateState,
  DesktopUpdateStatus,
  DesktopWindowChromeState,
  PickFolderOptions,
} from "@honk/shared/desktop-api";

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

type LocalServerApi = {
  getConfig: () => Promise<ServerConfig>;
  upsertKeybinding: (input: ServerUpsertKeybindingInput) => Promise<ServerUpsertKeybindingResult>;
  getSettings: () => Promise<ServerSettings>;
  updateSettings: (patch: ServerSettingsPatch) => Promise<ServerSettings>;
};

export interface DesktopBridge extends SharedDesktopBridge<HonkRuntimeApi> {}

/**
 * APIs bound to the local app shell, not to any particular backend environment.
 *
 * The shell/persistence shape lives in @honk/shared. The concrete server config
 * methods remain attached here because ServerConfig* is a Bucket-2 ws-rpc
 * envelope that stays in contracts until the cut.
 */
export interface LocalApi extends SharedLocalApi<HonkRuntimeApi, LocalServerApi> {}

/**
 * APIs bound to a specific backend environment connection.
 *
 * Terminal/project/git routing lives in @honk/shared. Filesystem and
 * orchestration remain attached here because their concrete envelopes are still
 * contracts-owned.
 */
export interface EnvironmentApi
  extends SharedEnvironmentApi<LocalFilesystemApi, LocalOrchestrationApi> {}
