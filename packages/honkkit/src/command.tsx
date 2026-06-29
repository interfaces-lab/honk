"use client";

import { Autocomplete as AutocompletePrimitive } from "@base-ui/react/autocomplete";
import { Dialog as CommandDialogPrimitive } from "@base-ui/react/dialog";
import * as stylex from "@stylexjs/stylex";
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
  AutocompletePopup,
  AutocompleteSeparator,
} from "./autocomplete";
import {
  colorVars,
  motionVars,
  radiusVars,
  sizeDefaults,
  sizeVars,
  spacingVars,
  typographyVars,
} from "./theme/tokens.stylex";
import { mergeProps } from "./utils/mergeProps";
import { themeProps } from "./utils/themeProps";

/** Shared with `Input` size `sm` (`h-6`). Items size from this control height. */
const commandSearchControlHeight = sizeVars["--honk-kit-size-button"];
const commandSearchControlHeightVar = "--honk-command-search-control-height";
const commandSearchMetricsStyle = {
  [commandSearchControlHeightVar]: sizeDefaults["--honk-kit-size-button"],
} as React.CSSProperties;

type PropsObject = {
  className?: string;
  style?: React.CSSProperties | undefined;
  [key: string]: unknown;
};

function withCommandSearchMetrics(props: PropsObject): PropsObject {
  return {
    ...props,
    style: props.style
      ? { ...commandSearchMetricsStyle, ...props.style }
      : commandSearchMetricsStyle,
  };
}

type StatefulClassName<TState> = string | ((state: TState) => string | undefined) | undefined;
type StatefulStyle<TState> =
  | React.CSSProperties
  | ((state: TState) => React.CSSProperties | undefined)
  | undefined;

function mergeStatefulProps<TState>(
  base: PropsObject,
  className: StatefulClassName<TState>,
  style: StatefulStyle<TState>,
): {
  className?: StatefulClassName<TState>;
  style?: StatefulStyle<TState>;
} {
  const baseClassName = base.className;
  const mergedClassName =
    typeof className === "function"
      ? (state: TState) => cn(baseClassName, className(state))
      : cn(baseClassName, className);
  const mergedStyle =
    typeof style === "function"
      ? (state: TState) => {
          const stateStyle = style(state);
          return stateStyle && base.style
            ? { ...base.style, ...stateStyle }
            : (stateStyle ?? base.style);
        }
      : style && base.style
        ? { ...base.style, ...style }
        : (style ?? base.style);

  return {
    ...(mergedClassName ? { className: mergedClassName } : {}),
    ...(mergedStyle ? { style: mergedStyle } : {}),
  };
}

