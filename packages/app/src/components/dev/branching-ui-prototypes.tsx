import { IconArrowRight, IconChevronDownSmall } from "central-icons";
import { AnimatePresence, motion } from "motion/react";
import { type RefObject, useRef, useState } from "react";

import { Text } from "@multi/ui/text";
import { useMountEffect } from "~/hooks/use-mount-effect";
import { cn } from "~/lib/utils";

/**
 * Conversation minimap — filmstrip flow demo.
 *
 * VS Code-style rail on the right edge only. Chat is readable; the filmstrip
 * drives the full user flow: jump, fork preview, continue, back.
 */

interface MockEntry {
  readonly id: string;
  readonly parentId: string | null;
  readonly role: "user" | "assistant";
  readonly text: string;
  readonly label?: string;
}

interface Branch {
  readonly id: BranchId;
  readonly label: string;
  readonly entries: readonly string[];
}

type BranchId = "technical" | "marketing" | "tweet";

type SegmentKind = "trunk" | "fork" | "continuation";

interface MinimapSegment {
  readonly id: string;
  readonly entry: MockEntry;
  readonly branchId: BranchId | null;
  readonly kind: SegmentKind;
  readonly isActivePath: boolean;
}

const TRUNK_IDS = ["m1", "m2", "m3", "m4"] as const;

const ENTRIES: Record<string, MockEntry> = {
  m1: {
    id: "m1",
    parentId: null,
    role: "user",
    text: "Help me write a release blurb for the threading model rework.",
  },
  m2: {
    id: "m2",
    parentId: "m1",
    role: "assistant",
    text: "Sure — what tone are you going for, and how long should it be?",
  },
  m3: {
    id: "m3",
    parentId: "m2",
    role: "user",
    text: "Something I can ship in the changelog and on social.",
  },
  m4: {
    id: "m4",
    parentId: "m3",
    role: "assistant",
    text: "Got it. Want one version or a few directions to pick from?",
  },
  m5a: {
    id: "m5a",
    parentId: "m4",
    role: "user",
    text: "Short and technical. Two sentences max.",
    label: "technical",
  },
  m6a: {
    id: "m6a",
    parentId: "m5a",
    role: "assistant",
    text: "Threads are now a tree of entries with explicit parents. The active branch drives chat; alternatives live alongside without rewriting history.",
  },
  m7a: {
    id: "m7a",
    parentId: "m6a",
    role: "user",
    text: "Add one line about migration from linear threads.",
  },
  m8a: {
    id: "m8a",
    parentId: "m7a",
    role: "assistant",
    text: "Existing conversations import as a single trunk — fork points appear wherever you retry a message.",
  },
  m5b: {
    id: "m5b",
    parentId: "m4",
    role: "user",
    text: "Marketing voice — make it sound exciting.",
    label: "marketing",
  },
  m6b: {
    id: "m6b",
    parentId: "m5b",
    role: "assistant",
    text: "Threading just got a glow-up. Every reply lives on the timeline, ready to be revisited or rewritten without losing a beat.",
  },
  m7b: {
    id: "m7b",
    parentId: "m6b",
    role: "user",
    text: "Less hype, more clarity. Still upbeat.",
  },
  m8b: {
    id: "m8b",
    parentId: "m7b",
    role: "assistant",
    text: "Branch anywhere, keep every attempt, and return to the path that worked — no copy-paste archaeology.",
  },
  m5c: {
    id: "m5c",
    parentId: "m4",
    role: "user",
    text: "Make it a tweet.",
    label: "tweet",
  },
  m6c: {
    id: "m6c",
    parentId: "m5c",
    role: "assistant",
    text: "Threads are trees now. Rewind anywhere, retry anything, keep everything.",
  },
  m7c: {
    id: "m7c",
    parentId: "m6c",
    role: "user",
    text: "Under 240 characters.",
  },
  m8c: {
    id: "m8c",
    parentId: "m7c",
    role: "assistant",
    text: "Your chat is a tree. Retry a message without losing the rest. Ship the branch that wins.",
  },
};

