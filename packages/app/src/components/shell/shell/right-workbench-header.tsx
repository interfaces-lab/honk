"use client";

import {
  IconBranch,
  IconConsole,
  IconCrossMediumDefault,
  IconFileText,
  IconGlobe,
  IconPlusLarge,
  IconSidebarHiddenRightWide,
} from "central-icons";
import {
  memo,
  type ComponentType,
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useRef,
  useState,
} from "react";

import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuTrigger,
  WorkbenchMenuIconSlot,
  WorkbenchMenuPrimaryText,
} from "@honk/honkkit/menu";
import {
  WorkbenchIconButton,
  workbenchIconButtonVariants,
} from "@honk/honkkit/workbench-button";
import { WorkbenchChromeDivider } from "@honk/honkkit/workbench-chrome-row";

import { cn } from "~/lib/utils";
import type { WorkbenchTab } from "~/lib/workbench-tabs";
import { useLayoutSyncEffect } from "~/hooks/use-layout-sync-effect";
import { FileTreeFileIcon, FileTreeIconSprite } from "../../tree";
import { RightWorkbenchToolIsland } from "./right-workbench-tool-island";

const WORKBENCH_TAB_DRAG_MIME_TYPE = "application/x-honk-workbench-tab";

const WORKBENCH_TAB_CLOSE_SLOT_STYLE = {
  position: "absolute",
  top: 0,
  right: 0,
  bottom: 0,
  zIndex: 10,
  display: "flex",
  width: 16,
  alignItems: "center",
  justifyContent: "center",
} satisfies CSSProperties;

const TERMINAL_TAB_CLOSE_SLOT_STYLE = {
  ...WORKBENCH_TAB_CLOSE_SLOT_STYLE,
  top: "50%",
  right: 4,
  bottom: "auto",
  width: 20,
  height: 20,
  transform: "translateY(-50%)",
} satisfies CSSProperties;

export interface WorkbenchTabMeta {
  readonly id: string;
  readonly kind: WorkbenchTab;
  readonly label: string;
  readonly icon: ComponentType<{ className?: string | undefined }>;
  readonly closable?: boolean | undefined;
  readonly preview?: boolean | undefined;
  readonly stable?: boolean | undefined;
  readonly terminalId?: string | undefined;
  readonly browserId?: string | undefined;
  readonly browserUrl?: string | undefined;
  readonly browserFaviconUrl?: string | undefined;
  readonly filePath?: string | undefined;
}

interface NewTabMenuItem {
  readonly id: "changes" | "terminal" | "browser" | "file";
  readonly label: string;
  readonly icon: ComponentType<{ className?: string | undefined }>;
}

const NEW_TAB_MENU_ITEMS: readonly NewTabMenuItem[] = [
  { id: "changes", label: "Changes", icon: IconBranch },
  { id: "terminal", label: "Terminal", icon: IconConsole },
  { id: "browser", label: "Browser", icon: IconGlobe },
  { id: "file", label: "Files", icon: IconFileText },
];

interface TabDropTarget {
  readonly insertIndex: number;
  readonly left: number;
}

interface ScrollMaskState {
  readonly atEnd: boolean;
  readonly atStart: boolean;
  readonly hasOverflow: boolean;
}

const DEFAULT_SCROLL_MASK_STATE: ScrollMaskState = Object.freeze({
  atEnd: true,
  atStart: true,
  hasOverflow: false,
});

function readDraggedTabId(event: DragEvent<HTMLElement>): string | null {
  const typed = event.dataTransfer.getData(WORKBENCH_TAB_DRAG_MIME_TYPE);
  if (typed) return typed;
  const plain = event.dataTransfer.getData("text/plain");
  return plain.startsWith("workbench-tab:") ? plain.slice("workbench-tab:".length) : null;
}

function tabElements(viewport: HTMLElement): HTMLElement[] {
  return Array.from(viewport.querySelectorAll<HTMLElement>("[data-workbench-tab='true']"));
}

function tabElementById(viewport: HTMLElement, tabId: string): HTMLElement | null {
  return tabElements(viewport).find((element) => element.dataset.tabId === tabId) ?? null;
}

