import {
  type AgentWindowSendWhileStreamingBehavior,
  MessageId,
  type OrchestrationProposedPlanId,
  ThreadId,
  type AgentInteractionMode,
} from "@multi/contracts";
import { Button } from "@multi/ui/button";
import { Text } from "@multi/ui/text";
import { Textarea } from "@multi/ui/textarea";
import { useRef, useState } from "react";

import {
  QueuedComposerEditBanner,
  QueuedComposerItemsPanel,
} from "~/components/chat/composer/queue/queued-items-panel";
import { ChatMessageBubble, MessageMeta } from "~/components/chat/message/message-surface";
import { useMountEffect } from "~/hooks/use-mount-effect";
import { syncAppearanceVibrancy } from "~/lib/appearance-settings";
import { cn } from "~/lib/utils";
import type { QueuedComposerItem } from "~/stores/chat-send-queue";
import { DEFAULT_INTERACTION_MODE } from "~/types";

const DEMO_THREAD_KEY = "dev:queued-message-demo";
const DEMO_IMAGE_PREVIEW =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='96' height='96' viewBox='0 0 96 96'%3E%3Crect width='96' height='96' rx='16' fill='%23242a38'/%3E%3Cpath d='M18 68 38 44l13 15 9-11 18 20H18Z' fill='%2391c7ff'/%3E%3Ccircle cx='67' cy='30' r='9' fill='%23ffd27a'/%3E%3C/svg%3E";

const INTERACTION_MODE_OPTIONS = [
  { mode: "agent", label: "Build" },
  { mode: "ask", label: "Ask" },
  { mode: "plan", label: "Plan" },
] as const satisfies readonly { mode: AgentInteractionMode; label: string }[];

const SEND_WHILE_RUNNING_OPTIONS = [
  { mode: "queue", label: "Queue" },
  { mode: "stop-and-send", label: "Stop and send" },
  { mode: "send", label: "Send immediately" },
] as const satisfies readonly { mode: AgentWindowSendWhileStreamingBehavior; label: string }[];

const DEBUG_RESPONSE_SEQUENCE = [
  "Captured locally. No runtime request was started.",
  "Stored as a faux assistant response for queue layout inspection.",
  "Recorded with the selected message mode for visual debugging.",
] as const;

type DemoTranscriptRole = "user" | "assistant" | "queued" | "steer";

type DemoTranscriptEntry = {
  id: string;
  role: DemoTranscriptRole;
  text: string;
  interactionMode: AgentInteractionMode;
  createdAt: string;
};

function createDemoFile(): File {
  if (typeof File !== "undefined") {
    return new File(["demo"], "queue-preview.svg", { type: "image/svg+xml" });
  }
  return { name: "queue-preview.svg", size: 4, type: "image/svg+xml" } as File;
}

function formatInteractionModeLabel(mode: AgentInteractionMode): string {
  return INTERACTION_MODE_OPTIONS.find((option) => option.mode === mode)?.label ?? mode;
}

function formatSendWhileRunningBehaviorLabel(mode: AgentWindowSendWhileStreamingBehavior): string {
  return SEND_WHILE_RUNNING_OPTIONS.find((option) => option.mode === mode)?.label ?? mode;
}

function formatModeLabel(mode: AgentInteractionMode): string {
  return formatInteractionModeLabel(mode);
}

function createDemoQueueItem(input: {
  id: string;
  prompt: string;
  interactionMode?: AgentInteractionMode;
  images?: boolean;
  planFollowUp?: boolean;
  createdAtOffsetMs?: number;
}): QueuedComposerItem {
  return {
    id: MessageId.make(input.id),
    threadKey: DEMO_THREAD_KEY,
    interactionMode: input.interactionMode ?? DEFAULT_INTERACTION_MODE,
    createdAt: new Date(Date.now() - (input.createdAtOffsetMs ?? 60_000)).toISOString(),
    planFollowUp: input.planFollowUp
      ? {
          planId: "demo-plan" as OrchestrationProposedPlanId,
          planThreadId: ThreadId.make("demo-plan-thread"),
          planMarkdown: "1. Tighten queue panel spacing\n2. Preserve composer placement",
        }
      : null,
    sendContext: {
      prompt: input.prompt,
      images: input.images
        ? [
            {
              type: "image",
              id: "demo-image",
              name: "queue-preview.svg",
              mimeType: "image/svg+xml",
              sizeBytes: 512,
              previewUrl: DEMO_IMAGE_PREVIEW,
              file: createDemoFile(),
            },
          ]
        : [],
    },
  };
}

