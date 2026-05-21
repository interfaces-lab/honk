import {
  IconArchive1,
  IconArchiveJunk,
  IconArrowUp,
  IconDotGrid1x3Horizontal,
  IconFolder1,
  IconSparklesThree,
  IconTrashCan,
} from "central-icons";
import { useCallback, useEffect, useState } from "react";

import { Text } from "@multi/ui/text";
import { cn } from "~/lib/utils";

import { ComposerPromptEditor } from "./prompt-editor";
import { collapseExpandedComposerCursor } from "./prompt-triggers";

const COMPACT_EXAMPLE_EDITOR_CLASS = "min-h-5 max-h-5 overflow-hidden py-0";

const CURSOR_MODEL_TABS = ["o3", "gpt-5", "claude-4-sonnet"] as const;

const MOCK_ARCHIVED_PROJECT = {
  name: "multi",
  path: "workgyver/Developer/multi",
} as const;

const MOCK_ARCHIVED_THREADS = [
  {
    id: "thread-1",
    title: "Implement compact sidebar rows",
    archivedAgo: "2d ago",
    createdAgo: "5d ago",
  },
  {
    id: "thread-2",
    title: "Archive confirmation and settings polish",
    archivedAgo: "1w ago",
    createdAgo: "2w ago",
  },
] as const;

const ARCHIVE_UI_VARIANTS = [
  {
    id: "settings-rows",
    label: "Settings rows (current)",
    description: "Project sections with outline Unarchive on every row.",
  },
  {
    id: "sidebar-rows",
    label: "Sidebar-style rows",
    description: "Match agent list density; restore and delete on hover.",
  },
  {
    id: "inline-actions",
    label: "Inline icon actions",
    description: "Always-visible trailing actions for touch and scanability.",
  },
  {
    id: "timeline-groups",
    label: "Timeline groups",
    description: "Bucket by recency; title-forward rows with text restore.",
  },
  {
    id: "stacked-cards",
    label: "Stacked cards",
    description: "Each thread is an isolated surface with actions in a footer row.",
  },
  {
    id: "restore-primary",
    label: "Restore-primary",
    description: "Restore is the obvious primary action; delete stays low-emphasis.",
  },
  {
    id: "overflow-menu",
    label: "Overflow menu",
    description: "Single ⋯ control per row; keeps rows quiet until opened.",
  },
  {
    id: "meta-split",
    label: "Meta split",
    description: "Title block plus a second line for project, dates, and actions.",
  },
] as const;

type ArchiveUiVariantId = (typeof ARCHIVE_UI_VARIANTS)[number]["id"];

function useExamplePrompt(initialPrompt: string) {
  const [prompt, setPrompt] = useState(initialPrompt);
  const [cursor, setCursor] = useState(() =>
    collapseExpandedComposerCursor(initialPrompt, initialPrompt.length),
  );

  const onPromptChange = useCallback(
    (
      nextPrompt: string,
      nextCursor: number,
      _expandedCursor: number,
      _cursorAdjacentToMention: boolean,
    ) => {
      setPrompt(nextPrompt);
      setCursor(nextCursor);
    },
    [],
  );

  return { prompt, cursor, onPromptChange };
}

function ExamplePromptEditor(props: {
  placeholder: string;
  prompt: string;
  cursor: number;
  onPromptChange: ReturnType<typeof useExamplePrompt>["onPromptChange"];
  className?: string;
}) {
  return (
    <ComposerPromptEditor
      value={props.prompt}
      cursor={props.cursor}
      skills={[]}
      disabled={false}
      placeholder={props.placeholder}
      onChange={props.onPromptChange}
      onPaste={() => undefined}
      className={cn(COMPACT_EXAMPLE_EDITOR_CLASS, props.className)}
    />
  );
}

function CursorSendButton(props: { disabled?: boolean; className?: string }) {
  return (
    <button
      type="button"
      disabled={props.disabled}
      aria-label="Send message"
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-full bg-foreground text-background transition-opacity hover:opacity-90 disabled:pointer-events-none disabled:opacity-35",
        props.className,
      )}
    >
      <IconArrowUp className="size-3.5" aria-hidden="true" />
    </button>
  );
}

