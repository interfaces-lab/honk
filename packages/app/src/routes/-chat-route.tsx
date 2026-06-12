import { Outlet, useRouter } from "@tanstack/react-router";
import type { ScopedProjectRef } from "@honk/contracts";
import { useEffect, useRef } from "react";

import { useCommandPaletteStore } from "~/stores/ui/command-palette-store";
import {
  openNewThreadWithRouter,
  type NewThreadActionOptions,
} from "~/hooks/use-handle-new-thread";
import { readSelectedWorkspaceProject } from "~/lib/selected-workspace-project";
import { ShellHost } from "~/components/shell-host";
import {
  readThreadActionContext,
  startNewLocalThreadFromContext,
  startNewThreadFromContext,
} from "~/lib/chat-thread-actions";
import { isTerminalFocused } from "~/lib/terminal-focus";
import { resolveShortcutCommand } from "~/keybindings";
import { selectThreadTerminalState, useTerminalStateStore } from "~/terminal-state-store";
import { useThreadSelectionStore } from "~/stores/thread-selection-store";
import { readSettings } from "~/hooks/use-settings";
import { useServerKeybindings } from "~/rpc/server-state";
import { selectProjectsAcrossEnvironments, useStore } from "~/stores/thread-store";
import { useRouteTarget } from "~/routes/-thread-route-targets";

function ChatRouteGlobalShortcuts() {
  const router = useRouter();
  const routeTarget = useRouteTarget();
  const keybindings = useServerKeybindings();
  const routerRef = useRef(router);
  const routeTargetRef = useRef(routeTarget);
  const shortcutValuesRef = useRef({
    keybindings,
  });
  routerRef.current = router;
  routeTargetRef.current = routeTarget;
  shortcutValuesRef.current = {
    keybindings,
  };
  const handleNewThread = (
    projectRef: ScopedProjectRef,
    options?: NewThreadActionOptions,
  ): Promise<void> => openNewThreadWithRouter(routerRef.current, projectRef, options);

  useEffect(() => {
    const onWindowKeyDown = (event: KeyboardEvent) => {
      const values = shortcutValuesRef.current;
      if (event.defaultPrevented) return;
      const routeTarget = routeTargetRef.current;
      const terminalOpen =
        routeTarget?.kind === "server"
          ? selectThreadTerminalState(
              useTerminalStateStore.getState().terminalStateByThreadKey,
              routeTarget.threadRef,
            ).terminalOpen
          : false;
      const threadSelection = useThreadSelectionStore.getState();
      const selectedThreadKeysSize = threadSelection.selectedThreadKeys.size;
      const command = resolveShortcutCommand(event, values.keybindings, {
        context: {
          terminalFocus: isTerminalFocused(),
          terminalOpen,
          threadSelectionActive: selectedThreadKeysSize > 0,
        },
      });

      if (useCommandPaletteStore.getState().open) {
        return;
      }

      if (command === "threadSelection.clear" && selectedThreadKeysSize > 0) {
        event.preventDefault();
        threadSelection.clearSelection();
        return;
      }

      if (command === "chat.newLocal") {
        event.preventDefault();
        event.stopPropagation();
        const selectedProject = readSelectedWorkspaceProject();
        const settings = readSettings();
        const projects = selectProjectsAcrossEnvironments(useStore.getState());
        void startNewLocalThreadFromContext(
          readThreadActionContext({
            selectedLogicalProjectKey: selectedProject.logicalProjectKey,
            selectedProjectRef: selectedProject.projectRef,
            threadEnvMode: settings.defaultThreadEnvMode,
            handleNewThread,
            projects,
            routeTarget,
          }),
        );
        return;
      }

      if (command === "chat.new") {
        event.preventDefault();
        event.stopPropagation();
        const selectedProject = readSelectedWorkspaceProject();
        const settings = readSettings();
        const projects = selectProjectsAcrossEnvironments(useStore.getState());
        void startNewThreadFromContext(
          readThreadActionContext({
            selectedLogicalProjectKey: selectedProject.logicalProjectKey,
            selectedProjectRef: selectedProject.projectRef,
            threadEnvMode: settings.defaultThreadEnvMode,
            handleNewThread,
            projects,
            routeTarget,
          }),
        );
      }
    };

    window.addEventListener("keydown", onWindowKeyDown);
    return () => {
      window.removeEventListener("keydown", onWindowKeyDown);
    };
  }, []);

  return null;
}

export function ChatRouteLayout() {
  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden">
      <ShellHost mode="chat">
        <ChatRouteGlobalShortcuts />
        <Outlet />
      </ShellHost>
    </div>
  );
}
