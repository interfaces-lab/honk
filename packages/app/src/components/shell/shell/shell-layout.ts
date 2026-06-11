/**
 * Pure shell presentation resolver. Zustand stores user intent (leftOpen,
 * rightOpen, widths); this maps intent + measured shell width to how each
 * panel is presented. Never collapse a panel the user opened.
 *
 * Mirrors Cursor's pane model: only the docked agent-list sidebar (and the
 * secondary rail inside the workbench) ever become overlay drawers. The right
 * workbench always expands inline — its content needs real width, so the
 * center gives way instead.
 */

export const SHELL_BREAKPOINTS = {
  leftOverlay: 620,
  secondaryRailOverlay: 980,
} as const;

/**
 * Space the center chat column should keep when the workbench force-expands.
 * Cursor parity: its fill pane min is 384px, and opening the editor panel on
 * a too-narrow window grows the OS window by the deficit instead of crushing
 * the chat.
 */
export const SHELL_CENTER_MIN_WIDTH = 384;

export type ShellPanelMode = "inline" | "overlay";
export type PanelPresentation = "inline-expanded" | "overlay-expanded" | "collapsed";

export interface ShellPanelModes {
  left: ShellPanelMode;
  secondaryRail: ShellPanelMode;
}

export interface ShellPresentation {
  left: PanelPresentation;
  right: PanelPresentation;
  secondaryRail: PanelPresentation;
}

function modeForWidth(shellWidth: number, breakpoint: number): ShellPanelMode {
  // Width 0 means "not measured yet" (first paint): assume wide so panels
  // start inline instead of flashing through overlay mode.
  return shellWidth > 0 && shellWidth <= breakpoint ? "overlay" : "inline";
}

export function resolveShellPanelModes(shellWidth: number): ShellPanelModes {
  return {
    left: modeForWidth(shellWidth, SHELL_BREAKPOINTS.leftOverlay),
    secondaryRail: modeForWidth(shellWidth, SHELL_BREAKPOINTS.secondaryRailOverlay),
  };
}

export function areShellPanelModesEqual(a: ShellPanelModes, b: ShellPanelModes): boolean {
  return a.left === b.left && a.secondaryRail === b.secondaryRail;
}

export function panelPresentation(mode: ShellPanelMode, open: boolean): PanelPresentation {
  if (!open) {
    return "collapsed";
  }
  return mode === "overlay" ? "overlay-expanded" : "inline-expanded";
}

export function resolveShellPresentation(input: {
  shellWidth: number;
  leftOpen: boolean;
  rightOpen: boolean;
  secondaryRailOpen: boolean;
}): ShellPresentation {
  const modes = resolveShellPanelModes(input.shellWidth);
  return {
    left: panelPresentation(modes.left, input.leftOpen),
    right: input.rightOpen ? "inline-expanded" : "collapsed",
    secondaryRail: panelPresentation(modes.secondaryRail, input.secondaryRailOpen),
  };
}
