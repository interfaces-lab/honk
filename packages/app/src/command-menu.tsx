// Command menu surface — one search-and-act engine, three doors.
// Home embeds CommandMenuInline; the shell mounts CommandMenuOverlay for ⌘K / ⌘O.
// Both share this file's rows + the command-menu store/model. Zero useEffect:
// focus-on-open is a callback ref; outside-click/Escape ride Dialog.Root props.
// Arrow/Enter/Escape on the focused input are component-local (registry owns
// only the global chords).

import * as stylex from "@stylexjs/stylex";
import { Dialog, Field, Icon, Kbd, ListRow, Matrix, StatusDot, Text } from "@honk/ui";
import {
  colorVars,
  controlVars,
  elevationVars,
  fontVars,
  radiusVars,
  spaceVars,
} from "@honk/ui/tokens.stylex";
import {
  IconChevronLeftMedium,
  IconConsole,
  IconPlusSmall,
  IconSettingsGear2,
} from "@honk/ui/icons";
import { useNavigate } from "@tanstack/react-router";
import * as React from "react";

import {
  DEVELOPMENT_COMMANDS,
  rankCommandMenuItems,
  selectableItems,
  SHIPPING_COMMANDS,
  statusDotPulse,
  statusDotTone,
  type CommandMenuCommandId,
  type CommandMenuItem,
} from "./command-menu-model";
import {
  actions as menuActions,
  useCommandMenuSelector,
  type CommandMenuDoor,
} from "./command-menu-store";
import { DEFAULT_SETTINGS_SECTION } from "./settings";
import { canReplayDesktopOnboarding, replayDesktopOnboarding } from "./desktop-bridge";
import { actions as tabActions } from "./tab-store";
import { useWorkspaceWatchSelector } from "./use-sdk-watch";

// ── Anatomy (named intrinsics — omnibox geometry, not identity vocabulary) ───────────────────
// The menu measure is ~620px; tokens don't yet name a command-menu width, so this
// is a justified intrinsic (dialog.tsx DIALOG_MAX_WIDTH precedent).
const MENU_MAX_WIDTH = "620px";
// Results list height cap — the drop stays short; dvh keeps mobile chrome from clipping.
const MENU_DROP_MAX_HEIGHT = "min(420px, 50dvh)";
const HAIRLINE = "1px";
// Section label tracking (0.06em) — typography anatomy, not a token.
const SECTION_TRACKING = "0.06em";

const COMMANDS_WITH_DEVELOPMENT = Object.freeze([...SHIPPING_COMMANDS, ...DEVELOPMENT_COMMANDS]);

