import {
  type AgentInteractionMode,
  type EnvironmentId,
  type MessageId,
  type ProjectScript,
  type ResolvedKeybindingsConfig,
  type ScopedThreadRef,
  type ThreadId,
} from "@multi/contracts";
import { scopedThreadKey, scopeThreadRef } from "~/lib/environment-scope";
import { projectScriptCwd } from "@multi/shared/project-scripts";
import type { Dispatch, RefObject, SetStateAction } from "react";

import { retainThreadDetailSubscription } from "../../../environments/runtime/service";
import { useMountEffect } from "~/hooks/use-mount-effect";
import { isTerminalFocused } from "../../../lib/terminal-focus";
import { projectScriptIdFromCommand } from "~/lib/project-scripts";
import { resolveShortcutCommand } from "../../../keybindings";
import { useCommandPaletteStore } from "../../../stores/ui/command-palette-store";
import type { ChatMessage, ThreadSendIntent } from "../../../types";
import { type ExpandedImagePreview } from "../message/expanded-image-preview";
import {
  collectUserMessageBlobPreviewUrls,
  revokeUserMessagePreviewUrls,
} from "../message/preview-url-lifecycle";
import {
  MAX_HIDDEN_MOUNTED_TERMINAL_THREADS,
  reconcileMountedTerminalThreadIds,
  type PullRequestDialogState,
} from "./thread-lifecycle";
import { type ThreadTerminalLaunchContext } from "../../../terminal-state-store";
import { type TerminalLaunchContext } from "./persistent-thread-terminal-drawer";
import {
  acknowledgedThreadSendIntents,
  threadSendIntentMessages,
} from "./thread-timeline-projector";
import { hydrateRuntimeThread } from "../../../lib/runtime-turn-dispatch";

const RUNTIME_HYDRATION_IDLE_TIMEOUT_MS = 1200;

/**
 * Lifecycle effect components used by `ChatView`. Each component runs a single
 * `useMountEffect` driven by the active thread key, so swapping threads or
 * route kinds resets the effect cleanly. The components return `null` and only
 * exist to scope effects under a keyed identity.
 */

export function MountedTerminalThreadsSync({
  activeThreadKey,
  existingOpenTerminalThreadKeys,
  setMountedTerminalThreadKeys,
  terminalOpen,
}: {
  activeThreadKey: string | null;
  existingOpenTerminalThreadKeys: readonly string[];
  setMountedTerminalThreadKeys: Dispatch<SetStateAction<string[]>>;
  terminalOpen: boolean;
}) {
  useMountEffect(() => {
    setMountedTerminalThreadKeys((currentThreadIds) => {
      const nextThreadIds = reconcileMountedTerminalThreadIds({
        currentThreadIds,
        openThreadIds: existingOpenTerminalThreadKeys,
        activeThreadId: activeThreadKey,
        activeThreadTerminalOpen: Boolean(activeThreadKey && terminalOpen),
        maxHiddenThreadCount: MAX_HIDDEN_MOUNTED_TERMINAL_THREADS,
      });
      return currentThreadIds.length === nextThreadIds.length &&
        currentThreadIds.every((nextThreadId, index) => nextThreadId === nextThreadIds[index])
        ? currentThreadIds
        : nextThreadIds;
    });
  });

  return null;
}

export function RetainServerThreadDetailSync({
  environmentId,
  routeKind,
  threadId,
}: {
  environmentId: EnvironmentId;
  routeKind: "server" | "draft";
  threadId: ThreadId;
}) {
  useMountEffect(() => {
    if (routeKind !== "server") {
      return;
    }
    return retainThreadDetailSubscription(environmentId, threadId);
  });

  return null;
}

export function RuntimeThreadHydrationSync({
  cwd,
  interactionMode,
  routeKind,
  threadId,
  isDraftBoundThread = false,
}: {
  cwd: string | null | undefined;
  interactionMode: AgentInteractionMode;
  routeKind: "server" | "draft";
  threadId: ThreadId;
  isDraftBoundThread?: boolean;
}) {
  useMountEffect(() => {
    if (routeKind !== "server" || !cwd || isDraftBoundThread) {
      return;
    }
    return scheduleRuntimeHydrationAfterFirstPaint(() => {
      void hydrateRuntimeThread({
        threadId,
        cwd,
        interactionMode,
      }).catch(() => undefined);
    });
  });

  return null;
}

