"use client";

import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import { cva, type VariantProps } from "class-variance-authority";
import { IconCheckmark1, IconChevronRightMedium } from "central-icons";
import type * as React from "react";

import {
  cn,
  controlTransitionVariants,
  honkMenuPickerShellClasses,
  honkMenuSeparatorClasses,
  interactiveControlCursorVariants,
} from "./utils";

const MenuCreateHandle = MenuPrimitive.createHandle;

const Menu = MenuPrimitive.Root;

const MenuPortal = MenuPrimitive.Portal;

const menuPopupVariants = cva("", {
  defaultVariants: {
    variant: "default",
  },
  variants: {
    variant: {
      default:
        "relative flex not-[class*='w-']:min-w-32 origin-(--transform-origin) rounded-lg border bg-popover not-dark:bg-clip-padding shadow-lg/5 outline-hidden before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-lg)-1px)] before:shadow-[0_1px_--theme(--color-black/4%)] focus:outline-hidden dark:before:shadow-[0_-1px_--theme(--color-white/6%)]",
      workbench: cn(
        "honk-workbench-menu-popup flex max-h-[min(var(--available-height),20rem)] min-w-48 flex-col origin-(--transform-origin)",
        honkMenuPickerShellClasses,
      ),
    },
  },
});

type MenuPopupVariant = NonNullable<VariantProps<typeof menuPopupVariants>["variant"]>;

const workbenchMenuItemVariants = cva(
  cn(
    "flex min-h-6 select-none items-center gap-1.5 rounded-honk-sm px-(--honk-spacing-1) py-[3px] text-honk-chrome text-honk-fg-secondary outline-hidden transition-colors hover:bg-honk-bg-quaternary hover:text-honk-fg-primary data-disabled:pointer-events-none data-highlighted:bg-honk-bg-tertiary data-highlighted:text-honk-fg-primary data-disabled:opacity-40 [&>svg:not([class*='size-'])]:size-3 [&>svg]:pointer-events-none [&>svg]:shrink-0",
    interactiveControlCursorVariants(),
    controlTransitionVariants(),
  ),
);

const workbenchMenuRadioItemVariants = cva(
  cn(
    "grid min-h-6 select-none grid-cols-[1rem_1fr] items-center gap-1.5 rounded-[4px] py-[3px] ps-1 pe-2 text-body text-honk-fg-secondary outline-hidden transition-colors hover:bg-honk-bg-quaternary hover:text-honk-fg-primary data-disabled:pointer-events-none data-highlighted:bg-honk-bg-tertiary data-highlighted:text-honk-fg-primary data-disabled:opacity-40 [&_svg]:pointer-events-none [&_svg]:shrink-0",
    interactiveControlCursorVariants(),
    controlTransitionVariants(),
  ),
);

function WorkbenchMenuIconSlot({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      className={cn(
        "inline-flex h-4 w-4 shrink-0 items-center justify-center text-honk-fg-tertiary [&>svg]:size-3 [&>svg]:shrink-0",
        className,
      )}
      {...props}
    />
  );
}

function WorkbenchMenuPrimaryText({ className, ...props }: React.ComponentProps<"span">) {
  return <span className={cn("truncate text-body text-honk-fg-primary", className)} {...props} />;
}

function WorkbenchMenuMetaText({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span className={cn("truncate text-detail text-honk-fg-tertiary", className)} {...props} />
  );
}

function WorkbenchMenuLabel({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "px-1 pt-1.5 pb-0.5 font-normal text-detail text-honk-fg-tertiary first:pt-0.5",
        className,
      )}
      {...props}
    />
  );
}

/**
 * For custom triggers (e.g. `Button`), pass `render={<Button … />}` and put the
 * visible label in `children` so props/ref merge correctly. See Base UI composition:
 * https://base-ui.com/react/handbook/composition
 */
function MenuTrigger({ className, children, ...props }: MenuPrimitive.Trigger.Props) {
  return (
    <MenuPrimitive.Trigger className={className} data-slot="menu-trigger" {...props}>
      {children}
    </MenuPrimitive.Trigger>
  );
}

