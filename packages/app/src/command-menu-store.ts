// Command-menu UI store (ADR 0025 §2). Plain {subscribe, getSnapshot, actions} —
// the same idiom as tab-store / appearance-store. Owns overlay open state, which
// door opened it (⌘K vs ⌘O), the query, keyboard selection, and the submenu stack.
// Timers/coalescing stay here if they ever appear; components stay effect-free.
//
// Three doors, one store: Home reads the same snapshot for its inline omnibox;
// the shell-mounted overlay opens when `open` is true. Hotkeys dispatch here
// (see hotkeys.ts) — never a second key listener.

import { useSyncExternalStore } from "react";
import { useSyncExternalStoreWithSelector } from "use-sync-external-store/with-selector";

/** Which overlay door opened the menu. Home inline ignores this and always ranks as "command". */
export type CommandMenuDoor = "command" | "threads";

/** One pushed submenu frame (parity: "New thread in…" → project picker). */
export type CommandMenuSubmenuFrame = {
  readonly id: string;
  readonly title: string;
  readonly placeholder?: string;
};

export type CommandMenuSnapshot = {
  readonly open: boolean;
  readonly door: CommandMenuDoor;
  readonly query: string;
  readonly selectedIndex: number;
  readonly submenuStack: readonly CommandMenuSubmenuFrame[];
};

const DEFAULT_SNAPSHOT: CommandMenuSnapshot = Object.freeze({
  open: false,
  door: "command",
  query: "",
  selectedIndex: 0,
  submenuStack: Object.freeze([]),
});

const listeners = new Set<() => void>();

let snapshot: CommandMenuSnapshot = DEFAULT_SNAPSHOT;

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getSnapshot(): CommandMenuSnapshot {
  return snapshot;
}

export function getServerSnapshot(): CommandMenuSnapshot {
  return DEFAULT_SNAPSHOT;
}

export function useCommandMenu(): CommandMenuSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function useCommandMenuSelector<T>(
  selector: (snapshot: CommandMenuSnapshot) => T,
  isEqual: (a: T, b: T) => boolean = Object.is,
): T {
  return useSyncExternalStoreWithSelector(
    subscribe,
    getSnapshot,
    getServerSnapshot,
    selector,
    isEqual,
  );
}

export const actions = {
  /** ⌘K — full menu (Start-new → threads → commands). Toggles if already open on the same door. */
  openCommand(): void {
    if (snapshot.open && snapshot.door === "command") {
      actions.close();
      return;
    }
    publish({
      open: true,
      door: "command",
      query: "",
      selectedIndex: 0,
      submenuStack: DEFAULT_SNAPSHOT.submenuStack,
    });
  },

  /** ⌘O — same overlay pre-scoped to threads. */
  openThreads(): void {
    if (snapshot.open && snapshot.door === "threads") {
      actions.close();
      return;
    }
    publish({
      open: true,
      door: "threads",
      query: "",
      selectedIndex: 0,
      submenuStack: DEFAULT_SNAPSHOT.submenuStack,
    });
  },

  close(): void {
    if (!snapshot.open && snapshot.query === "" && snapshot.submenuStack.length === 0) {
      return;
    }
    publish(DEFAULT_SNAPSHOT);
  },

  setQuery(query: string): void {
    if (snapshot.query === query) {
      return;
    }
    // Typing resets the highlight to the primary row (Start-new / first match).
    publish({
      ...snapshot,
      query,
      selectedIndex: 0,
    });
  },

  setSelectedIndex(selectedIndex: number): void {
    if (snapshot.selectedIndex === selectedIndex) {
      return;
    }
    publish({ ...snapshot, selectedIndex });
  },

  /** Clamp-aware move used by ArrowUp/ArrowDown on the focused input. */
  moveSelection(delta: number, itemCount: number): void {
    if (itemCount <= 0) {
      if (snapshot.selectedIndex !== 0) {
        publish({ ...snapshot, selectedIndex: 0 });
      }
      return;
    }
    const next = ((snapshot.selectedIndex + delta) % itemCount + itemCount) % itemCount;
    if (next === snapshot.selectedIndex) {
      return;
    }
    publish({ ...snapshot, selectedIndex: next });
  },

  pushSubmenu(frame: CommandMenuSubmenuFrame): void {
    publish({
      ...snapshot,
      query: "",
      selectedIndex: 0,
      submenuStack: Object.freeze([...snapshot.submenuStack, Object.freeze({ ...frame })]),
    });
  },

  /** Backspace-on-empty / explicit back — pop one frame; no-op at root. */
  popSubmenu(): void {
    if (snapshot.submenuStack.length === 0) {
      return;
    }
    publish({
      ...snapshot,
      query: "",
      selectedIndex: 0,
      submenuStack: Object.freeze(snapshot.submenuStack.slice(0, -1)),
    });
  },
} as const;

function publish(next: CommandMenuSnapshot): void {
  if (
    next.open === snapshot.open &&
    next.door === snapshot.door &&
    next.query === snapshot.query &&
    next.selectedIndex === snapshot.selectedIndex &&
    next.submenuStack === snapshot.submenuStack
  ) {
    return;
  }

  snapshot = Object.freeze({
    open: next.open,
    door: next.door,
    query: next.query,
    selectedIndex: next.selectedIndex,
    submenuStack: next.submenuStack,
  });

  for (const listener of listeners) {
    listener();
  }
}
