import {
  CommandId,
  DEFAULT_CLIENT_SETTINGS,
  DEFAULT_SERVER_SETTINGS,
  type DesktopBridge,
  EnvironmentId,
  type GitStatusResult,
  ProjectId,
  type OrchestrationShellStreamItem,
  type ServerConfig,
  type ServerProvider,
  type TerminalEvent,
} from "@multi/contracts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ContextMenuItem } from "@multi/contracts";

const showContextMenuFallbackMock =
  vi.fn<
    <T extends string>(
      items: readonly ContextMenuItem<T>[],
      position?: { x: number; y: number },
    ) => Promise<T | null>
  >();

function registerListener<T>(listeners: Set<(event: T) => void>, listener: (event: T) => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const terminalEventListeners = new Set<(event: TerminalEvent) => void>();
const shellStreamListeners = new Set<(event: OrchestrationShellStreamItem) => void>();
const gitStatusListeners = new Set<(event: GitStatusResult) => void>();

const rpcClientMock = {
  dispose: vi.fn(),
  terminal: {
    open: vi.fn(),
    write: vi.fn(),
    resize: vi.fn(),
    clear: vi.fn(),
    restart: vi.fn(),
    close: vi.fn(),
    onEvent: vi.fn((listener: (event: TerminalEvent) => void) =>
      registerListener(terminalEventListeners, listener),
    ),
  },
  projects: {
    listDirectory: vi.fn(),
    readFile: vi.fn(),
    searchEntries: vi.fn(),
    writeFile: vi.fn(),
  },
  filesystem: {
    browse: vi.fn(),
  },
  shell: {
    openInEditor: vi.fn(),
  },
  git: {
    pull: vi.fn(),
    refreshStatus: vi.fn(),
    onStatus: vi.fn((input: { cwd: string }, listener: (event: GitStatusResult) => void) =>
      registerListener(gitStatusListeners, listener),
    ),
    runStackedAction: vi.fn(),
    listBranches: vi.fn(),
    createWorktree: vi.fn(),
    removeWorktree: vi.fn(),
    createBranch: vi.fn(),
    checkout: vi.fn(),
    init: vi.fn(),
    resolvePullRequest: vi.fn(),
    preparePullRequestThread: vi.fn(),
  },
  server: {
    getConfig: vi.fn(),
    refreshProviders: vi.fn(),
    upsertKeybinding: vi.fn(),
    getSettings: vi.fn(),
    updateSettings: vi.fn(),
    subscribeConfig: vi.fn(),
    subscribeLifecycle: vi.fn(),
    subscribeAuthAccess: vi.fn(),
  },
  orchestration: {
    dispatchCommand: vi.fn(),
    subscribeShell: vi.fn((listener: (event: OrchestrationShellStreamItem) => void) =>
      registerListener(shellStreamListeners, listener),
    ),
    subscribeThread: vi.fn(() => () => undefined),
  },
};

vi.mock("./environments/runtime", () => ({
  getPrimaryEnvironmentConnection: () => ({
    knownEnvironment: {
      id: "environment-local",
      label: "Primary",
      source: "manual",
      target: {
        httpBaseUrl: "http://localhost:3000",
        wsBaseUrl: "ws://localhost:3000",
      },
      environmentId: EnvironmentId.make("environment-local"),
    },
    client: rpcClientMock,
    environmentId: EnvironmentId.make("environment-local"),
    ensureBootstrapped: async () => undefined,
    reconnect: async () => undefined,
    dispose: async () => undefined,
  }),
  resetEnvironmentServiceForTests: vi.fn(),
}));

vi.mock("./browser/context-menu-fallback", () => ({
  showContextMenuFallback: showContextMenuFallbackMock,
}));

function emitEvent<T>(listeners: Set<(event: T) => void>, event: T) {
  for (const listener of listeners) {
    listener(event);
  }
}

function getWindowForTest(): Window & typeof globalThis & { desktopBridge?: unknown } {
  const testGlobal = globalThis as typeof globalThis & {
    window?: Window & typeof globalThis & { desktopBridge?: unknown };
  };
  if (!testGlobal.window) {
    testGlobal.window = {} as Window & typeof globalThis & { desktopBridge?: unknown };
  }
  return testGlobal.window;
}

function createLocalStorageStub(): Storage {
  const store = new Map<string, string>();
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
    removeItem: (key) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    key: (index) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
  };
}