function scheduleRuntimeHydrationAfterFirstPaint(hydrate: () => void): () => void {
  let secondFrameId: number | null = null;
  let timeoutId: number | null = null;
  let idleCallbackId: number | null = null;

  const firstFrameId = window.requestAnimationFrame(() => {
    secondFrameId = window.requestAnimationFrame(() => {
      if (typeof window.requestIdleCallback === "function") {
        idleCallbackId = window.requestIdleCallback(hydrate, {
          timeout: RUNTIME_HYDRATION_IDLE_TIMEOUT_MS,
        });
        return;
      }

      timeoutId = window.setTimeout(hydrate, 32);
    });
  });

  return () => {
    window.cancelAnimationFrame(firstFrameId);
    if (secondFrameId !== null) {
      window.cancelAnimationFrame(secondFrameId);
    }
    if (idleCallbackId !== null && typeof window.cancelIdleCallback === "function") {
      window.cancelIdleCallback(idleCallbackId);
    }
    if (timeoutId !== null) {
      window.clearTimeout(timeoutId);
    }
  };
}

export function MarkSettledServerThreadVisitedSync({
  activeThreadLastVisitedAt,
  completedAt,
  environmentId,
  latestTurnSettled,
  markThreadVisited,
  threadId,
}: {
  activeThreadLastVisitedAt: string | null | undefined;
  completedAt: string | null | undefined;
  environmentId: EnvironmentId | undefined;
  latestTurnSettled: boolean;
  markThreadVisited: (threadKey: string) => void;
  threadId: ThreadId | undefined;
}) {
  useMountEffect(() => {
    if (!environmentId || !threadId) return;
    if (!latestTurnSettled) return;
    if (!completedAt) return;
    const turnCompletedAt = Date.parse(completedAt);
    if (Number.isNaN(turnCompletedAt)) return;
    const lastVisitedAt = activeThreadLastVisitedAt ? Date.parse(activeThreadLastVisitedAt) : NaN;
    if (!Number.isNaN(lastVisitedAt) && lastVisitedAt >= turnCompletedAt) return;

    markThreadVisited(scopedThreadKey(scopeThreadRef(environmentId, threadId)));
  });

  return null;
}

export function ActiveThreadUiResetSync({
  isAtBottomRef,
  setPullRequestDialogState,
  setShowScrollToBottom,
  showScrollDebouncer,
}: {
  isAtBottomRef: RefObject<boolean>;
  setPullRequestDialogState: Dispatch<SetStateAction<PullRequestDialogState | null>>;
  setShowScrollToBottom: Dispatch<SetStateAction<boolean>>;
  showScrollDebouncer: RefObject<{ cancel: () => void }>;
}) {
  useMountEffect(() => {
    setPullRequestDialogState(null);
    isAtBottomRef.current = true;
    showScrollDebouncer.current.cancel();
    setShowScrollToBottom(false);
  });

  return null;
}

export function ActiveThreadComposerFocusSync({
  activeThreadId,
  focusComposer,
  terminalOpen,
}: {
  activeThreadId: ThreadId | null;
  focusComposer: () => void;
  terminalOpen: boolean;
}) {
  useMountEffect(() => {
    if (!activeThreadId || terminalOpen) return;
    const frame = window.requestAnimationFrame(() => {
      focusComposer();
    });
    return () => {
      window.cancelAnimationFrame(frame);
    };
  });

  return null;
}

export function ThreadSendIntentsServerAckSync({
  acknowledgedMessageIds,
  handoffAttachmentPreviews,
  removeThreadSendIntents,
  serverMessages,
  threadSendIntents,
  threadKey,
}: {
  acknowledgedMessageIds?: ReadonlySet<MessageId> | undefined;
  handoffAttachmentPreviews: (messageId: MessageId, previewUrls: string[]) => void;
  removeThreadSendIntents: (
    threadKey: string,
    clientSendKeys: ReadonlySet<MessageId>,
  ) => ThreadSendIntent[];
  serverMessages: readonly ChatMessage[] | undefined;
  threadSendIntents: ReadonlyArray<ThreadSendIntent>;
  threadKey: string;
}) {
  useMountEffect(() => {
    const committedMessages = serverMessages ?? [];
    if (committedMessages.length === 0 && (acknowledgedMessageIds?.size ?? 0) === 0) {
      return;
    }
    const removedIntents = acknowledgedThreadSendIntents({
      sendIntents: threadSendIntents,
      committedMessages,
      acknowledgedMessageIds,
    });
    if (removedIntents.length === 0) {
      return;
    }
    const removedClientSendKeys = new Set(removedIntents.map((intent) => intent.clientMessageId));
    const storedRemovedIntents = removeThreadSendIntents(threadKey, removedClientSendKeys);
    for (const removedMessage of threadSendIntentMessages(storedRemovedIntents)) {
      const previewUrls = collectUserMessageBlobPreviewUrls(removedMessage);
      if (previewUrls.length > 0) {
        handoffAttachmentPreviews(removedMessage.id, previewUrls);
        continue;
      }
      revokeUserMessagePreviewUrls(removedMessage);
    }
  });

  return null;
}

