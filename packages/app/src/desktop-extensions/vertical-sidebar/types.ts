import type { HonkDesktopCell, HonkDesktopTabs } from "../sdk";
import type { StatusFilter } from "./model";

type VerticalSidebarInput = {
  readonly tabs: HonkDesktopTabs;
  readonly collapsedGroups: HonkDesktopCell<readonly string[]>;
  readonly workspaceOrder: HonkDesktopCell<readonly string[]>;
  readonly workspacesOpen: HonkDesktopCell<boolean>;
  readonly threadFilters: HonkDesktopCell<readonly StatusFilter[]>;
};

export type { VerticalSidebarInput };