const styles = stylex.create({
  // Overlay popup — wider than the default dialog card. Dialog owns z-dialog;
  // z-command via xstyle is blocked by StyleX's zIndex typing (string token vs
  // CSS number) — noted as a DS gap; dialog tier is enough for this WP.
  overlayPopup: {
    maxWidth: MENU_MAX_WIDTH,
    width: "100%",
    padding: spaceVars["--honk-space-gutter"],
    gap: spaceVars["--honk-space-gutter"],
  },
  // Shared omnibox + results column (inline Home and overlay both use this).
  panel: {
    display: "flex",
    flexDirection: "column",
    gap: spaceVars["--honk-space-gutter"],
    width: "100%",
    minWidth: 0,
  },
  scope: {
    display: "flex",
    alignItems: "center",
    flexShrink: 0,
    gap: controlVars["--honk-control-gap"],
    paddingBlock: controlVars["--honk-control-gap"],
    paddingInline: spaceVars["--honk-space-control-pad-x"],
    borderRadius: radiusVars["--honk-radius-control"],
    backgroundColor: colorVars["--honk-color-layer-02"],
    color: colorVars["--honk-color-text-muted"],
    fontSize: fontVars["--honk-font-size-caption"],
    fontWeight: fontVars["--honk-font-weight-medium"],
    whiteSpace: "nowrap",
  },
  hints: {
    display: "flex",
    alignItems: "center",
    gap: controlVars["--honk-control-gap"],
    flexShrink: 0,
    color: colorVars["--honk-color-text-faint"],
  },
  go: {
    flexShrink: 0,
    display: "inline-flex",
    alignItems: "center",
    gap: controlVars["--honk-control-gap"],
    paddingBlock: controlVars["--honk-control-gap"],
    paddingInline: spaceVars["--honk-space-control-pad-x"],
    borderRadius: radiusVars["--honk-radius-field"],
    backgroundColor: colorVars["--honk-color-layer-03"],
    color: colorVars["--honk-color-text-primary"],
    fontSize: fontVars["--honk-font-size-caption"],
    fontWeight: fontVars["--honk-font-weight-medium"],
    borderWidth: 0,
    borderStyle: "none",
    cursor: "pointer",
  },
  back: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    width: controlVars["--honk-control-h-sm"],
    height: controlVars["--honk-control-h-sm"],
    borderRadius: radiusVars["--honk-radius-control"],
    borderWidth: 0,
    borderStyle: "none",
    backgroundColor: "transparent",
    color: colorVars["--honk-color-text-muted"],
    cursor: "pointer",
  },
  drop: {
    display: "flex",
    flexDirection: "column",
    gap: HAIRLINE,
    width: "100%",
    boxSizing: "border-box",
    padding: spaceVars["--honk-space-gutter"],
    borderRadius: radiusVars["--honk-radius-panel"],
    backgroundColor: colorVars["--honk-color-bg-base"],
    boxShadow: elevationVars["--honk-elevation-floating"],
    maxHeight: MENU_DROP_MAX_HEIGHT,
    overflowY: "auto",
  },
  // Inline Home: results sit under the omnibox without a second floating card
  // when the page already provides the measure (one composition).
  dropInline: {
    boxShadow: "none",
    backgroundColor: "transparent",
    padding: 0,
    maxHeight: "none",
    overflowY: "visible",
  },
  header: {
    paddingBlock: controlVars["--honk-control-gap"],
    paddingInline: spaceVars["--honk-space-control-pad-x"],
    color: colorVars["--honk-color-text-faint"],
    fontSize: fontVars["--honk-font-size-micro"],
    fontWeight: fontVars["--honk-font-weight-semibold"],
    letterSpacing: SECTION_TRACKING,
    textTransform: "uppercase",
  },
  // Command-menu tweak on ListRow.Title: the title yields to nothing on its right, so it
  // grows into the free space and pushes the meta cluster to the edge.
  rowTitle: {
    flexGrow: 1,
  },
  verb: {
    color: colorVars["--honk-color-accent"],
    fontWeight: fontVars["--honk-font-weight-semibold"],
  },
  preview: {
    color: colorVars["--honk-color-text-faint"],
    fontWeight: fontVars["--honk-font-weight-regular"],
  },
  empty: {
    padding: spaceVars["--honk-space-panel-pad"],
    textAlign: "center",
  },
});

// ── Shared body (inline + overlay) ───────────────────────────────────────────────────────────

type CommandMenuBodyProps = {
  readonly door: CommandMenuDoor;
  /** Home inline: Commands hidden at rest; always "focused" for ranking. */
  readonly variant: "overlay" | "inline";
  /** Overlay only — Dialog owns open; inline is always "open" for ranking. */
  readonly isOpen?: boolean;
};

