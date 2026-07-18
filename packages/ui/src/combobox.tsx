import { Combobox as Base } from "@base-ui/react/combobox";
import * as stylex from "@stylexjs/stylex";
import * as React from "react";

import { Icon } from "./icon";
import { IconCheckmark1, IconChevronDownMedium, IconMagnifyingGlass } from "./icons";
import {
  colorVars,
  controlVars,
  elevationVars,
  fontVars,
  motionVars,
  radiusVars,
  spaceVars,
  zVars,
} from "./tokens.stylex";

type ComboboxSize = "sm" | "md";
type ComboboxTone = "neutral" | "quiet";
type ComboboxPopupWidth = "trigger" | "wide";

interface ComboboxOption {
  readonly value: string;
  readonly label: string;
  readonly description?: string;
  readonly leading?: React.ReactNode;
  readonly metadata?: React.ReactNode;
  readonly keywords?: readonly string[];
  readonly disabled?: boolean;
}

interface ComboboxGroup {
  readonly label: string;
  readonly options: readonly ComboboxOption[];
  readonly pinned?: boolean;
}

interface ComboboxAction {
  readonly label: string;
  readonly leading?: React.ReactNode;
  readonly disabled?: boolean;
  readonly onSelect: () => void;
}

interface ComboboxProps {
  readonly value: string | null;
  readonly onValueChange: (value: string) => void;
  readonly groups: readonly ComboboxGroup[];
  readonly children: React.ReactNode;
  readonly accessibilityLabel: string;
  readonly searchPlaceholder: string;
  readonly emptyLabel?: string;
  readonly noMatchesLabel?: string;
  readonly status?: string;
  readonly actions?: readonly ComboboxAction[];
  readonly disabled?: boolean;
  readonly size?: ComboboxSize;
  readonly tone?: ComboboxTone;
  readonly title?: string;
  readonly width?: ComboboxPopupWidth;
  readonly side?: "top" | "bottom";
  readonly align?: "start" | "center" | "end";
  readonly onOpenChange?: (open: boolean) => void;
  readonly onOpenChangeComplete?: (open: boolean) => void;
}

const COMBOBOX_GUTTER = 4;
// The list, rather than the whole popup, scrolls so search, pinned choices, and actions remain fixed.
const COMBOBOX_POPUP_MAX_HEIGHT = "min(360px, var(--available-height))";
const POPUP_RING = `inset 0 0 0 1px ${colorVars["--honk-color-border-muted"]}`;
const SECTION_DIVIDER = `inset 0 -1px 0 ${colorVars["--honk-color-border-muted"]}`;
const SECTION_DIVIDER_TOP = `inset 0 1px 0 ${colorVars["--honk-color-border-muted"]}`;
const SECTION_DIVIDER_FOCUS = `inset 0 -1px 0 ${colorVars["--honk-color-accent"]}`;

