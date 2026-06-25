import { type AppIconVariant, DEFAULT_UNIFIED_SETTINGS } from "@honk/contracts/settings";
import { Button } from "@honk/honkkit/button";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "@honk/honkkit/select";
import { Switch } from "@honk/honkkit/switch";

import { APP_STAGE_LABEL } from "~/app/branding";

import { useSettings, useUpdateSettings } from "../../../hooks/use-settings";
import { useTheme } from "../../../hooks/use-theme";
import { previewTintHue, previewTintSaturation } from "../../../lib/appearance-settings";
import { cn, isMacPlatform } from "../../../lib/utils";
import {
  appearanceSettingsActions,
  useAppearanceSettingsSnapshot,
} from "../../../stores/appearance-store";
import {
  SettingResetButton,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "../settings-layout";
import { ToolCallDensityPreview, ToolCallDensitySlider } from "../tool-call-density-control";
import {
  AppearanceTintSlider,
  CodeFontFamilySettingsRow,
  FontFamilyInput,
  NumberStepper,
} from "./appearance-controls";

// The blueprint development icon is only offered in dev-stage builds, where it is
// also the effective default until the user picks a variant.
const IS_DEV_STAGE = APP_STAGE_LABEL === "Dev";
const DEFAULT_APP_ICON_VARIANT: AppIconVariant = IS_DEV_STAGE ? "dev" : "classic";

const APP_ICON_OPTIONS: ReadonlyArray<{ value: AppIconVariant; label: string }> = [
  { value: "classic", label: "Classic" },
  { value: "midnight", label: "Midnight" },
  { value: "sunset", label: "Sunset" },
  { value: "forest", label: "Forest" },
  ...(IS_DEV_STAGE ? ([{ value: "dev", label: "Dev" }] as const) : []),
];

function AppIconSettingsRow() {
  const appIconVariant = useSettings(
    (settings) => settings.appIconVariant ?? DEFAULT_APP_ICON_VARIANT,
  );
  const { updateSettings } = useUpdateSettings();

  return (
    <SettingsRow
      preferenceId="appearance.app-icon"
      title="App Icon"
      description="Dock icon shown while the app is running."
      resetAction={
        appIconVariant !== DEFAULT_APP_ICON_VARIANT ? (
          <SettingResetButton
            label="app icon"
            onClick={() => void updateSettings({ appIconVariant: DEFAULT_APP_ICON_VARIANT })}
          />
        ) : null
      }
      control={
        <div aria-label="App icon" className="flex items-center gap-1.5" role="radiogroup">
          {APP_ICON_OPTIONS.map((option) => {
            const selected = appIconVariant === option.value;
            return (
              <button
                key={option.value}
                aria-checked={selected}
                aria-label={option.label}
                className={cn(
                  "rounded-honk-control border p-1 outline-hidden transition-colors focus-visible:ring-1 focus-visible:ring-honk-stroke-focused",
                  selected
                    ? "border-honk-stroke-focused bg-honk-bg-tertiary"
                    : "border-transparent hover:border-honk-stroke-secondary hover:bg-honk-bg-quaternary",
                )}
                role="radio"
                title={option.label}
                type="button"
                onClick={() => void updateSettings({ appIconVariant: option.value })}
              >
                <img
                  alt={option.label}
                  className="size-9 select-none"
                  draggable={false}
                  src={`/app-icons/${option.value}.png`}
                />
              </button>
            );
          })}
        </div>
      }
    />
  );
}

const THEME_OPTIONS = [
  {
    value: "system",
    label: "System",
  },
  {
    value: "light",
    label: "Light",
  },
  {
    value: "dark",
    label: "Dark",
  },
] as const;

export function AppearanceSettingsPanel() {
  const { theme, setTheme } = useTheme();
  const appearance = useAppearanceSettingsSnapshot();
  const settings = useSettings();
  const { updateSettings } = useUpdateSettings();
  const supportsAppIconSwitching =
    typeof window !== "undefined" &&
    window.desktopBridge !== undefined &&
    isMacPlatform(navigator.platform);

  return (
    <SettingsPageContainer>
      <SettingsSection title="Appearance">
        <SettingsRow
          preferenceId="appearance.theme"
          title="Theme"
          description="Choose between light, dark, or system themes."
          resetAction={
            theme !== "system" ? (
              <SettingResetButton label="theme" onClick={() => setTheme("system")} />
            ) : null
          }
          control={
            <Select
              value={theme}
              onValueChange={(value) => {
                if (value === "system" || value === "light" || value === "dark") setTheme(value);
              }}
            >
              <SelectTrigger
                size="xs"
                variant="outline"
                className="w-full sm:w-28"
                aria-label="Theme preference"
              >
                <SelectValue>
                  {THEME_OPTIONS.find((option) => option.value === theme)?.label ?? "System"}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                {THEME_OPTIONS.map((option) => (
                  <SelectItem hideIndicator key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          }
        />
        {supportsAppIconSwitching ? <AppIconSettingsRow /> : null}
      </SettingsSection>

      <SettingsSection title="Chat">
        <SettingsRow
          preferenceId="appearance.tool-call-density"
          title="Tool Call Density"
          description="Adjust how much detail is shown for tool calls"
          control={
            <ToolCallDensitySlider
              value={settings.conversationDensity}
              onChange={(value) => {
                void updateSettings({ conversationDensity: value });
              }}
            />
          }
        >
          <ToolCallDensityPreview density={settings.conversationDensity} />
        </SettingsRow>
      </SettingsSection>

      <SettingsSection title="Colors">
        <SettingsRow
          preferenceId="appearance.tint-hue"
          title="Tint Hue"
          description="Shell and accent hue."
          control={
            <AppearanceTintSlider
              label="Accent hue"
              max={360}
              min={0}
              showSwatch
              tintHue={appearance.hue}
              tintSaturation={appearance.saturation}
              value={appearance.hue}
              variant="hue"
              onChange={(value) => previewTintHue(value, appearance.saturation)}
            />
          }
        />
        <SettingsRow
          preferenceId="appearance.tint-intensity"
          title="Tint Intensity"
          description="Shell tint strength."
          control={
            <AppearanceTintSlider
              label="Accent intensity"
              max={100}
              min={0}
              suffix="%"
              tintHue={appearance.hue}
              tintSaturation={appearance.saturation}
              value={appearance.saturation}
              variant="intensity"
              onChange={(value) => previewTintSaturation(appearance.hue, value)}
            />
          }
        />
        <SettingsRow
          preferenceId="appearance.reduce-transparency"
          title="Reduce Transparency"
          description="Use solid backgrounds."
          control={
            <Switch
              checked={appearance.reduceTransparency}
              aria-label="Reduce Transparency"
              onCheckedChange={(checked) =>
                appearanceSettingsActions.setReduceTransparency(Boolean(checked))
              }
            />
          }
        />
      </SettingsSection>

      <SettingsSection
        title="Typography"
        headerAction={
          <Button size="sm" variant="ghost" onClick={appearanceSettingsActions.reset}>
            Reset
          </Button>
        }
      >
        <SettingsRow
          preferenceId="appearance.ui-font-size"
          title="UI Font Size"
          description="Interface text size."
          control={
            <NumberStepper
              label="UI Font Size"
              max={16}
              min={11}
              value={appearance.uiFontSize}
              onChange={appearanceSettingsActions.setUiFontSize}
            />
          }
        />
        <SettingsRow
          preferenceId="appearance.code-font-size"
          title="Code Font Size"
          description="Editor text size."
          control={
            <NumberStepper
              label="Code Font Size"
              max={18}
              min={10}
              value={appearance.codeFontSize}
              onChange={appearanceSettingsActions.setCodeFontSize}
            />
          }
        />
        <SettingsRow
          preferenceId="appearance.ui-font-family"
          title="UI Font Family"
          description="Interface font."
          control={
            <FontFamilyInput
              key={appearance.uiFont}
              label="UI Font Family"
              value={appearance.uiFont}
              placeholder="System font"
              onChange={appearanceSettingsActions.setUiFontFamily}
            />
          }
        />
        <CodeFontFamilySettingsRow key={appearance.codeFont} codeFont={appearance.codeFont} />
      </SettingsSection>

      <SettingsSection title="Agent Window">
        <SettingsRow
          preferenceId="appearance.font-smoothing"
          title="Font Smoothing"
          description="Mac text smoothing."
          control={
            <Switch
              checked={settings.agentWindowFontSmoothingAntialiased}
              aria-label="Agent Window Font Smoothing"
              onCheckedChange={(checked) =>
                updateSettings({ agentWindowFontSmoothingAntialiased: Boolean(checked) })
              }
            />
          }
        />
        <SettingsRow
          preferenceId="appearance.pointer-cursors"
          title="Use pointer cursors"
          description="Pointer on controls."
          resetAction={
            settings.cursorPointerOnButtons !== DEFAULT_UNIFIED_SETTINGS.cursorPointerOnButtons ? (
              <SettingResetButton
                label="pointer cursors"
                onClick={() =>
                  updateSettings({
                    cursorPointerOnButtons: DEFAULT_UNIFIED_SETTINGS.cursorPointerOnButtons,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.cursorPointerOnButtons}
              aria-label="Use pointer cursors"
              onCheckedChange={(checked) =>
                updateSettings({ cursorPointerOnButtons: Boolean(checked) })
              }
            />
          }
        />
      </SettingsSection>
    </SettingsPageContainer>
  );
}
