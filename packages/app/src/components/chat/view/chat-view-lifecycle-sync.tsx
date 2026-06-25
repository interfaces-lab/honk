import {
  type AgentInteractionMode,
  type EnvironmentId,
  type MessageId,
  type ModelSelection,
  type ProjectScript,
  type ResolvedKeybindingsConfig,
  type ThreadId,
} from "@honk/contracts";
import { scopedThreadKey, scopeThreadRef } from "~/lib/environment-scope";
import type { Dispatch, RefObject, SetStateAction } from "react";

import { retainThreadDetailSubscription } from "../../../environments/runtime/service";
import { useMountEffect } from "~/hooks/use-mount-effect";
import { isTerminalFocused } from "../../../lib/terminal-focus";
import { projectScriptIdFromCommand } from "~/lib/project-scripts";
import { interactionModeFromKeybindingCommand, resolveShortcutCommand } from "../../../keybindings";
import {
  cycleFocusedComposerInteractionMode,
  hasFocusedComposerInteractionModeTarget,
  setFocusedComposerInteractionMode,
} from "../composer/interaction-mode-target";
import { useCommandPaletteStore } from "../../../stores/ui/command-palette-store";
import type { ChatMessage, ThreadSendIntent } from "../../../types";
import { type ExpandedImagePreview } from "../message/expanded-image-preview";
import {
  collectUserMessageBlobPreviewUrls,
  revokeUserMessagePreviewUrls,
} from "../message/preview-url-lifecycle";
import { type PullRequestDialogState } from "./thread-lifecycle";
import {
  acknowledgedThreadSendIntents,
  threadSendIntentMessages,
} from "./thread-timeline-projector";
import { readHonkRuntimeApi } from "../../../lib/honk-runtime-api";
import { hydrateRuntimeThread } from "../../../lib/runtime-turn-dispatch";
import { readLocalFeatureFlags } from "~/stores/local-feature-flags";

const RUNTIME_HYDRATION_IDLE_TIMEOUT_MS = 1200;
const RUNTIME_THREAD_FOCUS_RELEASE_DELAY_MS = 100;

interface RuntimeThreadFocusRecord {
  count: number;
  focused: boolean;
  releaseTimeoutId: number | null;
}

interface RuntimeThreadFocusRegistry {
  records: Map<ThreadId, RuntimeThreadFocusRecord>;
}

type WindowWithRuntimeThreadFocusRegistry = Window & {
  __honkRuntimeThreadFocusRegistry?: RuntimeThreadFocusRegistry;
};

/**
 * Lifecycle effect components used by `ChatView`. Each component runs a single
 * `useMountEffect` driven by the active thread key, so swapping threads or
 * route kinds resets the effect cleanly. The components return `null` and only
 * exist to scope effects under a keyed identity.
 */

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
  modelSelection,
  routeKind,
  threadId,
  isDraftBoundThread = false,
}: {
  cwd: string | null | undefined;
  interactionMode: AgentInteractionMode;
  modelSelection: ModelSelection;
  routeKind: "server" | "draft";
  threadId: ThreadId;
  isDraftBoundThread?: boolean;
}) {
  useMountEffect(() => {
    const releaseRuntimeThreadFocus = acquireRuntimeThreadFocus(threadId);

    if (routeKind !== "server" || !cwd || isDraftBoundThread) {
      return () => {
        releaseRuntimeThreadFocus();
      };
    }
    const cancelHydration = scheduleRuntimeHydrationAfterFirstPaint(() => {
      void hydrateRuntimeThread({
        threadId,
        cwd,
        interactionMode,
        modelSelection,
      }).catch(() => undefined);
    });
    return () => {
      cancelHydration();
      releaseRuntimeThreadFocus();
    };
  });

  return null;
}

function getRuntimeThreadFocusRegistry(): RuntimeThreadFocusRegistry {
  const targetWindow = window as WindowWithRuntimeThreadFocusRegistry;
  targetWindow.__honkRuntimeThreadFocusRegistry ??= {
    records: new Map(),
  };
  return targetWindow.__honkRuntimeThreadFocusRegistry;
}

function acquireRuntimeThreadFocus(threadId: ThreadId): () => void {
  const registry = getRuntimeThreadFocusRegistry();
  let record = registry.records.get(threadId);
  if (!record) {
    record = {
      count: 0,
      focused: false,
      releaseTimeoutId: null,
    };
    registry.records.set(threadId, record);
  }

  if (record.releaseTimeoutId !== null) {
    window.clearTimeout(record.releaseTimeoutId);
    record.releaseTimeoutId = null;
  }

  record.count += 1;
  if (!record.focused) {
    record.focused = true;
    publishRuntimeThreadFocus(threadId, true);
  }

  return () => {
    releaseRuntimeThreadFocus(registry, threadId);
  };
}

function releaseRuntimeThreadFocus(registry: RuntimeThreadFocusRegistry, threadId: ThreadId): void {
  const record = registry.records.get(threadId);
  if (!record) {
    return;
  }

  record.count = Math.max(0, record.count - 1);
  if (record.count > 0 || record.releaseTimeoutId !== null) {
    return;
  }

  record.releaseTimeoutId = window.setTimeout(() => {
    record.releaseTimeoutId = null;
    if (record.count > 0) {
      return;
    }

    registry.records.delete(threadId);
    if (record.focused) {
      record.focused = false;
      publishRuntimeThreadFocus(threadId, false);
    }
  }, RUNTIME_THREAD_FOCUS_RELEASE_DELAY_MS);
}

function publishRuntimeThreadFocus(threadId: ThreadId, focused: boolean): void {
  try {
    void readHonkRuntimeApi()
      .setThreadFocus({ threadId, focused })
      .catch(() => undefined);
  } catch {
    return;
  }
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
}: {
  activeThreadId: ThreadId | null;
  focusComposer: () => void;
}) {
  useMountEffect(() => {
    if (!activeThreadId) return;
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

export function ChatViewKeyboardShortcutsSync({
  activeProjectScripts,
  activeThreadId,
  keybindings,
  runProjectScript,
}: {
  activeProjectScripts: readonly ProjectScript[] | null;
  activeThreadId: ThreadId | null;
  keybindings: ResolvedKeybindingsConfig;
  runProjectScript: (script: ProjectScript) => void | Promise<void>;
}) {
  useMountEffect(() => {
    const handler = (event: globalThis.KeyboardEvent) => {
      if (!activeThreadId || useCommandPaletteStore.getState().open || event.defaultPrevented) {
        return;
      }
      const shortcutContext = {
        composerFocus: hasFocusedComposerInteractionModeTarget(),
        terminalFocus: isTerminalFocused(),
        terminalOpen: false,
      };

      const command = resolveShortcutCommand(event, keybindings, {
        context: shortcutContext,
      });
      if (!command) return;

      if (command === "composer.cycleInteractionMode") {
        event.preventDefault();
        event.stopPropagation();
        cycleFocusedComposerInteractionMode({ focusMode: "preserve" });
        return;
      }

      const interactionModeCommand = interactionModeFromKeybindingCommand(command);
      if (interactionModeCommand) {
        if (
          interactionModeCommand === "multitask" &&
          !readLocalFeatureFlags().multitaskModeEnabled
        ) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        setFocusedComposerInteractionMode(interactionModeCommand, { focusMode: "preserve" });
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
