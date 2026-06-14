"use client";

import {
  createContext,
  type ReactNode,
  type RefObject,
  useContext,
  useSyncExternalStore,
} from "react";

import { useLayoutSyncEffect } from "~/hooks/use-layout-sync-effect";
import {
  RIGHT_WORKBENCH_WIDTH_LIMITS,
  readShellPanelLayoutInputs,
  subscribeShellPanelLayoutInputs,
} from "~/stores/shell-panels-store";
import {
  getWorkspaceFullscreenTarget,
  subscribeWorkspaceEditor,
} from "~/stores/workspace-editor-store";

import {
  panelPresentation,
  SHELL_CENTER_MIN_WIDTH,
  type PanelPresentation,
  type ShellPanelMode,
} from "./shell-layout";

const MIN_EDITOR_PANEL_WIDTH = RIGHT_WORKBENCH_WIDTH_LIMITS.min;

function resolveDockedEditorPanelMaxWidth(input: {
  dockedSidebarWidth: number;
  maxWidth: number;
  shellWidth: number;
}): number {
  if (input.shellWidth <= 0) {
    return input.maxWidth;
  }
  return Math.min(
    input.maxWidth,
    Math.max(
      MIN_EDITOR_PANEL_WIDTH,
      input.shellWidth - input.dockedSidebarWidth - SHELL_CENTER_MIN_WIDTH,
    ),
  );
}

export interface ShellLayoutSnapshot {
  readonly activeAgentId: string | null;
  readonly editorPanelFullscreen: boolean;
  readonly editorPanelPendingResize: boolean;
  readonly editorPanelVisible: boolean;
  readonly editorPanelWidth: number;
  readonly leftOpen: boolean;
  readonly leftPresentation: PanelPresentation;
  readonly leftWidth: number;
  readonly maxEditorPanelWidth: number;
  readonly rightOpen: boolean;
  readonly rightWidth: number;
  readonly sidebarOverlayMode: boolean;
  readonly sidebarVisible: boolean;
  readonly shellWidth: number;
  readonly suppressMotion: boolean;
}

interface ShellLayoutConfig {
  readonly gitFocusId: string | null;
  readonly leftMode: ShellPanelMode;
  readonly rootRef: RefObject<HTMLDivElement | null>;
  readonly routeThreadId: string | null;
  readonly showRight: boolean;
  readonly workspaceKey: string | null;
}

const EMPTY_SNAPSHOT: ShellLayoutSnapshot = Object.freeze({
  activeAgentId: null,
  editorPanelFullscreen: false,
  editorPanelPendingResize: false,
  editorPanelVisible: false,
  editorPanelWidth: 0,
  leftOpen: true,
  leftPresentation: "inline-expanded",
  leftWidth: 260,
  maxEditorPanelWidth: Number.POSITIVE_INFINITY,
  rightOpen: false,
  rightWidth: 400,
  sidebarOverlayMode: false,
  sidebarVisible: true,
  shellWidth: 0,
  suppressMotion: false,
});

type Listener = () => void;

function resolveEffectiveRightOpen(input: {
  gitFocusId: string | null;
  muted: boolean;
  routeThreadId: string | null;
  showRight: boolean;
  storedRightOpen: boolean;
}): boolean {
  return (
    input.showRight &&
    (input.storedRightOpen ||
      Boolean(input.routeThreadId && input.gitFocusId && !input.muted))
  );
}

function getViewportWidth(root: HTMLElement | null): number {
  if (typeof window !== "undefined" && window.innerWidth > 0) {
    return window.innerWidth;
  }
  return root?.getBoundingClientRect().width ?? 0;
}

function areRecordsEqual(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key) => Object.is(left[key], right[key]));
}

function areArraysEqual(left: readonly unknown[], right: readonly unknown[]): boolean {
  return left.length === right.length && left.every((value, index) => Object.is(value, right[index]));
}

function areStructurallyEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) && Array.isArray(right)) return areArraysEqual(left, right);
  if (
    typeof left === "object" &&
    left !== null &&
    typeof right === "object" &&
    right !== null &&
    !Array.isArray(left) &&
    !Array.isArray(right)
  ) {
    return areRecordsEqual(
      left as Record<string, unknown>,
      right as Record<string, unknown>,
    );
  }
  return false;
}

export class ShellLayoutService {
  private config: ShellLayoutConfig | null = null;
  private disposeFns: Array<() => void> = [];
  private listeners = new Set<Listener>();
  private motionClearFrame: number | null = null;
  private snapshot: ShellLayoutSnapshot = EMPTY_SNAPSHOT;

  dispose(): void {
    for (const dispose of this.disposeFns) {
      dispose();
    }
    this.disposeFns = [];
    this.clearMotionFrame();
    this.writeDom({ ...this.snapshot, suppressMotion: false, editorPanelFullscreen: false });
    this.config = null;
  }

  getSnapshot = (): ShellLayoutSnapshot => this.snapshot;

  setConfig(config: ShellLayoutConfig): void {
    this.config = config;
    if (this.disposeFns.length === 0) {
      this.disposeFns = [
        subscribeShellPanelLayoutInputs(() => this.recomputeAndEmit()),
        subscribeWorkspaceEditor(() => this.recomputeAndEmit()),
      ];
      if (typeof window !== "undefined") {
        window.addEventListener("resize", this.recomputeAndEmit);
        this.disposeFns.push(() => window.removeEventListener("resize", this.recomputeAndEmit));
      }
    }
    this.recomputeAndEmit();
  }

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private buildSnapshot(): ShellLayoutSnapshot {
    const config = this.config;
    if (!config) {
      return EMPTY_SNAPSHOT;
    }

    const panelInputs = readShellPanelLayoutInputs(config.workspaceKey);
    const root = config.rootRef.current;
    const shellWidth = getViewportWidth(root);
    const leftPresentation = panelPresentation(config.leftMode, panelInputs.leftOpen);
    const sidebarVisible = panelInputs.leftOpen;
    const sidebarOverlayMode = config.leftMode === "overlay";
    const rightOpen = resolveEffectiveRightOpen({
      gitFocusId: config.gitFocusId,
      muted: panelInputs.muted,
      routeThreadId: config.routeThreadId,
      showRight: config.showRight,
      storedRightOpen: panelInputs.storedRightOpen,
    });
    const fullscreenActive =
      rightOpen && getWorkspaceFullscreenTarget(config.workspaceKey) === "right-workbench";
    const effectiveDockedSidebarWidth =
      sidebarVisible && !sidebarOverlayMode ? panelInputs.leftWidth : 0;
    const maxEditorPanelWidth = resolveDockedEditorPanelMaxWidth({
      dockedSidebarWidth: effectiveDockedSidebarWidth,
      maxWidth: panelInputs.rightWidthLimits.max,
      shellWidth,
    });
    const editorPanelWidth = fullscreenActive
      ? Math.max(0, shellWidth - effectiveDockedSidebarWidth)
      : Math.min(panelInputs.rightWidth, maxEditorPanelWidth);
    const suppressMotion =
      this.snapshot.editorPanelFullscreen !== fullscreenActive ||
      this.snapshot.activeAgentId !== config.routeThreadId;

    return {
      activeAgentId: config.routeThreadId,
      editorPanelFullscreen: fullscreenActive,
      editorPanelPendingResize: false,
      editorPanelVisible: rightOpen,
      editorPanelWidth,
      leftOpen: panelInputs.leftOpen,
      leftPresentation,
      leftWidth: panelInputs.leftWidth,
      maxEditorPanelWidth,
      rightOpen,
      rightWidth: panelInputs.rightWidth,
      sidebarOverlayMode,
      sidebarVisible,
      shellWidth,
      suppressMotion,
    };
  }