function CursorModelTabs(props: { activeModel: (typeof CURSOR_MODEL_TABS)[number] }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {CURSOR_MODEL_TABS.map((model) => {
        const isActive = model === props.activeModel;
        return (
          <button
            key={model}
            type="button"
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-detail transition-colors",
              isActive
                ? "border-multi-stroke-secondary bg-multi-bg-quaternary text-multi-fg-primary"
                : "border-transparent text-multi-fg-tertiary hover:bg-multi-bg-tertiary hover:text-multi-fg-secondary",
            )}
          >
            {isActive ? (
              <IconSparklesThree className="size-3 opacity-80" aria-hidden="true" />
            ) : null}
            {model}
          </button>
        );
      })}
    </div>
  );
}

function CursorFollowUpPill(props: { placeholder: string; initialPrompt?: string }) {
  const { prompt, cursor, onPromptChange } = useExamplePrompt(props.initialPrompt ?? "");

  return (
    <div className="mx-auto flex w-full max-w-2xl items-center gap-2 rounded-full border border-multi-stroke-tertiary bg-(--glass-chat-bubble-background) px-3 py-2 shadow-sm">
      <div className="min-w-0 flex-1 pl-1">
        <ExamplePromptEditor
          placeholder={props.placeholder}
          prompt={prompt}
          cursor={cursor}
          onPromptChange={onPromptChange}
          className="!px-0"
        />
      </div>
      <CursorSendButton disabled={prompt.trim().length === 0} className="size-7" />
    </div>
  );
}

function ThreadModelTabsExample() {
  return (
    <section className="space-y-4 rounded-xl border border-multi-stroke-tertiary bg-multi-bg-elevated p-4 sm:p-5">
      <div className="space-y-1">
        <Text render={<h2 />} size="lg" tone="primary" weight="medium">
          Thread with model tabs
        </Text>
        <Text render={<p />} size="sm" tone="tertiary">
          Model pills above the dock follow-up input.
        </Text>
      </div>
      <div className="mx-auto w-full max-w-2xl space-y-3">
        <CursorModelTabs activeModel="claude-4-sonnet" />
        <CursorFollowUpPill placeholder="Give Cursor a follow-up instruction..." />
      </div>
    </section>
  );
}

const archiveRowActionClass = cn(
  "flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-multi-control border border-transparent bg-transparent p-0 text-multi-fg-tertiary outline-none",
  "hover:bg-multi-bg-quaternary hover:text-multi-fg-primary",
  "focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-0",
);

function ArchiveRowActions(props: { alwaysVisible?: boolean }) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center gap-0.5",
        !props.alwaysVisible &&
          "opacity-0 group-hover/archive-row:pointer-events-auto group-hover/archive-row:opacity-100",
      )}
    >
      <button type="button" className={archiveRowActionClass} aria-label="Unarchive">
        <IconArchiveJunk className="size-3.5" aria-hidden="true" />
      </button>
      <button type="button" className={archiveRowActionClass} aria-label="Delete">
        <IconTrashCan className="size-3.5" aria-hidden="true" />
      </button>
    </span>
  );
}

function ArchiveProjectHeader() {
  return (
    <div className="flex min-h-6 items-center gap-1.5 px-3.5 py-1">
      <IconFolder1 className="size-3.5 shrink-0 text-multi-icon-tertiary" aria-hidden="true" />
      <span className="min-w-0 truncate text-(length:--multi-sidebar-label-size) font-(--multi-sidebar-label-weight) leading-(--multi-sidebar-label-leading) text-multi-fg-tertiary">
        {MOCK_ARCHIVED_PROJECT.name}
      </span>
      <span className="min-w-0 truncate text-(length:--multi-text-detail) leading-(--multi-leading-detail) text-multi-fg-quaternary">
        {MOCK_ARCHIVED_PROJECT.path}
      </span>
    </div>
  );
}

function ArchiveSettingsRowsVariant() {
  return (
    <div className="overflow-hidden rounded-lg bg-multi-bg-quinary text-card-foreground">
      <ArchiveProjectHeader />
      {MOCK_ARCHIVED_THREADS.map((thread, index) => (
        <div
          key={thread.id}
          className={cn(
            "flex items-center justify-between gap-3 px-4 py-3 sm:px-5",
            index > 0 && "border-t border-multi-stroke-quaternary",
          )}
        >
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-(length:--multi-sidebar-label-size) font-medium leading-(--multi-sidebar-label-leading) text-multi-fg-primary">
              {thread.title}
            </h3>
            <p className="mt-0.5 text-(length:--multi-text-detail) leading-(--multi-leading-detail) text-multi-fg-tertiary">
              Archived {thread.archivedAgo} · Created {thread.createdAgo}
            </p>
          </div>
          <button
            type="button"
            className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-multi-control border border-multi-stroke-tertiary bg-transparent px-2.5 text-(length:--multi-text-detail) leading-(--multi-leading-detail) text-multi-fg-secondary hover:bg-multi-bg-quaternary hover:text-multi-fg-primary"
          >
            <IconArchiveJunk className="size-3.5" aria-hidden="true" />
            Unarchive
          </button>
        </div>
      ))}
    </div>
  );
}

