"use client";

import { scopeProjectRef, scopeThreadRef } from "~/lib/environment-scope";
import {
  type ProjectId,
  type ResolvedKeybindingsConfig,
  type ScopedProjectRef,
} from "@multi/contracts";
import { toSafeThreadSegment } from "@multi/shared/thread-segments";
import { useNavigate, useParams } from "@tanstack/react-router";
import {
  IconChevronLeftMedium,
  IconChevronRightMedium,
  IconBubbleText,
  IconClipboard,
  IconCode,
  IconFolder1,
  IconFolderAddRight,
  IconPencil,
  IconSettingsGear2,
} from "central-icons";
import { useDeferredValue, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";
import { useCommandPaletteStore } from "../stores/ui/command-palette-store";
import { readEnvironmentApi } from "../environment-api";
import { usePrimaryEnvironmentId } from "../environments/primary";
import { useHandleNewThread } from "../hooks/use-handle-new-thread";
import { useMountEffect } from "../hooks/use-mount-effect";
import { useSettings } from "../hooks/use-settings";
import { readLocalApi } from "../local-api";
import {
  startNewThreadInProjectFromContext,
  startNewThreadFromContext,
} from "../lib/chat-thread-actions";
import { findProjectByPath, inferProjectTitleFromPath } from "../lib/project-paths";
import { isTerminalFocused } from "../lib/terminal-focus";
import { getLatestThreadForProject } from "../lib/thread-sort";
import { writeStoredProjectSelection } from "../lib/project-state";
import { findWorkspaceProjectForSource } from "../lib/workspace-target";
import { cn, newCommandId, newProjectId } from "../lib/utils";
import {
  selectProjectByRef,
  selectProjectsAcrossEnvironments,
  selectSidebarThreadsAcrossEnvironments,
  useStore,
} from "../stores/thread-store";
import { applyLocalProjectCreated } from "../stores/local-orchestration-events";
import { selectThreadTerminalState, useTerminalStateStore } from "../terminal-state-store";
import {
  buildThreadRouteParams,
  resolveThreadRouteTarget,
} from "~/app/routes/thread-route-targets";
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
} from "./command-palette-model";
import { type Project } from "../types";
import { ProjectFavicon } from "./project-favicon";
import { formatSchemaBackedTransportErrorDescription } from "~/rpc/transport-error";
import {
  useServerAvailableEditors,
  useServerKeybindings,
  useServerObservability,
} from "../rpc/server-state";
import {
  COMMAND_PALETTE_FALLBACK_KEYBINDINGS,
  resolveShortcutCommand,
  shortcutLabelForCommand,
} from "../keybindings";
import {
  Command,
  CommandCollection,
  CommandDialog,
  CommandDialogPopup,
  CommandFooter,
  CommandGroup,
  CommandGroupLabel,
  CommandInput,
  CommandItem,
  CommandList,
  CommandPanel,
  CommandShortcut,
} from "@multi/ui/command";
import { Kbd, KbdGroup } from "@multi/ui/kbd";
import { toastManager } from "~/app/toast";
import {
  ComposerHandleContext,
  useComposerHandleContext,
} from "./chat/composer/context/handle-context";
import { resolveAndPersistPreferredEditor } from "../editor-preferences";
import type { ComposerInputHandle } from "./chat/composer/input";

function joinFileSystemPath(basePath: string, ...segments: string[]): string {
  const separator = basePath.includes("\\") && !basePath.includes("/") ? "\\" : "/";
  const normalizedBase = basePath.replace(/[\\/]+$/g, "");
  const normalizedSegments = segments.map((segment) => segment.replace(/^[\\/]+|[\\/]+$/g, ""));
  return [normalizedBase, ...normalizedSegments].join(separator);
}

interface CommandPaletteResultsProps {
  readonly groups: ReadonlyArray<CommandPaletteGroup>;
  readonly highlightedItemValue?: string | null;
  readonly isActionsOnly: boolean;
  readonly keybindings: ResolvedKeybindingsConfig;
  readonly onExecuteItem: (item: CommandPaletteActionItem | CommandPaletteSubmenuItem) => void;
}

interface CommandPaletteSessionState {
  readonly sessionId: number;
  readonly viewStack: CommandPaletteView[];
  readonly query: string;
  readonly highlightedItemValue: string | null;
}