function makeDesktopBridge(overrides: Partial<DesktopBridge> = {}): DesktopBridge {
  return {
    getAppBranding: () => null,
    getLocalEnvironmentBootstrap: () => null,
    getWindowChromeState: () => ({ fullscreen: false }),
    onWindowChromeState: () => () => undefined,
    setActiveWorkState: async () => undefined,
    getClientSettings: async () => null,
    setClientSettings: async () => undefined,
    getServerExposureState: async () => ({
      mode: "local-only",
      endpointUrl: null,
      advertisedHost: null,
    }),
    setServerExposureMode: async () => ({
      mode: "local-only",
      endpointUrl: null,
      advertisedHost: null,
    }),
    pickFolder: async () => null,
    confirm: async () => true,
    setTheme: async () => undefined,
    setBackgroundColor: async () => undefined,
    setVibrancy: async () => undefined,
    showContextMenu: async () => null,
    openExternal: async () => true,
    onMenuAction: () => () => undefined,
    getUpdateState: async () => {
      throw new Error("getUpdateState not implemented in test");
    },
    checkForUpdate: async () => {
      throw new Error("checkForUpdate not implemented in test");
    },
    downloadUpdate: async () => {
      throw new Error("downloadUpdate not implemented in test");
    },
    installUpdate: async () => {
      throw new Error("installUpdate not implemented in test");
    },
    onUpdateState: () => () => undefined,
    ...overrides,
  };
}

const defaultProviders: ReadonlyArray<ServerProvider> = [
  {
    instanceId: "codex",
    driver: "codex",
    enabled: true,
    installed: true,
    version: "0.116.0",
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-01-01T00:00:00.000Z",
    models: [],
    slashCommands: [],
    skills: [],
  },
];

const baseEnvironment = {
  environmentId: EnvironmentId.make("environment-local"),
  label: "Local environment",
  platform: {
    os: "darwin",
    arch: "arm64",
  },
  serverVersion: "0.0.0-test",
  capabilities: {
    repositoryIdentity: true,
  },
} as const;

const baseServerConfig: ServerConfig = {
  environment: baseEnvironment,
  auth: {
    policy: "loopback-browser",
    bootstrapMethods: ["one-time-token"],
    sessionMethods: ["browser-session-cookie", "bearer-session-token"],
    sessionCookieName: "t3_session",
  },
  cwd: "/tmp/project",
  keybindingsConfigPath: "/tmp/project/.config/keybindings.json",
  keybindings: [],
  issues: [],
  providers: defaultProviders,
  availableEditors: ["cursor"],
  observability: {
    logsDirectoryPath: "/tmp/project/.config/logs",
    localTracingEnabled: true,
    otlpTracesEnabled: false,
    otlpMetricsEnabled: false,
  },
  settings: DEFAULT_SERVER_SETTINGS,
};

