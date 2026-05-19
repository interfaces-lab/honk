"use client";

import type { ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";

const workbenchChromeRowVariants = cva("flex shrink-0 select-none flex-nowrap", {
  variants: {
    variant: {
      tool: "drag-region ui-tab-system multi-workbench-tool-island relative z-20 box-border h-(--multi-workbench-chrome-row-height) min-h-(--multi-workbench-chrome-row-height) max-h-(--multi-workbench-chrome-row-height) flex-none select-none items-start gap-(--multi-workbench-chrome-action-gap) overflow-hidden border-b px-(--multi-workbench-chrome-padding-inline) pt-(--multi-titlebar-control-row-top) [--tab-system-bar-background:transparent] editor-panel-tab-root editor-panel-tab-root--simple-tabs",
      panel:
        "no-drag multi-workbench-panel-title-row w-full min-w-0 flex-row items-center gap-(--multi-workbench-chrome-action-gap)",
    },
  },
});

const workbenchChromeRowContentVariants = cva(
  "no-scrollbar flex min-h-0 min-w-0 flex-1 items-center overflow-hidden",
  {
    variants: {
      gap: {
        action: "gap-(--multi-workbench-chrome-action-gap)",
        loose: "gap-1",
        relaxed: "gap-2",
      },
      variant: {
        tool: "editor-panel-tab-bar-tab-cluster",
        panel: "",
      },
    },
  },
);

type WorkbenchChromeRowVariant = NonNullable<
  VariantProps<typeof workbenchChromeRowVariants>["variant"]
>;
type WorkbenchChromeRowGap = NonNullable<
  VariantProps<typeof workbenchChromeRowContentVariants>["gap"]
>;

export function WorkbenchChromeRow(props: {
  variant: WorkbenchChromeRowVariant;
  children: ReactNode;
  gap?: WorkbenchChromeRowGap;
  trailing?: ReactNode;
  end?: ReactNode;
}) {
  const gap = props.gap ?? "action";

  return (
    <div
      className={workbenchChromeRowVariants({ variant: props.variant })}
      data-variant={props.variant === "tool" ? "simple-tabs" : undefined}
    >
      <div className={workbenchChromeRowContentVariants({ gap, variant: props.variant })}>
        {props.children}
      </div>

      {props.trailing}

      {props.end}
    </div>
  );
}
