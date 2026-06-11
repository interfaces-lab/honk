import { Menu, MenuCheckboxItem, MenuPopup, MenuSeparator, MenuTrigger } from "@multi/multikit/menu";
import { SidebarItem } from "@multi/multikit/sidebar";
import { IconChevronRightMedium, IconFilter2, IconFolderAddRight } from "central-icons";
import { type DragEvent, useCallback, useId, useMemo, useState } from "react";

import { useThreadActions } from "~/hooks/use-thread-actions";
import { type SidebarThreadFilter, useUiStateStore } from "~/stores/ui-state-store";
import { cn } from "~/lib/utils";
import type { SidebarDragPayload, SidebarDropTarget } from "./drag-and-drop";
import { AgentSidebarSection } from "./section";
import type { AgentSidebarProps, SidebarSectionModel } from "./types";

const THREAD_STATUS_FILTER_OPTIONS: readonly { value: SidebarThreadFilter; label: string }[] = [
  { value: "running", label: "Running" },
  { value: "needs_attention", label: "Needs attention" },
  { value: "idle", label: "Idle" },
  { value: "stopped", label: "Stopped" },
  { value: "error", label: "Error" },
];

function SidebarThreadFilterMenu() {
  const sidebarThreadFilters = useUiStateStore((store) => store.sidebarThreadFilters);
  const toggleSidebarThreadFilter = useUiStateStore((store) => store.toggleSidebarThreadFilter);
  const filtersActive = sidebarThreadFilters.length > 0;

  return (
    <Menu>
      <MenuTrigger
        render={
          <button
            type="button"
            aria-label="Filter threads"
            title="Filter threads"
            className={cn(
              "relative mr-0 flex size-5 shrink-0 cursor-(--multi-button-cursor) items-center justify-center rounded-multi-control border border-transparent bg-transparent p-0 text-multi-icon-tertiary opacity-0 outline-hidden transition-opacity duration-0 touch-manipulation pointer-coarse:after:absolute pointer-coarse:after:size-full pointer-coarse:after:min-h-11 pointer-coarse:after:min-w-11 focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-0 group-focus-within/workspaces:opacity-65 group-focus-within/workspaces:duration-150 data-popup-open:opacity-100 [@media(hover:hover)]:hover:text-multi-fg-primary [@media(hover:hover)]:group-hover/workspaces:opacity-65 [@media(hover:hover)]:group-hover/workspaces:duration-150",
              filtersActive &&
                "bg-multi-bg-quaternary text-primary opacity-100 group-focus-within/workspaces:opacity-100 [@media(hover:hover)]:hover:text-primary [@media(hover:hover)]:group-hover/workspaces:opacity-100",
            )}
          />
        }
      >
        <IconFilter2 className="size-4 shrink-0" aria-hidden />
      </MenuTrigger>
      <MenuPopup
        variant="workbench"
        align="start"
        side="bottom"
        positionerClassName="z-(--z-index-sidebar-context-menu)"
      >
        {THREAD_STATUS_FILTER_OPTIONS.map((option) => (
          <MenuCheckboxItem
            key={option.value}
            variant="workbench"
            checked={sidebarThreadFilters.includes(option.value)}
            onCheckedChange={() => toggleSidebarThreadFilter(option.value)}
          >
            {option.label}
          </MenuCheckboxItem>
        ))}
        <MenuSeparator variant="workbench" />
        <MenuCheckboxItem
          variant="workbench"
          checked={sidebarThreadFilters.includes("archived")}
          onCheckedChange={() => toggleSidebarThreadFilter("archived")}
        >
          Archived
        </MenuCheckboxItem>
      </MenuPopup>
    </Menu>
  );
}

export function AgentSidebarBody(props: AgentSidebarProps) {
  const { archiveThread, archiveThreads, unarchiveThread, commitRename, removeProjectFromSidebar } =
    useThreadActions();
  const reorderProjects = useUiStateStore((store) => store.reorderProjects);
  const [dragPayload, setDragPayload] = useState<SidebarDragPayload | null>(null);
  const [dropTarget, setDropTarget] = useState<SidebarDropTarget | null>(null);
  const [workspaceCollectionOpen, setWorkspaceCollectionOpen] = useState(true);
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
  const pinnedSections = useMemo(
    () => props.sections.filter((section) => section.id === "pinned"),
    [props.sections],
  );
  const workspaceSections = useMemo(
    () => props.sections.filter((section) => section.id !== "pinned"),
    [props.sections],
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
      unarchiveThread={unarchiveThread}
      commitRename={commitRename}
      removeProjectFromSidebar={removeProjectFromSidebar}
      onSelectAgent={props.onSelectAgent}
      {...(props.onNewAgent ? { onNewAgent: props.onNewAgent } : {})}
      {...(props.onPrefetchAgent ? { onPrefetchAgent: props.onPrefetchAgent } : {})}
    />
  );

  return (
    <div className="sidebar-body flex min-h-0 flex-1 flex-col gap-sidebar-section-gap overflow-y-auto pt-0 pb-4">
      {pinnedSections.map(renderSection)}
      {showWorkspaceCollection ? (
        <section
          className="group/workspaces flex min-w-0 flex-col gap-px"
          data-agent-sidebar-workspaces=""
        >
          <div
            className="font-multi flex min-h-sidebar-item min-w-0 items-center justify-start gap-sidebar-item-gap overflow-hidden rounded-[4px] px-1.5 py-1 text-left text-sidebar-label text-multi-fg-tertiary [@media(hover:hover)]:hover:text-multi-fg-primary"
            data-agent-sidebar-workspaces-title=""
          >
            <button
              id={workspaceCollectionLabelId}
              type="button"
              aria-expanded={workspaceCollectionOpen}
              aria-controls={workspaceCollectionOpen ? workspaceCollectionPanelId : undefined}
              onClick={() => setWorkspaceCollectionOpen((open) => !open)}
              className="relative m-0 flex min-h-sidebar-item w-auto min-w-0 flex-1 cursor-(--multi-button-cursor) touch-manipulation items-center justify-start gap-sidebar-item-gap border-0 bg-transparent p-0 text-inherit shadow-none outline-hidden focus-visible:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--multi-stroke-focused)_92%,transparent)]"
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
            <SidebarThreadFilterMenu />
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
