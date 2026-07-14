// The side workbench — the old desktop app's right column, rebuilt for the sidecar world
// (2026-07-12 migration round). Panels and their data seams:
//   Changes  — client.file.status + client.vcs.get + client.file.read (patch hunks)   [live]
//   Files    — client.file.list tree + client.file.read viewer (read-only)            [live]
//   Terminal — xterm over the desktop PTY bridge (window.desktopBridge.pty)           [live on desktop]
//   Browser  — the desktop webview seam exists in the preload; panel port is a later round.
//
// 2026-07-13 Cursor-parity pass. Cursor's collapsed-apps-rail was recovered from the shipped
// Glass bundle, not inferred from the screenshot: a 260px labeled rail, 12px section labels,
// 32px ghost rows, live change totals, and a 40px compact strip below an 880px measured layout.
// Honk maps those rows onto its existing Changes/Browser/Terminal/Files panels. Visited workbench
// surfaces are the honest equivalent of Cursor's editor tabs and appear under Open Tabs.
//
// State (width, open flag, active tab, rail mode) is a module store on localStorage — the workbench is
// shell furniture, not thread data, so it persists across threads and launches. Effect-free
// (ADR 0025): the sash uses pointer capture handlers; persistence writes happen in the actions.

import * as stylex from "@stylexjs/stylex";
import { Button, Icon, IconButton, Text, Tooltip } from "@honk/ui";
import {
  IconBubbleQuestion,
  IconChanges,
  IconConsoleSimple,
  IconFileBend,
  IconGlobe,
  IconPlusSmall,
  IconSidebarSimpleRightWide,
} from "@honk/ui/icons";
import { colorVars, controlVars, fontVars, spaceVars } from "@honk/ui/tokens.stylex";
import * as React from "react";

import type { SideChatSummary } from "./sidecar";
import { actions as toastActions } from "./toast-store";
import { useWorkspaceWatchSelector } from "./use-sdk-watch";
import { WorkbenchChanges, useWorkbenchChangesSnapshot } from "./workbench-changes";
import { WorkbenchFiles } from "./workbench-files";
import { WorkbenchTerminal } from "./workbench-terminal";

// ── Geometry (old shell panel + recovered Cursor rail) ──────────────────────────────────────
const WIDTH_DEFAULT = 400;
const WIDTH_MIN = 300;
const WIDTH_MAX = 720;
const SASH_WIDTH = "5px";
const PANEL_HEAD_HEIGHT = "36px";
const HAIRLINE_WIDTH = "1px";
// Exact collapsed-apps-rail mechanics from workbench.glass.main.js/.css. These values describe
// this component's layout state, not reusable design decisions, so they remain named intrinsics.
const RAIL_LABELED_WIDTH = "260px";
const RAIL_COMPACT_WIDTH = "40px";
const RAIL_LAYOUT_THRESHOLD = 880;
const RAIL_SECTION_GAP = "16px";
const RAIL_SECTION_LINE_HEIGHT = "15px";
const RAIL_SCROLL_TOP_PAD = "2px";
const RAIL_INSET_SMALL = "4px";
const RAIL_OPTIONS_OFFSET = "10px";
const RAIL_COMPACT_GAP = "1px";

const STORAGE_KEY = "honk:app-next:workbench:v1";

type WorkbenchTab = "changes" | "files" | "terminal" | "browser";

// Cursor's app-row order and glyph semantics: plus/minus, globe, terminal, file.
const TABS = [
  { id: "changes", label: "Changes", icon: IconChanges },
  { id: "browser", label: "Browser", icon: IconGlobe },
  { id: "terminal", label: "Terminal", icon: IconConsoleSimple },
  { id: "files", label: "Files", icon: IconFileBend },
] as const;

// ── Store ────────────────────────────────────────────────────────────────────────────────────

type WorkbenchState = {
  readonly isOpen: boolean;
  readonly width: number;
  readonly tab: WorkbenchTab;
  readonly sideChatId: string | null;
  readonly sideChatParentId: string | null;
};