const baseGitStatus: GitStatusResult = {
  isRepo: true,
  hasOriginRemote: true,
  isDefaultBranch: false,
  branch: "feature/streamed",
  hasWorkingTreeChanges: false,
  workingTree: { files: [], insertions: 0, deletions: 0 },
  hasUpstream: true,
  aheadCount: 0,
  behindCount: 0,
  pr: null,
};

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  showContextMenuFallbackMock.mockReset();
  terminalEventListeners.clear();
  shellStreamListeners.clear();
  gitStatusListeners.clear();
  const testWindow = getWindowForTest();
  Reflect.deleteProperty(testWindow, "desktopBridge");
  Object.defineProperty(testWindow, "localStorage", {
    configurable: true,
    value: createLocalStorageStub(),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("wsApi", () => {
  it("forwards server config fetches directly to the RPC client", async () => {
    rpcClientMock.server.getConfig.mockResolvedValue(baseServerConfig);
    const { createLocalApi } = await import("./local-api");

    const api = createLocalApi(rpcClientMock as never);

    await expect(api.server.getConfig()).resolves.toEqual(baseServerConfig);
    expect(rpcClientMock.server.getConfig).toHaveBeenCalledWith();
    expect(rpcClientMock.server.subscribeConfig).not.toHaveBeenCalled();
    expect(rpcClientMock.server.subscribeLifecycle).not.toHaveBeenCalled();
  });

  it("forwards terminal and shell stream events", async () => {
    const { createEnvironmentApi } = await import("./environment-api");

    const api = createEnvironmentApi(rpcClientMock as never);
    const onTerminalEvent = vi.fn();
    const onShellEvent = vi.fn();

    api.terminal.onEvent(onTerminalEvent);
    api.orchestration.subscribeShell(onShellEvent);

    const terminalEvent = {
      threadId: "thread-1",
      terminalId: "terminal-1",
      createdAt: "2026-02-24T00:00:00.000Z",
      type: "output",
      data: "hello",
    } as const;
    emitEvent(terminalEventListeners, terminalEvent);

    const shellEvent = {
      kind: "project-upserted",
      sequence: 1,
      project: {
        id: ProjectId.make("project-1"),
        title: "Project",
        projectRoot: "/tmp/project",
        defaultModelSelection: {
          instanceId: "codex",
          model: "gpt-5-codex",
        },
        scripts: [],
        createdAt: "2026-02-24T00:00:00.000Z",
        updatedAt: "2026-02-24T00:00:00.000Z",
      },
    } satisfies OrchestrationShellStreamItem;
    emitEvent(shellStreamListeners, shellEvent);

    expect(onTerminalEvent).toHaveBeenCalledWith(terminalEvent);
    expect(onShellEvent).toHaveBeenCalledWith(shellEvent);
  });

  it("forwards git status stream events", async () => {
    const { createEnvironmentApi } = await import("./environment-api");

    const api = createEnvironmentApi(rpcClientMock as never);
    const onStatus = vi.fn();

    api.git.onStatus({ cwd: "/repo" }, onStatus);

    const gitStatus = baseGitStatus;
    emitEvent(gitStatusListeners, gitStatus);

    expect(rpcClientMock.git.onStatus).toHaveBeenCalledWith({ cwd: "/repo" }, onStatus, undefined);
    expect(onStatus).toHaveBeenCalledWith(gitStatus);
  });

  it("forwards git status refreshes directly to the RPC client", async () => {
    rpcClientMock.git.refreshStatus.mockResolvedValue(baseGitStatus);
    const { createEnvironmentApi } = await import("./environment-api");

    const api = createEnvironmentApi(rpcClientMock as never);

    await api.git.refreshStatus({ cwd: "/repo" });

    expect(rpcClientMock.git.refreshStatus).toHaveBeenCalledWith({ cwd: "/repo" });
  });

  it("forwards shell stream subscription options to the RPC client", async () => {
    const { createEnvironmentApi } = await import("./environment-api");

    const api = createEnvironmentApi(rpcClientMock as never);
    const onShellEvent = vi.fn();
    const onResubscribe = vi.fn();

    api.orchestration.subscribeShell(onShellEvent, { onResubscribe });

    expect(rpcClientMock.orchestration.subscribeShell).toHaveBeenCalledWith(onShellEvent, {
      onResubscribe,
    });
  });

  it("sends orchestration dispatch commands as the direct RPC payload", async () => {
    rpcClientMock.orchestration.dispatchCommand.mockResolvedValue({ sequence: 1 });
    const { createEnvironmentApi } = await import("./environment-api");

    const api = createEnvironmentApi(rpcClientMock as never);
    const command = {
      type: "project.create",
      commandId: CommandId.make("cmd-1"),
      projectId: ProjectId.make("project-1"),
      title: "Project",
      projectRoot: "/tmp/project",
      defaultModelSelection: {
        instanceId: "codex",
        model: "gpt-5-codex",
      },
      createdAt: "2026-02-24T00:00:00.000Z",
    } as const;
    await api.orchestration.dispatchCommand(command);

    expect(rpcClientMock.orchestration.dispatchCommand).toHaveBeenCalledWith(command);
  });

  it("forwards project file writes to the project RPC", async () => {
    rpcClientMock.projects.writeFile.mockResolvedValue({ relativePath: "plan.md" });
    const { createEnvironmentApi } = await import("./environment-api");

    const api = createEnvironmentApi(rpcClientMock as never);
    await api.projects.writeFile({
      cwd: "/tmp/project",
      relativePath: "plan.md",
      contents: "# Plan\n",
    });

    expect(rpcClientMock.projects.writeFile).toHaveBeenCalledWith({
      cwd: "/tmp/project",
      relativePath: "plan.md",
      contents: "# Plan\n",
    });
  });

  it("forwards filesystem browse requests to the RPC client", async () => {
    rpcClientMock.filesystem.browse.mockResolvedValue({
      parentPath: "/tmp/project/",
      entries: [],
    });
    const { createEnvironmentApi } = await import("./environment-api");

    const api = createEnvironmentApi(rpcClientMock as never);
    await api.filesystem.browse({
      partialPath: "/tmp/project/",
      cwd: "/tmp/project",
    });

    expect(rpcClientMock.filesystem.browse).toHaveBeenCalledWith({
      partialPath: "/tmp/project/",
      cwd: "/tmp/project",
    });
  });

  it("forwards provider refreshes directly to the RPC client", async () => {
    const nextProviders: ReadonlyArray<ServerProvider> = [
      {
        ...defaultProviders[0]!,
        checkedAt: "2026-01-03T00:00:00.000Z",
      },
    ];
    rpcClientMock.server.refreshProviders.mockResolvedValue({ providers: nextProviders });
    const { createLocalApi } = await import("./local-api");

    const api = createLocalApi(rpcClientMock as never);

    await expect(api.server.refreshProviders()).resolves.toEqual({ providers: nextProviders });
    expect(rpcClientMock.server.refreshProviders).toHaveBeenCalledWith();
  });

  it("forwards server settings updates directly to the RPC client", async () => {
    const nextSettings = {
      ...DEFAULT_SERVER_SETTINGS,
      enableAssistantStreaming: true,
    };
    rpcClientMock.server.updateSettings.mockResolvedValue(nextSettings);
    const { createLocalApi } = await import("./local-api");

    const api = createLocalApi(rpcClientMock as never);

    await expect(api.server.updateSettings({ enableAssistantStreaming: true })).resolves.toEqual(
      nextSettings,
    );
    expect(rpcClientMock.server.updateSettings).toHaveBeenCalledWith({
      enableAssistantStreaming: true,
    });
  });

  it("forwards context menu metadata to the desktop bridge", async () => {
    const showContextMenu = vi.fn().mockResolvedValue("delete");
    getWindowForTest().desktopBridge = makeDesktopBridge({ showContextMenu });

    const { createLocalApi } = await import("./local-api");
    const api = createLocalApi(rpcClientMock as never);
    const items = [{ id: "delete", label: "Delete" }] as const;

    await expect(api.contextMenu.show(items)).resolves.toBe("delete");
    expect(showContextMenu).toHaveBeenCalledWith(items, undefined);
  });

  it("forwards folder picker options to the desktop bridge", async () => {
    const pickFolder = vi.fn().mockResolvedValue("/tmp/project");
    getWindowForTest().desktopBridge = makeDesktopBridge({ pickFolder });

    const { createLocalApi } = await import("./local-api");
    const api = createLocalApi(rpcClientMock as never);

    await expect(api.dialogs.pickFolder({ initialPath: "/tmp/project" })).resolves.toBe(
      "/tmp/project",
    );
    expect(pickFolder).toHaveBeenCalledWith({ initialPath: "/tmp/project" });
  });

  it("falls back to the browser context menu helper when the desktop bridge is missing", async () => {
    showContextMenuFallbackMock.mockResolvedValue("rename");
    const { createLocalApi } = await import("./local-api");

    const api = createLocalApi(rpcClientMock as never);
    const items = [{ id: "rename", label: "Rename" }] as const;

    await expect(api.contextMenu.show(items, { x: 4, y: 5 })).resolves.toBe("rename");
    expect(showContextMenuFallbackMock).toHaveBeenCalledWith(items, { x: 4, y: 5 });
  });

  it("reads and writes persistence through the desktop bridge when available", async () => {
    const getClientSettings = vi.fn().mockResolvedValue({
      confirmThreadArchive: true,
      confirmThreadDelete: false,
      diffWordWrap: true,
      sidebarProjectSortOrder: "manual",
      sidebarThreadSortOrder: "created_at",
      timestampFormat: "24-hour",
    });
    const setClientSettings = vi.fn().mockResolvedValue(undefined);
    getWindowForTest().desktopBridge = makeDesktopBridge({
      getClientSettings,
      setClientSettings,
    });

    const { createLocalApi } = await import("./local-api");
    const api = createLocalApi(rpcClientMock as never);

    await api.persistence.getClientSettings();
    await api.persistence.setClientSettings({
      ...DEFAULT_CLIENT_SETTINGS,
      confirmThreadArchive: true,
      confirmThreadDelete: false,
      diffWordWrap: true,
      sidebarProjectSortOrder: "manual",
      sidebarThreadSortOrder: "created_at",
      timestampFormat: "24-hour",
    });

    expect(getClientSettings).toHaveBeenCalledWith();
    expect(setClientSettings).toHaveBeenCalledWith({
      ...DEFAULT_CLIENT_SETTINGS,
      confirmThreadArchive: true,
      confirmThreadDelete: false,
      diffWordWrap: true,
      sidebarProjectSortOrder: "manual",
      sidebarThreadSortOrder: "created_at",
      timestampFormat: "24-hour",
    });
  });

  it("falls back to browser storage for persistence when the desktop bridge is missing", async () => {
    const { createLocalApi } = await import("./local-api");
    const api = createLocalApi(rpcClientMock as never);

    await api.persistence.setClientSettings({
      ...DEFAULT_CLIENT_SETTINGS,
      confirmThreadArchive: true,
      confirmThreadDelete: false,
      diffWordWrap: true,
      sidebarProjectSortOrder: "manual",
      sidebarThreadSortOrder: "created_at",
      timestampFormat: "24-hour",
    });

    await expect(api.persistence.getClientSettings()).resolves.toEqual({
      ...DEFAULT_CLIENT_SETTINGS,
      confirmThreadArchive: true,
      confirmThreadDelete: false,
      diffWordWrap: true,
      sidebarProjectSortOrder: "manual",
      sidebarThreadSortOrder: "created_at",
      timestampFormat: "24-hour",
    });
  });
});
