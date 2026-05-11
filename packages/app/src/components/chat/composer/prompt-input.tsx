import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useMemo,
  type HTMLAttributes,
  type ReactNode,
} from "react";

import { cn } from "~/lib/utils";

export type PromptInputVariant = "expanded" | "compact";
export type PromptInputMenuPlacement =
  | "top"
  | "top-start"
  | "top-end"
  | "bottom"
  | "bottom-start"
  | "bottom-end";
export type PromptInputSlashMenuVariant = "default" | "glass";
export type PromptInputSlashMenuAnchor = "cursor" | "input-start";

export interface PromptInputContextValue {
  variant: PromptInputVariant;
  hasContent: boolean;
  hasImages: boolean;
  isDragging: boolean;
  isExpanded: boolean;
  isFocused: boolean;
  isMenuOpen: boolean;
  isRunning: boolean;
  modelPickerPlacement: PromptInputMenuPlacement;
  plusMenuPlacement: PromptInputMenuPlacement;
  setMenuOpen: (open: boolean) => void;
  slashMenuAnchor: PromptInputSlashMenuAnchor;
  slashMenuItemPrefix: string;
  slashMenuPlacement: PromptInputMenuPlacement;
  slashMenuVariant: PromptInputSlashMenuVariant;
  submitOnCmdEnter: boolean;
  onEscape: (() => void) | undefined;
  onStop: (() => void) | undefined;
  onSubmit: (() => void) | undefined;
}

const PromptInputContext = createContext<PromptInputContextValue | null>(null);

export function usePromptInputContext(): PromptInputContextValue {
  const value = useContext(PromptInputContext);
  if (!value) {
    throw new Error("usePromptInputContext must be used inside PromptInputRoot");
  }
  return value;
}

export interface PromptInputRootProps extends Omit<HTMLAttributes<HTMLDivElement>, "onSubmit"> {
  containerClassName?: string;
  containerProps?: HTMLAttributes<HTMLDivElement>;
  footerContent?: ReactNode;
  hasContent?: boolean;
  hasImages?: boolean;
  headerClassName?: string;
  headerContent?: ReactNode;
  headerContentVisible?: boolean;
  isDragging?: boolean;
  isExpanded?: boolean;
  isFocused?: boolean;
  isMenuOpen?: boolean;
  isRunning?: boolean;
  modelPickerPlacement?: PromptInputMenuPlacement;
  plusMenuPlacement?: PromptInputMenuPlacement;
  slashMenuAnchor?: PromptInputSlashMenuAnchor;
  slashMenuItemPrefix?: string;
  slashMenuPlacement?: PromptInputMenuPlacement;
  slashMenuVariant?: PromptInputSlashMenuVariant;
  submitOnCmdEnter?: boolean;
  variant?: PromptInputVariant;
  onEscape?: () => void;
  onMenuOpenChange?: (open: boolean) => void;
  onStop?: () => void;
  onSubmit?: () => void;
}

export const PromptInputRoot = forwardRef<HTMLDivElement, PromptInputRootProps>(
  function PromptInputRoot(props, ref) {
    const {
      children,
      className,
      containerClassName,
      containerProps,
      footerContent,
      hasContent = false,
      hasImages = false,
      headerClassName,
      headerContent,
      headerContentVisible = Boolean(headerContent),
      isDragging = false,
      isExpanded,
      isFocused = false,
      isMenuOpen = false,
      isRunning = false,
      modelPickerPlacement = "bottom-start",
      plusMenuPlacement = "bottom-start",
      slashMenuAnchor = "cursor",
      slashMenuItemPrefix = "/",
      slashMenuPlacement = "top-start",
      slashMenuVariant = "default",
      submitOnCmdEnter = false,
      variant = "expanded",
      onEscape,
      onMenuOpenChange,
      onStop,
      onSubmit,
      ...rootProps
    } = props;
    const { className: containerPropsClassName, ...restContainerProps } = containerProps ?? {};
    const hasVisibleHeader = Boolean(headerContent) && headerContentVisible;
    const resolvedIsExpanded =
      isExpanded ?? (variant === "expanded" || hasVisibleHeader || hasImages || isDragging);
    const setMenuOpen = useCallback(
      (open: boolean) => {
        onMenuOpenChange?.(open);
      },
      [onMenuOpenChange],
    );
    const contextValue = useMemo<PromptInputContextValue>(
      () => ({
        variant,
        hasContent,
        hasImages,
        isDragging,
        isExpanded: resolvedIsExpanded,
        isFocused,
        isMenuOpen,
        isRunning,
        modelPickerPlacement,
        plusMenuPlacement,
        setMenuOpen,
        slashMenuAnchor,
        slashMenuItemPrefix,
        slashMenuPlacement,
        slashMenuVariant,
        submitOnCmdEnter,
        onEscape,
        onStop,
        onSubmit,
      }),
      [
        hasContent,
        hasImages,
        isDragging,
        isFocused,
        isMenuOpen,
        isRunning,
        modelPickerPlacement,
        onEscape,
        onStop,
        onSubmit,
        plusMenuPlacement,
        resolvedIsExpanded,
        setMenuOpen,
        slashMenuAnchor,
        slashMenuItemPrefix,
        slashMenuPlacement,
        slashMenuVariant,
        submitOnCmdEnter,
        variant,
      ],
    );

    return (
      <PromptInputContext.Provider value={contextValue}>
        <div
          {...rootProps}
          ref={ref}
          className={cn("ui-prompt-input", className)}
          data-menu-open={isMenuOpen ? "" : undefined}
          data-running={isRunning ? "" : undefined}
          data-slash-menu-anchor={slashMenuAnchor}
          data-slash-menu-variant={slashMenuVariant}
          data-variant={variant}
        >
          {headerContent ? (
            <div
              className={cn("ui-prompt-input__header select-none", headerClassName)}
              data-visible={headerContentVisible ? "true" : "false"}
            >
              {headerContent}
            </div>
          ) : null}
          <div
            {...restContainerProps}
            className={cn(
              "ui-prompt-input__container select-none",
              containerClassName,
              containerPropsClassName,
            )}
            data-has-header={hasVisibleHeader ? "" : undefined}
            data-has-images={hasImages ? "" : undefined}
            data-dragging={isDragging ? "" : undefined}
            data-expanded={resolvedIsExpanded ? "" : undefined}
            data-model-picker-placement={modelPickerPlacement}
            data-plus-menu-placement={plusMenuPlacement}
            data-slash-menu-placement={slashMenuPlacement}
            data-variant={variant}
          >
            {children}
          </div>
          {footerContent ? <div className="ui-prompt-input__footer">{footerContent}</div> : null}
        </div>
      </PromptInputContext.Provider>
    );
  },
);

export const PromptInputToolbar = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function PromptInputToolbar({ className, ...props }, ref) {
    return <div {...props} ref={ref} className={cn("ui-prompt-input-toolbar", className)} />;
  },
);

export const PromptInputToolbarLeft = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function PromptInputToolbarLeft({ className, ...props }, ref) {
    return <div {...props} ref={ref} className={cn("ui-prompt-input-toolbar__left", className)} />;
  },
);

export const PromptInputToolbarRight = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function PromptInputToolbarRight({ className, ...props }, ref) {
    return <div {...props} ref={ref} className={cn("ui-prompt-input-toolbar__right", className)} />;
  },
);
