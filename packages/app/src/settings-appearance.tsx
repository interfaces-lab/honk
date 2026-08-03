import * as stylex from "@stylexjs/stylex";
import {
  DEFAULT_CONVERSATION_DENSITY,
  type ConversationDensity,
} from "@honk/shared/conversation-density";
import {
  Button,
  Combobox,
  Picker,
  PreviewPicker,
  SegmentedControl,
  Switch,
  Text,
  type ComboboxGroup,
} from "@honk/ui";
import { borderVars, colorVars, controlVars, radiusVars, spaceVars } from "@honk/ui/tokens.stylex";
import * as React from "react";

import { actions as appSettingsActions, useAppSettings } from "./app-settings-store";
import {
  actions as appearanceActions,
  CODE_FONT_MAX,
  CODE_FONT_MIN,
  DEFAULT_APPEARANCE,
  UI_FONT_MAX,
  UI_FONT_MIN,
  useAppearance,
  type AppearanceSnapshot,
  type ThemePreference,
} from "./appearance-store";
import { useHonkDesktopCell, useHonkDesktopSettings } from "./desktop-extensions/runtime";
import type { HonkDesktopSettingsToggleContribution } from "./desktop-extensions/sdk";
import {
  NumberStepper,
  SettingResetButton,
  SettingsRow,
  SettingsRows,
  SettingsSection,
} from "./settings-controls";
import { DesktopSettingsToggleRow } from "./settings-desktop-toggle";
import { loadLocalFonts, useLocalFonts } from "./local-fonts-store";

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
const TAB_STYLE_CANVAS_RING = `inset 0 0 0 ${borderVars["--honk-border-hairline"]} ${colorVars["--honk-color-border-muted"]}`;

type TabStyle = "san-francisco" | "new-york";

