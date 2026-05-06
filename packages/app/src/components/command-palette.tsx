"use client";

import { scopeProjectRef, scopeThreadRef } from "@multi/client-runtime";
import {
  DEFAULT_MODEL,
  DEFAULT_MODEL_BY_PROVIDER,
  ProviderDriverKind,
  defaultInstanceIdForDriver,
  type EnvironmentId,
  type FilesystemBrowseResult,
  type ProjectId,
} from "@multi/contracts";
import { toSafeThreadSegment } from "@multi/shared/thread-segments";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import {
  IconArrowCornerLeftUp,
  IconArrowDown,
  IconArrowLeft,
  IconArrowUp,
  IconBubbleText,
  IconClipboard,
  IconCode,
  IconFolder1,
  IconFolderAddRight,
  IconPencil,
  IconSettingsGear2,
} from "central-icons";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { useShallow } from "zustand/react/shallow";
import { useCommandPaletteStore } from "../command-palette-store";
import { readEnvironmentApi } from "../environment-api";
import { readPrimaryEnvironmentDescriptor, usePrimaryEnvironmentId } from "../environments/primary";
import {
  useSavedEnvironmentRegistryStore,
  useSavedEnvironmentRuntimeStore,
} from "../environments/runtime";
import { useHandleNewThread } from "../hooks/use-handle-new-thread";
import { useSettings } from "../hooks/use-settings";
import { readLocalApi } from "../local-api";
import {
  startNewThreadInProjectFromContext,
  startNewThreadFromContext,
} from "../lib/chat-thread-actions";
import {
  appendBrowsePathSegment,
  canNavigateUp,
  ensureBrowseDirectoryPath,
  findProjectByPath,
  getBrowseDirectoryPath,
  getBrowseLeafPathSegment,
  getBrowseParentPath,
  hasTrailingPathSeparator,
  inferProjectTitleFromPath,
  isExplicitRelativeProjectPath,
  isFilesystemBrowseQuery,
  isUnsupportedWindowsProjectPath,
  resolveProjectPathForDispatch,
} from "../lib/project-paths";
import { isTerminalFocused } from "../lib/terminal-focus";
import { getLatestThreadForProject } from "../lib/thread-sort";
import { writeStoredProjectCwd } from "../lib/project-state";
import { cn, isMacPlatform, isWindowsPlatform, newCommandId, newProjectId } from "../lib/utils";
import {
  selectProjectsAcrossEnvironments,
  selectSidebarThreadsAcrossEnvironments,
  useStore,
} from "../store";
import { selectThreadTerminalState, useTerminalStateStore } from "../terminal-state-store";
import { buildThreadRouteParams, resolveThreadRouteTarget } from "../thread-routes";
import {
  buildBrowseGroups,
  buildProjectActionItems,
  buildRootGroups,
  buildThreadActionItems,
  type CommandPaletteActionItem,
  type CommandPaletteGroup,
  type CommandPaletteSubmenuItem,
  type CommandPaletteView,
  filterBrowseEntries,
  filterCommandPaletteGroups,
  getCommandPaletteInputPlaceholder,
  getCommandPaletteMode,
  RECENT_THREAD_LIMIT,
} from "./command-palette.logic";
import { resolveEnvironmentOptionLabel } from "../lib/branch-toolbar-logic";
import { CommandPaletteResults } from "./command-palette-results";
import { ProjectFavicon } from "./project-favicon";
import {
  useServerAvailableEditors,
  useServerKeybindings,
  useServerObservability,
} from "../rpc/server-state";
import { resolveShortcutCommand } from "../keybindings";
import {
  Command,
  CommandDialog,
  CommandDialogPopup,
  CommandFooter,
  CommandInput,
  CommandPanel,
} from "@multi/ui/command";
import { Button } from "@multi/ui/button";
import { Kbd, KbdGroup } from "@multi/ui/kbd";
import { toastManager } from "~/app/toast";
import { ComposerHandleContext, useComposerHandleContext } from "../composer-handle-context";
import { resolveAndPersistPreferredEditor } from "../editor-preferences";
import type { ChatComposerHandle } from "./chat/chat-composer";

const EMPTY_BROWSE_ENTRIES: FilesystemBrowseResult["entries"] = [];
const BROWSE_STALE_TIME_MS = 30_000;

function getLocalFileManagerName(platform: string): string {
  if (isMacPlatform(platform)) {
    return "Finder";
  }
  if (isWindowsPlatform(platform)) {
    return "Explorer";
  }
  return "Files";
}

function getEnvironmentBrowsePlatform(os: string | null | undefined): string {
  if (os === "windows") {
    return "Win32";
  }
  if (os === "darwin") {
    return "MacIntel";
  }
  if (os === "linux") {
    return "Linux";
  }
  return typeof navigator === "undefined" ? "" : navigator.platform;
}

function joinFileSystemPath(basePath: string, ...segments: string[]): string {
  const separator = basePath.includes("\\") && !basePath.includes("/") ? "\\" : "/";
  const normalizedBase = basePath.replace(/[\\/]+$/g, "");
  const normalizedSegments = segments.map((segment) => segment.replace(/^[\\/]+|[\\/]+$/g, ""));
  return [normalizedBase, ...normalizedSegments].join(separator);
}

interface AddProjectEnvironmentOption {
  readonly environmentId: EnvironmentId;
  readonly label: string;
  readonly isPrimary: boolean;
}

