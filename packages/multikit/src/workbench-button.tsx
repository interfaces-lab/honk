"use client";

import { cva, type VariantProps } from "class-variance-authority";
import type { ReactNode } from "react";

import { cn, controlTransitionClassName } from "./utils";

const workbenchIconButtonVariants = cva(
  cn(
    "no-drag ui-icon-button box-border flex shrink-0 select-none items-center justify-center rounded-multi-control border-0 px-(--multi-workbench-chrome-icon-padding-x) text-multi-icon-secondary shadow-none outline-hidden transition-[background-color,color,transform] active:scale-[0.96] focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-multi-stroke-focused focus-visible:ring-inset motion-reduce:transform-none disabled:text-multi-fg-quaternary/45 disabled:hover:bg-transparent disabled:hover:text-multi-fg-quaternary/45 disabled:active:scale-100 [&_svg]:block",
    controlTransitionClassName,
  ),
  {
    variants: {
      active: {
        true: "bg-multi-bg-tertiary text-multi-icon-primary",
        false: "bg-transparent hover:bg-multi-bg-quaternary hover:text-multi-icon-primary",
      },
      chrome: {
        tool: "h-(--multi-workbench-action-size) min-h-(--multi-workbench-action-size) max-h-(--multi-workbench-action-size) min-w-(--multi-workbench-action-size)",
        panel:
          "h-(--multi-workbench-action-size) min-h-(--multi-workbench-action-size) max-h-(--multi-workbench-action-size) min-w-(--multi-workbench-action-size)",
        sub: "h-(--multi-workbench-action-size) min-h-(--multi-workbench-action-size) max-h-(--multi-workbench-action-size) min-w-(--multi-workbench-action-size)",
      },
      tabSystem: {
        true: "ui-tab-system-tab",
        false: "",
      },
    },
    defaultVariants: {
      active: false,
      chrome: "tool",
      tabSystem: false,
    },
  },
);

type WorkbenchIconButtonChrome = NonNullable<
  VariantProps<typeof workbenchIconButtonVariants>["chrome"]
>;

const workbenchTextButtonVariants = cva(
  cn(
    "no-drag box-border inline-flex h-(--multi-workbench-action-size) min-w-0 shrink-0 select-none items-center justify-center gap-1 truncate rounded-multi-control border-0 px-1.5 text-body font-medium outline-hidden transition-[background-color,color,transform] active:scale-[0.96] focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-multi-stroke-focused focus-visible:ring-inset motion-reduce:transform-none disabled:pointer-events-none disabled:text-multi-fg-quaternary/45 disabled:active:scale-100 [&_svg]:block",
    controlTransitionClassName,
  ),
  {
    variants: {
      tone: {
        default:
          "bg-transparent text-multi-fg-secondary hover:bg-multi-bg-quaternary hover:text-multi-fg-primary",
        primary: "bg-multi-bg-tertiary text-multi-fg-primary hover:bg-multi-bg-secondary",
        danger:
          "bg-transparent text-multi-fg-tertiary hover:bg-multi-bg-quaternary hover:text-multi-fg-red-primary",
      },
    },
    defaultVariants: {
      tone: "default",
    },
  },
);

type WorkbenchTextButtonTone = NonNullable<
  VariantProps<typeof workbenchTextButtonVariants>["tone"]
>;

function WorkbenchIconButton(props: {
  active?: boolean | undefined;
  "aria-label": string;
  "aria-pressed"?: boolean | undefined;
  children: ReactNode;
  className?: string | undefined;
  chrome?: WorkbenchIconButtonChrome | undefined;
  disabled?: boolean | undefined;
  onClick?: (() => void) | undefined;
  tabSystem?: boolean | undefined;
  title?: string | undefined;
}) {
  return (
    <button
      type="button"
      aria-label={props["aria-label"]}
      aria-pressed={props["aria-pressed"]}
      title={props.title ?? props["aria-label"]}
      disabled={props.disabled}
      onClick={props.onClick}
      className={cn(
        workbenchIconButtonVariants({
          active: props.active ?? false,
          chrome: props.chrome,
          tabSystem: props.tabSystem ?? false,
        }),
        props.className,
      )}
    >
      {props.children}
    </button>
  );
}

function WorkbenchTextButton(props: {
  "aria-label"?: string | undefined;
  children: ReactNode;
  className?: string | undefined;
  disabled?: boolean | undefined;
  onClick?: (() => void) | undefined;
  title?: string | undefined;
  tone?: WorkbenchTextButtonTone | undefined;
}) {
  return (
    <button
      type="button"
      aria-label={props["aria-label"]}
      title={props.title}
      disabled={props.disabled}
      onClick={props.onClick}
      className={cn(workbenchTextButtonVariants({ tone: props.tone }), props.className)}
    >
      {props.children}
    </button>
  );
}

export {
  WorkbenchIconButton,
  WorkbenchTextButton,
  workbenchIconButtonVariants,
  workbenchTextButtonVariants,
};
