import {
  IconChanges,
  IconConsoleSimple,
  IconFileBend,
  IconGlobe,
  IconPlanning,
  IconProgress25,
  IconProgress50,
  IconProgress75,
  IconProgress100,
  IconTasks,
} from "@honk/ui/icons";

import type { ToolTodo } from "./tool-part-projection";

const WORKBENCH_TOOL_TABS = [
  { id: "changes", label: "Changes", icon: IconChanges },
  { id: "tasks", label: "Tasks", icon: IconTasks },
  { id: "browser", label: "Browser", icon: IconGlobe },
  { id: "terminal", label: "Terminal", icon: IconConsoleSimple },
  { id: "files", label: "Files", icon: IconFileBend },
] as const;

function workbenchToolTabs(hasPlan: boolean, tasks: readonly ToolTodo[] = []) {
  return WORKBENCH_TOOL_TABS.map((entry) => {
    if (entry.id !== "tasks") return entry;
    if (hasPlan) return { ...entry, label: "Plan", icon: IconPlanning };
    return { ...entry, icon: taskProgressIcon(tasks) };
  });
}

function visibleWorkbenchToolTabs({
  hasPlan,
  hasTasksPanel,
  tasks,
}: {
  readonly hasPlan: boolean;
  readonly hasTasksPanel: boolean;
  readonly tasks: readonly ToolTodo[];
}) {
  const tabs = workbenchToolTabs(hasPlan, tasks);
  return hasPlan || tasks.length > 0 || hasTasksPanel
    ? tabs
    : tabs.filter((entry) => entry.id !== "tasks");
}

function taskProgressIcon(tasks: readonly ToolTodo[]) {
  const completed = tasks.filter((task) => task.status === "completed").length;
  if (completed === 0 || tasks.length === 0) return IconTasks;
  const progress = completed / tasks.length;
  if (progress <= 0.25) return IconProgress25;
  if (progress <= 0.5) return IconProgress50;
  if (progress <= 0.75) return IconProgress75;
  return IconProgress100;
}

type WorkbenchToolTabEntry = ReturnType<typeof workbenchToolTabs>[number];

export { WORKBENCH_TOOL_TABS, visibleWorkbenchToolTabs, workbenchToolTabs };
export type { WorkbenchToolTabEntry };
