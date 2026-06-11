"use client";

import { cva, type VariantProps } from "class-variance-authority";
import type { AriaAttributes, MouseEventHandler, ReactNode } from "react";

import { Button } from "./button";
import { cn, controlTransitionClassName } from "./utils";

const workbenchIconButtonVariants = cva(
  cn(
    "no-drag ui-icon-button box-border flex shrink-0 select-none items-center justify-center rounded-multi-control border-0 px-(--multi-workbench-chrome-icon-padding-x) text-multi-icon-secondary shadow-none outline-hidden before:hidden transition-[background-color,color,transform] active:scale-[0.96] focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-multi-stroke-focused focus-visible:ring-inset motion-reduce:transform-none disabled:text-multi-fg-quaternary/45 disabled:hover:bg-transparent disabled:hover:text-multi-fg-quaternary/45 disabled:active:scale-100 [&_svg]:block",
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
    "no-drag box-border inline-flex h-(--multi-workbench-action-size) min-w-0 shrink-0 select-none items-center justify-center gap-(--multi-workbench-text-control-gap) truncate rounded-multi-control border-0 px-(--multi-workbench-text-control-padding-inline) text-body font-medium outline-hidden before:hidden transition-[background-color,color,transform] active:scale-[0.96] focus-visible:outline-hidden focus-visible:ring-1 focus-visible:ring-multi-stroke-focused focus-visible:ring-inset motion-reduce:transform-none disabled:pointer-events-none disabled:text-multi-fg-quaternary/45 disabled:active:scale-100 [&_svg]:block",
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
  "aria-current"?: AriaAttributes["aria-current"] | undefined;
  "aria-label": string;
  "aria-pressed"?: boolean | undefined;
  children: ReactNode;
  className?: string | undefined;
  chrome?: WorkbenchIconButtonChrome | undefined;
  disabled?: boolean | undefined;
  onClick?: MouseEventHandler<HTMLButtonElement> | undefined;
  tabSystem?: boolean | undefined;
  title?: string | undefined;
}) {
  return (
    <Button
      type="button"
      size="icon-xs"
      variant="ghost"
      aria-current={props["aria-current"]}
      aria-label={props["aria-label"]}
      aria-pressed={props["aria-pressed"]}
      title={props.title ?? props["aria-label"]}
      data-active={props.active ?? false}
      data-chrome={props.chrome ?? "tool"}
      data-slot="workbench-icon-button"
      data-tab-system={props.tabSystem ?? false}
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
    </Button>
  );
}

function WorkbenchTextButton(props: {
  "aria-label"?: string | undefined;
  children: ReactNode;
  className?: string | undefined;
  disabled?: boolean | undefined;
  onClick?: MouseEventHandler<HTMLButtonElement> | undefined;
  title?: string | undefined;
  tone?: WorkbenchTextButtonTone | undefined;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      aria-label={props["aria-label"]}
      title={props.title}
      data-slot="workbench-text-button"
      data-tone={props.tone ?? "default"}
      disabled={props.disabled}
      onClick={props.onClick}
      className={cn(workbenchTextButtonVariants({ tone: props.tone }), props.className)}
    >
      {props.children}
    </Button>
  );
}

function WorkbenchTabIconContent(props: {
  badge?: string | null | undefined;
  children: ReactNode;
}) {
  const badge = props.badge && props.badge !== "0" ? props.badge : null;
  const showBadgeCount = badge ? /^\d+$/.test(badge) : false;

  return (
    <span
      className="ui-tab-system-tab__content relative flex size-full min-w-0 flex-none items-center justify-center"
      data-slot="workbench-tab-icon-content"
    >
      <span className="ui-tab-system-tab__icon inline-flex size-4 shrink-0 items-center justify-center [&_svg]:size-4 [&_svg]:shrink-0">
        {props.children}
      </span>
      {badge ? (
        <span
          aria-hidden
          className={cn(
            "absolute rounded-full bg-warning text-warning-foreground shadow-[0_0_0_1px_var(--multi-bg-primary)]",
            showBadgeCount
              ? "-top-0.5 -right-0.5 flex h-3.5 min-w-3.5 items-center justify-center px-0.5 text-[9px] leading-none font-semibold tabular-nums"
              : "top-0.5 right-0.5 size-2",
          )}
          data-slot="workbench-tab-icon-badge"
        >
          {showBadgeCount ? badge : null}
        </span>
      ) : null}
    </span>
  );
}

export {
  WorkbenchIconButton,
  WorkbenchTabIconContent,
  WorkbenchTextButton,
  workbenchIconButtonVariants,
  workbenchTextButtonVariants,
};
