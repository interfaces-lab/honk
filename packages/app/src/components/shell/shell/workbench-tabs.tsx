"use client";

import {
  IconBranch,
  IconConsole,
  IconFileText,
  IconPlusLarge,
  IconSidebarHiddenRightWide,
} from "central-icons";
import { useState, type ComponentType } from "react";

import type { WorkbenchTab } from "~/lib/workbench-tabs";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuTrigger,
  WorkbenchMenuIconSlot,
  WorkbenchMenuPrimaryText,
} from "@honk/honkkit/menu";
import { WorkbenchIconButton, workbenchIconButtonVariants } from "@honk/honkkit/workbench-button";
import { WorkbenchChromeRow } from "@honk/honkkit/workbench-chrome-row";

interface Tab {
  id: WorkbenchTab;
  label: string;
  menuLabel: string;
  icon: ComponentType<{ className?: string }>;
}

const tabs: Tab[] = [
  { id: "git", label: "Changes", menuLabel: "Changes", icon: IconBranch },
  { id: "terminal", label: "Terminal", menuLabel: "Terminal", icon: IconConsole },
  { id: "files", label: "Files", menuLabel: "Files", icon: IconFileText },
];

export function WorkbenchTabBar(props: {
  active: WorkbenchTab;
  onTab: (tab: WorkbenchTab) => void;
  count: number;
  onToggle: () => void;
}) {
  const [open, setOpen] = useState(false);
  const active = tabs.find((tab) => tab.id === props.active) ?? tabs[0]!;

  return (
    <WorkbenchChromeRow
      variant="tool"
      trailing={
        <Menu open={open} onOpenChange={setOpen}>
          <MenuTrigger
            aria-expanded={open}
            aria-label="Open new tab menu"
            className={workbenchIconButtonVariants({ active: open, chrome: "tool" })}
            title="Open new tab menu"
          >
            <IconPlusLarge className="size-4 shrink-0" aria-hidden />
          </MenuTrigger>
          <MenuPopup
            align="end"
            className="w-max min-w-32 max-w-[calc(100vw-16px)] max-h-[min(720px,var(--available-height))]"
            side="bottom"
            sideOffset={4}
            variant="workbench"
          >
            <div className="flex flex-col gap-px">
              {tabs.map((item) => {
                const Icon = item.icon;
                return (
                  <MenuItem
                    className="min-h-7 gap-2 px-2 py-1"
                    key={item.id}
                    onClick={() => {
                      props.onTab(item.id);
                      setOpen(false);
                    }}
                    variant="workbench"
                  >
                    <WorkbenchMenuIconSlot className="[&>svg]:size-4">
                      <Icon className="size-4 shrink-0" aria-hidden />
                    </WorkbenchMenuIconSlot>
                    <WorkbenchMenuPrimaryText className="flex-none whitespace-nowrap">
                      {item.menuLabel}
                    </WorkbenchMenuPrimaryText>
                  </MenuItem>
                );
              })}
            </div>
          </MenuPopup>
        </Menu>
      }
      end={
        <div className="editor-panel-overflow-action pointer-events-auto flex shrink-0 items-center">
          <WorkbenchIconButton
            aria-label="Hide Panel"
            chrome="tool"
            onClick={props.onToggle}
            title="Hide Panel"
          >
            <IconSidebarHiddenRightWide className="size-4 shrink-0" />
          </WorkbenchIconButton>
        </div>
      }
    >
      {tabs.map((tab) => {
        const selected = tab.id === props.active;
        const Icon = tab.icon;
        return (
          <WorkbenchIconButton
            active={selected}
            aria-current={selected ? "page" : undefined}
            aria-label={tab.label}
            chrome="tool"
            key={tab.id}
            onClick={() => props.onTab(tab.id)}
            tabSystem
            title={tab.label}
          >
            <Icon className="size-4 shrink-0" aria-hidden />
          </WorkbenchIconButton>
        );
      })}
      <div className="editor-panel-tab-bar-spacer min-w-0 flex-1" />
      <div className="sr-only" aria-live="polite">
        {active.label}
      </div>
    </WorkbenchChromeRow>
  );
}