export function CommandPalette({ children }: { children: ReactNode }) {
  const open = useCommandPaletteStore((store) => store.open);
  const setOpen = useCommandPaletteStore((store) => store.setOpen);
  const toggleOpen = useCommandPaletteStore((store) => store.toggleOpen);
  const keybindings = useServerKeybindings();
  const composerHandleRef = useRef<ChatComposerHandle | null>(null);
  const routeTarget = useParams({
    strict: false,
    select: (params) => resolveThreadRouteTarget(params),
  });
  const routeThreadRef = routeTarget?.kind === "server" ? routeTarget.threadRef : null;
  const terminalOpen = useTerminalStateStore((state) =>
    routeThreadRef
      ? selectThreadTerminalState(state.terminalStateByThreadKey, routeThreadRef).terminalOpen
      : false,
  );

  useEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const command = resolveShortcutCommand(event, keybindings, {
        context: {
          terminalFocus: isTerminalFocused(),
          terminalOpen,
        },
      });
      if (command !== "commandPalette.toggle") {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      toggleOpen();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [keybindings, terminalOpen, toggleOpen]);

  return (
    <ComposerHandleContext.Provider value={composerHandleRef}>
      <CommandDialog open={open} onOpenChange={setOpen}>
        {children}
        <CommandPaletteDialog />
      </CommandDialog>
    </ComposerHandleContext.Provider>
  );
}

function CommandPaletteDialog() {
  const open = useCommandPaletteStore((store) => store.open);
  const setOpen = useCommandPaletteStore((store) => store.setOpen);

  useEffect(() => {
    return () => {
      setOpen(false);
    };
  }, [setOpen]);

  if (!open) {
    return null;
  }

  return <OpenCommandPaletteDialog />;
}

