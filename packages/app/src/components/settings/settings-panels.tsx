import {
  IconArchive1,
  IconArchiveJunk,
  IconChevronRightMedium,
  IconLoader,
  IconPlusLarge,
} from "central-icons";
import { useQueryClient } from "@tanstack/react-query";
import { useDebouncer } from "@tanstack/react-pacer";
import { type CSSProperties, useCallback, useMemo, useRef, useState } from "react";
import {
  type AgentWindowSendWhileStreamingBehavior,
  type AgentWindowUsageSummaryDisplay,
  defaultInstanceIdForDriver,
  type ProviderInstanceConfig,
  type ProviderInstanceId,
  type ScopedThreadRef,
  ProviderDriverKind,
} from "@multi/contracts";
import { scopeThreadRef } from "@multi/client-runtime";
import { DEFAULT_UNIFIED_SETTINGS, type UnifiedSettings } from "@multi/contracts/settings";
import { createModelSelection } from "@multi/shared/model";
import { Equal } from "effect";
import { APP_VERSION } from "~/app/branding";
import {
  DEFAULT_APPEARANCE_SNAPSHOT,
  appearanceSettingsActions,
  useAppearanceSettingsSnapshot,
} from "../../stores/appearance-store";
import {
  canCheckForUpdate,
  getDesktopUpdateButtonTooltip,
  getDesktopUpdateInstallConfirmationMessage,
  resolveDesktopUpdateButtonAction,
} from "../../components/desktop-update-state";
import { ProviderModelPicker } from "../chat/picker/model-picker";
import { TraitsPicker } from "../chat/picker/traits-picker";
import { resolveAndPersistPreferredEditor } from "../../editor/preferences";
import { isElectron } from "../../env";
import { useTheme } from "../../hooks/use-theme";
import { useSettings, useUpdateSettings } from "../../hooks/use-settings";
import { useThreadActions } from "../../hooks/use-thread-actions";
import {
  setDesktopUpdateStateQueryData,
  useDesktopUpdateState,
} from "../../lib/desktop-update-react-query";
import { resolveAppProviderModelState } from "../../model/selection";
import { ensureLocalApi, readLocalApi } from "../../local-api";
import { useShallow } from "zustand/react/shallow";
import {
  selectProjectsAcrossEnvironments,
  selectThreadShellsAcrossEnvironments,
  useStore,
} from "../../stores/thread-store";
import { formatRelativeTimeLabel } from "../../lib/timestamp-format";
import { Button } from "@multi/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@multi/ui/empty";
import { Input } from "@multi/ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "@multi/ui/select";
import { Switch } from "@multi/ui/switch";
import { Text, textVariants } from "@multi/ui/text";
import { toastManager } from "~/app/toast";
import { formatProviderErrorDescription } from "~/lib/provider-error-description";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@multi/ui/tooltip";
import {
  SettingResetButton,
  SettingsPageContainer,
  SettingsRow,
  SettingsSection,
} from "./settings-layout";
import { ProjectFavicon } from "../project-favicon";
import {
  applyProvidersUpdated,
  useServerAvailableEditors,
  useServerKeybindingsConfigPath,
  useServerObservability,
  useServerProviders,
} from "../../rpc/server-state";
import { AddProviderInstanceDialog } from "./add-provider-instance-dialog";
import { ProviderInstanceCard } from "./provider-instance-card";
import { DRIVER_OPTIONS, getDriverOption } from "./provider-driver-meta";

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

const AGENT_WINDOW_SEND_WHILE_STREAMING_BEHAVIOR_LABELS: Record<
  AgentWindowSendWhileStreamingBehavior,
  string
> = {
  queue: "Queue",
  "stop-and-send": "Stop and send",
  send: "Send immediately",
};

const AGENT_WINDOW_USAGE_SUMMARY_DISPLAY_LABELS: Record<AgentWindowUsageSummaryDisplay, string> = {
  auto: "Auto",
  always: "Always",
  never: "Never",
};

type ProviderSettingsDescriptor = {
  provider: typeof ProviderDriverKind.Type;
};

