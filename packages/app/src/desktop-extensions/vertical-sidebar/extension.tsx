import { defineHonkDesktopExtension } from "../sdk";
import { decodeStatusFilters, decodeStringList, type StatusFilter } from "./model";
import { VerticalSidebar } from "./view";

const SIDEBAR_DEFAULT_SIZE = 232;
const SIDEBAR_MIN_SIZE = 184;
const SIDEBAR_MAX_SIZE = 360;

export const verticalSidebarExtension = defineHonkDesktopExtension({
  id: "honk.vertical-sidebar",
  name: "Honk vertical sidebar",
  version: "1.0.0",
  activate(honk) {
    const enabled = honk.state.boolean("enabled", false);
    const size = honk.state.number("size", SIDEBAR_DEFAULT_SIZE, {
      min: SIDEBAR_MIN_SIZE,
      max: SIDEBAR_MAX_SIZE,
    });
    const collapsedGroups = honk.state.value<readonly string[]>("collapsed-groups", {
      default: Object.freeze([]),
      decode: decodeStringList,
    });
    const workspaceOrder = honk.state.value<readonly string[]>("workspace-order", {
      default: Object.freeze([]),
      decode: decodeStringList,
    });
    const workspacesOpen = honk.state.boolean("workspaces-open", true);
    const threadFilters = honk.state.value<readonly StatusFilter[]>("thread-filters", {
      default: Object.freeze([]),
      decode: decodeStatusFilters,
    });

    honk.desktop.titlebar.tabStrip({ id: "default-tabs", hidden: enabled });
    honk.desktop.panes.add({
      id: "tabs",
      side: "left",
      open: enabled,
      size,
      minSize: SIDEBAR_MIN_SIZE,
      maxSize: SIDEBAR_MAX_SIZE,
      render: () => (
        <VerticalSidebar
          tabs={honk.desktop.tabs}
          collapsedGroups={collapsedGroups}
          workspaceOrder={workspaceOrder}
          workspacesOpen={workspacesOpen}
          threadFilters={threadFilters}
        />
      ),
    });
    honk.desktop.settings.toggle({
      id: "enabled",
      title: "Tab style",
      description: "Choose where open tabs are shown.",
      value: enabled,
      presentation: {
        kind: "tab-style",
        offLabel: "San Francisco",
        onLabel: "New York",
      },
    });
  },
});