function MenuPopup({
  children,
  className,
  positionerClassName,
  variant = "default",
  sideOffset = 4,
  align = "center",
  alignOffset,
  side = "bottom",
  anchor,
  ...props
}: MenuPrimitive.Popup.Props & {
  variant?: MenuPopupVariant;
  align?: MenuPrimitive.Positioner.Props["align"];
  sideOffset?: MenuPrimitive.Positioner.Props["sideOffset"];
  alignOffset?: MenuPrimitive.Positioner.Props["alignOffset"];
  side?: MenuPrimitive.Positioner.Props["side"];
  anchor?: MenuPrimitive.Positioner.Props["anchor"];
  positionerClassName?: string | undefined;
}) {
  return (
    <MenuPrimitive.Portal>
      <MenuPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        anchor={anchor}
        className={
          variant === "workbench"
            ? cn("pointer-events-none z-(--z-index-workbench-menu)", positionerClassName)
            : cn("pointer-events-none z-(--z-index-menu)", positionerClassName)
        }
        data-slot="menu-positioner"
        side={side}
        sideOffset={sideOffset}
      >
        <MenuPrimitive.Popup
          className={cn("pointer-events-auto", menuPopupVariants({ variant }), className)}
          data-slot="menu-popup"
          {...props}
        >
          <div className="max-h-(--available-height) w-full overflow-y-auto p-1">{children}</div>
        </MenuPrimitive.Popup>
      </MenuPrimitive.Positioner>
    </MenuPrimitive.Portal>
  );
}

function MenuGroup(props: MenuPrimitive.Group.Props) {
  return <MenuPrimitive.Group data-slot="menu-group" {...props} />;
}

function MenuItem({
  className,
  inset,
  variant = "default",
  ...props
}: MenuPrimitive.Item.Props & {
  inset?: boolean;
  variant?: "default" | "destructive" | "workbench";
}) {
  return (
    <MenuPrimitive.Item
      className={cn(
        variant === "workbench"
          ? workbenchMenuItemVariants()
          : "[&>svg]:-mx-0.5 flex min-h-8 cursor-default select-none items-center gap-2 rounded-xs px-2 py-1 text-base text-foreground outline-hidden data-disabled:pointer-events-none data-highlighted:bg-accent data-inset:ps-8 data-[variant=destructive]:text-destructive-foreground data-highlighted:text-accent-foreground data-disabled:opacity-64 sm:min-h-7 sm:text-sm [&>svg:not([class*='opacity-'])]:opacity-80 [&>svg:not([class*='size-'])]:size-4.5 sm:[&>svg:not([class*='size-'])]:size-4 [&>svg]:pointer-events-none [&>svg]:shrink-0",
        className,
      )}
      data-inset={inset}
      data-slot="menu-item"
      data-variant={variant}
      {...props}
    />
  );
}

function MenuCheckboxItem({
  className,
  children,
  checked,
  variant = "default",
  indicatorPosition = "start",
  ...props
}: MenuPrimitive.CheckboxItem.Props & {
  variant?: "default" | "switch" | "workbench" | "workbench-switch";
  indicatorPosition?: "start" | "end";
}) {
  const isSwitch = variant === "switch" || variant === "workbench-switch";
  const workbenchIndicator = (
    <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center">
      <MenuPrimitive.CheckboxItemIndicator
        className="inline-flex h-4 w-4 items-center justify-center text-honk-fg-primary data-unchecked:opacity-0 [&_svg:not([class*='size-'])]:size-3"
        keepMounted
      >
        <IconCheckmark1 />
      </MenuPrimitive.CheckboxItemIndicator>
    </span>
  );
  return (
    <MenuPrimitive.CheckboxItem
      checked={checked}
      className={cn(
        variant === "workbench"
          ? cn(
              workbenchMenuRadioItemVariants(),
              indicatorPosition === "end" && "grid-cols-[1fr_1rem]",
            )
          : variant === "workbench-switch"
            ? cn(
                "grid min-h-6 cursor-default items-center rounded-[4px] py-[3px] ps-1 text-body text-honk-fg-secondary outline-hidden transition-colors data-disabled:pointer-events-none data-highlighted:bg-honk-bg-tertiary data-highlighted:text-honk-fg-primary data-disabled:opacity-40 [&_svg]:pointer-events-none [&_svg]:shrink-0",
                interactiveControlCursorVariants(),
                controlTransitionVariants(),
              )
            : "grid min-h-8 in-data-[side=none]:min-w-[calc(var(--anchor-width)+1.25rem)] cursor-default items-center gap-2 rounded-xs py-1 ps-2 text-base text-foreground outline-hidden data-disabled:pointer-events-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:opacity-64 sm:min-h-7 sm:text-sm [&_svg:not([class*='size-'])]:size-4.5 sm:[&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0",
        variant !== "workbench" &&
          (isSwitch ? "grid-cols-[1fr_auto] gap-4 pe-1.5" : "grid-cols-[1rem_1fr] pe-4"),
        className,
      )}
      data-slot="menu-checkbox-item"
      {...props}
    >
      {variant === "workbench" ? (
        indicatorPosition === "end" ? (
          <>
            <span className="min-w-0 truncate text-honk-fg-primary">{children}</span>
            {workbenchIndicator}
          </>
        ) : (
          <>
            {workbenchIndicator}
            <span className="min-w-0 truncate text-honk-fg-primary">{children}</span>
          </>
        )
      ) : isSwitch ? (
        <>
          <span className="col-start-1">{children}</span>
          <MenuPrimitive.CheckboxItemIndicator
            className={cn(
              "inset-shadow-[0_1px_--theme(--color-black/4%)] inline-flex h-[calc(var(--thumb-size)+2px)] w-[calc(var(--thumb-size)*2-2px)] shrink-0 items-center rounded-full p-px outline-hidden transition-[background-color,box-shadow] [--thumb-size:--spacing(4)] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background data-checked:bg-primary data-unchecked:bg-input data-disabled:opacity-64 sm:[--thumb-size:--spacing(3)]",
              variant === "workbench-switch" &&
                "border border-honk-stroke-tertiary data-checked:border-primary data-unchecked:bg-honk-bg-quinary",
              controlTransitionVariants(),
            )}
            keepMounted
          >
            <span className="pointer-events-none block aspect-square h-full in-[[data-slot=menu-checkbox-item][data-checked]]:origin-(--thumb-size_50%) origin-left in-[[data-slot=menu-checkbox-item][data-checked]]:translate-x-[calc(var(--thumb-size)-4px)] in-[[data-slot=menu-checkbox-item]:active]:not-data-disabled:scale-x-110 in-[[data-slot=menu-checkbox-item]:active]:rounded-[var(--thumb-size)/calc(var(--thumb-size)*1.10)] rounded-(--thumb-size) bg-background shadow-xs/5 will-change-transform [transition:translate_150ms_ease-out,border-radius_150ms_ease-out,scale_150ms_ease-out,transform-origin_150ms_ease-out] motion-reduce:transition-none" />
          </MenuPrimitive.CheckboxItemIndicator>
        </>
      ) : (
        <>
          <MenuPrimitive.CheckboxItemIndicator className="col-start-1">
            <IconCheckmark1 />
          </MenuPrimitive.CheckboxItemIndicator>
          <span className="col-start-2">{children}</span>
        </>
      )}
    </MenuPrimitive.CheckboxItem>
  );
}