function scrollMaskStateFromElement(element: HTMLElement | null): ScrollMaskState {
  if (!element) return DEFAULT_SCROLL_MASK_STATE;
  const maxScrollLeft = Math.max(0, element.scrollWidth - element.clientWidth);
  const scrollLeft = Math.max(0, Math.min(maxScrollLeft, element.scrollLeft));
  const hasOverflow = maxScrollLeft > 1;
  return {
    atEnd: !hasOverflow || maxScrollLeft - scrollLeft <= 1,
    atStart: !hasOverflow || scrollLeft <= 1,
    hasOverflow,
  };
}

function areScrollMaskStatesEqual(left: ScrollMaskState, right: ScrollMaskState): boolean {
  return (
    left.atEnd === right.atEnd &&
    left.atStart === right.atStart &&
    left.hasOverflow === right.hasOverflow
  );
}

function tabDropTargetFromPoint(viewport: HTMLElement, clientX: number): TabDropTarget {
  const tabs = tabElements(viewport);
  const insertIndex = tabs.findIndex((element) => {
    const rect = element.getBoundingClientRect();
    return clientX < rect.left + rect.width / 2;
  });
  const index = insertIndex >= 0 ? insertIndex : tabs.length;
  const nextElement = tabs[index] ?? null;
  const previousElement = index > 0 ? (tabs[index - 1] ?? null) : null;
  const left = nextElement
    ? nextElement.offsetLeft
    : previousElement
      ? previousElement.offsetLeft + previousElement.offsetWidth
      : 0;

  return { insertIndex: index, left };
}

function WorkbenchTabPill(props: {
  active: boolean;
  dragging: boolean;
  onDragEnd: () => void;
  onDragStart: (event: DragEvent<HTMLElement>, tabId: string) => void;
  onActivate: () => void;
  onClose: () => void;
  tab: WorkbenchTabMeta;
}) {
  const Icon = props.tab.icon;
  const title = props.tab.filePath ?? props.tab.browserUrl ?? props.tab.label;
  const faviconUrl = props.tab.kind === "browser" ? props.tab.browserFaviconUrl : undefined;
  const fileIconPath = props.tab.kind === "files" ? props.tab.filePath : undefined;
  const showLabel =
    props.tab.kind === "terminal" ||
    props.tab.kind === "dev" ||
    (props.tab.kind === "browser" && Boolean(props.tab.closable)) ||
    Boolean(props.tab.filePath);
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    props.onActivate();
  };

  return (
    <div
      role="tab"
      tabIndex={props.active ? 0 : -1}
      className={cn(
        workbenchIconButtonVariants({
          active: props.active,
          chrome: "tool",
          tabSystem: true,
        }),
        "group ui-tab-system-tab relative",
        props.active && "bg-honk-bg-tertiary text-honk-fg-primary",
        props.dragging && "opacity-45",
      )}
      aria-label={props.tab.label}
      aria-selected={props.active}
      data-active={props.active ? "true" : "false"}
      data-closable={props.tab.closable ? "true" : undefined}
      data-closeable={props.tab.closable ? "true" : undefined}
      data-kind={props.tab.kind}
      data-dragging={props.dragging ? "true" : undefined}
      data-preview={props.tab.preview ? "true" : undefined}
      data-shell-no-drag=""
      data-stable={props.tab.stable ? "" : undefined}
      data-tab-id={props.tab.id}
      data-workbench-tab="true"
      draggable
      onAuxClick={(event) => {
        if (event.button !== 1 || !props.tab.closable) return;
        event.preventDefault();
        props.onClose();
      }}
      onClick={(event) => {
        event.currentTarget.focus();
        props.onActivate();
      }}
      onDragEnd={props.onDragEnd}
      onDragStart={(event) => props.onDragStart(event, props.tab.id)}
      onKeyDown={handleKeyDown}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        const target = event.target instanceof Element ? event.target : null;
        if (target?.closest("[data-no-drag]")) return;
        props.onActivate();
      }}
      title={title}
    >
      <span className="ui-tab-system-tab__content flex min-w-0 flex-1 items-center justify-start gap-1.5">
        {faviconUrl ? (
          <img
            alt=""
            aria-hidden
            className="ui-tab-system-tab__icon size-4 shrink-0 rounded-[3px]"
            draggable={false}
            src={faviconUrl}
          />
        ) : fileIconPath ? (
          <FileTreeFileIcon
            path={fileIconPath}
            className="ui-tab-system-tab__icon size-4 shrink-0"
          />
        ) : (
          <span className="ui-tab-system-tab__icon inline-flex size-4 shrink-0 items-center justify-center [&_svg]:size-4 [&_svg]:shrink-0">
            <Icon aria-hidden />
          </span>
        )}
        {showLabel ? (
          <span
            className={cn(
              "ui-tab-system-tab__label min-w-0 truncate",
              props.tab.preview && "italic",
            )}
          >
            {props.tab.label}
          </span>
        ) : null}
      </span>
      {props.tab.closable ? (
        <div
          className="ui-tab-system-tab__close-slot no-drag"
          data-no-drag=""
          data-shell-no-drag=""
          draggable={false}
          style={
            props.tab.kind === "terminal"
              ? TERMINAL_TAB_CLOSE_SLOT_STYLE
              : WORKBENCH_TAB_CLOSE_SLOT_STYLE
          }
        >
          <button
            type="button"
            aria-label={`Close ${props.tab.label}`}
            className="ui-tab-system-tab__close no-drag flex size-full shrink-0 items-center justify-center rounded-sm border-0 bg-transparent p-0 text-honk-fg-tertiary opacity-0 shadow-none outline-hidden transition-opacity hover:bg-transparent hover:text-honk-fg-primary focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-honk-stroke-focused focus-visible:ring-inset group-hover:opacity-100"
            data-no-drag=""
            data-shell-no-drag=""
            draggable={false}
            onClick={(event) => {
              event.stopPropagation();
              props.onClose();
            }}
            onPointerDown={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
          >
            <IconCrossMediumDefault className="size-3" aria-hidden />
          </button>
        </div>
      ) : null}
    </div>
  );
}

