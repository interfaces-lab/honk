// @honk/ui public surface — the design-system layer's concepts: the token vocabulary, the
// matrix glyph, the typography and glyph leaves, the thread-tab plane, the compound inset
// frame, and the conversation surface's row family (tool call line, user message, status
// row, work group). Nothing else leaves through the root; anything experimental stays on
// deep imports ("@honk/ui/*").

// Tokens: grouped defineVars + their *Defaults maps (typed-union keys) + the key unions.
// StyleX unplugin requires defineVars imports to resolve to a path ending in `.stylex.ts`
// / `.stylex.js`. Consumers that author StyleX styles must import vars from
// `@honk/ui/tokens.stylex` (package export), not this barrel — re-exports here stay for
// non-StyleX call sites (types, dials, runtime cssVarName unwrap) and for discoverability.
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
  radiusDefaults,
  radiusVars,
  shellDefaults,
  shellVars,
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
  RadiusVarName,
  ShellVarName,
  SpaceVarName,
  ToastVarName,
  ZVarName,
} from "./tokens.stylex";

// The signature status glyph.
export { Matrix } from "./matrix";

// The typography leaf.
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

// The glyph leaf (wraps central-icons glyphs). The curated glyph SET itself — the 35 production
// glyphs grouped by function, plus ICON_CATALOG — deliberately stays off the root: deep-import it
// from "@honk/ui/icons" (resolved by the package's "./*" export). Keeping the leaf here and the
// glyph roster on the subpath is the same lean-root split the header describes.
export { Icon } from "./icon";
export type { Glyph, IconProps, IconSize, IconTone } from "./icon";

// The status dot leaf — a small round state glyph (semantic tone + the identity pulse).
export { StatusDot } from "./status-dot";
export type { StatusDotProps, StatusDotTone } from "./status-dot";

// The composer's four-stop effort dial (dotted gauge + spread labels; presets replace free
// model selection — 2026-07-11 grill).
export { PresetDial } from "./preset-dial";
export type { PresetDialProps, PresetDialStop, PresetTone } from "./preset-dial";

// The hairline divider leaf (Base UI Separator).
export { Separator } from "./separator";
export type { SeparatorProps, SeparatorTone } from "./separator";

// The indeterminate loader leaf (pure StyleX, status-dot pattern).
export { Spinner } from "./spinner";
export type { SpinnerProps, SpinnerSize, SpinnerTone } from "./spinner";

// The keyboard-key chip leaf.
export { Kbd } from "./kbd";
export type { KbdProps, KbdSize } from "./kbd";

// The clickable control (Base UI): the text Button + the square IconButton.
export { Button, IconButton } from "./button";
export type { ButtonProps, ButtonSize, ButtonVariant, IconButtonProps } from "./button";

// The labelled chip leaf.
export { Badge } from "./badge";
export type { BadgeProps, BadgeSize, BadgeTone } from "./badge";

// The input surface: the layer-01 well + hairline ring + focus outline every "place you type"
// composes into, with the bare Field.Input leaf.
export { Field } from "./field";
export type { FieldInputProps, FieldProps, FieldSize } from "./field";

// The compact content row: one selectable line in any list of things, snapped to the control
// scale (Slot / Title / Subtitle / Meta).
export { ListRow } from "./list-row";
export type { ListRowPieceProps, ListRowProps } from "./list-row";

// The form-control primitives (Base UI): the binary Switch (takes effect on flip) + the staged
// Checkbox (a form field you submit), with the indeterminate tri-state.
export { Switch } from "./switch";
export type { SwitchProps, SwitchSize } from "./switch";
export { Checkbox } from "./checkbox";
export type { CheckboxProps, CheckboxSize } from "./checkbox";

// The thread-tab plane.
export { TabStrip } from "./tabs";
export type { TabDescriptor } from "./tabs";

// The window frame — one compound: Shell.TitleBar / .Stage / .Sheet (v2 inset floating sheet).
export { Shell } from "./shell";
export type { ShellSlotProps, TitleBarProps } from "./shell";

// The tooltip family (Base UI): a Provider mounted once at the shell root, the trigger-based
// Tooltip, and the controlled/triggerless AnchoredTooltip for delegated hosts like the tab strip.
export { AnchoredTooltip, Tooltip, TooltipProvider, tooltipPopupStyles } from "./tooltip";
export type { AnchoredTooltipProps, TooltipAnchor, TooltipProps } from "./tooltip";

// The overlay family (Base UI), reusing the tooltip floating surface: the compound Popover (a bare
// interactive card) and the compound Menu (a dropdown of action rows).
export { Popover } from "./popover";
export type { PopoverDescriptionProps, PopoverPopupProps, PopoverTitleProps } from "./popover";
export { Menu } from "./menu";
export type {
  MenuGroupLabelProps,
  MenuItemProps,
  MenuPopupProps,
  MenuSeparatorProps,
} from "./menu";

// The modal tier (Base UI), reusing the popover surface over a scrim backdrop: the compound Dialog
// (a focused card the user dispatches) and AlertDialog (a decision that won't dismiss on outside-click).
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

// The global notification surface: Sonner's imperative API under one friendly, top-center
// @honk/ui treatment. Mount Toaster once; call toast from event/store code.
export { Toaster, toast } from "./toast";
export type { ToasterProps } from "./toast";

// The conversation surface's row family (recon-memo ports).
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
