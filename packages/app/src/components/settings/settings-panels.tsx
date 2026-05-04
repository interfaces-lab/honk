import {
  IconArchive,
  IconArchiveJunk,
  IconArrowRotateClockwise,
  IconLoader,
  IconPlusLarge,
} from "central-icons";
import { useQueryClient } from "@tanstack/react-query";
import {
  type ReactNode,
  useCallback,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  type DesktopUpdateChannel,
  defaultInstanceIdForDriver,
  type ProviderInstanceConfig,
  type ProviderInstanceId,
  type ScopedThreadRef,
  ProviderDriverKind,
  type ServerProvider,
} from "@multi/contracts";
import { scopeThreadRef } from "@multi/client-runtime";
import { DEFAULT_UNIFIED_SETTINGS } from "@multi/contracts/settings";
import { createModelSelection } from "@multi/shared/model";
import { Equal } from "effect";
import { APP_VERSION } from "../../branding";
import {
  readAppearanceSnapshot,
  resetAppearanceSettings,
  setCodeFontFamily,
  setCodeFontSize,
  setReduceTransparency,
  setTintHue,
  setTintSaturation,
  setUiFontFamily,
  setUiFontSize,
  setWindowTransparency,
  subscribeAppearanceSettings,
} from "../../lib/appearance-settings";
import {
  canCheckForUpdate,
  getDesktopUpdateButtonTooltip,
  getDesktopUpdateInstallConfirmationMessage,
  isDesktopUpdateButtonDisabled,
  resolveDesktopUpdateButtonAction,
} from "../../components/desktop-update.logic";
import { ProviderModelPicker } from "../chat/provider-model-picker";
import { TraitsPicker } from "../chat/traits-picker";
import { resolveAndPersistPreferredEditor } from "../../editor-preferences";
import { isElectron } from "../../env";
import { useTheme } from "../../hooks/use-theme";
import { useSettings, useUpdateSettings } from "../../hooks/use-settings";
import { useThreadActions } from "../../hooks/use-thread-actions";
import {
  setDesktopUpdateStateQueryData,
  useDesktopUpdateState,
} from "../../lib/desktop-update-react-query";
import {
  getCustomModelOptionsByInstance,
  resolveAppModelSelectionState,
} from "../../model-selection";
import { ensureLocalApi, readLocalApi } from "../../local-api";
import { useShallow } from "zustand/react/shallow";
import {
  selectProjectsAcrossEnvironments,
  selectThreadShellsAcrossEnvironments,
  useStore,
} from "../../store";
import { formatRelativeTimeLabel } from "../../timestamp-format";
import { Button } from "@multi/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@multi/ui/empty";
import { Input } from "@multi/ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "@multi/ui/select";
import { Switch } from "@multi/ui/switch";
import { Text } from "@multi/ui/text";
import { toastManager } from "~/app/toast";
import {
  deriveProviderInstanceEntries,
  sortProviderInstanceEntries,
} from "../../provider-instances";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@multi/ui/tooltip";
import {
  SettingResetButton,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "./settings-layout";
import { ProjectFavicon } from "../project-favicon";
import {
  useServerAvailableEditors,
  useServerKeybindingsConfigPath,
  useServerObservability,
  useServerProviders,
} from "../../rpc/server-state";
import { AddProviderInstanceDialog } from "./add-provider-instance-dialog";
import { ProviderInstanceCard } from "./provider-instance-card";
import { DRIVER_OPTIONS, getDriverOption } from "./provider-driver-meta";
import { buildProviderInstanceUpdatePatch } from "./settings-panels.logic";

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

const TIMESTAMP_FORMAT_LABELS = {
  locale: "System default",
  "12-hour": "12-hour",
  "24-hour": "24-hour",
} as const;

type ProviderSettingsDescriptor = {
  provider: typeof ProviderDriverKind.Type;
};

const PROVIDER_SETTINGS: readonly ProviderSettingsDescriptor[] = DRIVER_OPTIONS.map(
  (definition) => ({
    provider: definition.value,
  }),
);

const DEFAULT_APPEARANCE_SNAPSHOT = {
  palette: "multi",
  reduceTransparency: false,
  transparency: 18,
  hue: 255,
  saturation: 33,
  uiFontSize: 13,
  codeFontSize: 12,
  uiFont: "",
  codeFont: "",
} as const;

function readAppearanceSnapshotForSettings() {
  if (typeof window === "undefined") return DEFAULT_APPEARANCE_SNAPSHOT;
  return readAppearanceSnapshot();
}

function useAppearanceSettingsSnapshot() {
  return useSyncExternalStore(
    subscribeAppearanceSettings,
    readAppearanceSnapshotForSettings,
    () => DEFAULT_APPEARANCE_SNAPSHOT,
  );
}

function AboutVersionTitle() {
  return (
    <Text
      render={<span />}
      className="inline-flex items-center gap-2"
      size="sm"
      tone="primary"
      weight="medium"
    >
      <span>Version</span>
      <Text
        render={<code />}
        size="xs"
        tone="secondary"
        weight="medium"
        className="font-multi-mono"
      >
        {APP_VERSION}
      </Text>
    </Text>
  );
}

function AboutVersionSection() {
  const queryClient = useQueryClient();
  const updateStateQuery = useDesktopUpdateState();
  const [isChangingUpdateChannel, setIsChangingUpdateChannel] = useState(false);

  const updateState = updateStateQuery.data ?? null;
  const hasDesktopBridge = typeof window !== "undefined" && Boolean(window.desktopBridge);
  const selectedUpdateChannel = updateState?.channel ?? "latest";

  const handleUpdateChannelChange = useCallback(
    (channel: DesktopUpdateChannel) => {
      const bridge = window.desktopBridge;
      if (
        !bridge ||
        typeof bridge.setUpdateChannel !== "function" ||
        channel === selectedUpdateChannel
      ) {
        return;
      }

      setIsChangingUpdateChannel(true);
      void bridge
        .setUpdateChannel(channel)
        .then((state) => {
          setDesktopUpdateStateQueryData(queryClient, state);
        })
        .catch((error: unknown) => {
          toastManager.add({
            type: "error",
            title: "Could not change update track",
            description: error instanceof Error ? error.message : "Update track change failed.",
          });
        })
        .finally(() => {
          setIsChangingUpdateChannel(false);
        });
    },
    [queryClient, selectedUpdateChannel],
  );

  const handleButtonClick = useCallback(() => {
    const bridge = window.desktopBridge;
    if (!bridge) return;

    const action = updateState ? resolveDesktopUpdateButtonAction(updateState) : "none";

    if (action === "download") {
      void bridge
        .downloadUpdate()
        .then((result) => {
          setDesktopUpdateStateQueryData(queryClient, result.state);
        })
        .catch((error: unknown) => {
          toastManager.add({
            type: "error",
            title: "Could not download update",
            description: error instanceof Error ? error.message : "Download failed.",
          });
        });
      return;
    }

    if (action === "install") {
      const confirmed = window.confirm(
        getDesktopUpdateInstallConfirmationMessage(
          updateState ?? { availableVersion: null, downloadedVersion: null },
        ),
      );
      if (!confirmed) return;
      void bridge
        .installUpdate()
        .then((result) => {
          setDesktopUpdateStateQueryData(queryClient, result.state);
        })
        .catch((error: unknown) => {
          toastManager.add({
            type: "error",
            title: "Could not install update",
            description: error instanceof Error ? error.message : "Install failed.",
          });
        });
      return;
    }

    if (typeof bridge.checkForUpdate !== "function") return;
    void bridge
      .checkForUpdate()
      .then((result) => {
        setDesktopUpdateStateQueryData(queryClient, result.state);
        if (!result.checked) {
          toastManager.add({
            type: "error",
            title: "Could not check for updates",
            description:
              result.state.message ?? "Automatic updates are not available in this build.",
          });
        }
      })
      .catch((error: unknown) => {
        toastManager.add({
          type: "error",
          title: "Could not check for updates",
          description: error instanceof Error ? error.message : "Update check failed.",
        });
      });
  }, [queryClient, updateState]);

  const action = updateState ? resolveDesktopUpdateButtonAction(updateState) : "none";
  const buttonTooltip = updateState ? getDesktopUpdateButtonTooltip(updateState) : null;
  const buttonDisabled =
    action === "none"
      ? !canCheckForUpdate(updateState)
      : isDesktopUpdateButtonDisabled(updateState);

  const actionLabel: Record<string, string> = { download: "Download", install: "Install" };
  const statusLabel: Record<string, string> = {
    checking: "Checking…",
    downloading: "Downloading…",
    "up-to-date": "Up to Date",
  };
  const buttonLabel =
    actionLabel[action] ?? statusLabel[updateState?.status ?? ""] ?? "Check for Updates";
  const description =
    action === "download" || action === "install"
      ? "Update available."
      : "Current version of the application.";

  return (
    <>
      <SettingsRow
        title={<AboutVersionTitle />}
        description={description}
        control={
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="sm"
                  variant={action === "install" ? "default" : "outline"}
                  disabled={buttonDisabled}
                  onClick={handleButtonClick}
                >
                  {buttonLabel}
                </Button>
              }
            />
            {buttonTooltip ? <TooltipPopup>{buttonTooltip}</TooltipPopup> : null}
          </Tooltip>
        }
      />
      <SettingsRow
        title="Update track"
        description="Stable follows full releases. Nightly follows the nightly desktop channel and can switch back to stable immediately."
        control={
          <Select
            value={selectedUpdateChannel}
            onValueChange={(value) => {
              handleUpdateChannelChange(value as DesktopUpdateChannel);
            }}
          >
            <SelectTrigger
              size="xs"
              className="w-full sm:w-40"
              aria-label="Update track"
              disabled={!hasDesktopBridge || isChangingUpdateChannel}
            >
              <SelectValue>
                {selectedUpdateChannel === "nightly" ? "Nightly" : "Stable"}
              </SelectValue>
            </SelectTrigger>
            <SelectPopup align="end" alignItemWithTrigger={false}>
              <SelectItem hideIndicator value="latest">
                Stable
              </SelectItem>
              <SelectItem hideIndicator value="nightly">
                Nightly
              </SelectItem>
            </SelectPopup>
          </Select>
        }
      />
    </>
  );
}

