import { Outlet } from "@tanstack/react-router";
import { useEffectEvent } from "react";

import { useCommandPaletteStore } from "~/stores/ui/command-palette-store";
import { useHandleNewThread } from "~/hooks/use-handle-new-thread";
import { useMountEffect } from "~/hooks/use-mount-effect";
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

function ChatRouteGlobalShortcuts() {
  const clearSelection = useThreadSelectionStore((state) => state.clearSelection);
  const selectedThreadKeysSize = useThreadSelectionStore((state) => state.selectedThreadKeys.size);
  const { activeDraftThread, activeThread, defaultProjectRef, handleNewThread, routeThreadRef } =
    useHandleNewThread();
  const keybindings = useServerKeybindings();
  const terminalOpen = useTerminalStateStore((state) =>
    routeThreadRef
      ? selectThreadTerminalState(state.terminalStateByThreadKey, routeThreadRef).terminalOpen
      : false,
  );
  const defaultThreadEnvMode = useSettings((settings) => settings.defaultThreadEnvMode);

  const handleWindowKeyDown = useEffectEvent((event: KeyboardEvent) => {
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
        defaultProjectRef,
        defaultThreadEnvMode,
        handleNewThread,
      });
      return;
    }

    if (command === "chat.new") {
      event.preventDefault();
      event.stopPropagation();
      void startNewThreadFromContext({
        activeDraftThread,
        activeThread,
        defaultProjectRef,
        defaultThreadEnvMode,
        handleNewThread,
      });
    }
  });

  useMountEffect(() => {
    const onWindowKeyDown = (event: KeyboardEvent) => {
      handleWindowKeyDown(event);
    };

    window.addEventListener("keydown", onWindowKeyDown);
    return () => {
      window.removeEventListener("keydown", onWindowKeyDown);
    };
  });

  return null;
}

export function ChatRouteLayout() {
  return (
    <ShellHost mode="chat">
      <ChatRouteGlobalShortcuts />
      <Outlet />
    </ShellHost>
  );
}
