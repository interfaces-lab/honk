import * as stylex from "@stylexjs/stylex";
import {
  DEFAULT_CONVERSATION_DENSITY,
  type ConversationDensity,
} from "@honk/shared/conversation-density";
import { Button, Picker, PreviewPicker, Switch, Text } from "@honk/ui";
import { colorVars, controlVars, radiusVars, spaceVars } from "@honk/ui/tokens.stylex";
import * as React from "react";

import { actions as appSettingsActions, useAppSettings } from "./app-settings-store";
import {
  actions as appearanceActions,
  DEFAULT_APPEARANCE,
  type FontSmoothing,
  useAppearance,
  type ThemePreference,
} from "./appearance-store";
import { useHonkDesktopCell, useHonkDesktopSettings } from "./desktop-extensions/runtime";
import type { HonkDesktopSettingsToggleContribution } from "./desktop-extensions/sdk";
import {
  buildNotificationSettingsSupportText,
  requestBrowserNotificationPermission,
  useNotificationPermission,
} from "./notification-permission";
import {
  NumberStepper,
  SettingResetButton,
  SettingsRow,
  SettingsRows,
  SettingsSection,
} from "./settings-controls";

const SWATCH_SIZE = "16px";

// These fixed dimensions keep both miniature tab layouts directly comparable inside one settings row.
const TAB_STYLE_PREVIEW_WIDTH = "96px";
const TAB_STYLE_PREVIEW_HEIGHT = "56px";
const TAB_STYLE_TITLEBAR_HEIGHT = "14px";
const TAB_STYLE_SIDEBAR_WIDTH = "28px";
const TAB_STYLE_STAGE_GUTTER = "3px";
const TAB_STYLE_DOT_SIZE = "3px";
const TAB_STYLE_LINE_HEIGHT = "3px";
const TAB_STYLE_TAB_HEIGHT = "6px";
const TAB_STYLE_TAB_WIDTH = "22px";
const TAB_STYLE_TAB_ACTIVE_WIDTH = "30px";
const TAB_STYLE_CONTENT_LINE_WIDTH = "58%";
const TAB_STYLE_CONTENT_LINE_SHORT_WIDTH = "38%";

type TabStyle = "san-francisco" | "new-york";

const THEME_OPTIONS = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
] as const satisfies readonly { readonly value: ThemePreference; readonly label: string }[];

const FONT_SMOOTHING_OPTIONS = [
  { value: "antialiased", label: "Grayscale" },
  { value: "auto", label: "Crisp" },
] as const satisfies readonly { readonly value: FontSmoothing; readonly label: string }[];

const DENSITY_OPTIONS = [
  {
    value: "compact-all-grouped",
    label: "Compact",
    description: "Group related reasoning and actions into one work run.",
  },
  {
    value: "compact-ungrouped",
    label: "Balanced",
    description: "Show each action in a compact row.",
  },
  {
    value: "detailed",
    label: "Detailed",
    description: "Show each action and keep its output expanded.",
  },
] as const satisfies readonly {
  readonly value: ConversationDensity;
  readonly label: string;
  readonly description: string;
}[];

