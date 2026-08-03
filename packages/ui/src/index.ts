// StyleX unplugin requires defineVars imports from a path ending in `.stylex.ts` / `.stylex.js`.
// Author StyleX styles via `@honk/ui/tokens.stylex`, not this barrel.
export {
  colorDefaults,
  colorVars,
  controlDefaults,
  controlVars,
  conversationDefaults,
  conversationVars,
  elevationDefaults,
  elevationVars,
  fontDefaults,
  fontVars,
  iconDefaults,
  iconVars,
  motionDefaults,
  motionVars,
  proseDefaults,
  proseVars,
  radiusDefaults,
  radiusVars,
  shellDefaults,
  shellVars,
  sidebarDefaults,
  sidebarVars,
  spaceDefaults,
  spaceVars,
  toastDefaults,
  toastVars,
  zDefaults,
  zVars,
} from "./tokens.stylex";
export type {
  ColorVarName,
  ControlVarName,
  ConversationVarName,
  ElevationVarName,
  FontVarName,
  IconVarName,
  MotionVarName,
  ProseVarName,
  RadiusVarName,
  ShellVarName,
  SidebarVarName,
  SpaceVarName,
  ToastVarName,
  ZVarName,
} from "./tokens.stylex";

export { Matrix } from "./matrix";
export type { MatrixProps, MatrixVariant } from "./matrix";

export { Text } from "./text";
export type {
  TextAlign,
  TextElement,
  TextFamily,
  TextProps,
  TextSize,
  TextTone,
  TextWeight,
} from "./text";

export { Prose } from "./prose";
export type {
  ProseBlockquoteProps,
  ProseCodeBlockProps,
  ProseHeadingLevel,
  ProseHeadingProps,
  ProseImageProps,
  ProseInlineCodeProps,
  ProseLinkProps,
  ProseListItemProps,
  ProseListProps,
  ProseParagraphProps,
  ProseRootProps,
  ProseRuleProps,
  ProseStrongProps,
  ProseTableDataProps,
  ProseTableHeaderProps,
  ProseTableProps,
} from "./prose";

// Glyph set lives on `@honk/ui/icons`. Only the Icon leaf is on the root.
export { Icon } from "./icon";
export type { Glyph, IconProps, IconSize, IconTone } from "./icon";
export { FileTypeIcon, FileTypeIconSprite } from "./file-type-icon";

export { StatusDot } from "./status-dot";
export type { StatusDotProps, StatusDotTone } from "./status-dot";

export { Separator } from "./separator";
export type { SeparatorProps, SeparatorTone } from "./separator";

export { Spinner } from "./spinner";
export type { SpinnerProps, SpinnerSize, SpinnerTone } from "./spinner";

export { Kbd } from "./kbd";
export type { KbdProps, KbdSize } from "./kbd";

export { Button, IconButton } from "./button";
export type { ButtonProps, ButtonSize, ButtonVariant, IconButtonProps } from "./button";

export { SegmentedControl } from "./segmented-control";
export type {
  SegmentedControlOption,
  SegmentedControlProps,
  SegmentedControlSize,
} from "./segmented-control";

export { Badge } from "./badge";
export type { BadgeProps, BadgeSize, BadgeTone } from "./badge";
export { Pill, PillButton } from "./pill";
export type { PillButtonDensity, PillButtonProps, PillProps, PillSize, PillTone } from "./pill";

export { Field } from "./field";
export type { FieldInputProps, FieldProps, FieldSize } from "./field";

export { ListRow } from "./list-row";
export type { ListRowActionProps, ListRowPieceProps, ListRowProps, ListRowSize } from "./list-row";

export { WorkbenchRailRow } from "./workbench-rail";
export type { WorkbenchRailLabelProps, WorkbenchRailRowProps } from "./workbench-rail";

export { Picker } from "./picker";
export type {
  PickerGroupLabelProps,
  PickerGroupProps,
  PickerOptionProps,
  PickerPopupProps,
  PickerPopupWidth,
  PickerRootProps,
  PickerSize,
  PickerTone,
  PickerTriggerProps,
} from "./picker";

export { PreviewPicker } from "./preview-picker";
export type { PreviewPickerOption, PreviewPickerProps } from "./preview-picker";

export { Combobox } from "./combobox";
export type {
  ComboboxAction,
  ComboboxGroup,
  ComboboxOption,
  ComboboxPopupLayer,
  ComboboxPopupWidth,
  ComboboxProps,
  ComboboxSize,
  ComboboxTone,
} from "./combobox";

export { Switch } from "./switch";
export type { SwitchProps, SwitchSize } from "./switch";
export { Checkbox } from "./checkbox";
export type { CheckboxProps, CheckboxSize } from "./checkbox";

export { SessionTabPreviewProvider, SessionTabPreviewTooltip, TabStrip } from "./tabs";
export type { SessionTabPreviewTooltipProps, TabDescriptor } from "./tabs";

export { Shell } from "./shell";
export type { ShellSlotProps, TitleBarProps } from "./shell";

export { Tray } from "./tray";
export type { TrayFooterProps, TrayHeaderProps, TrayRootProps, TrayScrollAreaProps } from "./tray";

export { AnchoredTooltip, Tooltip, TooltipProvider, tooltipPopupStyles } from "./tooltip";
export type { AnchoredTooltipProps, TooltipAnchor, TooltipProps } from "./tooltip";

export { Popover } from "./popover";
export type { PopoverDescriptionProps, PopoverPopupProps, PopoverTitleProps } from "./popover";
export { PreviewCard } from "./preview-card";
export type { PreviewCardPopupProps, PreviewCardTriggerProps } from "./preview-card";
export { ContextMenu, Menu } from "./menu";
export type {
  ContextMenuItemProps,
  ContextMenuPopupProps,
  ContextMenuSeparatorProps,
  MenuCheckboxItemIndicatorProps,
  MenuCheckboxItemProps,
  MenuGroupLabelProps,
  MenuItemIconProps,
  MenuItemMetaProps,
  MenuItemProps,
  MenuPopupProps,
  MenuSeparatorProps,
} from "./menu";

export { Dialog } from "./dialog";
export type {
  DialogDescriptionProps,
  DialogFooterProps,
  DialogHeaderProps,
  DialogPopupProps,
  DialogTitleProps,
} from "./dialog";
export { AlertDialog } from "./alert-dialog";
export type {
  AlertDialogDescriptionProps,
  AlertDialogFooterProps,
  AlertDialogHeaderProps,
  AlertDialogPopupProps,
  AlertDialogTitleProps,
} from "./alert-dialog";

export { Toaster, toast } from "./toast";
export type { ToasterProps } from "./toast";

export { DiffStats, ToolCallLine, ToolCallLineChevron, toolCallShimmer } from "./tool-call";
export type { DiffStatsProps, ToolCallLineProps, ToolCallState } from "./tool-call";
export { UserMessage } from "./user-message";
export type { UserMessagePreviewProps, UserMessageProps } from "./user-message";
export { ChangeReceipt } from "./change-receipt";
export type { ChangeReceiptFile, ChangeReceiptProps, ChangeReceiptStatus } from "./change-receipt";
export { StatusRow } from "./status-row";
export type { StatusRowProps } from "./status-row";
export { WorkGroup } from "./work-group";
export type {
  WorkGroupHeaderProps,
  WorkGroupOutputStripProps,
  WorkGroupPreviewProps,
  WorkGroupProps,
} from "./work-group";
