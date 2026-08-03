import { create, props } from "@stylexjs/stylex";
import { Icon, ListRow, Tray } from "@honk/ui";
import { IconChevronRightMedium, IconCircleCheck } from "@honk/ui/icons";
import { motionVars, spaceVars } from "@honk/ui/tokens.stylex";
import { useEffect, useId, useRef, useState, type ReactElement } from "react";

import { TaskList } from "../task-list";
import type { ToolTodo } from "../tool-part-projection";
import { todoSummaryLabel } from "./todo-summary-model";

const TODO_MAX_ROWS = 9;
const TODO_PROGRESS_RADIUS = 5.5;
const TODO_PROGRESS_CENTER = 6;
const TODO_PROGRESS_ANIMATION_MS = 250;
const TODO_DISCLOSURE_MAX_HEIGHT = "500px";

const styles = create({
  topSpacer: {
    flexShrink: 0,
  },
  disclosure: {
    display: "inline-flex",
    transitionProperty: "transform",
    transitionDuration: motionVars["--honk-motion-duration-collapsible"],
    transitionTimingFunction: motionVars["--honk-motion-ease-out"],
  },
  disclosureExpanded: {
    transform: "rotate(90deg)",
  },
  progressRing: {
    display: "block",
    flexShrink: 0,
  },
  expanded: {
    minWidth: 0,
    maxHeight: TODO_DISCLOSURE_MAX_HEIGHT,
    overflow: "hidden",
    opacity: 1,
    transitionProperty: "max-height, opacity",
    // oxlint-disable-next-line honk/design-no-raw-values -- Cursor's todo-summary disclosure transition is exactly 250ms
    transitionDuration: "250ms",
    transitionTimingFunction: "ease-in-out",
  },
  expandedHidden: {
    maxHeight: 0,
    opacity: 0,
    paddingBlockEnd: 0,
    overflow: "hidden",
  },
  expandedContent: {
    paddingInline: spaceVars["--honk-space-panel-pad"],
    paddingBlockEnd: spaceVars["--honk-space-gutter"],
  },
});

const dynamicStyles = create({
  topSpacerHeight: (height: number) => ({
    height: `${String(height)}px`,
  }),
});

function TodoSummary({
  kind,
  tasks,
  topSpacerHeight,
}: {
  readonly kind: "plan" | "todo";
  readonly tasks: readonly ToolTodo[];
  readonly topSpacerHeight: number;
}): ReactElement | null {
  const [isExpanded, setExpanded] = useState(false);
  const [isHovered, setHovered] = useState(false);
  const listID = useId();
  const visibleTasks = tasks.filter((task) => task.status !== "cancelled");
  if (visibleTasks.length === 0) return null;

  const summary = todoSummaryLabel(visibleTasks);
  const completed = visibleTasks.filter((task) => task.status === "completed").length;

  return (
    <Tray
      aria-label={kind === "plan" ? "Plan tasks" : "To-dos"}
      maxHeight={500}
      surface="conversation"
      onMouseEnter={() => {
        setHovered(true);
      }}
      onMouseLeave={() => {
        setHovered(false);
      }}
    >
      <div
        aria-hidden
        data-slot="todo-summary-top-spacer"
        {...props(styles.topSpacer, dynamicStyles.topSpacerHeight(topSpacerHeight))}
      />
      <Tray.Header density="summary">
        <ListRow
          size={kind === "plan" ? "planSummary" : "todoSummary"}
          aria-controls={listID}
          aria-expanded={isExpanded}
          aria-label={`${isExpanded ? "Collapse" : "Expand"} ${kind === "plan" ? "plan " : ""}tasks`}
          onClick={() => {
            setExpanded((current) => !current);
          }}
        >
          <ListRow.Slot>
            {isHovered || isExpanded ? (
              <span {...props(styles.disclosure, isExpanded && styles.disclosureExpanded)}>
                <Icon icon={IconChevronRightMedium} size="sm" tone="faint" />
              </span>
            ) : (
              <TodoProgressIndicator completed={completed} total={visibleTasks.length} />
            )}
          </ListRow.Slot>
          <ListRow.Content>
            <ListRow.Title>
              <span aria-live="polite">{summary.label}</span>
            </ListRow.Title>
          </ListRow.Content>
          {summary.position === undefined ? null : <ListRow.Meta>{summary.position}</ListRow.Meta>}
        </ListRow>
      </Tray.Header>
      <div
        id={listID}
        aria-hidden={!isExpanded}
        {...props(styles.expanded, !isExpanded && styles.expandedHidden)}
      >
        <Tray.ScrollArea aria-label={kind === "plan" ? "Plan tasks" : "To-dos"} inset="block">
          <div {...props(styles.expandedContent)}>
            <TaskList tasks={visibleTasks} maxRows={TODO_MAX_ROWS} appearance="transcript" />
          </div>
        </Tray.ScrollArea>
      </div>
    </Tray>
  );
}

