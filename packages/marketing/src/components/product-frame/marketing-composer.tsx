import { IconArrowUp, IconOpenaiCodex, IconPlusSmall } from "central-icons";
import { useState } from "react";

import { cn } from "../../lib/classes";

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
        className="block size-full -rotate-90 transform-gpu"
      >
        <circle
          cx={CONTEXT_RING_CENTER}
          cy={CONTEXT_RING_CENTER}
          r={CONTEXT_RING_RADIUS}
          fill="none"
          stroke="var(--honk-color-border-muted)"
          strokeWidth={CONTEXT_RING_STROKE}
        />
        <circle
          cx={CONTEXT_RING_CENTER}
          cy={CONTEXT_RING_CENTER}
          r={CONTEXT_RING_RADIUS}
          fill="none"
          stroke="var(--honk-color-text-muted)"
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
      className="max-w-agent-chat mx-auto w-full min-w-0"
      data-variant="compact"
      data-layout="thread"
      data-chat-input-form="true"
      onSubmit={(event) => {
        event.preventDefault();
      }}
    >
      <div
        className="max-w-agent-chat mx-auto flex w-full min-w-0 flex-col gap-2"
        data-variant="compact"
      >
        <div
          className="group relative w-full max-w-full min-w-0 overflow-hidden"
          data-honk-composer-surface=""
          data-variant="compact"
        >
          <div
            className="grid min-h-16 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-panel bg-base px-3 py-2 shadow-raised"
            data-honk-composer-shell="thread"
          >
            <button
              type="button"
              className="inline-flex size-7 items-center justify-center rounded-pill bg-layer-02 text-faint transition-colors hover:bg-layer-03 hover:text-muted focus-visible:ring-1 focus-visible:ring-accent focus-visible:outline-none"
              aria-label="Attach images"
            >
              <IconPlusSmall className="size-3.5 shrink-0" aria-hidden />
            </button>

            <div className="relative min-w-0 flex-1 cursor-text select-text">
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                rows={1}
                placeholder="Send follow-up"
                data-prompt-editor-input="true"
                className="w-full resize-none border-0 bg-transparent p-0 text-primary outline-none placeholder:text-faint"
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
                className="flex max-w-[46%] min-w-0 shrink items-center gap-1 overflow-hidden"
              >
                <span
                  className="inline-flex h-7 max-w-44 min-w-0 cursor-default items-center justify-start gap-1.5 overflow-hidden rounded-pill border-0 bg-transparent px-2 text-detail font-normal text-muted shadow-none outline-hidden select-none"
                  aria-label="Mode: Rush"
                  title="Rush"
                >
                  <IconOpenaiCodex className="size-3 shrink-0 text-muted" aria-hidden />
                  <span className="min-w-0 truncate">Rush</span>
                </span>
              </div>

              <div
                data-chat-input-actions="right"
                data-chat-input-primary-actions-compact="true"
                className="flex shrink-0 flex-nowrap items-center justify-end gap-2"
              >
                <button
                  type="button"
                  className={cn(
                    "inline-flex size-7 items-center justify-center rounded-pill bg-transparent text-muted transition-[background-color,color,opacity] duration-100 focus-visible:ring-1 focus-visible:ring-accent focus-visible:outline-none",
                    hasDraft
                      ? "enabled:cursor-pointer hover:bg-layer-02 hover:text-primary"
                      : "disabled:pointer-events-none disabled:opacity-30",
                  )}
                  data-honk-composer-action="submit"
                  data-honk-composer-state="idle"
                  aria-label="Send message"
                  disabled={!hasDraft}
                >
                  <IconArrowUp className="size-3 text-current" aria-hidden />
                </button>
              </div>
            </div>
          </div>
        </div>

        <div
          data-composer-thread-status-bar=""
          className="box-border flex min-h-6 w-full min-w-0 items-center justify-between gap-3 px-3 text-body text-faint"
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
            className="inline-flex min-w-0 items-center gap-1.5 rounded-control px-1 py-0.5 text-body text-faint hover:bg-layer-02 hover:text-muted"
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
