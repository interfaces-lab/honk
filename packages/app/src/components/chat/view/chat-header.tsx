import {
  IconBranch,
  IconCodeAssistant,
  IconComputerUse,
  IconFolder1,
  IconLoadingCircle,
  IconSidebar,
} from "central-icons";
import { Button } from "@honk/honkkit/button";
import { Truncate } from "@pierre/truncate/react";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@honk/honkkit/tooltip";
import {
  WorkbenchChromeDivider,
  workbenchChromeTextControlVariants,
} from "@honk/honkkit/workbench-chrome-row";
import { shellPanelsActions } from "~/stores/shell-panels-store";
import { cn } from "~/lib/utils";
import type { ReactNode } from "react";

export interface ChatHeaderTooltipDetails {
  readonly branchName?: string | null | undefined;
  readonly contextLabel?: string | null | undefined;
  readonly modelLabel?: string | null | undefined;
  readonly projectLabel?: string | null | undefined;
  readonly surfaceLabel?: string | null | undefined;
  readonly workspacePath?: string | null | undefined;
}

interface ChatHeaderProps {
  activeThreadTitle: string;
  actions?: ReactNode | undefined;
  tooltipDetails?: ChatHeaderTooltipDetails | undefined;
}

function trimOptional(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

function ChatTitleTooltipRow(props: {
  readonly icon: ReactNode;
  readonly primary: string;
  readonly secondary?: string | null | undefined;
}) {
  const secondary = trimOptional(props.secondary);

  return (
    <div className="grid min-w-0 grid-cols-[16px_minmax(0,1fr)] gap-2 text-body">
      <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center text-honk-icon-tertiary [&_svg]:size-4 [&_svg]:shrink-0">
        {props.icon}
      </span>
      <span className="min-w-0">
        <span className="block min-w-0 truncate text-honk-fg-primary">{props.primary}</span>
        {secondary ? (
          <span className="block min-w-0 truncate text-honk-fg-tertiary">{secondary}</span>
        ) : null}
      </span>
    </div>
  );
}

function ChatTitleTooltipContent(props: {
  readonly details?: ChatHeaderTooltipDetails | undefined;
  readonly title: string;
}) {
  const projectLabel = trimOptional(props.details?.projectLabel);
  const branchName = trimOptional(props.details?.branchName);
  const workspacePath = trimOptional(props.details?.workspacePath);
  const surfaceLabel = trimOptional(props.details?.surfaceLabel);
  const modelLabel = trimOptional(props.details?.modelLabel);
  const contextLabel = trimOptional(props.details?.contextLabel);
  const hasRows = Boolean(
    projectLabel || branchName || workspacePath || surfaceLabel || modelLabel || contextLabel,
  );

  if (!hasRows) {
    return (
      <div className="max-w-80 truncate px-1 py-0.5 text-body text-honk-fg-primary">
        {props.title}
      </div>
    );
  }

  return (
    <div className="flex w-72 max-w-[calc(100vw-16px)] flex-col gap-2 px-1 py-0.5">
      {projectLabel || branchName ? (
        <ChatTitleTooltipRow
          icon={<IconBranch aria-hidden />}
          primary={projectLabel ?? "Repository"}
          secondary={branchName}
        />
      ) : null}
      {workspacePath ? (
        <ChatTitleTooltipRow icon={<IconFolder1 aria-hidden />} primary={workspacePath} />
      ) : null}
      {surfaceLabel ? (
        <ChatTitleTooltipRow icon={<IconComputerUse aria-hidden />} primary={surfaceLabel} />
      ) : null}
      {modelLabel ? (
        <ChatTitleTooltipRow icon={<IconCodeAssistant aria-hidden />} primary={modelLabel} />
      ) : null}
      {contextLabel ? (
        <ChatTitleTooltipRow icon={<IconLoadingCircle aria-hidden />} primary={contextLabel} />
      ) : null}
    </div>
  );
}

function ChatTitleTooltip(props: {
  readonly details?: ChatHeaderTooltipDetails | undefined;
  readonly title: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={`Chat title details. ${props.title}`}
            className={cn(
              workbenchChromeTextControlVariants({ tone: "primary" }),
              "w-full min-w-0 max-w-full shrink justify-start rounded-sm py-0 text-left shadow-none before:hidden hover:bg-honk-bg-quaternary data-pressed:bg-honk-bg-quaternary",
            )}
            data-no-drag=""
            data-shell-no-drag=""
          >
            <Truncate className="min-w-0 flex-1 [--truncate-marker-background-color:var(--honk-chat-surface-background)]">
              {props.title}
            </Truncate>
            <IconComputerUse className="size-3.5 shrink-0 text-honk-icon-tertiary" aria-hidden />
          </Button>
        }
      />
      <TooltipPopup align="start" side="bottom" sideOffset={6} variant="workbench">
        <ChatTitleTooltipContent title={props.title} details={props.details} />
      </TooltipPopup>
    </Tooltip>
  );
}

export function ChatHeader({ activeThreadTitle, actions, tooltipDetails }: ChatHeaderProps) {
  const title = activeThreadTitle.trim();
  const hasActions = actions !== undefined && actions !== null;

  return (
    <div className="@container/header-actions content-pane-top-bar__scroll-area flex min-w-0 flex-1 select-none items-center text-body">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className="no-drag mr-1 hidden size-(--honk-titlebar-control-height) min-w-(--honk-titlebar-control-height) shrink-0 rounded-honk-control p-0 shadow-none before:hidden in-data-[shell-left-mode=overlay]:flex"
        data-no-drag=""
        data-shell-no-drag=""
        aria-label="Toggle sidebar"
        onClick={() => shellPanelsActions.toggleLeft()}
      >
        <IconSidebar className="size-4 shrink-0" />
      </Button>
      {title ? (
        <div
          className="no-drag flex w-fit min-w-0 max-w-[min(22rem,42vw)] shrink items-center overflow-hidden"
          data-no-drag=""
          data-shell-no-drag=""
        >
          <ChatTitleTooltip title={title} details={tooltipDetails} />
        </div>
      ) : null}
      <div className="min-w-2 flex-1 self-stretch" data-shell-drag-region="" aria-hidden />
      <div
        className={cn(
          "content-pane-top-bar__trailing-wrap no-drag flex shrink-0 items-center overflow-hidden transition-[max-width,opacity] duration-150 ease-out motion-reduce:transition-none",
          hasActions ? "max-w-[520px] opacity-100" : "pointer-events-none max-w-0 opacity-0",
        )}
        data-no-drag=""
        data-shell-no-drag=""
        aria-hidden={hasActions ? undefined : true}
      >
        <div className="flex w-max items-center gap-2 pl-2">
          {title ? <WorkbenchChromeDivider /> : null}
          <div className="content-pane-top-bar__action-group no-drag flex min-w-0 shrink items-center gap-2 overflow-hidden [&>div]:gap-2 [&_[data-slot=workbench-chrome-action-group]]:gap-2">
            {actions}
          </div>
        </div>
      </div>
    </div>
  );
}
