import { useHotkeys } from "@tanstack/react-hotkeys";

export interface ShellHotkeyActions {
  closeActive(): void;
  reopen(): void;
  newThread(): void;
  activateIndex(i: number): void;
}

// The ONE hotkey registry (locked ⌘W law: no component binds keys itself).
// Browser parity: every binding fires even when focus sits in an input, the way
// real browsers treat ⌘W/⌘N/⌘1-9. That is the library default ONLY for Ctrl/Meta
// chords (getDefaultIgnoreInputs: Alt combos ignore inputs by default), so bind()
// pins ignoreInputs:false explicitly — otherwise the Alt twins would go dead
// while a dialkit field has focus.
//
// Every Mod binding here is browser-reserved on Chrome/macOS (⌘W closes the
// browser tab before the page sees it), so the Alt twins exist purely to make
// the plane exercisable in the dev gallery; the Mod set becomes real under the
// Electron host once the menu frees ⌘W (ADR 0025 §5).
export function useShellHotkeys(actions: ShellHotkeyActions): void {
  useHotkeys([
    ...bind("Mod+W", () => actions.closeActive()),
    ...bind("Mod+Shift+T", () => actions.reopen()),
    ...bind("Mod+N", () => actions.newThread()),
    ...bind("Alt+W", () => actions.closeActive()),
    ...bind("Alt+Shift+T", () => actions.reopen()),
    ...bind("Alt+N", () => actions.newThread()),
    ...Array.from({ length: 9 }, (_, index) => [
      ...bind({ key: String(index + 1), mod: true }, () => actions.activateIndex(index)),
      ...bind({ key: String(index + 1), alt: true }, () => actions.activateIndex(index)),
    ]).flat(),
  ]);
}

type HotkeyBinding = Parameters<typeof useHotkeys>[0][number];

function bind(hotkey: HotkeyBinding["hotkey"], callback: () => void): [HotkeyBinding] {
  return [{ hotkey, callback, options: { preventDefault: true, ignoreInputs: false } }];
}
