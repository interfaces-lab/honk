import { StatusDot } from "@honk/honkkit/status-dot";
import { SidebarButton } from "@honk/honkkit/sidebar";
import { cn } from "@honk/honkkit/utils";
import { useCallback } from "react";

import { marketingDemoThreads, type MarketingDemoThreadId, type ThreadState } from "./demo-data";

function sidebarDotState(
  threadState: ThreadState,
): "draft" | "running" | "doneUnseen" | "doneSeen" | "needsAttention" {
  if (threadState === "draft") return "draft";
  if (threadState === "running") return "running";
  if (threadState === "needs_attention") return "needsAttention";
  return "doneSeen";
}

export function MarketingMobileThreadRail(props: {
  activeThreadId: MarketingDemoThreadId;
  threadStates: Record<MarketingDemoThreadId, ThreadState>;
}) {
  const scrollToActive = useCallback((node: HTMLElement | null) => {
    if (node) {
      node.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }, []);

  return (
    <div
      aria-label="Threads"
      className="flex min-h-0 shrink-0 border-b border-honk-stroke-tertiary bg-honk-sidebar lg:hidden"
      data-marketing-mobile-thread-rail=""
    >
      <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto overscroll-x-contain px-2 py-1.5 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {marketingDemoThreads.map((thread) => {
          const selected = thread.id === props.activeThreadId;

          return (
            <SidebarButton
              key={thread.id}
              ref={selected ? scrollToActive : undefined}
              variant="item"
              data-selected={selected}
              data-chat-item=""
              data-agent-sidebar-cell=""
              className={cn(
                "h-auto min-h-sidebar-item w-auto max-w-[min(72vw,16rem)] shrink-0 px-2",
                selected ? "bg-honk-bg-quaternary" : "bg-transparent",
              )}
            >
              <span
                className="flex size-5 shrink-0 items-center justify-center text-honk-icon-secondary"
                data-agent-sidebar-status=""
              >
                <StatusDot
                  state={sidebarDotState(props.threadStates[thread.id])}
                  className="size-4 shrink-0"
                  aria-hidden
                />
              </span>
              <span
                className="min-w-0 flex-1 truncate text-honk-fg-primary"
                data-agent-sidebar-title=""
              >
                {thread.title}
              </span>
              <span
                className="min-w-8 max-w-14 shrink-0 truncate text-right text-sidebar-subtitle text-honk-fg-secondary tabular-nums"
                data-agent-sidebar-subtitle=""
              >
                {thread.ago}
              </span>
            </SidebarButton>
          );
        })}
      </div>
    </div>
  );
}
