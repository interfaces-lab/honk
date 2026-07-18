// Latest TodoWrite payload as a workbench checklist. Durable todo state stays out of the transcript.

import { Checkbox, StatusDot, Text } from "@honk/ui";
import { colorVars, motionVars } from "@honk/ui/tokens.stylex";
import * as stylex from "@stylexjs/stylex";
import * as React from "react";

import type { ToolTodo, ToolTodoStatus } from "./tool-part-projection";

// One-shot horizontal shake when a task flips to cancelled. Small travel so it reads as a
// "nope" nudge, not a jitter. Shake anatomy, not shared tokens.
const WIGGLE_TRAVEL = "2px";
const WIGGLE_SETTLE = "1px";
const wiggleKeyframes = stylex.keyframes({
  "0%, 100%": { transform: "translateX(0)" },
  "20%": { transform: `translateX(-${WIGGLE_TRAVEL})` },
  "40%": { transform: `translateX(${WIGGLE_TRAVEL})` },
  "60%": { transform: `translateX(-${WIGGLE_SETTLE})` },
  "80%": { transform: `translateX(${WIGGLE_SETTLE})` },
});

const sx = stylex.create({
  wiggle: {
    animationName: wiggleKeyframes,
    // oxlint-disable-next-line honk/design-no-raw-values -- 360ms is the bespoke five-beat shake length; no motion duration token owns it
    animationDuration: "360ms",
    animationTimingFunction: motionVars["--honk-motion-ease-out"],
    "@media (prefers-reduced-motion: reduce)": { animationName: "none" },
  },
  // Base + settled carry the color and the strike line; the line-through color animates from
  // transparent so the strike draws in rather than snapping on. text-decoration-color is
  // animatable, so this is a real transition without a bespoke clip-path primitive.
  label: {
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
});

const statusLabel: Record<ToolTodoStatus, string> = {
  pending: "Pending",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

function TaskStatus({ status }: { readonly status: ToolTodoStatus }): React.ReactElement {
  if (status === "in_progress") {
    return <StatusDot tone="accent" pulse label={statusLabel.in_progress} />;
  }
  return (
    <Checkbox
      size="sm"
      readOnly
      checked={status === "completed"}
      tabIndex={-1}
      aria-label={statusLabel[status]}
      // readOnly keeps full opacity (unlike disabled); this is a status display, not an input.
      style={{ cursor: "default" }}
    />
  );
}

function taskKey(task: ToolTodo, index: number): string {
  return task.id ?? `${String(index)}:${task.content}`;
}

function WorkbenchTasks({ tasks }: { readonly tasks: readonly ToolTodo[] }): React.ReactElement {
  const completed = tasks.filter((task) => task.status === "completed").length;
  const active = tasks.filter((task) => task.status === "in_progress").length;

  // Fire the wiggle on the transition into cancelled, not on mount. Track the last-seen status
  // per key; a key is added to `wiggling` only when it moves pending/in_progress/completed →
  // cancelled, and removed once its animation ends.
  const prevStatus = React.useRef<Map<string, ToolTodoStatus>>(new Map());
  const [wiggling, setWiggling] = React.useState<ReadonlySet<string>>(() => new Set());

  React.useEffect(() => {
    const prev = prevStatus.current;
    const seen = new Set<string>();
    const started: string[] = [];
    tasks.forEach((task, index) => {
      const key = taskKey(task, index);
      seen.add(key);
      const before = prev.get(key);
      if (before !== undefined && before !== "cancelled" && task.status === "cancelled") {
        started.push(key);
      }
      prev.set(key, task.status);
    });
    for (const key of [...prev.keys()]) {
      if (!seen.has(key)) prev.delete(key);
    }
    if (started.length > 0) {
      setWiggling((current) => {
        const next = new Set(current);
        for (const key of started) next.add(key);
        return next;
      });
    }
  }, [tasks]);

  const clearWiggle = (key: string): void => {
    setWiggling((current) => {
      if (!current.has(key)) return current;
      const next = new Set(current);
      next.delete(key);
      return next;
    });
  };

  return (
    <section
      aria-label="Tasks"
      data-honk-scrollport=""
      className="flex min-h-0 grow flex-col gap-panel-pad overflow-y-auto p-panel-pad"
    >
      <div className="flex items-center justify-between gap-control-gap">
        <Text as="p" size="sm" tone="muted" tabularNums>
          {completed} of {tasks.length} complete
        </Text>
        {active > 0 ? (
          <Text size="xs" tone="accent" tabularNums>
            {active} active
          </Text>
        ) : null}
      </div>
      <ol className="m-0 flex list-none flex-col gap-gutter p-0">
        {tasks.map((task, index) => {
          const key = taskKey(task, index);
          const isSettled = task.status === "completed" || task.status === "cancelled";
          const wiggle = stylex.props(wiggling.has(key) && sx.wiggle);
          const label = stylex.props(sx.label, isSettled && sx.labelSettled);
          return (
            <li
              key={key}
              className={`grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-gutter ${wiggle.className ?? ""}`}
              style={wiggle.style}
              onAnimationEnd={() => {
                clearWiggle(key);
              }}
            >
              <span className="inline-flex items-center justify-center">
                <TaskStatus status={task.status} />
              </span>
              <span
                className={`min-w-0 [overflow-wrap:anywhere] ${label.className ?? ""}`}
                style={label.style}
              >
                <Text as="span" size="base" tone="inherit">
                  {task.content}
                </Text>
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

export { WorkbenchTasks };
