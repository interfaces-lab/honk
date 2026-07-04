"use client";

import { scopeProjectRef, scopeThreadRef } from "~/lib/environment-scope";
import { DEFAULT_PROJECTLESS_CWD } from "@honk/shared/project";
import type { ResolvedKeybindingsConfig } from "@honk/shared/keybindings";
import { normalizePathSeparators } from "@honk/shared/paths";
import { useNavigate, useRouter } from "@tanstack/react-router";
import {
  IconCode,
  IconAgentNetwork,
  IconChevronLeftMedium,
  IconChevronRightMedium,
  IconAgent,
  IconBug,
  IconBubbleQuestion,
  IconClipboard,
  IconFolder1,
  IconFolderAddRight,
  IconFolderOpen,
  IconKeyboard,
  IconProjects,
  IconSettingsGear2,
  IconSettingsSliderHor,
  IconThread,
  IconTodos,
} from "central-icons";
import { useDeferredValue, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";
import { useCommandPaletteStore } from "../stores/ui/command-palette-store";
import { usePrimaryEnvironmentId } from "../environments/primary";
import { useNewThreadHandler } from "../hooks/use-handle-new-thread";
import { useSelectedWorkspaceProject } from "../lib/selected-workspace-project";
import { useMountEffect } from "../hooks/use-mount-effect";
import { useSettings } from "../hooks/use-settings";
import { readLocalApi } from "../local-api";
import {
  readThreadActionContext,
  startNewThreadInProjectFromContext,
  startNewThreadFromContext,
} from "../lib/chat-thread-actions";
import { isTerminalFocused } from "../lib/terminal-focus";
import { openWorkspaceFolder, persistProjectSelection } from "../lib/project-selection";
import {
  findWorkspaceProjectByRef,
  findWorkspaceProjectForSource,
  getLatestWorkspaceThreadForProject,
  resolveWorkspaceTarget,
} from "../lib/workspace-target";
import {
  selectProjectsAcrossEnvironments,
  selectSidebarThreadsAcrossEnvironments,
  useStore,
} from "../stores/thread-store";
import { selectThreadWorkspaceSurfaceByRef } from "../stores/thread-selectors";
import { useComposerDraftStore } from "../stores/chat-drafts";
import { useLocalFeatureFlagsStore } from "../stores/local-feature-flags";
import { workbenchTabPersistenceActions } from "../stores/workbench-tab-store";
import { openThread } from "~/app/chat-navigation";
import { useChatRouteTarget } from "~/app/chat-route-state";
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
  useServerConfig,
  useServerKeybindings,
  useServerKeybindingsConfigPath,
  useServerObservability,
} from "../rpc/server-state";
import {
  COMMAND_PALETTE_FALLBACK_KEYBINDINGS,
  keybindingCommandForInteractionMode,
  resolveShortcutCommand,
  shortcutLabelForCommand,
} from "../keybindings";
import { setFocusedComposerInteractionMode } from "./chat/composer/interaction-mode-target";
import {
  Command,
  CommandCollection,
  CommandDialog,
  CommandDialogPopup,
  CommandGroup,
  CommandGroupLabel,
  CommandInput,
  CommandItem,
  CommandList,
  CommandPanel,
  CommandShortcut,
  CommandShortcutKey,
} from "@honk/honkkit/command";
import { Button } from "@honk/honkkit/button";
import { toastManager } from "~/app/toast";
import {
  ComposerHandleContext,
  useComposerHandleContext,
} from "./chat/composer/context/handle-context";
import { resolveAndPersistPreferredEditor } from "../editor-preferences";
import type { ComposerInputHandle } from "./chat/composer/input";
import { resolveProjectlessCwd } from "~/lib/project-state";
import {
  DEFAULT_SETTINGS_ROUTE,
  DEFAULT_SETTINGS_SEARCH,
} from "~/components/settings/settings-sections";

function joinFileSystemPath(basePath: string, ...segments: string[]): string {
  const separator = basePath.includes("\\") && !basePath.includes("/") ? "\\" : "/";
  const normalizedBase = normalizePathSeparators(basePath, separator).replace(/[\\/]+$/g, "");
  const normalizedSegments = segments.map((segment) =>
    normalizePathSeparators(segment, separator).replace(/^[\\/]+|[\\/]+$/g, ""),
  );
  return [normalizedBase, ...normalizedSegments].join(separator);
}

