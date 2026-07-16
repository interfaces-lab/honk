// Shell hotkey registry (ADR 0025). Shell mounts it once. Chord defaults live in
// SHELL_KEYBINDING_DEFAULTS. User overrides merge a Partial map over that table.

import { useHotkeys } from "@tanstack/react-hotkeys";
import type { RegisterableHotkey, UseHotkeyDefinition } from "@tanstack/react-hotkeys";

import {
  actions as commandMenuActions,
  getSnapshot as getCommandMenuSnapshot,
} from "./command-menu-store";
import { actions as settingsActions, getSnapshot as getSettingsSnapshot } from "./settings-store";
import { actions as tabActions, getSnapshot as getTabsSnapshot } from "./tab-store";

export type ShellKeybindingCommand =
  | "tab.closeActive"
  | "tab.reopen"
  | "tab.openNew"
  | "tab.jump.1"
  | "tab.jump.2"
  | "tab.jump.3"
  | "tab.jump.4"
  | "tab.jump.5"
  | "tab.jump.6"
  | "tab.jump.7"
  | "tab.jump.8"
  | "tab.jump.9"
  | "commandMenu.toggle"
  | "commandMenu.openThreads"
  | "settings.toggle";

export type ShellKeybindingDefaults = Readonly<Record<ShellKeybindingCommand, RegisterableHotkey>>;

export const SHELL_KEYBINDING_DEFAULTS = {
  "tab.closeActive": "Mod+W",
  "tab.reopen": "Mod+Shift+T",
  "tab.openNew": "Mod+N",
  "tab.jump.1": "Mod+1",
  "tab.jump.2": "Mod+2",
  "tab.jump.3": "Mod+3",
  "tab.jump.4": "Mod+4",
  "tab.jump.5": "Mod+5",
  "tab.jump.6": "Mod+6",
  "tab.jump.7": "Mod+7",
  "tab.jump.8": "Mod+8",
  "tab.jump.9": "Mod+9",
  "commandMenu.toggle": "Mod+K",
  "commandMenu.openThreads": "Mod+O",
  "settings.toggle": "Mod+,",
} as const satisfies ShellKeybindingDefaults;

const SHELL_COMMANDS = [
  "tab.closeActive",
  "tab.reopen",
  "tab.openNew",
  "tab.jump.1",
  "tab.jump.2",
  "tab.jump.3",
  "tab.jump.4",
  "tab.jump.5",
  "tab.jump.6",
  "tab.jump.7",
  "tab.jump.8",
  "tab.jump.9",
  "commandMenu.toggle",
  "commandMenu.openThreads",
  "settings.toggle",
] as const satisfies readonly ShellKeybindingCommand[];

const JUMP_COMMANDS = [
  "tab.jump.1",
  "tab.jump.2",
  "tab.jump.3",
  "tab.jump.4",
  "tab.jump.5",
  "tab.jump.6",
  "tab.jump.7",
  "tab.jump.8",
  "tab.jump.9",
] as const satisfies readonly ShellKeybindingCommand[];

type HotkeyBinding = UseHotkeyDefinition;

function bind(hotkey: RegisterableHotkey, callback: () => void): HotkeyBinding {
  // Fire even when focus is in an input. Pin ignoreInputs so chord overrides stay consistent.
  return { hotkey, callback, options: { preventDefault: true, ignoreInputs: false } };
}

function activateIndex(index: number): void {
  const tab = getTabsSnapshot().tabs[index];
  if (tab !== undefined) {
    tabActions.activate(tab.key);
  }
}

function dispatch(command: ShellKeybindingCommand): void {
  switch (command) {
    case "tab.closeActive":
      // Close the topmost overlay first. A modal sits over the task, not instead of it.
      if (getCommandMenuSnapshot().open) {
        commandMenuActions.close();
        return;
      }
      if (getSettingsSnapshot().open) {
        settingsActions.close();
        return;
      }
      // closeActive skips Home (slot 0).
      tabActions.closeActive();
      return;
    case "tab.reopen":
      tabActions.reopen();
      return;
    case "tab.openNew":
      tabActions.openNew();
      return;
    case "tab.jump.1":
    case "tab.jump.2":
    case "tab.jump.3":
    case "tab.jump.4":
    case "tab.jump.5":
    case "tab.jump.6":
    case "tab.jump.7":
    case "tab.jump.8":
    case "tab.jump.9": {
      const index = JUMP_COMMANDS.indexOf(command);
      if (index >= 0) {
        activateIndex(index);
      }
      return;
    }
    case "commandMenu.toggle":
      settingsActions.close();
      commandMenuActions.openCommand();
      return;
    case "commandMenu.openThreads":
      settingsActions.close();
      commandMenuActions.openThreads();
      return;
    case "settings.toggle":
      commandMenuActions.close();
      settingsActions.toggle();
      return;
    default: {
      const _exhaustive: never = command;
      return _exhaustive;
    }
  }
}

export function resolveShellHotkeys(overrides?: Partial<ShellKeybindingDefaults>): HotkeyBinding[] {
  const resolved: ShellKeybindingDefaults = {
    ...SHELL_KEYBINDING_DEFAULTS,
    ...overrides,
  };

  return SHELL_COMMANDS.map((command) =>
    bind(resolved[command], () => {
      dispatch(command);
    }),
  );
}

// Mount once on the shell route. Unbinds on unmount.
export function useShellHotkeys(
  overrides?: Partial<ShellKeybindingDefaults>,
  enabled = true,
): void {
  useHotkeys(resolveShellHotkeys(overrides), { enabled });
}
