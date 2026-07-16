import { StatusDot, type StatusDotTone } from "@honk/ui";
import {
  IconChevronRightMedium,
  IconFolder1,
  IconFolderAddRight,
  IconFolderOpen,
} from "central-icons";
import { useState } from "react";

import { cn } from "../../lib/classes";
import {
  demoProjectLabel,
  marketingDemoThreads,
  type MarketingDemoThreadId,
  type ThreadState,
} from "./demo-data";
import { MARKETING_SIDEBAR_WIDTH_CLASS } from "./layout";

function sidebarDotTone(threadState: ThreadState): StatusDotTone {
  if (threadState === "draft") return "draft";
  if (threadState === "needs_attention") return "warn";
  return "neutral";
}

export function MarketingSidebar(props: {
  activeThreadId: MarketingDemoThreadId;
  threadStates: Record<MarketingDemoThreadId, ThreadState>;
}) {
  const [sectionOpen, setSectionOpen] = useState(true);

  return (
    <aside
      aria-label="Agents"
      className={cn(
        MARKETING_SIDEBAR_WIDTH_CLASS,
        "relative hidden min-h-0 shrink-0 flex-col border-r border-edge-muted bg-layer-01 lg:flex",
      )}
    >
      <div className="relative z-30 flex shrink-0 flex-col gap-1 px-2 pt-2 pb-1.5 select-none">
        <button
          type="button"
          className="flex min-h-8 w-full flex-1 cursor-pointer items-center justify-start gap-2 rounded-control border border-transparent bg-transparent px-1.5 py-1 text-left text-body text-muted transition-colors select-none hover:bg-layer-02 hover:text-primary focus-visible:ring-1 focus-visible:ring-accent focus-visible:outline-none"
        >
          <IconFolderAddRight className="size-4 shrink-0 opacity-65" />
          <span className="min-w-0 flex-1 truncate">Open Workspace</span>
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-y-contain px-2 pb-2">
        <section
          className="relative flex w-full min-w-0 flex-col select-none"
          data-agent-sidebar-section=""
        >
          <div className="group/sidebar-section outline-hidden" tabIndex={-1}>
            <div
              className="flex min-h-8 w-full min-w-0 items-center justify-start gap-2 overflow-hidden rounded-control border border-transparent bg-transparent px-1.5 py-1 text-left text-body text-muted select-none [@media(hover:hover)]:hover:text-primary"
              data-agent-sidebar-section-title=""
            >
              <button
                type="button"
                aria-expanded={sectionOpen}
                onClick={() => setSectionOpen((open) => !open)}
                className="relative m-0 flex min-h-8 w-auto min-w-0 flex-1 cursor-pointer touch-manipulation items-center justify-start gap-2 border-0 bg-transparent p-0 text-inherit shadow-none outline-hidden"
              >
                <span
                  className="relative flex size-4 shrink-0 items-center justify-center text-faint"
                  data-agent-sidebar-section-folder=""
                  aria-hidden
                >
                  <IconFolder1
                    className={cn(
                      "absolute size-4 transition-[opacity,transform] duration-150 ease-out motion-reduce:transition-none [@media(hover:hover)]:group-hover/sidebar-section:opacity-0",
                      sectionOpen ? "scale-95 opacity-0" : "scale-100 opacity-100",
                    )}
                  />
                  <IconFolderOpen
                    className={cn(
                      "absolute size-4 transition-[opacity,transform] duration-150 ease-out motion-reduce:transition-none [@media(hover:hover)]:group-hover/sidebar-section:opacity-0",
                      sectionOpen ? "scale-100 opacity-100" : "scale-95 opacity-0",
                    )}
                  />
                  <span
                    className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-150 ease-out motion-reduce:transition-none [@media(hover:hover)]:group-hover/sidebar-section:opacity-100"
                    data-agent-sidebar-section-chevron=""
                  >
                    <IconChevronRightMedium
                      className={cn(
                        "size-4 shrink-0 opacity-65 transition-transform duration-150 ease-out motion-reduce:transition-none",
                        sectionOpen && "rotate-90",
                      )}
                    />
                  </span>
                </span>
                <span className="min-w-0 flex-1 truncate text-left">{demoProjectLabel}</span>
              </button>
            </div>
          </div>

          {sectionOpen ? (
            <div className="flex min-w-0 flex-col gap-px" role="region">
              {marketingDemoThreads.map((thread) => {
                const selected = thread.id === props.activeThreadId;

                return (
                  <button
                    type="button"
                    key={thread.id}
                    data-selected={selected}
                    data-chat-item=""
                    data-agent-sidebar-cell=""
                    className="group/sidebar-item relative flex min-h-8 w-full min-w-0 cursor-pointer items-center justify-start gap-2 rounded-control border border-transparent bg-transparent px-1.5 py-1 text-left text-body transition-colors select-none hover:bg-layer-02 focus-visible:ring-1 focus-visible:ring-accent focus-visible:outline-none data-[selected=true]:bg-layer-02"
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
                    <span
                      className="min-w-0 flex-1 truncate text-primary"
                      data-agent-sidebar-title=""
                    >
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
          ) : null}
        </section>
      </div>
    </aside>
  );
}