export function useSettingsRestore(onRestored?: () => void) {
  const { theme, setTheme } = useTheme();
  const settings = useSettings();
  const { resetSettings } = useUpdateSettings();
  const appearance = useAppearanceSettingsSnapshot();

  const isGitWritingModelDirty = !Equal.equals(
    settings.textGenerationModelSelection ?? null,
    DEFAULT_UNIFIED_SETTINGS.textGenerationModelSelection ?? null,
  );
  const isAppearanceDirty = !Equal.equals(appearance, DEFAULT_APPEARANCE_SNAPSHOT);
  const areProviderSettingsDirty = PROVIDER_SETTINGS.some((providerSettings) => {
    const provider = providerSettings.provider as keyof typeof DEFAULT_UNIFIED_SETTINGS.providers;
    const currentSettings = settings.providers[provider];
    const defaultSettings = DEFAULT_UNIFIED_SETTINGS.providers[provider];
    return !Equal.equals(currentSettings, defaultSettings);
  });

  const changedSettingLabels = useMemo(
    () => [
      ...(theme !== "system" ? ["Theme"] : []),
      ...(settings.timestampFormat !== DEFAULT_UNIFIED_SETTINGS.timestampFormat
        ? ["Time format"]
        : []),
      ...(settings.diffWordWrap !== DEFAULT_UNIFIED_SETTINGS.diffWordWrap
        ? ["Diff line wrapping"]
        : []),
      ...(settings.enableAssistantStreaming !== DEFAULT_UNIFIED_SETTINGS.enableAssistantStreaming
        ? ["Assistant output"]
        : []),
      ...(settings.defaultThreadEnvMode !== DEFAULT_UNIFIED_SETTINGS.defaultThreadEnvMode
        ? ["New thread mode"]
        : []),
      ...(settings.addProjectBaseDirectory !== DEFAULT_UNIFIED_SETTINGS.addProjectBaseDirectory
        ? ["Add project base directory"]
        : []),
      ...(settings.confirmThreadArchive !== DEFAULT_UNIFIED_SETTINGS.confirmThreadArchive
        ? ["Archive confirmation"]
        : []),
      ...(settings.confirmThreadDelete !== DEFAULT_UNIFIED_SETTINGS.confirmThreadDelete
        ? ["Delete confirmation"]
        : []),
      ...(isAppearanceDirty ? ["Appearance"] : []),
      ...(isGitWritingModelDirty ? ["Git writing model"] : []),
      ...(areProviderSettingsDirty ? ["Providers"] : []),
    ],
    [
      areProviderSettingsDirty,
      isAppearanceDirty,
      isGitWritingModelDirty,
      settings.confirmThreadArchive,
      settings.confirmThreadDelete,
      settings.addProjectBaseDirectory,
      settings.defaultThreadEnvMode,
      settings.diffWordWrap,
      settings.enableAssistantStreaming,
      settings.timestampFormat,
      theme,
    ],
  );

  const restoreDefaults = useCallback(async () => {
    if (changedSettingLabels.length === 0) return;
    const api = readLocalApi();
    const confirmed = await (api ?? ensureLocalApi()).dialogs.confirm(
      ["Restore default settings?", `This will reset: ${changedSettingLabels.join(", ")}.`].join(
        "\n",
      ),
    );
    if (!confirmed) return;

    setTheme("system");
    resetAppearanceSettings();
    resetSettings();
    onRestored?.();
  }, [changedSettingLabels, onRestored, resetSettings, setTheme]);

  return {
    changedSettingLabels,
    restoreDefaults,
  };
}

