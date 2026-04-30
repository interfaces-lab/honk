import { ArchiveIcon, ArchiveX, LoaderIcon, RefreshCwIcon, XIcon } from "lucide-react";
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
  type ScopedThreadRef,
  type ProviderKind,
  type ServerProvider,
  type ServerProviderModel,
} from "@multi/contracts";
import { scopeThreadRef } from "@multi/client-runtime";
import { DEFAULT_UNIFIED_SETTINGS } from "@multi/contracts/settings";
import { normalizeModelSlug } from "@multi/shared/model";
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
  MAX_CUSTOM_MODEL_LENGTH,
  getCustomModelOptionsByProvider,
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
import { cn } from "../../lib/utils";
import { Button } from "@multi/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@multi/ui/empty";
import { Input } from "@multi/ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "@multi/ui/select";
import { Switch } from "@multi/ui/switch";
import { toastManager } from "~/app/toast";
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

type InstallProviderSettings = {
  provider: ProviderKind;
  title: string;
  binaryPlaceholder: string;
  binaryDescription: ReactNode;
  homePathKey?: "codexHomePath";
  homePlaceholder?: string;
  homeDescription?: ReactNode;
};

const PROVIDER_SETTINGS: readonly InstallProviderSettings[] = [
  {
    provider: "codex",
    title: "Codex",
    binaryPlaceholder: "Codex binary path",
    binaryDescription: "Path to the Codex binary",
    homePathKey: "codexHomePath",
    homePlaceholder: "CODEX_HOME",
    homeDescription: "Optional custom Codex home and config directory.",
  },
] as const;

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

const PROVIDER_STATUS_STYLES = {
  disabled: {
    dot: "bg-amber-400",
  },
  error: {
    dot: "bg-destructive",
  },
  ready: {
    dot: "bg-success",
  },
  warning: {
    dot: "bg-warning",
  },
} as const;

function getProviderSummary(provider: ServerProvider | undefined) {
  if (!provider) {
    return {
      headline: "Checking provider status",
      detail: "Waiting for the server to report installation and credential details.",
    };
  }
  if (!provider.enabled) {
    return {
      headline: "Disabled",
      detail:
        provider.message ?? "This provider is installed but disabled for new sessions in Multi.",
    };
  }
  if (!provider.installed) {
    return {
      headline: "Not found",
      detail: provider.message ?? "CLI not detected on PATH.",
    };
  }
  if (provider.auth.status === "authenticated") {
    const authLabel = provider.auth.label ?? provider.auth.type;
    return {
      headline: authLabel ? `Authenticated · ${authLabel}` : "Authenticated",
      detail: provider.message ?? null,
    };
  }
  if (provider.auth.status === "unauthenticated") {
    return {
      headline: "Not authenticated",
      detail: provider.message ?? null,
    };
  }
  if (provider.status === "warning") {
    return {
      headline: "Needs attention",
      detail:
        provider.message ?? "The provider is installed, but the server could not fully verify it.",
    };
  }
  if (provider.status === "error") {
    return {
      headline: "Unavailable",
      detail: provider.message ?? "The provider failed its startup checks.",
    };
  }
  return {
    headline: "Available",
    detail:
      provider.message ?? "Installed and ready, but provider credentials could not be verified.",
  };
}

function getProviderVersionLabel(version: string | null | undefined) {
  if (!version) return null;
  return version.startsWith("v") ? version : `v${version}`;
}