const styles = stylex.create({
  tintControl: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) auto",
    alignItems: "center",
    gap: controlVars["--honk-control-gap"],
    width: "100%",
  },
  tintSwatch: {
    width: SWATCH_SIZE,
    height: SWATCH_SIZE,
    borderRadius: radiusVars["--honk-radius-control"],
    flexShrink: 0,
  },
  tintValue: {
    minWidth: "3ch",
    textAlign: "end",
  },
  tabStylePreview: {
    width: TAB_STYLE_PREVIEW_WIDTH,
    height: TAB_STYLE_PREVIEW_HEIGHT,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    borderRadius: radiusVars["--honk-radius-control"],
    backgroundColor: colorVars["--honk-color-bg-deep"],
  },
  tabStyleTitlebar: {
    height: TAB_STYLE_TITLEBAR_HEIGHT,
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    gap: controlVars["--honk-control-gap"],
    paddingInline: controlVars["--honk-control-gap"],
    backgroundColor: colorVars["--honk-color-bg-deep"],
  },
  tabStyleTrafficLights: {
    display: "flex",
    alignItems: "center",
    gap: TAB_STYLE_DOT_SIZE,
    flexShrink: 0,
  },
  tabStyleDot: {
    width: TAB_STYLE_DOT_SIZE,
    height: TAB_STYLE_DOT_SIZE,
    borderRadius: radiusVars["--honk-radius-pill"],
    backgroundColor: colorVars["--honk-color-text-faint"],
  },
  tabStyleTabs: {
    minWidth: 0,
    flexGrow: 1,
    display: "flex",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: TAB_STYLE_DOT_SIZE,
  },
  tabStyleTab: {
    width: TAB_STYLE_TAB_WIDTH,
    height: TAB_STYLE_TAB_HEIGHT,
    borderRadius: radiusVars["--honk-radius-control"],
    backgroundColor: colorVars["--honk-color-layer-02"],
  },
  tabStyleTabActive: {
    width: TAB_STYLE_TAB_ACTIVE_WIDTH,
    backgroundColor: colorVars["--honk-color-control-selected"],
  },
  tabStyleBody: {
    minHeight: 0,
    flexGrow: 1,
    display: "flex",
    gap: TAB_STYLE_STAGE_GUTTER,
    padding: TAB_STYLE_STAGE_GUTTER,
    backgroundColor: colorVars["--honk-color-bg-deep"],
  },
  tabStyleSidebar: {
    width: TAB_STYLE_SIDEBAR_WIDTH,
    flexShrink: 0,
    display: "flex",
    flexDirection: "column",
    gap: TAB_STYLE_DOT_SIZE,
    paddingBlock: TAB_STYLE_DOT_SIZE,
    // Miniature only — real sidebar uses --honk-sidebar-* tokens, not these preview constants.
    backgroundColor: "transparent",
  },
  tabStyleSidebarRow: {
    width: "100%",
    height: TAB_STYLE_LINE_HEIGHT,
    borderRadius: radiusVars["--honk-radius-pill"],
    backgroundColor: colorVars["--honk-color-text-faint"],
  },
  tabStyleSidebarRowActive: {
    backgroundColor: colorVars["--honk-color-control-selected"],
  },
  tabStyleCanvas: {
    minWidth: 0,
    flexGrow: 1,
    display: "flex",
    flexDirection: "column",
    gap: controlVars["--honk-control-gap"],
    padding: spaceVars["--honk-space-gutter"],
    borderRadius: radiusVars["--honk-radius-control"],
    backgroundColor: colorVars["--honk-color-bg-base"],
    boxShadow: `inset 0 0 0 1px ${colorVars["--honk-color-border-muted"]}`,
  },
  tabStyleContentLine: {
    width: TAB_STYLE_CONTENT_LINE_WIDTH,
    height: TAB_STYLE_LINE_HEIGHT,
    borderRadius: radiusVars["--honk-radius-pill"],
    backgroundColor: colorVars["--honk-color-text-faint"],
  },
  tabStyleContentLineShort: {
    width: TAB_STYLE_CONTENT_LINE_SHORT_WIDTH,
  },
});

function TabStylePreview(props: { readonly variant: TabStyle }): React.ReactElement {
  const isVertical = props.variant === "new-york";

  return (
    <span {...stylex.props(styles.tabStylePreview)}>
      <span {...stylex.props(styles.tabStyleTitlebar)}>
        <span {...stylex.props(styles.tabStyleTrafficLights)}>
          <span {...stylex.props(styles.tabStyleDot)} />
          <span {...stylex.props(styles.tabStyleDot)} />
          <span {...stylex.props(styles.tabStyleDot)} />
        </span>
        {isVertical ? null : (
          <span {...stylex.props(styles.tabStyleTabs)}>
            <span {...stylex.props(styles.tabStyleTab)} />
            <span {...stylex.props(styles.tabStyleTab, styles.tabStyleTabActive)} />
          </span>
        )}
      </span>
      <span {...stylex.props(styles.tabStyleBody)}>
        {isVertical ? (
          <span {...stylex.props(styles.tabStyleSidebar)}>
            <span {...stylex.props(styles.tabStyleSidebarRow, styles.tabStyleSidebarRowActive)} />
            <span {...stylex.props(styles.tabStyleSidebarRow)} />
            <span {...stylex.props(styles.tabStyleSidebarRow)} />
          </span>
        ) : null}
        <span {...stylex.props(styles.tabStyleCanvas)}>
          <span {...stylex.props(styles.tabStyleContentLine)} />
          <span {...stylex.props(styles.tabStyleContentLine, styles.tabStyleContentLineShort)} />
        </span>
      </span>
    </span>
  );
}