const THEME_OPTIONS = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
] as const satisfies readonly { readonly value: ThemePreference; readonly label: string }[];

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
  resetAllSlot: {
    display: "inline-flex",
  },
  hiddenReset: {
    visibility: "hidden",
  },
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
    // oxlint-disable-next-line honk/design-no-raw-values -- 3px dot spacing is fixed miniature-preview geometry, no spacing token owns the preview scale
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
    // oxlint-disable-next-line honk/design-no-raw-values -- 3px tab spacing is fixed miniature-preview geometry, no spacing token owns the preview scale
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
    // oxlint-disable-next-line honk/design-no-raw-values -- 3px stage gutter is fixed miniature-preview geometry, no spacing token owns the preview scale
    gap: TAB_STYLE_STAGE_GUTTER,
    // oxlint-disable-next-line honk/design-no-raw-values -- 3px stage gutter is fixed miniature-preview geometry, no spacing token owns the preview scale
    padding: TAB_STYLE_STAGE_GUTTER,
    backgroundColor: colorVars["--honk-color-bg-deep"],
  },
  tabStyleSidebar: {
    width: TAB_STYLE_SIDEBAR_WIDTH,
    flexShrink: 0,
    display: "flex",
    flexDirection: "column",
    // oxlint-disable-next-line honk/design-no-raw-values -- 3px row spacing is fixed miniature-preview geometry, no spacing token owns the preview scale
    gap: TAB_STYLE_DOT_SIZE,
    // oxlint-disable-next-line honk/design-no-raw-values -- 3px row inset is fixed miniature-preview geometry, no spacing token owns the preview scale
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
    boxShadow: TAB_STYLE_CANVAS_RING,
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

export function ColorModeControl(props: {
  readonly value: ThemePreference;
  readonly onChange: (value: ThemePreference) => void;
}): React.ReactElement {
  return (
    <SegmentedControl
      value={props.value}
      options={THEME_OPTIONS}
      size="sm"
      accessibilityLabel="Color mode"
      onValueChange={props.onChange}
    />
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

  return <DesktopSettingsToggleRow setting={props.setting} />;
}

const SYSTEM_FONT_OPTION = "system";
const FONT_OPTION_PREFIX = "font:";

function FontFamilyControl({
  kind,
  value,
  onChange,
}: {
  readonly kind: "interface" | "code";
  readonly value: string | null;
  readonly onChange: (value: string | null) => void;
}): React.ReactElement {
  const localFonts = useLocalFonts();
  const systemLabel = kind === "interface" ? "System font" : "System monospace";
  const selectedValue = value === null ? SYSTEM_FONT_OPTION : `${FONT_OPTION_PREFIX}${value}`;
  const selectedIsMissing =
    value !== null && !localFonts.families.some((font) => font.family === value);
  const groups: readonly ComboboxGroup[] = [
    {
      label: "Default",
      pinned: true,
      options: [{ value: SYSTEM_FONT_OPTION, label: systemLabel }],
    },
    ...(selectedIsMissing
      ? [
          {
            label: "Current",
            pinned: true,
            options: [{ value: `${FONT_OPTION_PREFIX}${value}`, label: value }],
          },
        ]
      : []),
    ...(kind === "interface"
      ? [
          {
            label: "Fonts",
            options: localFonts.families.map((font) => ({
              value: `${FONT_OPTION_PREFIX}${font.family}`,
              label: font.family,
            })),
          },
        ]
      : [
          {
            label: "Monospace",
            options: localFonts.families.flatMap((font) =>
              font.isMonospace
                ? [
                    {
                      value: `${FONT_OPTION_PREFIX}${font.family}`,
                      label: font.family,
                    },
                  ]
                : [],
            ),
          },
          {
            label: "Other fonts",
            options: localFonts.families.flatMap((font) =>
              font.isMonospace
                ? []
                : [
                    {
                      value: `${FONT_OPTION_PREFIX}${font.family}`,
                      label: font.family,
                    },
                  ],
            ),
          },
        ]),
  ];
  const status =
    localFonts.phase === "idle" || localFonts.phase === "loading"
      ? "Loading fonts…"
      : localFonts.phase === "unavailable"
        ? "Local fonts are unavailable."
        : localFonts.families.length === 0
          ? "No local fonts are available."
          : undefined;

  return (
    <Combobox
      value={selectedValue}
      groups={groups}
      accessibilityLabel={kind === "interface" ? "Interface font" : "Code font"}
      searchPlaceholder="Search fonts"
      emptyLabel="No local fonts are available."
      noMatchesLabel="No matching fonts."
      {...(status === undefined ? {} : { status })}
      width="wide"
      layer="dialog"
      onOpenChange={(isOpen) => {
        if (isOpen) loadLocalFonts();
      }}
      onValueChange={(nextValue) => {
        onChange(
          nextValue === SYSTEM_FONT_OPTION ? null : nextValue.slice(FONT_OPTION_PREFIX.length),
        );
      }}
    >
      {value ?? systemLabel}
    </Combobox>
  );
}

function TypographySettings({
  appearance,
}: {
  readonly appearance: AppearanceSnapshot;
}): React.ReactElement {
  return (
    <SettingsSection title="Text">
      <SettingsRows>
        <SettingsRow
          title="Interface font"
          description="Override the typeface used throughout the interface."
          resetAction={
            appearance.uiFontFamily === DEFAULT_APPEARANCE.uiFontFamily ? null : (
              <SettingResetButton
                label="interface font"
                onClick={() => {
                  appearanceActions.resetUiFontFamily();
                }}
              />
            )
          }
          control={
            <FontFamilyControl
              kind="interface"
              value={appearance.uiFontFamily}
              onChange={(value) => {
                appearanceActions.setUiFontFamily(value);
              }}
            />
          }
        />
        <SettingsRow
          title="Code font"
          description="Override the typeface used for code, diffs, and terminals."
          resetAction={
            appearance.codeFontFamily === DEFAULT_APPEARANCE.codeFontFamily ? null : (
              <SettingResetButton
                label="code font"
                onClick={() => {
                  appearanceActions.resetCodeFontFamily();
                }}
              />
            )
          }
          control={
            <FontFamilyControl
              kind="code"
              value={appearance.codeFontFamily}
              onChange={(value) => {
                appearanceActions.setCodeFontFamily(value);
              }}
            />
          }
        />
        <SettingsRow
          title="Interface font size"
          description="Adjust text throughout the interface."
          resetAction={
            appearance.uiFontSize === DEFAULT_APPEARANCE.uiFontSize ? null : (
              <SettingResetButton
                label="interface font size"
                onClick={() => {
                  appearanceActions.resetUiFontSize();
                }}
              />
            )
          }
          control={
            <NumberStepper
              label="Interface font size"
              min={UI_FONT_MIN}
              max={UI_FONT_MAX}
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
              min={CODE_FONT_MIN}
              max={CODE_FONT_MAX}
              value={appearance.codeFontSize}
              onChange={(value) => {
                appearanceActions.setCodeFontSize(value);
              }}
            />
          }
        />
        <SettingsRow
          title="Font smoothing"
          description="Use native macOS font anti-aliasing."
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
            <Switch
              size="sm"
              checked={appearance.fontSmoothing === "antialiased"}
              aria-label="Font smoothing"
              onCheckedChange={(checked) => {
                appearanceActions.setFontSmoothing(checked ? "antialiased" : "auto");
              }}
            />
          }
        />
      </SettingsRows>
    </SettingsSection>
  );
}

export function SettingsAppearance(): React.ReactElement {
  const appearance = useAppearance();
  const appSettings = useAppSettings();
  const desktopSettings = useHonkDesktopSettings().filter(
    (setting) => (setting.section ?? "appearance") === "appearance",
  );
  const densityOption =
    DENSITY_OPTIONS.find((option) => option.value === appSettings.conversationDensity) ??
    DENSITY_OPTIONS[0];
  const isDirty =
    appearance.theme !== DEFAULT_APPEARANCE.theme ||
    appearance.tintHue !== DEFAULT_APPEARANCE.tintHue ||
    appearance.tintIntensity !== DEFAULT_APPEARANCE.tintIntensity ||
    appearance.uiFontFamily !== DEFAULT_APPEARANCE.uiFontFamily ||
    appearance.codeFontFamily !== DEFAULT_APPEARANCE.codeFontFamily ||
    appearance.uiFontSize !== DEFAULT_APPEARANCE.uiFontSize ||
    appearance.codeFontSize !== DEFAULT_APPEARANCE.codeFontSize ||
    appearance.fontSmoothing !== DEFAULT_APPEARANCE.fontSmoothing ||
    appSettings.conversationDensity !== DEFAULT_CONVERSATION_DENSITY ||
    appSettings.diffWordWrap;

  return (
    <>
      <SettingsSection
        action={
          <span
            aria-hidden={!isDirty}
            {...stylex.props(styles.resetAllSlot, !isDirty && styles.hiddenReset)}
          >
            <Button
              size="sm"
              variant="quiet"
              disabled={!isDirty}
              tabIndex={isDirty ? undefined : -1}
              onClick={() => {
                appearanceActions.resetAll();
                appSettingsActions.resetConversationDensity();
                appSettingsActions.resetDiffWordWrap();
              }}
            >
              Reset
            </Button>
          </span>
        }
      >
        <SettingsRows>
          <SettingsRow
            title="Color mode"
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
              <ColorModeControl
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

      <TypographySettings appearance={appearance} />

      <SettingsSection title="Layout">
        <SettingsRows>
          {desktopSettings.map((setting) => (
            <DesktopAppearanceSetting key={setting.key} setting={setting} />
          ))}
          <SettingsRow
            title="Work detail"
            description={densityOption.description}
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
          <SettingsRow
            title="Wrap long lines in diffs"
            description="Wrap code to the available width instead of scrolling horizontally."
            isLast
            resetAction={
              appSettings.diffWordWrap ? (
                <SettingResetButton
                  label="diff line wrapping"
                  onClick={() => {
                    appSettingsActions.resetDiffWordWrap();
                  }}
                />
              ) : null
            }
            control={
              <Switch
                size="sm"
                checked={appSettings.diffWordWrap}
                aria-label="Wrap long lines in diffs"
                onCheckedChange={(checked) => {
                  appSettingsActions.setDiffWordWrap(checked);
                }}
              />
            }
          />
        </SettingsRows>
      </SettingsSection>
    </>
  );
}
