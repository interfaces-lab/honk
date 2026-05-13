"use client";

import { type CSSProperties, type ReactNode, useRef } from "react";

import {
  type WorkbenchTab,
  SECONDARY_RAIL_LIMITS,
  shellPanelsActions,
  useSecondaryRail,
} from "~/stores/shell-panels-store";
import { cn } from "~/lib/utils";

import { useColumnResize } from "./use-column-resize";

type SecondaryRailStyle = CSSProperties & Record<`--${string}`, string>;

export function RightWorkbenchLayout(props: {
  cwd: string | null;
  tab: WorkbenchTab;
  rail?: ReactNode;
  railOpen?: boolean;
  railHostClassName?: string;
  children: ReactNode;
}) {
  const { open: persistedRailOpen, width: railWidth } = useSecondaryRail(props.cwd, props.tab);
  const railOpen = props.railOpen ?? persistedRailOpen;
  const showRail = props.rail != null && railOpen;

  const railRef = useRef<HTMLDivElement | null>(null);
  const resize = useColumnResize({
    width: railWidth,
    limits: SECONDARY_RAIL_LIMITS,
    elementRef: railRef,
    direction: "right",
    onCommit: (nextWidth) =>
      shellPanelsActions.setSecondaryRailWidth(props.cwd, props.tab, nextWidth),
  });
  const railStyle: SecondaryRailStyle = {
    "--multi-shell-secondary-rail-width": `${railWidth}px`,
    "--multi-shell-secondary-rail-collapsed-width": "0px",
    "--multi-shell-secondary-rail-min-width": `${SECONDARY_RAIL_LIMITS.min}px`,
    "--multi-shell-secondary-rail-max-width": `${SECONDARY_RAIL_LIMITS.max}px`,
  };

  return (
    <div
      className="multi-shell-workbench-columns flex min-h-0 min-w-0 flex-1 flex-row overflow-hidden"
      data-shell-panel="secondary"
      data-state={showRail ? "expanded" : "collapsed"}
      style={railStyle}
    >
      {showRail ? (
        <div
          className={cn(
            "multi-shell-secondary-rail relative flex min-h-0 shrink-0 overflow-hidden bg-[color-mix(in_srgb,var(--multi-bg-secondary)_82%,transparent)]",
            props.railHostClassName,
          )}
          data-shell-panel="secondary"
          data-side="left"
          data-state="expanded"
          data-resizing={resize.dragging ? "true" : "false"}
          ref={railRef}
        >
          <div
            className={cn(
              "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden",
              resize.dragging
                ? "transition-none"
                : "transition-[width] duration-100 ease-out motion-reduce:transition-none",
            )}
          >
            {props.rail}
          </div>
          <div
            aria-label="Resize secondary pane width"
            aria-orientation="vertical"
            className="pointer-events-auto absolute inset-y-0 right-0 z-30 w-3 cursor-col-resize touch-none select-none outline-hidden [-webkit-app-region:no-drag] after:absolute after:inset-y-0 after:right-0 after:w-(--multi-shell-sash-stripe-width) after:rounded-px after:bg-transparent after:transition-[background-color,box-shadow] after:duration-100 after:ease-out hover:after:bg-(--multi-shell-sash-hover-shade) focus-visible:after:bg-(--multi-shell-sash-hover-shade) data-[active=true]:after:bg-(--multi-shell-sash-hover-shade) motion-reduce:after:transition-none"
            data-active={resize.dragging ? "true" : undefined}
            {...resize.sashProps}
            role="separator"
          />
        </div>
      ) : null}
      <div className="multi-shell-workbench-preview flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {props.children}
      </div>
    </div>
  );
}
