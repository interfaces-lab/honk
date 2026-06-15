"use client";

import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps, ReactNode } from "react";

import { cn } from "./utils";

const workbenchChromeRowVariants = cva(
  "font-honk flex shrink-0 flex-nowrap select-none text-honk-chrome font-normal text-honk-fg-secondary",
  {
    variants: {
      variant: {
        panel:
          "no-drag honk-workbench-panel-title-row w-full min-w-0 flex-row items-center justify-between gap-(--honk-workbench-chrome-action-gap)",
        tool: "editor-panel-tab-root editor-panel-tab-root--simple-tabs honk-workbench-tool-island no-drag ui-tab-system relative z-20 box-border flex h-(--honk-workbench-chrome-row-height) max-h-(--honk-workbench-chrome-row-height) min-h-(--honk-workbench-chrome-row-height) w-full min-w-0 flex-none flex-row items-center gap-0 overflow-hidden border-0 px-0 select-none [--tab-system-bar-background:transparent] [--tab-system-height:var(--honk-workbench-chrome-row-height)]",
      },
    },
  },
);

const workbenchChromeRowContentVariants = cva(
  "no-scrollbar flex min-h-0 min-w-0 flex-1 items-center overflow-hidden",
  {
    variants: {
      gap: {
        action: "gap-(--honk-workbench-chrome-action-gap)",
        loose: "gap-(--honk-workbench-chrome-gap-loose)",
        relaxed: "gap-(--honk-workbench-chrome-gap-relaxed)",
      },
      variant: {
        panel: "",
        tool: "editor-panel-tab-bar-tab-cluster box-border h-full self-stretch py-(--honk-workbench-tab-container-padding)",
      },
    },
  },
);

const workbenchChromeActionGroupVariants = cva(
  "no-drag flex h-(--honk-workbench-action-size) shrink-0 select-none items-center self-center",
  {
    variants: {
      gap: {
        action: "gap-(--honk-workbench-chrome-action-gap)",
        loose: "gap-(--honk-workbench-chrome-gap-loose)",
        relaxed: "gap-(--honk-workbench-chrome-gap-relaxed)",
        sub: "gap-(--honk-workbench-sub-chrome-action-gap)",
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
  "no-drag inline-flex h-(--honk-workbench-tab-height) min-w-0 select-none items-center justify-start gap-(--honk-workbench-text-control-gap) overflow-hidden rounded-honk-control border-0 bg-transparent px-(--honk-workbench-text-control-padding-inline) text-honk-tab font-normal shadow-none outline-hidden before:hidden transition-colors focus-visible:ring-1 focus-visible:ring-honk-stroke-focused focus-visible:ring-inset",
  {
    variants: {
      tone: {
        default:
          "text-honk-fg-secondary hover:bg-honk-bg-quaternary hover:text-honk-fg-primary data-popup-open:bg-honk-bg-quaternary data-popup-open:text-honk-fg-primary",
        primary: "text-honk-fg-primary hover:bg-honk-bg-quaternary",
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
      data-shell-no-drag=""
      data-slot="workbench-chrome-row"
      data-variant={props.variant === "tool" ? "simple-tabs" : props.variant}
    >
      <div
        className={workbenchChromeRowContentVariants({ gap, variant: props.variant })}
        data-slot="workbench-chrome-row-content"
      >
        {props.children}
      </div>

      {props.trailing || (props.variant === "tool" && props.end) ? (
        <div
          className={
            props.variant === "tool"
              ? "editor-panel-tab-bar-trailing-section no-drag box-border flex h-full shrink-0 items-center gap-0 px-2 py-1"
              : "flex shrink-0 items-center self-center"
          }
          data-shell-no-drag=""
          data-slot={
            props.variant === "tool"
              ? "workbench-chrome-trailing-section"
              : "workbench-chrome-row-trailing"
          }
        >
          {props.trailing}
          {props.variant === "tool" ? props.end : null}
        </div>
      ) : null}

      {props.end && props.variant !== "tool" ? (
        <div
          className="flex shrink-0 items-center self-center"
          data-shell-no-drag=""
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
      data-shell-no-drag=""
      data-slot="workbench-chrome-action-group"
      {...props}
    />
  );
}

function WorkbenchChromeDivider({ className, ...props }: ComponentProps<"hr">) {
  return (
    <hr
      className={cn(
        "ui-tab-system-tabs__section-divider h-(--honk-workbench-tab-height) w-px shrink-0 self-center border-0 bg-honk-stroke-tertiary",
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
        "no-drag inline-flex h-(--honk-workbench-tab-height) shrink-0 items-center text-honk-fg-secondary",
        className,
      )}
      data-shell-no-drag=""
      data-slot="workbench-chrome-label"
      {...props}
    />
  );
}

function WorkbenchChromeSpacer({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "editor-panel-tab-bar-spacer min-h-(--honk-workbench-tab-height) min-w-0 flex-1 self-stretch",
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
