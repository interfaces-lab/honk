import { create, props } from "@stylexjs/stylex";
import { Icon, Text, type Glyph, type IconTone } from "@honk/ui";
import { IconCircleBanSign, IconCircleCheck, IconCircleDashed, IconOngoing } from "@honk/ui/icons";
import {
  colorVars,
  controlVars,
  fontVars,
  iconVars,
  motionVars,
  spaceVars,
} from "@honk/ui/tokens.stylex";
import type { ReactElement } from "react";

import { taskListWindow } from "./task-list-window";
import type { ToolTodo, ToolTodoStatus } from "./tool-part-projection";

const styles = create({
  list: {
    display: "flex",
    flexDirection: "column",
    gap: spaceVars["--honk-space-gutter"],
    minWidth: 0,
    margin: 0,
    padding: 0,
    listStyle: "none",
  },
  listTranscript: {
    gap: spaceVars["--honk-space-control-pad-x"],
  },
  row: {
    display: "grid",
    gridTemplateColumns: "auto minmax(0, 1fr)",
    alignItems: "start",
    gap: spaceVars["--honk-space-gutter"],
    minWidth: 0,
  },
  rowTranscript: {
    gap: controlVars["--honk-control-gap"],
  },
  status: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: fontVars["--honk-leading-body"],
  },
  statusTranscript: {
    width: iconVars["--honk-icon-size-md"],
    color: colorVars["--honk-color-text-primary"],
  },
  statusTranscriptSettled: {
    opacity: 0.4,
  },
  // The transparent strike color lets cancellation draw the line instead of snapping it on.
  label: {
    minWidth: 0,
    overflowWrap: "anywhere",
    color: colorVars["--honk-color-text-primary"],
    textDecorationLine: "line-through",
    textDecorationColor: "transparent",
    transitionProperty: "color, text-decoration-color",
    transitionDuration: {
      default: motionVars["--honk-motion-duration-expand"],
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: motionVars["--honk-motion-ease-out"],
  },
  labelSettled: {
    color: colorVars["--honk-color-text-faint"],
    textDecorationColor: colorVars["--honk-color-text-faint"],
  },
  labelTranscriptSettled: {
    color: colorVars["--honk-color-text-primary"],
    opacity: 0.5,
    textDecorationColor: "currentColor",
  },
  more: {
    display: "grid",
    gridTemplateColumns: `${iconVars["--honk-icon-size-xs"]} minmax(0, 1fr)`,
    alignItems: "center",
    gap: spaceVars["--honk-space-gutter"],
    minWidth: 0,
  },
  moreTranscript: {
    gridTemplateColumns: `${iconVars["--honk-icon-size-md"]} minmax(0, 1fr)`,
    gap: controlVars["--honk-control-gap"],
  },
});

const statusPresentation: Record<
  ToolTodoStatus,
  { readonly icon: Glyph; readonly label: string; readonly tone: IconTone }
> = {
  pending: { icon: IconCircleDashed, label: "Pending", tone: "faint" },
  in_progress: { icon: IconOngoing, label: "Working", tone: "accent" },
  completed: { icon: IconCircleCheck, label: "Done", tone: "ok" },
  cancelled: { icon: IconCircleBanSign, label: "Cancelled", tone: "faint" },
};

function TaskStatus({ status }: { readonly status: ToolTodoStatus }): ReactElement {
  const presentation = statusPresentation[status];
  return (
    <Icon icon={presentation.icon} size="xs" tone={presentation.tone} label={presentation.label} />
  );
}

function TranscriptTaskStatus({
  status,
}: {
  readonly status: Exclude<ToolTodoStatus, "cancelled">;
}): ReactElement {
  const settled = status !== "in_progress";
  return (
    <span
      {...props(styles.status, styles.statusTranscript, settled && styles.statusTranscriptSettled)}
    >
      <Icon
        icon={statusPresentation[status].icon}
        size="sm"
        tone="current"
        label={statusPresentation[status].label}
      />
    </span>
  );
}

function taskKey(task: ToolTodo, index: number): string {
  return task.id ?? `${String(index)}:${task.content}`;
}

function TaskList({
  tasks,
  maxRows,
  appearance = "default",
}: {
  readonly tasks: readonly ToolTodo[];
  readonly maxRows?: number;
  readonly appearance?: "default" | "transcript";
}): ReactElement {
  const window = taskListWindow(tasks, maxRows);
  const isTranscript = appearance === "transcript";

  return (
    <ol aria-label="Tasks" {...props(styles.list, isTranscript && styles.listTranscript)}>
      {window.tasks.map((task, index) => {
        const key = taskKey(task, index);
        const isSettled = task.status === "completed" || task.status === "cancelled";
        return (
          <li key={key} {...props(styles.row, isTranscript && styles.rowTranscript)}>
            {isTranscript && task.status !== "cancelled" ? (
              <TranscriptTaskStatus status={task.status} />
            ) : (
              <span {...props(styles.status)}>
                <TaskStatus status={task.status} />
              </span>
            )}
            <span
              {...props(
                styles.label,
                isSettled && styles.labelSettled,
                isTranscript && isSettled && styles.labelTranscriptSettled,
              )}
            >
              <Text as="span" size="base" tone="inherit">
                {task.content}
              </Text>
            </span>
          </li>
        );
      })}
      {window.hiddenCount > 0 ? (
        <li {...props(styles.more, isTranscript && styles.moreTranscript)}>
          <Text as="span" size="sm" tone="faint">
            +
          </Text>
          <Text as="span" size="sm" tone="faint" tabularNums>
            {window.hiddenCount} more
          </Text>
        </li>
      ) : null}
    </ol>
  );
}

export { TaskList };
