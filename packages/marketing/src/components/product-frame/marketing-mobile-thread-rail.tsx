import { StatusDot, type StatusDotTone } from "@honk/ui";

import { cn } from "../../lib/classes";
import { marketingDemoThreads, type MarketingDemoThreadId, type ThreadState } from "./demo-data";

function sidebarDotTone(threadState: ThreadState): StatusDotTone {
  if (threadState === "draft") return "draft";
  if (threadState === "needs_attention") return "warn";
  return "neutral";
}

function scrollToActive(node: HTMLElement | null): void {
  node?.scrollIntoView({ block: "nearest", inline: "nearest" });
}

export function MarketingMobileThreadRail(props: {
  activeThreadId: MarketingDemoThreadId;
  threadStates: Record<MarketingDemoThreadId, ThreadState>;
}) {
  return (
    <div
      aria-label="Threads"
      className="flex min-h-0 shrink-0 border-b border-edge-muted bg-layer-01 lg:hidden"
      data-marketing-mobile-thread-rail=""
    >
      <div className="flex min-w-0 flex-1 scrollbar-none gap-1 overflow-x-auto overscroll-x-contain px-2 py-1.5 [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
        {marketingDemoThreads.map((thread) => {
          const selected = thread.id === props.activeThreadId;

          return (
            <button
              type="button"
              key={thread.id}
              ref={selected ? scrollToActive : undefined}
              data-selected={selected}
              data-chat-item=""
              data-agent-sidebar-cell=""
              className={cn(
                "flex min-h-8 w-auto max-w-[min(72vw,16rem)] shrink-0 items-center justify-start gap-2 rounded-control border border-transparent px-2 py-1 text-left text-body transition-colors outline-none select-none focus-visible:ring-1 focus-visible:ring-accent",
                selected ? "bg-layer-02" : "bg-transparent hover:bg-layer-02",
              )}
            >
              <span
                className="flex size-5 shrink-0 items-center justify-center text-muted"
                data-agent-sidebar-status=""
              >
                <StatusDot
                  tone={sidebarDotTone(props.threadStates[thread.id])}
                  style={{ width: 16, height: 16 }}
                />
              </span>
              <span className="min-w-0 flex-1 truncate text-primary" data-agent-sidebar-title="">
                {thread.title}
              </span>
              <span
                className="max-w-14 min-w-8 shrink-0 truncate text-right text-caption text-muted tabular-nums"
                data-agent-sidebar-subtitle=""
              >
                {thread.ago}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
