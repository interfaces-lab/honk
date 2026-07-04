import {
  IconArchive1,
  IconArchiveJunk,
  IconCheckmark1,
  IconChevronDownSmall,
  IconClawd,
  IconCursor,
  IconHammer,
  IconLibrary,
  IconOpenaiCodex,
  IconSparklesSoft,
} from "central-icons";
import type { CredentialKind, CredentialStatus, LoginFlow } from "@honk/api/core/v1";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AGENT_INTERACTION_MODES, type AgentInteractionMode } from "@honk/shared/interaction-mode";
import type { AgentMode, AgentPreferencesPatch } from "@honk/shared/agent-model-policy";
import type {
  AgentWindowSendWhileStreamingBehavior,
  AgentWindowUsageSummaryDisplay,
} from "@honk/shared/client-settings";
import { DEFAULT_PROJECTLESS_CWD } from "@honk/shared/project";
import type { ScopedThreadRef } from "@honk/shared/environment";
import { scopeThreadRef } from "~/lib/environment-scope";
import { DEFAULT_UNIFIED_SETTINGS } from "@honk/shared/client-settings";
import { Equal } from "effect";
import { APP_VERSION } from "~/app/branding";
import {
  countRunningThreadsWithServerState,
  selectRunningThreadTitlesWithServerState,
} from "~/desktop-active-work";
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
  shouldConfirmDesktopUpdateInstall,
} from "../../components/desktop-update-state";
import { resolveAndPersistPreferredEditor } from "../../editor-preferences";
import { isElectron } from "../../env";
import { useTheme } from "../../hooks/use-theme";
import { useSettings, useUpdateSettings } from "../../hooks/use-settings";
import { useThreadActions } from "../../hooks/use-thread-actions";
import {
  setDesktopUpdateStateQueryData,
  useDesktopUpdateState,
} from "../../lib/desktop-update-react-query";
import { ensureLocalApi, readLocalApi } from "../../local-api";
import { useShallow } from "zustand/react/shallow";
import {
  selectProjectsAcrossEnvironments,
  selectThreadShellsAcrossEnvironments,
  useStore,
} from "../../stores/thread-store";
import { formatRelativeTimeLabel } from "../../lib/timestamp-format";
import { Button } from "@honk/honkkit/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@honk/honkkit/empty";
import { Input } from "@honk/honkkit/input";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "@honk/honkkit/menu";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "@honk/honkkit/select";
import { Switch } from "@honk/honkkit/switch";
import { Text } from "@honk/honkkit/text";
import { toastManager } from "~/app/toast";
import { cn } from "~/lib/utils";
import {
  isDesktopRuntimeApiAvailable,
  readHonkRuntimeApi,
  type HonkRuntimeHostSnapshot,
} from "~/lib/honk-runtime-api";
import { runtimeSkillsQueryOptions } from "~/lib/runtime-skills";
import { useAgentRuntimeStore } from "~/stores/agent-runtime-store";
import { useLocalFeatureFlagsStore } from "~/stores/local-feature-flags";
import {
  AGENT_MODE_LABELS,
  AGENT_MODE_OPTIONS,
  AGENT_MODE_THINKING_LEVELS,
  AGENT_THINKING_LEVEL_LABELS,
  AGENT_THINKING_LEVEL_OPTIONS,
  agentModeSupportsThinkingLevelSelection,
  deriveAgentModeAvailability,
  normalizedConfigurableThinkingLevel,
  unavailableAgentModeReason,
  type AgentModeAvailability,
} from "~/lib/agent-mode-options";
import {
  coreAuthCancelFlowMutationOptions,
  coreAuthLoginMutationOptions,
  coreAuthLogoutMutationOptions,
  coreAuthSnapshotQueryOptions,
  EMPTY_CORE_AUTH_SNAPSHOT,
} from "~/lib/core-auth-react-query";
import {
  cursorComposerPolicyModelSelection,
  CURSOR_COMPOSER_MODEL_NAME,
} from "@honk/shared/cursor-composer";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@honk/honkkit/tooltip";
import {
  SettingsItemShell,
  SettingsItemTitle,
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
} from "../../rpc/server-state";

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

function AboutVersionTitle() {
  return (
    <span className="inline-flex items-center gap-2">
      <span>Version</span>
      <code className="font-honk-mono font-medium text-honk-fg-secondary">{APP_VERSION}</code>
    </span>
  );
}

