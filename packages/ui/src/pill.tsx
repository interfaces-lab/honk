import * as stylex from "@stylexjs/stylex";
import * as React from "react";

import { Button, IconButton, type ButtonProps } from "./button";
import { Icon } from "./icon";
import { IconCrossSmall } from "./icons";
import { applyStyle, type HonkStyle, type StyleProp } from "./style";
import { colorVars, controlVars, fontVars, radiusVars, spaceVars } from "./tokens.stylex";

type PillTone = "control" | "muted" | "surface" | "neutral" | "ok" | "warn" | "err";
type PillSize = "inline" | "sm" | "md";
type PillButtonDensity = "default" | "notification";

const PILL_H_SM = "22px";
const PILL_RING = `inset 0 0 0 1px ${colorVars["--honk-color-border-muted"]}`;

const styles = stylex.create({
  root: {
    display: "inline-flex",
    alignItems: "center",
    minWidth: 0,
    flexShrink: 0,
    boxSizing: "border-box",
    gap: controlVars["--honk-control-gap"],
    borderRadius: radiusVars["--honk-radius-pill"],
    whiteSpace: "nowrap",
  },
  label: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  inline: {
    // oxlint-disable-next-line honk/design-no-raw-values -- 1px inline-pill inset is fixed intrinsic pill geometry; no spacing token owns it
    paddingBlock: "1px",
    // oxlint-disable-next-line honk/design-no-raw-values -- 5px inline-pill inset is fixed intrinsic pill geometry; no spacing token owns it
    paddingInline: "5px",
  },
  sm: {
    height: PILL_H_SM,
    paddingInline: spaceVars["--honk-space-gutter"],
  },
  md: {
    height: controlVars["--honk-control-h-sm"],
    paddingInline: spaceVars["--honk-space-gutter"],
    fontSize: fontVars["--honk-font-size-detail"],
  },
  button: {
    borderRadius: radiusVars["--honk-radius-pill"],
    gap: controlVars["--honk-control-menu-pad"],
    paddingInline: controlVars["--honk-control-pad-sm"],
    fontSize: fontVars["--honk-font-size-detail"],
    lineHeight: fontVars["--honk-leading-detail"],
  },
  notificationButton: {
    height: "auto",
    minWidth: 0,
    flexShrink: 1,
    overflow: "hidden",
    // oxlint-disable-next-line honk/design-no-raw-values -- 5px vertical inset preserves Cursor's compact composer-mode pill density; no spacing token owns 5px
    paddingBlock: "5px",
    paddingInline: controlVars["--honk-control-pad-sm"],
    boxShadow: PILL_RING,
  },
  mono: {
    fontFamily: fontVars["--honk-font-family-mono"],
  },
  ring: {
    boxShadow: PILL_RING,
  },
  withRemove: {
    paddingInlineEnd: 0,
  },
  control: {
    backgroundColor: colorVars["--honk-color-control"],
  },
  muted: {
    backgroundColor: colorVars["--honk-color-layer-02"],
    color: colorVars["--honk-color-text-muted"],
  },
  surface: {
    backgroundColor: colorVars["--honk-color-layer-01"],
    color: colorVars["--honk-color-fg-secondary"],
  },
  neutral: {
    backgroundColor: colorVars["--honk-color-layer-01"],
    color: colorVars["--honk-color-text-muted"],
  },
  ok: {
    backgroundColor: colorVars["--honk-color-ok-bg"],
    color: colorVars["--honk-color-ok-fg"],
  },
  warn: {
    backgroundColor: colorVars["--honk-color-warn-bg"],
    color: colorVars["--honk-color-warn-fg"],
  },
  err: {
    backgroundColor: colorVars["--honk-color-err-bg"],
    color: colorVars["--honk-color-err-fg"],
  },
});

const sizeStyles: Record<PillSize, stylex.StyleXStyles> = {
  inline: styles.inline,
  sm: styles.sm,
  md: styles.md,
};
const toneStyles: Record<PillTone, stylex.StyleXStyles> = {
  control: styles.control,
  muted: styles.muted,
  surface: styles.surface,
  neutral: styles.neutral,
  ok: styles.ok,
  warn: styles.warn,
  err: styles.err,
};

interface PillProps {
  tone?: PillTone;
  size?: PillSize;
  isMono?: boolean;
  hasRing?: boolean;
  icon?: React.ReactNode;
  children: React.ReactNode;
  onRemove?: () => void;
  removeLabel?: string;
  isRemoveDisabled?: boolean;
  title?: string;
  style?: StyleProp<HonkStyle>;
}

function Pill({
  tone = "control",
  size = "sm",
  isMono,
  hasRing,
  icon,
  children,
  onRemove,
  removeLabel,
  isRemoveDisabled,
  title,
  style,
}: PillProps): React.ReactElement {
  return (
    <span
      data-slot="pill"
      title={title}
      {...applyStyle(
        stylex.props(
          styles.root,
          sizeStyles[size],
          toneStyles[tone],
          isMono && styles.mono,
          hasRing && styles.ring,
          onRemove !== undefined && styles.withRemove,
        ),
        style,
      )}
    >
      {icon ? <span aria-hidden>{icon}</span> : null}
      <span {...stylex.props(styles.label)}>{children}</span>
      {onRemove ? (
        <IconButton
          size="sm"
          variant="quiet"
          aria-label={`Remove ${removeLabel}`}
          disabled={isRemoveDisabled}
          onClick={onRemove}
        >
          <Icon icon={IconCrossSmall} size="sm" />
        </IconButton>
      ) : null}
    </span>
  );
}

type PillButtonProps = Omit<ButtonProps, "size" | "variant"> & {
  density?: PillButtonDensity;
};

function PillButton({ density = "default", style, ...rest }: PillButtonProps): React.ReactElement {
  return (
    <Button
      {...rest}
      size="md"
      variant="quiet"
      style={[styles.button, density === "notification" && styles.notificationButton, style]}
    />
  );
}

export { Pill, PillButton };
export type { PillButtonDensity, PillButtonProps, PillProps, PillSize, PillTone };