  private clearMotionFrame(): void {
    if (this.motionClearFrame !== null && typeof window !== "undefined") {
      window.cancelAnimationFrame(this.motionClearFrame);
    }
    this.motionClearFrame = null;
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  private scheduleMotionClear(): void {
    this.clearMotionFrame();
    if (typeof window === "undefined") return;
    this.motionClearFrame = window.requestAnimationFrame(() => {
      this.motionClearFrame = null;
      if (!this.snapshot.suppressMotion) return;
      this.snapshot = { ...this.snapshot, suppressMotion: false };
      this.writeDom(this.snapshot);
      this.emit();
    });
  }

  private writeDom(snapshot: ShellLayoutSnapshot): void {
    const root = this.config?.rootRef.current ?? null;
    if (!root) return;

    root.dataset.shellFullscreenTarget = snapshot.editorPanelFullscreen
      ? "right-workbench"
      : "none";
    root.dataset.shellLeftPresentation = snapshot.leftPresentation;
    root.dataset.shellRightIntent = snapshot.editorPanelVisible ? "expanded" : "collapsed";
    root.dataset.shellRightOpen = snapshot.editorPanelVisible ? "true" : "false";
    if (snapshot.suppressMotion) {
      root.dataset.suppressMotion = "true";
    } else {
      delete root.dataset.suppressMotion;
    }

    const panel = root.querySelector<HTMLElement>(".editor-panel-container");
    if (panel) {
      if (snapshot.suppressMotion) {
        panel.dataset.suppressMotion = "true";
      } else {
        delete panel.dataset.suppressMotion;
      }
      if (snapshot.editorPanelFullscreen) {
        panel.dataset.fullscreenLayout = "true";
        panel.style.width = "";
        panel.style.minWidth = "";
      } else if (snapshot.editorPanelVisible) {
        delete panel.dataset.fullscreenLayout;
        panel.style.width = `${snapshot.editorPanelWidth}px`;
        panel.style.minWidth = `${MIN_EDITOR_PANEL_WIDTH}px`;
      } else {
        delete panel.dataset.fullscreenLayout;
        panel.style.width = "0px";
        panel.style.minWidth = "0px";
      }
    }

    const toggle = root.querySelector<HTMLButtonElement>("[data-shell-fullscreen-toggle]");
    if (toggle) {
      toggle.setAttribute("aria-pressed", snapshot.editorPanelFullscreen ? "true" : "false");
      toggle.setAttribute(
        "aria-label",
        snapshot.editorPanelFullscreen
          ? "Exit editor panel fullscreen"
          : "Enter editor panel fullscreen",
      );
      toggle.dataset.active = snapshot.editorPanelFullscreen ? "true" : "false";
    }
  }

  private recomputeAndEmit = (): void => {
    const next = this.buildSnapshot();
    if (areStructurallyEqual(this.snapshot, next)) {
      this.writeDom(next);
      return;
    }
    this.snapshot = next;
    this.writeDom(next);
    this.emit();
    if (next.suppressMotion) {
      this.scheduleMotionClear();
    }
  };
}

const ShellLayoutServiceContext = createContext<ShellLayoutService | null>(null);

export function ShellLayoutProvider(props: {
  children: ReactNode;
  service: ShellLayoutService;
}) {
  return (
    <ShellLayoutServiceContext.Provider value={props.service}>
      {props.children}
    </ShellLayoutServiceContext.Provider>
  );
}

export function useShellLayoutConfig(
  service: ShellLayoutService,
  config: ShellLayoutConfig,
): void {
  useLayoutSyncEffect(() => {
    service.setConfig(config);
  }, [
    service,
    config.gitFocusId,
    config.leftMode,
    config.rootRef,
    config.routeThreadId,
    config.showRight,
    config.workspaceKey,
  ]);

  useLayoutSyncEffect(() => {
    return () => service.dispose();
  }, [service]);
}

export function useShellLayout<T>(selector: (snapshot: ShellLayoutSnapshot) => T): T {
  const service = useContext(ShellLayoutServiceContext);
  if (!service) {
    throw new Error("useShellLayout must be used within ShellLayoutProvider");
  }

  const snapshot = useSyncExternalStore(
    service.subscribe,
    service.getSnapshot,
    service.getSnapshot,
  );
  return selector(snapshot);
}
