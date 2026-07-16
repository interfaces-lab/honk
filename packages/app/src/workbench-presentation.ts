import type { AppChildSessionSummary } from "./open-code-view";
import { IconWindowSquare } from "@honk/ui/icons";

import type { ToolTodo } from "./tool-part-projection";
import type {
  WorkbenchSideChatTab,
  WorkbenchTab as ManagedWorkbenchTab,
} from "./workbench-tab-store";
import type {
  WorkbenchToolHeaderMenuItem,
  WorkbenchToolHeaderTab,
} from "./workbench-tool-header";
import {
  visibleWorkbenchToolTabs,
  workbenchToolTabs,
  type WorkbenchToolTabEntry,
} from "./workbench-tool-tabs";

type OpenWorkbenchToolTab = {
  readonly tab: Exclude<ManagedWorkbenchTab, { readonly kind: "side-chat" | "changes" }>;
  readonly entry: WorkbenchToolTabEntry;
};

type WorkbenchPresentation = {
  readonly activeTab: ManagedWorkbenchTab | null;
  readonly headerMenuItems: readonly WorkbenchToolHeaderMenuItem[];
  readonly headerTabs: readonly WorkbenchToolHeaderTab[];
  readonly isOpen: boolean;
  readonly openTabs: readonly OpenWorkbenchToolTab[];
  readonly sideChatLabels: ReadonlyMap<string, string>;
  readonly tabLabels: ReadonlyMap<string, string>;
  readonly taskProgress: string;
  readonly terminalCount: number;
  readonly toolTabs: readonly WorkbenchToolTabEntry[];
  readonly visibleTabs: readonly WorkbenchToolTabEntry[];
};

function workbenchPresentation(input: {
  readonly activeTabID: string | null;
  readonly childSessions: readonly AppChildSessionSummary[];
  readonly expanded: boolean;
  readonly isCreatingSideChat: boolean;
  readonly managedTabs: readonly ManagedWorkbenchTab[];
  readonly planPresent: boolean;
  readonly sideChatTabs: readonly WorkbenchSideChatTab[];
  readonly tasks: readonly ToolTodo[];
}): WorkbenchPresentation {
  const toolTabs = workbenchToolTabs(input.planPresent);
  const mountedToolKinds = new Set(
    input.managedTabs.flatMap((tab) => (tab.kind === "side-chat" ? [] : [tab.kind])),
  );
  const visibleTabs = visibleWorkbenchToolTabs({
    hasPlan: input.planPresent,
    hasTasks: input.tasks.length > 0,
    hasTasksPanel: mountedToolKinds.has("tasks"),
  });
  const sideChatLabels = new Map(
    input.sideChatTabs.map((tab) => [tab.id, sideChatTitle(tab, input.childSessions)] as const),
  );
  const tabLabels = new Map(
    input.managedTabs.map((tab) => [
      tab.id,
      tabLabel(tab, input.managedTabs, toolTabs, sideChatLabels.get(tab.id)),
    ] as const),
  );
  const openTabs = input.managedTabs.flatMap<OpenWorkbenchToolTab>((tab) => {
    if (tab.kind === "side-chat" || tab.kind === "changes") return [];
    const entry = visibleTabs.find((candidate) => candidate.id === tab.kind);
    return entry === undefined ? [] : [{ tab, entry }];
  });
  const terminalCount = input.managedTabs.filter((tab) => tab.kind === "terminal").length;
  const completedTasks = input.tasks.filter((task) => task.status === "completed").length;
  const taskProgress = `${String(completedTasks)}/${String(input.tasks.length)}`;
  const activeTab =
    input.managedTabs.find((tab) => tab.id === input.activeTabID) ?? null;
  const headerTabs = input.managedTabs.flatMap<WorkbenchToolHeaderTab>((tab) => {
    if (tab.kind === "side-chat") {
      return [
        {
          id: tab.id,
          label: tabLabels.get(tab.id) ?? tab.label,
          icon: IconWindowSquare,
          closable: true,
          showLabel: true,
        },
      ];
    }
    const entry = toolTabs.find((candidate) => candidate.id === tab.kind);
    return entry === undefined
      ? []
      : [
          {
            id: tab.id,
            label: tabLabels.get(tab.id) ?? tab.kind,
            icon: entry.icon,
            closable: tab.kind !== "tasks" || !input.planPresent,
            showLabel:
              tab.kind === "terminal" ||
              tab.kind === "browser" ||
              (tab.kind === "tasks" && input.planPresent),
          },
        ];
  });
  const headerMenuItems: readonly WorkbenchToolHeaderMenuItem[] = [
    ...visibleTabs.map((entry) => ({
      id: `tool:${entry.id}`,
      label: entry.label,
      icon: entry.icon,
      disabled: entry.id !== "terminal" && entry.id !== "browser" && mountedToolKinds.has(entry.id),
    })),
    {
      id: "side-chat:new",
      label: "Side Chat",
      icon: IconWindowSquare,
      disabled: input.isCreatingSideChat,
    },
  ];

  return {
    activeTab,
    headerMenuItems,
    headerTabs,
    isOpen: input.expanded && activeTab !== null,
    openTabs,
    sideChatLabels,
    tabLabels,
    taskProgress,
    terminalCount,
    toolTabs,
    visibleTabs,
  };
}

function sideChatTitle(
  tab: WorkbenchSideChatTab,
  children: readonly AppChildSessionSummary[],
): string {
  return (
    children.find(
      (child) =>
        child.server === tab.child.server &&
        child.id === tab.child.sessionID &&
        child.parentSessionId === tab.parent.sessionID,
    )?.title ?? tab.label
  );
}

function tabLabel(
  tab: ManagedWorkbenchTab,
  tabs: readonly ManagedWorkbenchTab[],
  toolTabs: readonly WorkbenchToolTabEntry[],
  sideChatLabel: string | undefined,
): string {
  if (tab.kind === "side-chat") return sideChatLabel ?? tab.label;
  const entry = toolTabs.find((candidate) => candidate.id === tab.kind);
  if (entry === undefined) return tab.kind;
  if (tab.kind !== "terminal" && tab.kind !== "browser") return entry.label;
  const siblings = tabs.filter((candidate) => candidate.kind === tab.kind);
  const ordinal = siblings.findIndex((candidate) => candidate.id === tab.id) + 1;
  return ordinal <= 1 ? entry.label : `${entry.label} ${String(ordinal)}`;
}

export { workbenchPresentation };
export type { OpenWorkbenchToolTab, WorkbenchPresentation };
