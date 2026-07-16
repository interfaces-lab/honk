import { Icon, IconButton } from "@honk/ui";
import { IconArrowUp } from "@honk/ui/icons";
import { colorVars, radiusVars } from "@honk/ui/tokens.stylex";
import * as stylex from "@stylexjs/stylex";
import * as React from "react";

const styles = stylex.create({
  paint: {
    display: "inline-flex",
    borderRadius: radiusVars["--honk-radius-pill"],
  },
  enabled: { backgroundColor: colorVars["--honk-color-text-primary"] },
  disabled: { backgroundColor: colorVars["--honk-color-layer-03"] },
});

export function ComposerSubmitButton({
  ariaLabel = "Send",
  disabled = false,
  type = "button",
  onClick,
}: {
  readonly ariaLabel?: string;
  readonly disabled?: boolean;
  readonly type?: "button" | "submit";
  readonly onClick?: React.MouseEventHandler<HTMLButtonElement>;
}): React.ReactElement {
  return (
    <span {...stylex.props(styles.paint, disabled ? styles.disabled : styles.enabled)}>
      <IconButton
        type={type}
        aria-label={ariaLabel}
        variant="quiet"
        size="sm"
        disabled={disabled}
        {...(onClick === undefined ? {} : { onClick })}
      >
        <Icon
          icon={IconArrowUp}
          size="sm"
          style={{
            color: disabled
              ? colorVars["--honk-color-text-primary"]
              : colorVars["--honk-color-bg-base"],
          }}
        />
      </IconButton>
    </span>
  );
}
