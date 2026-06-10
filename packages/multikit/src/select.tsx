"use client";

import { mergeProps } from "@base-ui/react/merge-props";
import { Select as SelectPrimitive } from "@base-ui/react/select";
import { useRender } from "@base-ui/react/use-render";
import { cva, type VariantProps } from "class-variance-authority";
import { IconCheckmark1, IconChevronRightMedium } from "central-icons";
import type * as React from "react";

import {
  workbenchMenuItemClassName,
  workbenchMenuPopupClassName,
  workbenchMenuViewportClassName,
} from "./menu";
import { cn, controlTransitionClassName, interactiveControlCursorClassName } from "./utils";

const Select = SelectPrimitive.Root;

const selectTriggerVariants = cva(
  cn(
    "relative inline-flex select-none items-center justify-between gap-2 border rounded-lg text-left text-base outline-none transition-[color,box-shadow,background-color] data-disabled:pointer-events-none data-disabled:opacity-64 sm:text-sm [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4.5 sm:[&_svg:not([class*='size-'])]:size-4",
    interactiveControlCursorClassName,
    controlTransitionClassName,
  ),
  {
    defaultVariants: {
      size: "default",
      variant: "default",
    },
    variants: {
      variant: {
        /** Matches `Button` `outline` / workbench secondary control tokens. */
        outline:
          "border-multi-stroke-tertiary bg-multi-bg-quinary text-multi-fg-secondary shadow-none hover:border-multi-stroke-secondary hover:bg-multi-bg-quaternary hover:text-multi-fg-primary data-pressed:bg-multi-bg-tertiary focus-visible:ring-1 focus-visible:ring-multi-stroke-focused",
        default:
          "w-full min-w-36 border-input bg-background not-dark:bg-clip-padding text-foreground shadow-xs/5 ring-ring/24 before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-lg)-1px)] not-data-disabled:not-focus-visible:not-aria-invalid:not-data-pressed:before:shadow-[0_1px_--theme(--color-black/4%)] pointer-coarse:after:absolute pointer-coarse:after:size-full pointer-coarse:after:min-h-11 focus-visible:border-ring focus-visible:ring-[3px] aria-invalid:border-destructive/36 focus-visible:aria-invalid:border-destructive/64 focus-visible:aria-invalid:ring-destructive/16 dark:bg-input/32 dark:aria-invalid:ring-destructive/24 dark:not-data-disabled:not-focus-visible:not-aria-invalid:not-data-pressed:before:shadow-[0_-1px_--theme(--color-white/6%)] [&_svg:not([class*='opacity-'])]:opacity-80 [[data-disabled],:focus-visible,[aria-invalid],[data-pressed]]:shadow-none",
        ghost:
          "border-transparent text-muted-foreground/70 focus-visible:ring-2 focus-visible:ring-ring data-pressed:bg-accent [:hover,[data-pressed]]:bg-accent [:hover,[data-pressed]]:text-foreground/80",
      },
      size: {
        /** Dense `rounded-multi-control` trigger (composer / toolbar height). */
        control:
          "h-7 gap-1.5 rounded-multi-control px-2 text-body [&_svg:not([class*='size-'])]:size-3.5",
        default: "min-h-9 px-3 sm:min-h-8",
        lg: "min-h-10 px-3 sm:min-h-9",
        sm: "min-h-8 gap-1.5 px-2.5 sm:min-h-7",
        xs: "h-7 min-h-7 gap-1 rounded-multi-control px-2.5 font-multi text-body before:rounded-[calc(var(--multi-radius-control)-1px)] [&_svg:not([class*='size-'])]:size-4 sm:[&_svg:not([class*='size-'])]:size-3.5",
      },
    },
  },
);

const selectTriggerIconClassName = "-me-1 size-4.5 rotate-90 opacity-80 sm:size-4";

interface SelectButtonProps extends useRender.ComponentProps<"button"> {
  size?: VariantProps<typeof selectTriggerVariants>["size"];
  variant?: VariantProps<typeof selectTriggerVariants>["variant"];
}

function SelectButton({ className, size, variant, render, children, ...props }: SelectButtonProps) {
  const typeValue: React.ButtonHTMLAttributes<HTMLButtonElement>["type"] = render
    ? undefined
    : "button";

  const defaultProps = {
    children: (
      <>
        <span className="flex-1 truncate in-data-placeholder:text-muted-foreground/72">
          {children}
        </span>
        {variant === "ghost" ? (
          <IconChevronRightMedium className="size-3 rotate-90 opacity-50" />
        ) : (
          <IconChevronRightMedium className={selectTriggerIconClassName} />
        )}
      </>
    ),
    className: cn(selectTriggerVariants({ size, variant }), "min-w-none", className),
    "data-size": size ?? "default",
    "data-slot": "select-button",
    "data-variant": variant ?? "default",
    type: typeValue,
  };

  return useRender({
    defaultTagName: "button",
    props: mergeProps<"button">(defaultProps, props),
    render,
  });
}