function WorkbenchTabClusters(props: {
  activeTabId: string;
  tabs: readonly WorkbenchTabMeta[];
  onActivateTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onMoveTab: (tabId: string, targetIndex: number) => void;
}) {
  const scrollableRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [draggingTabId, setDraggingTabId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<TabDropTarget | null>(null);
  const [scrollMaskState, setScrollMaskState] =
    useState<ScrollMaskState>(DEFAULT_SCROLL_MASK_STATE);
  const activeMeta =
    props.tabs.find((tab) => tab.id === props.activeTabId) ?? props.tabs[0] ?? null;

  const setNextDropTarget = useCallback((nextTarget: TabDropTarget | null) => {
    setDropTarget((current) =>
      current?.insertIndex === nextTarget?.insertIndex && current?.left === nextTarget?.left
        ? current
        : nextTarget,
    );
  }, []);

  const syncScrollMaskState = useCallback(() => {
    const next = scrollMaskStateFromElement(scrollableRef.current);
    setScrollMaskState((current) => (areScrollMaskStatesEqual(current, next) ? current : next));
  }, []);

  const onTabDragStart = useCallback((event: DragEvent<HTMLElement>, tabId: string) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("[data-no-drag]")) {
      event.preventDefault();
      return;
    }
    event.stopPropagation();
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(WORKBENCH_TAB_DRAG_MIME_TYPE, tabId);
    event.dataTransfer.setData("text/plain", `workbench-tab:${tabId}`);
    setDraggingTabId(tabId);
    setDropTarget(null);
  }, []);

  const resetDragState = useCallback(() => {
    setDraggingTabId(null);
    setDropTarget(null);
  }, []);

  const onScrollableDragOver = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      const viewport = viewportRef.current;
      const tabId = draggingTabId ?? readDraggedTabId(event);
      if (!viewport || !tabId || !props.tabs.some((tab) => tab.id === tabId)) {
        setNextDropTarget(null);
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "move";
      setNextDropTarget(tabDropTargetFromPoint(viewport, event.clientX));
    },
    [draggingTabId, props.tabs, setNextDropTarget],
  );

  const onScrollableDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      const viewport = viewportRef.current;
      const tabId = draggingTabId ?? readDraggedTabId(event);
      if (!viewport || !tabId) {
        resetDragState();
        return;
      }
      const currentIndex = props.tabs.findIndex((tab) => tab.id === tabId);
      if (currentIndex < 0) {
        resetDragState();
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      const target = dropTarget ?? tabDropTargetFromPoint(viewport, event.clientX);
      const targetIndex =
        currentIndex < target.insertIndex ? target.insertIndex - 1 : target.insertIndex;
      if (targetIndex !== currentIndex) {
        props.onMoveTab(tabId, targetIndex);
      }
      resetDragState();
    },
    [draggingTabId, dropTarget, props.tabs, props.onMoveTab, resetDragState],
  );

  const onScrollableDragLeave = useCallback((event: DragEvent<HTMLDivElement>) => {
    const nextTarget = event.relatedTarget instanceof Node ? event.relatedTarget : null;
    if (nextTarget && event.currentTarget.contains(nextTarget)) return;
    setDropTarget(null);
  }, []);

  useLayoutSyncEffect(() => {
    if (draggingTabId) return;
    const viewport = viewportRef.current;
    if (!viewport) return;
    const activeElement = tabElementById(viewport, props.activeTabId);
    activeElement?.scrollIntoView({ behavior: "instant", block: "nearest", inline: "nearest" });
    syncScrollMaskState();
  }, [draggingTabId, props.activeTabId, props.tabs.length, syncScrollMaskState]);

  useLayoutSyncEffect(() => {
    syncScrollMaskState();
  }, [props.tabs.length, syncScrollMaskState]);

  return (
    <div
      role="tablist"
      aria-label="Workbench tabs"
      className="ui-tab-system-tabs flex h-full min-w-0 flex-1 select-none items-center self-stretch"
    >
      <div
        ref={scrollableRef}
        className="ui-tab-system-tabs__scrollable relative h-full min-w-0 flex-1 scrollbar-none overflow-x-auto overflow-y-hidden"
        data-scroll-at-end={scrollMaskState.atEnd ? "true" : "false"}
        data-scroll-at-start={scrollMaskState.atStart ? "true" : "false"}
        data-scroll-overflow={scrollMaskState.hasOverflow ? "true" : "false"}
        onDragLeave={onScrollableDragLeave}
        onDragOver={onScrollableDragOver}
        onDrop={onScrollableDrop}
        onScroll={syncScrollMaskState}
      >
        <div
          ref={viewportRef}
          className="ui-tab-system-tabs__viewport relative flex h-full w-max min-w-full items-center ps-2"
        >
          {props.tabs.map((tab) => (
            <WorkbenchTabPill
              key={tab.id}
              tab={tab}
              active={tab.id === props.activeTabId}
              dragging={tab.id === draggingTabId}
              onActivate={() => props.onActivateTab(tab.id)}
              onClose={() => props.onCloseTab(tab.id)}
              onDragEnd={resetDragState}
              onDragStart={onTabDragStart}
            />
          ))}
          <div
            aria-hidden
            className="editor-panel-tab-bar-spacer ui-tab-system-tabs__spacer min-w-4 flex-1 self-stretch"
            data-shell-drag-region=""
          />
          {dropTarget ? (
            <div
              aria-hidden
              className="ui-tab-system-drop-indicator"
              style={{ left: `${dropTarget.left}px` }}
            />
          ) : null}
        </div>
      </div>
      {activeMeta ? (
        <div className="sr-only" aria-live="polite">
          {activeMeta.label}
        </div>
      ) : null}
    </div>
  );
}

