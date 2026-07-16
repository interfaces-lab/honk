import {
  IconChanges,
  IconConsoleSimple,
  IconFileBend,
  IconGlobe,
  IconSummary,
} from "@honk/ui/icons";

const WORKBENCH_TOOL_TABS = [
  { id: "changes", label: "Changes", icon: IconChanges },
  { id: "tasks", label: "Tasks", icon: IconSummary },
  { id: "browser", label: "Browser", icon: IconGlobe },
  { id: "terminal", label: "Terminal", icon: IconConsoleSimple },
  { id: "files", label: "Files", icon: IconFileBend },
] as const;

function workbenchToolTabs(hasPlan: boolean) {
  return hasPlan
    ? WORKBENCH_TOOL_TABS.map((entry) =>
        entry.id === "tasks" ? { ...entry, label: "Plan" } : entry,
      )
    : WORKBENCH_TOOL_TABS;
}

function visibleWorkbenchToolTabs({
  hasPlan,
  hasTasks,
  hasTasksPanel,
}: {
  readonly hasPlan: boolean;
  readonly hasTasks: boolean;
  readonly hasTasksPanel: boolean;
}) {
  const tabs = workbenchToolTabs(hasPlan);
  return hasPlan || hasTasks || hasTasksPanel ? tabs : tabs.filter((entry) => entry.id !== "tasks");
}

type WorkbenchToolTabEntry = ReturnType<typeof workbenchToolTabs>[number];

export { WORKBENCH_TOOL_TABS, visibleWorkbenchToolTabs, workbenchToolTabs };
export type { WorkbenchToolTabEntry };
