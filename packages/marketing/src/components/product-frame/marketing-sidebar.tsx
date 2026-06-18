import { StatusDot } from "@honk/honkkit/status-dot";
import { SidebarButton, SidebarItem } from "@honk/honkkit/sidebar";
import { cn } from "@honk/honkkit/utils";
import {
  IconChevronRightMedium,
  IconFolder1,
  IconFolderAddRight,
  IconFolderOpen,
} from "central-icons";
import { useState } from "react";

import {
  demoProjectLabel,
  marketingDemoThreads,
  type MarketingDemoThreadId,
  type ThreadState,
} from "./demo-data";
import { MARKETING_SIDEBAR_WIDTH_CLASS } from "./layout";

function sidebarDotState(
  threadState: ThreadState,
): "draft" | "running" | "doneUnseen" | "doneSeen" | "needsAttention" {
  if (threadState === "draft") return "draft";
  if (threadState === "running") return "running";
  if (threadState === "needs_attention") return "needsAttention";
  return "doneSeen";
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
        "honk-shell-sidebar relative hidden min-h-0 shrink-0 flex-col border-r border-honk-stroke-tertiary bg-honk-sidebar lg:flex",
      )}
    >
      <div className="relative z-30 flex shrink-0 flex-col gap-1 px-2 pt-2 pb-1.5 select-none">
        <SidebarButton
          variant="chrome"
          className="w-full flex-1 text-honk-fg-secondary hover:bg-honk-bg-quaternary hover:text-honk-fg-primary"
        >
          <IconFolderAddRight className="size-4 shrink-0 opacity-65" />
          <span className="min-w-0 flex-1 truncate">Open Workspace</span>
        </SidebarButton>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-y-contain px-2 pb-2">
        <section className="relative flex w-full min-w-0 flex-col select-none" data-agent-sidebar-section="">
          <div className="group/sidebar-section outline-hidden" tabIndex={-1}>
            <SidebarItem
              render={<div />}
              className="overflow-hidden text-honk-fg-secondary [@media(hover:hover)]:hover:text-honk-fg-primary"
              data-agent-sidebar-section-title=""
            >
              <button
                type="button"
                aria-expanded={sectionOpen}
                onClick={() => setSectionOpen((open) => !open)}
                className="relative m-0 flex min-h-sidebar-item w-auto min-w-0 flex-1 cursor-pointer touch-manipulation items-center justify-start gap-sidebar-item-gap border-0 bg-transparent p-0 text-inherit shadow-none outline-hidden"
              >
                <span
                  className="relative flex size-4 shrink-0 items-center justify-center text-honk-icon-tertiary"
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
                    className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-150 ease-out [@media(hover:hover)]:group-hover/sidebar-section:opacity-100 motion-reduce:transition-none"
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
            </SidebarItem>
          </div>

          {sectionOpen ? (
            <div className="flex min-w-0 flex-col gap-px" role="region">
              {marketingDemoThreads.map((thread) => {
                const selected = thread.id === props.activeThreadId;

                return (
                  <SidebarButton
                    key={thread.id}
                    variant="item"
                    data-selected={selected}
                    data-chat-item=""
                    data-agent-sidebar-cell=""
                    className="group/sidebar-item relative h-auto"
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
          ) : null}
        </section>
      </div>
    </aside>
  );
}
