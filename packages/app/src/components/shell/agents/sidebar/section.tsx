import { scopedThreadKey } from "~/lib/environment-scope";
import type { ScopedProjectRef, ScopedThreadRef } from "@honk/contracts";
import { SidebarItem } from "@honk/honkkit/sidebar";
import { IconChevronRightMedium, IconFolder1, IconFolderOpen } from "central-icons";
import { type DragEvent, useState } from "react";
import { toast } from "sonner";

import { resolveAndPersistPreferredEditor } from "~/editor-preferences";
import { readLocalApi } from "~/local-api";
import { cn } from "~/lib/utils";
import { useUiStateStore } from "~/stores/ui-state-store";
import { initialMaxVisible, pageStep } from "./constants";
import { SidebarSectionContextMenu } from "./context-menu";
import type { SidebarDragPayload, SidebarDropTarget } from "./drag-and-drop";
import { AgentSidebarThreadItem } from "./thread-item";
import type { SidebarSectionModel } from "./types";

type CommitThreadRename = (
  target: ScopedThreadRef,
  nextTitle: string,
  originalTitle: string,
) => Promise<void>;
type ArchiveThread = (target: ScopedThreadRef) => Promise<void>;
type ArchiveThreads = (targets: readonly ScopedThreadRef[]) => Promise<void>;
type CloneThread = (target: ScopedThreadRef, cwd: string) => Promise<void>;
type RemoveProjectFromSidebar = (target: ScopedProjectRef) => Promise<void>;

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

