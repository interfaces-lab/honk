import * as stylex from "@stylexjs/stylex";
import { Button, Icon, IconButton, Text, Tooltip } from "@honk/ui";
import { IconStepBack } from "@honk/ui/icons";
import { colorVars, controlVars, radiusVars, spaceVars } from "@honk/ui/tokens.stylex";
import * as React from "react";

const SETTINGS_WIDE_MEDIA = "@media (min-width: 720px)";
const HAIRLINE = "1px";
const STEPPER_VALUE_MIN_WIDTH = "2ch";

const styles = stylex.create({
  section: {
    display: "flex",
    flexDirection: "column",
    gap: spaceVars["--honk-space-gutter"],
    minWidth: 0,
  },
  sectionHeader: {
    display: "flex",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: spaceVars["--honk-space-gutter"],
    paddingInline: controlVars["--honk-control-pad-sm"],
  },
  sectionCopy: {
    display: "flex",
    flexDirection: "column",
    gap: controlVars["--honk-control-gap"],
    minWidth: 0,
  },
  rows: {
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    borderWidth: HAIRLINE,
    borderStyle: "solid",
    borderColor: colorVars["--honk-color-border-muted"],
    borderRadius: radiusVars["--honk-radius-field"],
    backgroundColor: colorVars["--honk-color-layer-01"],
  },
  row: {
    boxSizing: "border-box",
    display: "flex",
    flexDirection: {
      default: "column",
      [SETTINGS_WIDE_MEDIA]: "row",
    },
    alignItems: {
      default: "stretch",
      [SETTINGS_WIDE_MEDIA]: "center",
    },
    justifyContent: "space-between",
    gap: spaceVars["--honk-space-gutter"],
    minHeight: controlVars["--honk-control-h-lg"],
    paddingInline: spaceVars["--honk-space-panel-pad"],
    paddingBlock: controlVars["--honk-control-pad-md"],
    borderBottomWidth: HAIRLINE,
    borderBottomStyle: "solid",
    borderBottomColor: colorVars["--honk-color-border-muted"],
  },
  rowLast: {
    borderBottomWidth: 0,
  },
  rowCopy: {
    display: "flex",
    flexDirection: "column",
    gap: controlVars["--honk-control-gap"],
    minWidth: 0,
    flexGrow: 1,
  },
  rowTitleLine: {
    display: "flex",
    alignItems: "center",
    gap: controlVars["--honk-control-gap"],
    minWidth: 0,
  },
  rowControl: {
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    flexWrap: "wrap",
    gap: controlVars["--honk-control-gap"],
    flexShrink: 0,
  },
  stepper: {
    display: "inline-flex",
    alignItems: "center",
    gap: controlVars["--honk-control-gap"],
  },
});

export function SettingResetButton(props: {
  readonly label: string;
  readonly onClick: () => void;
}): React.ReactElement {
  return (
    <Tooltip label="Reset to default">
      <IconButton
        size="sm"
        variant="quiet"
        aria-label={`Reset ${props.label} to default`}
        onClick={(event) => {
          event.stopPropagation();
          props.onClick();
        }}
      >
        <Icon icon={IconStepBack} size="sm" />
      </IconButton>
    </Tooltip>
  );
}

export function SettingsRow(props: {
  readonly title: string;
  readonly description: React.ReactNode;
  readonly control: React.ReactNode;
  readonly resetAction?: React.ReactNode;
  readonly isLast?: boolean;
}): React.ReactElement {
  return (
    <div {...stylex.props(styles.row, props.isLast === true && styles.rowLast)}>
      <div {...stylex.props(styles.rowCopy)}>
        <div {...stylex.props(styles.rowTitleLine)}>
          <Text size="base" weight="medium">
            {props.title}
          </Text>
          {props.resetAction}
        </div>
        <Text size="sm" tone="muted">
          {props.description}
        </Text>
      </div>
      <div {...stylex.props(styles.rowControl)}>{props.control}</div>
    </div>
  );
}

export function SettingsRows(props: { readonly children: React.ReactNode }): React.ReactElement {
  return <div {...stylex.props(styles.rows)}>{props.children}</div>;
}

export function SettingsSection(props: {
  readonly title: string;
  readonly description?: string;
  readonly action?: React.ReactNode;
  readonly children: React.ReactNode;
}): React.ReactElement {
  return (
    <section {...stylex.props(styles.section)}>
      <div {...stylex.props(styles.sectionHeader)}>
        <div {...stylex.props(styles.sectionCopy)}>
          <Text as="p" size="lg" weight="semibold">
            {props.title}
          </Text>
          {props.description === undefined ? null : (
            <Text as="p" size="sm" tone="muted">
              {props.description}
            </Text>
          )}
        </div>
        {props.action}
      </div>
      {props.children}
    </section>
  );
}

export function NumberStepper(props: {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly onChange: (value: number) => void;
}): React.ReactElement {
  return (
    <div {...stylex.props(styles.stepper)} role="group" aria-label={props.label}>
      <Button
        size="sm"
        variant="neutral"
        aria-label={`Decrease ${props.label}`}
        disabled={props.value <= props.min}
        onClick={() => {
          props.onChange(props.value - 1);
        }}
      >
        −
      </Button>
      <Text
        size="sm"
        family="mono"
        style={{ minWidth: STEPPER_VALUE_MIN_WIDTH, textAlign: "center" }}
      >
        {props.value}
      </Text>
      <Button
        size="sm"
        variant="neutral"
        aria-label={`Increase ${props.label}`}
        disabled={props.value >= props.max}
        onClick={() => {
          props.onChange(props.value + 1);
        }}
      >
        +
      </Button>
    </div>
  );
}