interface CommandPaletteResultsProps {
  readonly groups: ReadonlyArray<CommandPaletteGroup>;
  readonly isActionsOnly: boolean;
  readonly keybindings: ResolvedKeybindingsConfig;
  readonly onExecuteItem: (item: CommandPaletteActionItem | CommandPaletteSubmenuItem) => void;
}

interface CommandPaletteSessionState {
  readonly sessionId: number;
  readonly viewStack: CommandPaletteView[];
  readonly query: string;
}

const MAC_SHORTCUT_MODIFIER_SYMBOLS = new Set(["⌃", "⌥", "⇧", "⌘"]);

interface ShortcutLabelPart {
  readonly id: string;
  readonly label: string;
}

function shortcutLabelParts(label: string): ShortcutLabelPart[] {
  if (label.includes("+")) {
    let offset = 0;
    return label
      .split("+")
      .filter((part) => part.length > 0)
      .map((part) => {
        offset = label.indexOf(part, offset);
        const id = `${offset}:${part}`;
        offset += part.length;
        return { id, label: part };
      });
  }

  const parts: ShortcutLabelPart[] = [];
  let consumedLabel = "";
  let keyPart = "";
  for (const character of Array.from(label)) {
    if (MAC_SHORTCUT_MODIFIER_SYMBOLS.has(character)) {
      if (keyPart.length > 0) {
        consumedLabel += keyPart;
        parts.push({ id: consumedLabel, label: keyPart });
        keyPart = "";
      }
      consumedLabel += character;
      parts.push({ id: consumedLabel, label: character });
    } else {
      keyPart += character;
    }
  }
  if (keyPart.length > 0) {
    consumedLabel += keyPart;
    parts.push({ id: consumedLabel, label: keyPart });
  }

  return parts.length > 0 ? parts : [{ id: label, label }];
}

