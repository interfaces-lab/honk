import { Button, Icon, IconButton, Spinner, Text, Tooltip, Tray } from "@honk/ui";
import { IconArrowUp, IconChevronDownMedium, IconPencilLine, IconTrashCan } from "@honk/ui/icons";
import {
  borderVars,
  composerVars,
  controlVars,
  motionVars,
  radiusVars,
  spaceVars,
} from "@honk/ui/tokens.stylex";
import * as stylex from "@stylexjs/stylex";
import * as React from "react";

import { SkillText } from "./chip";
import type { QueueItem } from "./queue-store";
import { formatSkillReferenceLabel } from "./submission";

export type ComposerQueueTrayHandle = {
  readonly enterFromPrompt: () => boolean;
};

const QUEUE_ROW_EDITING_RING = `inset 0 0 0 ${borderVars["--honk-border-hairline"]} ${composerVars["--honk-composer-queue-row-editing-ring"]}`;

const styles = stylex.create({
  trayHost: {
    width: "100%",
    minHeight: 0,
    display: "flex",
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: spaceVars["--honk-space-gutter"],
    minWidth: 0,
    width: "100%",
  },
  headerSpacer: { flexGrow: 1 },
  hint: {
    display: "inline-flex",
    alignItems: "center",
    gap: spaceVars["--honk-space-gutter"],
  },
  list: {
    display: "flex",
    flexDirection: "column",
    // oxlint-disable-next-line honk/design-no-raw-values -- 1px keeps adjacent rows' hover backgrounds from fusing, Cursor's fixed queue-list gap; no gap token owns a hairline
    gap: "1px",
    listStyle: "none",
    margin: 0,
    padding: 0,
    outline: "none",
  },
  row: {
    position: "relative",
    boxSizing: "border-box",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spaceVars["--honk-space-gutter"],
    // Cursor bleeds the state surface halfway into the tray's 12px content inset while
    // restoring that 6px on the row itself, so text stays aligned without a full-width slab.
    marginInline: `calc(0px - ${controlVars["--honk-control-gap"]})`,
    paddingInline: controlVars["--honk-control-gap"],
    width: `calc(100% + ${controlVars["--honk-control-gap"]} + ${controlVars["--honk-control-gap"]})`,
    minHeight: controlVars["--honk-control-h-md"],
    borderRadius: radiusVars["--honk-radius-control"],
    transitionProperty: "background-color",
    transitionDuration: motionVars["--honk-motion-duration-hover"],
    transitionTimingFunction: motionVars["--honk-motion-ease-out"],
    cursor: "grab",
    // Cursor holds queue-row actions back until the row is hovered or takes focus, so the
    // resting list reads as message text rather than a strip of buttons. StyleX 0.19 has no
    // descendant selectors, so the row publishes the reveal through private `--_` vars its
    // actions read. Pointers without hover never reach either state, so they get the
    // actions permanently.
    "--_actions-opacity": {
      default: "0",
      ":hover": { "@media (hover: hover)": "1" },
      ":focus-within": "1",
      "@media (hover: none)": "1",
    },
    // Opacity alone leaves invisible buttons hit-testable; pointer-events tracks the reveal.
    "--_actions-pointer-events": {
      default: "none",
      ":hover": { "@media (hover: hover)": "auto" },
      ":focus-within": "auto",
      "@media (hover: none)": "auto",
    },
  },
  rowLabel: {
    display: "block",
    flexBasis: 0,
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 0,
  },
  rowActions: {
    display: "flex",
    alignItems: "center",
    flexShrink: 0,
    opacity: "var(--_actions-opacity, 0)",
    pointerEvents: "var(--_actions-pointer-events, none)",
    transitionProperty: "opacity",
    transitionDuration: motionVars["--honk-motion-duration-hover"],
    transitionTimingFunction: motionVars["--honk-motion-ease-out"],
  },
  dropBefore: {
    // oxlint-disable-next-line honk/design-no-raw-values -- 2px drop-indicator line is fixed geometry, no elevation token draws an edge line
    boxShadow: `inset 0 2px 0 0 ${composerVars["--honk-composer-queue-drop-indicator"]}`,
  },
  dropAfter: {
    // oxlint-disable-next-line honk/design-no-raw-values -- 2px drop-indicator line is fixed geometry, no elevation token draws an edge line
    boxShadow: `inset 0 -2px 0 0 ${composerVars["--honk-composer-queue-drop-indicator"]}`,
  },
  dragging: { opacity: 0.35 },
  interactive: {
    backgroundColor: {
      default: "transparent",
      ":hover": {
        "@media (hover: hover)": composerVars["--honk-composer-queue-row-hover"],
      },
    },
  },
  active: {
    backgroundColor: composerVars["--honk-composer-queue-row-active"],
    "--_actions-opacity": "1",
    "--_actions-pointer-events": "auto",
  },
  editing: {
    backgroundColor: composerVars["--honk-composer-queue-row-editing"],
    boxShadow: QUEUE_ROW_EDITING_RING,
  },
});