function SelectTrigger({
  className,
  size = "default",
  variant = "default",
  children,
  ...props
}: SelectPrimitive.Trigger.Props & VariantProps<typeof selectTriggerVariants>) {
  return (
    <SelectPrimitive.Trigger
      className={cn(selectTriggerVariants({ size, variant }), className)}
      data-size={size}
      data-slot="select-trigger"
      data-variant={variant}
      {...props}
    >
      {children}
      <SelectPrimitive.Icon data-slot="select-icon">
        <IconChevronRightMedium className="size-3 rotate-90 opacity-50" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

function SelectValue({ className, ...props }: SelectPrimitive.Value.Props) {
  return (
    <SelectPrimitive.Value
      className={cn("flex-1 truncate data-placeholder:text-muted-foreground", className)}
      data-slot="select-value"
      {...props}
    />
  );
}

function SelectPopup({
  className,
  children,
  side = "bottom",
  sideOffset = 4,
  align = "start",
  alignOffset = 0,
  alignItemWithTrigger = true,
  anchor,
  ...props
}: SelectPrimitive.Popup.Props & {
  side?: SelectPrimitive.Positioner.Props["side"];
  sideOffset?: SelectPrimitive.Positioner.Props["sideOffset"];
  align?: SelectPrimitive.Positioner.Props["align"];
  alignOffset?: SelectPrimitive.Positioner.Props["alignOffset"];
  alignItemWithTrigger?: SelectPrimitive.Positioner.Props["alignItemWithTrigger"];
  anchor?: SelectPrimitive.Positioner.Props["anchor"];
}) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Positioner
        align={align}
        alignItemWithTrigger={alignItemWithTrigger}
        alignOffset={alignOffset}
        anchor={anchor}
        className="z-(--z-index-select) select-none"
        data-slot="select-positioner"
        side={side}
        sideOffset={sideOffset}
      >
        <SelectPrimitive.Popup
          className="origin-(--transform-origin) text-foreground"
          data-slot="select-popup"
          {...props}
        >
          <SelectPrimitive.ScrollUpArrow
            className="top-0 z-[1] flex h-6 w-full cursor-default items-center justify-center before:pointer-events-none before:absolute before:inset-x-px before:top-px before:h-[200%] before:rounded-t-[7px] before:bg-linear-to-b before:from-50% before:from-multi-bg-elevated"
            data-slot="select-scroll-up-arrow"
          >
            <IconChevronRightMedium className="relative size-4.5 -rotate-90 sm:size-4" />
          </SelectPrimitive.ScrollUpArrow>
          <div className={cn(workbenchMenuPopupClassName, "min-w-(--anchor-width)")}>
            <SelectPrimitive.List
              className={cn(workbenchMenuViewportClassName, className)}
              data-slot="select-list"
            >
              {children}
            </SelectPrimitive.List>
          </div>
          <SelectPrimitive.ScrollDownArrow
            className="bottom-0 z-[1] flex h-6 w-full cursor-default items-center justify-center before:pointer-events-none before:absolute before:inset-x-px before:bottom-px before:h-[200%] before:rounded-b-[7px] before:bg-linear-to-t before:from-50% before:from-multi-bg-elevated"
            data-slot="select-scroll-down-arrow"
          >
            <IconChevronRightMedium className="relative size-4.5 rotate-90 sm:size-4" />
          </SelectPrimitive.ScrollDownArrow>
        </SelectPrimitive.Popup>
      </SelectPrimitive.Positioner>
    </SelectPrimitive.Portal>
  );
}

function SelectItem({
  className,
  children,
  hideIndicator = false,
  ...props
}: SelectPrimitive.Item.Props & {
  hideIndicator?: boolean;
}) {
  return (
    <SelectPrimitive.Item
      className={cn(
        workbenchMenuItemClassName,
        hideIndicator ? "px-1" : "grid grid-cols-[1rem_1fr] ps-1 pe-2",
        className,
      )}
      data-slot="select-item"
      {...props}
    >
      {hideIndicator ? null : (
        <SelectPrimitive.ItemIndicator
          className={cn(
            "col-start-1 inline-flex size-4 items-center justify-center text-multi-fg-primary opacity-0 transition-opacity in-data-selected:opacity-100 [&_svg:not([class*='size-'])]:size-3",
            controlTransitionClassName,
          )}
          data-slot="select-item-indicator"
          keepMounted
        >
          <IconCheckmark1 />
        </SelectPrimitive.ItemIndicator>
      )}
      <SelectPrimitive.ItemText
        className={cn("min-w-0", hideIndicator ? "col-start-1" : "col-start-2", "truncate")}
        data-slot="select-item-text"
      >
        {children}
      </SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}

function SelectSeparator({ className, ...props }: SelectPrimitive.Separator.Props) {
  return (
    <SelectPrimitive.Separator
      className={cn("mx-2 my-1 h-px bg-border", className)}
      data-slot="select-separator"
      {...props}
    />
  );
}

function SelectGroup(props: SelectPrimitive.Group.Props) {
  return <SelectPrimitive.Group data-slot="select-group" {...props} />;
}

function SelectGroupLabel(props: SelectPrimitive.GroupLabel.Props) {
  return (
    <SelectPrimitive.GroupLabel
      className="px-2 py-1.5 text-detail font-medium text-muted-foreground"
      data-slot="select-group-label"
      {...props}
    />
  );
}

export type SimpleSelectProps = {
  value: string;
  onValueChange: (next: string) => void;
  options: ReadonlyArray<{ value: string; label: string }>;
  disabled?: boolean;
};

/** Small controlled select for settings rows (value + options list). */
function SimpleSelect({ value, onValueChange, options, disabled }: SimpleSelectProps) {
  return (
    <Select
      value={value}
      onValueChange={(next) => {
        if (next != null) onValueChange(next);
      }}
      disabled={disabled}
    >
      <SelectTrigger className="w-full min-w-36" disabled={disabled}>
        <SelectValue />
      </SelectTrigger>
      <SelectPopup>
        {options.map((opt) => (
          <SelectItem key={opt.value} value={opt.value}>
            {opt.label}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}

export {
  Select,
  SelectTrigger,
  SelectButton,
  selectTriggerVariants,
  SelectValue,
  SelectPopup,
  SelectPopup as SelectContent,
  SelectItem,
  SelectSeparator,
  SelectGroup,
  SelectGroupLabel,
  SimpleSelect,
};