function readPersisted(): WorkbenchState {
  const fallback: WorkbenchState = {
    isOpen: false,
    width: WIDTH_DEFAULT,
    tab: "changes",
    sideChatId: null,
    sideChatParentId: null,
  };
  if (typeof window === "undefined") {
    return fallback;
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) {
      return fallback;
    }
    const parsed = JSON.parse(raw) as Partial<WorkbenchState>;
    return {
      isOpen: parsed.isOpen === true,
      width:
        typeof parsed.width === "number"
          ? Math.min(WIDTH_MAX, Math.max(WIDTH_MIN, parsed.width))
          : WIDTH_DEFAULT,
      tab: TABS.some((t) => t.id === parsed.tab) ? (parsed.tab as WorkbenchTab) : "changes",
      sideChatId: typeof parsed.sideChatId === "string" ? parsed.sideChatId : null,
      sideChatParentId:
        typeof parsed.sideChatParentId === "string" ? parsed.sideChatParentId : null,
    };
  } catch {
    return fallback;
  }
}

let state: WorkbenchState = readPersisted();
const listeners = new Set<() => void>();

function setState(next: WorkbenchState): void {
  state = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Persistence is best-effort; the session keeps the in-memory state.
  }
  for (const listener of listeners) {
    listener();
  }
}

// Arrow-function properties, not method shorthand — consumers pass these as handlers, and the
// unbound-method lint (rightly) rejects shorthand there (tabs.tsx precedent).
const workbenchActions = {
  toggle: (): void => {
    setState({ ...state, isOpen: !state.isOpen });
  },
  setTab: (tab: WorkbenchTab): void => {
    setState({ ...state, tab, isOpen: true, sideChatId: null, sideChatParentId: null });
  },
  setSideChat: (sideChatId: string, parentThreadId: string): void => {
    setState({ ...state, sideChatId, sideChatParentId: parentThreadId, isOpen: true });
  },
  setWidth: (width: number): void => {
    setState({ ...state, width: Math.min(WIDTH_MAX, Math.max(WIDTH_MIN, width)) });
  },
};