const sx = stylex.create({
  trigger: {
    appearance: "none",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "space-between",
    maxWidth: controlVars["--honk-control-picker-max-w"],
    gap: controlVars["--honk-control-gap"],
    boxSizing: "border-box",
    borderStyle: "none",
    borderRadius: radiusVars["--honk-radius-control"],
    paddingInline: controlVars["--honk-control-pad-md"],
    color: colorVars["--honk-color-text-primary"],
    fontFamily: fontVars["--honk-font-family-ui"],
    fontSize: fontVars["--honk-font-size-body"],
    fontWeight: fontVars["--honk-font-weight-regular"],
    lineHeight: 1,
    whiteSpace: "nowrap",
    cursor: { default: "pointer", ":disabled": "default" },
    outlineColor: colorVars["--honk-color-accent"],
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineWidth: controlVars["--honk-control-focus-ring-width"],
    outlineOffset: controlVars["--honk-control-focus-ring-offset"],
    opacity: { default: 1, ":disabled": controlVars["--honk-control-disabled-opacity"] },
    transitionProperty: "background-color, color, opacity",
    transitionDuration: {
      default: motionVars["--honk-motion-duration-hover"],
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: motionVars["--honk-motion-ease-out"],
  },
  triggerNeutral: {
    backgroundColor: {
      default: colorVars["--honk-color-control"],
      ":hover": {
        "@media (hover: hover)": colorVars["--honk-color-control-hover"],
      },
      ":active": colorVars["--honk-color-control-press"],
      "[data-popup-open]": colorVars["--honk-color-control-open"],
    },
  },
  triggerQuiet: {
    backgroundColor: {
      default: "transparent",
      ":hover": {
        "@media (hover: hover)": colorVars["--honk-color-state-hover"],
      },
      ":active": colorVars["--honk-color-state-press"],
      "[data-popup-open]": colorVars["--honk-color-state-hover"],
    },
  },
  triggerSm: { height: controlVars["--honk-control-h-sm"] },
  triggerMd: { height: controlVars["--honk-control-h-md"] },
  triggerContent: {
    display: "inline-flex",
    alignItems: "center",
    minWidth: 0,
    gap: controlVars["--honk-control-gap"],
    overflow: "hidden",
    textOverflow: "ellipsis",
  },
  triggerChevron: {
    display: "inline-flex",
    flexShrink: 0,
    color: colorVars["--honk-color-text-muted"],
  },
  positioner: {
    zIndex: zVars["--honk-z-menu"],
    minWidth: "var(--anchor-width)",
    maxWidth: "var(--available-width)",
  },
  popup: {
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    minWidth: controlVars["--honk-control-picker-min-w"],
    maxWidth: controlVars["--honk-control-picker-max-w"],
    maxHeight: COMBOBOX_POPUP_MAX_HEIGHT,
    borderRadius: radiusVars["--honk-radius-window"],
    backgroundColor: colorVars["--honk-color-bg-base"],
    boxShadow: `${elevationVars["--honk-elevation-floating"]}, ${POPUP_RING}`,
    color: colorVars["--honk-color-text-primary"],
    fontFamily: fontVars["--honk-font-family-ui"],
    fontSize: fontVars["--honk-font-size-body"],
    outline: "none",
    overflow: "hidden",
    transformOrigin: "var(--transform-origin)",
    opacity: {
      default: 1,
      "[data-starting-style]": 0,
      "[data-ending-style]": 0,
    },
    scale: {
      default: 1,
      "[data-starting-style]": motionVars["--honk-motion-scale-overlay"],
      "[data-ending-style]": motionVars["--honk-motion-scale-overlay"],
      "@media (prefers-reduced-motion: reduce)": 1,
    },
    transitionProperty: "opacity, scale",
    transitionTimingFunction: motionVars["--honk-motion-ease-out"],
    transitionDuration: {
      default: motionVars["--honk-motion-duration-fast"],
      "[data-ending-style]": motionVars["--honk-motion-duration-instant"],
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
  },
  popupTriggerWidth: { width: "var(--anchor-width)" },
  popupWide: { width: controlVars["--honk-control-picker-max-w"] },
  search: {
    display: "flex",
    alignItems: "center",
    flexShrink: 0,
    gap: controlVars["--honk-control-gap"],
    height: controlVars["--honk-control-h-md"],
    paddingInline: controlVars["--honk-control-pad-md"],
    color: colorVars["--honk-color-text-muted"],
    boxShadow: {
      default: SECTION_DIVIDER,
      ":focus-within": SECTION_DIVIDER_FOCUS,
    },
  },
  input: {
    boxSizing: "border-box",
    minWidth: 0,
    flexGrow: 1,
    height: "100%",
    borderStyle: "none",
    padding: 0,
    backgroundColor: "transparent",
    color: colorVars["--honk-color-text-primary"],
    fontFamily: fontVars["--honk-font-family-ui"],
    fontSize: fontVars["--honk-font-size-body"],
    outline: "none",
    "::placeholder": { color: colorVars["--honk-color-text-faint"] },
  },
  list: {
    minHeight: 0,
    flexGrow: 1,
    display: "flex",
    flexDirection: "column",
    outline: "none",
  },
  pinned: {
    flexShrink: 0,
    paddingBlock: spaceVars["--honk-space-gutter"],
    boxShadow: SECTION_DIVIDER,
  },
  scroller: {
    minHeight: 0,
    flexGrow: 1,
    overflowY: "auto",
    overscrollBehavior: "contain",
    paddingBlock: spaceVars["--honk-space-gutter"],
    scrollbarWidth: "thin",
  },
  option: {
    display: "flex",
    alignItems: "center",
    gap: controlVars["--honk-control-gap"],
    boxSizing: "border-box",
    minHeight: controlVars["--honk-control-h-md"],
    paddingInline: controlVars["--honk-control-pad-md"],
    borderRadius: radiusVars["--honk-radius-control"],
    color: colorVars["--honk-color-text-primary"],
    lineHeight: 1,
    userSelect: "none",
    outline: "none",
    cursor: { default: "pointer", "[data-disabled]": "default" },
    backgroundColor: {
      default: "transparent",
      "[data-highlighted]": colorVars["--honk-color-state-hover"],
      "[data-selected]": colorVars["--honk-color-control-selected"],
    },
    opacity: {
      default: 1,
      "[data-disabled]": controlVars["--honk-control-disabled-opacity"],
    },
  },
  optionRich: { minHeight: controlVars["--honk-control-picker-rich-min-h"] },
  optionLeading: {
    display: "grid",
    placeItems: "center",
    flexShrink: 0,
  },
  optionContent: {
    display: "flex",
    minWidth: 0,
    flexGrow: 1,
    flexDirection: "column",
    gap: controlVars["--honk-control-gap"],
  },
  optionLabel: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontWeight: fontVars["--honk-font-weight-regular"],
  },
  optionDescription: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: colorVars["--honk-color-text-muted"],
    fontSize: fontVars["--honk-font-size-detail"],
  },
  optionMetadata: {
    flexShrink: 0,
    color: colorVars["--honk-color-text-muted"],
    fontSize: fontVars["--honk-font-size-detail"],
  },
  indicator: {
    display: "inline-flex",
    flexShrink: 0,
    color: colorVars["--honk-color-accent"],
  },
  groupLabel: {
    paddingInline: controlVars["--honk-control-pad-md"],
    paddingBlock: controlVars["--honk-control-gap"],
    color: colorVars["--honk-color-text-muted"],
    fontSize: fontVars["--honk-font-size-caption"],
    fontWeight: fontVars["--honk-font-weight-regular"],
    userSelect: "none",
  },
  message: {
    paddingInline: controlVars["--honk-control-pad-md"],
    paddingBlock: spaceVars["--honk-space-gutter"],
    color: colorVars["--honk-color-text-muted"],
    fontSize: fontVars["--honk-font-size-detail"],
    textAlign: "center",
  },
  actions: {
    flexShrink: 0,
    padding: spaceVars["--honk-space-gutter"],
    boxShadow: SECTION_DIVIDER_TOP,
  },
  action: {
    appearance: "none",
    width: "100%",
    height: controlVars["--honk-control-h-md"],
    display: "flex",
    alignItems: "center",
    gap: controlVars["--honk-control-gap"],
    boxSizing: "border-box",
    borderStyle: "none",
    borderRadius: radiusVars["--honk-radius-control"],
    paddingInline: controlVars["--honk-control-pad-md"],
    backgroundColor: {
      default: "transparent",
      ":hover": { "@media (hover: hover)": colorVars["--honk-color-state-hover"] },
      ":active": colorVars["--honk-color-state-press"],
    },
    color: colorVars["--honk-color-text-primary"],
    fontFamily: fontVars["--honk-font-family-ui"],
    fontSize: fontVars["--honk-font-size-body"],
    textAlign: "start",
    cursor: { default: "pointer", ":disabled": "default" },
    outlineColor: colorVars["--honk-color-accent"],
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineWidth: controlVars["--honk-control-focus-ring-width"],
    outlineOffset: controlVars["--honk-control-focus-ring-offset"],
    opacity: { default: 1, ":disabled": controlVars["--honk-control-disabled-opacity"] },
  },
});

