"use client";

import {
  IconBranch,
  IconConsole,
  IconFiles,
  IconGlobe,
  IconSidebarHiddenRightWide,
} from "central-icons";
import type { ComponentType } from "react";

import type { WorkbenchTab } from "~/lib/shell-panels-store";
import { cn } from "~/lib/utils";

interface Tab {
  id: WorkbenchTab;
  label: string;
  icon: ComponentType<{ className?: string }>;
}

const tabs: Tab[] = [
  { id: "git", label: "Git", icon: IconBranch },
  { id: "browser", label: "Browser", icon: IconGlobe },
  { id: "terminal", label: "Terminal", icon: IconConsole },
  { id: "files", label: "Files", icon: IconFiles },
];

export function WorkbenchTabBar(props: {
  active: WorkbenchTab;
  onTab: (tab: WorkbenchTab) => void;
  count: number;
  onToggle: () => void;
}) {
  return (
    <div className="no-drag relative h-(--multi-header-height) shrink-0 border-multi-border/30">
      <div className="absolute top-(--multi-titlebar-control-row-top) left-2 flex items-center gap-0.5 rounded-multi-control p-0.5">
        {tabs.map((tab) => {
          const selected = tab.id === props.active;
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => props.onTab(tab.id)}
              className={cn(
                "relative flex h-(--multi-titlebar-control-height) w-(--multi-titlebar-control-height) items-center justify-center rounded-multi-control p-0 leading-none transition-colors [&_svg]:block",
                selected
                  ? "bg-multi-active/60 text-foreground"
                  : "text-muted-foreground/70 hover:bg-multi-hover hover:text-foreground",
              )}
              aria-label={tab.label}
              aria-pressed={selected}
              title={tab.label}
            >
              <Icon className="size-3.5 shrink-0" />
              {tab.id === "git" && props.count > 0 ? (
                <span className="absolute -top-0.5 -right-0.5 min-w-3.5 rounded-full bg-muted-foreground/30 px-0.5 text-[9px]/[12px] font-medium text-inherit tabular-nums">
                  {Math.min(props.count, 9)}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
      <div className="pointer-events-none absolute top-(--multi-titlebar-control-row-top) right-0 flex pr-(--multi-workbench-toggle-right)">
        <button
          type="button"
          onClick={props.onToggle}
          className="pointer-events-auto no-drag flex h-(--multi-titlebar-control-height) w-(--multi-titlebar-control-height) shrink-0 items-center justify-center rounded-multi-control bg-transparent p-0 leading-none text-muted-foreground/70 [&_svg]:block hover:bg-multi-hover hover:text-foreground"
          aria-label="Collapse panel"
        >
          <IconSidebarHiddenRightWide className="size-4 shrink-0 opacity-60" />
        </button>
      </div>
    </div>
  );
}
