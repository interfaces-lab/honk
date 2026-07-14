// ONE route-scoped shell hotkey registry (ADR 0025 §3 / locked.html ⌘W law).
// No component binds keys itself — shell mounts this once; command-menu WP adds
// ⌘K/⌘O into the SAME defaults map + registry rather than a second listener.
//
// Bindings resolve through SHELL_KEYBINDING_DEFAULTS (command id → chord).
// A future user-config layer overrides by merging a Partial map over these
// defaults before resolveShellHotkeys() — never by scattering hardcoded checks.

import { useHotkeys } from "@tanstack/react-hotkeys";
import type { RegisterableHotkey, UseHotkeyDefinition } from "@tanstack/react-hotkeys";

import { actions as commandMenuActions } from "./command-menu-store";
import { actions, getSnapshot } from "./tab-store";

// Command ids owned by this registry. One map — no second key listener anywhere.
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
  | "commandMenu.openThreads";

export type ShellKeybindingDefaults = Readonly<
  Record<ShellKeybindingCommand, RegisterableHotkey>
>;

// The defaults map — the only place shell chords are declared. Override shape for
// a future user-config layer: Partial<ShellKeybindingDefaults> merged over this
// (last-write-wins per command), then passed to resolveShellHotkeys(overrides).
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
  // Browser parity: fire even when focus sits in an input (TanStack only defaults
  // ignoreInputs:false for Ctrl/Meta chords — pin it so overrides stay consistent).
  return { hotkey, callback, options: { preventDefault: true, ignoreInputs: false } };
}

function activateIndex(index: number): void {
  const tab = getSnapshot().tabs[index];
  if (tab !== undefined) {
    actions.activate(tab.key);
  }
}

function dispatch(command: ShellKeybindingCommand): void {
  switch (command) {
    case "tab.closeActive":
      // Home is skipped inside actions.close (index <= 0) — scoped-close law.
      actions.closeActive();
      return;
    case "tab.reopen":
      actions.reopen();
      return;
    case "tab.openNew":
      actions.openNew();
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
      commandMenuActions.openCommand();
      return;
    case "commandMenu.openThreads":
      commandMenuActions.openThreads();
      return;
    default: {
      const _exhaustive: never = command;
      return _exhaustive;
    }
  }
}

// Merge optional user overrides over defaults, then build the TanStack registration
// list. One lookup path — no per-key if/else outside this map.
export function resolveShellHotkeys(
  overrides?: Partial<ShellKeybindingDefaults>,
): HotkeyBinding[] {
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

// Mount once on the shell route. Registry unbinds on unmount — the locked
// one-registry law, scoped to the app shell (not per-page components).
export function useShellHotkeys(
  overrides?: Partial<ShellKeybindingDefaults>,
): void {
  useHotkeys(resolveShellHotkeys(overrides));
}
