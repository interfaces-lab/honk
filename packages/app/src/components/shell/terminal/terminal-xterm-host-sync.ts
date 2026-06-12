import type { Terminal } from "@xterm/xterm";

import { APPEARANCE_SETTINGS_CHANGED } from "~/lib/appearance-settings";

import { applyTerminalHostToXterm } from "./terminal-host-theme";

/**
 * Attributes on `document.documentElement` that can change terminal palette, fonts, or density.
 * Kept in one place so workbench and thread terminals observe the same surface.
 */
export const TERMINAL_HOST_DOCUMENT_ATTRIBUTE_FILTER = ["class", "style"] as const;

export type TerminalHostSyncOptions = {
  /** After host theme/fonts are applied (e.g. fit + PTY resize). */
  onApplied?: () => void;
};

/**
 * Subscribe to document theme and Honk appearance updates; keep an xterm instance aligned with the host.
 * Uses getters so refs stay current across StrictMode and remounts.
 */
export function subscribeTerminalHostDocument(
  getMount: () => HTMLElement | null,
  getTerminal: () => Terminal | null,
  options: TerminalHostSyncOptions = {},
): () => void {
  const initialMount = getMount();
  const root = initialMount?.ownerDocument.documentElement ?? document.documentElement;

  const run = () => {
    const terminal = getTerminal();
    const mount = getMount();
    if (!terminal || !mount) return;
    applyTerminalHostToXterm(terminal, mount);
    options.onApplied?.();
  };

  const observer = new MutationObserver(run);
  observer.observe(root, {
    attributes: true,
    attributeFilter: [...TERMINAL_HOST_DOCUMENT_ATTRIBUTE_FILTER],
  });

  window.addEventListener(APPEARANCE_SETTINGS_CHANGED, run);

  return () => {
    observer.disconnect();
    window.removeEventListener(APPEARANCE_SETTINGS_CHANGED, run);
  };
}
