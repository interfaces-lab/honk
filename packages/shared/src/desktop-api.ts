import { Schema } from "effect";

import type { BrowserAutomationOpenRequest } from "./browser-automation";
import { NonNegativeInt, PortSchema, ThreadId } from "./base-schemas";
import type { ClientSettings } from "./client-settings";
import type { EditorId } from "./editor";
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
import type {
  ProjectCreateDirectoryInput,
  ProjectCreateDirectoryResult,
  ProjectDeleteFileInput,
  ProjectDeleteFileResult,
  ProjectListDirectoryInput,
  ProjectListDirectoryResult,
  ProjectReadFileInput,
  ProjectReadFileResult,
  ProjectRenamePathInput,
  ProjectRenamePathResult,
  ProjectSearchEntriesInput,
  ProjectSearchEntriesResult,
  ProjectWriteFileInput,
  ProjectWriteFileResult,
} from "./project";
import {
  TerminalClearInput,
  TerminalCloseInput,
  TerminalEvent,
  TerminalOpenInput,
  TerminalResizeInput,
  TerminalRestartInput,
  TerminalSessionSnapshot,
  TerminalWriteInput,
} from "./terminal";

export const DesktopBackendBootstrap = Schema.Struct({
  mode: Schema.Literal("desktop"),
  noBrowser: Schema.Boolean,
  port: PortSchema,
  honkHome: Schema.String,
  host: Schema.String,
  desktopBootstrapToken: Schema.String,
  runId: Schema.String,
  otlpTracesUrl: Schema.optional(Schema.String),
  otlpMetricsUrl: Schema.optional(Schema.String),
});
export type DesktopBackendBootstrap = typeof DesktopBackendBootstrap.Type;

export interface ContextMenuItem<T extends string = string> {
  id: T;
  label: string;
  destructive?: boolean;
  disabled?: boolean;
  children?: readonly ContextMenuItem<T>[];
}

export interface ContextMenuItemSchemaType {
  readonly id: string;
  readonly label: string;
  readonly destructive?: boolean;
  readonly disabled?: boolean;
  readonly children?: readonly ContextMenuItemSchemaType[];
}

export const ContextMenuItemSchema: Schema.Codec<ContextMenuItemSchemaType> = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  destructive: Schema.optionalKey(Schema.Boolean),
  disabled: Schema.optionalKey(Schema.Boolean),
  children: Schema.optionalKey(
    Schema.Array(
      Schema.suspend((): Schema.Codec<ContextMenuItemSchemaType> => ContextMenuItemSchema),
    ),
  ),
});

export type DesktopUpdateStatus =
  | "disabled"
  | "idle"
  | "checking"
  | "up-to-date"
  | "available"
  | "downloading"
  | "downloaded"
  | "installing"
  | "error";

export type DesktopRuntimeArch = "arm64" | "x64" | "other";
export type DesktopTheme = "light" | "dark" | "system";
export type DesktopAppStageLabel = "Dev";

export const DesktopUpdateStatusSchema = Schema.Literals([
  "disabled",
  "idle",
  "checking",
  "up-to-date",
  "available",
  "downloading",
  "downloaded",
  "installing",
  "error",
]);
export const DesktopRuntimeArchSchema = Schema.Literals(["arm64", "x64", "other"]);
export const DesktopThemeSchema = Schema.Literals(["light", "dark", "system"]);
export const DesktopAppStageLabelSchema = Schema.Literal("Dev");

export interface DesktopAppBranding {
  baseName: string;
  stageLabel: DesktopAppStageLabel | null;
  displayName: string;
}

export const DesktopAppBrandingSchema = Schema.Struct({
  baseName: Schema.String,
  stageLabel: Schema.NullOr(DesktopAppStageLabelSchema),
  displayName: Schema.String,
});

export interface DesktopRuntimeInfo {
  hostArch: DesktopRuntimeArch;
  appArch: DesktopRuntimeArch;
  runningUnderArm64Translation: boolean;
}