const BRANCHES: readonly Branch[] = [
  { id: "technical", label: "Technical", entries: ["m5a", "m6a", "m7a", "m8a"] },
  { id: "marketing", label: "Marketing", entries: ["m5b", "m6b", "m7b", "m8b"] },
  { id: "tweet", label: "Tweet", entries: ["m5c", "m6c", "m7c", "m8c"] },
];

const FLOW_STEPS = [
  "Click any bubble to jump the chat to that message.",
  "User prompts show as pills; assistant replies are compact chips below them.",
  "Click a faded fork bubble (marketing or tweet) to preview that branch.",
  "Use Continue here to make the preview the active path, or Back to cancel.",
  "The focused bubble is solid — gray siblings are alternate branches.",
] as const;

function getEntry(id: string): MockEntry {
  const entry = ENTRIES[id];
  if (!entry) throw new Error(`Unknown entry: ${id}`);
  return entry;
}

function getBranch(branchId: BranchId): Branch {
  const branch = BRANCHES.find((item) => item.id === branchId);
  if (!branch) throw new Error(`Unknown branch: ${branchId}`);
  return branch;
}

function pathFor(branchId: BranchId): readonly MockEntry[] {
  const branch = getBranch(branchId);
  return [...TRUNK_IDS, ...branch.entries].map(getEntry);
}