function ArchiveSidebarRowsVariant() {
  return (
    <div className="overflow-hidden rounded-lg bg-multi-bg-quinary">
      <ArchiveProjectHeader />
      <div className="flex flex-col gap-px pb-2">
        {MOCK_ARCHIVED_THREADS.map((thread) => (
          <div
            key={thread.id}
            className="group/archive-row flex w-full min-w-0 items-center gap-1.5 rounded-multi-control px-3.5 py-[5px] hover:bg-multi-bg-quaternary"
          >
            <span className="flex size-3.5 shrink-0 items-center justify-center text-multi-icon-tertiary">
              <IconArchive1 className="size-3.5" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1 overflow-hidden">
              <p className="truncate text-(length:--multi-sidebar-label-size) font-normal leading-(--multi-sidebar-label-leading) text-multi-fg-secondary">
                {thread.title}
              </p>
              <p className="truncate text-(length:--multi-text-detail) leading-(--multi-leading-detail) text-multi-fg-tertiary">
                Archived {thread.archivedAgo}
              </p>
            </div>
            <span className="shrink-0 text-(length:--multi-text-detail) leading-(--multi-leading-detail) tabular-nums text-multi-fg-tertiary opacity-0 group-hover/archive-row:opacity-100">
              {thread.createdAgo}
            </span>
            <ArchiveRowActions />
          </div>
        ))}
      </div>
    </div>
  );
}

function ArchiveInlineActionsVariant() {
  return (
    <div className="overflow-hidden rounded-lg bg-multi-bg-quinary">
      <ArchiveProjectHeader />
      {MOCK_ARCHIVED_THREADS.map((thread, index) => (
        <div
          key={thread.id}
          className={cn(
            "flex items-center gap-2 px-3.5 py-2.5",
            index > 0 && "border-t border-multi-stroke-quaternary",
          )}
        >
          <span className="flex size-3.5 shrink-0 items-center justify-center text-multi-icon-tertiary">
            <IconArchive1 className="size-3.5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-(length:--multi-sidebar-label-size) font-normal leading-(--multi-sidebar-label-leading) text-multi-fg-primary">
              {thread.title}
            </p>
            <p className="truncate text-(length:--multi-text-detail) leading-(--multi-leading-detail) text-multi-fg-tertiary">
              {thread.archivedAgo}
            </p>
          </div>
          <ArchiveRowActions alwaysVisible />
        </div>
      ))}
    </div>
  );
}