function CommandPaletteResults(props: CommandPaletteResultsProps) {
  if (props.groups.length === 0) {
    return (
      <div className="py-8 text-center font-multi text-body text-muted-foreground">
        {props.isActionsOnly
          ? "No matching actions."
          : "No matching commands, projects, or threads."}
      </div>
    );
  }

  return (
    <CommandList>
      {props.groups.map((group) => (
        <CommandGroup items={group.items} key={group.value}>
          <CommandGroupLabel>{group.label}</CommandGroupLabel>
          <CommandCollection>
            {(item) => (
              <CommandPaletteResultRow
                item={item}
                key={item.value}
                keybindings={props.keybindings}
                isActive={props.highlightedItemValue === item.value}
                onExecuteItem={props.onExecuteItem}
              />
            )}
          </CommandCollection>
        </CommandGroup>
      ))}
    </CommandList>
  );
}

function CommandPaletteResultRow(props: {
  readonly item: CommandPaletteActionItem | CommandPaletteSubmenuItem;
  readonly isActive: boolean;
  readonly keybindings: ResolvedKeybindingsConfig;
  readonly onExecuteItem: (item: CommandPaletteActionItem | CommandPaletteSubmenuItem) => void;
}) {
  const shortcutLabel = props.item.shortcutCommand
    ? shortcutLabelForCommand(props.keybindings, props.item.shortcutCommand)
    : null;

  return (
    <CommandItem
      value={props.item.value}
      className={cn(
        "cursor-pointer gap-2 hover:bg-transparent hover:text-inherit data-highlighted:bg-transparent data-highlighted:text-inherit data-selected:bg-transparent data-selected:text-inherit [&[data-highlighted][data-selected]]:bg-transparent [&[data-highlighted][data-selected]]:text-inherit",
        props.isActive && "bg-multi-hover! text-foreground!",
      )}
      onMouseDown={(event) => {
        event.preventDefault();
      }}
      onClick={() => {
        props.onExecuteItem(props.item);
      }}
    >
      {props.item.icon}
      {props.item.description ? (
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-body text-foreground">{props.item.title}</span>
          <span className="truncate text-detail text-muted-foreground/64">
            {props.item.description}
          </span>
        </span>
      ) : (
        <span className="flex min-w-0 items-center gap-1.5 truncate text-body text-foreground">
          <span className="truncate">{props.item.title}</span>
        </span>
      )}
      {props.item.timestamp ? (
        <span className="min-w-12 shrink-0 text-right text-caption tabular-nums text-muted-foreground/62">
          {props.item.timestamp}
        </span>
      ) : null}
      {shortcutLabel ? <CommandShortcut>{shortcutLabel}</CommandShortcut> : null}
      {props.item.kind === "submenu" ? (
        <IconChevronRightMedium className="ml-auto size-4 shrink-0 text-muted-foreground/50" />
      ) : null}
    </CommandItem>
  );
}

export function CommandPalette({ children }: { children: ReactNode }) {
  const open = useCommandPaletteStore((store) => store.open);
  const setOpen = useCommandPaletteStore((store) => store.setOpen);
  const toggleOpen = useCommandPaletteStore((store) => store.toggleOpen);
  const keybindings = useServerKeybindings();
  const composerHandleRef = useRef<ComposerInputHandle | null>(null);
  const keybindingsRef = useRef(keybindings);
  const terminalOpenRef = useRef(false);
  const toggleOpenRef = useRef(toggleOpen);
  const activeKeybindings =
    keybindings.length > 0 ? keybindings : COMMAND_PALETTE_FALLBACK_KEYBINDINGS;
  const routeParams = useParams({ strict: false });
  const routeTarget = resolveThreadRouteTarget(routeParams);
  const routeThreadRef = routeTarget?.kind === "server" ? routeTarget.threadRef : null;
  const terminalOpen = useTerminalStateStore((state) =>
    routeThreadRef
      ? selectThreadTerminalState(state.terminalStateByThreadKey, routeThreadRef).terminalOpen
      : false,
  );
  keybindingsRef.current = activeKeybindings;
  terminalOpenRef.current = terminalOpen;
  toggleOpenRef.current = toggleOpen;

  useMountEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const command = resolveShortcutCommand(event, keybindingsRef.current, {
        context: {
          terminalFocus: isTerminalFocused(),
          terminalOpen: terminalOpenRef.current,
        },
      });
      if (command !== "commandPalette.toggle") {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      toggleOpenRef.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

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
  const setOpen = useCommandPaletteStore((store) => store.setOpen);

  useMountEffect(() => () => setOpen(false));

  return <OpenCommandPaletteDialog />;
}

async function copyPathToClipboard(path: string, successTitle: string) {
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
}

function projectCommandPaletteIcon(project: Project): ReactNode {
  return (
    <ProjectFavicon
      environmentId={project.environmentId}
      cwd={project.cwd}
      className="size-4 text-muted-foreground/80"
    />
  );
}

const PROJECT_LINK_TIMEOUT_MS = 5000;

async function waitForProjectInStore(projectRef: ScopedProjectRef): Promise<void> {
  if (selectProjectByRef(useStore.getState(), projectRef)) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    let unsubscribe = () => {};
    const timeout = window.setTimeout(() => {
      unsubscribe();
      reject(new Error("Workspace was created but did not become available in the local store."));
    }, PROJECT_LINK_TIMEOUT_MS);

    unsubscribe = useStore.subscribe((state) => {
      if (!selectProjectByRef(state, projectRef)) {
        return;
      }

      window.clearTimeout(timeout);
      unsubscribe();
      resolve();
    });
  });
}