function OpenCommandPaletteDialog() {
  const navigate = useNavigate();
  const routeTarget = useParams({
    strict: false,
    select: (params) => resolveThreadRouteTarget(params),
  });
  const setOpen = useCommandPaletteStore((store) => store.setOpen);
  const openIntent = useCommandPaletteStore((store) => store.openIntent);
  const clearOpenIntent = useCommandPaletteStore((store) => store.clearOpenIntent);
  const composerHandleRef = useComposerHandleContext();
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const isActionsOnly = deferredQuery.startsWith(">");
  const queryClient = useQueryClient();
  const [highlightedItemValue, setHighlightedItemValue] = useState<string | null>(null);
  const settings = useSettings();
  const { activeDraftThread, activeThread, defaultProjectRef, handleNewThread } =
    useHandleNewThread();
  const projects = useStore(useShallow(selectProjectsAcrossEnvironments));
  const threads = useStore(useShallow(selectSidebarThreadsAcrossEnvironments));
  const keybindings = useServerKeybindings();
  const availableEditors = useServerAvailableEditors();
  const observability = useServerObservability();
  const [viewStack, setViewStack] = useState<CommandPaletteView[]>([]);
  const currentView = viewStack.at(-1) ?? null;
  const [browseGeneration, setBrowseGeneration] = useState(0);
  const [addProjectEnvironmentId, setAddProjectEnvironmentId] = useState<EnvironmentId | null>(
    null,
  );
  const [isPickingProjectFolder, setIsPickingProjectFolder] = useState(false);
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const primaryEnvironmentLabel = readPrimaryEnvironmentDescriptor()?.label ?? null;
  const savedEnvironmentRegistry = useSavedEnvironmentRegistryStore((state) => state.byId);
  const savedEnvironmentRuntimeById = useSavedEnvironmentRuntimeStore((state) => state.byId);

  const addProjectEnvironmentOptions = useMemo(() => {
    const options: AddProjectEnvironmentOption[] = [];
    const seenEnvironmentIds = new Set<EnvironmentId>();

    if (primaryEnvironmentId) {
      seenEnvironmentIds.add(primaryEnvironmentId);
      options.push({
        environmentId: primaryEnvironmentId,
        label: resolveEnvironmentOptionLabel({
          isPrimary: true,
          environmentId: primaryEnvironmentId,
          runtimeLabel: primaryEnvironmentLabel,
        }),
        isPrimary: true,
      });
    }

    for (const record of Object.values(savedEnvironmentRegistry)) {
      if (seenEnvironmentIds.has(record.environmentId)) {
        continue;
      }

      const runtimeState = savedEnvironmentRuntimeById[record.environmentId];
      options.push({
        environmentId: record.environmentId,
        label: resolveEnvironmentOptionLabel({
          isPrimary: false,
          environmentId: record.environmentId,
          runtimeLabel: runtimeState?.descriptor?.label ?? null,
          savedLabel: record.label,
        }),
        isPrimary: false,
      });
    }

    options.sort((left, right) => {
      if (left.isPrimary !== right.isPrimary) {
        return left.isPrimary ? -1 : 1;
      }
      return left.label.localeCompare(right.label);
    });

    return options;
  }, [
    primaryEnvironmentId,
    primaryEnvironmentLabel,
    savedEnvironmentRegistry,
    savedEnvironmentRuntimeById,
  ]);
  const defaultAddProjectEnvironmentId = addProjectEnvironmentOptions[0]?.environmentId ?? null;
  const browseEnvironmentId = addProjectEnvironmentId ?? defaultAddProjectEnvironmentId;
  const browseEnvironmentPlatform = useMemo(() => {
    const os =
      browseEnvironmentId && primaryEnvironmentId && browseEnvironmentId === primaryEnvironmentId
        ? (readPrimaryEnvironmentDescriptor()?.platform.os ?? null)
        : browseEnvironmentId
          ? (savedEnvironmentRuntimeById[browseEnvironmentId]?.descriptor?.platform.os ??
            savedEnvironmentRuntimeById[browseEnvironmentId]?.serverConfig?.environment.platform
              .os ??
            null)
          : null;
    return getEnvironmentBrowsePlatform(os);
  }, [browseEnvironmentId, primaryEnvironmentId, savedEnvironmentRuntimeById]);
  const isBrowsing = isFilesystemBrowseQuery(query, browseEnvironmentPlatform);
  const paletteMode = getCommandPaletteMode({ currentView, isBrowsing });
  const getAddProjectInitialQueryForEnvironment = useCallback(
    (environmentId: EnvironmentId | null): string => {
      const environmentSettings =
        environmentId && primaryEnvironmentId && environmentId === primaryEnvironmentId
          ? settings
          : environmentId
            ? savedEnvironmentRuntimeById[environmentId]?.serverConfig?.settings
            : null;
      const baseDirectory = environmentSettings?.addProjectBaseDirectory?.trim() ?? "";
      if (baseDirectory.length === 0) {
        return "~/";
      }
      return ensureBrowseDirectoryPath(baseDirectory);
    },
    [primaryEnvironmentId, savedEnvironmentRuntimeById, settings],
  );

  const projectCwdById = useMemo(
    () => new Map<ProjectId, string>(projects.map((project) => [project.id, project.cwd])),
    [projects],
  );
  const projectTitleById = useMemo(
    () => new Map<ProjectId, string>(projects.map((project) => [project.id, project.name])),
    [projects],
  );

  const activeThreadId = activeThread?.id;
  const routeThreadRef = routeTarget?.kind === "server" ? routeTarget.threadRef : null;
  const providerLogPath = useMemo(() => {
    if (!import.meta.env.DEV || !routeThreadRef || !observability?.logsDirectoryPath) {
      return null;
    }
    const safeThreadSegment = toSafeThreadSegment(routeThreadRef.threadId);
    if (!safeThreadSegment) {
      return null;
    }
    return joinFileSystemPath(observability.logsDirectoryPath, "provider", `${safeThreadSegment}.log`);
  }, [observability?.logsDirectoryPath, routeThreadRef]);
  const serverTracePath = useMemo(() => {
    if (!import.meta.env.DEV || !observability?.logsDirectoryPath) {
      return null;
    }
    return joinFileSystemPath(observability.logsDirectoryPath, "server.trace.ndjson");
  }, [observability?.logsDirectoryPath]);
  const currentProjectEnvironmentId =
    activeThread?.environmentId ?? activeDraftThread?.environmentId ?? null;
  const currentProjectId = activeThread?.projectId ?? activeDraftThread?.projectId ?? null;
  const currentProjectCwd = currentProjectId
    ? (projectCwdById.get(currentProjectId) ?? null)
    : null;
  const currentProjectCwdForBrowse =
    browseEnvironmentId && currentProjectEnvironmentId === browseEnvironmentId
      ? currentProjectCwd
      : null;
  const relativePathNeedsActiveProject =
    isExplicitRelativeProjectPath(query.trim()) && currentProjectCwdForBrowse === null;
  const browseDirectoryPath = isBrowsing ? getBrowseDirectoryPath(query) : "";
  const browseFilterQuery =
    isBrowsing && !hasTrailingPathSeparator(query) ? getBrowseLeafPathSegment(query) : "";

  const fetchBrowseResult = useCallback(
    async (partialPath: string): Promise<FilesystemBrowseResult | null> => {
      if (!browseEnvironmentId) return null;
      const api = readEnvironmentApi(browseEnvironmentId);
      if (!api) return null;
      return api.filesystem.browse({
        partialPath,
        ...(currentProjectCwdForBrowse ? { cwd: currentProjectCwdForBrowse } : {}),
      });
    },
    [browseEnvironmentId, currentProjectCwdForBrowse],
  );

  const { data: browseResult, isPending: isBrowsePending } = useQuery({
    queryKey: [
      "filesystemBrowse",
      browseEnvironmentId,
      browseDirectoryPath,
      currentProjectCwdForBrowse,
    ],
    queryFn: () => fetchBrowseResult(browseDirectoryPath),
    staleTime: BROWSE_STALE_TIME_MS,
    enabled:
      isBrowsing &&
      browseDirectoryPath.length > 0 &&
      browseEnvironmentId !== null &&
      !relativePathNeedsActiveProject,
  });
  const browseEntries = browseResult?.entries ?? EMPTY_BROWSE_ENTRIES;
  const {
    filteredEntries: filteredBrowseEntries,
    highlightedEntry: highlightedBrowseEntry,
    exactEntry: exactBrowseEntry,
  } = useMemo(
    () => filterBrowseEntries({ browseEntries, browseFilterQuery, highlightedItemValue }),
    [browseEntries, browseFilterQuery, highlightedItemValue],
  );

  const prefetchBrowsePath = useCallback(
    (partialPath: string) => {
      void queryClient.prefetchQuery({
        queryKey: [
          "filesystemBrowse",
          browseEnvironmentId,
          partialPath,
          currentProjectCwdForBrowse,
        ],
        queryFn: () => fetchBrowseResult(partialPath),
        staleTime: BROWSE_STALE_TIME_MS,
      });
    },
    [browseEnvironmentId, currentProjectCwdForBrowse, fetchBrowseResult, queryClient],
  );

  // Prefetch the parent and the most likely next child so browse navigation
  // stays warm without scanning every child directory in large trees.
  useEffect(() => {
    if (!isBrowsing || filteredBrowseEntries.length === 0) return;

    if (canNavigateUp(query)) {
      prefetchBrowsePath(getBrowseParentPath(query)!);
    }

    const nextChild = highlightedBrowseEntry ?? exactBrowseEntry;
    if (nextChild) {
      prefetchBrowsePath(appendBrowsePathSegment(query, nextChild.name));
    }
  }, [
    exactBrowseEntry,
    filteredBrowseEntries.length,
    highlightedBrowseEntry,
    isBrowsing,
    prefetchBrowsePath,
    query,
  ]);

  const openProjectFromSearch = useMemo(
    () => async (project: (typeof projects)[number]) => {
      const latestThread = getLatestThreadForProject(
        threads.filter((thread) => thread.environmentId === project.environmentId),
        project.id,
        settings.sidebarThreadSortOrder,
      );
      if (latestThread) {
        await navigate({
          to: "/$environmentId/$threadId",
          params: buildThreadRouteParams(
            scopeThreadRef(latestThread.environmentId, latestThread.id),
          ),
        });
        return;
      }

      await handleNewThread(scopeProjectRef(project.environmentId, project.id), {
        envMode: settings.defaultThreadEnvMode,
      });
    },
    [
      handleNewThread,
      navigate,
      settings.defaultThreadEnvMode,
      settings.sidebarThreadSortOrder,
      threads,
    ],
  );

  const projectSearchItems = useMemo(
    () =>
      buildProjectActionItems({
        projects,
        valuePrefix: "project",
        icon: (project) => (
          <ProjectFavicon
            environmentId={project.environmentId}
            cwd={project.cwd}
            className="size-4 text-muted-foreground/80"
          />
        ),
        runProject: openProjectFromSearch,
      }),
    [openProjectFromSearch, projects],
  );
  const projectProjectItems = useMemo<CommandPaletteActionItem[]>(
    () =>
      [...projects]
        .toSorted((left, right) => {
          const leftCurrent = left.cwd === currentProjectCwd;
          const rightCurrent = right.cwd === currentProjectCwd;
          if (leftCurrent !== rightCurrent) {
            return leftCurrent ? -1 : 1;
          }
          return left.name.localeCompare(right.name);
        })
        .map((project) => ({
          kind: "action",
          value: `project:${project.environmentId}:${project.id}`,
          searchTerms: [project.name, project.cwd],
          title: project.name,
          description: project.cwd === currentProjectCwd ? `Current • ${project.cwd}` : project.cwd,
          icon: (
            <ProjectFavicon
              environmentId={project.environmentId}
              cwd={project.cwd}
              className="size-4 text-muted-foreground/80"
            />
          ),
          run: async () => {
            await openProjectFromSearch(project);
          },
        })),
    [currentProjectCwd, openProjectFromSearch, projects],
  );

  const projectThreadItems = useMemo(
    () =>
      buildProjectActionItems({
        projects,
        valuePrefix: "new-thread-in",
        icon: (project) => (
          <ProjectFavicon
            environmentId={project.environmentId}
            cwd={project.cwd}
            className="size-4 text-muted-foreground/80"
          />
        ),
        runProject: async (project) => {
          await startNewThreadInProjectFromContext(
            {
              activeDraftThread,
              activeThread,
              defaultProjectRef,
              defaultThreadEnvMode: settings.defaultThreadEnvMode,
              handleNewThread,
            },
            scopeProjectRef(project.environmentId, project.id),
          );
        },
      }),
    [
      activeDraftThread,
      activeThread,
      defaultProjectRef,
      handleNewThread,
      projects,
      settings.defaultThreadEnvMode,
    ],
  );

  const allThreadItems = useMemo(
    () =>
      buildThreadActionItems({
        threads,
        ...(activeThreadId ? { activeThreadId } : {}),
        projectTitleById,
        sortOrder: settings.sidebarThreadSortOrder,
        icon: <IconBubbleText className="size-4 text-muted-foreground/80" />,
        runThread: async (thread) => {
          await navigate({
            to: "/$environmentId/$threadId",
            params: buildThreadRouteParams(scopeThreadRef(thread.environmentId, thread.id)),
          });
        },
      }),
    [activeThreadId, navigate, projectTitleById, settings.sidebarThreadSortOrder, threads],
  );
  const recentThreadItems = allThreadItems.slice(0, RECENT_THREAD_LIMIT);

  const copyPathToClipboard = useCallback(async (path: string, successTitle: string) => {
    if (!navigator.clipboard?.writeText) {
      toastManager.add({
        type: "error",
        title: "Clipboard unavailable",
        description: "This browser cannot write to the clipboard.",
      });
      return;
    }
    await navigator.clipboard.writeText(path);
    toastManager.add({
      type: "success",
      title: successTitle,
      description: path,
    });
  }, []);

  const openPathInPreferredEditor = useCallback(
    async (path: string, failureTitle: string) => {
      const api = readLocalApi();
      if (!api) {
        toastManager.add({
          type: "error",
          title: failureTitle,
          description: "Local editor integration is unavailable.",
        });
        return;
      }

      const editor = resolveAndPersistPreferredEditor(availableEditors ?? []);
      if (!editor) {
        toastManager.add({
          type: "error",
          title: failureTitle,
          description: "No available editors found.",
        });
        return;
      }

      await api.shell.openInEditor(path, editor);
    },
    [availableEditors],
  );

  function pushPaletteView(view: CommandPaletteView): void {
    setViewStack((previousViews) => [
      ...previousViews,
      {
        addonIcon: view.addonIcon,
        groups: view.groups,
        ...(view.initialQuery ? { initialQuery: view.initialQuery } : {}),
        ...(view.placeholder ? { placeholder: view.placeholder } : {}),
      },
    ]);
    setHighlightedItemValue(null);
    setQuery(view.initialQuery ?? "");
  }

  function pushView(item: CommandPaletteSubmenuItem): void {
    pushPaletteView({
      addonIcon: item.addonIcon,
      groups: item.groups,
      ...(item.initialQuery ? { initialQuery: item.initialQuery } : {}),
      ...(item.placeholder ? { placeholder: item.placeholder } : {}),
    });
  }

  function popView(): void {
    if (viewStack.length <= 1) {
      setAddProjectEnvironmentId(null);
    }
    setViewStack((previousViews) => previousViews.slice(0, -1));
    setHighlightedItemValue(null);
    setQuery("");
  }

  function handleQueryChange(nextQuery: string): void {
    setHighlightedItemValue(null);
    setQuery(nextQuery);
    if (nextQuery === "" && currentView?.initialQuery) {
      popView();
    }
  }

  const startAddProjectBrowse = useCallback(
    (environmentId: EnvironmentId): void => {
      setAddProjectEnvironmentId(environmentId);
      pushPaletteView({
        addonIcon: <IconFolderAddRight className="size-4" />,
        groups: [],
        initialQuery: getAddProjectInitialQueryForEnvironment(environmentId),
      });
    },
    [getAddProjectInitialQueryForEnvironment],
  );

  const addProjectEnvironmentItems: CommandPaletteActionItem[] = addProjectEnvironmentOptions.map(
    (option) => ({
      kind: "action",
      value: `action:add-project:environment:${option.environmentId}`,
      searchTerms: [option.label, option.environmentId, option.isPrimary ? "this device" : ""],
      title: option.label,
      description: option.isPrimary ? "This device" : option.environmentId,
      icon: <IconFolderAddRight className="size-4 text-muted-foreground/80" />,
      keepOpen: true,
      run: async () => {
        startAddProjectBrowse(option.environmentId);
      },
    }),
  );

  const addProjectEnvironmentGroups = useMemo<CommandPaletteView["groups"]>(
    () => [
      {
        value: "environments",
        label: "Environments",
        items: addProjectEnvironmentItems,
      },
    ],
    [addProjectEnvironmentItems],
  );

  const openAddProjectFlow = useCallback(() => {
    if (addProjectEnvironmentOptions.length > 1) {
      pushPaletteView({
        addonIcon: <IconFolderAddRight className="size-4" />,
        groups: addProjectEnvironmentGroups,
      });
      return;
    }

    const environmentId = defaultAddProjectEnvironmentId;
    if (!environmentId) {
      toastManager.add({
        type: "error",
        title: "Unable to browse projects",
        description: "No environment is available.",
      });
      return;
    }

    startAddProjectBrowse(environmentId);
  }, [
    addProjectEnvironmentGroups,
    addProjectEnvironmentOptions.length,
    defaultAddProjectEnvironmentId,
    startAddProjectBrowse,
  ]);

  const projectGroups = useMemo<CommandPaletteView["groups"]>(() => {
    const groups: CommandPaletteGroup[] = [];
    if (projectProjectItems.length > 0) {
      groups.push({
        value: "projects",
        label: "Projects",
        items: projectProjectItems,
      });
    }
    groups.push({
      value: "project-actions",
      label: "Actions",
      items: [
        {
          kind: "action",
          value: "project:add-project",
          searchTerms: ["add project", "add project", "folder", "directory", "browse"],
          title: "Add Project",
          description:
            addProjectEnvironmentOptions.length > 1
              ? "Choose an environment and folder"
              : "Choose a folder",
          icon: <IconFolderAddRight className="size-4 text-muted-foreground/80" />,
          keepOpen: true,
          run: async () => {
            openAddProjectFlow();
          },
        },
      ],
    });
    return groups;
  }, [addProjectEnvironmentOptions.length, openAddProjectFlow, projectProjectItems]);

  const openProjectFlow = useCallback(() => {
    pushPaletteView({
      addonIcon: <IconFolder1 className="size-4" />,
      groups: projectGroups,
      placeholder: "Search projects...",
    });
  }, [projectGroups]);

  useEffect(() => {
    if (!openIntent) {
      return;
    }

    clearOpenIntent();

    if (openIntent.kind === "add-project") {
      openAddProjectFlow();
      return;
    }

    openProjectFlow();
  }, [clearOpenIntent, openAddProjectFlow, openIntent, openProjectFlow]);

  const actionItems: Array<CommandPaletteActionItem | CommandPaletteSubmenuItem> = [];

  if (projects.length > 0) {
    const activeProjectTitle = currentProjectId
      ? (projectTitleById.get(currentProjectId) ?? null)
      : null;

    if (activeProjectTitle) {
      actionItems.push({
        kind: "action",
        value: "action:new-thread",
        searchTerms: ["new thread", "chat", "create", "draft"],
        title: (
          <>
            New thread in <span className="font-semibold">{activeProjectTitle}</span>
          </>
        ),
        icon: <IconPencil className="size-4 text-muted-foreground/80" />,
        shortcutCommand: "chat.new",
        run: async () => {
          await startNewThreadFromContext({
            activeDraftThread,
            activeThread,
            defaultProjectRef,
            defaultThreadEnvMode: settings.defaultThreadEnvMode,
            handleNewThread,
          });
        },
      });
    }

    actionItems.push({
      kind: "submenu",
      value: "action:new-thread-in",
      searchTerms: ["new thread", "project", "pick", "choose", "select"],
      title: "New thread in...",
      icon: <IconPencil className="size-4 text-muted-foreground/80" />,
      addonIcon: <IconPencil className="size-4" />,
      groups: [{ value: "projects", label: "Projects", items: projectThreadItems }],
    });
  }

  if (addProjectEnvironmentOptions.length > 1) {
    actionItems.push({
      kind: "submenu",
      value: "action:add-project",
      searchTerms: ["add project", "folder", "directory", "browse", "environment"],
      title: "Add project",
      icon: <IconFolderAddRight className="size-4 text-muted-foreground/80" />,
      addonIcon: <IconFolderAddRight className="size-4" />,
      groups: addProjectEnvironmentGroups,
    });
  } else {
    actionItems.push({
      kind: "action",
      value: "action:add-project",
      searchTerms: ["add project", "folder", "directory", "browse"],
      title: "Add project",
      icon: <IconFolderAddRight className="size-4 text-muted-foreground/80" />,
      keepOpen: true,
      run: async () => {
        openAddProjectFlow();
      },
    });
  }

  actionItems.push({
    kind: "action",
    value: "action:settings",
    searchTerms: ["settings", "preferences", "configuration", "keybindings"],
    title: "Open settings",
    icon: <IconSettingsGear2 className="size-4 text-muted-foreground/80" />,
    run: async () => {
      await navigate({ to: "/settings" });
    },
  });

  if (providerLogPath) {
    actionItems.push({
      kind: "action",
      value: `action:debug:copy-provider-log:${routeThreadRef?.threadId ?? "current"}`,
      searchTerms: [
        "copy provider log path",
        "copy thread log path",
        "debug",
        "logs",
        routeThreadRef?.threadId ?? "",
      ],
      title: "Copy provider log path",
      description: "Current thread provider event log",
      icon: <IconClipboard className="size-4 text-muted-foreground/80" />,
      run: async () => {
        await copyPathToClipboard(providerLogPath, "Copied provider log path");
      },
    });
    actionItems.push({
      kind: "action",
      value: `action:debug:open-provider-log:${routeThreadRef?.threadId ?? "current"}`,
      searchTerms: [
        "open provider log",
        "open thread log",
        "debug",
        "logs",
        routeThreadRef?.threadId ?? "",
      ],
      title: "Open provider log",
      description: "Open current thread provider event log in your editor",
      icon: <IconCode className="size-4 text-muted-foreground/80" />,
      run: async () => {
        try {
          await openPathInPreferredEditor(providerLogPath, "Unable to open provider log");
        } catch (error) {
          toastManager.add({
            type: "error",
            title: "Unable to open provider log",
            description: error instanceof Error ? error.message : "An error occurred.",
          });
        }
      },
    });
  }

  if (serverTracePath) {
    actionItems.push({
      kind: "action",
      value: "action:debug:copy-server-trace",
      searchTerms: ["copy server trace path", "copy trace path", "debug", "trace", "logs"],
      title: "Copy server trace path",
      description: "Local server trace NDJSON file",
      icon: <IconClipboard className="size-4 text-muted-foreground/80" />,
      run: async () => {
        await copyPathToClipboard(serverTracePath, "Copied server trace path");
      },
    });
  }

  const rootGroups = buildRootGroups({ actionItems, recentThreadItems });
  const activeGroups = currentView ? currentView.groups : rootGroups;

  const filteredGroups = filterCommandPaletteGroups({
    activeGroups,
    query: deferredQuery,
    isInSubmenu: currentView !== null,
    projectSearchItems: projectSearchItems,
    threadSearchItems: allThreadItems,
  });

  const handleAddProject = useCallback(
    async (rawCwd: string) => {
      if (!browseEnvironmentId) return;
      const api = readEnvironmentApi(browseEnvironmentId);
      if (!api) return;

      if (isUnsupportedWindowsProjectPath(rawCwd.trim(), browseEnvironmentPlatform)) {
        toastManager.add({
          type: "error",
          title: "Failed to add project",
          description: "Windows-style paths are only supported on Windows.",
        });
        return;
      }

      if (isExplicitRelativeProjectPath(rawCwd.trim()) && !currentProjectCwdForBrowse) {
        toastManager.add({
          type: "error",
          title: "Failed to add project",
          description: "Relative paths require an active project.",
        });
        return;
      }

      const cwd = resolveProjectPathForDispatch(rawCwd, currentProjectCwdForBrowse);
      if (cwd.length === 0) return;

      const existing = findProjectByPath(
        projects.filter((project) => project.environmentId === browseEnvironmentId),
        cwd,
      );
      if (existing) {
        writeStoredProjectCwd(cwd);
        const latestThread = getLatestThreadForProject(
          threads.filter((thread) => thread.environmentId === existing.environmentId),
          existing.id,
          settings.sidebarThreadSortOrder,
        );
        if (latestThread) {
          await navigate({
            to: "/$environmentId/$threadId",
            params: buildThreadRouteParams(
              scopeThreadRef(latestThread.environmentId, latestThread.id),
            ),
          });
        } else {
          await handleNewThread(scopeProjectRef(existing.environmentId, existing.id), {
            envMode: settings.defaultThreadEnvMode,
          }).catch(() => undefined);
        }
        setOpen(false);
        return;
      }

      try {
        const projectId = newProjectId();
        await api.orchestration.dispatchCommand({
          type: "project.create",
          commandId: newCommandId(),
          projectId,
          title: inferProjectTitleFromPath(cwd),
          projectRoot: cwd,
          createProjectRootIfMissing: true,
          defaultModelSelection: {
            instanceId: defaultInstanceIdForDriver(ProviderDriverKind.make("codex")),
            model: DEFAULT_MODEL_BY_PROVIDER[ProviderDriverKind.make("codex")] ?? DEFAULT_MODEL,
          },
          createdAt: new Date().toISOString(),
        });
        writeStoredProjectCwd(cwd);
        await handleNewThread(scopeProjectRef(browseEnvironmentId, projectId), {
          envMode: settings.defaultThreadEnvMode,
        }).catch(() => undefined);
        setOpen(false);
      } catch (error) {
        toastManager.add({
          type: "error",
          title: "Failed to add project",
          description: error instanceof Error ? error.message : "An error occurred.",
        });
      }
    },
    [
      browseEnvironmentId,
      browseEnvironmentPlatform,
      currentProjectCwdForBrowse,
      handleNewThread,
      navigate,
      projects,
      setOpen,
      settings.defaultThreadEnvMode,
      settings.sidebarThreadSortOrder,
      threads,
    ],
  );

  function browseTo(name: string): void {
    const nextQuery = appendBrowsePathSegment(query, name);
    setHighlightedItemValue(null);
    setQuery(nextQuery);
    setBrowseGeneration((generation) => generation + 1);
  }

  function browseUp(): void {
    const parentPath = getBrowseParentPath(query);
    if (parentPath === null) {
      return;
    }

    setHighlightedItemValue(null);
    setQuery(parentPath);
    setBrowseGeneration((generation) => generation + 1);
  }

  // Resolve the add-project path from browse data when available. When the
  // query has a trailing separator (e.g. "~/projects/foo/"), parentPath is the
  // directory itself. Otherwise the user typed a partial leaf name, so we need
  // the exact browse entry's fullPath or fall back to the raw query.
  const resolvedAddProjectPath = hasTrailingPathSeparator(query)
    ? (browseResult?.parentPath ?? query.trim())
    : (exactBrowseEntry?.fullPath ?? query.trim());

  const canBrowseUp =
    isBrowsing && !relativePathNeedsActiveProject && canNavigateUp(browseDirectoryPath);

  const browseGroups = buildBrowseGroups({
    browseEntries: filteredBrowseEntries,
    browseQuery: query,
    canBrowseUp,
    upIcon: <IconArrowCornerLeftUp className="size-4 text-muted-foreground/80" />,
    directoryIcon: <IconFolder1 className="size-4 text-muted-foreground/80" />,
    browseUp,
    browseTo,
  });

  let displayedGroups = filteredGroups;
  if (isBrowsing) {
    displayedGroups = relativePathNeedsActiveProject ? [] : browseGroups;
  }

  const inputPlaceholder =
    currentView?.placeholder ?? getCommandPaletteInputPlaceholder(paletteMode);
  const isSubmenu = paletteMode === "submenu" || paletteMode === "submenu-browse";
  const hasHighlightedBrowseItem = highlightedItemValue?.startsWith("browse:") ?? false;
  const canSubmitBrowsePath = isBrowsing && !relativePathNeedsActiveProject;
  const willCreateProjectPath =
    canSubmitBrowsePath &&
    !isBrowsePending &&
    query.trim().length > 0 &&
    !hasHighlightedBrowseItem &&
    (hasTrailingPathSeparator(query) ? !browseResult : exactBrowseEntry === null);
  const useMetaForMod = isMacPlatform(navigator.platform);
  const submitModifierLabel = useMetaForMod ? "\u2318" : "Ctrl";
  const submitActionLabel = willCreateProjectPath ? "Create & Add" : "Add";
  const addShortcutLabel = hasHighlightedBrowseItem ? `${submitModifierLabel} Enter` : "Enter";
  const fileManagerName = getLocalFileManagerName(navigator.platform);
  const canOpenProjectFromFileManager =
    isBrowsing &&
    browseEnvironmentId !== null &&
    primaryEnvironmentId !== null &&
    browseEnvironmentId === primaryEnvironmentId &&
    typeof window !== "undefined" &&
    window.desktopBridge !== undefined;
  const fileManagerInitialPath = useMemo(() => {
    if (!canOpenProjectFromFileManager) {
      return undefined;
    }

    const trimmedQuery = query.trim();
    if (trimmedQuery.length === 0) {
      return undefined;
    }

    const initialPath = hasTrailingPathSeparator(query)
      ? (browseResult?.parentPath ?? trimmedQuery)
      : browseDirectoryPath || trimmedQuery;

    const resolvedPath = resolveProjectPathForDispatch(initialPath, currentProjectCwdForBrowse);
    return resolvedPath.length > 0 ? resolvedPath : undefined;
  }, [
    browseDirectoryPath,
    browseResult?.parentPath,
    canOpenProjectFromFileManager,
    currentProjectCwdForBrowse,
    query,
  ]);

  function isPrimaryModifierPressed(event: KeyboardEvent<HTMLInputElement>): boolean {
    return useMetaForMod ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    const shouldSubmitBrowsePath =
      canSubmitBrowsePath &&
      event.key === "Enter" &&
      (!hasHighlightedBrowseItem || isPrimaryModifierPressed(event));

    if (shouldSubmitBrowsePath) {
      event.preventDefault();
      void handleAddProject(resolvedAddProjectPath);
      return;
    }

    if (event.key === "Backspace" && query === "" && isSubmenu) {
      event.preventDefault();
      popView();
    }
  }

  function executeItem(item: CommandPaletteActionItem | CommandPaletteSubmenuItem): void {
    if (item.kind === "submenu") {
      pushView(item);
      return;
    }

    if (!item.keepOpen) {
      setOpen(false);
    }

    void item.run().catch((error: unknown) => {
      toastManager.add({
        type: "error",
        title: "Unable to run command",
        description: error instanceof Error ? error.message : "An unexpected error occurred.",
      });
    });
  }

  const handleOpenProjectFromFileManager = useCallback(async () => {
    if (!canOpenProjectFromFileManager || isPickingProjectFolder) {
      return;
    }
    const api = readLocalApi();
    if (!api) {
      return;
    }

    setIsPickingProjectFolder(true);
    let pickedPath: string | null = null;
    try {
      pickedPath = await api.dialogs.pickFolder(
        fileManagerInitialPath ? { initialPath: fileManagerInitialPath } : undefined,
      );
    } catch {
      // Ignore picker failures and leave the palette open.
      setIsPickingProjectFolder(false);
      return;
    }
    setIsPickingProjectFolder(false);
    if (!pickedPath) {
      return;
    }
    await handleAddProject(pickedPath);
  }, [
    canOpenProjectFromFileManager,
    fileManagerInitialPath,
    handleAddProject,
    isPickingProjectFolder,
  ]);

  return (
    <CommandDialogPopup
      aria-label="Command palette"
      className="overflow-hidden p-0"
      data-testid="command-palette"
      finalFocus={() => {
        composerHandleRef?.current?.focusAtEnd();
        return false;
      }}
    >
      <Command
        key={`${viewStack.length}-${browseGeneration}-${isBrowsing}`}
        aria-label="Command palette"
        autoHighlight={isBrowsing ? false : "always"}
        mode="none"
        onItemHighlighted={(value) => {
          setHighlightedItemValue(typeof value === "string" ? value : null);
        }}
        onValueChange={handleQueryChange}
        value={query}
      >
        <div className="relative">
          <CommandInput
            className={isBrowsing ? (willCreateProjectPath ? "pe-36" : "pe-16") : undefined}
            placeholder={inputPlaceholder}
            wrapperClassName={
              isSubmenu ? "[&_[data-slot=autocomplete-start-addon]]:pointer-events-auto" : undefined
            }
            {...(isSubmenu
              ? {
                  startAddon: (
                    <button
                      type="button"
                      className="flex cursor-pointer items-center"
                      aria-label="Back"
                      onClick={popView}
                    >
                      <IconArrowLeft />
                    </button>
                  ),
                }
              : isBrowsing && !isSubmenu
                ? {
                    startAddon: <IconFolderAddRight />,
                  }
                : {})}
            onKeyDown={handleKeyDown}
          />
          {isBrowsing ? (
            <Button
              variant="outline"
              size="xs"
              tabIndex={-1}
              className={cn(
                "absolute end-2.5 top-1/2 pe-1 ps-2 -translate-y-1/2",
                hasHighlightedBrowseItem ? "gap-1" : "gap-1.5",
              )}
              aria-label={`${submitActionLabel} (${addShortcutLabel})`}
              disabled={relativePathNeedsActiveProject}
              onMouseDown={(event) => {
                event.preventDefault();
              }}
              onClick={() => {
                if (relativePathNeedsActiveProject) {
                  return;
                }
                void handleAddProject(resolvedAddProjectPath);
              }}
              title={`${submitActionLabel} (${addShortcutLabel})`}
            >
              <span>{submitActionLabel}</span>
              <KbdGroup className="pointer-events-none -me-0.5 items-center gap-1">
                <Kbd>{hasHighlightedBrowseItem ? `${submitModifierLabel} Enter` : "Enter"}</Kbd>
              </KbdGroup>
            </Button>
          ) : null}
        </div>
        <CommandPanel className="max-h-[min(28rem,70vh)]">
          <CommandPaletteResults
            groups={displayedGroups}
            highlightedItemValue={highlightedItemValue}
            isActionsOnly={isActionsOnly}
            keybindings={keybindings}
            onExecuteItem={executeItem}
            {...(relativePathNeedsActiveProject
              ? { emptyStateMessage: "Relative paths require an active project." }
              : willCreateProjectPath
                ? {
                    emptyStateMessage: "Press Enter to create this folder and add it as a project.",
                  }
                : {})}
          />
        </CommandPanel>
        <CommandFooter className="gap-3 max-sm:flex-col max-sm:items-start">
          <div className="flex items-center gap-3">
            <KbdGroup className="items-center gap-1.5">
              <Kbd>
                <IconArrowUp />
              </Kbd>
              <Kbd>
                <IconArrowDown />
              </Kbd>
              <span className={cn("text-muted-foreground/80")}>Navigate</span>
            </KbdGroup>
            {!canSubmitBrowsePath || hasHighlightedBrowseItem ? (
              <KbdGroup className="items-center gap-1.5">
                <Kbd>Enter</Kbd>
                <span className={cn("text-muted-foreground/80")}>Select</span>
              </KbdGroup>
            ) : null}
            {isSubmenu ? (
              <KbdGroup className="items-center gap-1.5">
                <Kbd>Backspace</Kbd>
                <span className={cn("text-muted-foreground/80")}>Back</span>
              </KbdGroup>
            ) : null}
            <KbdGroup className="items-center gap-1.5">
              <Kbd>Esc</Kbd>
              <span className={cn("text-muted-foreground/80")}>Close</span>
            </KbdGroup>
          </div>
          {canOpenProjectFromFileManager ? (
            <button
              type="button"
              disabled={isPickingProjectFolder}
              className={cn(
                "text-xs underline-offset-2 hover:underline disabled:opacity-50",
                "text-muted-foreground/80 hover:text-foreground",
              )}
              onClick={() => {
                void handleOpenProjectFromFileManager();
              }}
            >
              {`Open in ${fileManagerName}`}
            </button>
          ) : null}
        </CommandFooter>
      </Command>
    </CommandDialogPopup>
  );
}
