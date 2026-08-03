import * as stylex from "@stylexjs/stylex";
import { Button, Icon } from "@honk/ui";
import { IconConsoleSimple, IconFileBend, IconGlobe } from "@honk/ui/icons";
import { colorVars, spaceVars } from "@honk/ui/tokens.stylex";
import * as React from "react";

import type { SubmittedPlanRecord } from "./thread/follow-up";
import type { PlanExecutionProjection } from "./thread/plan-execution";
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
  // Replaces the stored width rather than clamping it. The stored width is never rewritten while
  // maximized, which is what makes restoring return the exact prior column.
  panelMaximized: { width: "100%", flexGrow: 1, minWidth: 0 },
  sashActive: { backgroundColor: colorVars["--honk-color-accent"], opacity: 0.4 },
  body: { flexGrow: 1, minHeight: 0, display: "flex", flexDirection: "column" },
  // Keep visited panels mounted so terminals and browser surfaces survive tab switches.
  panelHost: { flexGrow: 1, minHeight: 0, display: "flex", flexDirection: "column" },
  emptyState: {
    flexGrow: 1,
    minHeight: 0,
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "center",
    gap: spaceVars["--honk-space-gutter"],
    padding: spaceVars["--honk-space-panel-pad"],
  },
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
  readonly isMaximized: boolean;
  readonly isOpen: boolean;
  readonly isResizing: boolean;
  readonly isThreadRunning: boolean;
  readonly buildAgent: string;
  readonly managedTabs: readonly ManagedWorkbenchTab[];
  readonly panelWidth: number;
  readonly plan: SubmittedPlanRecord | null;
  readonly planExecution: PlanExecutionProjection | null;
  readonly tasks: readonly ToolTodo[];
  readonly onActivateTab: (id: string) => void;
  readonly onCloseTab: (id: string) => void;
  readonly onCreateItem: (id: string) => void;
  readonly onOpenFile: (path: string) => void;
  readonly onSearchFiles: (query: string) => Promise<readonly string[]>;
  readonly onOpenChanges: () => void;
  readonly onOpenTasks: () => void;
  readonly onToggleMaximized: () => void;
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
  isMaximized,
  isOpen,
  isResizing,
  isThreadRunning,
  buildAgent,
  managedTabs,
  panelWidth,
  plan,
  planExecution,
  tasks,
  onActivateTab,
  onCloseTab,
  onCreateItem,
  onOpenFile,
  onSearchFiles,
  onOpenChanges,
  onOpenTasks,
  onToggleMaximized,
  onSashKeyDown,
  onSashPointerDown,
  onSashPointerEnd,
  onSashPointerMove,
}: WorkbenchPanelColumnProps): React.ReactElement {
  return (
    <div
      {...stylex.props(
        styles.panel,
        isMaximized ? styles.panelMaximized : dynamic.width(panelWidth),
        !isOpen && styles.hidden,
      )}
    >
      {/* A maximized panel owns the whole frame, so there is no boundary left to drag and no
          meaningful `aria-valuenow` to report. */}
      {isMaximized ? null : (
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
      )}
      <WorkbenchToolHeader
        tabs={headerTabs}
        activeTabID={activeTabID ?? ""}
        isMaximized={isMaximized}
        menuItems={headerMenuItems}
        onActivate={onActivateTab}
        onClose={onCloseTab}
        onCreate={onCreateItem}
        onToggleMaximized={onToggleMaximized}
        onSearchFiles={onSearchFiles}
        onOpenFile={onOpenFile}
      />
      <div {...stylex.props(styles.body)}>
        {activeTabID === null ? (
          <div role="group" aria-label="Open a workbench tool" {...stylex.props(styles.emptyState)}>
            <Button size="lg" onClick={() => onCreateItem("tool:browser")}>
              <Icon icon={IconGlobe} size="sm" />
              Browser
            </Button>
            <Button size="lg" onClick={() => onCreateItem("tool:terminal")}>
              <Icon icon={IconConsoleSimple} size="sm" />
              Terminal
            </Button>
            <Button size="lg" onClick={() => onCreateItem("tool:files")}>
              <Icon icon={IconFileBend} size="sm" />
              File
            </Button>
          </div>
        ) : null}
        {managedTabs.map((tab) => {
          const visible = isOpen && activeTabID === tab.id;
          return (
            <div key={tab.id} {...stylex.props(styles.panelHost, !visible && styles.hidden)}>
              <WorkbenchPanelSurface
                tab={tab}
                directory={directory}
                isThreadRunning={isThreadRunning}
                buildAgent={buildAgent}
                isVisible={visible}
                plan={plan}
                planExecution={planExecution}
                tasks={tasks}
                onOpenFile={onOpenFile}
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