const PROVIDER_SETTINGS: readonly ProviderSettingsDescriptor[] = DRIVER_OPTIONS.map(
  (definition) => ({
    provider: definition.value,
  }),
);

function buildProviderInstanceUpdatePatch(input: {
  readonly settings: Pick<UnifiedSettings, "providerInstances">;
  readonly instanceId: ProviderInstanceId;
  readonly instance: ProviderInstanceConfig;
  readonly textGenerationModelSelection?:
    | UnifiedSettings["textGenerationModelSelection"]
    | undefined;
}): Partial<UnifiedSettings> {
  return {
    providerInstances: {
      ...input.settings.providerInstances,
      [input.instanceId]: input.instance,
    },
    ...(input.textGenerationModelSelection !== undefined
      ? { textGenerationModelSelection: input.textGenerationModelSelection }
      : {}),
  };
}

function showProviderSettingsError(title: string, error: unknown): void {
  toastManager.add({
    type: "error",
    title,
    description: formatProviderErrorDescription(error, "Provider settings update failed."),
  });
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
      <code className="font-multi-mono text-multi-code font-medium text-multi-fg-secondary">
        {APP_VERSION}
      </code>
    </Text>
  );
}

function AboutVersionSection() {
  const queryClient = useQueryClient();
  const updateStateQuery = useDesktopUpdateState();

  const updateState = updateStateQuery.data ?? null;

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
    action === "none" ? !canCheckForUpdate(updateState) : updateState?.status === "downloading";

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
    <SettingsRow
      title={<AboutVersionTitle />}
      description={description}
      control={
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="default"
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
  const isAgentWindowAppearanceDirty =
    settings.agentWindowFontSmoothingAntialiased !==
      DEFAULT_UNIFIED_SETTINGS.agentWindowFontSmoothingAntialiased ||
    settings.agentWindowChatMaxWidth !== DEFAULT_UNIFIED_SETTINGS.agentWindowChatMaxWidth ||
    settings.cursorPointerOnButtons !== DEFAULT_UNIFIED_SETTINGS.cursorPointerOnButtons;
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
      ...(settings.agentWindowSendWhileStreamingBehavior !==
      DEFAULT_UNIFIED_SETTINGS.agentWindowSendWhileStreamingBehavior
        ? ["Running send behavior"]
        : []),
      ...(settings.agentWindowUsageSummaryDisplay !==
      DEFAULT_UNIFIED_SETTINGS.agentWindowUsageSummaryDisplay
        ? ["Usage summary"]
        : []),
      ...(settings.cursorPointerOnButtons !== DEFAULT_UNIFIED_SETTINGS.cursorPointerOnButtons
        ? ["Pointer cursors"]
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
      ...(isAgentWindowAppearanceDirty ? ["Agent Window"] : []),
      ...(isAppearanceDirty ? ["Appearance"] : []),
      ...(isGitWritingModelDirty ? ["Git writing model"] : []),
      ...(areProviderSettingsDirty ? ["Providers"] : []),
    ],
    [
      areProviderSettingsDirty,
      isAgentWindowAppearanceDirty,
      isAppearanceDirty,
      isGitWritingModelDirty,
      settings.agentWindowSendWhileStreamingBehavior,
      settings.agentWindowUsageSummaryDisplay,
      settings.confirmThreadArchive,
      settings.confirmThreadDelete,
      settings.cursorPointerOnButtons,
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

    try {
      setTheme("system");
      appearanceSettingsActions.reset();
      await resetSettings();
      onRestored?.();
    } catch (error) {
      showProviderSettingsError("Failed to restore default settings", error);
    }
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
  accentColor?: string;
  showSwatch?: boolean;
  suffix?: string;
}) {
  const accentColor = props.accentColor ?? "var(--multi-action)";

  return (
    <div className="grid w-full grid-cols-[minmax(0,1fr)_2rem] items-center gap-2 sm:w-34">
      <input
        aria-label={props.label}
        className="h-4 w-full"
        max={props.max}
        min={props.min}
        style={{ accentColor }}
        type="range"
        value={props.value}
        onChange={(event) => props.onChange(Number(event.target.value))}
      />
      <span className="flex w-8 shrink-0 justify-end">
        {props.showSwatch ? (
          <span
            aria-hidden
            className="size-8 rounded-full shadow-multi-swatch-inset"
            style={{ backgroundColor: accentColor }}
          />
        ) : (
          <Text size="xs" tone="tertiary" className="w-full text-right tabular-nums">
            {props.value}
            {props.suffix ?? ""}
          </Text>
        )}
      </span>
    </div>
  );
}

function NumberStepper(props: {
  label: string;
  value: number;
  min: number;
  max?: number;
  onChange: (value: number) => void;
}) {
  const set = (next: number) => {
    if (!Number.isFinite(next)) return;
    const boundedMin = Math.max(props.min, Math.round(next));
    props.onChange(props.max === undefined ? boundedMin : Math.min(props.max, boundedMin));
  };

  return (
    <div className="inline-flex h-7 min-h-7 items-stretch overflow-hidden rounded-multi-control border border-multi-stroke-tertiary bg-multi-bg-quinary text-body shadow-none">
      <Button
        type="button"
        variant="ghost"
        className="h-7 min-h-7 w-7 shrink-0 rounded-none border-transparent px-0 text-multi-fg-tertiary shadow-none hover:bg-multi-bg-quaternary hover:text-multi-fg-primary"
        aria-label={`Decrease ${props.label}`}
        onClick={() => set(props.value - 1)}
      >
        -
      </Button>
      <input
        aria-label={props.label}
        className="-mx-px h-full min-h-7 w-14 shrink-0 border-x border-multi-stroke-tertiary bg-transparent px-0 py-0 text-center leading-7 tabular-nums outline-none [appearance:textfield] focus-visible:relative focus-visible:z-[1] focus-visible:border-multi-stroke-focused [&::-webkit-inner-spin-button]:m-0 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:m-0 [&::-webkit-outer-spin-button]:appearance-none"
        max={props.max}
        min={props.min}
        inputMode="numeric"
        type="number"
        value={props.value}
        onChange={(event) => set(Number(event.target.value))}
      />
      <Button
        type="button"
        variant="ghost"
        className="h-7 min-h-7 w-7 shrink-0 rounded-none border-transparent px-0 text-multi-fg-tertiary shadow-none hover:bg-multi-bg-quaternary hover:text-multi-fg-primary"
        aria-label={`Increase ${props.label}`}
        onClick={() => set(props.value + 1)}
      >
        +
      </Button>
    </div>
  );
}

function FontFamilyInput(props: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  onDraftValueChange?: (value: string) => void;
}) {
  const [draftValue, setDraftValue] = useState(props.value);
  const commitValue = useDebouncer(props.onChange, {
    wait: 350,
    onUnmount: (debouncer) => debouncer.flush(),
  });

  return (
    <Input
      size="sm"
      className="w-full border-multi-stroke-tertiary bg-multi-bg-quinary shadow-none has-focus-visible:border-multi-stroke-focused has-focus-visible:ring-1 has-focus-visible:ring-multi-stroke-focused sm:w-36"
      value={draftValue}
      placeholder={props.placeholder}
      aria-label={props.label}
      onBlur={() => commitValue.flush()}
      onChange={(event) => {
        const nextValue = event.target.value;
        setDraftValue(nextValue);
        props.onDraftValueChange?.(nextValue);
        commitValue.maybeExecute(nextValue);
      }}
    />
  );
}

