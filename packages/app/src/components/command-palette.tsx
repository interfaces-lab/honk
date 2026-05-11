"use client";

import { scopeProjectRef, scopeThreadRef } from "@multi/client-runtime";
import {
  DEFAULT_MODEL,
  DEFAULT_MODEL_BY_PROVIDER,
  ProviderDriverKind,
  defaultInstanceIdForDriver,
  type ProjectId,
} from "@multi/contracts";
import { toSafeThreadSegment } from "@multi/shared/thread-segments";
import { useNavigate, useParams } from "@tanstack/react-router";
import {
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
import { usePrimaryEnvironmentId } from "../environments/primary";
import { useHandleNewThread } from "../hooks/use-handle-new-thread";
import { useSettings } from "../hooks/use-settings";
import { readLocalApi } from "../local-api";
import {
  startNewThreadInProjectFromContext,
  startNewThreadFromContext,
} from "../lib/chat-thread-actions";
import { findProjectByPath, inferProjectTitleFromPath } from "../lib/project-paths";
import { isTerminalFocused } from "../lib/terminal-focus";
import { getLatestThreadForProject } from "../lib/thread-sort";
import { writeStoredProjectCwd } from "../lib/project-state";
import { cn, newCommandId, newProjectId } from "../lib/utils";
import {
  selectProjectsAcrossEnvironments,
  selectSidebarThreadsAcrossEnvironments,
  useStore,
} from "../store";
import { selectThreadTerminalState, useTerminalStateStore } from "../terminal-state-store";
import { buildThreadRouteParams, resolveThreadRouteTarget } from "../thread-routes";
import {
  buildProjectActionItems,
  buildRootGroups,
  buildThreadActionItems,
  type CommandPaletteActionItem,
  type CommandPaletteGroup,
  type CommandPaletteSubmenuItem,
  type CommandPaletteView,
  filterCommandPaletteGroups,
  getCommandPaletteInputPlaceholder,
  getCommandPaletteMode,
  RECENT_THREAD_LIMIT,
} from "./command-palette.logic";
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
import { Kbd, KbdGroup } from "@multi/ui/kbd";
import { toastManager } from "~/app/toast";
import { ComposerHandleContext, useComposerHandleContext } from "../composer-handle-context";
import { resolveAndPersistPreferredEditor } from "../editor-preferences";
import type { ChatComposerHandle } from "./chat/composer/chat-composer";

function joinFileSystemPath(basePath: string, ...segments: string[]): string {
  const separator = basePath.includes("\\") && !basePath.includes("/") ? "\\" : "/";
  const normalizedBase = basePath.replace(/[\\/]+$/g, "");
  const normalizedSegments = segments.map((segment) => segment.replace(/^[\\/]+|[\\/]+$/g, ""));
  return [normalizedBase, ...normalizedSegments].join(separator);
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
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const paletteMode = getCommandPaletteMode({ currentView });

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
    return joinFileSystemPath(
      observability.logsDirectoryPath,
      "provider",
      `${safeThreadSegment}.log`,
    );
  }, [observability?.logsDirectoryPath, routeThreadRef]);
  const serverTracePath = useMemo(() => {
    if (!import.meta.env.DEV || !observability?.logsDirectoryPath) {
      return null;
    }
    return joinFileSystemPath(observability.logsDirectoryPath, "server.trace.ndjson");
  }, [observability?.logsDirectoryPath]);
  const currentProjectId = activeThread?.projectId ?? activeDraftThread?.projectId ?? null;
  const currentProjectCwd = currentProjectId
    ? (projectCwdById.get(currentProjectId) ?? null)
    : null;

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

  const handleAddProject = useCallback(
    async (rawCwd: string) => {
      const environmentId = primaryEnvironmentId;
      if (!environmentId) return;
      const api = readEnvironmentApi(environmentId);
      if (!api) return;

      const cwd = rawCwd.trim();
      if (cwd.length === 0) return;

      const existing = findProjectByPath(
        projects.filter((project) => project.environmentId === environmentId),
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
        return;
      }

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
      await handleNewThread(scopeProjectRef(environmentId, projectId), {
        envMode: settings.defaultThreadEnvMode,
      }).catch(() => undefined);
    },
    [
      handleNewThread,
      navigate,
      primaryEnvironmentId,
      projects,
      settings.defaultThreadEnvMode,
      settings.sidebarThreadSortOrder,
      threads,
    ],
  );

  const openAddProjectFlow = useCallback(() => {
    if (!primaryEnvironmentId) {
      toastManager.add({
        type: "error",
        title: "Unable to add project",
        description: "No local environment is available.",
      });
      return;
    }
    if (typeof window === "undefined" || !window.desktopBridge) {
      toastManager.add({
        type: "error",
        title: "Unable to add project",
        description: "Add Project is only available in the desktop app.",
      });
      return;
    }
    const api = readLocalApi();
    if (!api) {
      toastManager.add({
        type: "error",
        title: "Unable to add project",
        description: "Local desktop integration is unavailable.",
      });
      return;
    }

    setOpen(false);
    const baseDirectory = settings.addProjectBaseDirectory.trim();
    void api.dialogs
      .pickFolder({ initialPath: baseDirectory.length > 0 ? baseDirectory : "~/" })
      .then((pickedPath) => {
        if (!pickedPath) {
          return;
        }
        return handleAddProject(pickedPath);
      })
      .catch((error: unknown) => {
        toastManager.add({
          type: "error",
          title: "Failed to add project",
          description: error instanceof Error ? error.message : "An error occurred.",
        });
      });
  }, [handleAddProject, primaryEnvironmentId, setOpen, settings.addProjectBaseDirectory]);

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
          searchTerms: ["add project", "add project", "folder", "directory"],
          title: "Add Project",
          description: "Choose a folder",
          icon: <IconFolderAddRight className="size-4 text-muted-foreground/80" />,
          keepOpen: true,
          run: async () => {
            openAddProjectFlow();
          },
        },
      ],
    });
    return groups;
  }, [openAddProjectFlow, projectProjectItems]);

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

  actionItems.push({
    kind: "action",
    value: "action:add-project",
    searchTerms: ["add project", "folder", "directory"],
    title: "Add project",
    icon: <IconFolderAddRight className="size-4 text-muted-foreground/80" />,
    keepOpen: true,
    run: async () => {
      openAddProjectFlow();
    },
  });

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

  const displayedGroups = filteredGroups;
  const inputPlaceholder =
    currentView?.placeholder ?? getCommandPaletteInputPlaceholder(paletteMode);
  const isSubmenu = paletteMode === "submenu";

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
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
        key={`${viewStack.length}`}
        aria-label="Command palette"
        autoHighlight="always"
        mode="none"
        onItemHighlighted={(value) => {
          setHighlightedItemValue(typeof value === "string" ? value : null);
        }}
        onValueChange={handleQueryChange}
        value={query}
      >
        <div className="relative">
          <CommandInput
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
              : {})}
            onKeyDown={handleKeyDown}
          />
        </div>
        <CommandPanel className="max-h-[min(28rem,70vh)]">
          <CommandPaletteResults
            groups={displayedGroups}
            highlightedItemValue={highlightedItemValue}
            isActionsOnly={isActionsOnly}
            keybindings={keybindings}
            onExecuteItem={executeItem}
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
            <KbdGroup className="items-center gap-1.5">
              <Kbd>Enter</Kbd>
              <span className={cn("text-muted-foreground/80")}>Select</span>
            </KbdGroup>
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
        </CommandFooter>
      </Command>
    </CommandDialogPopup>
  );
}