export function AgentSidebarSection(props: {
  section: SidebarSectionModel;
  selectedId: string | null;
  dragPayload: SidebarDragPayload | null;
  dropTarget: SidebarDropTarget | null;
  onSidebarDragEnd: (event: DragEvent<HTMLElement>) => void;
  onSidebarDragOver: (event: DragEvent<HTMLElement>, target: SidebarDragPayload) => void;
  onSidebarDragStart: (event: DragEvent<HTMLElement>, payload: SidebarDragPayload) => void;
  onSidebarDrop: (event: DragEvent<HTMLElement>, target: SidebarDragPayload) => void;
  archiveThread: ArchiveThread;
  archiveThreads: ArchiveThreads;
  unarchiveThread: ArchiveThread;
  cloneThread: CloneThread;
  commitRename: CommitThreadRename;
  removeProjectFromSidebar: RemoveProjectFromSidebar;
  onSelectAgent: (id: string) => void;
  onClearDraft: (id: string) => void;
  onNewAgent?: (cwd: string) => void;
}) {
  const { section } = props;
  const savedOpen = useUiStateStore((store) =>
    section.projectStateKey ? (store.projectExpandedById[section.projectStateKey] ?? true) : true,
  );
  const markThreadVisited = useUiStateStore((store) => store.markThreadVisited);
  const setProjectExpanded = useUiStateStore((store) => store.setProjectExpanded);
  const [localOpen, setLocalOpen] = useState(true);
  const [extra, setExtra] = useState(0);
  const open = section.projectStateKey ? savedOpen : localOpen;
  const labelId = `agent-section-label-${section.id}`;
  const panelId = `agent-section-panel-${section.id}`;
  const minVisible = minVisibleForSelection(section.items, props.selectedId);
  const neededForSelection = Math.max(0, minVisible - initialMaxVisible);
  const minimumExtraForSelection =
    neededForSelection === 0 ? 0 : Math.ceil(neededForSelection / pageStep);
  const effectiveExtra = Math.max(extra, minimumExtraForSelection);

  const visible = (() => {
    const items = section.items;
    const firstPage = Math.min(items.length, initialMaxVisible);
    const rawVisible = Math.min(items.length, initialMaxVisible + effectiveExtra * pageStep);
    let next = Math.max(rawVisible, minVisible);
    if (items.length - next === 1 && next < items.length) next = items.length;
    return Math.max(next, firstPage);
  })();

  const showMore =
    section.items.length > Math.min(section.items.length, initialMaxVisible) &&
    visible < section.items.length;
  const canCreateAgent = section.canCreateAgent ?? true;
  const canOpenInEditor = section.canOpenInEditor ?? true;
  const projectOrderKeys = section.projectOrderKeys ?? [];
  const canReorderProject = projectOrderKeys.length > 0 && section.id !== "pinned";
  const projectDropPosition =
    props.dropTarget?.sectionId === section.id ? props.dropTarget.position : null;
  const draggingProject = props.dragPayload?.sectionId === section.id;
  const canRemoveProject = section.projectRef !== undefined && section.projectCwd !== undefined;
  const openSectionInEditor = () => {
    const localApi = readLocalApi();
    if (!localApi) {
      toast.error("Local API unavailable.");
      return;
    }

    void localApi.server
      .getConfig()
      .then((config) => {
        const editor = resolveAndPersistPreferredEditor(
          config.availableEditors.filter((editorId) => editorId !== "file-manager"),
        );
        if (!editor) {
          throw new Error("No available code editor found.");
        }
        return localApi.shell.openInEditor(section.projectCwd ?? section.cwd, editor);
      })
      .catch((error) => {
        toast.error("Failed to open project", {
          description: error instanceof Error ? error.message : "An error occurred.",
        });
      });
  };

  const markSectionRead = () => {
    for (const threadRef of section.threadRefs) {
      markThreadVisited(scopedThreadKey(threadRef));
    }
  };

  const archiveSectionThreads = () => {
    void props.archiveThreads(section.threadRefs).catch((error) => {
      toast.error("Failed to archive threads", {
        description: error instanceof Error ? error.message : "An error occurred.",
      });
    });
  };

  const removeSectionProject = () => {
    if (!section.projectRef) {
      return;
    }
    void props.removeProjectFromSidebar(section.projectRef).catch((error) => {
      toast.error("Failed to remove project", {
        description: error instanceof Error ? error.message : "An error occurred.",
      });
    });
  };

  const toggleOpen = () => {
    if (section.projectStateKey) {
      setProjectExpanded(section.projectStateKey, !open);
      return;
    }
    setLocalOpen(!open);
  };

  return (
    <section
      className={cn(
        "relative flex w-full min-w-0 select-none flex-col",
        draggingProject && "opacity-45",
      )}
      data-agent-sidebar-section=""
      onDragOver={(event) => {
        if (!canReorderProject) return;
        props.onSidebarDragOver(event, {
          sectionId: section.id,
          projectOrderKeys,
        });
      }}
      onDrop={(event) => {
        if (!canReorderProject) return;
        props.onSidebarDrop(event, {
          sectionId: section.id,
          projectOrderKeys,
        });
      }}
    >
      {projectDropPosition ? (
        <div
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-x-2 z-10 h-px rounded-full bg-honk-stroke-focused",
            projectDropPosition === "before" ? "top-0" : "bottom-0",
          )}
        />
      ) : null}
      <SidebarSectionContextMenu
        hasThreads={section.threadRefs.length > 0}
        canOpenInEditor={canOpenInEditor}
        canRemoveProject={canRemoveProject}
        onOpenInEditor={openSectionInEditor}
        onMarkAllRead={markSectionRead}
        onArchiveAll={archiveSectionThreads}
        onRemoveFromSidebar={removeSectionProject}
      >
        <div className="group/sidebar-section outline-hidden" tabIndex={-1}>
          <SidebarItem
            render={<div />}
            className={cn(
              "overflow-hidden group-data-[popup-open]/sidebar-section:bg-honk-bg-quaternary group-data-[popup-open]/sidebar-section:text-honk-fg-primary [@media(hover:hover)]:hover:text-honk-fg-primary",
              section.active ? "text-honk-fg-secondary" : "text-honk-fg-tertiary",
              canReorderProject && "[-webkit-user-drag:element]",
            )}
            data-agent-sidebar-section-title=""
            draggable={canReorderProject}
            onDragEnd={props.onSidebarDragEnd}
            onDragStart={(event) => {
              if (!canReorderProject) return;
              props.onSidebarDragStart(event, {
                sectionId: section.id,
                projectOrderKeys,
              });
            }}
          >
            <button
              id={labelId}
              type="button"
              aria-expanded={open}
              aria-controls={open ? panelId : undefined}
              onClick={toggleOpen}
              className="relative m-0 flex min-h-sidebar-item w-auto min-w-0 flex-1 cursor-(--honk-button-cursor) touch-manipulation items-center justify-start gap-sidebar-item-gap border-0 bg-transparent p-0 text-inherit shadow-none outline-hidden focus-visible:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--honk-stroke-focused)_92%,transparent)]"
            >
              <span
                className="relative flex size-4 shrink-0 items-center justify-center text-honk-icon-tertiary"
                data-agent-sidebar-section-folder=""
                aria-hidden
              >
                <IconFolder1
                  className={cn(
                    "absolute size-4 transition-[opacity,transform] duration-150 ease-out motion-reduce:transition-none [@media(hover:hover)]:group-hover/sidebar-section:opacity-0",
                    open ? "scale-95 opacity-0" : "scale-100 opacity-100",
                  )}
                />
                <IconFolderOpen
                  className={cn(
                    "absolute size-4 transition-[opacity,transform] duration-150 ease-out motion-reduce:transition-none [@media(hover:hover)]:group-hover/sidebar-section:opacity-0",
                    open ? "scale-100 opacity-100" : "scale-95 opacity-0",
                  )}
                />
                <span
                  className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-150 ease-out [@media(hover:hover)]:group-hover/sidebar-section:opacity-100 motion-reduce:transition-none"
                  data-agent-sidebar-section-chevron=""
                >
                  <IconChevronRightMedium
                    className={cn(
                      "size-4 shrink-0 opacity-65 transition-transform duration-150 ease-out motion-reduce:transition-none",
                      open && "rotate-90",
                    )}
                  />
                </span>
              </span>
              <span className="min-w-0 flex-1 truncate text-left">{section.label}</span>
            </button>
            {props.onNewAgent && canCreateAgent ? (
              <button
                type="button"
                onMouseDown={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
                onClick={(event) => {
                  event.stopPropagation();
                  props.onNewAgent?.(section.cwd);
                }}
                aria-label={`New agent in ${section.label}`}
                title={`New agent in ${section.label}`}
                className="relative mr-0 flex size-5 shrink-0 cursor-(--honk-button-cursor) items-center justify-center rounded-honk-control border border-transparent bg-transparent p-0 text-inherit outline-hidden touch-manipulation pointer-coarse:after:absolute pointer-coarse:after:size-full pointer-coarse:after:min-h-11 pointer-coarse:after:min-w-11 focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-0"
              >
                <span aria-hidden>+</span>
              </button>
            ) : null}
          </SidebarItem>
        </div>
      </SidebarSectionContextMenu>
      {open ? (
        <div
          id={panelId}
          className="flex min-w-0 flex-col gap-px"
          role="region"
          aria-labelledby={labelId}
        >
          {section.items.slice(0, visible).map((item) => (
            <AgentSidebarThreadItem
              key={item.id}
              item={item}
              selected={props.selectedId === item.id}
              archiveThread={props.archiveThread}
              unarchiveThread={props.unarchiveThread}
              cloneThread={props.cloneThread}
              commitRename={props.commitRename}
              onSelectAgent={props.onSelectAgent}
              onClearDraft={props.onClearDraft}
            />
          ))}
          {showMore ? (
            <SidebarItem
              type="button"
              onClick={() => setExtra((count) => count + 1)}
              className="relative touch-manipulation text-honk-fg-tertiary pointer-coarse:after:absolute pointer-coarse:after:size-full pointer-coarse:after:min-h-11 pointer-coarse:after:min-w-11 focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-0 [@media(hover:hover)]:hover:text-honk-fg-primary"
            >
              <span className="size-2.5 shrink-0 opacity-55" aria-hidden>
                ⋯
              </span>
              <span className="min-w-0">More</span>
            </SidebarItem>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