function ArchiveStackedCardsVariant() {
  return (
    <div className="space-y-2">
      <ArchiveProjectHeader />
      {MOCK_ARCHIVED_THREADS.map((thread) => (
        <article
          key={thread.id}
          className="overflow-hidden rounded-lg border border-multi-stroke-quaternary bg-multi-bg-quinary"
        >
          <div className="px-3.5 py-2.5">
            <p className="truncate text-(length:--multi-sidebar-label-size) font-medium leading-(--multi-sidebar-label-leading) text-multi-fg-primary">
              {thread.title}
            </p>
            <p className="mt-1 text-(length:--multi-text-detail) leading-(--multi-leading-detail) text-multi-fg-tertiary">
              Archived {thread.archivedAgo} · Created {thread.createdAgo}
            </p>
          </div>
          <div className="flex items-center justify-end gap-1 border-t border-multi-stroke-quaternary px-2 py-1.5">
            <button
              type="button"
              className="rounded-multi-control px-2 py-1 text-(length:--multi-text-detail) leading-(--multi-leading-detail) text-multi-fg-tertiary hover:bg-multi-bg-quaternary hover:text-multi-fg-primary"
            >
              Delete
            </button>
            <button
              type="button"
              className="rounded-multi-control bg-multi-bg-quaternary px-2.5 py-1 text-(length:--multi-text-detail) font-medium leading-(--multi-leading-detail) text-multi-fg-primary hover:bg-multi-bg-tertiary"
            >
              Restore
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}

function ArchiveRestorePrimaryVariant() {
  return (
    <div className="overflow-hidden rounded-lg bg-multi-bg-quinary">
      <ArchiveProjectHeader />
      {MOCK_ARCHIVED_THREADS.map((thread, index) => (
        <div
          key={thread.id}
          className={cn(
            "flex items-center gap-2 px-3.5 py-2.5",
            index > 0 && "border-t border-multi-stroke-quaternary",
          )}
        >
          <span className="flex size-3.5 shrink-0 items-center justify-center text-multi-icon-tertiary">
            <IconArchive1 className="size-3.5" aria-hidden="true" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-(length:--multi-sidebar-label-size) font-normal leading-(--multi-sidebar-label-leading) text-multi-fg-primary">
              {thread.title}
            </p>
            <p className="truncate text-(length:--multi-text-detail) leading-(--multi-leading-detail) text-multi-fg-tertiary">
              {thread.archivedAgo}
            </p>
          </div>
          <button
            type="button"
            className="shrink-0 rounded-multi-control px-2 py-1 text-(length:--multi-text-detail) leading-(--multi-leading-detail) text-multi-fg-tertiary hover:bg-multi-bg-quaternary hover:text-multi-fg-primary"
          >
            Delete
          </button>
          <button
            type="button"
            className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-multi-control border border-multi-stroke-secondary bg-multi-bg-quaternary px-2.5 text-(length:--multi-text-detail) font-medium leading-(--multi-leading-detail) text-multi-fg-primary hover:bg-multi-bg-tertiary"
          >
            <IconArchiveJunk className="size-3.5" aria-hidden="true" />
            Restore
          </button>
        </div>
      ))}
    </div>
  );
}

function ArchiveOverflowMenuVariant() {
  return (
    <div className="overflow-hidden rounded-lg bg-multi-bg-quinary">
      <ArchiveProjectHeader />
      {MOCK_ARCHIVED_THREADS.map((thread, index) => (
        <div
          key={thread.id}
          className={cn(
            "flex items-center gap-2 px-3.5 py-2",
            index > 0 && "border-t border-multi-stroke-quaternary",
          )}
        >
          <div className="min-w-0 flex-1">
            <p className="truncate text-(length:--multi-sidebar-label-size) font-normal leading-(--multi-sidebar-label-leading) text-multi-fg-primary">
              {thread.title}
            </p>
            <p className="truncate text-(length:--multi-text-detail) leading-(--multi-leading-detail) text-multi-fg-tertiary">
              Archived {thread.archivedAgo} · {MOCK_ARCHIVED_PROJECT.name}
            </p>
          </div>
          <button
            type="button"
            className={archiveRowActionClass}
            aria-label="Thread actions"
          >
            <IconDotGrid1x3Horizontal className="size-3.5" aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
}

function ArchiveMetaSplitVariant() {
  return (
    <div className="overflow-hidden rounded-lg bg-multi-bg-quinary">
      <ArchiveProjectHeader />
      {MOCK_ARCHIVED_THREADS.map((thread, index) => (
        <div
          key={thread.id}
          className={cn("px-3.5 py-2.5", index > 0 && "border-t border-multi-stroke-quaternary")}
        >
          <p className="truncate text-(length:--multi-sidebar-label-size) font-medium leading-(--multi-sidebar-label-leading) text-multi-fg-primary">
            {thread.title}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="inline-flex items-center gap-1 text-(length:--multi-text-detail) leading-(--multi-leading-detail) text-multi-fg-tertiary">
              <IconFolder1 className="size-3 shrink-0 opacity-70" aria-hidden="true" />
              {MOCK_ARCHIVED_PROJECT.name}
            </span>
            <span className="text-(length:--multi-text-detail) leading-(--multi-leading-detail) text-multi-fg-quaternary">
              ·
            </span>
            <span className="text-(length:--multi-text-detail) leading-(--multi-leading-detail) text-multi-fg-tertiary">
              Archived {thread.archivedAgo}
            </span>
            <span className="ml-auto flex items-center gap-1">
              <button
                type="button"
                className="text-(length:--multi-text-detail) font-medium leading-(--multi-leading-detail) text-multi-fg-secondary hover:text-multi-fg-primary"
              >
                Restore
              </button>
              <button
                type="button"
                className={archiveRowActionClass}
                aria-label="Delete"
              >
                <IconTrashCan className="size-3.5" aria-hidden="true" />
              </button>
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

function ArchiveTimelineGroupsVariant() {
  const groups = [
    { label: "This week", threads: [MOCK_ARCHIVED_THREADS[0]] },
    { label: "Earlier", threads: [MOCK_ARCHIVED_THREADS[1]] },
  ] as const;

  return (
    <div className="space-y-4 rounded-lg bg-multi-bg-quinary p-3 sm:p-4">
      {groups.map((group) => (
        <div key={group.label} className="space-y-1">
          <p className="px-1.5 text-(length:--multi-text-detail) font-medium leading-(--multi-leading-detail) text-multi-fg-tertiary">
            {group.label}
          </p>
          <ul className="space-y-px">
            {group.threads.map((thread) => (
              <li
                key={thread.id}
                className="group/archive-row flex items-center gap-2 rounded-multi-control px-1.5 py-1.5 hover:bg-multi-bg-quaternary"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-(length:--multi-sidebar-label-size) font-normal leading-(--multi-sidebar-label-leading) text-multi-fg-primary">
                    {thread.title}
                  </p>
                  <p className="text-(length:--multi-text-detail) leading-(--multi-leading-detail) text-multi-fg-tertiary">
                    {MOCK_ARCHIVED_PROJECT.name} · {thread.archivedAgo}
                  </p>
                </div>
                <button
                  type="button"
                  className="shrink-0 text-(length:--multi-text-detail) font-medium leading-(--multi-leading-detail) text-multi-fg-secondary hover:text-multi-fg-primary"
                >
                  Restore
                </button>
                <button
                  type="button"
                  className={cn(archiveRowActionClass, "opacity-0 group-hover/archive-row:opacity-100")}
                  aria-label="Delete"
                >
                  <IconTrashCan className="size-3.5" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function ArchiveUiVariantPreview(props: { variantId: ArchiveUiVariantId }) {
  switch (props.variantId) {
    case "settings-rows":
      return <ArchiveSettingsRowsVariant />;
    case "sidebar-rows":
      return <ArchiveSidebarRowsVariant />;
    case "inline-actions":
      return <ArchiveInlineActionsVariant />;
    case "timeline-groups":
      return <ArchiveTimelineGroupsVariant />;
    case "stacked-cards":
      return <ArchiveStackedCardsVariant />;
    case "restore-primary":
      return <ArchiveRestorePrimaryVariant />;
    case "overflow-menu":
      return <ArchiveOverflowMenuVariant />;
    case "meta-split":
      return <ArchiveMetaSplitVariant />;
  }
}

function ArchiveUiExamples() {
  return (
    <section className="space-y-4 rounded-xl border border-multi-stroke-tertiary bg-multi-bg-elevated p-4 sm:p-5">
      <div className="space-y-1">
        <Text render={<h2 />} size="lg" tone="primary" weight="medium">
          Archived threads (settings)
        </Text>
        <Text render={<p />} size="sm" tone="tertiary">
          Use the picker toolbar to compare layouts. Default is the current settings panel pattern.
        </Text>
      </div>

      <div data-uidotsh-pick="Archived threads layout" className="contents">
        {ARCHIVE_UI_VARIANTS.map((variant, index) => (
          <div
            key={variant.id}
            data-uidotsh-option={variant.label}
            className="contents"
            {...(index === 0 ? {} : { hidden: true })}
          >
            <div className="space-y-2">
              <Text render={<p />} size="sm" tone="tertiary">
                {variant.description}
              </Text>
              <ArchiveUiVariantPreview variantId={variant.id} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function useUiPickerScript() {
  useEffect(() => {
    if (document.querySelector("script[data-uidotsh-picker]")) {
      return;
    }
    const script = document.createElement("script");
    script.src = "https://ui.sh/ui-picker.js";
    script.dataset.uidotshPicker = "";
    document.body.appendChild(script);
    return () => {
      script.remove();
    };
  }, []);
}

function ComposerInputExamplesNotAvailable() {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-8">
      <Text render={<p />} size="base" tone="tertiary">
        UI examples are only available in development builds.
      </Text>
    </div>
  );
}

export function ComposerInputExamplesPage() {
  if (!import.meta.env.DEV) {
    return <ComposerInputExamplesNotAvailable />;
  }

  return <ComposerInputExamplesGallery />;
}

function ComposerInputExamplesGallery() {
  useUiPickerScript();

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-multi-editor">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10">
        <header className="space-y-2">
          <Text render={<h1 />} size="xl" tone="primary" weight="medium">
            UI examples
          </Text>
          <Text render={<p />} size="base" tone="tertiary">
            Dev-only gallery for composer and settings patterns. Open{" "}
            <code className="text-multi-fg-secondary">/dev/composer-examples</code> and use the UI
            picker toolbar to switch archive layouts.
          </Text>
        </header>

        <ArchiveUiExamples />
        <ThreadModelTabsExample />
      </div>
    </div>
  );
}