function MenuRadioGroup(props: MenuPrimitive.RadioGroup.Props) {
  return <MenuPrimitive.RadioGroup data-slot="menu-radio-group" {...props} />;
}

function MenuRadioItem({
  className,
  children,
  variant = "default",
  ...props
}: MenuPrimitive.RadioItem.Props & { variant?: "default" | "workbench" }) {
  return (
    <MenuPrimitive.RadioItem
      className={cn(
        variant === "workbench"
          ? workbenchMenuRadioItemVariants()
          : "grid min-h-8 in-data-[side=none]:min-w-[calc(var(--anchor-width)+1.25rem)] cursor-default grid-cols-[1rem_1fr] items-center gap-2 rounded-xs py-1 ps-2 pe-4 text-base text-foreground outline-hidden data-disabled:pointer-events-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-disabled:opacity-64 sm:min-h-7 sm:text-sm [&_svg:not([class*='size-'])]:size-4.5 sm:[&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0",
        className,
      )}
      data-slot="menu-radio-item"
      {...props}
    >
      {variant === "workbench" ? (
        <>
          <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center">
            <MenuPrimitive.RadioItemIndicator
              className="inline-flex h-4 w-4 items-center justify-center text-honk-fg-primary data-unchecked:opacity-0 [&_svg:not([class*='size-'])]:size-3"
              keepMounted
            >
              <IconCheckmark1 />
            </MenuPrimitive.RadioItemIndicator>
          </span>
          <span className="min-w-0 truncate text-honk-fg-primary">{children}</span>
        </>
      ) : (
        <>
          <MenuPrimitive.RadioItemIndicator className="col-start-1">
            <IconCheckmark1 />
          </MenuPrimitive.RadioItemIndicator>
          <span className="col-start-2">{children}</span>
        </>
      )}
    </MenuPrimitive.RadioItem>
  );
}

function MenuGroupLabel({
  className,
  inset,
  variant = "default",
  ...props
}: MenuPrimitive.GroupLabel.Props & {
  inset?: boolean;
  variant?: MenuPopupVariant;
}) {
  return (
    <MenuPrimitive.GroupLabel
      className={cn(
        variant === "workbench"
          ? "px-1 pt-1.5 pb-0.5 font-normal text-detail text-honk-fg-tertiary first:pt-0.5"
          : "px-2 py-1.5 font-medium text-muted-foreground text-xs data-inset:ps-9 sm:data-inset:ps-8",
        className,
      )}
      data-inset={inset}
      data-slot="menu-label"
      {...props}
    />
  );
}