function summarize(text: string, max = 52): string {
  const normalized = text.toLowerCase().replace(/\s+/g, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, max)}…` : normalized;
}

function buildSegments(activeBranch: BranchId): MinimapSegment[] {
  const segments: MinimapSegment[] = [];

  for (const id of TRUNK_IDS) {
    segments.push({
      id,
      entry: getEntry(id),
      branchId: null,
      kind: "trunk",
      isActivePath: true,
    });
  }

  for (const branch of BRANCHES) {
    const firstId = branch.entries[0];
    if (!firstId) continue;
    segments.push({
      id: firstId,
      entry: getEntry(firstId),
      branchId: branch.id,
      kind: "fork",
      isActivePath: branch.id === activeBranch,
    });
  }

  const active = getBranch(activeBranch);
  for (const id of active.entries.slice(1)) {
    segments.push({
      id,
      entry: getEntry(id),
      branchId: activeBranch,
      kind: "continuation",
      isActivePath: true,
    });
  }

  return segments;
}

function segmentTone(
  segment: MinimapSegment,
  minimap: MinimapProps,
): "active" | "focused" | "hover" | "inactive" {
  const hovered =
    (segment.branchId !== null && minimap.hoveredBranch === segment.branchId) ||
    minimap.hoveredEntryId === segment.id;
  const focused = minimap.leafId === segment.id;

  if (focused) return "focused";
  if (hovered) return "hover";
  if (segment.isActivePath) return "active";
  return "inactive";
}

interface MinimapProps {
  activeBranch: BranchId;
  leafId: string;
  hoveredBranch: BranchId | null;
  hoveredEntryId: string | null;
  onHoverBranch: (branchId: BranchId | null) => void;
  onHoverEntry: (entryId: string | null) => void;
  onPickBranch: (branchId: BranchId) => void;
  onPickEntry: (entryId: string) => void;
}

interface ConversationNavState {
  activeBranch: BranchId;
  visibleBranch: BranchId;
  leafId: string;
  hoveredBranch: BranchId | null;
  hoveredEntryId: string | null;
  previewBranch: BranchId | null;
  isPreviewing: boolean;
  messages: readonly MockEntry[];
  segments: readonly MinimapSegment[];
  minimapProps: MinimapProps;
  confirmPreview: () => void;
  cancelPreview: () => void;
}

function useConversationNav(initialBranch: BranchId = "technical"): ConversationNavState {
  const [activeBranch, setActiveBranch] = useState<BranchId>(initialBranch);
  const [leafId, setLeafId] = useState<string>("m8a");
  const [hoveredBranch, setHoveredBranch] = useState<BranchId | null>(null);
  const [hoveredEntryId, setHoveredEntryId] = useState<string | null>(null);
  const [previewBranch, setPreviewBranch] = useState<BranchId | null>(null);

  const visibleBranch = previewBranch ?? activeBranch;
  const messages = pathFor(visibleBranch);
  const segments = buildSegments(activeBranch);
  const isPreviewing = previewBranch !== null && previewBranch !== activeBranch;

  function pickBranch(branchId: BranchId) {
    if (branchId === activeBranch) {
      setPreviewBranch(null);
      return;
    }
    setPreviewBranch(branchId);
    const forkId = getBranch(branchId).entries[0];
    if (forkId) setLeafId(forkId);
  }

  function pickEntry(entryId: string) {
    setLeafId(entryId);
  }

  function confirmPreview() {
    if (previewBranch) {
      setActiveBranch(previewBranch);
      setPreviewBranch(null);
    }
  }

  const minimapProps: MinimapProps = {
    activeBranch,
    leafId,
    hoveredBranch,
    hoveredEntryId,
    onHoverBranch: setHoveredBranch,
    onHoverEntry: setHoveredEntryId,
    onPickBranch: pickBranch,
    onPickEntry: pickEntry,
  };

  return {
    activeBranch,
    visibleBranch,
    leafId,
    hoveredBranch,
    hoveredEntryId,
    previewBranch,
    isPreviewing,
    messages,
    segments,
    minimapProps,
    confirmPreview,
    cancelPreview: () => setPreviewBranch(null),
  };
}

// --- chat -------------------------------------------------------------------

function ChatView(props: {
  messages: readonly MockEntry[];
  leafId: string;
  isPreviewing: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const entryRefs = useRef<Map<string, HTMLElement>>(new Map());
  const scrollSyncKey = `${props.leafId}:${props.messages.map((entry) => entry.id).join("|")}`;

  return (
    <div ref={scrollRef} className="min-h-0 min-w-0 flex-1 overflow-y-auto px-5 py-6 sm:px-8">
      <ChatActiveEntryScrollSync
        key={scrollSyncKey}
        leafId={props.leafId}
        entryRefs={entryRefs}
      />
      <ul className="mx-auto flex max-w-2xl flex-col gap-4">
        {props.messages.map((entry) => {
          const isActive = entry.id === props.leafId;
          const isUser = entry.role === "user";
          return (
            <li
              key={entry.id}
              ref={(node) => {
                if (node) entryRefs.current.set(entry.id, node);
                else entryRefs.current.delete(entry.id);
              }}
              className={cn(
                "rounded-multi-card px-4 py-3 text-(length:--multi-sidebar-label-size) leading-relaxed transition-[opacity,box-shadow]",
                isUser ? "ml-8 bg-multi-bg-quaternary" : "mr-8 bg-multi-bg-tertiary",
                isActive && "ring-2 ring-foreground/20 shadow-sm",
                props.isPreviewing && !isActive && "opacity-80",
              )}
            >
              <div className="mb-1 flex items-center gap-2 text-(length:--multi-text-detail) text-multi-fg-tertiary">
                <span>{isUser ? "You" : "Assistant"}</span>
                {entry.label ? (
                  <span className="rounded-full bg-multi-bg-quinary px-1.5 py-px">
                    {entry.label}
                  </span>
                ) : null}
              </div>
              {entry.text}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ChatActiveEntryScrollSync({
  leafId,
  entryRefs,
}: {
  leafId: string;
  entryRefs: RefObject<Map<string, HTMLElement>>;
}) {
  useMountEffect(() => {
    const node = entryRefs.current.get(leafId);
    node?.scrollIntoView({ behavior: "smooth", block: "center" });
  });

  return null;
}

function PreviewBanner(props: { state: ConversationNavState }) {
  return (
    <AnimatePresence>
      {props.state.isPreviewing ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="pointer-events-auto absolute inset-x-0 top-0 z-20 flex items-center gap-2 border-b border-amber-500/25 bg-amber-500/95 px-4 py-2.5 backdrop-blur-sm"
        >
          <Text size="sm" tone="secondary">
            Previewing {getBranch(props.state.visibleBranch).label} branch
          </Text>
          <div className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              onClick={props.state.cancelPreview}
              className="rounded-multi-control px-2.5 py-1 text-(length:--multi-text-detail) text-multi-fg-secondary hover:bg-multi-bg-quaternary"
            >
              Back
            </button>
            <button
              type="button"
              onClick={props.state.confirmPreview}
              className="inline-flex items-center gap-1 rounded-multi-control bg-primary px-2.5 py-1 text-(length:--multi-text-detail) font-medium text-primary-foreground"
            >
              Continue here
              <IconArrowRight className="size-3" aria-hidden="true" />
            </button>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function ComposerHint() {
  return (
    <div className="flex shrink-0 items-center gap-2 border-t border-multi-stroke-quaternary bg-multi-bg-elevated px-4 py-3">
      <div className="flex h-9 flex-1 items-center rounded-multi-control border border-multi-stroke-quaternary bg-multi-bg-quinary px-3 text-(length:--multi-text-detail) text-multi-fg-quaternary">
        Send a message…
      </div>
      <button
        type="button"
        className="flex size-8 items-center justify-center rounded-full border border-multi-stroke-quaternary bg-multi-bg-quinary text-multi-fg-tertiary"
        aria-label="Scroll to latest"
      >
        <IconChevronDownSmall className="size-4" aria-hidden="true" />
      </button>
    </div>
  );
}

// --- bubble minimap ---------------------------------------------------------

function BubbleChip(props: { segment: MinimapSegment; minimap: MinimapProps }) {
  const tone = segmentTone(props.segment, props.minimap);
  const branchId = props.segment.branchId;
  const isUser = props.segment.entry.role === "user";

  function handleClick() {
    props.minimap.onPickEntry(props.segment.id);
    if (branchId) props.minimap.onPickBranch(branchId);
  }

  if (isUser) {
    return (
      <motion.button
        type="button"
        layout
        onMouseEnter={() => {
          props.minimap.onHoverEntry(props.segment.id);
          if (branchId) props.minimap.onHoverBranch(branchId);
        }}
        onMouseLeave={() => {
          props.minimap.onHoverEntry(null);
          props.minimap.onHoverBranch(null);
        }}
        onClick={handleClick}
        aria-current={props.minimap.leafId === props.segment.id ? "true" : undefined}
        className={cn(
          "block max-w-full truncate rounded-full text-left text-[11px] leading-snug transition-colors",
          "px-2.5 py-1",
          tone === "focused" && "bg-foreground text-background shadow-md ring-2 ring-foreground/15",
          tone === "active" && "bg-foreground/90 text-background shadow-sm",
          tone === "hover" && "bg-foreground/80 text-background",
          tone === "inactive" &&
            "bg-multi-bg-quaternary text-multi-fg-secondary hover:bg-multi-bg-tertiary",
          props.segment.kind === "fork" &&
            !props.segment.isActivePath &&
            tone === "inactive" &&
            "opacity-70",
        )}
        animate={{ scale: tone === "focused" || tone === "hover" ? 1.02 : 1 }}
        transition={{ type: "spring", stiffness: 480, damping: 32 }}
      >
        {summarize(props.segment.entry.text, 40)}
      </motion.button>
    );
  }

  return (
    <button
      type="button"
      onMouseEnter={() => {
        props.minimap.onHoverEntry(props.segment.id);
        if (branchId) props.minimap.onHoverBranch(branchId);
      }}
      onMouseLeave={() => {
        props.minimap.onHoverEntry(null);
        props.minimap.onHoverBranch(null);
      }}
      onClick={handleClick}
      aria-current={props.minimap.leafId === props.segment.id ? "true" : undefined}
      aria-label={props.segment.entry.text}
      className={cn(
        "block max-w-full truncate rounded-multi-control px-2 py-0.5 text-left text-[10px] leading-snug transition-colors",
        tone === "focused" && "bg-primary/15 text-multi-fg-primary ring-1 ring-primary/30",
        tone === "active" && "bg-primary/10 text-multi-fg-secondary",
        tone === "hover" && "bg-primary/12 text-multi-fg-primary",
        tone === "inactive" &&
          "bg-multi-bg-quinary/80 text-multi-fg-quaternary hover:text-multi-fg-tertiary",
      )}
    >
      {summarize(props.segment.entry.text, 32)}
    </button>
  );
}

function BubbleMinimap(props: { segments: readonly MinimapSegment[]; minimap: MinimapProps }) {
  return (
    <div className="relative flex h-full w-[min(38%,200px)] shrink-0 flex-col border-l border-multi-stroke-quaternary/70 bg-multi-bg-quinary/35">
      <div className="min-h-0 flex-1 overflow-y-auto px-2.5 py-5">
        <div className="flex flex-col items-end gap-1.5">
          {props.segments.map((segment, index) => (
            <div key={segment.id} className="relative w-full">
              {segment.kind === "fork" && index > 0 ? (
                <div
                  className="pointer-events-none mb-1.5 border-t border-dashed border-multi-stroke-tertiary/50"
                  aria-hidden="true"
                />
              ) : null}
              <div
                className={cn(
                  "flex w-full",
                  segment.entry.role === "user" ? "justify-end" : "justify-start pl-1",
                )}
              >
                <BubbleChip segment={segment} minimap={props.minimap} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// --- flow demo --------------------------------------------------------------

function FlowGuide() {
  return (
    <ol className="space-y-2 text-(length:--multi-sidebar-label-size) text-multi-fg-secondary">
      {FLOW_STEPS.map((step, index) => (
        <li key={step} className="flex gap-2">
          <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-multi-bg-quaternary text-(length:--multi-text-detail) font-medium text-multi-fg-tertiary">
            {index + 1}
          </span>
          {step}
        </li>
      ))}
    </ol>
  );
}

function FilmstripFlowDemo() {
  const state = useConversationNav();

  return (
    <div className="flex h-[460px] flex-col overflow-hidden rounded-xl border border-multi-stroke-tertiary bg-multi-bg-elevated shadow-sm">
      <div className="relative flex min-h-0 min-w-0 flex-1">
        <PreviewBanner state={state} />
        <ChatView
          messages={state.messages}
          leafId={state.leafId}
          isPreviewing={state.isPreviewing}
        />
        <BubbleMinimap segments={state.segments} minimap={state.minimapProps} />
      </div>
      <ComposerHint />
    </div>
  );
}

function DevOnlyNotice() {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-8">
      <Text render={<p />} size="base" tone="tertiary">
        Conversation minimap demo is only available in development builds.
      </Text>
    </div>
  );
}

function ConversationMinimapPage() {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-multi-editor">
      <div className="mx-auto flex w-full max-w-[960px] flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10">
        <header className="space-y-2">
          <Text render={<h1 />} size="xl" tone="primary" weight="medium">
            Bubble minimap
          </Text>
          <Text render={<p />} size="base" tone="tertiary">
            User prompts as right-aligned pills on the rail — assistant replies as compact chips.
            Click a bubble to jump; gray fork siblings preview alternate branches.
          </Text>
        </header>

        <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_220px]">
          <FilmstripFlowDemo />
          <aside className="space-y-3">
            <Text render={<h2 />} size="lg" tone="primary" weight="medium">
              User flow
            </Text>
            <FlowGuide />
          </aside>
        </section>
      </div>
    </div>
  );
}

export function BranchingUiPrototypesPage() {
  if (!import.meta.env.DEV) {
    return <DevOnlyNotice />;
  }
  return <ConversationMinimapPage />;
}
