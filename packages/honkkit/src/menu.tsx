"use client";

import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import * as stylex from "@stylexjs/stylex";
import { cva, type VariantProps } from "class-variance-authority";
import { IconCheckmark1, IconChevronRightMedium } from "central-icons";
import type * as React from "react";

import { honkMenuClassName, honkMenuClassNames, honkMenuStyles } from "./menu-styles";
import { switchStyles } from "./switch-styles";
import {
  cn,
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
        "honk-menu honk-menu__surface honk-workbench-menu-popup flex flex-col origin-(--transform-origin)",
        honkMenuPickerShellClasses,
      ),
    },
  },
});

type MenuPopupVariant = NonNullable<VariantProps<typeof menuPopupVariants>["variant"]>;

const workbenchMenuItemClasses = cn(
  "honk-menu__item flex [&>svg:not([class*='size-'])]:size-3 [&>svg]:pointer-events-none [&>svg]:shrink-0",
  interactiveControlCursorVariants(),
);

const workbenchMenuRadioItemClasses = cn(
  "honk-menu__item grid grid-cols-[1rem_1fr] pe-2 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  interactiveControlCursorVariants(),
);

function WorkbenchMenuIconSlot({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      className={cn(
        "honk-menu__slot-leading [&>svg]:size-3 [&>svg]:shrink-0",
        className,
      )}
      {...props}
    />
  );
}

function WorkbenchMenuPrimaryText({ className, ...props }: React.ComponentProps<"span">) {
  return <span className={cn("honk-menu__slot-label", className)} {...props} />;
}

function WorkbenchMenuMetaText({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span className={cn("honk-menu__slot-trailing", className)} {...props} />
  );
}

function WorkbenchMenuLabel({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "honk-menu__label first:pt-0.5",
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
  const workbenchSurfaceProps = stylex.props(
    honkMenuStyles.surface,
    honkMenuStyles.surfaceStarting,
  );
  const workbenchViewportProps = stylex.props(honkMenuStyles.viewport);

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
          className={
            variant === "workbench"
              ? cn(
                  "pointer-events-auto",
                  workbenchSurfaceProps.className,
                  menuPopupVariants({ variant }),
                  className,
                )
              : cn("pointer-events-auto", menuPopupVariants({ variant }), className)
          }
          style={variant === "workbench" ? workbenchSurfaceProps.style : undefined}
          data-slot="menu-popup"
          {...props}
        >
          <div
            className={cn(
              variant === "workbench"
                ? cn(workbenchViewportProps.className, "honk-menu__viewport")
                : "max-h-(--available-height) w-full overflow-y-auto p-1",
            )}
            style={variant === "workbench" ? workbenchViewportProps.style : undefined}
          >
            {children}
          </div>
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
          ? workbenchMenuItemClasses
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
              workbenchMenuRadioItemClasses,
              indicatorPosition === "end" && "grid-cols-[1fr_1rem]",
            )
          : variant === "workbench-switch"
            ? cn(
                "honk-menu__item grid ps-1 text-body [&_svg]:pointer-events-none [&_svg]:shrink-0",
                interactiveControlCursorVariants(),
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
            <span className="honk-menu__slot-label">{children}</span>
            {workbenchIndicator}
          </>
        ) : (
          <>
            {workbenchIndicator}
            <span className="honk-menu__slot-label">{children}</span>
          </>
        )
      ) : isSwitch ? (
        <>
          <span className="col-start-1">{children}</span>
          <MenuPrimitive.CheckboxItemIndicator
            keepMounted
            render={(indicatorProps, state) => {
              const switchRootProps = stylex.props(switchStyles.root, switchStyles.menuRoot);
              const switchThumbProps = stylex.props(switchStyles.thumb);

              return (
                <span
                  {...indicatorProps}
                  className={cn(indicatorProps.className, switchRootProps.className)}
                  style={{ ...switchRootProps.style, ...indicatorProps.style }}
                >
                  <span
                    {...switchThumbProps}
                    data-checked={state.checked ? "" : undefined}
                    data-slot="switch-thumb"
                    data-unchecked={state.checked ? undefined : ""}
                  />
                </span>
              );
            }}
          />
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
          ? workbenchMenuRadioItemClasses
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
          <span className="honk-menu__slot-label">{children}</span>
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
          ? "honk-menu__label first:pt-0.5"
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
        variant === "workbench" ? honkMenuSeparatorClasses : "mx-2 my-1 h-px bg-border",
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
          ? "honk-menu__shortcut honk-menu__slot-trailing"
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
          ? workbenchMenuItemClasses
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
  honkMenuClassName,
  honkMenuClassNames,
  honkMenuStyles,
  menuPopupVariants,
  workbenchMenuItemClasses,
  workbenchMenuRadioItemClasses,
};
