"use client";

import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps, ReactNode } from "react";

import { cn } from "./utils";

const workbenchChromeRowVariants = cva(
  "font-multi flex shrink-0 flex-nowrap select-none text-body font-medium text-multi-fg-secondary",
  {
    variants: {
      variant: {
        panel:
          "no-drag multi-workbench-panel-title-row w-full min-w-0 flex-row items-center gap-(--multi-workbench-chrome-action-gap)",
        tool: "pointer-events-none ui-tab-system multi-workbench-tool-island relative z-20 box-border flex h-(--multi-workbench-chrome-row-height) min-h-(--multi-workbench-chrome-row-height) max-h-(--multi-workbench-chrome-row-height) flex-none flex-row select-none items-center gap-(--multi-workbench-chrome-action-gap) overflow-hidden border-b px-(--multi-workbench-chrome-padding-inline) [--tab-system-bar-background:transparent] editor-panel-tab-root editor-panel-tab-root--simple-tabs",
      },
    },
  },
);

const workbenchChromeRowContentVariants = cva(
  "no-scrollbar flex min-h-0 min-w-0 flex-1 items-center overflow-hidden",
  {
    variants: {
      gap: {
        action: "gap-(--multi-workbench-chrome-action-gap)",
        loose: "gap-(--multi-workbench-chrome-gap-loose)",
        relaxed: "gap-(--multi-workbench-chrome-gap-relaxed)",
      },
      variant: {
        panel: "",
        tool: "editor-panel-tab-bar-tab-cluster pointer-events-auto h-(--multi-workbench-action-size) self-center",
      },
    },
  },
);

const workbenchChromeRowSlotClassName = "flex shrink-0 items-center self-center";
const workbenchChromeRowEndSlotClassName =
  "pointer-events-none flex shrink-0 items-center self-center";
const workbenchChromeActionGroupVariants = cva(
  "no-drag flex h-(--multi-workbench-action-size) shrink-0 select-none items-center self-center",
  {
    variants: {
      gap: {
        action: "gap-(--multi-workbench-chrome-action-gap)",
        loose: "gap-(--multi-workbench-chrome-gap-loose)",
        relaxed: "gap-(--multi-workbench-chrome-gap-relaxed)",
        sub: "gap-(--multi-workbench-sub-chrome-action-gap)",
      },
      overflow: {
        false: "",
        true: "min-w-0 overflow-hidden",
      },
    },
    defaultVariants: {
      gap: "action",
      overflow: false,
    },
  },
);
const workbenchChromeTextControlVariants = cva(
  "no-drag inline-flex h-(--multi-workbench-action-size) min-w-0 select-none items-center justify-start gap-(--multi-workbench-text-control-gap) overflow-hidden rounded-multi-control border-0 bg-transparent px-(--multi-workbench-text-control-padding-inline) text-body font-medium shadow-none outline-hidden before:hidden transition-colors focus-visible:ring-1 focus-visible:ring-multi-stroke-focused focus-visible:ring-inset",
  {
    variants: {
      tone: {
        default:
          "text-multi-fg-secondary hover:bg-multi-bg-quaternary hover:text-multi-fg-primary data-popup-open:bg-multi-bg-quaternary data-popup-open:text-multi-fg-primary",
        primary: "text-multi-fg-primary hover:bg-multi-bg-quaternary",
      },
      tabular: {
        false: "",
        true: "tabular-nums",
      },
    },
    defaultVariants: {
      tone: "default",
      tabular: false,
    },
  },
);

type WorkbenchChromeRowVariant = NonNullable<
  VariantProps<typeof workbenchChromeRowVariants>["variant"]
>;
type WorkbenchChromeRowGap = NonNullable<
  VariantProps<typeof workbenchChromeRowContentVariants>["gap"]
>;

function WorkbenchChromeRow(props: {
  children: ReactNode;
  end?: ReactNode;
  gap?: WorkbenchChromeRowGap;
  trailing?: ReactNode;
  variant: WorkbenchChromeRowVariant;
}) {
  const gap = props.gap ?? "action";

  return (
    <div
      className={workbenchChromeRowVariants({ variant: props.variant })}
      data-slot="workbench-chrome-row"
      data-variant={props.variant === "tool" ? "simple-tabs" : props.variant}
    >
      <div
        className={workbenchChromeRowContentVariants({ gap, variant: props.variant })}
        data-slot="workbench-chrome-row-content"
      >
        {props.children}
      </div>

      {props.trailing ? (
        <div
          className={
            props.variant === "tool"
              ? `${workbenchChromeRowSlotClassName} pointer-events-auto`
              : workbenchChromeRowSlotClassName
          }
          data-slot="workbench-chrome-row-trailing"
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
          data-slot="workbench-chrome-row-end"
        >
          {props.end}
        </div>
      ) : null}
    </div>
  );
}

function WorkbenchChromeActionGroup({
  className,
  gap,
  overflow,
  ...props
}: ComponentProps<"div"> & {
  gap?: NonNullable<VariantProps<typeof workbenchChromeActionGroupVariants>["gap"]> | undefined;
  overflow?: boolean | undefined;
}) {
  return (
    <div
      className={cn(
        workbenchChromeActionGroupVariants({ gap, overflow: overflow ?? false }),
        className,
      )}
      data-slot="workbench-chrome-action-group"
      {...props}
    />
  );
}

function WorkbenchChromeDivider({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "h-(--multi-workbench-action-size) w-px shrink-0 self-center bg-multi-stroke-tertiary",
        className,
      )}
      data-slot="workbench-chrome-divider"
      aria-hidden
      {...props}
    />
  );
}

function WorkbenchChromeLabel({ className, ...props }: ComponentProps<"span">) {
  return (
    <span
      className={cn(
        "no-drag inline-flex h-(--multi-workbench-action-size) shrink-0 items-center text-multi-fg-secondary",
        className,
      )}
      data-slot="workbench-chrome-label"
      {...props}
    />
  );
}

function WorkbenchChromeSpacer({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "editor-panel-tab-bar-spacer drag-region pointer-events-auto min-h-(--multi-workbench-action-size) min-w-0 flex-1 self-center",
        className,
      )}
      data-slot="workbench-chrome-spacer"
      aria-hidden
      {...props}
    />
  );
}

export {
  WorkbenchChromeActionGroup,
  WorkbenchChromeDivider,
  WorkbenchChromeLabel,
  WorkbenchChromeRow,
  WorkbenchChromeSpacer,
  workbenchChromeActionGroupVariants,
  workbenchChromeRowContentVariants,
  workbenchChromeRowVariants,
  workbenchChromeTextControlVariants,
};
