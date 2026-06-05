import { Outlet } from "@tanstack/react-router";
import { useEffect } from "react";
import { useShallow } from "zustand/react/shallow";

import { useCommandPaletteStore } from "~/stores/ui/command-palette-store";
import { useHandleNewThread } from "~/hooks/use-handle-new-thread";
import { ShellHost } from "~/components/shell-host";
import {
  startNewLocalThreadFromContext,
  startNewThreadFromContext,
} from "~/lib/chat-thread-actions";
import { isTerminalFocused } from "~/lib/terminal-focus";
import { resolveShortcutCommand } from "~/keybindings";
import { selectThreadTerminalState, useTerminalStateStore } from "~/terminal-state-store";
import { useThreadSelectionStore } from "~/stores/thread-selection-store";
import { useSettings } from "~/hooks/use-settings";
import { useServerKeybindings } from "~/rpc/server-state";
import { selectProjectsAcrossEnvironments, useStore } from "~/stores/thread-store";

function ChatRouteGlobalShortcuts() {
  const clearSelection = useThreadSelectionStore((state) => state.clearSelection);
  const selectedThreadKeysSize = useThreadSelectionStore((state) => state.selectedThreadKeys.size);
  const {
    activeDraftThread,
    activeThread,
    defaultLogicalProjectKey,
    defaultProjectRef,
    handleNewThread,
    routeThreadRef,
  } = useHandleNewThread();
  const keybindings = useServerKeybindings();
  const terminalOpen = useTerminalStateStore((state) =>
    routeThreadRef
      ? selectThreadTerminalState(state.terminalStateByThreadKey, routeThreadRef).terminalOpen
      : false,
  );
  const projects = useStore(useShallow(selectProjectsAcrossEnvironments));
  const defaultThreadEnvMode = useSettings((settings) => settings.defaultThreadEnvMode);

  useEffect(() => {
    const onWindowKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const command = resolveShortcutCommand(event, keybindings, {
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
        clearSelection();
        return;
      }

      if (command === "chat.newLocal") {
        event.preventDefault();
        event.stopPropagation();
        void startNewLocalThreadFromContext({
          activeDraftThread,
          activeThread,
          defaultLogicalProjectKey,
          defaultProjectRef,
          defaultThreadEnvMode,
          handleNewThread,
          projects,
        });
        return;
      }

      if (command === "chat.new") {
        event.preventDefault();
        event.stopPropagation();
        void startNewThreadFromContext({
          activeDraftThread,
          activeThread,
          defaultLogicalProjectKey,
          defaultProjectRef,
          defaultThreadEnvMode,
          handleNewThread,
          projects,
        });
      }
    };

    window.addEventListener("keydown", onWindowKeyDown);
    return () => {
      window.removeEventListener("keydown", onWindowKeyDown);
    };
  }, [
    activeDraftThread,
    activeThread,
    clearSelection,
    defaultLogicalProjectKey,
    defaultProjectRef,
    defaultThreadEnvMode,
    handleNewThread,
    keybindings,
    projects,
    selectedThreadKeysSize,
    terminalOpen,
  ]);

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
