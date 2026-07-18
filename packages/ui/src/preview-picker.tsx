import { Radio } from "@base-ui/react/radio";
import { RadioGroup } from "@base-ui/react/radio-group";
import { create, props } from "@stylexjs/stylex";
import type { ReactElement, ReactNode } from "react";

import { applyStyle, type HonkStyle, type StyleProp } from "./style";
import { Text } from "./text";
import { colorVars, controlVars, motionVars, radiusVars, spaceVars } from "./tokens.stylex";

type PreviewPickerOption<Value extends string> = {
  readonly value: Value;
  readonly label: string;
  readonly preview: ReactNode;
};

type PreviewPickerProps<Value extends string> = {
  readonly accessibilityLabel: string;
  readonly value: Value;
  readonly options: readonly PreviewPickerOption<Value>[];
  readonly onValueChange: (value: Value) => void;
  readonly style?: StyleProp<HonkStyle>;
};

const styles = create({
  root: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "flex-end",
    flexWrap: "wrap",
    gap: spaceVars["--honk-space-gutter"],
  },
  option: {
    "--_preview-border": {
      default: colorVars["--honk-color-border-muted"],
      ":hover": {
        "@media (hover: hover)": colorVars["--honk-color-border-base"],
      },
      "[data-checked]": colorVars["--honk-color-accent"],
    },
    appearance: "none",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: controlVars["--honk-control-gap"],
    padding: 0,
    borderStyle: "none",
    borderRadius: radiusVars["--honk-radius-field"],
    backgroundColor: "transparent",
    color: {
      default: colorVars["--honk-color-text-muted"],
      "[data-checked]": colorVars["--honk-color-text-primary"],
    },
    cursor: "pointer",
    outlineColor: colorVars["--honk-color-accent"],
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineWidth: controlVars["--honk-control-focus-ring-width"],
    outlineOffset: controlVars["--honk-control-focus-ring-offset"],
    transitionProperty: "color",
    transitionDuration: {
      default: motionVars["--honk-motion-duration-hover"],
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: motionVars["--honk-motion-ease-out"],
  },
  preview: {
    display: "grid",
    placeItems: "center",
    padding: controlVars["--honk-control-gap"],
    borderWidth: controlVars["--honk-control-focus-ring-width"],
    borderStyle: "solid",
    borderColor: "var(--_preview-border)",
    borderRadius: radiusVars["--honk-radius-field"],
    backgroundColor: colorVars["--honk-color-layer-01"],
    pointerEvents: "none",
    transitionProperty: "border-color, background-color",
    transitionDuration: {
      default: motionVars["--honk-motion-duration-hover"],
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: motionVars["--honk-motion-ease-out"],
  },
});

function PreviewPicker<Value extends string>(input: PreviewPickerProps<Value>): ReactElement {
  return (
    <RadioGroup
      aria-label={input.accessibilityLabel}
      value={input.value}
      onValueChange={input.onValueChange}
      {...applyStyle(props(styles.root), input.style)}
    >
      {input.options.map((option) => (
        <Radio.Root key={option.value} value={option.value} {...props(styles.option)}>
          <span aria-hidden {...props(styles.preview)}>
            {option.preview}
          </span>
          <Text
            size="sm"
            tone="inherit"
            weight={option.value === input.value ? "semibold" : "regular"}
          >
            {option.label}
          </Text>
        </Radio.Root>
      ))}
    </RadioGroup>
  );
}

export { PreviewPicker };
export type { PreviewPickerOption, PreviewPickerProps };