const triggerSizeStyles: Record<ComboboxSize, stylex.StyleXStyles> = {
  sm: sx.triggerSm,
  md: sx.triggerMd,
};

function optionMatches(
  option: ComboboxOption,
  query: string,
  contains: (value: string, query: string) => boolean,
): boolean {
  const candidateValues = [
    option.label,
    option.description,
    option.value,
    ...(option.keywords ?? []),
  ];
  return candidateValues.some((candidate) => candidate !== undefined && contains(candidate, query));
}

function ComboboxOptionRow({ option }: { readonly option: ComboboxOption }): React.ReactElement {
  return (
    <Base.Item
      value={option.value}
      disabled={option.disabled}
      data-slot="combobox-option"
      {...stylex.props(sx.option, option.description !== undefined && sx.optionRich)}
    >
      {option.leading === undefined ? null : (
        <span {...stylex.props(sx.optionLeading)}>{option.leading}</span>
      )}
      <span {...stylex.props(sx.optionContent)}>
        <span {...stylex.props(sx.optionLabel)}>{option.label}</span>
        {option.description === undefined ? null : (
          <span {...stylex.props(sx.optionDescription)}>{option.description}</span>
        )}
      </span>
      {option.metadata === undefined ? null : (
        <span {...stylex.props(sx.optionMetadata)}>{option.metadata}</span>
      )}
      <Base.ItemIndicator {...stylex.props(sx.indicator)}>
        <Icon icon={IconCheckmark1} size="xs" />
      </Base.ItemIndicator>
    </Base.Item>
  );
}

function ComboboxOptionGroup({ group }: { readonly group: ComboboxGroup }): React.ReactElement {
  return (
    <Base.Group>
      <Base.GroupLabel {...stylex.props(sx.groupLabel)}>{group.label}</Base.GroupLabel>
      {group.options.map((option) => (
        <ComboboxOptionRow key={option.value} option={option} />
      ))}
    </Base.Group>
  );
}