export function ThreadMediaResetSync({
  clearAttachmentPreviewHandoffs,
  setExpandedImage,
}: {
  clearAttachmentPreviewHandoffs: () => void;
  setExpandedImage: Dispatch<SetStateAction<ExpandedImagePreview | null>>;
}) {
  useMountEffect(() => {
    clearAttachmentPreviewHandoffs();
    setExpandedImage(null);
  });

  return null;
}

export function TerminalLaunchActiveThreadSync({
  activeThreadId,
  routeThreadRef,
  setTerminalLaunchContext,
  storeClearTerminalLaunchContext,
}: {
  activeThreadId: ThreadId | null;
  routeThreadRef: ScopedThreadRef;
  setTerminalLaunchContext: Dispatch<SetStateAction<TerminalLaunchContext | null>>;
  storeClearTerminalLaunchContext: (threadRef: ScopedThreadRef) => void;
}) {
  useMountEffect(() => {
    if (!activeThreadId) {
      setTerminalLaunchContext(null);
      storeClearTerminalLaunchContext(routeThreadRef);
      return;
    }
    setTerminalLaunchContext((current) => {
      if (!current) return current;
      if (current.threadId === activeThreadId) return current;
      return null;
    });
  });

  return null;
}

export function TerminalLaunchLocalSettledSync({
  activeProjectCwd,
  activeThreadId,
  activeThreadRef,
  activeThreadWorktreePath,
  setTerminalLaunchContext,
  storeClearTerminalLaunchContext,
}: {
  activeProjectCwd: string | null;
  activeThreadId: ThreadId | null;
  activeThreadRef: ScopedThreadRef | null;
  activeThreadWorktreePath: string | null;
  setTerminalLaunchContext: Dispatch<SetStateAction<TerminalLaunchContext | null>>;
  storeClearTerminalLaunchContext: (threadRef: ScopedThreadRef) => void;
}) {
  useMountEffect(() => {
    if (!activeThreadId || !activeProjectCwd) {
      return;
    }
    setTerminalLaunchContext((current) => {
      if (!current || current.threadId !== activeThreadId) {
        return current;
      }
      const settledCwd = projectScriptCwd({
        project: { cwd: activeProjectCwd },
        worktreePath: activeThreadWorktreePath,
      });
      if (settledCwd === current.cwd && activeThreadWorktreePath === current.worktreePath) {
        if (activeThreadRef) {
          storeClearTerminalLaunchContext(activeThreadRef);
        }
        return null;
      }
      return current;
    });
  });

  return null;
}

export function TerminalLaunchStoredSettledSync({
  activeProjectCwd,
  activeThreadId,
  activeThreadRef,
  activeThreadWorktreePath,
  storeClearTerminalLaunchContext,
  storeServerTerminalLaunchContext,
}: {
  activeProjectCwd: string | null;
  activeThreadId: ThreadId | null;
  activeThreadRef: ScopedThreadRef | null;
  activeThreadWorktreePath: string | null;
  storeClearTerminalLaunchContext: (threadRef: ScopedThreadRef) => void;
  storeServerTerminalLaunchContext: ThreadTerminalLaunchContext | null;
}) {
  useMountEffect(() => {
    if (!activeThreadId || !activeProjectCwd || !storeServerTerminalLaunchContext) {
      return;
    }
    const settledCwd = projectScriptCwd({
      project: { cwd: activeProjectCwd },
      worktreePath: activeThreadWorktreePath,
    });
    if (
      settledCwd === storeServerTerminalLaunchContext.cwd &&
      activeThreadWorktreePath === storeServerTerminalLaunchContext.worktreePath
    ) {
      if (activeThreadRef) {
        storeClearTerminalLaunchContext(activeThreadRef);
      }
    }
  });

  return null;
}