function ThemeSelect(props: {
  readonly value: ThemePreference;
  readonly onChange: (value: ThemePreference) => void;
}): React.ReactElement {
  const label = THEME_OPTIONS.find((option) => option.value === props.value)?.label ?? "System";
  return (
    <Picker.Root
      value={props.value}
      onValueChange={(value) => {
        props.onChange(value as ThemePreference);
      }}
    >
      <Picker.Trigger size="sm" accessibilityLabel="Theme preference">
        {label}
      </Picker.Trigger>
      <Picker.Popup label="Theme preference" layer="dialog" align="end">
        {THEME_OPTIONS.map((option) => (
          <Picker.Option key={option.value} value={option.value} label={option.label} />
        ))}
      </Picker.Popup>
    </Picker.Root>
  );
}

function FontSmoothingSelect(props: {
  readonly value: FontSmoothing;
  readonly onChange: (value: FontSmoothing) => void;
}): React.ReactElement {
  const label =
    FONT_SMOOTHING_OPTIONS.find((option) => option.value === props.value)?.label ?? "Grayscale";
  return (
    <Picker.Root
      value={props.value}
      onValueChange={(value) => {
        props.onChange(value as FontSmoothing);
      }}
    >
      <Picker.Trigger size="sm" accessibilityLabel="Font smoothing">
        {label}
      </Picker.Trigger>
      <Picker.Popup label="Font smoothing" layer="dialog" align="end">
        {FONT_SMOOTHING_OPTIONS.map((option) => (
          <Picker.Option key={option.value} value={option.value} label={option.label} />
        ))}
      </Picker.Popup>
    </Picker.Root>
  );
}

function WorkDetailSelect(props: {
  readonly value: ConversationDensity;
  readonly onChange: (value: ConversationDensity) => void;
}): React.ReactElement {
  const option = DENSITY_OPTIONS.find((candidate) => candidate.value === props.value);
  return (
    <Picker.Root
      value={props.value}
      onValueChange={(value) => {
        props.onChange(value as ConversationDensity);
      }}
    >
      <Picker.Trigger size="sm" accessibilityLabel="Work detail">
        {option?.label ?? "Compact"}
      </Picker.Trigger>
      <Picker.Popup label="Work detail" width="wide" layer="dialog" align="end">
        {DENSITY_OPTIONS.map((candidate) => (
          <Picker.Option
            key={candidate.value}
            value={candidate.value}
            label={candidate.label}
            description={candidate.description}
          />
        ))}
      </Picker.Popup>
    </Picker.Root>
  );
}

function AppearanceTintSlider(props: {
  readonly label: string;
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly tintHue: number;
  readonly tintIntensity: number;
  readonly variant: "hue" | "intensity";
  readonly onChange: (value: number) => void;
}): React.ReactElement {
  const swatchIntensity =
    props.variant === "hue" && props.tintIntensity === 0 ? 0 : props.tintIntensity;
  const tintStyle = {
    "--honk-settings-tint-hue": String(props.tintHue),
    "--honk-settings-tint-intensity": `${swatchIntensity}%`,
  } as React.CSSProperties;

  return (
    <div {...stylex.props(styles.tintControl)}>
      <input
        aria-label={props.label}
        className="honk-appearance-tint-slider"
        data-variant={props.variant}
        max={props.max}
        min={props.min}
        step={1}
        style={tintStyle}
        type="range"
        value={props.value}
        onInput={(event) => {
          props.onChange(event.currentTarget.valueAsNumber);
        }}
      />
      {props.variant === "hue" ? (
        <span
          {...stylex.props(styles.tintSwatch)}
          aria-hidden
          className="honk-appearance-tint-swatch"
          data-muted={swatchIntensity === 0 ? "" : undefined}
          style={tintStyle}
        />
      ) : (
        <span {...stylex.props(styles.tintValue)}>
          <Text size="sm" family="mono">
            {props.value}%
          </Text>
        </span>
      )}
    </div>
  );
}

