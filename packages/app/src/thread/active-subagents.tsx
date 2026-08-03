import * as stylex from "@stylexjs/stylex";
import { openCodeSessionRef, type OpenCodeServerKey } from "@honk/opencode";
import { Button, Icon, IconButton, Matrix, PillButton, Text, Tray } from "@honk/ui";
import { IconChevronDownMedium, IconStop } from "@honk/ui/icons";
import {
  composerVars,
  controlVars,
  motionVars,
  radiusVars,
  spaceVars,
} from "@honk/ui/tokens.stylex";
import * as React from "react";

import { errorMessage } from "../error-message";
import { interruptSession } from "../open-code-view";
import { actions as toastActions } from "../toast-store";
import { useSessionWatch } from "../use-sdk-watch";
import { useThreadRuntime } from "./runtime";
import type { TaskChildLink } from "./subagent-session";
import { needsYouActivity, taskMission, taskModelLabel } from "./task-message";
import type { ThreadPart, ToolPart } from "./transcript-model";
import { threadViewState } from "./view-state";

const styles = stylex.create({
  host: {
    alignSelf: "flex-start",
    display: "flex",
    alignItems: "flex-end",
    flexShrink: 0,
    minWidth: 0,
    // Cursor reserves a 44px follow-up header band while the compact control itself stays 28px.
    // The control floats half a gutter (4px) above the input: the composer stack's full-gutter gap
    // is pulled back to half, and the band shrinks by the same amount so band + gap still totals
    // 44px and the measured composer obstruction stays truthful.
    minHeight: `calc(${composerVars["--honk-composer-state-band-height"]} - ${spaceVars["--honk-space-gutter"]} / 2)`,
    maxWidth: "100%",
    marginBlockEnd: `calc(${spaceVars["--honk-space-gutter"]} / -2)`,
  },
  hostExpanded: {
    alignSelf: "stretch",
    width: "100%",
    marginBlockEnd: 0,
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: spaceVars["--honk-space-gutter"],
    minWidth: 0,
    width: "100%",
  },
  headerSpacer: { flexGrow: 1 },
  list: {
    width: "100%",
    maxWidth: "100%",
    display: "flex",
    flexDirection: "column",
    // oxlint-disable-next-line honk/design-no-raw-values -- 1px keeps adjacent rows' hover backgrounds from fusing, Cursor's fixed queue-list gap; no gap token owns a hairline
    gap: "1px",
    margin: 0,
    padding: 0,
    listStyle: "none",
    outline: "none",
  },
  row: {
    position: "relative",
    boxSizing: "border-box",
    minWidth: 0,
    display: "flex",
    alignItems: "center",
    gap: spaceVars["--honk-space-gutter"],
    // Cursor bleeds the state surface halfway into the tray's 12px content inset while
    // restoring that 6px on the row itself, so text stays aligned without a full-width slab.
    marginInline: `calc(0px - ${controlVars["--honk-control-gap"]})`,
    paddingInline: controlVars["--honk-control-gap"],
    width: `calc(100% + ${controlVars["--honk-control-gap"]} + ${controlVars["--honk-control-gap"]})`,
    minHeight: controlVars["--honk-control-h-md"],
    paddingBlock: controlVars["--honk-control-menu-pad"],
    borderRadius: radiusVars["--honk-radius-control"],
    backgroundColor: {
      default: "transparent",
      ":hover": {
        "@media (hover: hover)": composerVars["--honk-composer-queue-row-hover"],
      },
    },
    transitionProperty: "background-color",
    transitionDuration: motionVars["--honk-motion-duration-hover"],
    transitionTimingFunction: motionVars["--honk-motion-ease-out"],
    // Cursor holds row actions back until the row is hovered or takes focus, so the resting
    // list reads as mission text rather than a strip of stop buttons. StyleX 0.19 has no
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
  rowActive: {
    backgroundColor: composerVars["--honk-composer-queue-row-active"],
    "--_actions-opacity": "1",
    "--_actions-pointer-events": "auto",
  },
  rowContent: {
    flexGrow: 1,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: `calc(${controlVars["--honk-control-menu-pad"]} / 2)`,
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
});

export function ActiveSubagents({
  links,
  parts,
  onSelect,
  suppressCompact = false,
}: {
  readonly links: readonly TaskChildLink[];
  readonly parts: readonly ThreadPart[];
  readonly onSelect: (partID: string) => void;
  readonly suppressCompact?: boolean;
}): React.ReactElement | null {
  const active = links
    .flatMap((link) => {
      if (!link.ownsLiveState || link.state !== "running") return [];
      const part = parts.find(
        (candidate): candidate is ToolPart =>
          candidate.id === link.partID && candidate.type === "tool" && candidate.tool === "task",
      );
      return [
        {
          childID: link.child.id,
          server: link.child.server,
          partID: link.partID,
          mission: part === undefined ? link.child.title : taskMission(part, link.child),
          model: part === undefined ? null : taskModelLabel(part, link.child),
          needsYou: link.child.needsAttention,
        },
      ];
    })
    // A blocked subagent waits forever for an answer, so it leads the list.
    .sort((left, right) => Number(right.needsYou) - Number(left.needsYou));

  if (active.length === 0) return null;

  return (
    <ActiveSubagentsControl active={active} onSelect={onSelect} suppressCompact={suppressCompact} />
  );
}

function ActiveSubagentsControl({
  active,
  onSelect,
  suppressCompact,
}: {
  readonly active: readonly {
    readonly childID: string;
    readonly server: OpenCodeServerKey;
    readonly partID: string;
    readonly mission: string;
    readonly model: string | null;
    readonly needsYou: boolean;
  }[];
  readonly onSelect: (partID: string) => void;
  readonly suppressCompact: boolean;
}): React.ReactElement | null {
  const runtime = useThreadRuntime();
  const [isOpen, setOpen] = React.useState(false);
  const [stoppingIDs, setStoppingIDs] = React.useState<ReadonlySet<string>>(() => new Set());
  const [keyboardFocused, setKeyboardFocused] = React.useState(false);
  const [keyboardActiveID, setKeyboardActiveID] = React.useState<string | null>(null);
  const listID = React.useId();
  const triggerID = `${listID}-trigger`;

  const blockedCount = active.filter((item) => item.needsYou).length;
  const label = activeSubagentsSummaryLabel(active.length, blockedCount);
  const expandedLabel = activeSubagentsSummaryLabel(active.length, blockedCount, true);
  const accessibleLabel = accessibleSummaryLabel(active.length, blockedCount);
  const activeID = active.some((item) => item.partID === keyboardActiveID)
    ? keyboardActiveID
    : (active[0]?.partID ?? null);
  const activeIndex = active.findIndex((item) => item.partID === activeID);

  const openItem = (partID: string): void => {
    setOpen(false);
    onSelect(partID);
  };

  const collapse = (): void => {
    setOpen(false);
    window.requestAnimationFrame(() => {
      document.getElementById(triggerID)?.focus();
    });
  };

  const handleListKeyDown = (event: React.KeyboardEvent<HTMLUListElement>): void => {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Escape") {
      event.preventDefault();
      collapse();
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setKeyboardActiveID(active[Math.max(0, activeIndex - 1)]?.partID ?? null);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setKeyboardActiveID(active[Math.min(active.length - 1, activeIndex + 1)]?.partID ?? null);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const item = active[activeIndex];
      if (item !== undefined) openItem(item.partID);
    }
  };

  const stopChild = (childID: string): void => {
    const client = runtime.client;
    if (client === null || stoppingIDs.has(childID)) return;
    setStoppingIDs((current) => new Set([...current, childID]));
    void interruptSession(client, childID)
      .catch((error: unknown) => {
        reportStopError(error, runtime.tabKey);
      })
      .finally(() => {
        setStoppingIDs((current) => {
          const next = new Set(current);
          next.delete(childID);
          return next;
        });
      });
  };

  const stopAll = (): void => {
    const client = runtime.client;
    if (client === null || stoppingIDs.size > 0) return;
    setStoppingIDs(new Set(active.map((item) => item.childID)));
    void Promise.allSettled(active.map((item) => interruptSession(client, item.childID)))
      .then((results) => {
        const failure = results.find((result) => result.status === "rejected");
        if (failure?.status === "rejected") reportStopError(failure.reason, runtime.tabKey);
      })
      .finally(() => {
        setStoppingIDs(new Set());
      });
  };

  if (suppressCompact && !isOpen) return null;

  return (
    <div {...stylex.props(styles.host, isOpen && styles.hostExpanded)}>
      {isOpen ? (
        <Tray id={listID} aria-label={accessibleLabel} maxHeight={280}>
          <Tray.Header rowsExpanded>
            <div {...stylex.props(styles.header)}>
              <Text size="base" tone="muted" tabularNums>
                {expandedLabel}
              </Text>
              <span {...stylex.props(styles.headerSpacer)} />
              <Button
                size="sm"
                variant="quiet"
                aria-label={`Stop ${String(active.length)} running ${active.length === 1 ? "agent" : "agents"}`}
                disabled={runtime.client === null || stoppingIDs.size > 0}
                onClick={stopAll}
              >
                Stop All
              </Button>
              <IconButton
                size="sm"
                variant="quiet"
                aria-label="Collapse active subagents"
                onClick={collapse}
              >
                <Icon icon={IconChevronDownMedium} size="sm" />
              </IconButton>
            </div>
          </Tray.Header>
          <Tray.ScrollArea aria-label="Active subagents">
            <ul
              role="listbox"
              aria-label="Active subagents"
              aria-activedescendant={
                !keyboardFocused || activeID === null ? undefined : `${listID}-option-${activeID}`
              }
              tabIndex={0}
              {...stylex.props(styles.list)}
              onKeyDown={handleListKeyDown}
              onFocus={(event) => {
                if (event.target === event.currentTarget) setKeyboardFocused(true);
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
              {active.map((item) => {
                const isActive = keyboardFocused && item.partID === activeID;
                return (
                  <li
                    key={item.partID}
                    id={`${listID}-option-${item.partID}`}
                    role="option"
                    aria-selected={isActive}
                    aria-label={`${item.mission}${item.model === null ? "" : `, ${item.model}`}. ${item.needsYou ? "Needs you" : "Working"}. Open work details`}
                    tabIndex={-1}
                    data-cursor-pointer-control=""
                    {...stylex.props(styles.row, isActive && styles.rowActive)}
                    onClick={(event) => {
                      if (
                        event.target instanceof Element &&
                        event.target.closest("button") !== null
                      ) {
                        return;
                      }
                      openItem(item.partID);
                    }}
                  >
                    <Matrix grid={3} variant={item.needsYou ? "attention" : "working"} isActive />
                    <span {...stylex.props(styles.rowContent)}>
                      <Text size="base" truncate title={item.mission}>
                        {item.mission}
                      </Text>
                      {item.needsYou ? (
                        <ActiveSubagentRequestDetail server={item.server} childID={item.childID} />
                      ) : item.model === null ? null : (
                        <Text size="sm" tone="muted" truncate>
                          {item.model}
                        </Text>
                      )}
                    </span>
                    <span {...stylex.props(styles.rowActions)}>
                      <IconButton
                        size="sm"
                        variant="quiet"
                        aria-label={`Stop ${item.mission}`}
                        title={`Stop ${item.mission}`}
                        disabled={runtime.client === null || stoppingIDs.has(item.childID)}
                        onClick={() => {
                          stopChild(item.childID);
                        }}
                      >
                        <Icon icon={IconStop} size="sm" />
                      </IconButton>
                    </span>
                  </li>
                );
              })}
            </ul>
          </Tray.ScrollArea>
        </Tray>
      ) : (
        <PillButton
          id={triggerID}
          aria-expanded={false}
          aria-controls={listID}
          aria-label={`${accessibleLabel}. Show active ${active.length === 1 ? "subagent" : "subagents"}`}
          iconStart={
            <Matrix grid={3} variant={blockedCount > 0 ? "attention" : "working"} isActive />
          }
          onClick={() => {
            setOpen(true);
          }}
        >
          {label}
        </PillButton>
      )}
    </div>
  );
}

// Needs-you outranks working, matching the thread tab's status glyph: a subagent blocked on a
// permission or question waits forever for an answer, so the summary must not read as busy work
// the user can leave alone.
export function activeSubagentsSummaryLabel(
  total: number,
  blocked: number,
  isExpanded = false,
): string {
  if (blocked === 0) return `${String(total)} working`;
  const blockedLabel = `${String(blocked)} ${blocked === 1 ? "needs" : "need"} you`;
  if (!isExpanded || blocked === total) return blockedLabel;
  return `${blockedLabel}, ${String(total - blocked)} working`;
}

export function ActiveSubagentRequestDetail({
  server,
  childID,
}: {
  readonly server: OpenCodeServerKey;
  readonly childID: string;
}): React.ReactElement {
  const watch = useSessionWatch(openCodeSessionRef(server, childID));
  return (
    <Text size="sm" tone="muted" truncate>
      {needsYouActivity(threadViewState(watch.state))}
    </Text>
  );
}

function accessibleSummaryLabel(total: number, blocked: number): string {
  const subagents = (count: number): string => (count === 1 ? "subagent" : "subagents");
  if (blocked === 0) return `${String(total)} ${subagents(total)} working`;
  const blockedLabel = `${String(blocked)} ${subagents(blocked)} ${blocked === 1 ? "needs" : "need"} you`;
  return blocked === total ? blockedLabel : `${blockedLabel}, ${String(total - blocked)} working`;
}

function reportStopError(error: unknown, threadKey: string): void {
  const message = errorMessage(error);
  toastActions.add({
    type: "error",
    title: "Stop failed",
    description: message,
    copyableError: message,
    threadKey,
  });
}
