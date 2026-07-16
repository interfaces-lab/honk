import type * as React from "react";

interface WorkbenchRailRowProps {
  readonly children: React.ReactNode;
  readonly disabled?: boolean;
  readonly accessibilityLabel?: string;
  readonly onClick: () => void;
}

interface WorkbenchRailLabelProps {
  readonly children: React.ReactNode;
}

export type { WorkbenchRailLabelProps, WorkbenchRailRowProps };