export const DesktopRuntimeInfoSchema = Schema.Struct({
  hostArch: DesktopRuntimeArchSchema,
  appArch: DesktopRuntimeArchSchema,
  runningUnderArm64Translation: Schema.Boolean,
});

export interface DesktopUpdateState {
  enabled: boolean;
  status: DesktopUpdateStatus;
  currentVersion: string;
  hostArch: DesktopRuntimeArch;
  appArch: DesktopRuntimeArch;
  runningUnderArm64Translation: boolean;
  availableVersion: string | null;
  downloadedVersion: string | null;
  downloadPercent: number | null;
  checkedAt: string | null;
  message: string | null;
  errorContext: "check" | "download" | "install" | null;
  canRetry: boolean;
}

export const DesktopUpdateStateSchema = Schema.Struct({
  enabled: Schema.Boolean,
  status: DesktopUpdateStatusSchema,
  currentVersion: Schema.String,
  hostArch: DesktopRuntimeArchSchema,
  appArch: DesktopRuntimeArchSchema,
  runningUnderArm64Translation: Schema.Boolean,
  availableVersion: Schema.NullOr(Schema.String),
  downloadedVersion: Schema.NullOr(Schema.String),
  downloadPercent: Schema.NullOr(Schema.Number),
  checkedAt: Schema.NullOr(Schema.String),
  message: Schema.NullOr(Schema.String),
  errorContext: Schema.NullOr(Schema.Literals(["check", "download", "install"])),
  canRetry: Schema.Boolean,
});

export interface DesktopUpdateActionResult {
  accepted: boolean;
  completed: boolean;
  state: DesktopUpdateState;
}

export const DesktopUpdateActionResultSchema = Schema.Struct({
  accepted: Schema.Boolean,
  completed: Schema.Boolean,
  state: DesktopUpdateStateSchema,
});

export interface DesktopUpdateCheckResult {
  checked: boolean;
  state: DesktopUpdateState;
}

export const DesktopUpdateCheckResultSchema = Schema.Struct({
  checked: Schema.Boolean,
  state: DesktopUpdateStateSchema,
});

export type DesktopServerExposureMode = "local-only" | "network-accessible" | "tailscale";

export const DesktopServerExposureModeSchema = Schema.Literals([
  "local-only",
  "network-accessible",
  "tailscale",
]);

export interface DesktopServerExposureState {
  mode: DesktopServerExposureMode;
  localUrl: string | null;
  endpointUrl: string | null;
  customUrl: string | null;
  advertisedHost: string | null;
}

export const DesktopServerExposureStateSchema = Schema.Struct({
  mode: DesktopServerExposureModeSchema,
  localUrl: Schema.NullOr(Schema.String),
  endpointUrl: Schema.NullOr(Schema.String),
  customUrl: Schema.NullOr(Schema.String),
  advertisedHost: Schema.NullOr(Schema.String),
});

export type DesktopRemoteHostStatus = "disabled" | "starting" | "ready" | "error";

export interface DesktopRemoteHostDevice {
  id: string;
  label: string;
  createdAt: string;
  revokedAt: string | null;
}

export interface DesktopRemoteHostState {
  status: DesktopRemoteHostStatus;
  publicUrl: string | null;
  localUrl: string | null;
  errorMessage: string | null;
  devices: readonly DesktopRemoteHostDevice[];
}

export interface DesktopRemotePairingLink {
  url: string;
  mobileUrl: string;
  expiresAt: string;
}

export const DesktopRemoteHostStatusSchema = Schema.Literals([
  "disabled",
  "starting",
  "ready",
  "error",
]);
export const DesktopRemoteHostDeviceSchema = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  createdAt: Schema.String,
  revokedAt: Schema.NullOr(Schema.String),
});
export const DesktopRemoteHostStateSchema = Schema.Struct({
  status: DesktopRemoteHostStatusSchema,
  publicUrl: Schema.NullOr(Schema.String),
  localUrl: Schema.NullOr(Schema.String),
  errorMessage: Schema.NullOr(Schema.String),
  devices: Schema.Array(DesktopRemoteHostDeviceSchema),
});
export const DesktopRemotePairingLinkSchema = Schema.Struct({
  url: Schema.String,
  mobileUrl: Schema.String,
  expiresAt: Schema.String,
});