function CommandMenuBody({
  door,
  variant,
  isOpen = true,
}: CommandMenuBodyProps): React.ReactElement {
  const navigate = useNavigate();
  const query = useCommandMenuSelector((s) => s.query);
  const selectedIndex = useCommandMenuSelector((s) => s.selectedIndex);
  const submenuStack = useCommandMenuSelector((s) => s.submenuStack);
  const threads = useWorkspaceWatchSelector((s) => s.state?.threads ?? EMPTY_THREADS);

  const items = rankCommandMenuItems({
    query,
    door,
    threads,
    commands: canReplayDesktopOnboarding() ? COMMANDS_WITH_DEVELOPMENT : SHIPPING_COMMANDS,
    submenuStack,
    hideCommandsAtRest: variant === "inline",
  });
  const selectable = selectableItems(items);

  // Clamp selection if the ranked list shrank (query change already resets to 0
  // in the store; this covers thread-list churn while open).
  const safeIndex = selectable.length === 0 ? 0 : Math.min(selectedIndex, selectable.length - 1);

  // Focus-on-open via callback ref — attach focuses when the input mounts into
  // an open overlay; detach is a no-op. No useEffect for focus.
  const inputRef = React.useCallback(
    (node: HTMLInputElement | null) => {
      if (node !== null && isOpen) {
        node.focus();
      }
    },
    [isOpen],
  );

  const runCommand = (run: CommandMenuCommandId): void => {
    switch (run) {
      case "new-thread":
        tabActions.openNew({ prompt: query });
        menuActions.close();
        menuActions.setQuery("");
        return;
      case "open-settings":
        menuActions.close();
        void navigate({
          to: "/settings",
          search: { section: DEFAULT_SETTINGS_SECTION },
        });
        return;
      case "replay-onboarding":
        menuActions.close();
        void replayDesktopOnboarding();
        return;
      default: {
        const _exhaustive: never = run;
        return _exhaustive;
      }
    }
  };

  const activateItem = (item: Exclude<CommandMenuItem, { kind: "header" }>): void => {
    switch (item.kind) {
      case "start-new":
        runCommand("new-thread");
        return;
      case "thread":
        tabActions.open({
          key: item.threadId,
          title: item.title,
          kind: "thread",
          status: item.status,
          repository: { state: "loading" },
        });
        menuActions.close();
        menuActions.setQuery("");
        return;
      case "command":
        runCommand(item.run);
        return;
      case "submenu":
        menuActions.pushSubmenu(item.frame);
        return;
      default: {
        const _exhaustive: never = item;
        return _exhaustive;
      }
    }
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        menuActions.moveSelection(1, selectable.length);
        return;
      case "ArrowUp":
        event.preventDefault();
        menuActions.moveSelection(-1, selectable.length);
        return;
      case "Enter": {
        event.preventDefault();
        const item = selectable[safeIndex];
        if (item !== undefined) {
          activateItem(item);
        } else if (variant === "inline" || door === "command") {
          // Empty list + Enter still starts a new chat (⏎ means Start).
          runCommand("new-thread");
        }
        return;
      }
      case "Escape":
        event.preventDefault();
        if (submenuStack.length > 0) {
          menuActions.popSubmenu();
          return;
        }
        if (variant === "overlay") {
          menuActions.close();
          return;
        }
        menuActions.setQuery("");
        return;
      case "Backspace":
        if (query.length === 0 && submenuStack.length > 0) {
          event.preventDefault();
          menuActions.popSubmenu();
        }
        return;
      default:
        return;
    }
  };

  const topFrame = submenuStack.length > 0 ? submenuStack[submenuStack.length - 1] : undefined;
  const placeholder =
    topFrame?.placeholder ??
    (door === "threads"
      ? "Search threads…"
      : variant === "inline"
        ? "Ask anything — build, fix, explore…"
        : "Search commands and threads…");

  const showDrop = variant === "overlay" || query.length > 0 || submenuStack.length > 0;

  return (
    <div {...stylex.props(styles.panel)}>
      <Field size="lg">
        {submenuStack.length > 0 ? (
          <button
            type="button"
            {...stylex.props(styles.back)}
            aria-label="Back"
            onClick={() => {
              menuActions.popSubmenu();
            }}
          >
            <Icon icon={IconChevronLeftMedium} size="sm" tone="muted" />
          </button>
        ) : (
          <span {...stylex.props(styles.scope)}>{door === "threads" ? "Threads" : "Anywhere"}</span>
        )}
        <Field.Input
          ref={inputRef}
          value={query}
          placeholder={placeholder}
          aria-label={door === "threads" ? "Search threads" : "Command menu"}
          aria-autocomplete="list"
          aria-activedescendant={
            selectable[safeIndex] !== undefined
              ? `command-menu-item-${selectable[safeIndex].id}`
              : undefined
          }
          onChange={(event) => {
            menuActions.setQuery(event.target.value);
          }}
          onKeyDown={onKeyDown}
        />
        <span {...stylex.props(styles.hints)}>
          <Kbd size="sm">Tab</Kbd>
          <Text as="span" size="xs" tone="faint">
            where
          </Text>
        </span>
        <button
          type="button"
          {...stylex.props(styles.go)}
          onClick={() => {
            const item = selectable[safeIndex];
            if (item !== undefined) {
              activateItem(item);
            } else {
              runCommand("new-thread");
            }
          }}
        >
          ⏎ Start
        </button>
      </Field>

      {showDrop ? (
        <div
          {...stylex.props(styles.drop, variant === "inline" && styles.dropInline)}
          role="listbox"
          aria-label="Command menu results"
        >
          {items.length === 0 ? (
            <div {...stylex.props(styles.empty)}>
              <Text as="p" size="sm" tone="muted">
                {door === "threads" ? "No matching threads." : "No matching commands or threads."}
              </Text>
            </div>
          ) : (
            items.map((item) => {
              if (item.kind === "header") {
                return (
                  <div key={item.id} {...stylex.props(styles.header)}>
                    {item.label}
                  </div>
                );
              }

              const selectIndex = selectable.findIndex((s) => s.id === item.id);
              const isActive = selectIndex === safeIndex;

              return (
                <ListRow
                  key={item.id}
                  id={`command-menu-item-${item.id}`}
                  role="option"
                  aria-selected={isActive}
                  // aria-activedescendant combobox model: the input is the only tab
                  // stop; rows highlight via the store, never via DOM focus.
                  tabIndex={-1}
                  isActive={isActive}
                  onMouseEnter={() => {
                    if (selectIndex >= 0) {
                      menuActions.setSelectedIndex(selectIndex);
                    }
                  }}
                  onClick={() => {
                    activateItem(item);
                  }}
                >
                  <RowLeading item={item} />
                  <ListRow.Title xstyle={styles.rowTitle}>
                    <RowTitle item={item} />
                  </ListRow.Title>
                  <ListRow.Meta>
                    <RowMeta item={item} isActive={isActive} />
                  </ListRow.Meta>
                </ListRow>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );
}

const EMPTY_THREADS: readonly never[] = Object.freeze([]);

function RowLeading({
  item,
}: {
  item: Exclude<CommandMenuItem, { kind: "header" }>;
}): React.ReactElement {
  switch (item.kind) {
    case "start-new":
      return (
        <ListRow.Slot>
          <Icon icon={IconPlusSmall} size="sm" tone="accent" />
        </ListRow.Slot>
      );
    case "thread":
      return (
        <ListRow.Slot>
          {item.status === "working" ? (
            <Matrix grid={4} isActive />
          ) : (
            <StatusDot tone={statusDotTone(item.status)} pulse={statusDotPulse(item.status)} />
          )}
        </ListRow.Slot>
      );
    case "command":
      return (
        <ListRow.Slot>
          <Icon
            icon={
              item.run === "open-settings"
                ? IconSettingsGear2
                : item.run === "replay-onboarding"
                  ? IconConsole
                  : IconPlusSmall
            }
            size="sm"
            tone="faint"
          />
        </ListRow.Slot>
      );
    case "submenu":
      return (
        <ListRow.Slot>
          <Icon icon={IconChevronLeftMedium} size="sm" tone="faint" />
        </ListRow.Slot>
      );
    default: {
      const _exhaustive: never = item;
      return _exhaustive;
    }
  }
}

function RowTitle({
  item,
}: {
  item: Exclude<CommandMenuItem, { kind: "header" }>;
}): React.ReactElement {
  if (item.kind === "start-new") {
    return (
      <>
        <span {...stylex.props(styles.verb)}>{item.title}</span>
        {item.queryPreview.length > 0 ? (
          <span {...stylex.props(styles.preview)}> — &ldquo;{item.queryPreview}&rdquo;</span>
        ) : null}
      </>
    );
  }
  return <>{item.title}</>;
}

function RowMeta({
  item,
  isActive,
}: {
  item: Exclude<CommandMenuItem, { kind: "header" }>;
  isActive: boolean;
}): React.ReactNode {
  if (item.kind === "start-new" && isActive) {
    return <Kbd size="sm">⏎</Kbd>;
  }
  if (item.kind === "command" && item.shortcut !== undefined) {
    return <Kbd size="sm">{item.shortcut}</Kbd>;
  }
  return null;
}

// ── Overlay (⌘K / ⌘O) ────────────────────────────────────────────────────────────────────────

function CommandMenuOverlay(): React.ReactElement {
  const open = useCommandMenuSelector((s) => s.open);
  const door = useCommandMenuSelector((s) => s.door);

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          menuActions.close();
        }
      }}
    >
      <Dialog.Popup xstyle={styles.overlayPopup}>
        {/* Visually quiet — the omnibox is the label; Title stays for a11y. */}
        <Dialog.Title xstyle={a11yStyles.visuallyHidden}>
          {door === "threads" ? "Open thread" : "Command menu"}
        </Dialog.Title>
        <CommandMenuBody door={door} variant="overlay" isOpen={open} />
      </Dialog.Popup>
    </Dialog.Root>
  );
}

// Screen-reader-only title (dialog requires a Title; the omnibox is the visual label).
const a11yStyles = stylex.create({
  visuallyHidden: {
    position: "absolute",
    width: HAIRLINE,
    height: HAIRLINE,
    padding: 0,
    margin: `calc(${HAIRLINE} * -1)`,
    overflow: "hidden",
    clipPath: "inset(50%)",
    whiteSpace: "nowrap",
    borderWidth: 0,
  },
});

// ── Inline (Home door) ───────────────────────────────────────────────────────────────────────

function CommandMenuInline(): React.ReactElement {
  // Home always ranks as the command door; Commands hidden at rest.
  return <CommandMenuBody door="command" variant="inline" isOpen />;
}

export { CommandMenuInline, CommandMenuOverlay };
