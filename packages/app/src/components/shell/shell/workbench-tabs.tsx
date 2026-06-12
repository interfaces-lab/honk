"use client";

import {
  IconBranch,
  IconCheckmark1,
  IconConsole,
  IconFileText,
  IconMagnifyingGlass,
  IconPlusLarge,
  IconSidebarHiddenRightWide,
} from "central-icons";
import { useState, type ComponentType } from "react";

import type { WorkbenchTab } from "~/lib/workbench-tabs";
import { cn } from "~/lib/utils";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuTrigger,
  workbenchMenuIconSlotClassName,
  workbenchMenuItemClassName,
  workbenchMenuMetaTextClassName,
  workbenchMenuPrimaryTextClassName,
} from "@honk/multikit/menu";
import { WorkbenchIconButton, workbenchIconButtonVariants } from "@honk/multikit/workbench-button";
import { WorkbenchChromeRow } from "@honk/multikit/workbench-chrome-row";

const NEW_TAB_MENU_WIDTH = "w-72 max-w-full min-w-0";
const NEW_TAB_MENU_MAX_HEIGHT = "max-h-[min(720px,var(--available-height))]";

interface Tab {
  id: WorkbenchTab;
  label: string;
  menuLabel: string;
  icon: ComponentType<{ className?: string }>;
  disabled?: boolean;
}

const tabs: Tab[] = [
  { id: "git", label: "Changes", menuLabel: "Changes", icon: IconBranch },
  { id: "terminal", label: "Terminal", menuLabel: "Terminal", icon: IconConsole },
  { id: "files", label: "Files", menuLabel: "File", icon: IconFileText },
];

const openMenuItems: Array<
  | Tab
  | {
      id: "canvas";
      label: string;
      menuLabel: string;
      disabled: true;
      icon: ComponentType<{ className?: string }>;
    }
> = [
  ...tabs,
  { id: "canvas", label: "Canvas", menuLabel: "Canvas", icon: IconFileText, disabled: true },
];

function stopMenuSearchBubbling(event: React.KeyboardEvent) {
  event.stopPropagation();
}

export function WorkbenchTabBar(props: {
  active: WorkbenchTab;
  onTab: (tab: WorkbenchTab) => void;
  count: number;
  onToggle: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const active = tabs.find((tab) => tab.id === props.active) ?? tabs[0]!;
  const needle = query.trim().toLowerCase();
  const filteredOpenItems = !needle
    ? openMenuItems
    : openMenuItems.filter((item) =>
        `${item.menuLabel} ${item.label}`.toLowerCase().includes(needle),
      );

  return (
    <WorkbenchChromeRow
      variant="tool"
      trailing={
        <Menu
          open={open}
          onOpenChange={(next) => {
            setOpen(next);
            if (!next) setQuery("");
          }}
        >
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
            className={cn(NEW_TAB_MENU_WIDTH, NEW_TAB_MENU_MAX_HEIGHT)}
            side="bottom"
            sideOffset={4}
            variant="workbench"
          >
            <div className="flex items-center gap-1 border-b border-honk-stroke-tertiary px-1.5 py-1.5">
              <IconMagnifyingGlass className="size-4 shrink-0 text-honk-fg-tertiary" aria-hidden />
              <input
                aria-label="Search new tab menu"
                className="h-6 min-w-0 flex-1 bg-transparent text-body text-honk-fg-primary outline-none placeholder:text-honk-fg-quaternary"
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={stopMenuSearchBubbling}
                placeholder="Open any file, URL, ..."
                value={query}
              />
            </div>
            <div className="flex flex-col gap-px p-1">
              {filteredOpenItems.map((item) => {
                const Icon = item.icon;
                const isActive = item.id === props.active;
                return (
                  <MenuItem
                    className={cn(workbenchMenuItemClassName, "gap-2")}
                    disabled={item.disabled}
                    key={item.id}
                    onClick={() => {
                      if (item.disabled) return;
                      props.onTab(item.id);
                      setOpen(false);
                    }}
                  >
                    <span className={workbenchMenuIconSlotClassName}>
                      <Icon className="size-4 shrink-0" aria-hidden />
                    </span>
                    <span className={cn(workbenchMenuPrimaryTextClassName, "flex-1")}>
                      {item.menuLabel}
                    </span>
                    {item.disabled ? (
                      <span className={workbenchMenuMetaTextClassName}>Soon</span>
                    ) : null}
                    {isActive ? (
                      <IconCheckmark1 className="size-4 shrink-0 text-honk-fg-tertiary" />
                    ) : null}
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
