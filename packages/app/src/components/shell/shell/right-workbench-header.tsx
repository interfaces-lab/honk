"use client";

import { TabsList, TabsTab } from "@multi/ui/tabs";
import { IconConsole, IconCrossMediumDefault, IconPlusLarge } from "central-icons";
import type { ComponentType, ReactNode } from "react";

import type { TerminalSessionEntry, WorkbenchTab } from "~/stores/shell-panels-store";
import { cn } from "~/lib/utils";

import { workbenchIconButtonVariants, WorkbenchIconButton } from "./workbench-icon-button";
import { RightWorkbenchToolIsland } from "./right-workbench-tool-island";

export interface WorkbenchTabMeta {
  id: WorkbenchTab;
  label: string;
  icon: ComponentType<{ className?: string }>;
  badge?: string | null;
}

function ToolIconButton(props: { tab: WorkbenchTabMeta }) {
  const Icon = props.tab.icon;
  const badgeText = props.tab.badge && props.tab.badge !== "0" ? `, ${props.tab.badge}` : "";
  return (
    <TabsTab
      value={props.tab.id}
      data-stable=""
      className={(state) =>
        cn(
          workbenchIconButtonVariants({
            active: state.active,
            chrome: "tool",
            tabSystem: true,
          }),
          "size-(--multi-workbench-action-size) p-0",
        )
      }
      aria-label={`${props.tab.label}${badgeText}`}
      title={`${props.tab.label}${badgeText}`}
    >
      <span className="ui-tab-system-tab__content flex min-w-0 flex-none items-center justify-center">
        <Icon className="ui-tab-system-tab__icon size-3.5" aria-hidden />
      </span>
    </TabsTab>
  );
}

function WorkbenchTabList(props: { activeTab: WorkbenchTab; tabs: readonly WorkbenchTabMeta[] }) {
  const activeMeta = props.tabs.find((tab) => tab.id === props.activeTab) ?? props.tabs[0] ?? null;
  return (
    <TabsList className="no-drag flex shrink-0 select-none items-center gap-(--multi-workbench-chrome-action-gap)">
      {props.tabs.map((tab) => (
        <ToolIconButton key={tab.id} tab={tab} />
      ))}
      {activeMeta ? (
        <div className="sr-only" aria-live="polite">
          {activeMeta.label}
        </div>
      ) : null}
    </TabsList>
  );
}

function WorkbenchChromeButton(props: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <WorkbenchIconButton aria-label={props.label} chrome="tool" onClick={props.onClick}>
      {props.children}
    </WorkbenchIconButton>
  );
}

function TerminalSessionTab(props: {
  session: TerminalSessionEntry;
  active: boolean;
  onActivate: () => void;
  onClose: () => void;
  closable: boolean;
}) {
  return (
    <div
      role="presentation"
      className={cn(
        "no-drag group relative flex h-(--multi-workbench-action-size) max-w-(--multi-workbench-tab-label-max-width) select-none items-center overflow-hidden rounded-multi-control text-body transition-colors",
        props.active
          ? "bg-multi-bg-tertiary text-multi-fg-primary"
          : "text-multi-fg-secondary hover:bg-multi-bg-quaternary hover:text-multi-fg-primary",
      )}
    >
      <button
        type="button"
        role="tab"
        aria-selected={props.active}
        onClick={props.onActivate}
        className="flex min-w-0 flex-1 select-none items-center gap-1 px-1.5 text-left outline-hidden focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-multi-stroke-focused focus-visible:ring-inset"
        aria-current={props.active ? "page" : undefined}
      >
        <IconConsole className="size-3 shrink-0 opacity-60" aria-hidden />
        <span className="min-w-0 truncate">{props.session.label}</span>
      </button>
      {props.closable ? (
        <button
          type="button"
          aria-label={`Close ${props.session.label}`}
          onClick={(e) => {
            e.stopPropagation();
            props.onClose();
          }}
          className="no-drag mr-0.5 flex size-4 shrink-0 items-center justify-center rounded-sm text-multi-fg-tertiary opacity-0 outline-hidden transition-opacity group-hover:opacity-100 hover:text-multi-fg-primary focus-visible:opacity-100 focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-multi-stroke-focused focus-visible:ring-inset"
        >
          <IconCrossMediumDefault className="size-3" />
        </button>
      ) : null}
    </div>
  );
}

interface RightWorkbenchHeaderProps {
  tabs: readonly WorkbenchTabMeta[];
  activeTab: WorkbenchTab;
  terminalSessions?: TerminalSessionEntry[];
  activeTerminalId?: string;
  onTerminalTab?: (id: string) => void;
  onNewTerminal?: () => void;
  onCloseTerminal?: (id: string) => void;
  trailing?: ReactNode;
}

export function RightWorkbenchHeader(props: RightWorkbenchHeaderProps) {
  const isTerminal = props.activeTab === "terminal";
  const sessions = props.terminalSessions ?? [];
  const showTerminalSessionTabs = isTerminal && sessions.length > 0;

  return (
    <RightWorkbenchToolIsland
      trailing={props.trailing}
      end={<div className="multi-workbench-titlebar-end-space shrink-0" aria-hidden />}
    >
      <>
        <WorkbenchTabList activeTab={props.activeTab} tabs={props.tabs} />

        {showTerminalSessionTabs ? (
          <>
            <div
              className="h-(--multi-workbench-action-size) w-px shrink-0 self-center bg-multi-stroke-tertiary"
              aria-hidden
            />
            <div
              className="no-drag flex min-w-0 items-center gap-(--multi-workbench-chrome-action-gap)"
              role="tablist"
              aria-label="Terminal sessions"
            >
              {sessions.map((session) => (
                <TerminalSessionTab
                  key={session.id}
                  session={session}
                  active={session.id === props.activeTerminalId}
                  onActivate={() => props.onTerminalTab?.(session.id)}
                  onClose={() => props.onCloseTerminal?.(session.id)}
                  closable={sessions.length > 1}
                />
              ))}
            </div>
          </>
        ) : null}
        {isTerminal && props.onNewTerminal ? (
          <>
            {!showTerminalSessionTabs ? (
              <div
                className="h-(--multi-workbench-action-size) w-px shrink-0 self-center bg-multi-stroke-tertiary"
                aria-hidden
              />
            ) : null}
            <WorkbenchChromeButton label="New terminal" onClick={props.onNewTerminal}>
              <IconPlusLarge className="size-3.5" aria-hidden />
            </WorkbenchChromeButton>
          </>
        ) : null}

        <div className="editor-panel-tab-bar-spacer min-w-0 flex-1" />
      </>
    </RightWorkbenchToolIsland>
  );
}