export interface DesktopWindowChromeState {
  fullscreen: boolean;
}

export const DesktopWindowChromeStateSchema = Schema.Struct({
  fullscreen: Schema.Boolean,
});

export interface DesktopActiveWorkState {
  runningThreadCount: number;
  runningThreadTitles: readonly string[];
}

export const DesktopActiveWorkStateSchema = Schema.Struct({
  runningThreadCount: NonNegativeInt,
  runningThreadTitles: Schema.Array(Schema.String),
});

export interface PickFolderOptions {
  initialPath?: string | null;
}

export const PickFolderOptionsSchema = Schema.Struct({
  initialPath: Schema.optionalKey(Schema.NullOr(Schema.String)),
});

export const DesktopPtyOpenOptions = Schema.Struct({
  id: Schema.String,
  cwd: Schema.String,
  cols: Schema.Number,
  rows: Schema.Number,
});
export type DesktopPtyOpenOptions = typeof DesktopPtyOpenOptions.Type;

export interface DesktopPtyBridge {
  readonly open: (options: DesktopPtyOpenOptions) => Promise<void>;
  readonly write: (id: string, data: string) => void;
  readonly resize: (id: string, cols: number, rows: number) => void;
  readonly close: (id: string) => void;
  readonly onData: (id: string, listener: (data: string) => void) => () => void;
  readonly onExit: (id: string, listener: (code: number) => void) => () => void;
}

export const DesktopBrowserViewBounds = Schema.Struct({
  x: Schema.Number,
  y: Schema.Number,
  width: Schema.Number,
  height: Schema.Number,
});
export type DesktopBrowserViewBounds = typeof DesktopBrowserViewBounds.Type;

export const DesktopBrowserViewSyncInput = Schema.Struct({
  browserId: Schema.String,
  surfaceId: Schema.String,
  workspaceKey: Schema.String,
  tabId: Schema.String,
  threadId: ThreadId,
  bounds: DesktopBrowserViewBounds,
  visible: Schema.Boolean,
  active: Schema.Boolean,
});
export type DesktopBrowserViewSyncInput = typeof DesktopBrowserViewSyncInput.Type;

export const DesktopBrowserViewDetachInput = Schema.Struct({
  browserId: Schema.String,
  surfaceId: Schema.String,
});
export type DesktopBrowserViewDetachInput = typeof DesktopBrowserViewDetachInput.Type;

export const DesktopBrowserViewDestroyInput = Schema.Struct({
  browserId: Schema.String,
});
export type DesktopBrowserViewDestroyInput = typeof DesktopBrowserViewDestroyInput.Type;

export const DesktopBrowserViewCommandInput = Schema.Union([
  Schema.Struct({
    browserId: Schema.String,
    type: Schema.Literal("navigate"),
    url: Schema.String,
  }),
  Schema.Struct({
    browserId: Schema.String,
    type: Schema.Literals(["back", "forward", "reload", "picture-in-picture"]),
  }),
]);
export type DesktopBrowserViewCommandInput = typeof DesktopBrowserViewCommandInput.Type;

export const DesktopBrowserViewState = Schema.Struct({
  browserId: Schema.String,
  committedUrl: Schema.String,
  isLoading: Schema.Boolean,
  loadError: Schema.NullOr(Schema.String),
  canGoBack: Schema.Boolean,
  canGoForward: Schema.Boolean,
  canPictureInPicture: Schema.Boolean,
});
export type DesktopBrowserViewState = typeof DesktopBrowserViewState.Type;

export type DesktopRendererDiagnosticLevel = "error" | "warn" | "info" | "debug";

export const DesktopRendererDiagnosticLevelSchema = Schema.Literals([
  "error",
  "warn",
  "info",
  "debug",
]);

