import type { ScopedThreadRef } from "@multi/contracts";
import { SidebarItem } from "@multi/multikit/sidebar";
import { IconChevronRightMedium, IconFolderAddRight } from "central-icons";
import { type DragEvent, useCallback, useId, useMemo, useState } from "react";

import { useThreadActions } from "~/hooks/use-thread-actions";
import { useUiStateStore } from "~/stores/ui-state-store";
import { cn } from "~/lib/utils";
import { EMPTY_VISIBLE_THREAD_REFS, sidebarThreadPrewarmLimit } from "./constants";
import type { SidebarDragPayload, SidebarDropTarget } from "./drag-and-drop";
import { areSameThreadRefs, createThreadRefsKey } from "./keys";
import { AgentSidebarSection } from "./section";
import { RetainedThreadDetailSubscriptions } from "./section-sync";
import type { AgentSidebarProps, SidebarSectionModel } from "./types";

export function AgentSidebarBody(props: AgentSidebarProps) {
  const { archiveThread, archiveThreads, commitRename, removeProjectFromSidebar } =
    useThreadActions();
  const reorderProjects = useUiStateStore((store) => store.reorderProjects);
  const [dragPayload, setDragPayload] = useState<SidebarDragPayload | null>(null);
  const [dropTarget, setDropTarget] = useState<SidebarDropTarget | null>(null);
  const [workspaceCollectionOpen, setWorkspaceCollectionOpen] = useState(true);
  const [visibleThreadRefsBySectionId, setVisibleThreadRefsBySectionId] = useState<
    Record<string, readonly ScopedThreadRef[]>
  >({});
  const workspaceCollectionLabelId = useId();
  const workspaceCollectionPanelId = useId();
  const onSidebarDragStart = useCallback(
    (event: DragEvent<HTMLElement>, payload: SidebarDragPayload) => {
      event.stopPropagation();
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", payload.sectionId);
      setDragPayload(payload);
      setDropTarget(null);
    },
    [],
  );
  const onSidebarDragEnd = useCallback(() => {
    setDragPayload(null);
    setDropTarget(null);
  }, []);
  const onSidebarDragOver = useCallback(
    (event: DragEvent<HTMLElement>, target: SidebarDragPayload) => {
      if (
        !dragPayload ||
        dragPayload.sectionId === target.sectionId ||
        target.projectOrderKeys.length === 0
      ) {
        setDropTarget(null);
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "move";

      const previousPosition =
        dropTarget?.sectionId === target.sectionId ? dropTarget.position : null;

      const rect = event.currentTarget.getBoundingClientRect();
      const y = event.clientY - rect.top;
      const position =
        y < rect.height * 0.4
          ? "before"
          : y > rect.height * 0.6
            ? "after"
            : (previousPosition ?? (y < rect.height / 2 ? "before" : "after"));

      setDropTarget((current) => {
        if (current?.sectionId === target.sectionId && current.position === position) {
          return current;
        }
        return { ...target, position };
      });
    },
    [dragPayload, dropTarget],
  );
  const onSidebarDrop = useCallback(
    (event: DragEvent<HTMLElement>, target: SidebarDragPayload) => {
      if (
        !dragPayload ||
        dragPayload.sectionId === target.sectionId ||
        target.projectOrderKeys.length === 0
      ) {
        setDropTarget(null);
        return;
      }

      let position = dropTarget?.sectionId === target.sectionId ? dropTarget.position : null;
      if (!position) {
        const rect = event.currentTarget.getBoundingClientRect();
        position = event.clientY - rect.top > rect.height / 2 ? "after" : "before";
      }

      event.preventDefault();
      event.stopPropagation();
      reorderProjects(dragPayload.projectOrderKeys, target.projectOrderKeys, position === "after");

      setDragPayload(null);
      setDropTarget(null);
    },
    [dragPayload, dropTarget, reorderProjects],
  );
  const onVisibleThreadRefsChange = useCallback(
    (sectionId: string, threadRefs: readonly ScopedThreadRef[]) => {
      setVisibleThreadRefsBySectionId((current) => {
        const previousThreadRefs = current[sectionId] ?? EMPTY_VISIBLE_THREAD_REFS;
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
  const pinnedSections = useMemo(
    () => props.sections.filter((section) => section.id === "pinned"),
    [props.sections],
  );
  const workspaceSections = useMemo(
    () => props.sections.filter((section) => section.id !== "pinned"),
    [props.sections],
  );
  const visibleSectionIds = useMemo(
    () =>
      new Set(
        [...pinnedSections, ...(workspaceCollectionOpen ? workspaceSections : [])].map(
          (section) => section.id,
        ),
      ),
    [pinnedSections, workspaceCollectionOpen, workspaceSections],
  );
  const visibleThreadRefs = useMemo(
    () =>
      props.sections.flatMap((section) =>
        visibleSectionIds.has(section.id)
          ? (visibleThreadRefsBySectionId[section.id] ?? EMPTY_VISIBLE_THREAD_REFS)
          : EMPTY_VISIBLE_THREAD_REFS,
      ),
    [props.sections, visibleSectionIds, visibleThreadRefsBySectionId],
  );
  const prewarmedSidebarThreadRefs = useMemo(
    () => visibleThreadRefs.slice(0, sidebarThreadPrewarmLimit),
    [visibleThreadRefs],
  );
  const prewarmedSidebarThreadRefsKey = useMemo(
    () => createThreadRefsKey(prewarmedSidebarThreadRefs),
    [prewarmedSidebarThreadRefs],
  );
  const showWorkspaceCollection =
    workspaceSections.length > 0 || props.onOpenWorkspace !== undefined;

  const renderSection = (section: SidebarSectionModel) => (
    <AgentSidebarSection
      key={section.id}
      section={section}
      selectedId={
        props.selectedId && section.items.some((item) => item.id === props.selectedId)
          ? props.selectedId
          : null
      }
      dragPayload={dragPayload}
      dropTarget={dropTarget}
      onSidebarDragEnd={onSidebarDragEnd}
      onSidebarDragOver={onSidebarDragOver}
      onSidebarDragStart={onSidebarDragStart}
      onSidebarDrop={onSidebarDrop}
      archiveThread={archiveThread}
      archiveThreads={archiveThreads}
      commitRename={commitRename}
      removeProjectFromSidebar={removeProjectFromSidebar}
      onSelectAgent={props.onSelectAgent}
      onVisibleThreadRefsChange={onVisibleThreadRefsChange}
      {...(props.onNewAgent ? { onNewAgent: props.onNewAgent } : {})}
      {...(props.onPrefetchAgent ? { onPrefetchAgent: props.onPrefetchAgent } : {})}
    />
  );

  return (
    <div className="sidebar-body flex min-h-0 flex-1 flex-col gap-(--multi-sidebar-section-gap) overflow-y-auto pt-0 pb-4">
      <RetainedThreadDetailSubscriptions
        key={prewarmedSidebarThreadRefsKey}
        threadRefs={prewarmedSidebarThreadRefs}
      />
      {pinnedSections.map(renderSection)}
      {showWorkspaceCollection ? (
        <section
          className="group/workspaces flex min-w-0 flex-col gap-px"
          data-agent-sidebar-workspaces=""
        >
          <div
            className="font-multi flex min-h-(--multi-sidebar-item-height) min-w-0 items-center justify-start gap-(--multi-sidebar-item-gap) overflow-hidden rounded-[4px] px-1.5 py-0.5 text-left text-[length:var(--multi-sidebar-label-size)]/[var(--multi-sidebar-label-leading)] text-multi-fg-tertiary [@media(hover:hover)]:hover:text-multi-fg-primary"
            data-agent-sidebar-workspaces-title=""
          >
            <button
              id={workspaceCollectionLabelId}
              type="button"
              aria-expanded={workspaceCollectionOpen}
              aria-controls={workspaceCollectionOpen ? workspaceCollectionPanelId : undefined}
              onClick={() => setWorkspaceCollectionOpen((open) => !open)}
              className="relative m-0 flex min-h-(--multi-sidebar-item-height) w-auto min-w-0 flex-1 cursor-(--multi-button-cursor) touch-manipulation items-center justify-start gap-1 border-0 bg-transparent p-0 text-inherit shadow-none outline-hidden focus-visible:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--multi-stroke-focused)_92%,transparent)]"
            >
              <span className="min-w-0 truncate text-left">Workspaces</span>
              <IconChevronRightMedium
                className={cn(
                  "size-4 shrink-0 text-multi-icon-tertiary opacity-0 transition-[opacity,transform] duration-0 ease-out motion-reduce:transition-none group-focus-within/workspaces:opacity-65 group-focus-within/workspaces:duration-150 [@media(hover:hover)]:group-hover/workspaces:opacity-65 [@media(hover:hover)]:group-hover/workspaces:duration-150",
                  workspaceCollectionOpen && "rotate-90",
                )}
                aria-hidden
              />
            </button>
            {props.onOpenWorkspace ? (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  props.onOpenWorkspace?.();
                }}
                aria-label="Open Workspace"
                title="Open Workspace"
                className="relative mr-0 flex size-5 shrink-0 cursor-(--multi-button-cursor) items-center justify-center rounded-multi-control border border-transparent bg-transparent p-0 text-multi-icon-tertiary opacity-0 outline-hidden transition-opacity duration-0 touch-manipulation pointer-coarse:after:absolute pointer-coarse:after:size-full pointer-coarse:after:min-h-11 pointer-coarse:after:min-w-11 focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-0 group-focus-within/workspaces:opacity-65 group-focus-within/workspaces:duration-150 [@media(hover:hover)]:hover:text-multi-fg-primary [@media(hover:hover)]:group-hover/workspaces:opacity-65 [@media(hover:hover)]:group-hover/workspaces:duration-150"
              >
                <IconFolderAddRight className="size-4 shrink-0" aria-hidden />
              </button>
            ) : null}
          </div>
          {workspaceCollectionOpen ? (
            <div
              id={workspaceCollectionPanelId}
              className="flex min-w-0 flex-col gap-px"
              role="region"
              aria-labelledby={workspaceCollectionLabelId}
            >
              {workspaceSections.length === 0 ? (
                <SidebarItem
                  render={<div />}
                  interactive={false}
                  className="text-multi-fg-tertiary"
                >
                  <span className="size-4 shrink-0" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">No recent workspaces</span>
                </SidebarItem>
              ) : (
                workspaceSections.map(renderSection)
              )}
              {props.onOpenWorkspace ? (
                <SidebarItem
                  type="button"
                  onClick={props.onOpenWorkspace}
                  className={cn(
                    "text-multi-fg-tertiary [@media(hover:hover)]:hover:text-multi-fg-primary",
                    workspaceSections.length === 0 && "text-multi-fg-secondary",
                  )}
                  data-testid="sidebar-add-project-trigger"
                >
                  <IconFolderAddRight className="size-4 shrink-0 opacity-65" aria-hidden />
                  <span className="min-w-0 flex-1 truncate">Open Workspace</span>
                </SidebarItem>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
