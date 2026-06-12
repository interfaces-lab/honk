"use client";

import { IconBarsThree } from "central-icons";

import { WorkbenchIconButton } from "@honk/multikit/workbench-button";

/**
 * Full-width row under the workbench tab strip.
 */
export function TerminalWorkbenchSubChrome(props: {
  railOpen: boolean;
  onToggleRail: () => void;
  shellCaption: string;
}) {
  return (
    <div className="no-drag honk-workbench-panel-title-row flex w-full shrink-0 flex-row flex-nowrap items-center gap-1.5">
      <WorkbenchIconButton
        aria-label={props.railOpen ? "Hide terminal sessions" : "Show terminal sessions"}
        aria-pressed={props.railOpen}
        active={props.railOpen}
        chrome="panel"
        title={props.railOpen ? "Hide sessions list" : "Show sessions list"}
        onClick={props.onToggleRail}
      >
        <IconBarsThree className="size-[15px]" aria-hidden />
      </WorkbenchIconButton>
      <span className="min-w-0 truncate text-body font-medium text-honk-fg-primary">
        {props.shellCaption}
      </span>
    </div>
  );
}
