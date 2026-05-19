import {
  IconArrowUp,
  IconBranch,
  IconChevronRightMedium,
  IconCloudDownload,
  IconFileText,
  IconFolder1,
  IconPaperclip1,
  IconRocket,
  IconSparklesThree,
  IconSquareChecklist,
} from "central-icons";
import { useCallback, useState } from "react";

import { ComposerPromptEditor } from "./prompt-editor";
import { collapseExpandedComposerCursor } from "./prompt-triggers";
import { Text } from "@multi/ui/text";
import { cn } from "~/lib/utils";

const CURSOR_REFERENCE_LINKS = [
  {
    label: "Agents hero (empty)",
    href: "https://mobbin.com/screens/5af422b9-b919-4149-8805-fdba29c61e17",
  },
  {
    label: "Agents hero (attachment)",
    href: "https://mobbin.com/screens/fea6bbb3-a38e-477a-9546-55defd5e70c5",
  },
  {
    label: "Thread follow-up pill",
    href: "https://mobbin.com/screens/3042c35c-2024-4d76-b9a5-5661ff32ea09",
  },
  {
    label: "Agent run + model tabs",
    href: "https://mobbin.com/screens/a23b3cb3-e683-44b1-a273-029c419329cb",
  },
] as const;

const CURSOR_SUGGESTION_CHIPS = [
  { label: "Write documentation", icon: IconFileText },
  { label: "Optimize performance", icon: IconRocket },
  { label: "Find and fix 3 bugs", icon: IconSquareChecklist },
] as const;

const CURSOR_MODEL_TABS = ["o3", "gpt-5", "claude-4-sonnet"] as const;

const AGENT_PROMPT_EXAMPLE = `Create a new git branch called feature/random-demo in the connected GitHub repo.
Initialize a random project idea (for example a Next.js app).
Then edit it into a simple productivity app to catalogue tasks:
- Next.js with Tailwind for UI
- API route /api/tasks with in-memory CRUD
- UI: input box to add a task, list with checkboxes, delete button
- Include a README and .gitignore
Make the initial commit on feature/random-demo.`;

type CursorExampleSpec = {
  readonly id: string;
  readonly title: string;
  readonly cursorRef: string;
  readonly description: string;
};

