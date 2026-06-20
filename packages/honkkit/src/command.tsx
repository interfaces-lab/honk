"use client";

import { Dialog as CommandDialogPrimitive } from "@base-ui/react/dialog";
import { IconMagnifyingGlass } from "central-icons";
import type * as React from "react";
import {
  cn,
  honkCommandPaletteChromeClasses,
  honkMenuPopupFontClasses,
  honkMenuSeparatorClasses,
} from "./utils";
import {
  Autocomplete,
  AutocompleteCollection,
  AutocompleteEmpty,
  AutocompleteGroup,
  AutocompleteGroupLabel,
  AutocompleteInput,
  AutocompleteItem,
  AutocompleteList,
  AutocompleteSeparator,
} from "./autocomplete";

const commandSearchAddon = <IconMagnifyingGlass />;

const CommandDialog = CommandDialogPrimitive.Root;

const CommandDialogPortal = CommandDialogPrimitive.Portal;

const CommandCreateHandle = CommandDialogPrimitive.createHandle;

function CommandDialogTrigger(props: CommandDialogPrimitive.Trigger.Props) {
  return <CommandDialogPrimitive.Trigger data-slot="command-dialog-trigger" {...props} />;
}

function CommandDialogBackdrop({ className, ...props }: CommandDialogPrimitive.Backdrop.Props) {
  return (
    <CommandDialogPrimitive.Backdrop
      className={cn(
        "fixed inset-0 z-(--z-index-command-dialog-backdrop) bg-transparent transition-opacity duration-150 ease-out data-ending-style:opacity-0 data-starting-style:opacity-0",
        className,
      )}
      data-slot="command-dialog-backdrop"
      {...props}
    />
  );
}

function CommandDialogViewport({ className, ...props }: CommandDialogPrimitive.Viewport.Props) {
  return (
    <CommandDialogPrimitive.Viewport
      className={cn(
        "fixed inset-0 z-(--z-index-command-dialog-viewport) flex flex-col items-center justify-start overflow-hidden px-4 py-4 pt-[8vh]",
        className,
      )}
      data-slot="command-dialog-viewport"
      {...props}
    />
  );
}

function CommandDialogPopup({ className, children, ...props }: CommandDialogPrimitive.Popup.Props) {
  return (
    <CommandDialogPortal>
      <CommandDialogBackdrop />
      <CommandDialogViewport>
        <CommandDialogPrimitive.Popup
          className={cn(
            "relative flex max-h-[min(28rem,calc(100vh-2rem))] min-h-0 w-full min-w-0 max-w-[640px] flex-col overflow-hidden rounded-honk-xl bg-(--honk-command-palette-surface-background) backdrop-blur-[length:var(--honk-glass-blur-floating)] transition-[scale,opacity,translate] duration-(--motion-duration-ui) ease-(--ease-shell) data-ending-style:-translate-y-3 data-ending-style:scale-[0.98] data-ending-style:opacity-0 data-starting-style:-translate-y-3 data-starting-style:scale-[0.98] data-starting-style:opacity-0 **:data-[slot=scroll-area-viewport]:data-has-overflow-y:pe-1",
            honkMenuPopupFontClasses,
            honkCommandPaletteChromeClasses,
            className,
          )}
          data-slot="command-dialog-popup"
          {...props}
        >
          {children}
        </CommandDialogPrimitive.Popup>
      </CommandDialogViewport>
    </CommandDialogPortal>
  );
}

function Command({
  autoHighlight = "always",
  keepHighlight = true,
  ...props
}: React.ComponentProps<typeof Autocomplete>) {
  return (
    <Autocomplete
      autoHighlight={autoHighlight}
      inline
      keepHighlight={keepHighlight}
      open
      {...props}
    />
  );
}

function CommandInput({
  className,
  wrapperClassName,
  placeholder,
  ...props
}: React.ComponentProps<typeof AutocompleteInput> & {
  wrapperClassName?: string | undefined;
}) {
  return (
    <div
      className={cn(
        "relative border-b border-honk-stroke-tertiary bg-transparent px-2 py-1",
        wrapperClassName,
      )}
    >
      <AutocompleteInput
        autoFocus
        className={cn(
          "border-transparent! bg-transparent! text-body shadow-none before:hidden has-focus-visible:ring-0",
          className,
        )}
        placeholder={placeholder}
        startAddon={commandSearchAddon}
        {...props}
      />
    </div>
  );
}