function createInitialQueueItems(): QueuedComposerItem[] {
  return [
    createDemoQueueItem({
      id: "demo-queued-1",
      prompt: "Tighten the queue tray spacing and keep the next follow-up easy to scan.",
      interactionMode: "agent",
      createdAtOffsetMs: 180_000,
    }),
    createDemoQueueItem({
      id: "demo-queued-2",
      prompt:
        "Long queued plan-mode message with enough text to verify truncation, hover actions, narrow widths, and stable row height while the panel stays above the composer.",
      interactionMode: "plan",
      planFollowUp: true,
      createdAtOffsetMs: 120_000,
    }),
    createDemoQueueItem({
      id: "demo-queued-3",
      prompt: "Ask a clarifying question while an image-only follow-up is queued.",
      interactionMode: "ask",
      images: true,
      createdAtOffsetMs: 60_000,
    }),
  ];
}

function createInitialTranscriptEntries(): DemoTranscriptEntry[] {
  return [
    {
      id: "transcript-1",
      role: "user",
      text: "Can you make the queued follow-up panel easier to evaluate?",
      interactionMode: "agent",
      createdAt: new Date(Date.now() - 240_000).toISOString(),
    },
    {
      id: "transcript-2",
      role: "assistant",
      text: "I am checking tray placement, row density, edit state, and all queued message modes without touching the real runtime send path.",
      interactionMode: "agent",
      createdAt: new Date(Date.now() - 180_000).toISOString(),
    },
    {
      id: "transcript-3",
      role: "user",
      text: "Queue these follow-ups while the current turn is in progress.",
      interactionMode: "ask",
      createdAt: new Date(Date.now() - 120_000).toISOString(),
    },
  ];
}

function reorderItems(
  items: QueuedComposerItem[],
  itemId: MessageId,
  targetItemId: MessageId | null,
  insertAfter: boolean,
): QueuedComposerItem[] {
  const sourceIndex = items.findIndex((item) => item.id === itemId);
  if (sourceIndex === -1) {
    return items;
  }
  const movingItem = items[sourceIndex];
  if (!movingItem) {
    return items;
  }
  const withoutMoving = items.filter((item) => item.id !== itemId);
  const targetIndex = targetItemId
    ? withoutMoving.findIndex((item) => item.id === targetItemId)
    : withoutMoving.length;
  const insertIndex =
    targetIndex === -1 ? withoutMoving.length : targetIndex + (insertAfter ? 1 : 0);
  const next = [...withoutMoving];
  next.splice(insertIndex, 0, movingItem);
  return next;
}

function formatQueuedItemDebugText(item: QueuedComposerItem): string {
  const prompt = item.sendContext.prompt.trim();
  if (prompt.length > 0) {
    return prompt;
  }
  const imageName = item.sendContext.images[0]?.name;
  return imageName ? `${imageName} attached` : "Queued message";
}

function DemoModeButtonGroup<
  TMode extends AgentInteractionMode | AgentWindowSendWhileStreamingBehavior,
>(props: {
  label: string;
  options: readonly { mode: TMode; label: string }[];
  value: TMode;
  onChange: (mode: TMode) => void;
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
      <span className="mr-0.5 text-detail text-multi-fg-tertiary">{props.label}</span>
      {props.options.map((option) => (
        <Button
          key={option.mode}
          type="button"
          variant={props.value === option.mode ? "default" : "outline"}
          size="sm"
          onClick={() => props.onChange(option.mode)}
        >
          {option.label}
        </Button>
      ))}
    </div>
  );
}

function DemoTranscriptEntry(props: { entry: DemoTranscriptEntry }) {
  const modeLabel = formatModeLabel(props.entry.interactionMode);

  if (props.entry.role === "user") {
    return (
      <ChatMessageBubble
        messageRole="user"
        body={
          <>
            {props.entry.text}
            <MessageMeta>{modeLabel}</MessageMeta>
          </>
        }
      />
    );
  }

  if (props.entry.role === "assistant") {
    return (
      <div className="box-border flex w-full min-w-0 pt-(--chat-timeline-assistant-top-inset)">
        <ChatMessageBubble
          messageRole="assistant"
          body={
            <>
              {props.entry.text}
              <MessageMeta>{modeLabel}</MessageMeta>
            </>
          }
        />
      </div>
    );
  }

  return (
    <p className="m-0 px-1 text-center text-caption text-multi-fg-tertiary/55">
      {props.entry.role === "steer" ? "Steered" : "Queued"}: {props.entry.text} ({modeLabel})
    </p>
  );
}