function Combobox({
  value,
  onValueChange,
  groups,
  children,
  accessibilityLabel,
  searchPlaceholder,
  emptyLabel = "No matching options.",
  noMatchesLabel = "No matching options.",
  status,
  actions = [],
  disabled,
  size = "md",
  tone = "neutral",
  title,
  width = "trigger",
  side = "bottom",
  align = "start",
  onOpenChange,
  onOpenChangeComplete,
}: ComboboxProps): React.ReactElement {
  const { contains } = Base.useFilter();
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const optionByValue = new Map(
    groups.flatMap((group) => group.options.map((option) => [option.value, option] as const)),
  );
  const allValues = groups.flatMap((group) => group.options.map((option) => option.value));
  const search = query.trim();
  const filteredGroups = groups
    .map((group) => ({
      ...group,
      options:
        group.pinned === true || search.length === 0
          ? group.options
          : group.options.filter((option) => optionMatches(option, search, contains)),
    }))
    .filter((group) => group.options.length > 0);
  const filteredValues = filteredGroups.flatMap((group) =>
    group.options.map((option) => option.value),
  );
  const pinnedGroups = filteredGroups.filter((group) => group.pinned === true);
  const scrollingGroups = filteredGroups.filter((group) => group.pinned !== true);
  const emptyMessage = search.length === 0 ? emptyLabel : noMatchesLabel;
  const listStatus =
    status ?? (pinnedGroups.length > 0 && scrollingGroups.length === 0 ? emptyMessage : undefined);

  return (
    <Base.Root
      value={value}
      items={allValues}
      filteredItems={filteredValues}
      filter={null}
      inputValue={query}
      open={open}
      disabled={disabled}
      itemToStringLabel={(itemValue) => optionByValue.get(itemValue)?.label ?? itemValue}
      onInputValueChange={setQuery}
      onValueChange={(nextValue) => {
        if (nextValue !== null) onValueChange(nextValue);
      }}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) setQuery("");
        onOpenChange?.(nextOpen);
      }}
      onOpenChangeComplete={onOpenChangeComplete}
    >
      <Base.Trigger
        aria-label={accessibilityLabel}
        title={title}
        data-slot="combobox-trigger"
        {...stylex.props(
          sx.trigger,
          triggerSizeStyles[size],
          tone === "neutral" ? sx.triggerNeutral : sx.triggerQuiet,
        )}
      >
        <span {...stylex.props(sx.triggerContent)}>{children}</span>
        <Base.Icon {...stylex.props(sx.triggerChevron)}>
          <Icon icon={IconChevronDownMedium} size="sm" />
        </Base.Icon>
      </Base.Trigger>
      <Base.Portal>
        <Base.Positioner
          side={side}
          align={align}
          sideOffset={COMBOBOX_GUTTER}
          {...stylex.props(sx.positioner)}
        >
          <Base.Popup
            aria-label={accessibilityLabel}
            data-slot="combobox-popup"
            {...stylex.props(sx.popup, width === "wide" ? sx.popupWide : sx.popupTriggerWidth)}
          >
            <div {...stylex.props(sx.search)}>
              <Icon icon={IconMagnifyingGlass} size="sm" tone="muted" />
              <Base.Input
                aria-label={searchPlaceholder}
                placeholder={searchPlaceholder}
                {...stylex.props(sx.input)}
              />
            </div>
            <Base.List {...stylex.props(sx.list)}>
              {pinnedGroups.length === 0 ? null : (
                <div {...stylex.props(sx.pinned)}>
                  {pinnedGroups.map((group, index) => (
                    <ComboboxOptionGroup key={`${group.label}:${index}`} group={group} />
                  ))}
                </div>
              )}
              <div {...stylex.props(sx.scroller)}>
                <Base.Status>
                  {listStatus === undefined ? null : (
                    <div {...stylex.props(sx.message)}>{listStatus}</div>
                  )}
                </Base.Status>
                <Base.Empty>
                  {status === undefined ? (
                    <div {...stylex.props(sx.message)}>{emptyMessage}</div>
                  ) : null}
                </Base.Empty>
                {scrollingGroups.map((group, index) => (
                  <ComboboxOptionGroup key={`${group.label}:${index}`} group={group} />
                ))}
              </div>
            </Base.List>
            {actions.length === 0 ? null : (
              <div {...stylex.props(sx.actions)}>
                {actions.map((action, index) => (
                  <button
                    key={`${action.label}:${index}`}
                    type="button"
                    disabled={action.disabled}
                    data-slot="combobox-action"
                    {...stylex.props(sx.action)}
                    onClick={() => {
                      setOpen(false);
                      setQuery("");
                      onOpenChange?.(false);
                      action.onSelect();
                    }}
                  >
                    {action.leading}
                    <span>{action.label}</span>
                  </button>
                ))}
              </div>
            )}
          </Base.Popup>
        </Base.Positioner>
      </Base.Portal>
    </Base.Root>
  );
}

export { Combobox };
export type {
  ComboboxAction,
  ComboboxGroup,
  ComboboxOption,
  ComboboxPopupWidth,
  ComboboxProps,
  ComboboxSize,
  ComboboxTone,
};