function CommandList({ className, ...props }: React.ComponentProps<typeof AutocompleteList>) {
  return (
    <AutocompleteList
      className={cn("not-empty:scroll-py-1.5 not-empty:p-1.5", className)}
      data-slot="command-list"
      {...props}
    />
  );
}

function CommandEmpty({ className, ...props }: React.ComponentProps<typeof AutocompleteEmpty>) {
  return (
    <AutocompleteEmpty
      className={cn("not-empty:py-6", className)}
      data-slot="command-empty"
      {...props}
    />
  );
}

function CommandPanel({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "relative min-h-0 bg-transparent **:data-[slot=scroll-area-scrollbar]:mt-2",
        className,
      )}
      {...props}
    />
  );
}

function CommandGroup({ className, ...props }: React.ComponentProps<typeof AutocompleteGroup>) {
  return <AutocompleteGroup className={className} data-slot="command-group" {...props} />;
}

function CommandGroupLabel({
  className,
  ...props
}: React.ComponentProps<typeof AutocompleteGroupLabel>) {
  return (
    <AutocompleteGroupLabel
      className={cn("px-2 py-1 text-caption text-honk-fg-tertiary", className)}
      data-slot="command-group-label"
      {...props}
    />
  );
}

function CommandCollection({ ...props }: React.ComponentProps<typeof AutocompleteCollection>) {
  return <AutocompleteCollection data-slot="command-collection" {...props} />;
}

function CommandItem({ className, ...props }: React.ComponentProps<typeof AutocompleteItem>) {
  return (
    <AutocompleteItem
      className={cn(
        "min-h-7 gap-2 rounded-[6px] px-2 py-1 text-honk-fg-primary transition-[background-color,color] hover:bg-honk-bg-quaternary data-highlighted:bg-honk-bg-tertiary data-selected:bg-honk-bg-tertiary [&_svg]:shrink-0 [&_svg]:text-honk-icon-tertiary [&[data-highlighted][data-selected]]:bg-honk-bg-tertiary",
        className,
      )}
      data-slot="command-item"
      {...props}
    />
  );
}

function CommandSeparator({
  className,
  ...props
}: React.ComponentProps<typeof AutocompleteSeparator>) {
  return (
    <AutocompleteSeparator
      className={cn(honkMenuSeparatorClasses, "last:hidden", className)}
      data-slot="command-separator"
      {...props}
    />
  );
}

function CommandShortcut({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      className={cn(
        "ms-auto inline-flex items-center gap-0.5 font-honk text-caption font-medium tracking-normal text-honk-fg-tertiary",
        className,
      )}
      data-slot="command-shortcut"
      {...props}
    />
  );
}

function CommandShortcutKey({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      className={cn(
        "inline-flex min-w-3 items-center justify-center rounded-[3px] bg-honk-bg-quinary px-1 leading-4 text-honk-fg-tertiary shadow-[inset_0_0_0_1px_var(--honk-stroke-tertiary)]",
        className,
      )}
      data-slot="command-shortcut-key"
      {...props}
    />
  );
}

function CommandFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex min-h-9 items-center justify-between gap-2 border-t border-honk-stroke-tertiary/70 bg-honk-bg-quinary/55 px-3 py-2 font-honk text-detail text-honk-fg-secondary",
        className,
      )}
      data-slot="command-footer"
      {...props}
    />
  );
}

export {
  CommandCreateHandle,
  Command,
  CommandCollection,
  CommandDialog,
  CommandDialogPopup,
  CommandDialogTrigger,
  CommandEmpty,
  CommandFooter,
  CommandGroup,
  CommandGroupLabel,
  CommandInput,
  CommandItem,
  CommandList,
  CommandPanel,
  CommandSeparator,
  CommandShortcut,
  CommandShortcutKey,
};