// Selector-shaped like tab-store's useTabsSelector: ThreadPage reads only isOpen, and must
// not re-render on every sash-drag width write.
function useWorkbench<T>(selector: (current: WorkbenchState) => T): T {
  return React.useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    () => selector(state),
    () => selector(state),
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────────────────────

const styles = stylex.create({
  // The resizable surface sits left of the recovered launcher rail, pinned to the window edge.
  column: {
    position: "relative",
    flexShrink: 0,
    height: "100%",
    minHeight: 0,
    display: "flex",
    flexDirection: "row",
    boxSizing: "border-box",
  },
  labeledRail: {
    flexShrink: 0,
    width: RAIL_LABELED_WIDTH,
    height: "100%",
    display: "flex",
    flexDirection: "column",
    paddingBlockStart: spaceVars["--honk-space-panel-pad"],
    boxSizing: "border-box",
  },
  railCard: {
    position: "relative",
    width: RAIL_LABELED_WIDTH,
    maxHeight: "100%",
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
    overflow: "hidden",
  },
  railScroll: {
    display: "flex",
    flexDirection: "column",
    minHeight: 0,
    overflowY: "auto",
    marginInlineEnd: spaceVars["--honk-space-gutter"],
    paddingBlockStart: RAIL_SCROLL_TOP_PAD,
    paddingBlockEnd: RAIL_INSET_SMALL,
    paddingInline: RAIL_INSET_SMALL,
  },
  railSection: {
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
  },
  railSectionSpaced: {
    marginBlockStart: RAIL_SECTION_GAP,
  },
  railSectionLabel: {
    minWidth: 0,
    overflow: "hidden",
    paddingInline: spaceVars["--honk-space-gutter"],
    paddingBlockEnd: RAIL_INSET_SMALL,
    color: colorVars["--honk-color-text-faint"],
    fontFamily: fontVars["--honk-font-family-ui"],
    fontSize: fontVars["--honk-font-size-detail"],
    lineHeight: RAIL_SECTION_LINE_HEIGHT,
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  labeledRow: {
    justifyContent: "flex-start",
    minWidth: 0,
    gap: spaceVars["--honk-space-gutter"],
    paddingInline: spaceVars["--honk-space-gutter"],
  },
  railRowLabel: {
    flexGrow: 0,
    flexShrink: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  railBadge: {
    display: "inline-flex",
    alignItems: "center",
    flexShrink: 0,
    gap: controlVars["--honk-control-gap"],
    marginInlineStart: "auto",
    fontFamily: fontVars["--honk-font-family-mono"],
    fontSize: fontVars["--honk-font-size-detail"],
    fontVariantNumeric: "tabular-nums",
  },
  railAddition: {
    color: colorVars["--honk-color-diff-addition"],
  },
  railDeletion: {
    color: colorVars["--honk-color-diff-deletion"],
  },
  chromeToggle: {
    position: "absolute",
    insetInlineEnd: RAIL_OPTIONS_OFFSET,
    insetBlockStart: spaceVars["--honk-space-panel-pad"],
    zIndex: 2,
  },
  compactRail: {
    flexShrink: 0,
    width: RAIL_COMPACT_WIDTH,
    height: "100%",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    paddingBlockStart: spaceVars["--honk-space-panel-pad"],
    boxSizing: "border-box",
  },
  compactStrip: {
    minHeight: 0,
    width: "max-content",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: RAIL_COMPACT_GAP,
    paddingInline: RAIL_INSET_SMALL,
    paddingBlockStart: PANEL_HEAD_HEIGHT,
    paddingBlockEnd: RAIL_INSET_SMALL,
    marginInlineEnd: spaceVars["--honk-space-gutter"],
    overflowY: "auto",
  },
  // The resizable panel (left of the rail). Position relative for the sash overlay.
  panel: {
    position: "relative",
    flexShrink: 0,
    height: "100%",
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    boxSizing: "border-box",
    borderInlineStartWidth: HAIRLINE_WIDTH,
    borderInlineStartStyle: "solid",
    borderInlineStartColor: colorVars["--honk-color-border-base"],
  },
  // The sash: a grab lane straddling the panel's left edge. Hover/drag paints the accent hairline.
  sash: {
    position: "absolute",
    insetBlock: 0,
    insetInlineStart: `calc(${SASH_WIDTH} / -2)`,
    width: SASH_WIDTH,
    cursor: "col-resize",
    zIndex: 1,
    backgroundColor: "transparent",
    touchAction: "none",
  },
  sashActive: {
    backgroundColor: colorVars["--honk-color-accent"],
    opacity: 0.4,
  },
  head: {
    flexShrink: 0,
    height: PANEL_HEAD_HEIGHT,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: controlVars["--honk-control-gap"],
    paddingInline: spaceVars["--honk-space-panel-pad"],
    boxSizing: "border-box",
    borderBlockEndWidth: HAIRLINE_WIDTH,
    borderBlockEndStyle: "solid",
    borderBlockEndColor: colorVars["--honk-color-border-muted"],
  },
  headActions: {
    display: "flex",
    alignItems: "center",
    flexShrink: 0,
    gap: controlVars["--honk-control-gap"],
  },
  headTitle: {
    flexGrow: 1,
    minWidth: 0,
  },
  body: {
    flexGrow: 1,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
  },
  // Panels stay mounted once visited (the terminal must survive tab switches); hidden ones
  // collapse via display:none, the old TabsPanel keepMounted behavior.
  panelHost: {
    flexGrow: 1,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
  },
  panelHidden: {
    display: "none",
  },
  placeholder: {
    flexGrow: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: controlVars["--honk-control-gap"],
    padding: spaceVars["--honk-space-panel-pad"],
    textAlign: "center",
  },
});

const dynamic = stylex.create({
  width: (px: number) => ({ width: `${px}px` }),
});

type WorkbenchTabEntry = (typeof TABS)[number];
type ChangeBadge = { readonly additions: number; readonly deletions: number };
const EMPTY_SIDE_CHATS: readonly SideChatSummary[] = Object.freeze([]);

function workspaceName(directory: string): string {
  const trimmed = directory.replace(/[\\/]+$/, "");
  const [name = "workspace"] = trimmed.split(/[\\/]/).slice(-1);
  return name.trim().length > 0 ? name : "workspace";
}

function RailChangeBadge({ badge }: { readonly badge: ChangeBadge }): React.ReactElement | null {
  if (badge.additions <= 0 && badge.deletions <= 0) {
    return null;
  }
  return (
    <span {...stylex.props(styles.railBadge)}>
      {badge.additions > 0 ? (
        <span {...stylex.props(styles.railAddition)}>+{badge.additions}</span>
      ) : null}
      {badge.deletions > 0 ? (
        <span {...stylex.props(styles.railDeletion)}>-{badge.deletions}</span>
      ) : null}
    </span>
  );
}

function LabeledRailRow({
  entry,
  label = entry.label,
  badge,
  isActive,
  onOpen,
}: {
  readonly entry: WorkbenchTabEntry;
  readonly label?: string;
  readonly badge?: ChangeBadge | undefined;
  readonly isActive: boolean;
  readonly onOpen: (tab: WorkbenchTab) => void;
}): React.ReactElement {
  return (
    <Button
      variant="ghost"
      size="lg"
      block
      aria-pressed={isActive}
      iconStart={<Icon icon={entry.icon} size="md" />}
      xstyle={styles.labeledRow}
      onClick={() => {
        onOpen(entry.id);
      }}
    >
      <span {...stylex.props(styles.railRowLabel)}>{label}</span>
      {badge !== undefined ? <RailChangeBadge badge={badge} /> : null}
    </Button>
  );
}

function SideChatRailRow({
  sideChat,
  isActive,
  onOpen,
}: {
  readonly sideChat: SideChatSummary;
  readonly isActive: boolean;
  readonly onOpen: (sideChatId: string, parentThreadId: string) => void;
}): React.ReactElement {
  return (
    <Button
      variant="ghost"
      size="lg"
      block
      aria-pressed={isActive}
      iconStart={<Icon icon={IconBubbleQuestion} size="md" />}
      xstyle={styles.labeledRow}
      onClick={() => {
        onOpen(sideChat.id, sideChat.parentThreadId);
      }}
    >
      <span {...stylex.props(styles.railRowLabel)}>{sideChat.title}</span>
    </Button>
  );
}

// ── The host ─────────────────────────────────────────────────────────────────────────────────

function Workbench({
  parentThreadId,
  directory,
  isThreadRunning,
  onCreateSideChat,
  renderSideChat,
}: {
  readonly parentThreadId: string;
  readonly directory: string;
  readonly isThreadRunning: boolean;
  readonly onCreateSideChat: () => Promise<void>;
  readonly renderSideChat: (sideChatId: string) => React.ReactNode;
}): React.ReactElement {
  const { isOpen, width, tab, sideChatId, sideChatParentId } = useWorkbench((current) => current);
  const allSideChats = useWorkspaceWatchSelector(
    (snapshot) => snapshot.state?.sideChats ?? EMPTY_SIDE_CHATS,
  );
  const sideChats = allSideChats.filter((sideChat) => sideChat.parentThreadId === parentThreadId);
  const changesSnapshot = useWorkbenchChangesSnapshot(directory, isThreadRunning);
  const [isResizing, setResizing] = React.useState(false);
  const [isCreatingSideChat, setCreatingSideChat] = React.useState(false);
  const [isResponsiveCompact, setResponsiveCompact] = React.useState(false);
  const dragRef = React.useRef<{ pointerId: number; startX: number; startWidth: number } | null>(
    null,
  );
  // Which panels have been shown at least once — only those stay mounted.
  const [visited, setVisited] = React.useState<ReadonlySet<WorkbenchTab>>(() => new Set([tab]));
  if (isOpen && !visited.has(tab)) {
    setVisited(new Set([...visited, tab]));
  }

  const activeTab = TABS.find((entry) => entry.id === tab) ?? TABS[0];
  const activeSideChat = sideChats.find((sideChat) => sideChat.id === sideChatId);
  const isSideChatActive = sideChatId !== null && sideChatParentId === parentThreadId;
  const openTabs = TABS.filter((entry) => entry.id !== "changes" && visited.has(entry.id));
  const isCompact = isResponsiveCompact;
  const changeBadge =
    changesSnapshot.phase === "ready"
      ? changesSnapshot.changes.reduce<ChangeBadge>(
          (total, change) => ({
            additions: total.additions + change.added,
            deletions: total.deletions + change.removed,
          }),
          { additions: 0, deletions: 0 },
        )
      : undefined;

  const attachColumn = (node: HTMLElement | null) => {
    if (node === null) {
      return;
    }
    const layout = node.parentElement;
    if (layout === null) {
      return;
    }
    const measure = (): void => {
      setResponsiveCompact(layout.getBoundingClientRect().width < RAIL_LAYOUT_THRESHOLD);
    };
    measure();
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(measure);
    observer.observe(layout);
    return () => {
      observer.disconnect();
    };
  };

  const handleSashPointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) {
      return;
    }
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: width };
    event.currentTarget.setPointerCapture(event.pointerId);
    setResizing(true);
  };
  const handleSashPointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    if (drag === null || event.pointerId !== drag.pointerId) {
      return;
    }
    // The column sits on the RIGHT: dragging left grows it.
    workbenchActions.setWidth(drag.startWidth + (drag.startX - event.clientX));
  };
  const handleSashPointerEnd = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (dragRef.current?.pointerId !== event.pointerId) {
      return;
    }
    dragRef.current = null;
    setResizing(false);
  };
  const handleCreateSideChat = (): void => {
    if (isCreatingSideChat) {
      return;
    }
    setCreatingSideChat(true);
    void onCreateSideChat()
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        toastActions.add({
          type: "error",
          title: "Side chat failed",
          description: message,
          copyableError: message,
          threadKey: parentThreadId,
        });
      })
      .finally(() => {
        setCreatingSideChat(false);
      });
  };

  return (
    <aside ref={attachColumn} aria-label="Workbench" {...stylex.props(styles.column)}>
      <div {...stylex.props(styles.chromeToggle)}>
        <Tooltip label={isOpen ? "Collapse workbench" : "Open workbench"}>
          <IconButton
            type="button"
            aria-label={isOpen ? "Collapse workbench" : "Open workbench"}
            aria-pressed={isOpen}
            size="sm"
            variant="ghost"
            onClick={workbenchActions.toggle}
          >
            <Icon icon={IconSidebarSimpleRightWide} size="sm" />
          </IconButton>
        </Tooltip>
      </div>
      {isOpen ? (
        <div {...stylex.props(styles.panel, dynamic.width(width))}>
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize workbench"
            {...stylex.props(styles.sash, isResizing && styles.sashActive)}
            onPointerDown={handleSashPointerDown}
            onPointerMove={handleSashPointerMove}
            onPointerUp={handleSashPointerEnd}
            onPointerCancel={handleSashPointerEnd}
          />
          <div {...stylex.props(styles.head)}>
            <Text size="sm" tone="muted" weight="medium" truncate xstyle={styles.headTitle}>
              {isSideChatActive ? (activeSideChat?.title ?? "Side Chat") : activeTab.label}
            </Text>
            <div {...stylex.props(styles.headActions)}>
              <Tooltip label="New side chat">
                <IconButton
                  type="button"
                  aria-label="New side chat"
                  size="sm"
                  variant="ghost"
                  disabled={isCreatingSideChat}
                  onClick={handleCreateSideChat}
                >
                  <Icon icon={IconPlusSmall} size="sm" />
                </IconButton>
              </Tooltip>
            </div>
          </div>
          <div {...stylex.props(styles.body)}>
            {isSideChatActive && sideChatId !== null ? (
              <div {...stylex.props(styles.panelHost)}>{renderSideChat(sideChatId)}</div>
            ) : null}
            {visited.has("changes") && (
              <div
                {...stylex.props(
                  styles.panelHost,
                  (isSideChatActive || tab !== "changes") && styles.panelHidden,
                )}
              >
                {/* key={directory}: a thread can be re-aimed at another folder — panel caches must die with the old cwd */}
                <WorkbenchChanges
                  key={directory}
                  directory={directory}
                  isThreadRunning={isThreadRunning}
                />
              </div>
            )}
            {visited.has("files") && (
              <div
                {...stylex.props(
                  styles.panelHost,
                  (isSideChatActive || tab !== "files") && styles.panelHidden,
                )}
              >
                <WorkbenchFiles key={directory} directory={directory} />
              </div>
            )}
            {visited.has("terminal") && (
              <div
                {...stylex.props(
                  styles.panelHost,
                  (isSideChatActive || tab !== "terminal") && styles.panelHidden,
                )}
              >
                <WorkbenchTerminal
                  key={directory}
                  cwd={directory}
                  isVisible={!isSideChatActive && tab === "terminal"}
                />
              </div>
            )}
            {visited.has("browser") && (
              <div
                {...stylex.props(
                  styles.panelHost,
                  (isSideChatActive || tab !== "browser") && styles.panelHidden,
                )}
              >
                <div {...stylex.props(styles.placeholder)}>
                  <Text as="p" size="sm" tone="muted" weight="medium">
                    Browser panel lands next round
                  </Text>
                  <Text as="p" size="xs" tone="faint">
                    The desktop webview seam already exists; the panel port follows the terminal.
                  </Text>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}

      {isCompact ? (
        <div aria-label="Apps" {...stylex.props(styles.compactRail)}>
          <div {...stylex.props(styles.compactStrip)}>
            {TABS.map((entry) => {
              const label =
                entry.id === "terminal" && visited.has("terminal") ? "1 Terminal" : entry.label;
              const isActive = isOpen && !isSideChatActive && entry.id === tab;
              return (
                <Tooltip key={entry.id} label={label}>
                  <IconButton
                    type="button"
                    aria-label={label}
                    aria-pressed={isActive}
                    size="lg"
                    variant="ghost"
                    onClick={() => {
                      workbenchActions.setTab(entry.id);
                    }}
                  >
                    <Icon icon={entry.icon} size="md" />
                  </IconButton>
                </Tooltip>
              );
            })}
            {sideChats.map((sideChat) => (
              <Tooltip key={sideChat.id} label={sideChat.title}>
                <IconButton
                  type="button"
                  aria-label={sideChat.title}
                  aria-pressed={isOpen && isSideChatActive && sideChat.id === sideChatId}
                  size="lg"
                  variant="ghost"
                  onClick={() => {
                    workbenchActions.setSideChat(sideChat.id, sideChat.parentThreadId);
                  }}
                >
                  <Icon icon={IconBubbleQuestion} size="md" />
                </IconButton>
              </Tooltip>
            ))}
          </div>
        </div>
      ) : (
        <div aria-label="Apps" {...stylex.props(styles.labeledRail)}>
          <div {...stylex.props(styles.railCard)}>
            <div {...stylex.props(styles.railScroll)}>
              {openTabs.length > 0 ? (
                <div {...stylex.props(styles.railSection)}>
                  <div {...stylex.props(styles.railSectionLabel)}>Open Tabs</div>
                  {openTabs.map((entry) => (
                    <LabeledRailRow
                      key={entry.id}
                      entry={entry}
                      isActive={isOpen && !isSideChatActive && entry.id === tab}
                      onOpen={workbenchActions.setTab}
                    />
                  ))}
                </div>
              ) : null}
              <div
                {...stylex.props(
                  styles.railSection,
                  openTabs.length > 0 && styles.railSectionSpaced,
                )}
              >
                <div {...stylex.props(styles.railSectionLabel)}>On {workspaceName(directory)}</div>
                {TABS.map((entry) => (
                  <LabeledRailRow
                    key={entry.id}
                    entry={entry}
                    label={
                      entry.id === "terminal" && visited.has("terminal")
                        ? "1 Terminal"
                        : entry.label
                    }
                    badge={entry.id === "changes" ? changeBadge : undefined}
                    isActive={isOpen && !isSideChatActive && entry.id === tab}
                    onOpen={workbenchActions.setTab}
                  />
                ))}
              </div>
              {sideChats.length > 0 ? (
                <div {...stylex.props(styles.railSection, styles.railSectionSpaced)}>
                  <div {...stylex.props(styles.railSectionLabel)}>Side chats</div>
                  {sideChats.map((sideChat) => (
                    <SideChatRailRow
                      key={sideChat.id}
                      sideChat={sideChat}
                      isActive={isOpen && isSideChatActive && sideChat.id === sideChatId}
                      onOpen={workbenchActions.setSideChat}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}

export { Workbench, workbenchActions, useWorkbench };
export type { WorkbenchTab };