export interface DesktopRendererDiagnosticInput {
  level: DesktopRendererDiagnosticLevel;
  message: string;
  details?: Record<string, unknown>;
}

export const DesktopRendererDiagnosticInputSchema = Schema.Struct({
  level: DesktopRendererDiagnosticLevelSchema,
  message: Schema.String,
  details: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
});

export interface DesktopBridge<RuntimeApi = unknown> {
  getAppBranding: () => DesktopAppBranding | null;
  /** Stable for this desktop window across reloads and relaunches. */
  getWindowID: () => string;
  syncBrowserView: (input: DesktopBrowserViewSyncInput) => Promise<DesktopBrowserViewState>;
  detachBrowserView: (input: DesktopBrowserViewDetachInput) => Promise<void>;
  commandBrowserView: (input: DesktopBrowserViewCommandInput) => Promise<DesktopBrowserViewState>;
  destroyBrowserView: (input: DesktopBrowserViewDestroyInput) => Promise<void>;
  onBrowserViewState: (listener: (state: DesktopBrowserViewState) => void) => () => void;
  onBrowserAutomationOpen: (listener: (input: BrowserAutomationOpenRequest) => void) => () => void;
  pty?: DesktopPtyBridge;
  getWindowChromeState: () => DesktopWindowChromeState;
  onWindowChromeState: (listener: (state: DesktopWindowChromeState) => void) => () => void;
  setActiveWorkState: (state: DesktopActiveWorkState) => Promise<void>;
  getClientSettings: () => Promise<ClientSettings | null>;
  setClientSettings: (settings: ClientSettings) => Promise<void>;
  protectRemoteCredential?: (credential: string) => Promise<string>;
  revealRemoteCredential?: (protectedCredential: string) => Promise<string>;
  getServerExposureState: () => Promise<DesktopServerExposureState>;
  setServerExposureMode: (mode: DesktopServerExposureMode) => Promise<DesktopServerExposureState>;
  setServerExposurePublicUrl?: (publicUrl: string | null) => Promise<DesktopServerExposureState>;
  getRemoteHostState: () => Promise<DesktopRemoteHostState>;
  issueRemotePairing: (label: string | null) => Promise<DesktopRemotePairingLink>;
  revokeRemoteDevice: (deviceID: string) => Promise<DesktopRemoteHostState>;
  pickFolder: (options?: PickFolderOptions) => Promise<string | null>;
  completeOnboarding: () => Promise<void>;
  finishOnboarding: () => Promise<void>;
  dismissOnboarding: () => Promise<void>;
  replayOnboarding: () => Promise<void>;
  onOnboardingWindowShown: (listener: () => void) => () => void;
  setTheme: (theme: DesktopTheme) => Promise<void>;
  setBackgroundColor: (color: string) => Promise<void>;
  setVibrancy: (enabled: boolean) => Promise<void>;
  setDisplayZoom: (factor: number) => Promise<void>;
  expandWindowWidth?: (additionalWidth: number) => Promise<void>;
  showContextMenu: <T extends string>(
    items: readonly ContextMenuItem<T>[],
    position?: { x: number; y: number },
  ) => Promise<T | null>;
  openExternal: (url: string) => Promise<boolean>;
  openInEditor: (cwd: string, editor: EditorId) => Promise<boolean>;
  showItemInFolder: (path: string) => Promise<boolean>;
  onMenuAction: (listener: (action: string) => void) => () => void;
  getUpdateState: () => Promise<DesktopUpdateState>;
  checkForUpdate: () => Promise<DesktopUpdateCheckResult>;
  downloadUpdate: () => Promise<DesktopUpdateActionResult>;
  installUpdate: () => Promise<DesktopUpdateActionResult>;
  onUpdateState: (listener: (state: DesktopUpdateState) => void) => () => void;
  logRendererDiagnostic?: (input: DesktopRendererDiagnosticInput) => Promise<void>;
  runtime?: RuntimeApi;
}

/**
 * Local shell APIs. Dialogs, shell openers, context menus, client settings.
 * Server config stays generic for each host's transport.
 */