function SettingsSlider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  swatchHue?: number;
  suffix?: string;
}) {
  return (
    <div className="flex w-full items-center justify-end gap-2 sm:w-34">
      <input
        aria-label={props.label}
        className="h-4 w-full accent-(--multi-hue-blue)"
        max={props.max}
        min={props.min}
        type="range"
        value={props.value}
        onChange={(event) => props.onChange(Number(event.target.value))}
      />
      {props.swatchHue !== undefined ? (
        <span
          aria-hidden
          className="size-4 shrink-0 rounded-full"
          style={{
            background: `oklch(0.58 0.18 ${props.swatchHue})`,
          }}
        />
      ) : (
        <Text size="xs" tone="tertiary" className="w-8 shrink-0 text-right tabular-nums">
          {props.value}
          {props.suffix ?? ""}
        </Text>
      )}
    </div>
  );
}

function NumberStepper(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  const set = (next: number) => props.onChange(Math.min(props.max, Math.max(props.min, next)));

  return (
    <div className="inline-flex h-8 min-h-8 items-stretch overflow-hidden rounded-multi-control border border-multi-stroke-tertiary bg-multi-bg-quinary text-[12px]/[16px] shadow-none">
      <Button
        type="button"
        variant="ghost"
        className="h-8 min-h-8 w-8 shrink-0 rounded-none border-transparent px-0 text-multi-fg-tertiary shadow-none hover:bg-multi-bg-quaternary hover:text-multi-fg-primary"
        aria-label={`Decrease ${props.label}`}
        onClick={() => set(props.value - 1)}
      >
        -
      </Button>
      <input
        aria-label={props.label}
        className="-mx-px h-full min-h-8 w-10 shrink-0 border-x border-multi-stroke-tertiary bg-transparent py-1 text-center tabular-nums outline-none focus-visible:relative focus-visible:z-[1] focus-visible:border-multi-stroke-secondary"
        max={props.max}
        min={props.min}
        type="number"
        value={props.value}
        onChange={(event) => set(Number(event.target.value))}
      />
      <Button
        type="button"
        variant="ghost"
        className="h-8 min-h-8 w-8 shrink-0 rounded-none border-transparent px-0 text-multi-fg-tertiary shadow-none hover:bg-multi-bg-quaternary hover:text-multi-fg-primary"
        aria-label={`Increase ${props.label}`}
        onClick={() => set(props.value + 1)}
      >
        +
      </Button>
    </div>
  );
}