export function QueuedMessageDemoPage() {
  useMountEffect(() => {
    const previousGlassMode = document.body.getAttribute("data-multi-glass-mode");
    document.body.setAttribute("data-multi-glass-mode", "true");
    syncAppearanceVibrancy();
    return () => {
      if (previousGlassMode === null) {
        document.body.removeAttribute("data-multi-glass-mode");
      } else {
        document.body.setAttribute("data-multi-glass-mode", previousGlassMode);
      }
      syncAppearanceVibrancy();
    };
  });

  const nextDebugIdRef = useRef(4);
  const [items, setItems] = useState<QueuedComposerItem[]>(() => createInitialQueueItems());
  const [transcriptEntries, setTranscriptEntries] = useState<DemoTranscriptEntry[]>(() =>
    createInitialTranscriptEntries(),
  );
  const [expanded, setExpanded] = useState(true);
  const [editingItemId, setEditingItemId] = useState<MessageId | null>(null);
  const [busy, setBusy] = useState(false);
  const [pendingApproval, setPendingApproval] = useState(false);
  const [pendingUserInput, setPendingUserInput] = useState(false);
  const [compact, setCompact] = useState(true);
  const [inlineEdit, setInlineEdit] = useState(false);
  const [interactionMode, setInteractionMode] =
    useState<AgentInteractionMode>(DEFAULT_INTERACTION_MODE);
  const [sendWhileRunningBehavior, setSendWhileRunningBehavior] =
    useState<AgentWindowSendWhileStreamingBehavior>("queue");
  const [draftPrompt, setDraftPrompt] = useState(
    "Check the queue panel in this message mode without starting a runtime request.",
  );
  const [debugResponseIndex, setDebugResponseIndex] = useState(0);

  const showQueue = items.length > 0 && !pendingApproval && !pendingUserInput && !inlineEdit;
  const composerVariant = compact ? "compact" : "expanded";
  const composerExpanded = !compact || draftPrompt.includes("\n") || draftPrompt.length > 96;
  const editingItem = items.find((item) => item.id === editingItemId) ?? null;
  const toggles: Array<{
    label: string;
    value: boolean;
    setValue: (next: boolean) => void;
  }> = [
    { label: "running", value: busy, setValue: setBusy },
    { label: "approval", value: pendingApproval, setValue: setPendingApproval },
    { label: "question", value: pendingUserInput, setValue: setPendingUserInput },
    { label: "compact", value: compact, setValue: setCompact },
    { label: "inline edit", value: inlineEdit, setValue: setInlineEdit },
  ];

  const createDebugId = (prefix: string) => {
    const id = `${prefix}-${nextDebugIdRef.current}`;
    nextDebugIdRef.current += 1;
    return id;
  };

  const appendQueuedDebugEntry = (
    text: string,
    entryInteractionMode: AgentInteractionMode,
  ) => {
    const entry = {
      id: createDebugId("queued-transcript"),
      role: "queued",
      text,
      interactionMode: entryInteractionMode,
      createdAt: new Date().toISOString(),
    } satisfies DemoTranscriptEntry;
    setTranscriptEntries((existing) => [...existing, entry].slice(-18));
  };

  const appendSteerDebugEntry = (
    text: string,
    entryInteractionMode: AgentInteractionMode,
  ) => {
    const entry = {
      id: createDebugId("steer-transcript"),
      role: "steer",
      text,
      interactionMode: entryInteractionMode,
      createdAt: new Date().toISOString(),
    } satisfies DemoTranscriptEntry;
    setTranscriptEntries((existing) => [...existing, entry].slice(-18));
  };

  const appendCapturedSend = (
    text: string,
    entryInteractionMode: AgentInteractionMode,
  ) => {
    const responseText =
      DEBUG_RESPONSE_SEQUENCE[debugResponseIndex % DEBUG_RESPONSE_SEQUENCE.length] ??
      DEBUG_RESPONSE_SEQUENCE[0];
    const createdAt = new Date().toISOString();
    const userEntry = {
      id: createDebugId("user-transcript"),
      role: "user",
      text,
      interactionMode: entryInteractionMode,
      createdAt,
    } satisfies DemoTranscriptEntry;
    const assistantEntry = {
      id: createDebugId("assistant-transcript"),
      role: "assistant",
      text: responseText,
      interactionMode: entryInteractionMode,
      createdAt,
    } satisfies DemoTranscriptEntry;
    setTranscriptEntries((existing) => [...existing, userEntry, assistantEntry].slice(-18));
    setDebugResponseIndex((index) => index + 1);
  };

  const queueDraft = (prompt: string, source: "queue" | "stop-and-send" = "queue") => {
    const item = createDemoQueueItem({
      id: createDebugId("demo-queued"),
      prompt,
      interactionMode,
    });
    setItems((existing) => [...existing, item]);
    setExpanded(true);
    appendQueuedDebugEntry(
      source === "stop-and-send" ? `Stopped and queued: ${prompt}` : `Queued message: ${prompt}`,
      interactionMode,
    );
  };

  const beginEditingQueuedItem = (itemId: MessageId) => {
    const item = items.find((candidate) => candidate.id === itemId);
    if (!item) {
      return;
    }
    setEditingItemId(itemId);
    setDraftPrompt(item.sendContext.prompt);
  };

  const cancelEditingQueuedItem = () => {
    setEditingItemId(null);
    setDraftPrompt("");
  };

  const saveEditingQueuedItem = () => {
    const item = editingItem;
    const prompt = draftPrompt.trim();
    if (!item || prompt.length === 0) {
      return;
    }
    setItems((existing) =>
      existing.map((candidate) =>
        candidate.id === item.id
          ? {
              ...candidate,
              sendContext: {
                ...candidate.sendContext,
                prompt,
              },
            }
          : candidate,
      ),
    );
    appendQueuedDebugEntry(`Saved queued message: ${prompt}`, item.interactionMode);
    setEditingItemId(null);
    setDraftPrompt("");
  };

  const captureDraft = (action: "queue" | "primary") => {
    const prompt = draftPrompt.trim();
    if (prompt.length === 0) {
      return;
    }
    if (editingItem) {
      if (action === "primary") {
        saveEditingQueuedItem();
      }
      return;
    }
    if (action === "queue") {
      queueDraft(prompt);
    } else if (!busy) {
      appendCapturedSend(prompt, interactionMode);
    } else if (sendWhileRunningBehavior === "queue") {
      queueDraft(prompt);
    } else if (sendWhileRunningBehavior === "stop-and-send") {
      queueDraft(prompt, "stop-and-send");
      setBusy(false);
    } else {
      appendSteerDebugEntry(`Steered active turn: ${prompt}`, interactionMode);
    }
    setDraftPrompt("");
  };

  const captureQueuedItem = (item: QueuedComposerItem) => {
    appendCapturedSend(formatQueuedItemDebugText(item), item.interactionMode);
  };

  const removeQueuedItem = (itemId: MessageId) => {
    setItems((existing) => existing.filter((item) => item.id !== itemId));
    setEditingItemId((existing) => (existing === itemId ? null : existing));
  };

  const drainNextQueuedItem = () => {
    const nextItem = items[0];
    if (!nextItem) {
      return;
    }
    captureQueuedItem(nextItem);
    removeQueuedItem(nextItem.id);
  };

  const primaryDraftActionLabel = busy
    ? sendWhileRunningBehavior === "queue"
      ? "Queue message"
      : formatSendWhileRunningBehaviorLabel(sendWhileRunningBehavior)
    : "Send message";

  return (
    <div
      className="flex h-full min-h-svh flex-1 flex-col bg-(--multi-chat-surface-background,var(--multi-color-chat))"
      data-component="root"
    >
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="border-b border-multi-stroke-tertiary px-4 py-3">
          <div className="mx-auto flex w-full max-w-agent-chat flex-wrap items-center gap-2">
            <Text render={<h1 />} size="lg" tone="primary" weight="medium">
              Queued Message Demo
            </Text>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              {toggles.map((toggle) => (
                <Button
                  key={toggle.label}
                  type="button"
                  variant={toggle.value ? "default" : "outline"}
                  size="sm"
                  onClick={() => toggle.setValue(!toggle.value)}
                >
                  {toggle.label}
                </Button>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={drainNextQueuedItem}>
                Drain next
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setItems(createInitialQueueItems());
                  setTranscriptEntries(createInitialTranscriptEntries());
                  setEditingItemId(null);
                  setExpanded(true);
                  setBusy(false);
                  setPendingApproval(false);
                  setPendingUserInput(false);
                  setCompact(true);
                  setInlineEdit(false);
                  setInteractionMode(DEFAULT_INTERACTION_MODE);
                  setSendWhileRunningBehavior("queue");
                  setDraftPrompt(
                    "Check the queue panel in this message mode without starting a runtime request.",
                  );
                }}
              >
                Reset
              </Button>
            </div>
          </div>
          <div className="mx-auto mt-3 flex w-full max-w-agent-chat flex-wrap items-center gap-x-5 gap-y-2">
            <DemoModeButtonGroup
              label="Interaction"
              options={INTERACTION_MODE_OPTIONS}
              value={interactionMode}
              onChange={setInteractionMode}
            />
            <DemoModeButtonGroup
              label="While running"
              options={SEND_WHILE_RUNNING_OPTIONS}
              value={sendWhileRunningBehavior}
              onChange={setSendWhileRunningBehavior}
            />
          </div>
        </div>
        <div className="relative min-h-0 flex-1 overflow-hidden">
          <div className="absolute inset-0 overflow-y-auto px-4 pt-(--chat-timeline-padding-block-start) pb-36">
            <div className="mx-auto flex w-full max-w-agent-chat flex-col">
              {transcriptEntries.map((entry) => (
                <div key={entry.id} className="pb-(--chat-timeline-row-gap)">
                  <DemoTranscriptEntry entry={entry} />
                </div>
              ))}
            </div>
          </div>
          <div className="pointer-events-auto absolute inset-x-0 bottom-0 isolate z-30 px-4 pb-4 before:pointer-events-none before:absolute before:bottom-[-12px] before:left-1/2 before:top-1/2 before:z-0 before:-ml-[50vw] before:w-screen before:bg-(--multi-chat-surface-background) after:pointer-events-none after:absolute after:bottom-1/2 after:left-1/2 after:z-0 after:-ml-[50vw] after:h-6 after:w-screen after:bg-[linear-gradient(to_top,var(--multi-chat-surface-background),transparent)]">
            <div className="relative z-1 mx-auto flex w-full max-w-agent-chat flex-col gap-2">
              {showQueue ? (
                <QueuedComposerItemsPanel
                  items={items}
                  editingItemId={editingItemId}
                  isBusy={busy}
                  compact={compact}
                  expanded={expanded}
                  onExpandedChange={setExpanded}
                  onBeginEdit={beginEditingQueuedItem}
                  onRemove={removeQueuedItem}
                  onSendNow={(itemId) => {
                    const item = items.find((candidate) => candidate.id === itemId);
                    if (item) {
                      captureQueuedItem(item);
                    }
                    removeQueuedItem(itemId);
                  }}
                  onReorder={(itemId, targetItemId, insertAfter) =>
                    setItems((existing) =>
                      reorderItems(existing, itemId, targetItemId, insertAfter),
                    )
                  }
                />
              ) : null}
              <div
                className={cn(
                  "group relative w-full max-w-full min-w-0 cursor-text overflow-hidden",
                  inlineEdit && "rounded-xl",
                )}
                data-has-header={editingItem ? "" : undefined}
                data-layout={inlineEdit ? "inline-edit" : undefined}
                data-multi-composer-surface=""
                data-expanded={composerExpanded ? "" : undefined}
                data-variant={composerVariant}
              >
                {editingItem ? (
                  <QueuedComposerEditBanner onCancelEdit={cancelEditingQueuedItem} />
                ) : null}
                <div
                  className={cn(
                    "relative z-[1] min-w-0 rounded-[inherit]",
                    inlineEdit ? "flex flex-col" : "",
                  )}
                  data-multi-composer-shell={inlineEdit ? undefined : "thread"}
                  {...(composerExpanded && !inlineEdit ? { "data-expanded": "" } : {})}
                >
                  <div
                    className={cn(
                      "block w-full overflow-y-auto whitespace-pre-wrap break-words bg-transparent px-3 py-2 text-conversation text-foreground outline-hidden",
                      compact && !composerExpanded
                        ? "min-h-[var(--multi-composer-editor-min-height)] max-h-none pl-1 [&>p]:leading-[1.5]"
                        : "min-h-[var(--multi-composer-editor-min-height)] max-h-[200px] [&>p]:leading-[1.5]",
                    )}
                  >
                    <Textarea
                      unstyled
                      value={draftPrompt}
                      onChange={(event) => setDraftPrompt(event.currentTarget.value)}
                      aria-label="Debug message"
                      className="w-full"
                    />
                  </div>
                  <div
                    className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
                    data-chat-input-footer="true"
                    data-multi-composer-toolbar="bottom"
                  >
                    <div className="text-detail text-multi-fg-tertiary">
                      {busy
                        ? `Running · ${formatSendWhileRunningBehaviorLabel(sendWhileRunningBehavior)}`
                        : "Ready"}{" "}
                      · {formatModeLabel(interactionMode)}
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => captureDraft("queue")}
                        disabled={draftPrompt.trim().length === 0 || editingItem !== null}
                      >
                        Queue
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => captureDraft("primary")}
                        disabled={draftPrompt.trim().length === 0}
                      >
                        {editingItem ? "Save queued message" : primaryDraftActionLabel}
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