function AboutVersionSection() {
  const queryClient = useQueryClient();
  const updateStateQuery = useDesktopUpdateState();

  const updateState = updateStateQuery.data ?? null;

  const handleButtonClick = () => {
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
      const storeState = useStore.getState();
      const runningThreadCount = countRunningThreadsWithServerState(storeState);
      const runningThreadTitles = selectRunningThreadTitlesWithServerState(storeState);
      if (shouldConfirmDesktopUpdateInstall(runningThreadCount)) {
        const confirmed = window.confirm(
          getDesktopUpdateInstallConfirmationMessage(
            updateState ?? { availableVersion: null, downloadedVersion: null },
            runningThreadTitles,
          ),
        );
        if (!confirmed) return;
      }
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
  };

  const action = updateState ? resolveDesktopUpdateButtonAction(updateState) : "none";
  const buttonTooltip = updateState ? getDesktopUpdateButtonTooltip(updateState) : null;
  const buttonDisabled =
    action === "none"
      ? !canCheckForUpdate(updateState)
      : updateState?.status === "downloading" || updateState?.status === "installing";

  const actionLabel: Record<string, string> = { download: "Download", install: "Install" };
  const statusLabel: Record<string, string> = {
    checking: "Checking…",
    downloading: "Downloading…",
    installing: "Installing...",
  };
  const buttonLabel =
    actionLabel[action] ?? statusLabel[updateState?.status ?? ""] ?? "Check for Updates";
  const description =
    action === "download" || action === "install"
      ? "Update available."
      : updateState?.status === "installing"
        ? "Installing update."
        : updateState?.status === "up-to-date"
          ? "Honk is up to date."
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

  const isAgentWindowAppearanceDirty =
    settings.agentWindowFontSmoothingAntialiased !==
      DEFAULT_UNIFIED_SETTINGS.agentWindowFontSmoothingAntialiased ||
    settings.cursorPointerOnButtons !== DEFAULT_UNIFIED_SETTINGS.cursorPointerOnButtons;
  const isAppearanceDirty = !Equal.equals(appearance, DEFAULT_APPEARANCE_SNAPSHOT);

  const changedSettingLabels = [
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
    ...(settings.conversationDensity !== DEFAULT_UNIFIED_SETTINGS.conversationDensity
      ? ["Tool call density"]
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
  ];

  const restoreDefaults = async () => {
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
      toastManager.add({
        type: "error",
        title: "Failed to restore default settings",
        description: error instanceof Error ? error.message : "Settings reset failed.",
      });
    }
  };

  return {
    changedSettingLabels,
    restoreDefaults,
  };
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
    ? "Structured logs (JSONL) and local trace files."
    : "Structured logs (JSONL).";

  const openInPreferredEditor = (
    target: "keybindings" | "logsDirectory",
    path: string | null,
    failureMessage: string,
  ) => {
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
  };

  return (
    <SettingsPageContainer>
      <SettingsSection title="General">
        <SettingsRow
          preferenceId="general.timestamp-format"
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
                  void updateSettings({ timestampFormat: value });
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
          preferenceId="general.add-project-base-directory"
          title="Add project starts in"
          description={`Leave empty to use "${DEFAULT_PROJECTLESS_CWD}" when the Add Project browser opens.`}
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
              className="w-full border-honk-stroke-tertiary bg-honk-bg-quinary shadow-none has-focus-visible:border-honk-stroke-focused has-focus-visible:ring-1 has-focus-visible:ring-honk-stroke-focused sm:w-34"
              value={settings.addProjectBaseDirectory}
              onChange={(event) => updateSettings({ addProjectBaseDirectory: event.target.value })}
              placeholder={DEFAULT_PROJECTLESS_CWD}
              spellCheck={false}
              aria-label="Add project base directory"
            />
          }
        />
      </SettingsSection>

      <SettingsSection title="Advanced">
        <SettingsRow
          preferenceId="general.keybindings"
          title="Keybindings"
          description="Open the persisted keybindings file to edit advanced bindings directly."
          status={
            <>
              <span className="block break-all font-honk-mono text-honk-sm text-honk-fg-secondary">
                {keybindingsConfigPath ?? "Resolving keybindings path..."}
              </span>
              {openPathErrorByTarget.keybindings ? (
                <span className="mt-1 block">
                  <Text as="span" size="xs" tone="destructive">
                    {openPathErrorByTarget.keybindings}
                  </Text>
                </span>
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
              <span className="block break-all font-honk-mono text-honk-sm text-honk-fg-secondary">
                {logsDirectoryPath ?? "Resolving logs directory..."}
              </span>
              {openPathErrorByTarget.logsDirectory ? (
                <span className="mt-1 block">
                  <Text as="span" size="xs" tone="destructive">
                    {openPathErrorByTarget.logsDirectory}
                  </Text>
                </span>
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

export function AgentsSettingsPanel() {
  const settings = useSettings();
  const { updateSettings } = useUpdateSettings();

  return (
    <SettingsPageContainer>
      <AgentRuntimeSettingsSections />

      <SettingsSection title="Agents">
        <SettingsRow
          preferenceId="agents.assistant-streaming"
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
                void updateSettings({ enableAssistantStreaming: checked })
              }
            />
          }
        />
        <SettingsRow
          preferenceId="agents.send-while-running"
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
                  void updateSettings({ agentWindowSendWhileStreamingBehavior: value });
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
          preferenceId="agents.usage-summary"
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
                  void updateSettings({ agentWindowUsageSummaryDisplay: value });
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
          preferenceId="agents.new-threads"
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
                  void updateSettings({ defaultThreadEnvMode: value });
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
          preferenceId="agents.diff-line-wrapping"
          title="Diff line wrapping"
          description="Set the default wrap state when the diff panel opens."
          control={
            <Switch
              checked={settings.diffWordWrap}
              aria-label="Wrap diff lines by default"
              onCheckedChange={(checked) => void updateSettings({ diffWordWrap: checked })}
            />
          }
        />
        <SettingsRow
          preferenceId="agents.archive-confirmation"
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
              onCheckedChange={(checked) => void updateSettings({ confirmThreadArchive: checked })}
            />
          }
        />
        <SettingsRow
          preferenceId="agents.delete-confirmation"
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
              onCheckedChange={(checked) => void updateSettings({ confirmThreadDelete: checked })}
            />
          }
        />
      </SettingsSection>
    </SettingsPageContainer>
  );
}

const SUBAGENT_PROFILE_CARDS = [
  {
    name: "general-purpose",
    label: "General Purpose",
    description: "The default worker for implementation, research, and follow-up.",
    icon: IconHammer,
  },
  {
    name: "librarian",
    label: "Librarian",
    description: "Fast read-only reconnaissance across files, symbols, and code paths.",
    icon: IconLibrary,
  },
  {
    name: "oracle",
    label: "Oracle",
    description: "Slow read-only analysis for root cause, debugging, and design trade-offs.",
    icon: IconSparklesSoft,
  },
] as const;

const SKILLS_PREVIEW_LIMIT = 5;

function SkillSummaryRow({
  skill,
}: {
  skill: {
    readonly name: string;
    readonly description: string;
    readonly filePath: string;
    readonly scope: "user" | "project";
  };
}) {
  return (
    <SettingsItemShell className="h-19 py-3">
      <div className="min-w-0">
        <SettingsItemTitle className="min-w-0 truncate" title={skill.name}>
          {skill.name}
        </SettingsItemTitle>
        <p className="mt-0.5 truncate text-body text-honk-fg-secondary" title={skill.description}>
          {skill.description}
        </p>
      </div>
    </SettingsItemShell>
  );
}

function SubagentProfileCard({ profile }: { profile: (typeof SUBAGENT_PROFILE_CARDS)[number] }) {
  const Icon = profile.icon;

  return (
    <SettingsItemShell className="py-2.5">
      <div className="flex min-w-0 items-start gap-2.5">
        <Icon className="mt-0.5 size-4 shrink-0 text-honk-icon-secondary" />
        <div className="min-w-0">
          <SettingsItemTitle className="min-w-0 truncate">{profile.label}</SettingsItemTitle>
          <p
            className="mt-0.5 line-clamp-2 text-body text-honk-fg-secondary"
            title={profile.description}
          >
            {profile.description}
          </p>
        </div>
      </div>
    </SettingsItemShell>
  );
}

export function SkillsSettingsPanel() {
  const projects = useStore(useShallow(selectProjectsAcrossEnvironments));
  const [showAllSkills, setShowAllSkills] = useState(false);
  const skillsCwd = projects[0]?.cwd ?? null;
  const runtimeSkillsQuery = useQuery(
    runtimeSkillsQueryOptions({ cwd: skillsCwd, enabled: skillsCwd !== null }),
  );
  const runtimeSkills =
    runtimeSkillsQuery.data?.skills.toSorted(
      (left, right) => left.scope.localeCompare(right.scope) || left.name.localeCompare(right.name),
    ) ?? [];

  const skillsUnavailableReason = !isDesktopRuntimeApiAvailable()
    ? "Skills are available in the desktop runtime."
    : skillsCwd === null
      ? "Add a project to resolve user and project skills."
      : null;
  const visibleRuntimeSkills = showAllSkills
    ? runtimeSkills
    : runtimeSkills.slice(0, SKILLS_PREVIEW_LIMIT);
  const hiddenSkillCount = runtimeSkills.length - visibleRuntimeSkills.length;

  return (
    <SettingsPageContainer>
      <SettingsSection
        title="Skills"
        description="Skills are specialized capabilities that help the agent accomplish specific tasks. Skills will be invoked by the agent when relevant or can be triggered manually with / in chat."
      >
        {skillsUnavailableReason ? (
          <SettingsRow title="Skills unavailable" description={skillsUnavailableReason} />
        ) : runtimeSkillsQuery.isLoading ? (
          <SettingsRow
            title="Loading skills"
            description="Resolving skills for the active project."
          />
        ) : runtimeSkillsQuery.isError ? (
          <SettingsRow
            title="Could not load skills"
            description={
              runtimeSkillsQuery.error instanceof Error
                ? runtimeSkillsQuery.error.message
                : "Skill discovery failed."
            }
          />
        ) : runtimeSkills.length === 0 ? (
          <SettingsRow
            title="No skills found"
            description="User and project skills will appear here."
          />
        ) : (
          <>
            {visibleRuntimeSkills.map((skill) => (
              <SkillSummaryRow key={skill.filePath} skill={skill} />
            ))}
            {hiddenSkillCount > 0 || showAllSkills ? (
              <SettingsItemShell className="py-2.5">
                <button
                  type="button"
                  className="text-body text-honk-fg-tertiary transition-colors hover:text-honk-fg-primary"
                  onClick={() => setShowAllSkills((isShowingAll) => !isShowingAll)}
                >
                  {showAllSkills ? "Show less" : `Show all (${hiddenSkillCount} more)`}
                </button>
              </SettingsItemShell>
            ) : null}
          </>
        )}
      </SettingsSection>

      <SettingsSection
        title="Subagents"
        description="Built-in specialists Honk can delegate to for parallel or focused work."
      >
        {SUBAGENT_PROFILE_CARDS.map((profile) => (
          <SubagentProfileCard key={profile.name} profile={profile} />
        ))}
      </SettingsSection>
    </SettingsPageContainer>
  );
}

const AGENT_INTERACTION_MODE_LABELS: Partial<Record<AgentInteractionMode, string>> = {
  agent: "Agent",
  ask: "Ask",
  plan: "Plan",
  debug: "Debug",
  multitask: "Multitask",
};

const AGENT_INTERACTION_MODE_OPTIONS = AGENT_INTERACTION_MODES.map((value) => ({
  value,
  label: AGENT_INTERACTION_MODE_LABELS[value] ?? value,
}));

const AGENT_MODE_MODEL_DETAILS: Record<
  AgentMode,
  {
    readonly modelName: string;
    readonly description: string;
  }
> = {
  deep: {
    modelName: "GPT-5.5",
    description: "Most capable coding mode, with deep reasoning.",
  },
  smart: {
    modelName: "Claude Opus 4.8",
    description: "Strong intelligence for any task.",
  },
  rush: {
    modelName: "GPT-5.5",
    description: "Fast, low-token work for small, well-defined tasks.",
  },
  composer: {
    modelName: CURSOR_COMPOSER_MODEL_NAME,
    description: "Cursor Composer through Cursor Agent ACP.",
  },
};

function CoreAuthAccountIcon({
  kind,
  className,
}: {
  kind: "claude-code" | CredentialKind;
  className?: string;
}) {
  const Icon =
    kind === "claude-code" ? IconClawd : kind === "cursor-api-key" ? IconCursor : IconOpenaiCodex;

  return <Icon className={className} aria-hidden />;
}

function AgentModeIcon({ mode, className }: { mode: AgentMode; className?: string }) {
  const Icon = mode === "smart" ? IconClawd : mode === "composer" ? IconCursor : IconOpenaiCodex;

  return <Icon className={className} aria-hidden />;
}

function AgentModeSelector({
  activeMode,
  availability,
  disabled,
  onSelectMode,
}: {
  activeMode: AgentMode;
  availability: AgentModeAvailability;
  disabled: boolean;
  onSelectMode: (mode: AgentMode) => void;
}) {
  const activeDetails = AGENT_MODE_MODEL_DETAILS[activeMode];

  return (
    <Menu>
      <MenuTrigger
        type="button"
        className={cn(
          "inline-flex h-7 min-w-43 max-w-full items-center gap-1.5 rounded-honk-control border border-honk-stroke-tertiary bg-honk-bg-quinary px-2 text-body text-honk-fg-secondary outline-hidden transition-colors",
          "hover:border-honk-stroke-secondary hover:bg-honk-bg-quaternary hover:text-honk-fg-primary focus-visible:ring-1 focus-visible:ring-honk-stroke-focused disabled:pointer-events-none disabled:opacity-50",
        )}
        aria-label="Agent mode"
        disabled={disabled}
      >
        <AgentModeIcon mode={activeMode} className="size-3.5 shrink-0 text-honk-icon-secondary" />
        <span className="min-w-0 truncate text-honk-fg-primary">
          {AGENT_MODE_LABELS[activeMode]}
        </span>
        <span className="hidden shrink-0 text-detail text-honk-fg-tertiary sm:inline">
          {activeDetails.modelName}
        </span>
        <IconChevronDownSmall className="ml-auto size-3 shrink-0 text-honk-icon-tertiary" />
      </MenuTrigger>
      <MenuPopup
        align="end"
        alignOffset={0}
        side="bottom"
        sideOffset={4}
        variant="workbench"
        className="w-[240px] border-transparent shadow-honk-base"
      >
        {AGENT_MODE_OPTIONS.map((option) => {
          const details = AGENT_MODE_MODEL_DETAILS[option.value];
          const selected = option.value === activeMode;
          const unavailableReason = unavailableAgentModeReason(option.value, availability);
          const optionDisabled = disabled || unavailableReason !== null;
          const thinkingLevel = AGENT_MODE_THINKING_LEVELS[option.value];
          const effortLabel =
            thinkingLevel === "off"
              ? "No thinking"
              : `${AGENT_THINKING_LEVEL_LABELS[thinkingLevel]} effort`;
          const summaryLabel = option.value === "composer" ? "Cursor ACP" : effortLabel;

          const content = (
            <>
              <AgentModeIcon
                mode={option.value}
                className="mt-0.5 size-3.5 shrink-0 text-honk-icon-secondary"
              />
              <span className="min-w-0 flex-1">
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className="truncate text-honk-fg-primary">{option.label}</span>
                  <span className="shrink-0 text-detail text-honk-fg-tertiary">
                    {details.modelName}
                  </span>
                </span>
                <span className="block truncate text-detail text-honk-fg-tertiary">
                  {unavailableReason ?? summaryLabel}
                </span>
              </span>
              {selected ? <IconCheckmark1 className="size-3 shrink-0" aria-hidden /> : null}
            </>
          );

          if (optionDisabled) {
            return (
              <MenuItem
                key={option.value}
                variant="workbench"
                className="min-h-9 gap-2 opacity-50"
                disabled
              >
                {content}
              </MenuItem>
            );
          }

          return (
            <MenuSub key={option.value}>
              <MenuSubTrigger
                variant="workbench"
                className="min-h-9 gap-2 pe-1 transition-none [&>svg:last-child]:hidden"
                onPointerDownCapture={() => onSelectMode(option.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    onSelectMode(option.value);
                  }
                }}
              >
                {content}
              </MenuSubTrigger>
              <MenuSubPopup
                variant="workbench"
                side="inline-end"
                className="w-[220px] border-transparent shadow-honk-base"
              >
                <div className="px-2 py-1.5">
                  <div className="flex items-center gap-1.5 text-body font-medium text-honk-fg-primary">
                    <AgentModeIcon
                      mode={option.value}
                      className="size-4 shrink-0 text-honk-icon-secondary"
                    />
                    <span>{details.modelName}</span>
                  </div>
                  <p className="mt-1 text-body text-honk-fg-secondary">{details.description}</p>
                  <p className="mt-2 text-detail text-honk-fg-tertiary">
                    {option.value === "composer"
                      ? "Fast mode is configured in composer edit."
                      : effortLabel}
                  </p>
                </div>
              </MenuSubPopup>
            </MenuSub>
          );
        })}
      </MenuPopup>
    </Menu>
  );
}

function AgentModeInlineSummary({
  mode,
  availability,
}: {
  mode: AgentMode;
  availability: AgentModeAvailability;
}) {
  const details = AGENT_MODE_MODEL_DETAILS[mode];
  const unavailableReason = unavailableAgentModeReason(mode, availability);

  return (
    <span className="mt-1 flex min-w-0 items-center gap-1.5 text-detail text-honk-fg-tertiary">
      <AgentModeIcon mode={mode} className="size-3 shrink-0 text-honk-icon-tertiary" />
      <span className="truncate">
        {details.modelName}
        {unavailableReason ? ` unavailable. ${unavailableReason}` : ""}
      </span>
    </span>
  );
}

function describeCoreCredentialStatus(
  status: CredentialStatus | null,
  missingDescription: string,
): string {
  if (status === null || status.state === "missing") {
    return missingDescription;
  }
  if (status.state === "available") {
    return status.label ?? status.message ?? "Account connected.";
  }
  if (status.message) {
    return status.message;
  }
  switch (status.state) {
    case "expired":
      return "Credential expired.";
    case "error":
      return "Credential needs attention.";
  }
}

function CoreAuthFlowPanel({
  disabled,
  flow,
  onCancel,
  onRetry,
}: {
  disabled: boolean;
  flow: LoginFlow;
  onCancel: () => void;
  onRetry: () => void;
}) {
  const openVerificationUri = () => {
    if (!flow.verificationUri) {
      return;
    }
    const localApi = readLocalApi();
    if (localApi) {
      void localApi.shell.openExternal(flow.verificationUri).catch((error: unknown) => {
        toastManager.add({
          type: "error",
          title: "Could not open login page",
          description: error instanceof Error ? error.message : "Open the login link manually.",
        });
      });
      return;
    }
    if (typeof window !== "undefined") {
      window.open(flow.verificationUri, "_blank", "noopener,noreferrer");
    }
  };
  const copyUserCode = () => {
    if (!flow.userCode) {
      return;
    }
    if (!navigator.clipboard?.writeText) {
      toastManager.add({
        type: "error",
        title: "Clipboard unavailable",
        description: "Copy the login code manually.",
      });
      return;
    }
    void navigator.clipboard.writeText(flow.userCode).then(
      () => {
        toastManager.add({
          type: "success",
          title: "Copied login code",
          description: flow.userCode ?? "",
        });
      },
      (error: unknown) => {
        toastManager.add({
          type: "error",
          title: "Failed to copy login code",
          description: error instanceof Error ? error.message : "Copy the login code manually.",
        });
      },
    );
  };

  return (
    <div className="mt-3 border-t border-honk-stroke-quaternary pt-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <Text as="div" size="sm" tone="primary" weight="medium">
            {flow.state === "error" ? "Login failed" : "Waiting for login"}
          </Text>
          <p className="mt-0.5">
            <Text as="span" size="base" tone="tertiary">
              {flow.message ?? "Complete authentication to continue."}
            </Text>
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {flow.state === "error" ? (
            <Button size="xs" variant="outline" disabled={disabled} onClick={onRetry}>
              Retry
            </Button>
          ) : flow.verificationUri ? (
            <Button size="xs" variant="outline" disabled={disabled} onClick={openVerificationUri}>
              Open login page
            </Button>
          ) : null}
          <Button size="xs" variant="ghost" disabled={disabled} onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
      {flow.userCode ? (
        <div className="mt-2 flex min-w-0 items-center gap-2">
          <code className="min-w-0 truncate font-honk-mono text-honk-lg tracking-wide text-honk-fg-primary">
            {flow.userCode}
          </code>
          <Button size="xs" variant="ghost" onClick={copyUserCode}>
            Copy code
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function CursorApiKeyForm({
  disabled,
  draftValue,
  onCancel,
  onDraftChange,
  onSubmit,
}: {
  disabled: boolean;
  draftValue: string;
  onCancel: () => void;
  onDraftChange: (value: string) => void;
  onSubmit: (apiKey: string) => void;
}) {
  const trimmedDraft = draftValue.trim();

  return (
    <form
      className="mt-3 border-t border-honk-stroke-quaternary pt-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (trimmedDraft.length > 0) {
          onSubmit(trimmedDraft);
        }
      }}
    >
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          type="password"
          size="sm"
          value={draftValue}
          placeholder="Paste Cursor API key"
          aria-label="Cursor API key value"
          autoComplete="off"
          disabled={disabled}
          onChange={(event) => onDraftChange(event.currentTarget.value)}
        />
        <Button
          type="submit"
          size="xs"
          variant="outline"
          disabled={disabled || trimmedDraft.length === 0}
          className="shrink-0"
        >
          {disabled ? "Saving..." : "Save key"}
        </Button>
        <Button
          type="button"
          size="xs"
          variant="ghost"
          disabled={disabled}
          className="shrink-0"
          onClick={onCancel}
        >
          Cancel
        </Button>
      </div>
      <p className="mt-2">
        <Text as="span" size="sm" tone="tertiary">
          Saved locally. Existing keys stay hidden.
        </Text>
      </p>
    </form>
  );
}

export function AgentRuntimeSettingsSections() {
  const snapshot = useAgentRuntimeStore((state) => state.snapshot);

  return <AgentRuntimeSettingsSectionsView snapshot={snapshot} />;
}

export function AgentRuntimeSettingsSectionsView({
  snapshot,
}: {
  snapshot: HonkRuntimeHostSnapshot;
}) {
  const queryClient = useQueryClient();
  const preferences = snapshot.preferences;
  const coreAuthQuery = useQuery(coreAuthSnapshotQueryOptions());
  const authSnapshot = coreAuthQuery.data ?? EMPTY_CORE_AUTH_SNAPSHOT;
  const coreAuthLoginMutation = useMutation(coreAuthLoginMutationOptions({ queryClient }));
  const coreAuthLogoutMutation = useMutation(coreAuthLogoutMutationOptions({ queryClient }));
  const coreAuthCancelFlowMutation = useMutation(
    coreAuthCancelFlowMutationOptions({ queryClient }),
  );
  const multitaskModeEnabled = useLocalFeatureFlagsStore((state) => state.multitaskModeEnabled);
  const interactionModeOptions = multitaskModeEnabled
    ? AGENT_INTERACTION_MODE_OPTIONS
    : AGENT_INTERACTION_MODE_OPTIONS.filter((option) => option.value !== "multitask");
  const modelAvailability = deriveAgentModeAvailability(authSnapshot);
  const [isSaving, setIsSaving] = useState(false);
  const [isEditingCursorApiKey, setIsEditingCursorApiKey] = useState(false);
  const [cursorApiKeyDraft, setCursorApiKeyDraft] = useState("");

  const claudeHarness =
    authSnapshot.harnesses.find((harness) => harness.harness === "claude-code") ?? null;
  const codexCredential =
    authSnapshot.credentials.find((credential) => credential.kind === "codex-oauth") ?? null;
  const cursorCredential =
    authSnapshot.credentials.find((credential) => credential.kind === "cursor-api-key") ?? null;
  const codexCredentialState = codexCredential?.state ?? "missing";
  const cursorCredentialState = cursorCredential?.state ?? "missing";
  const coreAuthFlow = authSnapshot.flow;
  const claudeAvailable = claudeHarness?.available ?? false;
  const codexAvailable = codexCredentialState === "available";
  const cursorAvailable = cursorCredentialState === "available";
  const showNoAccountsConnected = !claudeAvailable && !codexAvailable && !cursorAvailable;
  const coreAuthMutating =
    coreAuthLoginMutation.isPending ||
    coreAuthLogoutMutation.isPending ||
    coreAuthCancelFlowMutation.isPending;

  const addableCoreCredentials: Array<{
    readonly kind: CredentialKind;
    readonly label: string;
  }> = [];
  if (codexCredentialState === "missing" && coreAuthFlow === null) {
    addableCoreCredentials.push({ kind: "codex-oauth", label: "Codex · ChatGPT sign-in" });
  }
  if (cursorCredentialState === "missing" && !isEditingCursorApiKey) {
    addableCoreCredentials.push({ kind: "cursor-api-key", label: "Cursor · API key" });
  }

  const showCoreAuthError = (title: string, error: unknown) => {
    toastManager.add({
      type: "error",
      title,
      description: error instanceof Error ? error.message : "Authentication update failed.",
    });
  };

  const startCodexLogin = () => {
    void coreAuthLoginMutation
      .mutateAsync({ kind: "codex-oauth" })
      .catch((error: unknown) => showCoreAuthError("Failed to start Codex sign-in", error));
  };

  const saveCursorApiKey = (apiKey: string) => {
    const trimmedApiKey = apiKey.trim();
    if (trimmedApiKey.length === 0) {
      return;
    }
    void coreAuthLoginMutation
      .mutateAsync({ kind: "cursor-api-key", apiKey: trimmedApiKey })
      .then(() => {
        setCursorApiKeyDraft("");
        setIsEditingCursorApiKey(false);
      })
      .catch((error: unknown) => showCoreAuthError("Failed to save Cursor API key", error));
  };

  const removeCoreCredential = (kind: CredentialKind) => {
    void coreAuthLogoutMutation
      .mutateAsync({ kind })
      .then(() => {
        if (kind === "cursor-api-key") {
          setCursorApiKeyDraft("");
          setIsEditingCursorApiKey(false);
        }
      })
      .catch((error: unknown) => showCoreAuthError("Failed to remove account", error));
  };

  const cancelCoreAuthFlow = () => {
    void coreAuthCancelFlowMutation
      .mutateAsync()
      .catch((error: unknown) => showCoreAuthError("Failed to cancel sign-in", error));
  };

  const startAddingCoreCredential = (kind: CredentialKind) => {
    if (kind === "codex-oauth") {
      startCodexLogin();
      return;
    }
    setIsEditingCursorApiKey(true);
  };

  const updateAgentPreferences = (patch: AgentPreferencesPatch) => {
    setIsSaving(true);
    const runtimeApi = readHonkRuntimeApi();
    void runtimeApi
      .updatePreferences(patch)
      .catch((error: unknown) => {
        toastManager.add({
          type: "error",
          title: "Failed to update agent preferences",
          description: error instanceof Error ? error.message : "Agent preference update failed.",
        });
      })
      .finally(() => setIsSaving(false));
  };

  return (
    <>
      <SettingsSection title="Pi runtime">
        <SettingsRow
          preferenceId="agents.agent-mode"
          title="Agent mode"
          description="Default model for new sessions."
          status={
            <AgentModeInlineSummary mode={preferences.agentMode} availability={modelAvailability} />
          }
          control={
            <AgentModeSelector
              activeMode={preferences.agentMode}
              availability={modelAvailability}
              disabled={isSaving}
              onSelectMode={(agentMode) => {
                if (agentMode === preferences.agentMode) {
                  return;
                }
                updateAgentPreferences({
                  agentMode,
                  thinkingLevel: AGENT_MODE_THINKING_LEVELS[agentMode],
                  ...(agentMode === "composer"
                    ? { modelSelection: cursorComposerPolicyModelSelection() }
                    : {}),
                });
              }}
            />
          }
        />
        {agentModeSupportsThinkingLevelSelection(preferences.agentMode) ? (
          <SettingsRow
            preferenceId="agents.thinking-level"
            title="Thinking level"
            description="Default reasoning depth for new Pi sessions in this agent mode."
            control={
              <Select
                value={normalizedConfigurableThinkingLevel(preferences.thinkingLevel)}
                onValueChange={(value) => {
                  const option = AGENT_THINKING_LEVEL_OPTIONS.find(
                    (entry) => entry.value === value,
                  );
                  if (option) {
                    updateAgentPreferences({
                      thinkingLevel: option.value,
                    });
                  }
                }}
              >
                <SelectTrigger
                  size="xs"
                  variant="outline"
                  className="w-full sm:w-34"
                  aria-label="Thinking level"
                  disabled={isSaving}
                >
                  <SelectValue>
                    {
                      AGENT_THINKING_LEVEL_LABELS[
                        normalizedConfigurableThinkingLevel(preferences.thinkingLevel)
                      ]
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  {AGENT_THINKING_LEVEL_OPTIONS.map((option) => (
                    <SelectItem key={option.value} hideIndicator value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            }
          />
        ) : null}
        <SettingsRow
          preferenceId="agents.interaction-mode"
          title="Interaction mode"
          description="Default behavior for new agent turns."
          control={
            <Select
              value={preferences.interactionMode}
              onValueChange={(value) => {
                const option = interactionModeOptions.find((entry) => entry.value === value);
                if (option) {
                  updateAgentPreferences({ interactionMode: option.value });
                }
              }}
            >
              <SelectTrigger
                size="xs"
                variant="outline"
                className="w-full sm:w-34"
                aria-label="Interaction mode"
                disabled={isSaving}
              >
                <SelectValue>
                  {AGENT_INTERACTION_MODE_LABELS[preferences.interactionMode] ??
                    preferences.interactionMode}
                </SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                {interactionModeOptions.map((option) => (
                  <SelectItem key={option.value} hideIndicator value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          }
        />
      </SettingsSection>

      <SettingsSection
        title="Accounts"
        headerAction={
          addableCoreCredentials.length > 0 ? (
            <Menu>
              <MenuTrigger
                render={
                  <Button size="xs" variant="ghost" disabled={coreAuthMutating}>
                    Add
                  </Button>
                }
              />
              <MenuPopup align="end">
                {addableCoreCredentials.map((credential) => (
                  <MenuItem
                    key={credential.kind}
                    className="gap-2"
                    onClick={() => startAddingCoreCredential(credential.kind)}
                  >
                    <CoreAuthAccountIcon
                      kind={credential.kind}
                      className="size-3.5 shrink-0 text-honk-icon-secondary"
                    />
                    {credential.label}
                  </MenuItem>
                ))}
              </MenuPopup>
            </Menu>
          ) : null
        }
      >
        {showNoAccountsConnected ? (
          <SettingsRow
            title="No accounts connected"
            description="Claude uses your Claude Code login. Add Codex (ChatGPT sign-in) or a Cursor API key to enable those models."
          />
        ) : null}
        <SettingsRow
          preferenceId="agents.account.claude-code"
          title={
            <span className="inline-flex items-center gap-1.5">
              <CoreAuthAccountIcon
                kind="claude-code"
                className="size-3.5 shrink-0 text-honk-icon-secondary"
              />
              Claude Code
            </span>
          }
          description={
            claudeAvailable
              ? (claudeHarness?.detail ?? "Claude Code login available.")
              : "Uses your Claude Code login. Run `claude login` to connect."
          }
        />
        <SettingsRow
          preferenceId="agents.account.codex-oauth"
          title={
            <span className="inline-flex items-center gap-1.5">
              <CoreAuthAccountIcon
                kind="codex-oauth"
                className="size-3.5 shrink-0 text-honk-icon-secondary"
              />
              Codex
            </span>
          }
          description={
            coreAuthFlow
              ? (coreAuthFlow.message ??
                (coreAuthFlow.state === "error"
                  ? "Codex sign-in failed."
                  : "Complete ChatGPT sign-in to connect Codex."))
              : describeCoreCredentialStatus(
                  codexCredential,
                  "Add ChatGPT sign-in to enable Codex models.",
                )
          }
          control={
            coreAuthFlow ? null : codexAvailable ? (
              <Button
                size="xs"
                variant="ghost"
                disabled={coreAuthMutating}
                onClick={() => removeCoreCredential("codex-oauth")}
              >
                Remove
              </Button>
            ) : codexCredentialState === "expired" || codexCredentialState === "error" ? (
              <Button
                size="xs"
                variant="ghost"
                disabled={coreAuthMutating}
                onClick={startCodexLogin}
              >
                Re-login
              </Button>
            ) : null
          }
        >
          {coreAuthFlow ? (
            <CoreAuthFlowPanel
              disabled={coreAuthMutating}
              flow={coreAuthFlow}
              onCancel={cancelCoreAuthFlow}
              onRetry={startCodexLogin}
            />
          ) : null}
        </SettingsRow>
        <SettingsRow
          preferenceId="agents.account.cursor-api-key"
          title={
            <span className="inline-flex items-center gap-1.5">
              <CoreAuthAccountIcon
                kind="cursor-api-key"
                className="size-3.5 shrink-0 text-honk-icon-secondary"
              />
              Cursor
            </span>
          }
          description={describeCoreCredentialStatus(
            cursorCredential,
            "Add a Cursor API key to enable Cursor Composer.",
          )}
          control={
            isEditingCursorApiKey ? null : cursorAvailable ? (
              <Button
                size="xs"
                variant="ghost"
                disabled={coreAuthMutating}
                onClick={() => removeCoreCredential("cursor-api-key")}
              >
                Remove
              </Button>
            ) : cursorCredentialState === "expired" || cursorCredentialState === "error" ? (
              <Button
                size="xs"
                variant="ghost"
                disabled={coreAuthMutating}
                onClick={() => setIsEditingCursorApiKey(true)}
              >
                Update key
              </Button>
            ) : null
          }
        >
          {isEditingCursorApiKey ? (
            <CursorApiKeyForm
              disabled={coreAuthMutating}
              draftValue={cursorApiKeyDraft}
              onCancel={() => {
                setCursorApiKeyDraft("");
                setIsEditingCursorApiKey(false);
              }}
              onDraftChange={setCursorApiKeyDraft}
              onSubmit={saveCursorApiKey}
            />
          ) : null}
        </SettingsRow>
      </SettingsSection>
    </>
  );
}

export function ArchivedThreadsPanel() {
  const projects = useStore(useShallow(selectProjectsAcrossEnvironments));
  const threads = useStore(useShallow(selectThreadShellsAcrossEnvironments));
  const { unarchiveThread, confirmAndDeleteThread } = useThreadActions();
  const archivedGroups = projects
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

  const handleArchivedThreadContextMenu = async (
    threadRef: ScopedThreadRef,
    position: { x: number; y: number },
  ) => {
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
  };

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
              <SettingsItemShell
                key={thread.id}
                className="flex items-center justify-between gap-3 py-3"
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
                  <SettingsItemTitle className="truncate">{thread.title}</SettingsItemTitle>
                  <Text as="p" display="block" size="xs" tone="secondary">
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
              </SettingsItemShell>
            ))}
          </SettingsSection>
        ))
      )}
    </SettingsPageContainer>
  );
}
