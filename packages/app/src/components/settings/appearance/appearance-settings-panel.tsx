import { DEFAULT_UNIFIED_SETTINGS } from "@multi/contracts/settings";
import { toUserConversationDensity } from "@multi/shared/conversation-density";
import { Button } from "@multi/multikit/button";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "@multi/multikit/select";
import { Switch } from "@multi/multikit/switch";

import { useSettings, useUpdateSettings } from "../../../hooks/use-settings";
import { useTheme } from "../../../hooks/use-theme";
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
import { ToolCallDensitySlider } from "../tool-call-density-control";
import {
  AppearanceTintSlider,
  CodeFontFamilySettingsRow,
  FontFamilyInput,
  NumberStepper,
} from "./appearance-controls";

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

  return (
    <SettingsPageContainer>
      <SettingsSection title="Appearance">
        <SettingsRow
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
      </SettingsSection>

      <SettingsSection title="Colors">
        <SettingsRow
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
              onChange={appearanceSettingsActions.setTintHue}
            />
          }
        />
        <SettingsRow
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
              onChange={appearanceSettingsActions.setTintSaturation}
            />
          }
        />
        <SettingsRow
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
          title="Font Smoothing"
          description="Mac text smoothing."
          resetAction={
            settings.agentWindowFontSmoothingAntialiased !==
            DEFAULT_UNIFIED_SETTINGS.agentWindowFontSmoothingAntialiased ? (
              <SettingResetButton
                label="Agent Window font smoothing"
                onClick={() =>
                  updateSettings({
                    agentWindowFontSmoothingAntialiased:
                      DEFAULT_UNIFIED_SETTINGS.agentWindowFontSmoothingAntialiased,
                  })
                }
              />
            ) : null
          }
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

      <SettingsSection title="Chat">
        <SettingsRow
          title="Tool Call Density"
          description="Adjust how much detail is shown for tool calls"
          resetAction={
            settings.conversationDensity !== DEFAULT_UNIFIED_SETTINGS.conversationDensity ? (
              <SettingResetButton
                label="tool call density"
                onClick={() =>
                  updateSettings({
                    conversationDensity: DEFAULT_UNIFIED_SETTINGS.conversationDensity,
                  })
                }
              />
            ) : null
          }
          control={
            <ToolCallDensitySlider
              value={toUserConversationDensity(settings.conversationDensity)}
              onChange={(value) => {
                void updateSettings({ conversationDensity: value });
              }}
            />
          }
        />
      </SettingsSection>
    </SettingsPageContainer>
  );
}
