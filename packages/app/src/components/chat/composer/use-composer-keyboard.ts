import type { KeybindingShortcut, ResolvedKeybindingsConfig } from "@multi/contracts";
import { useHotkey } from "@tanstack/react-hotkeys";
import { useMemo, type RefObject } from "react";

import { shortcutForCommand } from "../../../keybindings";

const DISABLED_HOTKEY = { key: "Tab", shift: true } as const;

function keybindingShortcutKeyForHotkey(shortcut: KeybindingShortcut): string {
  if (shortcut.key === " ") return "Space";
  if (shortcut.key === "escape") return "Escape";
  if (shortcut.key === "tab") return "Tab";
  if (shortcut.key === "enter") return "Enter";
  if (shortcut.key === "arrowup") return "ArrowUp";
  if (shortcut.key === "arrowdown") return "ArrowDown";
  if (shortcut.key === "arrowleft") return "ArrowLeft";
  if (shortcut.key === "arrowright") return "ArrowRight";
  if (shortcut.key.length === 1) return shortcut.key.toUpperCase();
  return shortcut.key;
}

function keybindingShortcutToHotkey(shortcut: KeybindingShortcut): Parameters<typeof useHotkey>[0] {
  return {
    key: keybindingShortcutKeyForHotkey(shortcut),
    mod: shortcut.modKey,
    ctrl: shortcut.ctrlKey,
    shift: shortcut.shiftKey,
    alt: shortcut.altKey,
    meta: shortcut.metaKey,
  };
}

export function useComposerKeyboard(input: {
  enabled?: boolean | undefined;
  keybindings: ResolvedKeybindingsConfig;
  terminalOpen: boolean;
  targetRef: RefObject<HTMLDivElement | null>;
  onToggleInteractionMode: () => void;
}): void {
  const cycleInteractionModeHotkey = useMemo(() => {
    const shortcut = shortcutForCommand(input.keybindings, "composer.cycleInteractionMode", {
      context: { terminalOpen: input.terminalOpen },
    });
    return shortcut ? keybindingShortcutToHotkey(shortcut) : null;
  }, [input.keybindings, input.terminalOpen]);

  useHotkey(
    cycleInteractionModeHotkey ?? DISABLED_HOTKEY,
    () => {
      input.onToggleInteractionMode();
    },
    {
      conflictBehavior: "allow",
      enabled: input.enabled !== false && cycleInteractionModeHotkey !== null,
      ignoreInputs: false,
      target: input.targetRef,
    },
  );
}