function OpenCommandPaletteDialog() {
  const navigate = useNavigate();
  const routeParams = useParams({ strict: false });
  const routeTarget = resolveThreadRouteTarget(routeParams);
  const open = useCommandPaletteStore((store) => store.open);
  const openSessionId = useCommandPaletteStore((store) => store.openSessionId);
  const setOpen = useCommandPaletteStore((store) => store.setOpen);
  const openIntent = useCommandPaletteStore((store) => store.openIntent);
  const composerHandleRef = useComposerHandleContext();
  const openAddProjectFlowRef = useRef<() => void>(() => undefined);
  const settings = useSettings();
  const { activeDraftThread, activeThread, defaultProjectRef, handleNewThread } =
    useHandleNewThread();
  const projects = useStore(useShallow(selectProjectsAcrossEnvironments));
  const threads = useStore(useShallow(selectSidebarThreadsAcrossEnvironments));
  const keybindings = useServerKeybindings();
  const availableEditors = useServerAvailableEditors();
  const observability = useServerObservability();
  const primaryEnvironmentId = usePrimaryEnvironmentId();

  const projectCwdById = new Map<ProjectId, string>(
    projects.map((project) => [project.id, project.cwd]),
  );
  const projectTitleById = new Map<ProjectId, string>(
    projects.map((project) => [project.id, project.name]),
  );

  const activeThreadId = activeThread?.id;
  const routeThreadRef = routeTarget?.kind === "server" ? routeTarget.threadRef : null;
  const threadRuntimeLogPath = (() => {
    if (!import.meta.env.DEV || !routeThreadRef || !observability?.logsDirectoryPath) {
      return null;
    }
    const safeThreadSegment = toSafeThreadSegment(routeThreadRef.threadId);
    if (!safeThreadSegment) {
      return null;
    }
    return joinFileSystemPath(
      observability.logsDirectoryPath,
      "runtime",
      `${safeThreadSegment}.log`,
    );
  })();
  const serverTracePath = (() => {
    if (!import.meta.env.DEV || !observability?.logsDirectoryPath) {
      return null;
    }
    return joinFileSystemPath(observability.logsDirectoryPath, "server.trace.ndjson");
  })();
  const currentProjectId = activeThread?.projectId ?? activeDraftThread?.projectId ?? null;
  const currentProjectCwd = currentProjectId
    ? (projectCwdById.get(currentProjectId) ?? null)
    : null;

  function persistProjectSelection(project: Project) {
    writeStoredProjectSelection({
      environmentId: project.environmentId,
      projectId: project.id,
      cwd: project.cwd,
    });
  }

  async function openProjectFromSearch(project: (typeof projects)[number]) {
    persistProjectSelection(project);
    const latestThread = getLatestThreadForProject(
      threads,
      project.id,
      settings.sidebarThreadSortOrder,
    );
    if (latestThread) {
      await navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(scopeThreadRef(latestThread.environmentId, latestThread.id)),
      });
      return;
    }

    await handleNewThread(scopeProjectRef(project.environmentId, project.id), {
      envMode: settings.defaultThreadEnvMode,
    });
  }

  const projectSearchItems = buildProjectActionItems({
    projects,
    valuePrefix: "project",
    icon: projectCommandPaletteIcon,
    runProject: openProjectFromSearch,
  });
  const projectProjectItems: CommandPaletteActionItem[] = [...projects]
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
      icon: projectCommandPaletteIcon(project),
      run: async () => {
        await openProjectFromSearch(project);
      },
    }));

  const projectThreadItems = buildProjectActionItems({
    projects,
    valuePrefix: "new-thread-in",
    icon: projectCommandPaletteIcon,
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
  });

  const allThreadItems = buildThreadActionItems({
    threads,
    ...(activeThreadId ? { activeThreadId } : {}),
    projectTitleById,
    sortOrder: settings.sidebarThreadSortOrder,
    icon: <IconBubbleText className="size-4 text-muted-foreground/80" />,
    runThread: async (thread) => {
      const selectedThread =
        threads.find(
          (candidate) =>
            candidate.environmentId === thread.environmentId && candidate.id === thread.id,
        ) ?? null;
      const selectedProject = selectedThread?.projectId
        ? findWorkspaceProjectForSource(projects, selectedThread)
        : null;
      if (selectedProject) {
        persistProjectSelection(selectedProject);
      }
      await navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(scopeThreadRef(thread.environmentId, thread.id)),
      });
    },
  });
  const recentThreadItems = allThreadItems.slice(0, RECENT_THREAD_LIMIT);

  async function openPathInPreferredEditor(path: string, failureTitle: string) {
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
  }

  async function handleAddProject(rawCwd: string) {
    const environmentId = primaryEnvironmentId;
    if (!environmentId) return;

    const cwd = rawCwd.trim();
    if (cwd.length === 0) return;
    const api = readEnvironmentApi(environmentId);

    const existing = findProjectByPath(
      projects.filter((project) => project.environmentId === environmentId),
      cwd,
    );
    if (existing) {
      persistProjectSelection(existing);
      const latestThread = getLatestThreadForProject(
        threads,
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
    const projectRef = scopeProjectRef(environmentId, projectId);
    const title = inferProjectTitleFromPath(cwd);
    const createdAt = new Date().toISOString();
    if (api) {
      await api.orchestration.dispatchCommand({
        type: "project.create",
        commandId: newCommandId(),
        projectId,
        title,
        projectRoot: cwd,
        createProjectRootIfMissing: true,
        defaultModelSelection: settings.textGenerationModelSelection,
        createdAt,
      });
    } else {
      applyLocalProjectCreated({
        environmentId,
        projectId,
        title,
        projectRoot: cwd,
        defaultModelSelection: settings.textGenerationModelSelection,
        createdAt,
      });
    }
    writeStoredProjectSelection({ environmentId, projectId, cwd });
    if (api) {
      await waitForProjectInStore(projectRef);
    }
    await handleNewThread(projectRef, {
      envMode: settings.defaultThreadEnvMode,
    }).catch(() => undefined);
  }

  function openAddProjectFlow() {
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
          description: formatSchemaBackedTransportErrorDescription(error, "An error occurred."),
        });
      });
  }

  const projectGroups: CommandPaletteView["groups"] = (() => {
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
  })();

  function createInitialSessionState(): CommandPaletteSessionState {
    const viewStack =
      openIntent?.kind === "project"
        ? [
            {
              addonIcon: <IconFolder1 className="size-4" />,
              groups: projectGroups,
              placeholder: "Search projects...",
            },
          ]
        : [];

    return {
      sessionId: openSessionId,
      viewStack,
      query: "",
      highlightedItemValue: null,
    };
  }

  const [sessionState, setSessionState] =
    useState<CommandPaletteSessionState>(createInitialSessionState);
  const activeSessionState =
    sessionState.sessionId === openSessionId ? sessionState : createInitialSessionState();
  if (activeSessionState !== sessionState) {
    setSessionState(activeSessionState);
  }
  const { query, highlightedItemValue, viewStack } = activeSessionState;
  const deferredQuery = useDeferredValue(query);
  const isActionsOnly = deferredQuery.startsWith(">");
  const currentView = viewStack.at(-1) ?? null;
  const paletteMode = getCommandPaletteMode({ currentView });

  openAddProjectFlowRef.current = openAddProjectFlow;
  useMountEffect(() =>
    useCommandPaletteStore.getState().registerController({
      openAddProject: () => {
        openAddProjectFlowRef.current();
      },
    }),
  );

  function pushPaletteView(view: CommandPaletteView): void {
    setSessionState((previousState) => ({
      ...previousState,
      viewStack: [
        ...previousState.viewStack,
        {
          addonIcon: view.addonIcon,
          groups: view.groups,
          ...(view.initialQuery ? { initialQuery: view.initialQuery } : {}),
          ...(view.placeholder ? { placeholder: view.placeholder } : {}),
        },
      ],
      highlightedItemValue: null,
      query: view.initialQuery ?? "",
    }));
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
    setSessionState((previousState) => ({
      ...previousState,
      viewStack: previousState.viewStack.slice(0, -1),
      highlightedItemValue: null,
      query: "",
    }));
  }

  function handleQueryChange(nextQuery: string): void {
    setSessionState((previousState) => {
      const previousView = previousState.viewStack.at(-1) ?? null;
      if (nextQuery === "" && previousView?.initialQuery) {
        return {
          ...previousState,
          viewStack: previousState.viewStack.slice(0, -1),
          highlightedItemValue: null,
          query: "",
        };
      }
      return {
        ...previousState,
        highlightedItemValue: null,
        query: nextQuery,
      };
    });
  }

  if (!open) {
    return null;
  }

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

  if (threadRuntimeLogPath) {
    actionItems.push({
      kind: "action",
      value: `action:debug:copy-thread-runtime-log:${routeThreadRef?.threadId ?? "current"}`,
      searchTerms: [
        "copy runtime log path",
        "copy thread log path",
        "debug",
        "logs",
        routeThreadRef?.threadId ?? "",
      ],
      title: "Copy thread runtime log path",
      description: "Current thread runtime event log",
      icon: <IconClipboard className="size-4 text-muted-foreground/80" />,
      run: async () => {
        await copyPathToClipboard(threadRuntimeLogPath, "Copied thread runtime log path");
      },
    });
    actionItems.push({
      kind: "action",
      value: `action:debug:open-thread-runtime-log:${routeThreadRef?.threadId ?? "current"}`,
      searchTerms: [
        "open runtime log",
        "open thread log",
        "debug",
        "logs",
        routeThreadRef?.threadId ?? "",
      ],
      title: "Open thread runtime log",
      description: "Open current thread runtime event log in your editor",
      icon: <IconCode className="size-4 text-muted-foreground/80" />,
      run: async () => {
        try {
          await openPathInPreferredEditor(
            threadRuntimeLogPath,
            "Unable to open thread runtime log",
          );
        } catch (error) {
          toastManager.add({
            type: "error",
            title: "Unable to open thread runtime log",
            description: formatSchemaBackedTransportErrorDescription(error, "An error occurred."),
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

  if (import.meta.env.DEV) {
    actionItems.push({
      kind: "action",
      value: "action:dev:tomeito",
      searchTerms: [
        "tomeito",
        "design system",
        "components",
        "component gallery",
        "ui",
        "primitives",
        "@multi/ui",
        "dialkit",
        "dev",
      ],
      title: "Open Tomeito",
      description: "Browse the Tomeito design system with DialKit (dev)",
      icon: <IconBubbleText className="size-4 text-muted-foreground/80" />,
      run: async () => {
        await navigate({ to: "/dev/tomeito" });
      },
    });

    actionItems.push({
      kind: "action",
      value: "action:dev:branching-ui-prototypes",
      searchTerms: [
        "branching",
        "branching ui",
        "branching prototypes",
        "ui prototypes",
        "design",
        "dev",
      ],
      title: "Open branching UI prototypes",
      description: "Compare branching UI prototypes (dev)",
      icon: <IconBubbleText className="size-4 text-muted-foreground/80" />,
      run: async () => {
        await navigate({ to: "/dev/branching-ui-prototypes" });
      },
    });

    actionItems.push({
      kind: "action",
      value: "action:dev:archive-ui-example",
      searchTerms: [
        "archive",
        "archived",
        "archive ui",
        "ui examples",
        "design",
        "sidebar archive",
      ],
      title: "Open archive UI examples",
      description: "Compare archived-thread layouts (dev)",
      icon: <IconBubbleText className="size-4 text-muted-foreground/80" />,
      run: async () => {
        await navigate({ to: "/dev/archive-ui-example" });
      },
    });

    actionItems.push({
      kind: "action",
      value: "action:dev:queued-message-demo",
      searchTerms: [
        "queue",
        "queued message",
        "queued follow up",
        "follow up",
        "composer",
        "chat",
        "dev",
      ],
      title: "Open queued message demo",
      description: "Exercise queued follow-up panel states (dev)",
      icon: <IconBubbleText className="size-4 text-muted-foreground/80" />,
      run: async () => {
        await navigate({ to: "/dev/queued-message-demo" });
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
        description: formatSchemaBackedTransportErrorDescription(
          error,
          "An unexpected error occurred.",
        ),
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
          setSessionState((previousState) => ({
            ...previousState,
            highlightedItemValue: typeof value === "string" ? value : null,
          }));
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
                      <IconChevronLeftMedium />
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
                <IconChevronRightMedium className="-rotate-90" />
              </Kbd>
              <Kbd>
                <IconChevronRightMedium className="rotate-90" />
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