function CommandPaletteResults(props: CommandPaletteResultsProps) {
  if (props.groups.length === 0) {
    return (
      <div className="py-12 text-center font-honk text-sm font-normal text-muted-foreground">
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
  readonly keybindings: ResolvedKeybindingsConfig;
  readonly onExecuteItem: (item: CommandPaletteActionItem | CommandPaletteSubmenuItem) => void;
}) {
  const shortcutLabel = props.item.shortcutCommand
    ? shortcutLabelForCommand(props.keybindings, props.item.shortcutCommand)
    : null;

  return (
    <CommandItem
      value={props.item.value}
      className="cursor-pointer"
      onMouseDown={(event) => {
        event.preventDefault();
      }}
      onClick={() => {
        props.onExecuteItem(props.item);
      }}
    >
      {props.item.description ? (
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-normal text-honk-fg-primary">
            {props.item.title}
          </span>
          <span className="truncate text-xs font-normal text-honk-fg-tertiary">
            {props.item.description}
          </span>
        </span>
      ) : (
        <span className="flex min-w-0 items-center gap-1.5 truncate text-sm font-normal text-honk-fg-primary">
          <span className="truncate">{props.item.title}</span>
        </span>
      )}
      {props.item.timestamp ? (
        <span className="min-w-12 shrink-0 text-right text-xs font-normal tabular-nums text-honk-fg-tertiary">
          {props.item.timestamp}
        </span>
      ) : null}
      {shortcutLabel ? (
        <CommandShortcut aria-label={shortcutLabel}>
          {shortcutLabelParts(shortcutLabel).map((part) => (
            <CommandShortcutKey key={part.id}>{part.label}</CommandShortcutKey>
          ))}
        </CommandShortcut>
      ) : null}
      {props.item.kind === "submenu" ? (
        <IconChevronRightMedium className="ml-auto size-4.5 shrink-0 text-honk-icon-tertiary" />
      ) : null}
    </CommandItem>
  );
}

export function CommandPalette({ children }: { children: ReactNode }) {
  const router = useRouter();
  const routeTarget = useChatRouteTarget();
  const open = useCommandPaletteStore((store) => store.open);
  const setOpen = useCommandPaletteStore((store) => store.setOpen);
  const toggleOpen = useCommandPaletteStore((store) => store.toggleOpen);
  const keybindings = useServerKeybindings();
  const composerHandleRef = useRef<ComposerInputHandle | null>(null);
  const keybindingsRef = useRef(keybindings);
  const routerRef = useRef(router);
  const toggleOpenRef = useRef(toggleOpen);
  const activeKeybindings =
    keybindings.length > 0 ? keybindings : COMMAND_PALETTE_FALLBACK_KEYBINDINGS;
  keybindingsRef.current = activeKeybindings;
  routerRef.current = router;
  toggleOpenRef.current = toggleOpen;

  useMountEffect(() => {
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const command = resolveShortcutCommand(event, keybindingsRef.current, {
        context: {
          terminalFocus: isTerminalFocused(),
          terminalOpen: false,
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
  const open = useCommandPaletteStore((store) => store.open);
  const setOpen = useCommandPaletteStore((store) => store.setOpen);

  useMountEffect(() => () => setOpen(false));

  return open ? <OpenCommandPaletteDialog /> : null;
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
      className="size-4 text-honk-icon-tertiary"
    />
  );
}

function OpenCommandPaletteDialog() {
  const navigate = useNavigate();
  const router = useRouter();
  const openSessionId = useCommandPaletteStore((store) => store.openSessionId);
  const setOpen = useCommandPaletteStore((store) => store.setOpen);
  const openIntent = useCommandPaletteStore((store) => store.openIntent);
  const composerHandleRef = useComposerHandleContext();
  const openAddProjectFlowRef = useRef<() => void>(() => undefined);
  const settings = useSettings();
  const routeTarget = useChatRouteTarget();
  const {
    logicalProjectKey: selectedLogicalProjectKey,
    projectCwd: selectedProjectCwd,
    projectEnvironmentId: selectedProjectEnvironmentId,
    projectRef: selectedProjectRef,
  } = useSelectedWorkspaceProject();
  const { handleNewThread } = useNewThreadHandler();
  const activeThread = useStore(
    useShallow((store) =>
      routeTarget?.kind === "server"
        ? selectThreadWorkspaceSurfaceByRef(store, routeTarget.threadRef)
        : undefined,
    ),
  );
  const activeDraftThread = useComposerDraftStore((store) => {
    if (!routeTarget) {
      return null;
    }
    return routeTarget.kind === "server"
      ? store.getDraftThread(routeTarget.threadRef)
      : store.getDraftSession(routeTarget.draftId);
  });
  const projects = useStore(useShallow(selectProjectsAcrossEnvironments));
  const threads = useStore(useShallow(selectSidebarThreadsAcrossEnvironments));
  const keybindings = useServerKeybindings();
  const keybindingsConfigPath = useServerKeybindingsConfigPath();
  const availableEditors = useServerAvailableEditors();
  const serverConfig = useServerConfig();
  const observability = useServerObservability();
  const multitaskModeEnabled = useLocalFeatureFlagsStore((state) => state.multitaskModeEnabled);
  const toggleMultitaskModeEnabled = useLocalFeatureFlagsStore(
    (state) => state.toggleMultitaskModeEnabled,
  );
  const primaryEnvironmentId = usePrimaryEnvironmentId();
  const storeActiveEnvironmentId = useStore((state) => state.activeEnvironmentId);

  const activeThreadId = activeThread?.id;
  const serverTracePath = (() => {
    if (!import.meta.env.DEV || !observability?.logsDirectoryPath) {
      return null;
    }
    return joinFileSystemPath(observability.logsDirectoryPath, "server.trace.ndjson");
  })();
  const currentWorkspaceProject = activeThread
    ? findWorkspaceProjectForSource(projects, activeThread)
    : activeDraftThread
      ? findWorkspaceProjectForSource(projects, activeDraftThread)
      : null;
  const currentProjectCwd = currentWorkspaceProject?.cwd ?? null;
  const selectedProject = selectedProjectRef
    ? findWorkspaceProjectByRef(projects, selectedProjectRef)
    : null;
  const workspaceTarget = resolveWorkspaceTarget({
    source: activeThread ?? activeDraftThread ?? null,
    defaultProject: selectedProject,
    defaultProjectCwd: selectedProjectCwd,
    defaultProjectEnvironmentId: selectedProjectEnvironmentId,
    defaultProjectRef: selectedProjectRef,
    projects,
    projectlessCwd: resolveProjectlessCwd(serverConfig?.cwd),
    fallbackEnvironmentId: storeActiveEnvironmentId ?? primaryEnvironmentId,
  });

  async function openProjectFromSearch(project: (typeof projects)[number]) {
    persistProjectSelection(project);
    const latestThread = getLatestWorkspaceThreadForProject({
      project,
      projects,
      threads,
      sortOrder: settings.sidebarThreadSortOrder,
    });
    if (latestThread) {
      await openThread(router, scopeThreadRef(latestThread.environmentId, latestThread.id));
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
        readThreadActionContext({
          selectedLogicalProjectKey,
          selectedProjectRef,
          threadEnvMode: settings.defaultThreadEnvMode,
          handleNewThread,
          projects,
          routeTarget,
        }),
        scopeProjectRef(project.environmentId, project.id),
      );
    },
  });

  const allThreadItems = buildThreadActionItems({
    threads,
    ...(activeThreadId ? { activeThreadId } : {}),
    projectTitleForThread: (thread) => findWorkspaceProjectForSource(projects, thread)?.name,
    sortOrder: settings.sidebarThreadSortOrder,
    icon: <IconThread className="size-4 text-honk-icon-tertiary" />,
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
      await openThread(router, scopeThreadRef(thread.environmentId, thread.id));
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

    const selection = await openWorkspaceFolder({
      environmentId,
      projects,
      rawCwd,
      defaultModelSelection: settings.textGenerationModelSelection,
    });
    if (!selection) return;

    if (!selection.created && selection.project) {
      const latestThread = getLatestWorkspaceThreadForProject({
        project: selection.project,
        projects,
        threads,
        sortOrder: settings.sidebarThreadSortOrder,
      });
      if (latestThread) {
        await openThread(router, scopeThreadRef(latestThread.environmentId, latestThread.id));
      } else {
        await handleNewThread(selection.projectRef, {
          envMode: settings.defaultThreadEnvMode,
          logicalProjectKey: selection.logicalProjectKey,
        }).catch(() => undefined);
      }
      return;
    }

    await handleNewThread(selection.projectRef, {
      envMode: settings.defaultThreadEnvMode,
      logicalProjectKey: selection.logicalProjectKey,
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
      .pickFolder({
        initialPath: baseDirectory.length > 0 ? baseDirectory : DEFAULT_PROJECTLESS_CWD,
      })
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
          icon: <IconFolderAddRight className="size-4 text-honk-icon-tertiary" />,
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
    };
  }

  const [sessionState, setSessionState] =
    useState<CommandPaletteSessionState>(createInitialSessionState);
  const activeSessionState =
    sessionState.sessionId === openSessionId ? sessionState : createInitialSessionState();
  if (activeSessionState !== sessionState) {
    setSessionState(activeSessionState);
  }
  const { query, viewStack } = activeSessionState;
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
          query: "",
        };
      }
      return {
        ...previousState,
        query: nextQuery,
      };
    });
  }

  const actionItems: Array<CommandPaletteActionItem | CommandPaletteSubmenuItem> = [];

  if (projects.length > 0) {
    const activeProjectTitle = currentWorkspaceProject?.name ?? null;

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
        icon: <IconAgent className="size-4 text-honk-icon-tertiary" />,
        shortcutCommand: "chat.new",
        run: async () => {
          await startNewThreadFromContext(
            readThreadActionContext({
              selectedLogicalProjectKey,
              selectedProjectRef,
              threadEnvMode: settings.defaultThreadEnvMode,
              handleNewThread,
              projects,
              routeTarget,
            }),
          );
        },
      });
    }

    actionItems.push({
      kind: "submenu",
      value: "action:new-thread-in",
      searchTerms: ["new thread", "project", "pick", "choose", "select"],
      title: "New thread in...",
      icon: <IconProjects className="size-4 text-honk-icon-tertiary" />,
      addonIcon: <IconProjects className="size-4" />,
      groups: [{ value: "projects", label: "Projects", items: projectThreadItems }],
    });
  }

  actionItems.push({
    kind: "action",
    value: "action:add-project",
    searchTerms: ["add project", "folder", "directory"],
    title: "Add project",
    icon: <IconFolderAddRight className="size-4 text-honk-icon-tertiary" />,
    keepOpen: true,
    run: async () => {
      openAddProjectFlow();
    },
  });

  actionItems.push(
    {
      kind: "action",
      value: "action:composer-mode-agent",
      searchTerms: ["agent mode", "build mode", "composer mode"],
      title: "Agent Mode",
      description: "Plan, search, edit, and run commands",
      icon: <IconAgent className="size-4 text-honk-icon-tertiary" />,
      shortcutCommand: keybindingCommandForInteractionMode("agent"),
      run: async () => {
        setFocusedComposerInteractionMode("agent", { focusMode: "preserve" });
      },
    },
    {
      kind: "action",
      value: "action:composer-mode-ask",
      searchTerms: ["ask mode", "chat mode", "read only", "composer mode"],
      title: "Ask Mode",
      description: "Ask questions without making changes",
      icon: <IconBubbleQuestion className="size-4 text-honk-icon-tertiary" />,
      shortcutCommand: keybindingCommandForInteractionMode("ask"),
      run: async () => {
        setFocusedComposerInteractionMode("ask", { focusMode: "preserve" });
      },
    },
    {
      kind: "action",
      value: "action:composer-mode-plan",
      searchTerms: ["plan mode", "planning", "composer mode"],
      title: "Plan Mode",
      description: "Create a proposed implementation plan",
      icon: <IconTodos className="size-4 text-honk-icon-tertiary" />,
      shortcutCommand: keybindingCommandForInteractionMode("plan"),
      run: async () => {
        setFocusedComposerInteractionMode("plan", { focusMode: "preserve" });
      },
    },
    {
      kind: "action",
      value: "action:composer-mode-debug",
      searchTerms: ["debug mode", "bug", "diagnostics", "composer mode"],
      title: "Debug Mode",
      description: "Gather diagnostics and runtime traces",
      icon: <IconBug className="size-4 text-honk-icon-tertiary" />,
      shortcutCommand: keybindingCommandForInteractionMode("debug"),
      run: async () => {
        setFocusedComposerInteractionMode("debug", { focusMode: "preserve" });
      },
    },
  );

  if (multitaskModeEnabled) {
    actionItems.push({
      kind: "action",
      value: "action:composer-mode-multitask",
      searchTerms: ["multitask mode", "background subagents", "composer mode"],
      title: "Multitask Mode",
      description: "Coordinate background subagents",
      icon: <IconAgentNetwork className="size-4 text-honk-icon-tertiary" />,
      shortcutCommand: keybindingCommandForInteractionMode("multitask"),
      run: async () => {
        setFocusedComposerInteractionMode("multitask", { focusMode: "preserve" });
      },
    });
  }

  if (currentProjectCwd) {
    actionItems.push({
      kind: "action",
      value: "action:open-workspace-in-editor",
      searchTerms: ["open workspace in editor", "open project in editor", "editor", "code"],
      title: "Open workspace in editor",
      description: currentProjectCwd,
      icon: <IconFolderOpen className="size-4 text-honk-icon-tertiary" />,
      run: async () => {
        await openPathInPreferredEditor(currentProjectCwd, "Unable to open workspace");
      },
    });

    actionItems.push({
      kind: "action",
      value: "action:copy-workspace-path",
      searchTerms: ["copy workspace path", "copy project path", "path", "clipboard"],
      title: "Copy workspace path",
      description: currentProjectCwd,
      icon: <IconClipboard className="size-4 text-honk-icon-tertiary" />,
      run: async () => {
        await copyPathToClipboard(currentProjectCwd, "Copied workspace path");
      },
    });
  }

  actionItems.push({
    kind: "action",
    value: "action:settings",
    searchTerms: ["settings", "preferences", "configuration", "keybindings"],
    title: "Open settings",
    icon: <IconSettingsGear2 className="size-4 text-honk-icon-tertiary" />,
    run: async () => {
      await navigate({ to: DEFAULT_SETTINGS_ROUTE, search: DEFAULT_SETTINGS_SEARCH });
    },
  });

  actionItems.push({
    kind: "action",
    value: "action:open-dev-panel",
    searchTerms: [
      "open dev panel",
      "developer panel",
      "debug panel",
      "runtime panel",
      "context usage",
      "pi runtime",
      "session tree",
      "timeline",
    ],
    title: "Open Dev Panel",
    description: "Inspect the active thread runtime, context, timeline, and tree",
    icon: <IconCode className="size-4 text-honk-icon-tertiary" />,
    run: async () => {
      workbenchTabPersistenceActions.activateDev(workspaceTarget.workspaceKey);
    },
  });

  actionItems.push({
    kind: "action",
    value: "action:toggle-multitask-mode-feature",
    searchTerms: [
      "toggle multitask mode",
      "multitask feature flag",
      "background subagents",
      "dev feature flag",
    ],
    title: multitaskModeEnabled ? "Disable Multitask Mode" : "Enable Multitask Mode",
    description: "Local dev feature flag for background subagent coordination",
    icon: <IconAgentNetwork className="size-4 text-honk-icon-tertiary" />,
    run: async () => {
      const enabled = toggleMultitaskModeEnabled();
      toastManager.add({
        type: "info",
        title: enabled ? "Multitask Mode enabled" : "Multitask Mode disabled",
        description: enabled
          ? "The composer can now enter Multitask mode."
          : "Multitask mode is hidden and sends as Agent mode.",
      });
    },
  });

  actionItems.push({
    kind: "action",
    value: "action:keybindings",
    searchTerms: ["keyboard shortcuts", "keybindings", "shortcuts", "hotkeys"],
    title: "Open keyboard shortcuts",
    description: keybindingsConfigPath ?? "Keybindings file path unavailable",
    icon: <IconKeyboard className="size-4 text-honk-icon-tertiary" />,
    run: async () => {
      if (!keybindingsConfigPath) {
        toastManager.add({
          type: "error",
          title: "Unable to open keyboard shortcuts",
          description: "The keybindings file path is unavailable.",
        });
        return;
      }
      await openPathInPreferredEditor(keybindingsConfigPath, "Unable to open keybindings file");
    },
  });

  if (serverTracePath) {
    actionItems.push({
      kind: "action",
      value: "action:debug:copy-server-trace",
      searchTerms: ["copy server trace path", "copy trace path", "debug", "trace", "logs"],
      title: "Copy server trace path",
      description: "Local server trace NDJSON file",
      icon: <IconBug className="size-4 text-honk-icon-tertiary" />,
      run: async () => {
        await copyPathToClipboard(serverTracePath, "Copied server trace path");
      },
    });
  }

  if (import.meta.env.DEV) {
    actionItems.push({
      kind: "action",
      value: "action:dev:component-system",
      searchTerms: [
        "component system",
        "design tokens",
        "token staircase",
        "dialog geometry",
        "radius",
        "padding",
        "margin",
        "dialkit",
        "dev",
      ],
      title: "Open Component System",
      description: "Inspect real HonkKit components against token geometry (dev)",
      icon: <IconSettingsSliderHor className="size-4 text-honk-icon-tertiary" />,
      run: async () => {
        await navigate({ to: "/dev/honkkit", search: () => ({ component: "component-system" }) });
      },
    });

    actionItems.push({
      kind: "action",
      value: "action:dev:honkkit",
      searchTerms: [
        "honkkit",
        "design system",
        "components",
        "component gallery",
        "ui",
        "primitives",
        "@honk/honkkit",
        "dialkit",
        "dev",
      ],
      title: "Open HonkKit",
      description: "Browse the HonkKit design system with DialKit (dev)",
      icon: <IconSettingsSliderHor className="size-4 text-honk-icon-tertiary" />,
      run: async () => {
        await navigate({ to: "/dev/honkkit", search: () => ({}) });
      },
    });
  }

  const rootGroups = buildRootGroups({
    projectItems: projectProjectItems,
    actionItems,
    recentThreadItems,
  });
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
      className="overflow-hidden p-0 transition-none! duration-0!"
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
                    <Button
                      type="button"
                      size="icon-xs"
                      variant="ghost"
                      className="shrink-0"
                      aria-label="Back"
                      onClick={popView}
                    >
                      <IconChevronLeftMedium />
                    </Button>
                  ),
                }
              : {})}
            onKeyDown={handleKeyDown}
          />
        </div>
        <CommandPanel>
          <CommandPaletteResults
            groups={displayedGroups}
            isActionsOnly={isActionsOnly}
            keybindings={keybindings}
            onExecuteItem={executeItem}
          />
        </CommandPanel>
      </Command>
    </CommandDialogPopup>
  );
}