function NewTabMenu(props: {
  onActivateChanges: () => void;
  onCreateBrowser: (url?: string | undefined) => void;
  onCreateFile: () => void;
  onCreateTerminal: () => void;
}) {
  const [open, setOpen] = useState(false);

  const runItem = (id: NewTabMenuItem["id"]) => {
    if (id === "changes") props.onActivateChanges();
    if (id === "terminal") props.onCreateTerminal();
    if (id === "browser") props.onCreateBrowser();
    if (id === "file") props.onCreateFile();
    setOpen(false);
  };

  return (
    <div
      className="editor-panel-overflow-action pointer-events-auto flex shrink-0 items-center"
      data-shell-no-drag=""
    >
      <Menu open={open} onOpenChange={setOpen}>
        <MenuTrigger
          aria-expanded={open}
          aria-label="Open new tab menu"
          className={cn(workbenchIconButtonVariants({ active: open, chrome: "tool" }))}
          title="New Tab"
        >
          <IconPlusLarge className="size-4 shrink-0" aria-hidden />
        </MenuTrigger>
        <MenuPopup
          aria-label="New tab options"
          align="end"
          className="w-max min-w-32 max-w-[calc(100vw-16px)] max-h-[min(720px,var(--available-height))]"
          side="bottom"
          sideOffset={4}
          variant="workbench"
        >
          <div className="flex flex-col gap-px">
            {NEW_TAB_MENU_ITEMS.map((item) => {
              const Icon = item.icon;
              return (
                <MenuItem
                  className="min-h-7 gap-2 px-2 py-1"
                  key={item.id}
                  onClick={() => {
                    runItem(item.id);
                  }}
                  variant="workbench"
                >
                  <WorkbenchMenuIconSlot className="[&>svg]:size-4">
                    <Icon className="size-4 shrink-0" aria-hidden />
                  </WorkbenchMenuIconSlot>
                  <WorkbenchMenuPrimaryText className="flex-none whitespace-nowrap">
                    {item.label}
                  </WorkbenchMenuPrimaryText>
                </MenuItem>
              );
            })}
          </div>
        </MenuPopup>
      </Menu>
    </div>
  );
}