function CodeFontFamilySettingsRow(props: { codeFont: string }) {
  const [codeFontDraft, setCodeFontDraft] = useState(props.codeFont);
  const codePreviewStyle = useMemo<CSSProperties>(
    () => ({
      fontFamily: codeFontDraft.trim() || "var(--multi-font-mono)",
      fontSize: "var(--multi-code-font-size-user, 12px)",
      lineHeight: "calc(var(--multi-code-font-size-user, 12px) * 1.45)",
    }),
    [codeFontDraft],
  );

  return (
    <SettingsRow
      title="Code Font Family"
      description="Editor font."
      control={
        <FontFamilyInput
          label="Code Font Family"
          value={props.codeFont}
          placeholder="System monospace"
          onChange={appearanceSettingsActions.setCodeFontFamily}
          onDraftValueChange={setCodeFontDraft}
        />
      }
    >
      <div className="mt-2 overflow-hidden rounded-sm" style={codePreviewStyle}>
        <div className="flex bg-rose-500/10 text-foreground/72">
          <span className="w-8 shrink-0 text-center text-rose-500/80">1</span>
          <span>return a + b;</span>
        </div>
        <div className="flex bg-emerald-500/10 text-foreground/72">
          <span className="w-8 shrink-0 text-center text-emerald-600/80">1</span>
          <span>const result = a + b;</span>
        </div>
        <div className="flex bg-emerald-500/10 text-foreground/72">
          <span className="w-8 shrink-0 text-center text-emerald-600/80">2</span>
          <span>return result;</span>
        </div>
      </div>
    </SettingsRow>
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
              <SelectTrigger
                size="xs"
                variant="outline"
                className="w-full sm:w-34"
                aria-label="Timestamp format"
              >
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
              className="w-full border-multi-stroke-tertiary bg-multi-bg-quinary shadow-none has-focus-visible:border-multi-stroke-focused has-focus-visible:ring-1 has-focus-visible:ring-multi-stroke-focused sm:w-34"
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
              <span className="block break-all font-multi-mono text-multi-code text-multi-fg-secondary">
                {keybindingsConfigPath ?? "Resolving keybindings path..."}
              </span>
              {openPathErrorByTarget.keybindings ? (
                <Text render={<span />} size="xs" className="mt-1 block text-destructive">
                  {openPathErrorByTarget.keybindings}
                </Text>
              ) : null}
            </>
          }
          control={
            <Button
              size="default"
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
              <span className="block break-all font-multi-mono text-multi-code text-multi-fg-secondary">
                {logsDirectoryPath ?? "Resolving logs directory..."}
              </span>
              {openPathErrorByTarget.logsDirectory ? (
                <Text render={<span />} size="xs" className="mt-1 block text-destructive">
                  {openPathErrorByTarget.logsDirectory}
                </Text>
              ) : null}
            </>
          }
          control={
            <Button
              size="default"
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
          title="Hue"
          description="Accent color."
          control={
            <SettingsSlider
              label="Accent hue"
              accentColor={`oklch(0.682 calc(0.1 + var(--multi-intensity, 33) / 100 * 0.236) ${appearance.hue})`}
              max={360}
              min={0}
              showSwatch
              value={appearance.hue}
              onChange={appearanceSettingsActions.setTintHue}
            />
          }
        />
        <SettingsRow
          title="Intensity"
          description="Tint strength."
          control={
            <SettingsSlider
              label="Accent intensity"
              max={100}
              min={0}
              suffix="%"
              value={appearance.saturation}
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
        <SettingsRow
          title="Chat Max Width"
          description="Maximum width of Agent Window chat content in pixels."
          resetAction={
            settings.agentWindowChatMaxWidth !==
            DEFAULT_UNIFIED_SETTINGS.agentWindowChatMaxWidth ? (
              <SettingResetButton
                label="Agent Window chat max width"
                onClick={() =>
                  updateSettings({
                    agentWindowChatMaxWidth: DEFAULT_UNIFIED_SETTINGS.agentWindowChatMaxWidth,
                  })
                }
              />
            ) : null
          }
          control={
            <NumberStepper
              label="Agent Window Chat Max Width"
              min={1}
              value={settings.agentWindowChatMaxWidth}
              onChange={(value) => updateSettings({ agentWindowChatMaxWidth: value })}
            />
          }
        />
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
          title="Send while running"
          description="Choose what the composer submit action does while an agent turn is active."
          resetAction={
            settings.agentWindowSendWhileStreamingBehavior !==
            DEFAULT_UNIFIED_SETTINGS.agentWindowSendWhileStreamingBehavior ? (
              <SettingResetButton
                label="send while running"
                onClick={() =>
                  updateSettings({
                    agentWindowSendWhileStreamingBehavior:
                      DEFAULT_UNIFIED_SETTINGS.agentWindowSendWhileStreamingBehavior,
                  })
                }
              />
            ) : null
          }
          control={
            <Select
              value={settings.agentWindowSendWhileStreamingBehavior}
              onValueChange={(value) => {
                if (value === "queue" || value === "stop-and-send" || value === "send") {
                  updateSettings({ agentWindowSendWhileStreamingBehavior: value });
                }
              }}
            >
              <SelectTrigger
                size="xs"
                variant="outline"
                className="w-full sm:w-40"
                aria-label="Send while running"
              >
                <SelectValue>
                  {
                    AGENT_WINDOW_SEND_WHILE_STREAMING_BEHAVIOR_LABELS[
                      settings.agentWindowSendWhileStreamingBehavior
                    ]
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                <SelectItem hideIndicator value="queue">
                  {AGENT_WINDOW_SEND_WHILE_STREAMING_BEHAVIOR_LABELS.queue}
                </SelectItem>
                <SelectItem hideIndicator value="stop-and-send">
                  {AGENT_WINDOW_SEND_WHILE_STREAMING_BEHAVIOR_LABELS["stop-and-send"]}
                </SelectItem>
                <SelectItem hideIndicator value="send">
                  {AGENT_WINDOW_SEND_WHILE_STREAMING_BEHAVIOR_LABELS.send}
                </SelectItem>
              </SelectPopup>
            </Select>
          }
        />
        <SettingsRow
          title="Usage summary"
          description="Auto shows context usage after 50%; Always shows it whenever data exists."
          resetAction={
            settings.agentWindowUsageSummaryDisplay !==
            DEFAULT_UNIFIED_SETTINGS.agentWindowUsageSummaryDisplay ? (
              <SettingResetButton
                label="usage summary"
                onClick={() =>
                  updateSettings({
                    agentWindowUsageSummaryDisplay:
                      DEFAULT_UNIFIED_SETTINGS.agentWindowUsageSummaryDisplay,
                  })
                }
              />
            ) : null
          }
          control={
            <Select
              value={settings.agentWindowUsageSummaryDisplay}
              onValueChange={(value) => {
                if (value === "auto" || value === "always" || value === "never") {
                  updateSettings({ agentWindowUsageSummaryDisplay: value });
                }
              }}
            >
              <SelectTrigger
                size="xs"
                variant="outline"
                className="w-full sm:w-34"
                aria-label="Usage summary"
              >
                <SelectValue>
                  {
                    AGENT_WINDOW_USAGE_SUMMARY_DISPLAY_LABELS[
                      settings.agentWindowUsageSummaryDisplay
                    ]
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                <SelectItem hideIndicator value="auto">
                  {AGENT_WINDOW_USAGE_SUMMARY_DISPLAY_LABELS.auto}
                </SelectItem>
                <SelectItem hideIndicator value="always">
                  {AGENT_WINDOW_USAGE_SUMMARY_DISPLAY_LABELS.always}
                </SelectItem>
                <SelectItem hideIndicator value="never">
                  {AGENT_WINDOW_USAGE_SUMMARY_DISPLAY_LABELS.never}
                </SelectItem>
              </SelectPopup>
            </Select>
          }
        />
        <SettingsRow
          title="New threads"
          description="Pick the default project mode for newly created draft threads."
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
              <SelectTrigger
                size="xs"
                variant="outline"
                className="w-full sm:w-34"
                aria-label="Default thread mode"
              >
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

export function ModelsSettingsPanel() {
  const settings = useSettings();
  const { updateSettings } = useUpdateSettings();
  const serverProviders = useServerProviders();
  const [isRefreshingProviders, setIsRefreshingProviders] = useState(false);
  const [isAddInstanceDialogOpen, setIsAddInstanceDialogOpen] = useState(false);
  const [openInstanceDetails, setOpenInstanceDetails] = useState<Record<string, boolean>>({});
  const refreshingRef = useRef<Promise<void> | null>(null);

  const visibleProviderSettings = PROVIDER_SETTINGS;
  const textGenerationModelState = resolveAppProviderModelState({
    settings,
    providers: serverProviders,
    requestedSelection: settings.textGenerationModelSelection,
  });
  const textGenerationModelStatus =
    textGenerationModelState.status.kind === "ready"
      ? null
      : textGenerationModelState.status.message;
  const textGenerationModelSelection = textGenerationModelState.modelSelection;
  const textGenInstanceId = textGenerationModelSelection.instanceId;
  const textGenModel = textGenerationModelSelection.model;
  const textGenModelOptions = textGenerationModelSelection.options;
  const modelInstanceEntries = textGenerationModelState.providerInstanceEntries;
  const textGenInstanceEntry = textGenerationModelState.selectedProviderEntry;
  const textGenProvider = textGenerationModelState.selectedProvider;
  const resolveTextGenerationModelSelection = useCallback(
    (nextSettings: UnifiedSettings) =>
      resolveAppProviderModelState({
        settings: nextSettings,
        providers: serverProviders,
        requestedSelection: nextSettings.textGenerationModelSelection,
      }).modelSelection,
    [serverProviders],
  );
  const isGitWritingModelDirty = !Equal.equals(
    settings.textGenerationModelSelection ?? null,
    DEFAULT_UNIFIED_SETTINGS.textGenerationModelSelection ?? null,
  );

  const refreshProviders = useCallback(() => {
    if (refreshingRef.current) return refreshingRef.current;
    setIsRefreshingProviders(true);
    const refresh = ensureLocalApi()
      .server.refreshProviders()
      .then((payload) => applyProvidersUpdated(payload))
      .catch((error: unknown) => {
        showProviderSettingsError("Failed to refresh providers", error);
      })
      .finally(() => {
        refreshingRef.current = null;
        setIsRefreshingProviders(false);
      });
    refreshingRef.current = refresh;
    return refresh;
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
    type DefaultProviderSettings = (typeof settings.providers)[keyof typeof settings.providers];
    const defaultProviderConfigs = settings.providers as Record<string, DefaultProviderSettings>;
    const factoryDefaultProviderConfigs = DEFAULT_UNIFIED_SETTINGS.providers as Record<
      string,
      DefaultProviderSettings
    >;
    const driver = providerSettings.provider;
    const defaultInstanceId = defaultInstanceIdForDriver(driver);
    const explicitInstance = settings.providerInstances?.[defaultInstanceId];
    const defaultConfig = defaultProviderConfigs[providerSettings.provider]!;
    const factoryDefaultConfig = factoryDefaultProviderConfigs[providerSettings.provider]!;
    const effectiveInstance: ProviderInstanceConfig =
      explicitInstance ??
      ({
        driver,
        enabled: defaultConfig.enabled,
        config: defaultConfig,
      } satisfies ProviderInstanceConfig);
    const isDirty =
      explicitInstance !== undefined || !Equal.equals(defaultConfig, factoryDefaultConfig);
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
    return updateSettings(
      buildProviderInstanceUpdatePatch({
        settings,
        instanceId: row.instanceId,
        instance: next,
        textGenerationModelSelection: options?.textGenerationModelSelection,
      }),
    );
  };

  const deleteProviderInstance = (id: ProviderInstanceId) => {
    void updateSettings({
      providerInstances: withoutProviderInstanceKey(settings.providerInstances, id),
      providerModelPreferences: withoutProviderInstanceKey(settings.providerModelPreferences, id),
      favorites: withoutProviderInstanceFavorites(settings.favorites ?? [], id),
    }).catch((error: unknown) => {
      showProviderSettingsError("Failed to delete provider instance", error);
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
    void updateSettings({
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
    }).catch((error: unknown) => {
      showProviderSettingsError("Failed to update provider settings", error);
    });
  };

  const updateProviderFavoriteModels = (
    instanceId: ProviderInstanceId,
    nextFavoriteModels: ReadonlyArray<string>,
  ) => {
    const favoriteModels = [
      ...new Set(nextFavoriteModels.map((slug) => slug.trim()).filter((slug) => slug.length > 0)),
    ];
    void updateSettings({
      favorites: [
        ...withoutProviderInstanceFavorites(settings.favorites ?? [], instanceId),
        ...favoriteModels.map((model) => ({ provider: instanceId, model })),
      ],
    }).catch((error: unknown) => {
      showProviderSettingsError("Failed to update provider favorites", error);
    });
  };

  const resetDefaultInstance = (driverKind: ProviderDriverKind) => {
    type DefaultProviderSettings = (typeof settings.providers)[keyof typeof settings.providers];
    const factoryDefaultProviderConfigs = DEFAULT_UNIFIED_SETTINGS.providers as Record<
      string,
      DefaultProviderSettings | undefined
    >;
    const defaultInstanceId = defaultInstanceIdForDriver(driverKind);
    const factoryDefaultProviderConfig = factoryDefaultProviderConfigs[driverKind];
    if (factoryDefaultProviderConfig === undefined) return;
    void updateSettings({
      providers: {
        ...settings.providers,
        [driverKind]: factoryDefaultProviderConfig,
      } as typeof settings.providers,
      providerInstances: withoutProviderInstanceKey(settings.providerInstances, defaultInstanceId),
      providerModelPreferences: withoutProviderInstanceKey(
        settings.providerModelPreferences,
        defaultInstanceId,
      ),
      favorites: withoutProviderInstanceFavorites(settings.favorites ?? [], defaultInstanceId),
    }).catch((error: unknown) => {
      showProviderSettingsError("Failed to reset provider settings", error);
    });
  };

  return (
    <SettingsPageContainer>
      <SettingsSection title="Models">
        <SettingsRow
          title="Text generation model"
          description="Configure the model used for generated commit messages, PR titles, and similar Git text."
          status={textGenerationModelStatus}
          resetAction={
            isGitWritingModelDirty ? (
              <SettingResetButton
                label="text generation model"
                onClick={() =>
                  void updateSettings({
                    textGenerationModelSelection:
                      DEFAULT_UNIFIED_SETTINGS.textGenerationModelSelection,
                  }).catch((error: unknown) => {
                    showProviderSettingsError("Failed to update provider settings", error);
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
                instanceEntries={modelInstanceEntries}
                modelCatalogItems={textGenerationModelState.modelCatalogItems}
                selectedCatalogItem={textGenerationModelState.selectedCatalogItem}
                availabilityStatus={textGenerationModelState.status}
                triggerVariant="outline"
                triggerClassName="min-w-0 max-w-none shrink-0 text-foreground/90 hover:text-foreground"
                onSelectionChange={(selection) => {
                  const nextSettings = {
                    ...settings,
                    textGenerationModelSelection: selection,
                  };
                  void updateSettings({
                    textGenerationModelSelection: resolveTextGenerationModelSelection(nextSettings),
                  }).catch((error: unknown) => {
                    showProviderSettingsError("Failed to update provider settings", error);
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
                  const nextSettings = {
                    ...settings,
                    textGenerationModelSelection: createModelSelection(
                      textGenInstanceId,
                      textGenModel,
                      nextOptions,
                    ),
                  };
                  void updateSettings({
                    textGenerationModelSelection: resolveTextGenerationModelSelection(nextSettings),
                  }).catch((error: unknown) => {
                    showProviderSettingsError("Failed to update provider settings", error);
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
                      <IconChevronRightMedium className="size-3" />
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
                  const patch = buildProviderInstanceUpdatePatch({
                    settings,
                    instanceId: row.instanceId,
                    instance: next,
                  });
                  const nextSettings = {
                    ...settings,
                    ...patch,
                    textGenerationModelSelection:
                      settings.textGenerationModelSelection ?? textGenerationModelSelection,
                  };
                  void updateSettings({
                    ...patch,
                    textGenerationModelSelection: resolveTextGenerationModelSelection(nextSettings),
                  }).catch((error: unknown) => {
                    showProviderSettingsError("Failed to update provider settings", error);
                  });
                } else {
                  void updateProviderInstance(row, next).catch((error: unknown) => {
                    showProviderSettingsError("Failed to update provider settings", error);
                  });
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
              <IconArchive1 />
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
                className="flex items-center justify-between gap-3 border-t border-(--multi-stroke-quaternary) px-4 py-3 first:border-t-0 sm:px-5"
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
                  <h3
                    className={textVariants({
                      size: "base",
                      tone: "primary",
                      weight: "medium",
                      truncate: true,
                    })}
                  >
                    {thread.title}
                  </h3>
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