const CURSOR_EXAMPLES: readonly CursorExampleSpec[] = [
  {
    id: "agents-hero",
    title: "Agents hero card",
    cursorRef: "cursor.com/agents",
    description:
      "Large rounded card: editor on top, model selector and send in an internal footer row.",
  },
  {
    id: "agents-with-attachment",
    title: "Agents with attachment chip",
    cursorRef: "cursor.com/agents",
    description: "Attachment chip above the editor, multiline task prompt, same footer controls.",
  },
  {
    id: "agents-context-chips",
    title: "Agents + repo context + suggestions",
    cursorRef: "cursor.com/agents",
    description: "Input card with repository/branch row underneath and starter suggestion chips.",
  },
  {
    id: "thread-follow-up",
    title: "Thread follow-up pill",
    cursorRef: "Agent thread dock",
    description: "Minimal dock pill: single-line placeholder and send affordance only.",
  },
  {
    id: "thread-model-tabs",
    title: "Thread with model tabs",
    cursorRef: "Agent thread header",
    description: "Model pills above the dock follow-up input.",
  },
] as const;

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
      _terminalContextIds: string[],
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
  minHeight?: "compact" | "hero";
}) {
  return (
    <ComposerPromptEditor
      value={props.prompt}
      cursor={props.cursor}
      terminalContexts={[]}
      skills={[]}
      disabled={false}
      placeholder={props.placeholder}
      onRemoveTerminalContext={() => undefined}
      onChange={props.onPromptChange}
      onPaste={() => undefined}
      className={cn(
        props.minHeight === "compact" && "!min-h-5 !max-h-5 !overflow-hidden !py-0",
        props.minHeight === "hero" && "!min-h-28 !max-h-56",
        props.className,
      )}
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

function CursorModelSelector(props: { label: string }) {
  return (
    <button
      type="button"
      className="inline-flex max-w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-detail text-multi-fg-secondary transition-colors hover:bg-multi-bg-tertiary hover:text-multi-fg-primary"
    >
      <IconCloudDownload className="size-3.5 shrink-0 opacity-70" aria-hidden="true" />
      <span className="truncate font-medium">{props.label}</span>
      <IconChevronRightMedium className="size-3 shrink-0 rotate-90 opacity-60" aria-hidden="true" />
    </button>
  );
}

function CursorInputFooter(props: {
  modelLabel: string;
  canSend: boolean;
  showImageAttach?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-2 border-t border-multi-stroke-quaternary px-3 py-2">
      <CursorModelSelector label={props.modelLabel} />
      <div className="flex shrink-0 items-center gap-1">
        {props.showImageAttach ? (
          <button
            type="button"
            className="flex size-8 items-center justify-center rounded-md text-multi-icon-tertiary transition-colors hover:bg-multi-bg-tertiary hover:text-multi-icon-secondary"
            aria-label="Attach images"
          >
            <IconPaperclip1 className="size-3.5" aria-hidden="true" />
          </button>
        ) : null}
        <CursorSendButton disabled={!props.canSend} />
      </div>
    </div>
  );
}

function CursorAttachmentChip(props: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-multi-stroke-tertiary bg-multi-bg-tertiary px-2 py-1 text-detail text-multi-fg-secondary">
      <span className="flex size-5 items-center justify-center rounded bg-multi-bg-quaternary text-multi-fg-tertiary">
        <IconPaperclip1 className="size-3" aria-hidden="true" />
      </span>
      {props.label}
    </span>
  );
}

function CursorContextRow() {
  return (
    <div className="flex flex-wrap items-center gap-2 text-detail text-multi-fg-tertiary">
      <button
        type="button"
        className="inline-flex max-w-full items-center gap-1.5 rounded-md px-1 py-0.5 transition-colors hover:bg-multi-bg-tertiary hover:text-multi-fg-secondary"
      >
        <IconFolder1 className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate">samleemobbin-dot/mini-landing-page</span>
        <IconChevronRightMedium
          className="size-3 shrink-0 rotate-90 opacity-60"
          aria-hidden="true"
        />
      </button>
      <button
        type="button"
        className="inline-flex items-center gap-1 rounded-md px-1 py-0.5 transition-colors hover:bg-multi-bg-tertiary hover:text-multi-fg-secondary"
      >
        <IconBranch className="size-3.5 shrink-0" aria-hidden="true" />
        <span>main</span>
        <IconChevronRightMedium
          className="size-3 shrink-0 rotate-90 opacity-60"
          aria-hidden="true"
        />
      </button>
    </div>
  );
}

function CursorSuggestionChips() {
  return (
    <div className="space-y-2.5">
      <Text render={<p />} size="sm" tone="tertiary" className="text-center">
        Try these examples to get started
      </Text>
      <div className="flex flex-wrap justify-center gap-2">
        {CURSOR_SUGGESTION_CHIPS.map((chip) => {
          const Icon = chip.icon;
          return (
            <button
              key={chip.label}
              type="button"
              className="inline-flex items-center gap-1.5 rounded-full border border-multi-stroke-tertiary bg-multi-bg-elevated px-3 py-1.5 text-detail text-multi-fg-secondary transition-colors hover:border-multi-stroke-secondary hover:bg-multi-bg-quaternary hover:text-multi-fg-primary"
            >
              <Icon className="size-3.5 opacity-70" aria-hidden="true" />
              {chip.label}
            </button>
          );
        })}
      </div>
    </div>
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

function CursorHeroCard(props: {
  placeholder: string;
  initialPrompt: string;
  modelLabel: string;
  attachmentChip?: string;
  showImageAttach?: boolean;
}) {
  const { prompt, cursor, onPromptChange } = useExamplePrompt(props.initialPrompt);

  return (
    <div className="mx-auto w-full max-w-2xl overflow-hidden rounded-xl border border-multi-stroke-tertiary bg-(--glass-chat-bubble-background) shadow-sm">
      <div className="space-y-2 px-3 pt-3">
        {props.attachmentChip ? <CursorAttachmentChip label={props.attachmentChip} /> : null}
        <ExamplePromptEditor
          placeholder={props.placeholder}
          prompt={prompt}
          cursor={cursor}
          onPromptChange={onPromptChange}
          minHeight={props.initialPrompt ? "hero" : "hero"}
          className="!min-h-24 !px-0"
        />
      </div>
      <CursorInputFooter
        modelLabel={props.modelLabel}
        canSend={prompt.trim().length > 0}
        {...(props.showImageAttach === undefined ? {} : { showImageAttach: props.showImageAttach })}
      />
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
          minHeight="compact"
          className="!px-0"
        />
      </div>
      <CursorSendButton disabled={prompt.trim().length === 0} className="size-7" />
    </div>
  );
}

function CursorExamplePreview(props: { spec: CursorExampleSpec }) {
  switch (props.spec.id) {
    case "agents-hero":
      return (
        <CursorHeroCard
          placeholder="Ask Cursor to build, fix bugs, explore"
          initialPrompt=""
          modelLabel="GPT-5 MAX"
          showImageAttach
        />
      );
    case "agents-with-attachment":
      return (
        <CursorHeroCard
          placeholder="Ask Cursor to build, fix bugs, explore"
          initialPrompt={AGENT_PROMPT_EXAMPLE}
          modelLabel="GPT-5, Claude 4 Sonnet, o3 MAX"
          attachmentChip="Image 1"
          showImageAttach
        />
      );
    case "agents-context-chips":
      return (
        <div className="mx-auto w-full max-w-2xl space-y-3">
          <CursorHeroCard
            placeholder="Ask Cursor to build, fix bugs, explore"
            initialPrompt=""
            modelLabel="GPT-5 MAX"
            showImageAttach
          />
          <CursorContextRow />
          <CursorSuggestionChips />
        </div>
      );
    case "thread-follow-up":
      return <CursorFollowUpPill placeholder="Give Cursor a follow-up instruction..." />;
    case "thread-model-tabs":
      return (
        <div className="mx-auto w-full max-w-2xl space-y-3">
          <CursorModelTabs activeModel="claude-4-sonnet" />
          <CursorFollowUpPill placeholder="Give Cursor a follow-up instruction..." />
        </div>
      );
    default:
      return null;
  }
}

function CursorExampleCard(props: { spec: CursorExampleSpec }) {
  return (
    <section className="space-y-4 rounded-xl border border-multi-stroke-tertiary bg-multi-bg-elevated p-4 sm:p-5">
      <div className="space-y-1">
        <Text render={<h2 />} size="lg" tone="primary" weight="medium">
          {props.spec.title}
        </Text>
        <Text render={<p />} size="sm" tone="tertiary">
          {props.spec.description} · Ref: {props.spec.cursorRef}
        </Text>
      </div>
      <CursorExamplePreview spec={props.spec} />
    </section>
  );
}

function ComposerInputExamplesNotAvailable() {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-8">
      <Text render={<p />} size="base" tone="tertiary">
        Chat input examples are only available in development builds.
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
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-multi-editor">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6 sm:py-10">
        <header className="space-y-2">
          <Text render={<h1 />} size="xl" tone="primary" weight="medium">
            Chat input examples (Cursor)
          </Text>
          <Text render={<p />} size="base" tone="tertiary">
            Input shells modeled on Cursor Agents and agent-thread follow-up patterns, built with
            ComposerPromptEditor and Multi tokens.
          </Text>
          <ul className="flex flex-wrap gap-2 pt-1">
            {CURSOR_REFERENCE_LINKS.map((link) => (
              <li key={link.href}>
                <a
                  href={link.href}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-full border border-multi-stroke-tertiary px-2.5 py-1 text-detail text-multi-fg-secondary transition-colors hover:border-multi-stroke-secondary hover:text-multi-fg-primary"
                >
                  {link.label}
                </a>
              </li>
            ))}
          </ul>
        </header>

        <div className="space-y-5">
          {CURSOR_EXAMPLES.map((spec) => (
            <CursorExampleCard key={spec.id} spec={spec} />
          ))}
        </div>
      </div>
    </div>
  );
}
