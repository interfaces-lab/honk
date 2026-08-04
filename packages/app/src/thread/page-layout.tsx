import * as stylex from "@stylexjs/stylex";
import { Spinner } from "@honk/ui";
import { spaceVars } from "@honk/ui/tokens.stylex";
import * as React from "react";

const styles = stylex.create({
  page: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: "0%",
    minHeight: 0,
    width: "100%",
    display: "flex",
    flexDirection: "row",
  },
  center: {
    flexGrow: 1,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: spaceVars["--honk-space-gutter"],
    padding: spaceVars["--honk-space-panel-pad"],
  },
});

export function ThreadPageFrame({
  children,
  panel = false,
}: {
  readonly children: React.ReactNode;
  readonly panel?: boolean;
}): React.ReactElement {
  return (
    <div {...(panel ? { "data-thread-panel": "" } : {})} {...stylex.props(styles.page)}>
      {children}
    </div>
  );
}

export function ThreadPageCenter({
  children,
}: {
  readonly children: React.ReactNode;
}): React.ReactElement {
  return <div {...stylex.props(styles.center)}>{children}</div>;
}

export function ThreadPageLoading(): React.ReactElement {
  return (
    <ThreadPageFrame>
      <ThreadPageCenter>
        <Spinner label="Connecting to thread" tone="muted" />
      </ThreadPageCenter>
    </ThreadPageFrame>
  );
}
