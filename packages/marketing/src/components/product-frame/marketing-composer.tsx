import { Button } from "@honk/honkkit/button";
import { workbenchChromeTextControlVariants } from "@honk/honkkit/workbench-chrome-row";
import { cn } from "@honk/honkkit/utils";
import { IconArrowUp, IconOpenaiCodex, IconPlusSmall } from "central-icons";
import { useState } from "react";

const CONTEXT_RING_VIEWBOX = 24;
const CONTEXT_RING_CENTER = CONTEXT_RING_VIEWBOX / 2;
const CONTEXT_RING_STROKE = 2.25;
const CONTEXT_RING_RADIUS = (CONTEXT_RING_VIEWBOX - CONTEXT_RING_STROKE) / 2;
const CONTEXT_RING_CIRCUMFERENCE = 2 * Math.PI * CONTEXT_RING_RADIUS;

function MarketingContextUsageRing(props: { percentage: number }) {
  const normalized = Math.max(0, Math.min(100, props.percentage));
  const dashOffset = CONTEXT_RING_CIRCUMFERENCE * (1 - normalized / 100);

  return (
    <span
      data-context-usage-ring=""
      className="relative inline-flex size-3.5 shrink-0 items-center justify-center"
      aria-hidden
    >
      <svg
        viewBox={`0 0 ${CONTEXT_RING_VIEWBOX} ${CONTEXT_RING_VIEWBOX}`}
        className="block h-full w-full -rotate-90 transform-gpu"
      >
        <circle
          cx={CONTEXT_RING_CENTER}
          cy={CONTEXT_RING_CENTER}
          r={CONTEXT_RING_RADIUS}
          fill="none"
          stroke="var(--honk-stroke-tertiary)"
          strokeWidth={CONTEXT_RING_STROKE}
        />
        <circle
          cx={CONTEXT_RING_CENTER}
          cy={CONTEXT_RING_CENTER}
          r={CONTEXT_RING_RADIUS}
          fill="none"
          stroke="var(--honk-fg-secondary)"
          strokeWidth={CONTEXT_RING_STROKE}
          strokeLinecap="round"
          strokeDasharray={CONTEXT_RING_CIRCUMFERENCE}
          strokeDashoffset={dashOffset}
        />
      </svg>
    </span>
  );
}

export function MarketingComposer() {
  const [draft, setDraft] = useState("");
  const hasDraft = draft.trim().length > 0;

  return (
    <form
      className="mx-auto w-full min-w-0 max-w-agent-chat"
      data-variant="compact"
      data-layout="thread"
      data-chat-input-form="true"
      onSubmit={(event) => {
        event.preventDefault();
      }}
    >
      <div
        className="mx-auto flex w-full min-w-0 max-w-agent-chat flex-col gap-2"
        data-variant="compact"
      >
        <div
          className="group relative w-full max-w-full min-w-0 overflow-hidden"
          data-honk-composer-surface=""
          data-variant="compact"
        >
          <div data-honk-composer-shell="thread">
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              className="rounded-full bg-honk-bg-tertiary text-honk-icon-tertiary hover:bg-honk-bg-secondary hover:text-honk-icon-secondary"
              aria-label="Attach images"
            >
              <IconPlusSmall className="size-3.5 shrink-0" aria-hidden />
            </Button>

            <div className="relative min-w-0 flex-1 cursor-text select-text">
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                rows={1}
                placeholder="Send follow-up"
                data-prompt-editor-input="true"
                className="w-full resize-none border-0 bg-transparent p-0 text-honk-fg-primary outline-none placeholder:text-honk-fg-quaternary"
              />
            </div>

            <div
              data-chat-input-footer="true"
              data-chat-input-footer-compact="true"
              data-honk-composer-toolbar="bottom"
              className="flex min-w-0 shrink items-center gap-1"
            >
              <div
                data-honk-composer-toolbar="left"
                className="flex min-w-0 max-w-[46%] shrink items-center gap-1 overflow-hidden"
              >
                <span
                  className={cn(
                    workbenchChromeTextControlVariants(),
                    "max-w-44 cursor-default rounded-full px-2 transition-none hover:bg-transparent hover:text-honk-fg-secondary",
                  )}
                  aria-label="Mode: Rush"
                  title="Rush"
                >
                  <IconOpenaiCodex
                    className="size-3 shrink-0 text-honk-icon-secondary"
                    aria-hidden
                  />
                  <span className="min-w-0 truncate">Rush</span>
                </span>
              </div>

              <div
                data-chat-input-actions="right"
                data-chat-input-primary-actions-compact="true"
                className="flex shrink-0 flex-nowrap items-center justify-end gap-2"
              >
                <Button
                  type="button"
                  size="icon-sm"
                  variant="ghost"
                  className={cn(
                    "rounded-full bg-transparent text-honk-icon-secondary transition-[background-color,color,opacity] duration-100",
                    hasDraft
                      ? "enabled:cursor-pointer hover:bg-honk-bg-quaternary hover:text-honk-icon-primary"
                      : "disabled:pointer-events-none disabled:opacity-30",
                  )}
                  data-honk-composer-action="submit"
                  data-honk-composer-state="idle"
                  aria-label="Send message"
                  disabled={!hasDraft}
                >
                  <IconArrowUp className="size-3 text-current" aria-hidden />
                </Button>
              </div>
            </div>
          </div>
        </div>

        <div
          data-composer-thread-status-bar=""
          className="box-border flex min-h-6 w-full min-w-0 items-center justify-between gap-3 px-3 text-body text-honk-fg-tertiary"
        >
          <div className="flex min-w-0 items-center gap-5 overflow-hidden">
            <span className="min-w-0 truncate" title="main">
              main
            </span>
            <span className="shrink-0" title="Local">
              Local
            </span>
          </div>
          <button
            type="button"
            className="inline-flex min-w-0 items-center gap-1.5 rounded-honk-control px-1 py-0.5 text-body text-honk-fg-tertiary hover:bg-honk-bg-quaternary hover:text-honk-fg-secondary"
            aria-label="Context usage 83%"
          >
            <MarketingContextUsageRing percentage={83} />
            <span className="shrink-0 tabular-nums">83%</span>
          </button>
        </div>
      </div>
    </form>
  );
}