export function GeneralSettingsPanel() {
  const settings = useSettings();
  const { updateSettings } = useUpdateSettings();
  const availableEditors = useServerAvailableEditors();
  const observability = useServerObservability();
  const keybindingsConfigPath = useServerKeybindingsConfigPath();
  const [openingPathByTarget, setOpeningPathByTarget] = useState({
    keybindings: false,
    logsDirectory: false,
  });
  const [openPathErrorByTarget, setOpenPathErrorByTarget] = useState<
    Partial<Record<"keybindings" | "logsDirectory", string | null>>
  >({});

  const logsDirectoryPath = observability?.logsDirectoryPath ?? null;
  const diagnosticsDescription = observability?.localTracingEnabled
    ? "Local trace file."
    : "Terminal logs only.";

  const openInPreferredEditor = useCallback(
    (target: "keybindings" | "logsDirectory", path: string | null, failureMessage: string) => {
      if (!path) return;
      setOpenPathErrorByTarget((existing) => ({ ...existing, [target]: null }));
      setOpeningPathByTarget((existing) => ({ ...existing, [target]: true }));

      const editor = resolveAndPersistPreferredEditor(availableEditors ?? []);
      if (!editor) {
        setOpenPathErrorByTarget((existing) => ({
          ...existing,
          [target]: "No available editors found.",
        }));
        setOpeningPathByTarget((existing) => ({ ...existing, [target]: false }));
        return;
      }

      void ensureLocalApi()
        .shell.openInEditor(path, editor)
        .catch((error) => {
          setOpenPathErrorByTarget((existing) => ({
            ...existing,
            [target]: error instanceof Error ? error.message : failureMessage,
          }));
        })
        .finally(() => {
          setOpeningPathByTarget((existing) => ({ ...existing, [target]: false }));
        });
    },
    [availableEditors],
  );

  return (
    <SettingsPageContainer>
      <SettingsSection title="General">
        <SettingsRow
          title="Time format"
          description="System default follows your browser or OS clock preference."
          resetAction={
            settings.timestampFormat !== DEFAULT_UNIFIED_SETTINGS.timestampFormat ? (
              <SettingResetButton
                label="time format"
                onClick={() =>
                  updateSettings({ timestampFormat: DEFAULT_UNIFIED_SETTINGS.timestampFormat })
                }
              />
            ) : null
          }
          control={
            <Select
              value={settings.timestampFormat}
              onValueChange={(value) => {
                if (value === "locale" || value === "12-hour" || value === "24-hour") {
                  updateSettings({ timestampFormat: value });
                }
              }}
            >
              <SelectTrigger size="xs" className="w-full sm:w-34" aria-label="Timestamp format">
                <SelectValue>{TIMESTAMP_FORMAT_LABELS[settings.timestampFormat]}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                <SelectItem hideIndicator value="locale">
                  {TIMESTAMP_FORMAT_LABELS.locale}
                </SelectItem>
                <SelectItem hideIndicator value="12-hour">
                  {TIMESTAMP_FORMAT_LABELS["12-hour"]}
                </SelectItem>
                <SelectItem hideIndicator value="24-hour">
                  {TIMESTAMP_FORMAT_LABELS["24-hour"]}
                </SelectItem>
              </SelectPopup>
            </Select>
          }
        />
        <SettingsRow
          title="Add project starts in"
          description='Leave empty to use "~/" when the Add Project browser opens.'
          resetAction={
            settings.addProjectBaseDirectory !==
            DEFAULT_UNIFIED_SETTINGS.addProjectBaseDirectory ? (
              <SettingResetButton
                label="add project base directory"
                onClick={() =>
                  updateSettings({
                    addProjectBaseDirectory: DEFAULT_UNIFIED_SETTINGS.addProjectBaseDirectory,
                  })
                }
              />
            ) : null
          }
          control={
            <Input
              size="sm"
              className="w-full sm:w-34"
              value={settings.addProjectBaseDirectory}
              onChange={(event) => updateSettings({ addProjectBaseDirectory: event.target.value })}
              placeholder="~/"
              spellCheck={false}
              aria-label="Add project base directory"
            />
          }
        />
      </SettingsSection>

      <SettingsSection title="Advanced">
        <SettingsRow
          title="Keybindings"
          description="Open the persisted keybindings file to edit advanced bindings directly."
          status={
            <>
              <Text
                render={<span />}
                size="xs"
                tone="secondary"
                className="block break-all font-multi-mono"
              >
                {keybindingsConfigPath ?? "Resolving keybindings path..."}
              </Text>
              {openPathErrorByTarget.keybindings ? (
                <Text render={<span />} size="xs" className="mt-1 block text-destructive">
                  {openPathErrorByTarget.keybindings}
                </Text>
              ) : null}
            </>
          }
          control={
            <Button
              size="sm"
              variant="outline"
              disabled={!keybindingsConfigPath || openingPathByTarget.keybindings}
              onClick={() =>
                openInPreferredEditor(
                  "keybindings",
                  keybindingsConfigPath,
                  "Unable to open keybindings file.",
                )
              }
            >
              {openingPathByTarget.keybindings ? "Opening..." : "Open"}
            </Button>
          }
        />
      </SettingsSection>

      <SettingsSection title="About">
        {isElectron ? (
          <AboutVersionSection />
        ) : (
          <SettingsRow
            title={<AboutVersionTitle />}
            description="Current version of the application."
          />
        )}
        <SettingsRow
          title="Diagnostics"
          description={diagnosticsDescription}
          status={
            <>
              <Text
                render={<span />}
                size="xs"
                tone="secondary"
                className="block break-all font-multi-mono"
              >
                {logsDirectoryPath ?? "Resolving logs directory..."}
              </Text>
              {openPathErrorByTarget.logsDirectory ? (
                <Text render={<span />} size="xs" className="mt-1 block text-destructive">
                  {openPathErrorByTarget.logsDirectory}
                </Text>
              ) : null}
            </>
          }
          control={
            <Button
              size="sm"
              variant="outline"
              disabled={!logsDirectoryPath || openingPathByTarget.logsDirectory}
              onClick={() =>
                openInPreferredEditor(
                  "logsDirectory",
                  logsDirectoryPath,
                  "Unable to open logs folder.",
                )
              }
            >
              {openingPathByTarget.logsDirectory ? "Opening..." : "Open"}
            </Button>
          }
        />
      </SettingsSection>
    </SettingsPageContainer>
  );
}

export function AppearanceSettingsPanel() {
  const { theme, setTheme } = useTheme();
  const appearance = useAppearanceSettingsSnapshot();

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
              <SelectTrigger size="xs" className="w-full sm:w-28" aria-label="Theme preference">
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
          title="Hue"
          description="Choose a tint color."
          control={
            <SettingsSlider
              label="Tint hue"
              max={360}
              min={0}
              swatchHue={appearance.hue}
              value={appearance.hue}
              onChange={setTintHue}
            />
          }
        />
        <SettingsRow
          title="Intensity"
          description="Control how strongly the tint is applied."
          control={
            <SettingsSlider
              label="Tint intensity"
              max={100}
              min={0}
              suffix="%"
              value={appearance.saturation}
              onChange={setTintSaturation}
            />
          }
        />
        <SettingsRow
          title="Glass transparency"
          description="Control the opacity of translucent window surfaces."
          control={
            <SettingsSlider
              label="Window transparency"
              max={100}
              min={0}
              suffix="%"
              value={appearance.transparency}
              onChange={setWindowTransparency}
            />
          }
        />
        <SettingsRow
          title="Reduce Transparency"
          description="Replace translucent surfaces with opaque backgrounds."
          control={
            <Switch
              checked={appearance.reduceTransparency}
              aria-label="Reduce Transparency"
              onCheckedChange={(checked) => setReduceTransparency(Boolean(checked))}
            />
          }
        />
      </SettingsSection>

      <SettingsSection
        title="Typography"
        headerAction={
          <Button size="sm" variant="ghost" onClick={resetAppearanceSettings}>
            Reset
          </Button>
        }
      >
        <SettingsRow
          title="UI Font Size"
          description="Font size for the Multi user interface."
          control={
            <NumberStepper
              label="UI Font Size"
              max={16}
              min={11}
              value={appearance.uiFontSize}
              onChange={setUiFontSize}
            />
          }
        />
        <SettingsRow
          title="Code Font Size"
          description="Font size for code editors and diffs."
          control={
            <NumberStepper
              label="Code Font Size"
              max={18}
              min={10}
              value={appearance.codeFontSize}
              onChange={setCodeFontSize}
            />
          }
        />
        <SettingsRow
          title="UI Font Family"
          description="Override the Multi user interface typeface."
          control={
            <Input
              size="sm"
              className="w-full sm:w-36"
              value={appearance.uiFont}
              placeholder="System font"
              aria-label="UI Font Family"
              onChange={(event) => setUiFontFamily(event.target.value)}
            />
          }
        />
        <SettingsRow
          title="Code Font Family"
          description="Override the font for code editors and diffs."
          control={
            <Input
              size="sm"
              className="w-full sm:w-36"
              value={appearance.codeFont}
              placeholder="System monospace"
              aria-label="Code Font Family"
              onChange={(event) => setCodeFontFamily(event.target.value)}
            />
          }
        >
          <div className="mt-2 overflow-hidden rounded-sm text-[11px]/[16px]">
            <div className="flex bg-rose-500/10 font-multi-mono text-foreground/72">
              <span className="w-8 shrink-0 text-center text-rose-500/80">1</span>
              <span>return a + b;</span>
            </div>
            <div className="flex bg-emerald-500/10 font-multi-mono text-foreground/72">
              <span className="w-8 shrink-0 text-center text-emerald-600/80">1</span>
              <span>const result = a + b;</span>
            </div>
            <div className="flex bg-emerald-500/10 font-multi-mono text-foreground/72">
              <span className="w-8 shrink-0 text-center text-emerald-600/80">2</span>
              <span>return result;</span>
            </div>
          </div>
        </SettingsRow>
      </SettingsSection>
    </SettingsPageContainer>
  );
}

