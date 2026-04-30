import { useEffect, useMemo, useState } from "react";

import type { SidebarSectionModel } from "~/lib/sidebar-chat-view-model";
import { AgentRow } from "./row";

const initialMaxVisible = 5;
const pageStep = 8;
const nearViewportPrefetchLimit = 12;

export interface AgentListProps {
  sections: SidebarSectionModel[];
  selectedId: string | null;
  onSelectAgent: (id: string) => void;
  onNewAgent?: (cwd: string) => void;
  onPrefetchAgent?: (id: string) => void;
  loading?: boolean;
  error?: boolean;
}

function minVisibleForSelection(
  items: readonly SidebarSectionModel["items"][number][],
  selectedId: string | null,
) {
  if (items.length === 0) return 0;
  const firstPage = Math.min(items.length, initialMaxVisible);
  if (!selectedId) return firstPage;
  const index = items.findIndex((item) => item.id === selectedId);
  if (index < 0) return firstPage;
  return Math.min(items.length, Math.max(firstPage, index + 1));
}

function Section(props: {
  section: SidebarSectionModel;
  selectedId: string | null;
  onSelectAgent: (id: string) => void;
  onNewAgent?: (cwd: string) => void;
  onPrefetchAgent?: (id: string) => void;
}) {
  const { onPrefetchAgent, section } = props;
  const [open, setOpen] = useState(true);
  const [extra, setExtra] = useState(0);
  const labelId = `agent-section-label-${section.id}`;
  const panelId = `agent-section-panel-${section.id}`;
  const minVisible = useMemo(
    () => minVisibleForSelection(section.items, props.selectedId),
    [section.items, props.selectedId],
  );

  useEffect(() => {
    const needed = Math.max(0, minVisible - initialMaxVisible);
    const minimumExtra = needed === 0 ? 0 : Math.ceil(needed / pageStep);
    setExtra((count) => Math.max(count, minimumExtra));
  }, [minVisible]);

  const visible = useMemo(() => {
    const items = section.items;
    const firstPage = Math.min(items.length, initialMaxVisible);
    const rawVisible = Math.min(items.length, initialMaxVisible + extra * pageStep);
    let next = Math.max(rawVisible, minVisible);
    if (items.length - next === 1 && next < items.length) next = items.length;
    return Math.max(next, firstPage);
  }, [extra, minVisible, section.items]);

  const showMore =
    section.items.length > Math.min(section.items.length, initialMaxVisible) &&
    visible < section.items.length;

  useEffect(() => {
    if (!open || !onPrefetchAgent) {
      return;
    }
    for (const item of section.items.slice(0, visible + nearViewportPrefetchLimit)) {
      onPrefetchAgent(item.id);
    }
  }, [onPrefetchAgent, open, section.items, visible]);

  return (
    <section className="agent-sidebar-section min-w-0 w-full" data-agent-sidebar-section="">
      <div className="agent-sidebar-section-heading flex min-h-6 min-w-0 w-full items-center gap-0 px-1.5">
        <button
          id={labelId}
          type="button"
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          onClick={() => setOpen((value) => !value)}
          className={`agent-sidebar-section-toggle relative flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-multi-control px-1.5 py-0.5 text-left font-multi sidebar-label-track outline-none touch-manipulation transition-[color] duration-150 ease motion-reduce:transition-none pointer-coarse:after:absolute pointer-coarse:after:size-full pointer-coarse:after:min-h-11 pointer-coarse:after:min-w-11 focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background ${
            section.active
              ? "text-foreground/90 [@media(hover:hover)]:hover:text-foreground"
              : "text-muted-foreground/60 [@media(hover:hover)]:hover:text-muted-foreground"
          }`}
        >
          <span
            className={`agent-sidebar-section-chevron size-3 shrink-0 text-muted-foreground/50 transition-transform duration-150 ease-out motion-reduce:transition-none ${
              open ? "" : "-rotate-90"
            }`}
            aria-hidden
          >
            ▾
          </span>
          <span className="min-w-0 flex-1 truncate">{section.label}</span>
        </button>
        {props.onNewAgent ? (
          <button
            type="button"
            onClick={() => props.onNewAgent?.(section.cwd)}
            aria-label={`New agent in ${section.label}`}
            title={`New agent in ${section.label}`}
            className={`agent-sidebar-section-new relative flex size-5.5 shrink-0 cursor-pointer items-center justify-center rounded-multi-control outline-none touch-manipulation transition-[color,background-color] duration-150 ease motion-reduce:transition-none pointer-coarse:after:absolute pointer-coarse:after:size-full pointer-coarse:after:min-h-11 pointer-coarse:after:min-w-11 focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background ${
              section.active
                ? "text-foreground/65 [@media(hover:hover)]:hover:bg-multi-hover [@media(hover:hover)]:hover:text-foreground"
                : "text-muted-foreground/55 [@media(hover:hover)]:hover:bg-multi-hover [@media(hover:hover)]:hover:text-muted-foreground"
            }`}
          >
            <span aria-hidden>+</span>
          </button>
        ) : null}
      </div>
      {open ? (
        <div
          id={panelId}
          className="agent-sidebar-section-items flex flex-col gap-px"
          role="region"
          aria-labelledby={labelId}
        >
          {section.items.slice(0, visible).map((item) => (
            <AgentRow
              key={item.id}
              item={item}
              selected={props.selectedId === item.id}
              onSelectAgent={props.onSelectAgent}
              {...(props.onPrefetchAgent ? { onPrefetchAgent: props.onPrefetchAgent } : {})}
            />
          ))}
          {showMore ? (
            <button
              type="button"
              onClick={() => setExtra((count) => count + 1)}
              className="agent-sidebar-more relative flex min-h-6 w-full cursor-pointer items-center gap-1.5 rounded-multi-control px-1.5 py-0.5 text-left font-multi text-[11px]/[14px] text-muted-foreground/65 outline-none touch-manipulation transition-[color,background-color] duration-150 ease motion-reduce:transition-none pointer-coarse:after:absolute pointer-coarse:after:size-full pointer-coarse:after:min-h-11 pointer-coarse:after:min-w-11 focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background [@media(hover:hover)]:hover:bg-multi-hover [@media(hover:hover)]:hover:text-muted-foreground"
            >
              <span className="size-3 shrink-0 opacity-55" aria-hidden>
                ⋯
              </span>
              <span className="min-w-0">More</span>
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function SkeletonRows() {
  return (
    <div className="agent-sidebar-list flex min-h-0 flex-1 flex-col gap-px overflow-y-auto px-2 py-1.5 [scrollbar-gutter:stable]">
      {[0, 1].map((i) => (
        <div className="flex flex-col gap-2" key={i}>
          <div
            className="h-3 w-16 animate-pulse rounded-multi-control bg-[var(--cursor-bg-tertiary)]"
            data-skeleton={i}
          />
          <div className="flex flex-col gap-1">
            {[0, 1, 2].map((j) => (
              <div
                key={j}
                className="h-8 w-full animate-pulse rounded-multi-control bg-[var(--cursor-bg-tertiary)]"
                data-skeleton={j}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function AgentList(props: AgentListProps) {
  if (props.loading) {
    return <SkeletonRows />;
  }

  if (props.error) {
    return (
      <p className="px-2 py-4 text-detail text-muted-foreground/60">
        Unable to load chats right now.
      </p>
    );
  }

  if (props.sections.length === 0) {
    return (
      <p className="px-2 py-4 text-detail text-muted-foreground/60">
        No chats yet. Start a chat to begin.
      </p>
    );
  }

  return (
    <div className="agent-sidebar-list flex min-h-0 flex-1 flex-col gap-px overflow-y-auto px-2 py-1.5 [scrollbar-gutter:stable]">
      {props.sections.map((section) => (
        <Section
          key={section.id}
          section={section}
          selectedId={props.selectedId}
          onSelectAgent={props.onSelectAgent}
          {...(props.onNewAgent ? { onNewAgent: props.onNewAgent } : {})}
          {...(props.onPrefetchAgent ? { onPrefetchAgent: props.onPrefetchAgent } : {})}
        />
      ))}
    </div>
  );
}