export function TerminalLaunchClosedSync({
  activeThreadId,
  activeThreadRef,
  setTerminalLaunchContext,
  storeClearTerminalLaunchContext,
  terminalOpen,
}: {
  activeThreadId: ThreadId | null;
  activeThreadRef: ScopedThreadRef | null;
  setTerminalLaunchContext: Dispatch<SetStateAction<TerminalLaunchContext | null>>;
  storeClearTerminalLaunchContext: (threadRef: ScopedThreadRef) => void;
  terminalOpen: boolean;
}) {
  useMountEffect(() => {
    if (terminalOpen) {
      return;
    }
    if (activeThreadRef) {
      storeClearTerminalLaunchContext(activeThreadRef);
    }
    setTerminalLaunchContext((current) => (current?.threadId === activeThreadId ? null : current));
  });

  return null;
}

export function TerminalOpenFocusSync({
  activeThreadKey,
  focusComposer,
  setTerminalFocusRequestId,
  terminalOpen,
  terminalOpenByThreadRef,
}: {
  activeThreadKey: string | null;
  focusComposer: () => void;
  setTerminalFocusRequestId: Dispatch<SetStateAction<number>>;
  terminalOpen: boolean;
  terminalOpenByThreadRef: RefObject<Record<string, boolean>>;
}) {
  useMountEffect(() => {
    if (!activeThreadKey) return;
    const previous = terminalOpenByThreadRef.current[activeThreadKey] ?? false;
    const current = terminalOpen;

    if (!previous && current) {
      terminalOpenByThreadRef.current[activeThreadKey] = current;
      setTerminalFocusRequestId((value) => value + 1);
      return;
    } else if (previous && !current) {
      terminalOpenByThreadRef.current[activeThreadKey] = current;
      const frame = window.requestAnimationFrame(() => {
        focusComposer();
      });
      return () => {
        window.cancelAnimationFrame(frame);
      };
    }

    terminalOpenByThreadRef.current[activeThreadKey] = current;
  });

  return null;
}

export function ChatViewKeyboardShortcutsSync({
  activeProjectScripts,
  activeThreadId,
  closeTerminal,
  createNewTerminal,
  keybindings,
  runProjectScript,
  setTerminalOpen,
  splitTerminal,
  terminalActiveTerminalId,
  terminalOpen,
  toggleTerminalVisibility,
}: {
  activeProjectScripts: readonly ProjectScript[] | null;
  activeThreadId: ThreadId | null;
  closeTerminal: (terminalId: string) => void;
  createNewTerminal: () => void;
  keybindings: ResolvedKeybindingsConfig;
  runProjectScript: (script: ProjectScript) => void | Promise<void>;
  setTerminalOpen: (open: boolean) => void;
  splitTerminal: () => void;
  terminalActiveTerminalId: string;
  terminalOpen: boolean;
  toggleTerminalVisibility: () => void;
}) {
  useMountEffect(() => {
    const handler = (event: globalThis.KeyboardEvent) => {
      if (!activeThreadId || useCommandPaletteStore.getState().open || event.defaultPrevented) {
        return;
      }
      const shortcutContext = {
        terminalFocus: isTerminalFocused(),
        terminalOpen,
      };

      const command = resolveShortcutCommand(event, keybindings, {
        context: shortcutContext,
      });
      if (!command) return;

      if (command === "terminal.toggle") {
        event.preventDefault();
        event.stopPropagation();
        toggleTerminalVisibility();
        return;
      }

      if (command === "terminal.split") {
        event.preventDefault();
        event.stopPropagation();
        if (!terminalOpen) {
          setTerminalOpen(true);
        }
        splitTerminal();
        return;
      }

      if (command === "terminal.close") {
        event.preventDefault();
        event.stopPropagation();
        if (!terminalOpen) return;
        closeTerminal(terminalActiveTerminalId);
        return;
      }

      if (command === "terminal.new") {
        event.preventDefault();
        event.stopPropagation();
        if (!terminalOpen) {
          setTerminalOpen(true);
        }
        createNewTerminal();
        return;
      }

      const scriptId = projectScriptIdFromCommand(command);
      if (!scriptId || !activeProjectScripts) return;
      const script = activeProjectScripts.find((entry) => entry.id === scriptId);
      if (!script) return;
      event.preventDefault();
      event.stopPropagation();
      void runProjectScript(script);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });

  return null;
}
