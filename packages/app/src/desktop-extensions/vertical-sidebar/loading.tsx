import * as stylex from "@stylexjs/stylex";
import { Spinner } from "@honk/ui";
import { colorVars, radiusVars, sidebarVars } from "@honk/ui/tokens.stylex";
import type { ReactElement } from "react";

import { verticalSidebarLayout } from "./layout.stylex";

const PLACEHOLDER_ROWS = ["home", "workspaces", "workspace", "thread"] as const;

const styles = stylex.create({
  row: {
    minHeight: sidebarVars["--honk-sidebar-item-height"],
    borderRadius: radiusVars["--honk-radius-control"],
    backgroundColor: colorVars["--honk-color-layer-02"],
  },
  rowNarrow: {
    width: "72%",
  },
  center: {
    position: "absolute",
    inset: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
});

function VerticalSidebarLoading(): ReactElement {
  return (
    <aside aria-label="Open tabs" {...stylex.props(verticalSidebarLayout.root)}>
      <div data-shell-drag-region="" {...stylex.props(verticalSidebarLayout.topBar)} />
      <nav aria-label="Loading open tabs" {...stylex.props(verticalSidebarLayout.navigation)}>
        <div aria-hidden="true" {...stylex.props(verticalSidebarLayout.navigationContent)}>
          {PLACEHOLDER_ROWS.map((row, index) => (
            <div key={row} {...stylex.props(styles.row, index > 1 && styles.rowNarrow)} />
          ))}
        </div>
        <div {...stylex.props(styles.center)}>
          <Spinner label="Loading open tabs" tone="muted" />
        </div>
      </nav>
      <div {...stylex.props(verticalSidebarLayout.footer)}>
        <div aria-hidden="true" {...stylex.props(styles.row)} />
      </div>
    </aside>
  );
}

export { VerticalSidebarLoading };
