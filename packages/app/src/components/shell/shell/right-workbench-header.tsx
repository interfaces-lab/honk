"use client";

import { TabsList, TabsTab } from "@multi/multikit/tabs";
import { Button } from "@multi/multikit/button";
import { IconConsole, IconCrossMediumDefault, IconPlusLarge } from "central-icons";
import type { ComponentType, ReactNode } from "react";

import type { TerminalSessionEntry } from "~/stores/shell-panels-store";
import type { WorkbenchTab } from "~/lib/workbench-tabs";
import { cn } from "~/lib/utils";

import {
  WorkbenchIconButton,
  WorkbenchTabIconContent,
  workbenchIconButtonVariants,
} from "@multi/multikit/workbench-button";
import {
  WorkbenchChromeActionGroup,
  WorkbenchChromeDivider,
  WorkbenchChromeSpacer,
  workbenchChromeActionGroupVariants,
  workbenchChromeTextControlVariants,
} from "@multi/multikit/workbench-chrome-row";
import { RightWorkbenchToolIsland } from "./right-workbench-tool-island";

export interface WorkbenchTabMeta {
  id: WorkbenchTab;
  label: string;
  icon: ComponentType<{ className?: string }>;
  badge?: string | null;
}

function ToolIconButton(props: { tab: WorkbenchTabMeta }) {
  const Icon = props.tab.icon;
  const badge = props.tab.badge && props.tab.badge !== "0" ? props.tab.badge : null;
  const badgeText = badge ? `, ${badge}` : "";
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
      <WorkbenchTabIconContent badge={badge}>
        <Icon aria-hidden />
      </WorkbenchTabIconContent>
    </TabsTab>
  );
}

function WorkbenchTabList(props: { activeTab: WorkbenchTab; tabs: readonly WorkbenchTabMeta[] }) {
  const activeMeta = props.tabs.find((tab) => tab.id === props.activeTab) ?? props.tabs[0] ?? null;
  return (
    <TabsList className={workbenchChromeActionGroupVariants()}>
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
        workbenchChromeTextControlVariants({ tone: props.active ? "primary" : "default" }),
        "group relative max-w-(--multi-workbench-tab-label-max-width) px-0",
        props.active ? "bg-multi-bg-tertiary text-multi-fg-primary" : "",
      )}
    >
      <Button
        type="button"
        variant="ghost"
        role="tab"
        aria-selected={props.active}
        onClick={props.onActivate}
        className="h-full min-w-0 flex-1 justify-start gap-(--multi-workbench-text-control-gap) rounded-none border-0 bg-transparent px-(--multi-workbench-text-control-padding-inline) text-left text-inherit shadow-none before:hidden hover:bg-transparent data-pressed:bg-transparent"
        aria-current={props.active ? "page" : undefined}
      >
        <IconConsole className="size-3 shrink-0 opacity-60" aria-hidden />
        <span className="min-w-0 truncate">{props.session.label}</span>
      </Button>
      {props.closable ? (
        <Button
          type="button"
          variant="ghost"
          aria-label={`Close ${props.session.label}`}
          onClick={(e) => {
            e.stopPropagation();
            props.onClose();
          }}
          className="no-drag mr-0.5 size-4 shrink-0 rounded-sm border-0 bg-transparent p-0 text-multi-fg-tertiary opacity-0 shadow-none before:hidden transition-opacity hover:bg-transparent hover:text-multi-fg-primary group-hover:opacity-100 data-pressed:bg-transparent focus-visible:opacity-100"
        >
          <IconCrossMediumDefault className="size-3" />
        </Button>
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
            <WorkbenchChromeDivider />
            <WorkbenchChromeActionGroup role="tablist" aria-label="Terminal sessions" overflow>
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
            </WorkbenchChromeActionGroup>
          </>
        ) : null}
        {isTerminal && props.onNewTerminal ? (
          <>
            {!showTerminalSessionTabs ? <WorkbenchChromeDivider /> : null}
            <WorkbenchChromeButton label="New terminal" onClick={props.onNewTerminal}>
              <IconPlusLarge className="size-4 shrink-0" aria-hidden />
            </WorkbenchChromeButton>
          </>
        ) : null}

        <WorkbenchChromeSpacer />
      </>
    </RightWorkbenchToolIsland>
  );
}
