"use client";

import type { ReactNode } from "react";

import { WorkbenchChromeRow } from "@multi/multikit/workbench-chrome-row";

/**
 * Fixed-height workbench tool row: leading cluster (tab tools + tab-specific UI),
 * optional trailing slot, and end actions (e.g. hide right panel).
 * Secondary pane visibility is toggled inside each workbench panel.
 */
export function RightWorkbenchToolIsland(props: {
  children: ReactNode;
  trailing?: ReactNode;
  end: ReactNode;
}) {
  return (
    <WorkbenchChromeRow variant="tool" trailing={props.trailing} end={props.end}>
      {props.children}
    </WorkbenchChromeRow>
  );
}