function NotificationPermissionRow(): React.ReactElement {
  const permission = useNotificationPermission();
  const supportText = buildNotificationSettingsSupportText(permission);
  const isGranted = permission === "granted";
  const canRequest = permission === "default";
  const isDesktopShell =
    typeof document !== "undefined" &&
    document.documentElement.getAttribute("data-shell-platform") === "electron";

  return (
    <SettingsRow
      title="Desktop notifications"
      description={
        isDesktopShell && isGranted ? "Enabled automatically in the desktop app." : supportText
      }
      isLast
      control={
        isGranted ? (
          <Text size="sm" tone="muted">
            On
          </Text>
        ) : canRequest ? (
          <Button
            size="sm"
            variant="neutral"
            onClick={() => {
              void requestBrowserNotificationPermission();
            }}
          >
            Enable
          </Button>
        ) : (
          <Text size="sm" tone="faint">
            {permission === "denied"
              ? "Blocked"
              : permission === "insecure"
                ? "Unavailable"
                : "Unsupported"}
          </Text>
        )
      }
    />
  );
}

function DesktopAppearanceSetting(props: {
  readonly setting: HonkDesktopSettingsToggleContribution;
}): React.ReactElement {
  const isEnabled = useHonkDesktopCell(props.setting.value);

  if (props.setting.presentation?.kind === "tab-style") {
    return (
      <SettingsRow
        title={props.setting.title}
        description={props.setting.description ?? props.setting.extension.name}
        control={
          <PreviewPicker
            accessibilityLabel={props.setting.title}
            value={isEnabled ? "new-york" : "san-francisco"}
            options={[
              {
                value: "san-francisco",
                label: props.setting.presentation.offLabel,
                preview: <TabStylePreview variant="san-francisco" />,
              },
              {
                value: "new-york",
                label: props.setting.presentation.onLabel,
                preview: <TabStylePreview variant="new-york" />,
              },
            ]}
            onValueChange={(value) => {
              props.setting.value.set(value === "new-york");
            }}
          />
        }
      />
    );
  }

  return (
    <SettingsRow
      title={props.setting.title}
      description={props.setting.description ?? props.setting.extension.name}
      control={
        <Switch
          size="sm"
          checked={isEnabled}
          aria-label={props.setting.title}
          onCheckedChange={(checked) => {
            props.setting.value.set(checked);
          }}
        />
      }
    />
  );
}

