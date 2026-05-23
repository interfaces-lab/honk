import { StatusDot as UiStatusDot } from "@multi/ui/status-dot";
import { scopedThreadKey, scopeProjectRef } from "@multi/client-runtime";
import type { ScopedThreadRef } from "@multi/contracts";
import {
  IconArchive1,
  IconChevronRightMedium,
  IconFolder1,
  IconFolderOpen,
  IconPin,
  IconUnpin,
} from "central-icons";
import {
  type ComponentProps,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
  memo,
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";

import { ChatLoaderGlyph } from "~/components/chat/message/chat-loader";
import {
  SidebarSectionContextMenu,
  ThreadContextMenu,
} from "~/components/shell/sidebar/thread-context-menu";
import { SidebarButton, SidebarItem } from "~/components/shell/shared/sidebar-button";
import { resolveAndPersistPreferredEditor } from "~/editor/preferences";
import { retainThreadDetailSubscription } from "~/environments/runtime/service";
import { useThreadActions } from "~/hooks/use-thread-actions";
import { useMountEffect } from "~/hooks/use-mount-effect";
import type { SidebarChatItem, SidebarSectionModel } from "./sidebar-chat-view-model";
import { useUiStateStore } from "~/stores/ui-state-store";
import { readLocalApi } from "~/local-api";
import { cn } from "~/lib/utils";

const initialMaxVisible = 5;
const pageStep = 8;
const nearViewportPrefetchLimit = 12;
const sidebarThreadPrewarmLimit = 10;
const EMPTY_VISIBLE_THREAD_REFS: readonly ScopedThreadRef[] = [];

type SidebarDropPosition = "before" | "after";

type SidebarDragPayload = {
  sectionId: string;
  projectOrderKeys: readonly string[];
};

type SidebarDropTarget = SidebarDragPayload & {
  position: SidebarDropPosition;
};

export interface AgentSidebarProps {
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

function useCallbackIdentityVersion<TCallback extends ((...args: never[]) => unknown) | undefined>(
  callback: TCallback,
): number {
  const callbackRef = useRef<TCallback>(callback);
  const versionRef = useRef(0);
  if (callbackRef.current !== callback) {
    callbackRef.current = callback;
    versionRef.current += 1;
  }
  return versionRef.current;
}

type UiStatusDotState = NonNullable<ComponentProps<typeof UiStatusDot>["state"]>;

function stopActionPointerDown(event: MouseEvent<HTMLButtonElement>) {
  event.preventDefault();
  event.stopPropagation();
}

function SidebarDot(props: { state: UiStatusDotState }) {
  return (
    <UiStatusDot state={props.state} className="size-4 shrink-0" role="presentation" aria-hidden />
  );
}

function sidebarDotStateForItem(item: SidebarChatItem): UiStatusDotState {
  if (item.state === "error") return "critical";
  if (item.state === "needs_attention") return "needsAttention";
  return item.unread ? "doneUnseen" : "doneSeen";
}

function StatusDot(props: { item: SidebarChatItem }) {
  if (props.item.kind === "draft") {
    return <SidebarDot state="draft" />;
  }

  if (props.item.state === "running") {
    return <ChatLoaderGlyph aria-hidden maxExtent={16} role="presentation" speed={1.1} />;
  }

  return <SidebarDot state={sidebarDotStateForItem(props.item)} />;
}

function StatusSlot(props: { item: SidebarChatItem }) {
  return (
    <span
      className="flex size-5 shrink-0 items-center justify-center text-multi-icon-secondary"
      data-agent-sidebar-status=""
    >
      <StatusDot item={props.item} />
    </span>
  );
}

function SidebarItemTitle(props: { title: string; selected: boolean }) {
  return (
    <span
      className={cn(
        "min-w-0 flex-1 truncate text-multi-fg-secondary",
        props.selected && "text-multi-fg-primary",
      )}
      data-agent-sidebar-title=""
      title={props.title}
    >
      {props.title}
    </span>
  );
}

function SidebarItemTime(props: { ago: string; selected: boolean; compact?: boolean }) {
  return (
    <span
      className={cn(
        "shrink-0 truncate text-right text-(length:--multi-text-detail) leading-(--multi-leading-detail) tabular-nums",
        props.compact ? "max-w-14" : "min-w-8 max-w-14",
        props.selected ? "text-multi-fg-secondary" : "text-multi-fg-tertiary",
      )}
      data-agent-sidebar-subtitle=""
    >
      {props.ago}
    </span>
  );
}

function SidebarIconButton(
  props: ComponentProps<"button"> & {
    label: string;
  },
) {
  const { label, className, children, ...rest } = props;
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onMouseDown={stopActionPointerDown}
      className={cn(
        "flex size-5 shrink-0 cursor-(--multi-button-cursor) items-center justify-center rounded-multi-control border border-transparent bg-transparent p-0 text-multi-fg-tertiary outline-none hover:bg-multi-bg-quaternary hover:text-multi-fg-primary focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-0",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

function ThreadStatusActionSlot(props: {
  item: SidebarChatItem;
  pinned: boolean;
  onTogglePinned: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <span
      className="relative flex size-5 shrink-0 items-center justify-center text-multi-icon-secondary"
      data-agent-sidebar-status=""
      data-agent-sidebar-pin-slot=""
    >
      <span className="flex size-4 shrink-0 items-center justify-center group-focus-within/sidebar-item:opacity-0 group-data-[popup-open]/sidebar-item:opacity-0 [@media(hover:hover)]:group-hover/sidebar-item:opacity-0">
        <StatusDot item={props.item} />
      </span>
      <SidebarIconButton
        label={props.pinned ? "Unpin" : "Pin"}
        onClick={props.onTogglePinned}
        className="pointer-events-none absolute inset-0 opacity-0 group-focus-within/sidebar-item:pointer-events-auto group-focus-within/sidebar-item:opacity-100 group-data-[popup-open]/sidebar-item:pointer-events-auto group-data-[popup-open]/sidebar-item:opacity-100 [@media(hover:hover)]:group-hover/sidebar-item:pointer-events-auto [@media(hover:hover)]:group-hover/sidebar-item:opacity-100"
        data-agent-sidebar-pin-action=""
      >
        {props.pinned ? (
          <IconUnpin className="size-4 shrink-0" aria-hidden />
        ) : (
          <IconPin className="size-4 shrink-0" aria-hidden />
        )}
      </SidebarIconButton>
    </span>
  );
}

const AgentSidebarThreadItem = memo(
  function AgentSidebarThreadItem(props: {
    item: SidebarChatItem;
    selected: boolean;
    onSelectAgent: (id: string) => void;
    onPrefetchAgent?: (id: string) => void;
  }) {
    const { commitRename, archiveThread } = useThreadActions();
    const { item, onSelectAgent } = props;
    const targetThreadRef = props.item.kind === "thread" ? props.item.threadRef : null;
    const markThreadUnread = useUiStateStore((store) => store.markThreadUnread);
    const setThreadPinned = useUiStateStore((store) => store.setThreadPinned);
    const [renaming, setRenaming] = useState(false);
    const [renameValue, setRenameValue] = useState("");
    const committedRef = useRef(false);

    const selectThread = useCallback(() => {
      onSelectAgent(item.id);
    }, [item.id, onSelectAgent]);

    const focusRenameInput = useCallback((node: HTMLInputElement | null) => {
      if (!node) return;
      node.focus();
      node.select();
    }, []);

    const finishRename = useCallback(() => {
      setRenaming(false);
      committedRef.current = false;
    }, []);

    const applyRename = useCallback(async () => {
      if (props.item.kind !== "thread") return;
      if (!targetThreadRef) {
        finishRename();
        return;
      }
      const next = renameValue.trim();
      if (next.length === 0) {
        toast.warning("Thread title cannot be empty");
        finishRename();
        return;
      }
      if (next === props.item.title) {
        finishRename();
        return;
      }
      try {
        await commitRename(targetThreadRef, next, props.item.title);
      } catch (error) {
        toast.error("Failed to rename thread", {
          description: error instanceof Error ? error.message : "An error occurred.",
        });
      } finally {
        finishRename();
      }
    }, [commitRename, finishRename, props.item, renameValue, targetThreadRef]);

    const onBlur = useCallback(() => {
      if (props.item.kind !== "thread") return;
      if (committedRef.current) {
        committedRef.current = false;
        return;
      }
      void applyRename();
    }, [applyRename, props.item.kind]);

    const onRenameKeyDown = useCallback(
      (event: KeyboardEvent) => {
        event.stopPropagation();
        if (event.key === "Enter") {
          event.preventDefault();
          committedRef.current = true;
          void applyRename();
          return;
        }
        if (event.key === "Escape") {
          event.preventDefault();
          committedRef.current = true;
          finishRename();
        }
      },
      [applyRename, finishRename],
    );

    if (props.item.kind === "draft") {
      return (
        <SidebarButton
          variant="item"
          data-selected={props.selected}
          data-chat-item=""
          data-agent-sidebar-cell=""
          onFocus={() => props.onPrefetchAgent?.(props.item.id)}
          onPointerEnter={() => props.onPrefetchAgent?.(props.item.id)}
          onClick={selectThread}
        >
          <StatusSlot item={props.item} />
          <SidebarItemTitle title={props.item.title} selected={props.selected} />
          <SidebarItemTime ago={props.item.ago} selected={props.selected} />
        </SidebarButton>
      );
    }

    const threadItem = props.item;
    const archiveCurrentThread = (event: MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      if (!targetThreadRef) {
        return;
      }
      void archiveThread(targetThreadRef).catch((error) => {
        toast.error("Failed to archive thread", {
          description: error instanceof Error ? error.message : "An error occurred.",
        });
      });
    };
    const togglePinnedThread = (event: MouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      if (!targetThreadRef) {
        return;
      }
      setThreadPinned(scopedThreadKey(targetThreadRef), !threadItem.pinned);
    };
    if (renaming) {
      return (
        <SidebarItem
          render={<div />}
          interactive={false}
          className="cursor-(--multi-button-cursor) border-multi-stroke-primary bg-multi-bg-tertiary"
          data-agent-sidebar-cell=""
          data-renaming="true"
        >
          <StatusSlot item={props.item} />
          <input
            ref={focusRenameInput}
            type="text"
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={onRenameKeyDown}
            onBlur={onBlur}
            onClick={(e) => e.stopPropagation()}
            className="min-w-0 flex-1 select-text bg-transparent text-foreground outline-none ring-0"
            aria-label="Rename thread"
          />
          <SidebarItemTime ago={props.item.ago} selected={props.selected} />
        </SidebarItem>
      );
    }

    return (
      <ThreadContextMenu
        threadId={threadItem.id}
        onRename={() => {
          setRenaming(true);
          setRenameValue(threadItem.title);
        }}
        onMarkUnread={() => {
          if (!targetThreadRef) {
            return;
          }
          markThreadUnread(scopedThreadKey(targetThreadRef), threadItem.latestReadableAt);
        }}
        onArchive={() => {
          if (!targetThreadRef) return;
          void archiveThread(targetThreadRef).catch((error) => {
            toast.error("Failed to archive thread", {
              description: error instanceof Error ? error.message : "An error occurred.",
            });
          });
        }}
      >
        <SidebarItem
          render={<div />}
          selected={props.selected}
          className="group/sidebar-item data-popup-open:bg-multi-bg-quaternary data-[selected=true]:focus-within:bg-multi-bg-tertiary data-[selected=true]:data-popup-open:bg-multi-bg-tertiary"
          data-agent-sidebar-cell=""
          data-agent-sidebar-row-shell=""
          onClick={selectThread}
          tabIndex={-1}
        >
          <ThreadStatusActionSlot
            item={props.item}
            pinned={threadItem.pinned}
            onTogglePinned={togglePinnedThread}
          />
          <SidebarButton
            variant="inset"
            data-chat-item=""
            onFocus={() => props.onPrefetchAgent?.(props.item.id)}
            onPointerEnter={() => props.onPrefetchAgent?.(props.item.id)}
          >
            <SidebarItemTitle title={props.item.title} selected={props.selected} />
          </SidebarButton>
          <div className="hidden shrink-0 items-center group-focus-within/sidebar-item:flex group-data-[popup-open]/sidebar-item:flex [@media(hover:hover)]:group-hover/sidebar-item:flex">
            <SidebarItemTime ago={props.item.ago} compact selected={props.selected} />
            <SidebarIconButton
              label="Archive"
              onClick={archiveCurrentThread}
              data-agent-sidebar-archive-action=""
            >
              <IconArchive1 className="size-4 shrink-0" aria-hidden />
            </SidebarIconButton>
          </div>
        </SidebarItem>
      </ThreadContextMenu>
    );
  },
  (left, right) =>
    left.item === right.item &&
    left.selected === right.selected &&
    left.onSelectAgent === right.onSelectAgent &&
    left.onPrefetchAgent === right.onPrefetchAgent,
);

function AgentSidebarSection(props: {
  section: SidebarSectionModel;
  selectedId: string | null;
  dragPayload: SidebarDragPayload | null;
  dropTarget: SidebarDropTarget | null;
  onSidebarDragEnd: (event: DragEvent<HTMLElement>) => void;
  onSidebarDragOver: (event: DragEvent<HTMLElement>, target: SidebarDragPayload) => void;
  onSidebarDragStart: (event: DragEvent<HTMLElement>, payload: SidebarDragPayload) => void;
  onSidebarDrop: (event: DragEvent<HTMLElement>, target: SidebarDragPayload) => void;
  onSelectAgent: (id: string) => void;
  onNewAgent?: (cwd: string) => void;
  onPrefetchAgent?: (id: string) => void;
  onVisibleThreadRefsChange: (sectionId: string, threadRefs: readonly ScopedThreadRef[]) => void;
}) {
  const { onPrefetchAgent, section } = props;
  const prefetchAgentVersion = useCallbackIdentityVersion(onPrefetchAgent);
  const { archiveThreads, removeProjectFromSidebar } = useThreadActions();
  const projectExpandedById = useUiStateStore((store) => store.projectExpandedById);
  const markThreadVisited = useUiStateStore((store) => store.markThreadVisited);
  const setProjectExpanded = useUiStateStore((store) => store.setProjectExpanded);
  const [localOpen, setLocalOpen] = useState(true);
  const [extra, setExtra] = useState(0);
  const open = section.projectStateKey
    ? (projectExpandedById[section.projectStateKey] ?? true)
    : localOpen;
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
    const rawVisible = Math.min(items.length, initialMaxVisible + effectiveExtra * pageStep);
    let next = Math.max(rawVisible, minVisible);
    if (items.length - next === 1 && next < items.length) next = items.length;
    return Math.max(next, firstPage);
  }, [effectiveExtra, minVisible, section.items]);

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
    () => (open ? section.items.slice(0, visible + nearViewportPrefetchLimit) : []),
    [open, section.items, visible],
  );
  const prefetchItemsKey = useMemo(() => createSectionItemIdsKey(prefetchItems), [prefetchItems]);

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
  }, [section.cwd, section.projectCwd]);

  const markSectionRead = useCallback(() => {
    for (const threadRef of section.threadRefs) {
      markThreadVisited(scopedThreadKey(threadRef));
    }
  }, [markThreadVisited, section.threadRefs]);

  const archiveSectionThreads = useCallback(() => {
    void archiveThreads(section.threadRefs).catch((error) => {
      toast.error("Failed to archive threads", {
        description: error instanceof Error ? error.message : "An error occurred.",
      });
    });
  }, [archiveThreads, section.threadRefs]);

  const removeSectionProject = useCallback(() => {
    if (!section.environmentId || !section.projectId) {
      return;
    }
    void removeProjectFromSidebar(scopeProjectRef(section.environmentId, section.projectId)).catch(
      (error) => {
        toast.error("Failed to remove project", {
          description: error instanceof Error ? error.message : "An error occurred.",
        });
      },
    );
  }, [removeProjectFromSidebar, section.environmentId, section.projectId]);

  const { onVisibleThreadRefsChange } = props;
  const toggleOpen = useCallback(() => {
    if (section.projectStateKey) {
      setProjectExpanded(section.projectStateKey, !open);
      return;
    }
    setLocalOpen(!open);
  }, [open, section.projectStateKey, setProjectExpanded]);

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
            "pointer-events-none absolute inset-x-2 z-10 h-px rounded-full bg-multi-stroke-focused",
            projectDropPosition === "before" ? "top-0" : "bottom-0",
          )}
        />
      ) : null}
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
        canOpenInEditor={canOpenInEditor}
        canRemoveProject={canRemoveProject}
        onOpenInEditor={openSectionInEditor}
        onMarkAllRead={markSectionRead}
        onArchiveAll={archiveSectionThreads}
        onRemoveFromSidebar={removeSectionProject}
      >
        <div className="group/sidebar-section px-2 outline-none" tabIndex={-1}>
          <SidebarItem
            render={<div />}
            className={cn(
              "overflow-hidden group-data-[popup-open]/sidebar-section:bg-multi-bg-quaternary group-data-[popup-open]/sidebar-section:text-multi-fg-primary [@media(hover:hover)]:hover:text-multi-fg-primary",
              section.active ? "text-multi-fg-secondary" : "text-multi-fg-tertiary",
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
              className="relative m-0 flex min-h-6 w-auto min-w-0 flex-1 cursor-(--multi-button-cursor) touch-manipulation items-center justify-start gap-1.5 border-0 bg-transparent p-0 text-inherit shadow-none outline-none focus-visible:shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--multi-stroke-focused)_92%,transparent)]"
            >
              <span
                className="relative flex size-4 shrink-0 items-center justify-center text-multi-icon-tertiary"
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
                onClick={(event) => {
                  event.stopPropagation();
                  props.onNewAgent?.(section.cwd);
                }}
                aria-label={`New agent in ${section.label}`}
                title={`New agent in ${section.label}`}
                className="relative mr-0 flex size-5 shrink-0 cursor-(--multi-button-cursor) items-center justify-center rounded-multi-control border border-transparent bg-transparent p-0 text-inherit outline-none touch-manipulation pointer-coarse:after:absolute pointer-coarse:after:size-full pointer-coarse:after:min-h-11 pointer-coarse:after:min-w-11 focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-0"
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
          className="flex min-w-0 flex-col gap-px px-2 pb-[11px]"
          role="region"
          aria-labelledby={labelId}
        >
          {section.items.slice(0, visible).map((item) => (
            <AgentSidebarThreadItem
              key={item.id}
              item={item}
              selected={props.selectedId === item.id}
              onSelectAgent={props.onSelectAgent}
              {...(props.onPrefetchAgent ? { onPrefetchAgent: props.onPrefetchAgent } : {})}
            />
          ))}
          {showMore ? (
            <SidebarItem
              type="button"
              onClick={() => setExtra((count) => count + 1)}
              className="relative touch-manipulation text-multi-fg-tertiary pointer-coarse:after:absolute pointer-coarse:after:size-full pointer-coarse:after:min-h-11 pointer-coarse:after:min-w-11 focus-visible:ring-1 focus-visible:ring-ring focus-visible:ring-offset-0 [@media(hover:hover)]:hover:text-multi-fg-primary"
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
  onVisibleThreadRefsChange: (sectionId: string, threadRefs: readonly ScopedThreadRef[]) => void;
  sectionId: string;
  threadRefs: readonly ScopedThreadRef[];
}) {
  useMountEffect(() => {
    onVisibleThreadRefsChange(sectionId, threadRefs);
  });

  return null;
}

function AgentSidebarBody(props: AgentSidebarProps) {
  const reorderProjects = useUiStateStore((store) => store.reorderProjects);
  const [dragPayload, setDragPayload] = useState<SidebarDragPayload | null>(null);
  const [dropTarget, setDropTarget] = useState<SidebarDropTarget | null>(null);
  const [visibleThreadRefsBySectionId, setVisibleThreadRefsBySectionId] = useState<
    Record<string, readonly ScopedThreadRef[]>
  >({});
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
  const visibleThreadRefs = useMemo(
    () =>
      props.sections.flatMap(
        (section) => visibleThreadRefsBySectionId[section.id] ?? EMPTY_VISIBLE_THREAD_REFS,
      ),
    [props.sections, visibleThreadRefsBySectionId],
  );
  const prewarmedSidebarThreadRefs = useMemo(
    () => visibleThreadRefs.slice(0, sidebarThreadPrewarmLimit),
    [visibleThreadRefs],
  );
  const prewarmedSidebarThreadRefsKey = useMemo(
    () => createThreadRefsKey(prewarmedSidebarThreadRefs),
    [prewarmedSidebarThreadRefs],
  );

  return (
    <div className="sidebar-body flex min-h-0 flex-1 flex-col gap-px overflow-y-auto pt-0 pb-4">
      <RetainedThreadDetailSubscriptions
        key={prewarmedSidebarThreadRefsKey}
        threadRefs={prewarmedSidebarThreadRefs}
      />
      {props.sections.map((section) => (
        <AgentSidebarSection
          key={section.id}
          section={section}
          selectedId={props.selectedId}
          dragPayload={dragPayload}
          dropTarget={dropTarget}
          onSidebarDragEnd={onSidebarDragEnd}
          onSidebarDragOver={onSidebarDragOver}
          onSidebarDragStart={onSidebarDragStart}
          onSidebarDrop={onSidebarDrop}
          onSelectAgent={props.onSelectAgent}
          onVisibleThreadRefsChange={onVisibleThreadRefsChange}
          {...(props.onNewAgent ? { onNewAgent: props.onNewAgent } : {})}
          {...(props.onPrefetchAgent ? { onPrefetchAgent: props.onPrefetchAgent } : {})}
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
      retainThreadDetailSubscription(threadRef.environmentId, threadRef.threadId),
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
    <div className="sidebar-body flex min-h-0 flex-1 flex-col gap-px overflow-y-auto pt-0 pb-4">
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

export function AgentSidebar(props: AgentSidebarProps) {
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

  return <AgentSidebarBody {...props} />;
}
