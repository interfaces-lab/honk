import { scopeProjectRef } from "@multi/client-runtime";
import type { ScopedThreadRef } from "@multi/contracts";
import { IconChevronRightMedium } from "central-icons";
import { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { SidebarSectionContextMenu } from "~/components/shell/sidebar/thread-context-menu";
import { resolveAndPersistPreferredEditor } from "~/editor/preferences";
import { retainThreadDetailSubscription } from "~/environments/runtime/service";
import { useThreadActions } from "~/hooks/use-thread-actions";
import { useMountEffect } from "~/hooks/use-mount-effect";
import type { SidebarSectionModel } from "~/lib/sidebar-chat-view-model";
import { getSidebarThreadIdsToPrewarm } from "~/lib/thread-sidebar";
import { useThreadUnreadStore } from "~/stores/thread-unread-store";
import { readLocalApi } from "~/local-api";
import { AgentRow } from "./row";

const initialMaxVisible = 5;
const pageStep = 8;
const nearViewportPrefetchLimit = 12;
const EMPTY_VISIBLE_THREAD_REFS: readonly ScopedThreadRef[] = [];

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

function areSameThreadRefs(
  left: readonly ScopedThreadRef[],
  right: readonly ScopedThreadRef[],
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (threadRef, index) =>
        threadRef.environmentId === right[index]?.environmentId &&
        threadRef.threadId === right[index]?.threadId,
    )
  );
}

function createThreadRefsKey(threadRefs: readonly ScopedThreadRef[]): string {
  return threadRefs
    .map((threadRef) => `${threadRef.environmentId}:${threadRef.threadId}`)
    .join("\0");
}

function createSectionItemIdsKey(items: readonly { id: string }[]): string {
  return items.map((item) => item.id).join("\0");
}

function useCallbackIdentityVersion<
  TCallback extends ((...args: never[]) => unknown) | undefined,
>(callback: TCallback): number {
  const callbackRef = useRef<TCallback>(callback);
  const versionRef = useRef(0);
  if (callbackRef.current !== callback) {
    callbackRef.current = callback;
    versionRef.current += 1;
  }
  return versionRef.current;
}