function AboutVersionTitle() {
  return (
    <span className="inline-flex items-center gap-2">
      <span>Version</span>
      <code className="text-[11px] font-medium text-muted-foreground">{APP_VERSION}</code>
    </span>
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
                  size="xs"
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
    const currentSettings = settings.providers[providerSettings.provider];
    const defaultSettings = DEFAULT_UNIFIED_SETTINGS.providers[providerSettings.provider];
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
        className="h-4 w-full accent-[var(--cursor-blue)]"
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
        <span className="w-8 shrink-0 text-right text-[11px]/[14px] tabular-nums text-[var(--cursor-text-tertiary)]">
          {props.value}
          {props.suffix ?? ""}
        </span>
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
    <div className="inline-flex h-6 items-center overflow-hidden rounded-md bg-[var(--cursor-bg-tertiary)] text-[12px]/[16px]">
      <button
        type="button"
        className="h-6 w-7 text-[var(--cursor-text-tertiary)] hover:bg-[var(--cursor-bg-quaternary)] hover:text-[var(--cursor-text-primary)]"
        aria-label={`Decrease ${props.label}`}
        onClick={() => set(props.value - 1)}
      >
        -
      </button>
      <input
        aria-label={props.label}
        className="h-6 w-9 bg-transparent text-center tabular-nums outline-none"
        max={props.max}
        min={props.min}
        type="number"
        value={props.value}
        onChange={(event) => set(Number(event.target.value))}
      />
      <button
        type="button"
        className="h-6 w-7 text-[var(--cursor-text-tertiary)] hover:bg-[var(--cursor-bg-quaternary)] hover:text-[var(--cursor-text-primary)]"
        aria-label={`Increase ${props.label}`}
        onClick={() => set(props.value + 1)}
      >
        +
      </button>
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
              <span className="block break-all font-mono text-[11px] text-[var(--cursor-text-secondary)]">
                {keybindingsConfigPath ?? "Resolving keybindings path..."}
              </span>
              {openPathErrorByTarget.keybindings ? (
                <span className="mt-1 block text-destructive">
                  {openPathErrorByTarget.keybindings}
                </span>
              ) : null}
            </>
          }
          control={
            <Button
              size="xs"
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
              <span className="block break-all font-mono text-[11px] text-[var(--cursor-text-secondary)]">
                {logsDirectoryPath ?? "Resolving logs directory..."}
              </span>
              {openPathErrorByTarget.logsDirectory ? (
                <span className="mt-1 block text-destructive">
                  {openPathErrorByTarget.logsDirectory}
                </span>
              ) : null}
            </>
          }
          control={
            <Button
              size="xs"
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
          <Button size="xs" variant="ghost" onClick={resetAppearanceSettings}>
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

export function ModelsSettingsPanel() {
  const settings = useSettings();
  const { updateSettings } = useUpdateSettings();
  const serverProviders = useServerProviders();
  const [customModelInput, setCustomModelInput] = useState("");
  const [customModelError, setCustomModelError] = useState<string | null>(null);
  const [isRefreshingProviders, setIsRefreshingProviders] = useState(false);
  const refreshingRef = useRef(false);
  const codexProvider = serverProviders.find((provider) => provider.provider === "codex");
  const providerConfig = settings.providers.codex;
  const summary = getProviderSummary(codexProvider);
  const versionLabel = getProviderVersionLabel(codexProvider?.version);
  const statusKey = codexProvider?.status ?? (providerConfig.enabled ? "warning" : "disabled");
  const models: ReadonlyArray<ServerProviderModel> =
    codexProvider?.models ??
    providerConfig.customModels.map((slug) => ({
      slug,
      name: slug,
      isCustom: true,
      capabilities: null,
    }));
  const textGenerationModelSelection = resolveAppModelSelectionState(
    {
      ...settings,
      textGenerationModelSelection:
        settings.textGenerationModelSelection?.provider === "codex"
          ? settings.textGenerationModelSelection
          : DEFAULT_UNIFIED_SETTINGS.textGenerationModelSelection,
    },
    serverProviders,
  );
  const textGenModelOptions = textGenerationModelSelection.options;
  const modelOptionsByProvider = getCustomModelOptionsByProvider(
    settings,
    serverProviders,
    "codex",
    textGenerationModelSelection.model,
  );
  const isCodexDirty = !Equal.equals(providerConfig, DEFAULT_UNIFIED_SETTINGS.providers.codex);
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
      .finally(() => {
        refreshingRef.current = false;
        setIsRefreshingProviders(false);
      });
  }, []);

  const addCustomModel = useCallback(() => {
    const normalized = normalizeModelSlug(customModelInput, "codex");
    if (!normalized) {
      setCustomModelError("Enter a model slug.");
      return;
    }
    if (models.some((option) => option.slug === normalized)) {
      setCustomModelError("That model is already saved.");
      return;
    }
    if (normalized.length > MAX_CUSTOM_MODEL_LENGTH) {
      setCustomModelError(`Model slugs must be ${MAX_CUSTOM_MODEL_LENGTH} characters or less.`);
      return;
    }

    updateSettings({
      providers: {
        ...settings.providers,
        codex: {
          ...settings.providers.codex,
          customModels: [...settings.providers.codex.customModels, normalized],
        },
      },
    });
    setCustomModelInput("");
    setCustomModelError(null);
  }, [customModelInput, models, settings.providers, updateSettings]);

  const removeCustomModel = useCallback(
    (slug: string) => {
      updateSettings({
        providers: {
          ...settings.providers,
          codex: {
            ...settings.providers.codex,
            customModels: settings.providers.codex.customModels.filter((model) => model !== slug),
          },
        },
      });
      setCustomModelError(null);
    },
    [settings.providers, updateSettings],
  );

  return (
    <SettingsPageContainer>
      <SettingsSection
        title="Models"
        headerAction={
          <Button
            size="icon-xs"
            variant="ghost"
            className="size-5 rounded-sm p-0 text-muted-foreground hover:text-foreground"
            disabled={isRefreshingProviders}
            onClick={() => void refreshProviders()}
            aria-label="Refresh provider status"
          >
            {isRefreshingProviders ? (
              <LoaderIcon className="size-3 animate-spin" />
            ) : (
              <RefreshCwIcon className="size-3" />
            )}
          </Button>
        }
      >
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
                provider="codex"
                model={textGenerationModelSelection.model}
                lockedProvider="codex"
                providers={serverProviders}
                modelOptionsByProvider={modelOptionsByProvider}
                triggerVariant="outline"
                triggerClassName="h-6 min-w-0 max-w-none shrink-0 text-[12px] text-foreground/90 hover:text-foreground"
                onProviderModelChange={(_, model) => {
                  updateSettings({
                    textGenerationModelSelection: resolveAppModelSelectionState(
                      {
                        ...settings,
                        textGenerationModelSelection: { provider: "codex", model },
                      },
                      serverProviders,
                    ),
                  });
                }}
              />
              <TraitsPicker
                provider="codex"
                models={codexProvider?.models ?? []}
                model={textGenerationModelSelection.model}
                prompt=""
                onPromptChange={() => {}}
                modelOptions={textGenModelOptions}
                allowPromptInjectedEffort={false}
                triggerVariant="outline"
                triggerClassName="h-6 min-w-0 max-w-none shrink-0 text-[12px] text-foreground/90 hover:text-foreground"
                onModelOptionsChange={(nextOptions) => {
                  updateSettings({
                    textGenerationModelSelection: resolveAppModelSelectionState(
                      {
                        ...settings,
                        textGenerationModelSelection: {
                          provider: "codex",
                          model: textGenerationModelSelection.model,
                          ...(nextOptions ? { options: nextOptions } : {}),
                        },
                      },
                      serverProviders,
                    ),
                  });
                }}
              />
            </div>
          }
        />
        <SettingsRow
          title="Codex app-server"
          description={
            summary.detail ? `${summary.headline} - ${summary.detail}` : summary.headline
          }
          status={
            versionLabel ? (
              <code className="text-[11px] text-[var(--cursor-text-secondary)]">
                {versionLabel}
              </code>
            ) : null
          }
          resetAction={
            isCodexDirty ? (
              <SettingResetButton
                label="Codex provider settings"
                onClick={() =>
                  updateSettings({
                    providers: {
                      ...settings.providers,
                      codex: DEFAULT_UNIFIED_SETTINGS.providers.codex,
                    },
                  })
                }
              />
            ) : null
          }
          control={
            <div className="flex items-center gap-2">
              <span
                className={cn("size-2 rounded-full", PROVIDER_STATUS_STYLES[statusKey].dot)}
                aria-hidden
              />
              <Switch
                checked={providerConfig.enabled}
                aria-label="Enable Codex"
                onCheckedChange={(checked) =>
                  updateSettings({
                    providers: {
                      ...settings.providers,
                      codex: { ...settings.providers.codex, enabled: Boolean(checked) },
                    },
                  })
                }
              />
            </div>
          }
        />
        <SettingsRow
          title="Codex binary path"
          description="Path to the Codex binary."
          control={
            <Input
              size="sm"
              className="w-full sm:w-44"
              value={settings.providers.codex.binaryPath}
              placeholder="codex"
              spellCheck={false}
              onChange={(event) =>
                updateSettings({
                  providers: {
                    ...settings.providers,
                    codex: { ...settings.providers.codex, binaryPath: event.target.value },
                  },
                })
              }
            />
          }
        />
        <SettingsRow
          title="CODEX_HOME path"
          description="Optional custom Codex home and config directory."
          control={
            <Input
              size="sm"
              className="w-full sm:w-44"
              value={settings.providers.codex.homePath}
              placeholder="CODEX_HOME"
              spellCheck={false}
              onChange={(event) =>
                updateSettings({
                  providers: {
                    ...settings.providers,
                    codex: { ...settings.providers.codex, homePath: event.target.value },
                  },
                })
              }
            />
          }
        />
        <SettingsRow
          title="Available models"
          description={`${models.length} Codex models available.`}
        >
          <div className="mt-2 max-h-48 overflow-y-auto pb-1">
            {models.map((model) => (
              <div
                key={`codex:${model.slug}`}
                className="flex min-h-7 items-center gap-2 border-t border-[var(--cursor-stroke-quaternary)] first:border-t-0"
              >
                <span className="min-w-0 flex-1 truncate text-[12px]/[16px] text-[var(--cursor-text-primary)]">
                  {model.name}
                </span>
                {model.isCustom ? (
                  <button
                    type="button"
                    className="text-[var(--cursor-text-tertiary)] hover:text-[var(--cursor-text-primary)]"
                    aria-label={`Remove ${model.slug}`}
                    onClick={() => removeCustomModel(model.slug)}
                  >
                    <XIcon className="size-3" />
                  </button>
                ) : null}
              </div>
            ))}
          </div>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <Input
              size="sm"
              value={customModelInput}
              onChange={(event) => {
                setCustomModelInput(event.target.value);
                setCustomModelError(null);
              }}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                addCustomModel();
              }}
              placeholder="gpt-6.7-codex-ultra-preview"
              spellCheck={false}
            />
            <Button size="xs" variant="outline" className="shrink-0" onClick={addCustomModel}>
              Add
            </Button>
          </div>
          {customModelError ? (
            <p className="mt-2 text-[11px] text-destructive">{customModelError}</p>
          ) : null}
        </SettingsRow>
      </SettingsSection>
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
              <ArchiveIcon />
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
                className="flex items-center justify-between gap-3 border-t border-border px-4 py-3 first:border-t-0 sm:px-5"
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
                  <h3 className="truncate text-sm font-medium text-foreground">{thread.title}</h3>
                  <p className="text-xs text-muted-foreground">
                    Archived {formatRelativeTimeLabel(thread.archivedAt ?? thread.createdAt)}
                    {" \u00b7 Created "}
                    {formatRelativeTimeLabel(thread.createdAt)}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 shrink-0 cursor-pointer gap-1.5 px-2.5"
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
                  <ArchiveX className="size-3.5" />
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