function TodoProgressIndicator({
  completed,
  total,
}: {
  readonly completed: number;
  readonly total: number;
}): ReactElement {
  const targetRatio = total === 0 ? 0 : Math.min(1, Math.max(0, completed / total));
  const displayedRatio = useRef(targetRatio);
  const [ratio, setRatio] = useState(targetRatio);

  // Cursor eases the filled progress sector between TodoWrite updates. This effect synchronizes
  // with the browser animation clock; the rendered ratio cannot be derived statically mid-frame.
  useEffect(() => {
    const startRatio = displayedRatio.current;
    if (
      startRatio === targetRatio ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      displayedRatio.current = targetRatio;
      setRatio(targetRatio);
      return;
    }

    const startedAt = performance.now();
    let frameID = 0;
    const animate = (now: number): void => {
      const progress = Math.min(1, (now - startedAt) / TODO_PROGRESS_ANIMATION_MS);
      const eased = (1 - Math.cos(Math.PI * progress)) / 2;
      const next = startRatio + (targetRatio - startRatio) * eased;
      displayedRatio.current = next;
      setRatio(next);
      if (progress < 1) frameID = requestAnimationFrame(animate);
    };
    frameID = requestAnimationFrame(animate);
    return () => {
      cancelAnimationFrame(frameID);
    };
  }, [targetRatio]);

  if (completed === total) {
    return <Icon icon={IconCircleCheck} size="sm" tone="faint" />;
  }

  const angle = ratio * Math.PI * 2 - Math.PI / 2;
  const x = TODO_PROGRESS_CENTER + TODO_PROGRESS_RADIUS * Math.cos(angle);
  const y = TODO_PROGRESS_CENTER + TODO_PROGRESS_RADIUS * Math.sin(angle);
  const path =
    ratio === 0
      ? ""
      : `M ${String(TODO_PROGRESS_CENTER)} ${String(TODO_PROGRESS_CENTER)} L ${String(
          TODO_PROGRESS_CENTER,
        )} ${String(TODO_PROGRESS_CENTER - TODO_PROGRESS_RADIUS)} A ${String(
          TODO_PROGRESS_RADIUS,
        )} ${String(TODO_PROGRESS_RADIUS)} 0 ${ratio > 0.5 ? "1" : "0"} 1 ${String(x)} ${String(
          y,
        )} Z`;

  return (
    <svg
      aria-hidden
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      {...props(styles.progressRing)}
    >
      <circle
        cx={TODO_PROGRESS_CENTER}
        cy={TODO_PROGRESS_CENTER}
        r={TODO_PROGRESS_RADIUS}
        fill="transparent"
        stroke="currentColor"
        strokeWidth="1"
      />
      {path.length === 0 ? null : <path d={path} fill="currentColor" />}
    </svg>
  );
}

export { TodoSummary };