export function SettingsAppearance(): React.ReactElement {
  const appearance = useAppearance();
  const appSettings = useAppSettings();
  const desktopSettings = useHonkDesktopSettings();
  const densityOption =
    DENSITY_OPTIONS.find((option) => option.value === appSettings.conversationDensity) ??
    DENSITY_OPTIONS[0];
  const isDirty =
    appearance.theme !== DEFAULT_APPEARANCE.theme ||
    appearance.tintHue !== DEFAULT_APPEARANCE.tintHue ||
    appearance.tintIntensity !== DEFAULT_APPEARANCE.tintIntensity ||
    appearance.uiFontSize !== DEFAULT_APPEARANCE.uiFontSize ||
    appearance.codeFontSize !== DEFAULT_APPEARANCE.codeFontSize ||
    appearance.fontSmoothing !== DEFAULT_APPEARANCE.fontSmoothing ||
    appSettings.conversationDensity !== DEFAULT_CONVERSATION_DENSITY;

  return (
    <>
      <SettingsSection
        title="Appearance"
        action={
          isDirty ? (
            <Button
              size="sm"
              variant="quiet"
              onClick={() => {
                appearanceActions.resetAll();
                appSettingsActions.resetConversationDensity();
              }}
            >
              Reset
            </Button>
          ) : null
        }
      >
        <SettingsRows>
          <SettingsRow
            title="Theme"
            description="Use light or dark colors, or match your system."
            resetAction={
              appearance.theme === DEFAULT_APPEARANCE.theme ? null : (
                <SettingResetButton
                  label="theme"
                  onClick={() => {
                    appearanceActions.resetTheme();
                  }}
                />
              )
            }
            control={
              <ThemeSelect
                value={appearance.theme}
                onChange={(value) => {
                  appearanceActions.setTheme(value);
                }}
              />
            }
          />
          <SettingsRow
            title="Tint hue"
            description="Choose the color family used across surfaces and accents."
            resetAction={
              appearance.tintHue === DEFAULT_APPEARANCE.tintHue ? null : (
                <SettingResetButton
                  label="tint hue"
                  onClick={() => {
                    appearanceActions.resetTintHue();
                  }}
                />
              )
            }
            control={
              <AppearanceTintSlider
                label="Tint hue"
                min={0}
                max={360}
                tintHue={appearance.tintHue}
                tintIntensity={appearance.tintIntensity}
                value={appearance.tintHue}
                variant="hue"
                onChange={(value) => {
                  appearanceActions.setTintHue(value);
                }}
              />
            }
          />
          <SettingsRow
            title="Tint intensity"
            description="Adjust how strongly the tint changes surfaces and accents."
            isLast
            resetAction={
              appearance.tintIntensity === DEFAULT_APPEARANCE.tintIntensity ? null : (
                <SettingResetButton
                  label="tint intensity"
                  onClick={() => {
                    appearanceActions.resetTintIntensity();
                  }}
                />
              )
            }
            control={
              <AppearanceTintSlider
                label="Tint intensity"
                min={0}
                max={100}
                tintHue={appearance.tintHue}
                tintIntensity={appearance.tintIntensity}
                value={appearance.tintIntensity}
                variant="intensity"
                onChange={(value) => {
                  appearanceActions.setTintIntensity(value);
                }}
              />
            }
          />
        </SettingsRows>
      </SettingsSection>

      <SettingsSection title="Text">
        <SettingsRows>
          <SettingsRow
            title="Interface font size"
            description="Adjust text throughout the interface."
            resetAction={
              appearance.uiFontSize === DEFAULT_APPEARANCE.uiFontSize ? null : (
                <SettingResetButton
                  label="UI font size"
                  onClick={() => {
                    appearanceActions.resetUiFontSize();
                  }}
                />
              )
            }
            control={
              <NumberStepper
                label="Interface font size"
                min={11}
                max={16}
                value={appearance.uiFontSize}
                onChange={(value) => {
                  appearanceActions.setUiFontSize(value);
                }}
              />
            }
          />
          <SettingsRow
            title="Code font size"
            description="Adjust text in code, diffs, and terminals."
            resetAction={
              appearance.codeFontSize === DEFAULT_APPEARANCE.codeFontSize ? null : (
                <SettingResetButton
                  label="code font size"
                  onClick={() => {
                    appearanceActions.resetCodeFontSize();
                  }}
                />
              )
            }
            control={
              <NumberStepper
                label="Code font size"
                min={10}
                max={18}
                value={appearance.codeFontSize}
                onChange={(value) => {
                  appearanceActions.setCodeFontSize(value);
                }}
              />
            }
          />
          <SettingsRow
            title="Font smoothing"
            description="Grayscale renders text lighter; Crisp uses your system's rendering for heavier, sharper text."
            isLast
            resetAction={
              appearance.fontSmoothing === DEFAULT_APPEARANCE.fontSmoothing ? null : (
                <SettingResetButton
                  label="font smoothing"
                  onClick={() => {
                    appearanceActions.resetFontSmoothing();
                  }}
                />
              )
            }
            control={
              <FontSmoothingSelect
                value={appearance.fontSmoothing}
                onChange={(value) => {
                  appearanceActions.setFontSmoothing(value);
                }}
              />
            }
          />
        </SettingsRows>
      </SettingsSection>

      <SettingsSection title="Layout">
        <SettingsRows>
          {desktopSettings.map((setting) => (
            <DesktopAppearanceSetting key={setting.key} setting={setting} />
          ))}
          <SettingsRow
            title="Work detail"
            description={densityOption.description}
            isLast
            resetAction={
              appSettings.conversationDensity === DEFAULT_CONVERSATION_DENSITY ? null : (
                <SettingResetButton
                  label="work detail"
                  onClick={() => {
                    appSettingsActions.resetConversationDensity();
                  }}
                />
              )
            }
            control={
              <WorkDetailSelect
                value={appSettings.conversationDensity}
                onChange={(value) => {
                  appSettingsActions.setConversationDensity(value);
                }}
              />
            }
          />
        </SettingsRows>
      </SettingsSection>

      <SettingsSection title="Notifications">
        <SettingsRows>
          <NotificationPermissionRow />
        </SettingsRows>
      </SettingsSection>
    </>
  );
}