export function AgentsSettingsPanel() {
  const settings = useSettings();
  const { updateSettings } = useUpdateSettings();

  return (
    <SettingsPageContainer>
      <SettingsSection title="Agents">
        <SettingsRow
          title="Assistant output"
          description="Show token-by-token output while a response is in progress."
          resetAction={
            settings.enableAssistantStreaming !==
            DEFAULT_UNIFIED_SETTINGS.enableAssistantStreaming ? (
              <SettingResetButton
                label="assistant output"
                onClick={() =>
                  updateSettings({
                    enableAssistantStreaming: DEFAULT_UNIFIED_SETTINGS.enableAssistantStreaming,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.enableAssistantStreaming}
              aria-label="Stream assistant messages"
              onCheckedChange={(checked) =>
                updateSettings({ enableAssistantStreaming: Boolean(checked) })
              }
            />
          }
        />
        <SettingsRow
          title="New threads"
          description="Pick the default workspace mode for newly created draft threads."
          resetAction={
            settings.defaultThreadEnvMode !== DEFAULT_UNIFIED_SETTINGS.defaultThreadEnvMode ? (
              <SettingResetButton
                label="new threads"
                onClick={() =>
                  updateSettings({
                    defaultThreadEnvMode: DEFAULT_UNIFIED_SETTINGS.defaultThreadEnvMode,
                  })
                }
              />
            ) : null
          }
          control={
            <Select
              value={settings.defaultThreadEnvMode}
              onValueChange={(value) => {
                if (value === "local" || value === "worktree") {
                  updateSettings({ defaultThreadEnvMode: value });
                }
              }}
            >
              <SelectTrigger size="xs" className="w-full sm:w-34" aria-label="Default thread mode">
                <SelectValue>
                  {settings.defaultThreadEnvMode === "worktree" ? "New worktree" : "Local"}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                <SelectItem hideIndicator value="local">
                  Local
                </SelectItem>
                <SelectItem hideIndicator value="worktree">
                  New worktree
                </SelectItem>
              </SelectPopup>
            </Select>
          }
        />
      </SettingsSection>

      <SettingsSection title="Review">
        <SettingsRow
          title="Diff line wrapping"
          description="Set the default wrap state when the diff panel opens."
          resetAction={
            settings.diffWordWrap !== DEFAULT_UNIFIED_SETTINGS.diffWordWrap ? (
              <SettingResetButton
                label="diff line wrapping"
                onClick={() =>
                  updateSettings({ diffWordWrap: DEFAULT_UNIFIED_SETTINGS.diffWordWrap })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.diffWordWrap}
              aria-label="Wrap diff lines by default"
              onCheckedChange={(checked) => updateSettings({ diffWordWrap: Boolean(checked) })}
            />
          }
        />
        <SettingsRow
          title="Archive confirmation"
          description="Require a second click before a thread is archived."
          resetAction={
            settings.confirmThreadArchive !== DEFAULT_UNIFIED_SETTINGS.confirmThreadArchive ? (
              <SettingResetButton
                label="archive confirmation"
                onClick={() =>
                  updateSettings({
                    confirmThreadArchive: DEFAULT_UNIFIED_SETTINGS.confirmThreadArchive,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.confirmThreadArchive}
              aria-label="Confirm thread archiving"
              onCheckedChange={(checked) =>
                updateSettings({ confirmThreadArchive: Boolean(checked) })
              }
            />
          }
        />
        <SettingsRow
          title="Delete confirmation"
          description="Ask before deleting a thread and its chat history."
          resetAction={
            settings.confirmThreadDelete !== DEFAULT_UNIFIED_SETTINGS.confirmThreadDelete ? (
              <SettingResetButton
                label="delete confirmation"
                onClick={() =>
                  updateSettings({
                    confirmThreadDelete: DEFAULT_UNIFIED_SETTINGS.confirmThreadDelete,
                  })
                }
              />
            ) : null
          }
          control={
            <Switch
              checked={settings.confirmThreadDelete}
              aria-label="Confirm thread deletion"
              onCheckedChange={(checked) =>
                updateSettings({ confirmThreadDelete: Boolean(checked) })
              }
            />
          }
        />
      </SettingsSection>
    </SettingsPageContainer>
  );
}

function withoutProviderInstanceKey<V>(
  record: Readonly<Record<ProviderInstanceId, V>> | undefined,
  key: ProviderInstanceId,
): Record<ProviderInstanceId, V> {
  const next = { ...record } as Record<ProviderInstanceId, V>;
  delete next[key];
  return next;
}

function withoutProviderInstanceFavorites(
  favorites: ReadonlyArray<{ readonly provider: ProviderInstanceId; readonly model: string }>,
  instanceId: ProviderInstanceId,
) {
  return favorites.filter((favorite) => favorite.provider !== instanceId);
}

const DEFAULT_DRIVER_KIND = ProviderDriverKind.make("codex");

export function ModelsSettingsPanel() {
  const settings = useSettings();
  const { updateSettings } = useUpdateSettings();
  const serverProviders = useServerProviders();
  const [isRefreshingProviders, setIsRefreshingProviders] = useState(false);
  const [isAddInstanceDialogOpen, setIsAddInstanceDialogOpen] = useState(false);
  const [openInstanceDetails, setOpenInstanceDetails] = useState<Record<string, boolean>>({});
  const refreshingRef = useRef(false);

  const visibleProviderSettings = PROVIDER_SETTINGS;

  const textGenerationModelSelection = resolveAppModelSelectionState(settings, serverProviders);
  const textGenInstanceId = textGenerationModelSelection.instanceId;
  const textGenModel = textGenerationModelSelection.model;
  const textGenModelOptions = textGenerationModelSelection.options;
  const gitModelInstanceEntries = sortProviderInstanceEntries(
    deriveProviderInstanceEntries(serverProviders),
  );
  const textGenInstanceEntry = gitModelInstanceEntries.find(
    (entry) => entry.instanceId === textGenInstanceId,
  );
  const textGenProvider: ProviderDriverKind =
    textGenInstanceEntry?.driverKind ?? DEFAULT_DRIVER_KIND;
  const gitModelOptionsByInstance = getCustomModelOptionsByInstance(
    settings,
    serverProviders,
    textGenInstanceId,
    textGenModel,
  );
  const isGitWritingModelDirty = !Equal.equals(
    settings.textGenerationModelSelection ?? null,
    DEFAULT_UNIFIED_SETTINGS.textGenerationModelSelection ?? null,
  );

  const refreshProviders = useCallback(() => {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setIsRefreshingProviders(true);
    void ensureLocalApi()
      .server.refreshProviders()
      .catch((error: unknown) => {
        console.warn("Failed to refresh providers", error);
      })
      .finally(() => {
        refreshingRef.current = false;
        setIsRefreshingProviders(false);
      });
  }, []);

  interface InstanceRow {
    readonly instanceId: ProviderInstanceId;
    readonly instance: ProviderInstanceConfig;
    readonly driver: ProviderDriverKind;
    readonly isDefault: boolean;
    readonly isDirty?: boolean;
  }

  const instancesByDriver = new Map<
    ProviderDriverKind,
    Array<[ProviderInstanceId, ProviderInstanceConfig]>
  >();
  for (const [rawId, instance] of Object.entries(settings.providerInstances ?? {})) {
    const driver = instance.driver;
    const list = instancesByDriver.get(driver) ?? [];
    list.push([rawId as ProviderInstanceId, instance]);
    instancesByDriver.set(driver, list);
  }

  const defaultSlotIdsBySource = new Set<string>(
    visibleProviderSettings.map((providerSettings) =>
      String(defaultInstanceIdForDriver(providerSettings.provider)),
    ),
  );

  const rows: InstanceRow[] = [];
  const visibleDriverKinds = new Set<ProviderDriverKind>(
    visibleProviderSettings.map((providerSettings) => providerSettings.provider),
  );

  for (const providerSettings of visibleProviderSettings) {
    type LegacyProviderSettings = (typeof settings.providers)[keyof typeof settings.providers];
    const legacyProviders = settings.providers as Record<string, LegacyProviderSettings>;
    const defaultLegacyProviders = DEFAULT_UNIFIED_SETTINGS.providers as Record<
      string,
      LegacyProviderSettings
    >;
    const driver = providerSettings.provider;
    const defaultInstanceId = defaultInstanceIdForDriver(driver);
    const explicitInstance = settings.providerInstances?.[defaultInstanceId];
    const legacyConfig = legacyProviders[providerSettings.provider]!;
    const defaultLegacyConfig = defaultLegacyProviders[providerSettings.provider]!;
    const effectiveInstance: ProviderInstanceConfig =
      explicitInstance ??
      ({
        driver,
        enabled: legacyConfig.enabled,
        config: legacyConfig,
      } satisfies ProviderInstanceConfig);
    const isDirty =
      explicitInstance !== undefined || !Equal.equals(legacyConfig, defaultLegacyConfig);
    rows.push({
      instanceId: defaultInstanceId,
      instance: effectiveInstance,
      driver,
      isDefault: true,
      isDirty,
    });
    for (const [id, instance] of instancesByDriver.get(providerSettings.provider) ?? []) {
      if (id === defaultInstanceId) continue;
      rows.push({ instanceId: id, instance, driver: instance.driver, isDefault: false });
    }
  }

  for (const [driver, list] of instancesByDriver) {
    if (visibleDriverKinds.has(driver)) continue;
    for (const [id, instance] of list) {
      const isDefaultSlot = defaultSlotIdsBySource.has(String(id));
      rows.push({
        instanceId: id,
        instance,
        driver: instance.driver,
        isDefault: isDefaultSlot,
      });
    }
  }

  const updateProviderInstance = (
    row: InstanceRow,
    next: ProviderInstanceConfig,
    options?: {
      readonly textGenerationModelSelection?: Parameters<
        typeof buildProviderInstanceUpdatePatch
      >[0]["textGenerationModelSelection"];
    },
  ) => {
    updateSettings(
      buildProviderInstanceUpdatePatch({
        settings,
        instanceId: row.instanceId,
        instance: next,
        driver: row.driver,
        isDefault: row.isDefault,
        textGenerationModelSelection: options?.textGenerationModelSelection,
      }),
    );
  };

  const deleteProviderInstance = (id: ProviderInstanceId) => {
    updateSettings({
      providerInstances: withoutProviderInstanceKey(settings.providerInstances, id),
      providerModelPreferences: withoutProviderInstanceKey(settings.providerModelPreferences, id),
      favorites: withoutProviderInstanceFavorites(settings.favorites ?? [], id),
    });
  };

  const updateProviderModelPreferences = (
    instanceId: ProviderInstanceId,
    next: {
      readonly hiddenModels: ReadonlyArray<string>;
      readonly modelOrder: ReadonlyArray<string>;
    },
  ) => {
    const hiddenModels = [...new Set(next.hiddenModels.filter((slug) => slug.trim().length > 0))];
    const modelOrder = [...new Set(next.modelOrder.filter((slug) => slug.trim().length > 0))];
    const rest = withoutProviderInstanceKey(settings.providerModelPreferences, instanceId);
    updateSettings({
      providerModelPreferences:
        hiddenModels.length === 0 && modelOrder.length === 0
          ? rest
          : {
              ...rest,
              [instanceId]: {
                hiddenModels,
                modelOrder,
              },
            },
    });
  };

  const updateProviderFavoriteModels = (
    instanceId: ProviderInstanceId,
    nextFavoriteModels: ReadonlyArray<string>,
  ) => {
    const favoriteModels = [
      ...new Set(nextFavoriteModels.map((slug) => slug.trim()).filter((slug) => slug.length > 0)),
    ];
    updateSettings({
      favorites: [
        ...withoutProviderInstanceFavorites(settings.favorites ?? [], instanceId),
        ...favoriteModels.map((model) => ({ provider: instanceId, model })),
      ],
    });
  };

  const resetDefaultInstance = (driverKind: ProviderDriverKind) => {
    type LegacyProviderSettings = (typeof settings.providers)[keyof typeof settings.providers];
    const defaultLegacyProviders = DEFAULT_UNIFIED_SETTINGS.providers as Record<
      string,
      LegacyProviderSettings | undefined
    >;
    const defaultInstanceId = defaultInstanceIdForDriver(driverKind);
    const defaultLegacyProvider = defaultLegacyProviders[driverKind];
    if (defaultLegacyProvider === undefined) return;
    updateSettings({
      providers: {
        ...settings.providers,
        [driverKind]: defaultLegacyProvider,
      } as typeof settings.providers,
      providerInstances: withoutProviderInstanceKey(settings.providerInstances, defaultInstanceId),
      providerModelPreferences: withoutProviderInstanceKey(
        settings.providerModelPreferences,
        defaultInstanceId,
      ),
      favorites: withoutProviderInstanceFavorites(settings.favorites ?? [], defaultInstanceId),
    });
  };

  return (
    <SettingsPageContainer>
      <SettingsSection title="Models">
        <SettingsRow
          title="Text generation model"
          description="Configure the model used for generated commit messages, PR titles, and similar Git text."
          resetAction={
            isGitWritingModelDirty ? (
              <SettingResetButton
                label="text generation model"
                onClick={() =>
                  updateSettings({
                    textGenerationModelSelection:
                      DEFAULT_UNIFIED_SETTINGS.textGenerationModelSelection,
                  })
                }
              />
            ) : null
          }
          control={
            <div className="flex flex-wrap items-center justify-end gap-1.5">
              <ProviderModelPicker
                activeInstanceId={textGenInstanceId}
                model={textGenModel}
                lockedProvider={null}
                instanceEntries={gitModelInstanceEntries}
                modelOptionsByInstance={gitModelOptionsByInstance}
                triggerVariant="outline"
                triggerClassName="min-w-0 max-w-none shrink-0 text-foreground/90 hover:text-foreground"
                onInstanceModelChange={(instanceId, model) => {
                  updateSettings({
                    textGenerationModelSelection: resolveAppModelSelectionState(
                      {
                        ...settings,
                        textGenerationModelSelection: createModelSelection(instanceId, model),
                      },
                      serverProviders,
                    ),
                  });
                }}
              />
              <TraitsPicker
                provider={textGenProvider}
                models={textGenInstanceEntry?.models ?? []}
                model={textGenModel}
                prompt=""
                onPromptChange={() => {}}
                modelOptions={textGenModelOptions}
                allowPromptInjectedEffort={false}
                triggerVariant="outline"
                triggerClassName="min-w-0 max-w-none shrink-0 text-foreground/90 hover:text-foreground"
                onModelOptionsChange={(nextOptions) => {
                  updateSettings({
                    textGenerationModelSelection: resolveAppModelSelectionState(
                      {
                        ...settings,
                        textGenerationModelSelection: createModelSelection(
                          textGenInstanceId,
                          textGenModel,
                          nextOptions,
                        ),
                      },
                      serverProviders,
                    ),
                  });
                }}
              />
            </div>
          }
        />
      </SettingsSection>

      <SettingsSection
        title="Providers"
        headerAction={
          <div className="flex items-center gap-1.5">
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    className="size-5 rounded-sm p-0 text-muted-foreground hover:text-foreground"
                    onClick={() => setIsAddInstanceDialogOpen(true)}
                    aria-label="Add provider instance"
                  >
                    <IconPlusLarge className="size-3" />
                  </Button>
                }
              />
              <TooltipPopup side="top">Add provider instance</TooltipPopup>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    size="icon-xs"
                    variant="ghost"
                    className="size-5 rounded-sm p-0 text-muted-foreground hover:text-foreground"
                    disabled={isRefreshingProviders}
                    onClick={() => void refreshProviders()}
                    aria-label="Refresh provider status"
                  >
                    {isRefreshingProviders ? (
                      <IconLoader className="size-3 animate-spin" />
                    ) : (
                      <IconArrowRotateClockwise className="size-3" />
                    )}
                  </Button>
                }
              />
              <TooltipPopup side="top">Refresh provider status</TooltipPopup>
            </Tooltip>
          </div>
        }
      >
        {rows.map((row) => {
          const driverOption = getDriverOption(row.driver);
          const liveProvider = serverProviders.find(
            (candidate) => candidate.instanceId === row.instanceId,
          );
          const modelPreferences = settings.providerModelPreferences?.[row.instanceId] ?? {
            hiddenModels: [],
            modelOrder: [],
          };
          const favoriteModels = (settings.favorites ?? [])
            .filter((favorite) => favorite.provider === row.instanceId)
            .map((favorite) => favorite.model);
          const resetLabel = driverOption?.label ?? String(row.driver);
          const headerAction =
            row.isDefault && row.isDirty ? (
              <SettingResetButton
                label={`${resetLabel} provider settings`}
                onClick={() => resetDefaultInstance(row.driver)}
              />
            ) : null;
          return (
            <ProviderInstanceCard
              key={row.instanceId}
              instanceId={row.instanceId}
              instance={row.instance}
              driverOption={driverOption}
              liveProvider={liveProvider}
              isExpanded={openInstanceDetails[row.instanceId] ?? false}
              onExpandedChange={(open) =>
                setOpenInstanceDetails((existing) => ({
                  ...existing,
                  [row.instanceId]: open,
                }))
              }
              onUpdate={(next) => {
                const wasEnabled = row.instance.enabled ?? true;
                const isDisabling = next.enabled === false && wasEnabled;
                const shouldClearTextGen = isDisabling && textGenInstanceId === row.instanceId;
                if (shouldClearTextGen) {
                  updateProviderInstance(row, next, {
                    textGenerationModelSelection:
                      DEFAULT_UNIFIED_SETTINGS.textGenerationModelSelection,
                  });
                } else {
                  updateProviderInstance(row, next);
                }
              }}
              onDelete={row.isDefault ? undefined : () => deleteProviderInstance(row.instanceId)}
              headerAction={headerAction}
              hiddenModels={modelPreferences.hiddenModels}
              favoriteModels={favoriteModels}
              modelOrder={modelPreferences.modelOrder}
              onHiddenModelsChange={(hiddenModels) =>
                updateProviderModelPreferences(row.instanceId, {
                  ...modelPreferences,
                  hiddenModels,
                })
              }
              onFavoriteModelsChange={(favoriteModels) =>
                updateProviderFavoriteModels(row.instanceId, favoriteModels)
              }
              onModelOrderChange={(modelOrder) =>
                updateProviderModelPreferences(row.instanceId, {
                  ...modelPreferences,
                  modelOrder,
                })
              }
            />
          );
        })}
      </SettingsSection>

      <AddProviderInstanceDialog
        open={isAddInstanceDialogOpen}
        onOpenChange={setIsAddInstanceDialogOpen}
      />
    </SettingsPageContainer>
  );
}

export function ArchivedThreadsPanel() {
  const projects = useStore(useShallow(selectProjectsAcrossEnvironments));
  const threads = useStore(useShallow(selectThreadShellsAcrossEnvironments));
  const { unarchiveThread, confirmAndDeleteThread } = useThreadActions();
  const archivedGroups = useMemo(() => {
    return projects
      .map((project) => ({
        project,
        threads: threads
          .filter((thread) => thread.projectId === project.id && thread.archivedAt !== null)
          .toSorted((left, right) => {
            const leftKey = left.archivedAt ?? left.createdAt;
            const rightKey = right.archivedAt ?? right.createdAt;
            return rightKey.localeCompare(leftKey) || right.id.localeCompare(left.id);
          }),
      }))
      .filter((group) => group.threads.length > 0);
  }, [projects, threads]);

  const handleArchivedThreadContextMenu = useCallback(
    async (threadRef: ScopedThreadRef, position: { x: number; y: number }) => {
      const api = readLocalApi();
      if (!api) return;
      const clicked = await api.contextMenu.show(
        [
          { id: "unarchive", label: "Unarchive" },
          { id: "delete", label: "Delete", destructive: true },
        ],
        position,
      );

      if (clicked === "unarchive") {
        try {
          await unarchiveThread(threadRef);
        } catch (error) {
          toastManager.add({
            type: "error",
            title: "Failed to unarchive thread",
            description: error instanceof Error ? error.message : "An error occurred.",
          });
        }
        return;
      }

      if (clicked === "delete") {
        await confirmAndDeleteThread(threadRef);
      }
    },
    [confirmAndDeleteThread, unarchiveThread],
  );

  return (
    <SettingsPageContainer>
      {archivedGroups.length === 0 ? (
        <SettingsSection title="Archived threads">
          <Empty className="min-h-88">
            <EmptyMedia variant="icon">
              <IconArchive />
            </EmptyMedia>
            <EmptyHeader>
              <EmptyTitle>No archived threads</EmptyTitle>
              <EmptyDescription>Archived threads will appear here.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        </SettingsSection>
      ) : (
        archivedGroups.map(({ project, threads: projectThreads }) => (
          <SettingsSection
            key={project.id}
            title={project.name}
            icon={<ProjectFavicon environmentId={project.environmentId} cwd={project.cwd} />}
          >
            {projectThreads.map((thread) => (
              <div
                key={thread.id}
                className="flex items-center justify-between gap-3 border-t border-(color:--multi-stroke-quaternary) px-4 py-3 first:border-t-0 sm:px-5"
                onContextMenu={(event) => {
                  event.preventDefault();
                  void handleArchivedThreadContextMenu(
                    scopeThreadRef(thread.environmentId, thread.id),
                    {
                      x: event.clientX,
                      y: event.clientY,
                    },
                  );
                }}
              >
                <div className="min-w-0 flex-1">
                  <Text render={<h3 />} size="base" tone="primary" weight="medium" truncate>
                    {thread.title}
                  </Text>
                  <Text render={<p />} size="xs" tone="secondary" className="mt-0.5 block">
                    Archived {formatRelativeTimeLabel(thread.archivedAt ?? thread.createdAt)}
                    {" \u00b7 Created "}
                    {formatRelativeTimeLabel(thread.createdAt)}
                  </Text>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="shrink-0 gap-1.5 px-2.5"
                  onClick={() =>
                    void unarchiveThread(scopeThreadRef(thread.environmentId, thread.id)).catch(
                      (error) => {
                        toastManager.add({
                          type: "error",
                          title: "Failed to unarchive thread",
                          description:
                            error instanceof Error ? error.message : "An error occurred.",
                        });
                      },
                    )
                  }
                >
                  <IconArchiveJunk className="size-3.5" />
                  <span>Unarchive</span>
                </Button>
              </div>
            ))}
          </SettingsSection>
        ))
      )}
    </SettingsPageContainer>
  );
}