export interface LocalApi<RuntimeApi = unknown, ServerApi = unknown> {
  runtime?: RuntimeApi;
  dialogs: {
    pickFolder: (options?: PickFolderOptions) => Promise<string | null>;
    confirm: (message: string) => Promise<boolean>;
  };
  shell: {
    openInEditor: (cwd: string, editor: EditorId) => Promise<void>;
    openExternal: (url: string) => Promise<void>;
    showItemInFolder: (path: string) => Promise<void>;
  };
  contextMenu: {
    show: <T extends string>(
      items: readonly ContextMenuItem<T>[],
      position?: { x: number; y: number },
    ) => Promise<T | null>;
  };
  persistence: {
    getClientSettings: () => Promise<ClientSettings | null>;
    setClientSettings: (settings: ClientSettings) => Promise<void>;
  };
  server: ServerApi;
}

/**
 * Environment-scoped APIs. Always route with explicit environment context.
 * Filesystem and orchestration stay generic for the active transport.
 */
export interface EnvironmentApi<FilesystemApi = unknown, OrchestrationApi = unknown> {
  terminal: {
    open: (input: typeof TerminalOpenInput.Encoded) => Promise<TerminalSessionSnapshot>;
    write: (input: typeof TerminalWriteInput.Encoded) => Promise<void>;
    resize: (input: typeof TerminalResizeInput.Encoded) => Promise<void>;
    clear: (input: typeof TerminalClearInput.Encoded) => Promise<void>;
    restart: (input: typeof TerminalRestartInput.Encoded) => Promise<TerminalSessionSnapshot>;
    close: (input: typeof TerminalCloseInput.Encoded) => Promise<void>;
    onEvent: (callback: (event: TerminalEvent) => void) => () => void;
  };
  projects: {
    listDirectory: (input: ProjectListDirectoryInput) => Promise<ProjectListDirectoryResult>;
    readFile: (input: ProjectReadFileInput) => Promise<ProjectReadFileResult>;
    searchEntries: (input: ProjectSearchEntriesInput) => Promise<ProjectSearchEntriesResult>;
    writeFile: (input: ProjectWriteFileInput) => Promise<ProjectWriteFileResult>;
    deleteFile: (input: ProjectDeleteFileInput) => Promise<ProjectDeleteFileResult>;
    createDirectory: (input: ProjectCreateDirectoryInput) => Promise<ProjectCreateDirectoryResult>;
    renamePath: (input: ProjectRenamePathInput) => Promise<ProjectRenamePathResult>;
  };
  filesystem: FilesystemApi;
  git: {
    listBranches: (input: GitListBranchesInput) => Promise<GitListBranchesResult>;
    createWorktree: (input: GitCreateWorktreeInput) => Promise<GitCreateWorktreeResult>;
    removeWorktree: (input: GitRemoveWorktreeInput) => Promise<void>;
    createBranch: (input: GitCreateBranchInput) => Promise<GitCreateBranchResult>;
    checkout: (input: GitCheckoutInput) => Promise<GitCheckoutResult>;
    init: (input: GitInitInput) => Promise<void>;
    resolvePullRequest: (input: GitPullRequestRefInput) => Promise<GitResolvePullRequestResult>;
    preparePullRequestThread: (
      input: GitPreparePullRequestThreadInput,
    ) => Promise<GitPreparePullRequestThreadResult>;
    pull: (input: GitPullInput) => Promise<GitPullResult>;
    discardPaths: (input: GitDiscardPathsInput) => Promise<void>;
    getFilePatch: (input: GitFilePatchInput) => Promise<GitFilePatchResult>;
    getFileImage: (input: GitFileImageInput) => Promise<GitFileImageResult>;
    refreshStatus: (input: GitStatusInput) => Promise<GitStatusResult>;
    onStatus: (
      input: GitStatusInput,
      callback: (status: GitStatusResult) => void,
      options?: {
        onResubscribe?: () => void;
      },
    ) => () => void;
  };
  orchestration: OrchestrationApi;
}