function Section(props: {
  section: SidebarSectionModel;
  selectedId: string | null;
  onSelectAgent: (id: string) => void;
  onNewAgent?: (cwd: string) => void;
  onPrefetchAgent?: (id: string) => void;
  onVisibleThreadRefsChange: (
    sectionId: string,
    threadRefs: readonly ScopedThreadRef[],
  ) => void;
}) {
  const { onPrefetchAgent, section } = props;
  const prefetchAgentVersion = useCallbackIdentityVersion(onPrefetchAgent);
  const { archiveThreads, removeProjectFromSidebar } = useThreadActions();
  const clearThreadUnread = useThreadUnreadStore((store) => store.clear);
  const [open, setOpen] = useState(true);
  const [extra, setExtra] = useState(0);
  const labelId = `agent-section-label-${section.id}`;
  const panelId = `agent-section-panel-${section.id}`;
  const minVisible = useMemo(
    () => minVisibleForSelection(section.items, props.selectedId),
    [section.items, props.selectedId],
  );
  const neededForSelection = Math.max(0, minVisible - initialMaxVisible);
  const minimumExtraForSelection =
    neededForSelection === 0 ? 0 : Math.ceil(neededForSelection / pageStep);
  const effectiveExtra = Math.max(extra, minimumExtraForSelection);

  const visible = useMemo(() => {
    const items = section.items;
    const firstPage = Math.min(items.length, initialMaxVisible);
    const rawVisible = Math.min(
      items.length,
      initialMaxVisible + effectiveExtra * pageStep,
    );
    let next = Math.max(rawVisible, minVisible);
    if (items.length - next === 1 && next < items.length) next = items.length;
    return Math.max(next, firstPage);
  }, [effectiveExtra, minVisible, section.items]);

  const showMore =
    section.items.length > Math.min(section.items.length, initialMaxVisible) &&
    visible < section.items.length;
  const canRemoveProject =
    section.environmentId !== undefined &&
    section.projectId !== undefined &&
    section.projectCwd !== undefined;
  const visibleThreadRefs = useMemo(
    () =>
      open
        ? section.items
            .slice(0, visible)
            .flatMap((item) => (item.kind === "thread" ? [item.threadRef] : []))
        : EMPTY_VISIBLE_THREAD_REFS,
    [open, section.items, visible],
  );
  const visibleThreadRefsKey = useMemo(
    () => createThreadRefsKey(visibleThreadRefs),
    [visibleThreadRefs],
  );
  const prefetchItems = useMemo(
    () =>
      open ? section.items.slice(0, visible + nearViewportPrefetchLimit) : [],
    [open, section.items, visible],
  );
  const prefetchItemsKey = useMemo(
    () => createSectionItemIdsKey(prefetchItems),
    [prefetchItems],
  );

  const openSectionInEditor = useCallback(() => {
    const localApi = readLocalApi();
    if (!localApi) {
      toast.error("Local API unavailable.");
      return;
    }

    void localApi.server
      .getConfig()
      .then((config) => {
        const editor = resolveAndPersistPreferredEditor(
          config.availableEditors.filter(
            (editorId) => editorId !== "file-manager",
          ),
        );
        if (!editor) {
          throw new Error("No available code editor found.");
        }
        return localApi.shell.openInEditor(
          section.projectCwd ?? section.cwd,
          editor,
        );
      })
      .catch((error) => {
        toast.error("Failed to open project", {
          description:
            error instanceof Error ? error.message : "An error occurred.",
        });
      });
  }, [section.cwd, section.projectCwd]);

  const markSectionRead = useCallback(() => {
    for (const threadRef of section.threadRefs) {
      clearThreadUnread(threadRef.threadId);
    }
  }, [clearThreadUnread, section.threadRefs]);

  const archiveSectionThreads = useCallback(() => {
    void archiveThreads(section.threadRefs).catch((error) => {
      toast.error("Failed to archive threads", {
        description:
          error instanceof Error ? error.message : "An error occurred.",
      });
    });
  }, [archiveThreads, section.threadRefs]);

  const removeSectionProject = useCallback(() => {
    if (!section.environmentId || !section.projectId) {
      return;
    }
    void removeProjectFromSidebar(
      scopeProjectRef(section.environmentId, section.projectId),
    ).catch((error) => {
      toast.error("Failed to remove project", {
        description:
          error instanceof Error ? error.message : "An error occurred.",
      });
    });
  }, [removeProjectFromSidebar, section.environmentId, section.projectId]);

  const { onVisibleThreadRefsChange } = props;

  return (
    <section
      className="flex min-w-0 w-full select-none flex-col"
      data-agent-sidebar-section=""
    >
      {onPrefetchAgent ? (
        <SectionPrefetchSync
          key={`${section.id}:${prefetchAgentVersion}:${prefetchItemsKey}`}
          items={prefetchItems}
          onPrefetchAgent={onPrefetchAgent}
        />
      ) : null}
      <SectionVisibleThreadRefsSync
        key={`${section.id}:${visibleThreadRefsKey}`}
        onVisibleThreadRefsChange={onVisibleThreadRefsChange}
        sectionId={section.id}
        threadRefs={visibleThreadRefs}
      />
      <SidebarSectionContextMenu
        hasThreads={section.threadRefs.length > 0}
        canRemoveProject={canRemoveProject}
        onOpenInEditor={openSectionInEditor}
        onMarkAllRead={markSectionRead}
        onArchiveAll={archiveSectionThreads}
        onRemoveFromSidebar={removeSectionProject}
      >
        <div className="group/agent-section-title flex h-6 min-h-6 min-w-0 w-full items-center gap-0 px-1.5">
          <button
            id={labelId}
            type="button"
            aria-expanded={open}
            aria-controls={open ? panelId : undefined}
            onClick={() => setOpen((value) => !value)}
            className="relative m-0 inline-flex min-h-0 min-w-0 flex-auto cursor-(--multi-button-cursor) touch-manipulation items-center gap-1 border-0 bg-transparent p-0 font-multi leading-(--multi-sidebar-label-leading) text-inherit shadow-none outline-none focus-visible:rounded focus-visible:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--multi-stroke-focused)_92%,transparent)]"
          >
            <span className="min-w-0 flex-[0_1_auto] overflow-hidden text-ellipsis whitespace-nowrap text-multi-fg-tertiary text-(length:--multi-sidebar-label-size) font-(--multi-sidebar-label-weight) leading-(--multi-sidebar-label-leading)">
              {section.label}
            </span>
            <IconChevronRightMedium
              size={14}
              className={`inline-flex size-3.5 shrink-0 items-center justify-center text-multi-fg-tertiary opacity-0 transition-[opacity,transform] duration-100 ease-out group-hover/agent-section-title:opacity-100 group-focus-within/agent-section-title:opacity-100 pointer-coarse:opacity-100 motion-reduce:transition-none ${
                open ? "rotate-90" : ""
              }`}
              aria-hidden
            />
          </button>
          {props.onNewAgent ? (
            <button
              type="button"
              onClick={() => props.onNewAgent?.(section.cwd)}
              aria-label={`New agent in ${section.label}`}
              title={`New agent in ${section.label}`}
              className={`relative flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-multi-control border border-transparent p-0 opacity-0 outline-none touch-manipulation transition-[color,background-color,opacity] duration-100 ease-out group-hover/agent-section-title:opacity-100 group-focus-within/agent-section-title:opacity-100 motion-reduce:transition-none pointer-coarse:opacity-100 pointer-coarse:after:absolute pointer-coarse:after:size-full pointer-coarse:after:min-h-11 pointer-coarse:after:min-w-11 focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-0 ${
                section.active
                  ? "text-multi-fg-secondary [@media(hover:hover)]:hover:bg-multi-bg-quaternary [@media(hover:hover)]:hover:text-multi-fg-primary"
                  : "text-multi-fg-tertiary [@media(hover:hover)]:hover:bg-multi-bg-quaternary [@media(hover:hover)]:hover:text-multi-fg-primary"
              }`}
            >
              <span aria-hidden>+</span>
            </button>
          ) : null}
        </div>
      </SidebarSectionContextMenu>
      {open ? (
        <div
          id={panelId}
          className="flex min-w-0 flex-col gap-px pb-[11px]"
          role="region"
          aria-labelledby={labelId}
        >
          {section.items.slice(0, visible).map((item) => (
            <AgentRow
              key={item.id}
              item={item}
              selected={props.selectedId === item.id}
              onSelectAgent={props.onSelectAgent}
              {...(props.onPrefetchAgent
                ? { onPrefetchAgent: props.onPrefetchAgent }
                : {})}
            />
          ))}
          {showMore ? (
            <button
              type="button"
              onClick={() => setExtra((count) => count + 1)}
              className="relative flex min-h-6 w-full select-none cursor-pointer items-center gap-1.5 rounded-multi-control border border-transparent px-1.5 py-0.5 text-left font-multi text-(length:--multi-sidebar-label-size) font-normal leading-(--multi-sidebar-label-leading) text-multi-fg-tertiary outline-none touch-manipulation transition-[color,background-color] duration-100 ease-out motion-reduce:transition-none pointer-coarse:after:absolute pointer-coarse:after:size-full pointer-coarse:after:min-h-11 pointer-coarse:after:min-w-11 focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-0 [@media(hover:hover)]:hover:bg-multi-bg-quaternary [@media(hover:hover)]:hover:text-multi-fg-primary"
            >
              <span className="size-2.5 shrink-0 opacity-55" aria-hidden>
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

function SectionPrefetchSync({
  items,
  onPrefetchAgent,
}: {
  items: readonly { id: string }[];
  onPrefetchAgent: (id: string) => void;
}) {
  useMountEffect(() => {
    for (const item of items) {
      onPrefetchAgent(item.id);
    }
  });

  return null;
}

function SectionVisibleThreadRefsSync({
  onVisibleThreadRefsChange,
  sectionId,
  threadRefs,
}: {
  onVisibleThreadRefsChange: (
    sectionId: string,
    threadRefs: readonly ScopedThreadRef[],
  ) => void;
  sectionId: string;
  threadRefs: readonly ScopedThreadRef[];
}) {
  useMountEffect(() => {
    onVisibleThreadRefsChange(sectionId, threadRefs);
  });

  return null;
}

function AgentListContent(props: AgentListProps) {
  const [visibleThreadRefsBySectionId, setVisibleThreadRefsBySectionId] =
    useState<Record<string, readonly ScopedThreadRef[]>>({});
  const onVisibleThreadRefsChange = useCallback(
    (sectionId: string, threadRefs: readonly ScopedThreadRef[]) => {
      setVisibleThreadRefsBySectionId((current) => {
        const previousThreadRefs =
          current[sectionId] ?? EMPTY_VISIBLE_THREAD_REFS;
        if (areSameThreadRefs(previousThreadRefs, threadRefs)) {
          return current;
        }
        if (threadRefs.length === 0) {
          if (!(sectionId in current)) {
            return current;
          }
          const next = { ...current };
          delete next[sectionId];
          return next;
        }
        return {
          ...current,
          [sectionId]: threadRefs,
        };
      });
    },
    [],
  );
  const visibleThreadRefs = useMemo(
    () =>
      props.sections.flatMap(
        (section) =>
          visibleThreadRefsBySectionId[section.id] ?? EMPTY_VISIBLE_THREAD_REFS,
      ),
    [props.sections, visibleThreadRefsBySectionId],
  );
  const prewarmedSidebarThreadRefs = useMemo(
    () => getSidebarThreadIdsToPrewarm(visibleThreadRefs),
    [visibleThreadRefs],
  );
  const prewarmedSidebarThreadRefsKey = useMemo(
    () => createThreadRefsKey(prewarmedSidebarThreadRefs),
    [prewarmedSidebarThreadRefs],
  );

  return (
    <div className="sidebar-body flex min-h-0 flex-1 flex-col gap-px overflow-y-auto px-2 pt-0 pb-4 scrollbar-gutter-stable">
      <RetainedThreadDetailSubscriptions
        key={prewarmedSidebarThreadRefsKey}
        threadRefs={prewarmedSidebarThreadRefs}
      />
      {props.sections.map((section) => (
        <Section
          key={section.id}
          section={section}
          selectedId={props.selectedId}
          onSelectAgent={props.onSelectAgent}
          onVisibleThreadRefsChange={onVisibleThreadRefsChange}
          {...(props.onNewAgent ? { onNewAgent: props.onNewAgent } : {})}
          {...(props.onPrefetchAgent
            ? { onPrefetchAgent: props.onPrefetchAgent }
            : {})}
        />
      ))}
    </div>
  );
}

function RetainedThreadDetailSubscriptions({
  threadRefs,
}: {
  threadRefs: readonly ScopedThreadRef[];
}) {
  useMountEffect(() => {
    const releases = threadRefs.map((threadRef) =>
      retainThreadDetailSubscription(
        threadRef.environmentId,
        threadRef.threadId,
      ),
    );

    return () => {
      for (const release of releases) {
        release();
      }
    };
  });

  return null;
}

function SkeletonRows() {
  return (
    <div className="sidebar-body flex min-h-0 flex-1 flex-col gap-px overflow-y-auto px-2 pt-0 pb-4 scrollbar-gutter-stable">
      {[0, 1].map((i) => (
        <div className="flex flex-col gap-2" key={i}>
          <div
            className="h-3 w-16 animate-pulse rounded-multi-control bg-multi-bg-tertiary"
            data-skeleton={i}
          />
          <div className="flex flex-col gap-px pb-[11px]">
            {[0, 1, 2].map((j) => (
              <div
                key={j}
                className="h-7 w-full animate-pulse rounded-multi-control bg-multi-bg-tertiary"
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
      <p className="px-2 py-4 text-(length:--multi-sidebar-label-size) leading-(--multi-sidebar-label-leading) text-muted-foreground/60">
        Unable to load chats right now.
      </p>
    );
  }

  if (props.sections.length === 0) {
    return (
      <p className="px-2 py-4 text-(length:--multi-sidebar-label-size) leading-(--multi-sidebar-label-leading) text-muted-foreground/60">
        No chats yet. Start a chat to begin.
      </p>
    );
  }

  return <AgentListContent {...props} />;
}