function FullscreenChatTitle(props: { title: string | null }) {
  const title = props.title?.trim() ?? "";
  if (!title) return null;

  return (
    <>
      <span
        className="chat-title-tab-row no-drag min-w-0 shrink"
        data-shell-no-drag=""
        data-shell-fullscreen-chat-title=""
      >
        <span className="chat-title-tab-trigger px-(--honk-spacing-2)">
          <span className="chat-title-tab-title text-honk-tab text-honk-fg-primary">{title}</span>
        </span>
      </span>
      <WorkbenchChromeDivider data-shell-fullscreen-chat-divider="" />
    </>
  );
}

interface RightWorkbenchHeaderProps {
  workspaceKey: string | null;
  threadTitle: string | null;
  tabs: readonly WorkbenchTabMeta[];
  activeTabId: string;
  fullscreenControl?: ReactNode | undefined;
  onActivateChanges: () => void;
  onActivateTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onCreateBrowser: (url?: string | undefined) => void;
  onCreateFile: () => void;
  onCreateTerminal: () => void;
  onHidePanel: () => void;
  onMoveTab: (tabId: string, targetIndex: number) => void;
}

export const RightWorkbenchHeader = memo(function RightWorkbenchHeader(
  props: RightWorkbenchHeaderProps,
) {
  const trailing = (
    <>
      <NewTabMenu
        onActivateChanges={props.onActivateChanges}
        onCreateBrowser={props.onCreateBrowser}
        onCreateFile={props.onCreateFile}
        onCreateTerminal={props.onCreateTerminal}
      />
      {props.fullscreenControl}
    </>
  );

  return (
    <RightWorkbenchToolIsland
      trailing={trailing}
      end={
        <WorkbenchIconButton
          aria-label="Hide Panel"
          chrome="tool"
          onClick={props.onHidePanel}
          title="Hide Panel"
        >
          <IconSidebarHiddenRightWide className="size-4 shrink-0" aria-hidden />
        </WorkbenchIconButton>
      }
    >
      <>
        <FileTreeIconSprite />
        <div className="editor-panel-tab-bar-leading" data-shell-fullscreen-leading="" />
        <FullscreenChatTitle title={props.threadTitle} />
        <WorkbenchTabClusters
          activeTabId={props.activeTabId}
          tabs={props.tabs}
          onActivateTab={props.onActivateTab}
          onCloseTab={props.onCloseTab}
          onMoveTab={props.onMoveTab}
        />
      </>
    </RightWorkbenchToolIsland>
  );
});
