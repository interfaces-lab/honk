"use client";

import type { ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";

const workbenchChromeRowVariants = cva("flex shrink-0 select-none flex-nowrap", {
  variants: {
    variant: {
      tool: "pointer-events-none ui-tab-system multi-workbench-tool-island relative z-20 box-border flex h-(--multi-workbench-chrome-row-height) min-h-(--multi-workbench-chrome-row-height) max-h-(--multi-workbench-chrome-row-height) flex-none flex-row select-none items-center gap-(--multi-workbench-chrome-action-gap) overflow-hidden border-b px-(--multi-workbench-chrome-padding-inline) [--tab-system-bar-background:transparent] editor-panel-tab-root editor-panel-tab-root--simple-tabs",
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
        tool: "editor-panel-tab-bar-tab-cluster pointer-events-auto h-(--multi-workbench-action-size) self-center",
        panel: "",
      },
    },
  },
);

const workbenchChromeRowSlotClassName = "flex shrink-0 items-center self-center";
const workbenchChromeRowEndSlotClassName =
  "pointer-events-none flex shrink-0 items-center self-center";

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

      {props.trailing ? (
        <div
          className={
            props.variant === "tool"
              ? `${workbenchChromeRowSlotClassName} pointer-events-auto`
              : workbenchChromeRowSlotClassName
          }
        >
          {props.trailing}
        </div>
      ) : null}

      {props.end ? (
        <div
          className={
            props.variant === "tool"
              ? workbenchChromeRowEndSlotClassName
              : workbenchChromeRowSlotClassName
          }
        >
          {props.end}
        </div>
      ) : null}
    </div>
  );
}