export function ComposerQueueTray({
  items,
  editingId,
  showSendHint,
  needsAttention = false,
  handleRef,
  isStartingAll = false,
  onEdit,
  onSendNow,
  onRemove,
  onReorder,
  onStartAll,
  onExit,
}: {
  readonly items: readonly QueueItem[];
  readonly editingId: string | null;
  readonly showSendHint: boolean;
  readonly needsAttention?: boolean;
  readonly handleRef?: React.Ref<ComposerQueueTrayHandle>;
  readonly isStartingAll?: boolean;
  readonly onEdit: (id: string) => void;
  readonly onSendNow: (id: string) => void;
  readonly onRemove: (id: string) => void;
  readonly onReorder: (movedId: string, targetId: string, insertAfter: boolean) => void;
  readonly onStartAll?: () => void;
  readonly onExit: () => void;
}): React.ReactElement {
  const [collapsed, setCollapsed] = React.useState(false);
  const [dragId, setDragId] = React.useState<string | null>(null);
  const [keyboardFocused, setKeyboardFocused] = React.useState(false);
  const [dropTarget, setDropTarget] = React.useState<{
    readonly id: string;
    readonly after: boolean;
  } | null>(null);
  const [keyboardActiveId, setKeyboardActiveId] = React.useState<string | null>(
    items[0]?.id ?? null,
  );
  const listID = React.useId();
  const listRef = React.useRef<HTMLUListElement | null>(null);
  const activeId = items.some((item) => item.id === keyboardActiveId)
    ? keyboardActiveId
    : (items[0]?.id ?? null);
  const activeIndex = items.findIndex((item) => item.id === activeId);

  const clearDrag = (): void => {
    setDragId(null);
    setDropTarget(null);
  };

  const focusList = (id: string): void => {
    setKeyboardActiveId(id);
    window.requestAnimationFrame(() => {
      listRef.current?.focus();
    });
  };

  React.useImperativeHandle(
    handleRef,
    () => ({
      enterFromPrompt: () => {
        const last = items.at(-1);
        if (last === undefined) return false;
        focusList(last.id);
        return true;
      },
    }),
    [items],
  );

  const selectAfterRemoval = (): void => {
    setKeyboardActiveId(items[activeIndex + 1]?.id ?? items[activeIndex - 1]?.id ?? null);
  };

  const handleListKeyDown = (event: React.KeyboardEvent<HTMLUListElement>): void => {
    if (event.target !== event.currentTarget) return;
    const active = items[activeIndex];
    if (active === undefined) return;
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setKeyboardActiveId(items[Math.max(0, activeIndex - 1)]?.id ?? active.id);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      const next = items[activeIndex + 1];
      if (next === undefined) {
        onExit();
        return;
      }
      setKeyboardActiveId(next.id);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      onExit();
      return;
    }
    if (event.key === "ArrowRight" || event.key === " ") {
      event.preventDefault();
      onEdit(active.id);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      selectAfterRemoval();
      onSendNow(active.id);
      if (items.length === 1) onExit();
      return;
    }
    if (
      ((event.metaKey || event.ctrlKey) && event.key === "Delete") ||
      (event.metaKey && event.key === "Backspace")
    ) {
      event.preventDefault();
      selectAfterRemoval();
      onRemove(active.id);
      if (items.length === 1) onExit();
    }
  };

  return (
    <div {...stylex.props(styles.trayHost)}>
      <Tray aria-label="Queued messages" maxHeight={200}>
        <Tray.Header rowsExpanded={!collapsed}>
          <div {...stylex.props(styles.header)}>
            <Text size="base" tone="muted" tabularNums>
              {items.length} Queued
            </Text>
            {items.length > 0 && needsAttention ? (
              <span {...stylex.props(styles.hint)}>
                <Text size="base" tone="faint">
                  Waiting for your response
                </Text>
              </span>
            ) : showSendHint ? (
              <span {...stylex.props(styles.hint)}>
                <Text size="base" tone="faint">
                  ↩ to Send
                </Text>
              </span>
            ) : null}
            <span {...stylex.props(styles.headerSpacer)} />
            {isStartingAll ? (
              <Button
                size="sm"
                variant="quiet"
                disabled
                iconStart={<Spinner size="sm" tone="muted" />}
              >
                Starting
              </Button>
            ) : onStartAll === undefined ? null : (
              <Tooltip label="Send every queued message as one turn">
                <Button size="sm" variant="quiet" onClick={onStartAll}>
                  Start All
                </Button>
              </Tooltip>
            )}
            <IconButton
              aria-label={collapsed ? "Expand queue" : "Collapse queue"}
              aria-expanded={!collapsed}
              variant="quiet"
              size="sm"
              onClick={() => {
                setCollapsed((current) => !current);
              }}
            >
              <Icon
                icon={IconChevronDownMedium}
                size="sm"
                style={collapsed ? { transform: "rotate(180deg)" } : undefined}
              />
            </IconButton>
          </div>
        </Tray.Header>
        {collapsed ? null : (
          <Tray.ScrollArea aria-label="Queued messages">
            <ul
              ref={listRef}
              role="listbox"
              aria-label="Queued messages"
              aria-activedescendant={
                !keyboardFocused || activeId === null ? undefined : `${listID}-option-${activeId}`
              }
              tabIndex={-1}
              {...stylex.props(styles.list)}
              onKeyDown={handleListKeyDown}
              onFocus={() => {
                setKeyboardFocused(true);
              }}
              onBlur={(event) => {
                if (
                  event.relatedTarget instanceof Node &&
                  event.currentTarget.contains(event.relatedTarget)
                ) {
                  return;
                }
                setKeyboardFocused(false);
              }}
            >
              {items.map((item) => {
                const isEditing = item.id === editingId;
                const isActive = keyboardFocused && item.id === activeId;
                const label =
                  item.text.trim() !== ""
                    ? item.text
                    : item.files.length === 1
                      ? "1 attachment"
                      : `${String(item.files.length)} attachments`;
                const displayLabel = formatSkillReferenceLabel(label);
                return (
                  <li
                    key={item.id}
                    id={`${listID}-option-${item.id}`}
                    role="option"
                    aria-label={displayLabel}
                    aria-selected={isActive}
                    tabIndex={-1}
                    draggable={!isEditing}
                    {...stylex.props(
                      styles.row,
                      !isEditing && styles.interactive,
                      isActive && styles.active,
                      isEditing && styles.editing,
                      item.id === dragId && styles.dragging,
                      dropTarget?.id === item.id && !dropTarget.after && styles.dropBefore,
                      dropTarget?.id === item.id && dropTarget.after && styles.dropAfter,
                    )}
                    onDoubleClick={() => {
                      if (!isEditing) onEdit(item.id);
                    }}
                    onClick={(event) => {
                      if (
                        event.target instanceof Element &&
                        event.target.closest("button") !== null
                      ) {
                        return;
                      }
                      setKeyboardActiveId(item.id);
                      listRef.current?.focus();
                    }}
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = "move";
                      setDragId(item.id);
                    }}
                    onDragOver={(event) => {
                      if (dragId === null || dragId === item.id) return;
                      event.preventDefault();
                      const rect = event.currentTarget.getBoundingClientRect();
                      const after = event.clientY > rect.top + rect.height / 2;
                      if (dropTarget?.id !== item.id || dropTarget.after !== after) {
                        setDropTarget({ id: item.id, after });
                      }
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      if (dragId !== null && dropTarget !== null && dragId !== dropTarget.id) {
                        onReorder(dragId, dropTarget.id, dropTarget.after);
                      }
                      clearDrag();
                    }}
                    onDragEnd={clearDrag}
                  >
                    <Text size="base" truncate style={styles.rowLabel} title={displayLabel}>
                      <SkillText text={label} />
                    </Text>
                    {isEditing ? (
                      <Text size="xs" tone="faint">
                        Editing
                      </Text>
                    ) : (
                      <span {...stylex.props(styles.rowActions)}>
                        <IconButton
                          aria-label="Edit"
                          variant="quiet"
                          size="sm"
                          onClick={() => {
                            onEdit(item.id);
                          }}
                        >
                          <Icon icon={IconPencilLine} size="sm" />
                        </IconButton>
                        <IconButton
                          aria-label="Send now"
                          variant="quiet"
                          size="sm"
                          onClick={() => {
                            onSendNow(item.id);
                          }}
                        >
                          <Icon icon={IconArrowUp} size="sm" />
                        </IconButton>
                        <IconButton
                          aria-label="Remove"
                          variant="quiet"
                          size="sm"
                          onClick={() => {
                            onRemove(item.id);
                          }}
                        >
                          <Icon icon={IconTrashCan} size="sm" />
                        </IconButton>
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </Tray.ScrollArea>
        )}
      </Tray>
    </div>
  );
}
