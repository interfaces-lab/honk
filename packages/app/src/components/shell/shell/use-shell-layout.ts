"use client";

import { type RefObject, useEffect, useState } from "react";

import {
  areShellPanelModesEqual,
  resolveShellPanelModes,
  type ShellPanelModes,
} from "./shell-layout";

/**
 * Trailing debounce when widening out of overlay mode so a width hovering at
 * a breakpoint does not flip the layout back and forth. Shrinking into
 * overlay applies immediately to avoid clipped panels.
 */
const OVERLAY_EXIT_DEBOUNCE_MS = 150;

/**
 * Observes the shell root width and resolves per-panel modes. React state
 * only updates when a mode enum changes, never per pixel — sash drags and
 * window resizes inside a mode are invisible to React.
 */
export function useShellPanelModes(targetRef: RefObject<HTMLElement | null>): ShellPanelModes {
  const [modes, setModes] = useState<ShellPanelModes>(() => resolveShellPanelModes(0));

  useEffect(() => {
    const node = targetRef.current;
    if (!node || typeof ResizeObserver === "undefined") {
      return undefined;
    }

    // Mode changes only flow through this observer, so the committed modes can
    // live in the closure; the functional setter reconciles with state.
    let current = resolveShellPanelModes(0);
    let exitTimeout: number | null = null;
    const clearExitTimeout = () => {
      if (exitTimeout !== null) {
        window.clearTimeout(exitTimeout);
        exitTimeout = null;
      }
    };
    const commit = (next: ShellPanelModes) => {
      current = next;
      setModes((previous) => (areShellPanelModesEqual(previous, next) ? previous : next));
    };
    const handleWidth = (width: number) => {
      const next = resolveShellPanelModes(width);
      clearExitTimeout();
      if (areShellPanelModesEqual(current, next)) {
        return;
      }
      const entersOverlay =
        (current.left === "inline" && next.left === "overlay") ||
        (current.secondaryRail === "inline" && next.secondaryRail === "overlay");
      if (entersOverlay) {
        commit(next);
        return;
      }
      exitTimeout = window.setTimeout(() => {
        exitTimeout = null;
        commit(next);
      }, OVERLAY_EXIT_DEBOUNCE_MS);
    };

    const observer = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (entry) {
        handleWidth(entry.contentRect.width);
      }
    });
    observer.observe(node);
    handleWidth(node.getBoundingClientRect().width);

    return () => {
      clearExitTimeout();
      observer.disconnect();
    };
  }, [targetRef]);

  return modes;
}
