import * as stylex from "@stylexjs/stylex";
import { colorVars } from "@honk/ui/tokens.stylex";
import * as React from "react";

import type { SubmittedPlan } from "./thread/follow-up";
import type { ToolTodo } from "./tool-part-projection";
import { WORKBENCH_WIDTH_MIN } from "./workbench-controller";
import { WorkbenchPanelSurface } from "./workbench-panel-surface";
import type { WorkbenchTab as ManagedWorkbenchTab } from "./workbench-tab-store";
import {
  WorkbenchToolHeader,
  type WorkbenchToolHeaderMenuItem,
  type WorkbenchToolHeaderTab,
} from "./workbench-tool-header";

const SASH_WIDTH = "5px";
const HAIRLINE_WIDTH = "1px";
const PANEL_SEPARATOR_SHADOW = `inset ${HAIRLINE_WIDTH} 0 0 ${colorVars["--honk-color-border-base"]}`;

const styles = stylex.create({
  panel: {
    position: "relative",
    flexShrink: 0,
    height: "100%",
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    boxSizing: "border-box",
    boxShadow: PANEL_SEPARATOR_SHADOW,
  },
  sash: {
    position: "absolute",
    insetBlock: 0,
    insetInlineStart: `calc(${SASH_WIDTH} / -2)`,
    width: SASH_WIDTH,
    cursor: "col-resize",
    zIndex: 1,
    backgroundColor: "transparent",
    touchAction: "none",
  },
  sashActive: { backgroundColor: colorVars["--honk-color-accent"], opacity: 0.4 },
  body: { flexGrow: 1, minHeight: 0, display: "flex", flexDirection: "column" },
  // Keep visited panels mounted so terminals and browser surfaces survive tab switches.
  panelHost: { flexGrow: 1, minHeight: 0, display: "flex", flexDirection: "column" },
  hidden: { display: "none" },
});

const dynamic = stylex.create({
  width: (px: number) => ({ width: `${px}px` }),
});

type WorkbenchPanelColumnProps = {
  readonly activeTabID: string | null;
  readonly availablePanelWidth: number;
  readonly directory: string;
  readonly headerMenuItems: readonly WorkbenchToolHeaderMenuItem[];
  readonly headerTabs: readonly WorkbenchToolHeaderTab[];
  readonly isOpen: boolean;
  readonly isResizing: boolean;
  readonly isThreadRunning: boolean;
  readonly managedTabs: readonly ManagedWorkbenchTab[];
  readonly panelWidth: number;
  readonly plan: SubmittedPlan | null;
  readonly tasks: readonly ToolTodo[];
  readonly onActivateTab: (id: string) => void;
  readonly onCloseTab: (id: string) => void;
  readonly onCreateItem: (id: string) => void;
  readonly onOpenChanges: () => void;
  readonly onOpenTasks: () => void;
  readonly onSashKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void;
  readonly onSashPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
  readonly onSashPointerEnd: (event: React.PointerEvent<HTMLDivElement>) => void;
  readonly onSashPointerMove: (event: React.PointerEvent<HTMLDivElement>) => void;
};

function WorkbenchPanelColumn({
  activeTabID,
  availablePanelWidth,
  directory,
  headerMenuItems,
  headerTabs,
  isOpen,
  isResizing,
  isThreadRunning,
  managedTabs,
  panelWidth,
  plan,
  tasks,
  onActivateTab,
  onCloseTab,
  onCreateItem,
  onOpenChanges,
  onOpenTasks,
  onSashKeyDown,
  onSashPointerDown,
  onSashPointerEnd,
  onSashPointerMove,
}: WorkbenchPanelColumnProps): React.ReactElement {
  return (
    <div {...stylex.props(styles.panel, dynamic.width(panelWidth), !isOpen && styles.hidden)}>
      <div
        role="separator"
        tabIndex={0}
        aria-orientation="vertical"
        aria-label="Resize workbench"
        aria-valuemin={WORKBENCH_WIDTH_MIN}
        aria-valuemax={availablePanelWidth}
        aria-valuenow={panelWidth}
        {...stylex.props(styles.sash, isResizing && styles.sashActive)}
        onKeyDown={onSashKeyDown}
        onPointerDown={onSashPointerDown}
        onPointerMove={onSashPointerMove}
        onPointerUp={onSashPointerEnd}
        onPointerCancel={onSashPointerEnd}
      />
      <WorkbenchToolHeader
        tabs={headerTabs}
        activeTabID={activeTabID ?? ""}
        menuItems={headerMenuItems}
        onActivate={onActivateTab}
        onClose={onCloseTab}
        onCreate={onCreateItem}
      />
      <div {...stylex.props(styles.body)}>
        {managedTabs.map((tab) => {
          const visible = isOpen && activeTabID === tab.id;
          return (
            <div key={tab.id} {...stylex.props(styles.panelHost, !visible && styles.hidden)}>
              <WorkbenchPanelSurface
                tab={tab}
                directory={directory}
                isThreadRunning={isThreadRunning}
                isVisible={visible}
                plan={plan}
                tasks={tasks}
                onReviewChanges={onOpenChanges}
                onViewPlan={onOpenTasks}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

export { WorkbenchPanelColumn };
export type { WorkbenchPanelColumnProps };