function MenuSeparator({
  className,
  variant = "default",
  ...props
}: MenuPrimitive.Separator.Props & { variant?: "default" | "workbench" }) {
  return (
    <MenuPrimitive.Separator
      className={cn(
        variant === "workbench"
          ? honkMenuSeparatorClasses
          : "mx-2 my-1 h-px bg-border",
        className,
      )}
      data-slot="menu-separator"
      {...props}
    />
  );
}

function MenuShortcut({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<"kbd"> & { variant?: "default" | "workbench" }) {
  return (
    <kbd
      className={cn(
        variant === "workbench"
          ? "ms-auto shrink-0 font-honk text-body font-normal tracking-normal text-honk-fg-tertiary"
          : "ms-auto font-medium font-sans text-muted-foreground/72 text-xs tracking-widest",
        className,
      )}
      data-slot="menu-shortcut"
      {...props}
    />
  );
}

function MenuSub(props: MenuPrimitive.SubmenuRoot.Props) {
  return <MenuPrimitive.SubmenuRoot data-slot="menu-sub" {...props} />;
}

function MenuSubTrigger({
  className,
  inset,
  variant = "default",
  children,
  ...props
}: MenuPrimitive.SubmenuTrigger.Props & {
  inset?: boolean;
  variant?: "default" | "workbench";
}) {
  return (
    <MenuPrimitive.SubmenuTrigger
      className={cn(
        variant === "workbench"
          ? workbenchMenuItemVariants()
          : "flex min-h-8 items-center gap-2 rounded-xs px-2 py-1 text-base text-foreground outline-hidden data-disabled:pointer-events-none data-highlighted:bg-accent data-popup-open:bg-accent data-inset:ps-8 data-highlighted:text-accent-foreground data-popup-open:text-accent-foreground data-disabled:opacity-64 sm:min-h-7 sm:text-sm [&_svg:not([class*='size-'])]:size-4.5 sm:[&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none",
        className,
      )}
      data-inset={inset}
      data-slot="menu-sub-trigger"
      data-variant={variant}
      {...props}
    >
      {children}
      <IconChevronRightMedium className="-me-0.5 ms-auto opacity-80" />
    </MenuPrimitive.SubmenuTrigger>
  );
}

function MenuSubPopup({
  className,
  positionerClassName,
  sideOffset = 0,
  alignOffset,
  align = "start",
  side = "inline-end",
  variant = "default",
  ...props
}: MenuPrimitive.Popup.Props & {
  align?: MenuPrimitive.Positioner.Props["align"];
  side?: MenuPrimitive.Positioner.Props["side"];
  sideOffset?: MenuPrimitive.Positioner.Props["sideOffset"];
  alignOffset?: MenuPrimitive.Positioner.Props["alignOffset"];
  variant?: "default" | "workbench";
  positionerClassName?: string | undefined;
}) {
  const defaultAlignOffset = align !== "center" ? -5 : undefined;
  const positionerLayerClassName =
    variant === "workbench" ? "z-(--z-index-workbench-submenu)" : "z-(--z-index-submenu)";

  return (
    <MenuPopup
      align={align}
      alignOffset={alignOffset ?? defaultAlignOffset}
      className={className}
      data-slot="menu-sub-content"
      positionerClassName={positionerClassName ?? positionerLayerClassName}
      side={side}
      sideOffset={sideOffset}
      variant={variant}
      {...props}
    />
  );
}

export {
  MenuCreateHandle,
  MenuCreateHandle as DropdownMenuCreateHandle,
  Menu,
  Menu as DropdownMenu,
  MenuPortal,
  MenuPortal as DropdownMenuPortal,
  MenuTrigger,
  MenuTrigger as DropdownMenuTrigger,
  MenuPopup,
  MenuPopup as DropdownMenuContent,
  MenuGroup,
  MenuGroup as DropdownMenuGroup,
  MenuItem,
  MenuItem as DropdownMenuItem,
  MenuCheckboxItem,
  MenuCheckboxItem as DropdownMenuCheckboxItem,
  MenuRadioGroup,
  MenuRadioGroup as DropdownMenuRadioGroup,
  MenuRadioItem,
  MenuRadioItem as DropdownMenuRadioItem,
  MenuGroupLabel,
  MenuGroupLabel as DropdownMenuLabel,
  MenuSeparator,
  MenuSeparator as DropdownMenuSeparator,
  MenuShortcut,
  MenuShortcut as DropdownMenuShortcut,
  MenuSub,
  MenuSub as DropdownMenuSub,
  MenuSubTrigger,
  MenuSubTrigger as DropdownMenuSubTrigger,
  MenuSubPopup,
  MenuSubPopup as DropdownMenuSubContent,
  WorkbenchMenuIconSlot,
  WorkbenchMenuLabel,
  WorkbenchMenuMetaText,
  WorkbenchMenuPrimaryText,
  menuPopupVariants,
  workbenchMenuItemVariants,
  workbenchMenuRadioItemVariants,
};