const styles = stylex.create({
  viewport: {
    alignItems: "flex-start",
    bottom: 0,
    display: "flex",
    justifyContent: "center",
    left: 0,
    overflow: "hidden",
    paddingBlockEnd: 8,
    paddingBlockStart: 72,
    paddingInline: 8,
    position: "fixed",
    right: 0,
    top: 0,
    zIndex: "var(--z-index-command-dialog-viewport)",
  },
  popup: {
    display: "flex",
    flexDirection: "column",
    maxHeight: "min(26rem, calc(100dvh - 5rem))",
    maxWidth: 720,
    minHeight: 0,
    minWidth: 0,
    overflow: "hidden",
    position: "relative",
    width: "calc(100vw - 1rem)",
  },
  inputShell: {
    backgroundColor: "transparent",
    borderBottomColor: "var(--honk-stroke-tertiary)",
    borderBottomStyle: "solid",
    borderBottomWidth: 1,
    paddingBlock: 6,
    paddingInline: 12,
    position: "relative",
  },
  input: {
    backgroundColor: "transparent",
    fontSize: 15,
    fontWeight: 400,
  },
  list: {
    paddingBlock: 4,
    scrollBehavior: "smooth",
    scrollPaddingBlock: 4,
  },
  panel: {
    backgroundColor: "transparent",
    display: "flex",
    flex: "1 1 auto",
    flexDirection: "column",
    maxHeight: "min(20rem, 56vh)",
    minHeight: 0,
    overflow: "hidden",
    position: "relative",
  },
  groupLabel: {
    alignItems: "center",
    display: "flex",
    fontSize: 14,
    fontWeight: 500,
    lineHeight: 1,
    minHeight: 32,
    paddingInline: 12,
    userSelect: "none",
  },
  item: {
    borderRadius: 0,
    fontSize: 14,
    fontWeight: 400,
    gap: 8,
    lineHeight: 1.25,
    minHeight: 34,
    paddingBlock: 6,
    paddingInline: 24,
  },
  shortcut: {
    fontSize: 12,
    fontWeight: 400,
  },
  searchInputRoot: {
    width: "100%",
  },
  searchInputControl: {
    borderRadius: radiusVars["--honk-kit-radius-full"],
    height: `var(${commandSearchControlHeightVar}, 24px)`,
    minHeight: `var(${commandSearchControlHeightVar}, 24px)`,
  },
  searchPopup: {
    borderRadius: "var(--honk-radius-xl, 12px)",
    padding: spacingVars["--honk-kit-spacing-1"],
  },
  searchList: {
    display: "flex",
    flexDirection: "column",
    gap: "var(--honk-spacing-0-75)",
    padding: "var(--honk-spacing-0-75)",
  },
  searchItem: {
    borderRadius: radiusVars["--honk-kit-radius-control"],
    cursor: "default",
    display: "flex",
    flexDirection: "column",
    gap: "var(--honk-spacing-0-5)",
    justifyContent: "center",
    minHeight: `calc(var(${commandSearchControlHeightVar}, 24px) + var(--honk-spacing-5))`,
    minWidth: 0,
    outline: "none",
    paddingBlock: spacingVars["--honk-kit-spacing-1-5"],
    paddingInline: spacingVars["--honk-kit-spacing-2"],
    transitionDuration: motionVars["--honk-kit-motion-duration-ui"],
    transitionProperty: "background-color, color",
    transitionTimingFunction: motionVars["--honk-kit-motion-ease-shell"],
    userSelect: "none",
    width: "100%",
  },
  searchItemContent: {
    display: "flex",
    flexDirection: "column",
    gap: "var(--honk-spacing-0-5)",
    minWidth: 0,
    width: "100%",
  },
  searchItemTitle: {
    color: colorVars["--honk-kit-color-fg-primary"],
    fontFamily: typographyVars["--honk-kit-font-ui"],
    fontSize: typographyVars["--honk-kit-text-body"],
    fontWeight: 400,
    lineHeight: typographyVars["--honk-kit-leading-body"],
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  searchItemDescription: {
    color: colorVars["--honk-kit-color-fg-secondary"],
    fontFamily: typographyVars["--honk-kit-font-ui"],
    fontSize: typographyVars["--honk-kit-text-detail"],
    fontWeight: 400,
    lineHeight: typographyVars["--honk-kit-leading-detail"],
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
});

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

function CommandDialogViewport({
  className,
  style,
  ...props
}: CommandDialogPrimitive.Viewport.Props) {
  return (
    <CommandDialogPrimitive.Viewport
      {...mergeStatefulProps(
        mergeProps(
          "fixed inset-0 z-(--z-index-command-dialog-viewport) flex items-start justify-center overflow-hidden px-2 pb-2 pt-[72px]",
          stylex.props(styles.viewport),
        ),
        className,
        style,
      )}
      data-slot="command-dialog-viewport"
      {...props}
    />
  );
}

function CommandDialogPopup({
  className,
  children,
  style,
  ...props
}: CommandDialogPrimitive.Popup.Props) {
  return (
    <CommandDialogPortal>
      <CommandDialogBackdrop />
      <CommandDialogViewport>
        <CommandDialogPrimitive.Popup
          {...mergeStatefulProps(
            mergeProps(
              cn(
                "relative flex max-h-[min(26rem,calc(100dvh-5rem))] min-h-0 w-[calc(100vw-1rem)] min-w-0 max-w-[720px] flex-col overflow-hidden rounded-honk-xl bg-(--honk-command-palette-surface-background) backdrop-blur-[length:var(--honk-glass-blur-floating)] transition-[scale,opacity,translate] duration-(--motion-duration-ui) ease-(--ease-shell) data-ending-style:-translate-y-4 data-ending-style:scale-[0.98] data-ending-style:opacity-0 data-starting-style:-translate-y-4 data-starting-style:scale-[0.98] data-starting-style:opacity-0 **:data-[slot=scroll-area-viewport]:data-has-overflow-y:pe-1",
                honkMenuPopupFontClasses,
                honkCommandPaletteChromeClasses,
              ),
              stylex.props(styles.popup),
            ),
            className,
            style,
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
  style,
  ...props
}: React.ComponentProps<typeof AutocompleteInput> & {
  wrapperClassName?: string | undefined;
}) {
  return (
    <div
      {...mergeProps(
        "relative border-b border-honk-stroke-tertiary bg-transparent px-3 py-1.5",
        stylex.props(styles.inputShell),
        wrapperClassName,
      )}
    >
      <AutocompleteInput
        autoFocus
        {...mergeStatefulProps(
          mergeProps(
            "border-transparent! bg-transparent! text-[15px] font-normal shadow-none before:hidden has-focus-visible:ring-0",
            stylex.props(styles.input),
          ),
          className,
          style,
        )}
        placeholder={placeholder}
        {...props}
      />
    </div>
  );
}

function CommandList({
  className,
  style,
  ...props
}: React.ComponentProps<typeof AutocompleteList>) {
  return (
    <AutocompleteList
      {...mergeStatefulProps(stylex.props(styles.list), className, style)}
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

function CommandPanel({ className, style, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      {...mergeProps(
        "**:data-[slot=scroll-area-scrollbar]:mt-2 **:data-[slot=scroll-area-viewport]:scroll-smooth",
        stylex.props(styles.panel),
        className,
        style,
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
  style,
  ...props
}: React.ComponentProps<typeof AutocompleteGroupLabel>) {
  return (
    <AutocompleteGroupLabel
      {...mergeStatefulProps(
        mergeProps("text-honk-fg-tertiary", stylex.props(styles.groupLabel)),
        className,
        style,
      )}
      data-slot="command-group-label"
      {...props}
    />
  );
}

function CommandCollection({ ...props }: React.ComponentProps<typeof AutocompleteCollection>) {
  return <AutocompleteCollection data-slot="command-collection" {...props} />;
}

function CommandItem({
  className,
  style,
  ...props
}: React.ComponentProps<typeof AutocompleteItem>) {
  return (
    <AutocompleteItem
      {...mergeStatefulProps(
        mergeProps(
          "text-honk-fg-primary transition-[background-color,color] hover:bg-honk-bg-quaternary data-highlighted:bg-honk-bg-tertiary data-selected:bg-honk-bg-tertiary [&_svg]:shrink-0 [&_svg]:text-honk-icon-tertiary [&[data-highlighted][data-selected]]:bg-honk-bg-tertiary",
          stylex.props(styles.item),
        ),
        className,
        style,
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

function CommandShortcut({ className, style, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      {...mergeProps(
        "ms-auto inline-flex items-center gap-0.5 font-honk tracking-normal text-honk-fg-tertiary",
        stylex.props(styles.shortcut),
        className,
        style,
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

function CommandSearchInput({
  className,
  size = "sm",
  style,
  wrapperClassName,
  xstyle,
  ...props
}: React.ComponentProps<typeof AutocompleteInput> & {
  wrapperClassName?: string | undefined;
  xstyle?: stylex.StyleXStyles;
}) {
  const mergedRoot = withCommandSearchMetrics(
    mergeProps(
      themeProps("command-search-input"),
      stylex.props(styles.searchInputRoot, xstyle),
      wrapperClassName,
    ),
  );

  return (
    <div {...mergedRoot}>
      <AutocompleteInput
        size={size}
        {...mergeStatefulProps(
          mergeProps(
            "*:data-[slot=input-control]:rounded-full *:data-[slot=input-control]:shadow-none",
            stylex.props(styles.searchInputControl),
          ),
          className,
          style,
        )}
        {...props}
      />
    </div>
  );
}

function CommandSearchPopup({
  className,
  style,
  xstyle,
  ...props
}: React.ComponentProps<typeof AutocompletePopup> & {
  xstyle?: stylex.StyleXStyles;
}) {
  return (
    <AutocompletePopup
      {...mergeStatefulProps(
        withCommandSearchMetrics(
          mergeProps(
            "min-w-(--anchor-width) max-w-(--available-width)",
            stylex.props(styles.searchPopup, xstyle),
          ),
        ),
        className,
        style,
      )}
      data-slot="command-search-popup"
      {...props}
    />
  );
}

function CommandSearchList({
  className,
  style,
  xstyle,
  ...props
}: React.ComponentProps<typeof AutocompleteList> & {
  xstyle?: stylex.StyleXStyles;
}) {
  return (
    <AutocompleteList
      {...mergeStatefulProps(stylex.props(styles.searchList, xstyle), className, style)}
      data-slot="command-search-list"
      {...props}
    />
  );
}

type CommandSearchItemProps = AutocompletePrimitive.Item.Props & {
  description?: React.ReactNode;
  title?: React.ReactNode;
  xstyle?: stylex.StyleXStyles;
};

function CommandSearchItem({
  children,
  className,
  description,
  style,
  title,
  xstyle,
  ...props
}: CommandSearchItemProps) {
  return (
    <AutocompletePrimitive.Item
      {...mergeStatefulProps(
        mergeProps(
          themeProps("command-search-item"),
          stylex.props(styles.searchItem, xstyle),
          "text-honk-fg-primary outline-none transition-[background-color,color] hover:bg-honk-bg-quaternary data-disabled:pointer-events-none data-disabled:opacity-40 data-highlighted:bg-honk-bg-tertiary data-selected:bg-honk-bg-tertiary [&[data-highlighted][data-selected]]:bg-honk-bg-tertiary",
        ),
        className,
        style,
      )}
      data-slot="command-search-item"
      {...props}
    >
      {children ?? (
        <span {...stylex.props(styles.searchItemContent)}>
          {title != null ? <span {...stylex.props(styles.searchItemTitle)}>{title}</span> : null}
          {description != null ? (
            <span {...stylex.props(styles.searchItemDescription)}>{description}</span>
          ) : null}
        </span>
      )}
    </AutocompletePrimitive.Item>
  );
}

function CommandSearchEmpty({
  className,
  ...props
}: React.ComponentProps<typeof AutocompleteEmpty>) {
  return (
    <AutocompleteEmpty
      className={cn("px-2 py-3 text-detail text-honk-fg-tertiary", className)}
      data-slot="command-search-empty"
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
  CommandSearchEmpty,
  CommandSearchInput,
  CommandSearchItem,
  CommandSearchList,
  CommandSearchPopup,
  CommandSeparator,
  CommandShortcut,
  CommandShortcutKey,
};
export type { CommandSearchItemProps };
