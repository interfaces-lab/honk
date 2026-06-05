import { IconArchive1, IconArchiveJunk } from "central-icons";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  AGENT_INTERACTION_MODES,
  type AgentAuthStatus,
  type AgentCredentialAuthFlow,
  type AgentCredentialKind,
  type AgentCredentialPreference,
  type AgentInteractionMode,
  type AgentPreferencesPatch,
  type AgentWindowSendWhileStreamingBehavior,
  type AgentWindowUsageSummaryDisplay,
  type MultiRuntimeHostSnapshot,
  type ScopedThreadRef,
} from "@multi/contracts";
import { scopeThreadRef } from "~/lib/environment-scope";
import { DEFAULT_UNIFIED_SETTINGS } from "@multi/contracts/settings";
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
import { Button } from "@multi/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@multi/ui/empty";
import { Input } from "@multi/ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "@multi/ui/select";
import { Switch } from "@multi/ui/switch";
import { Text, textVariants } from "@multi/ui/text";
import { toastManager } from "~/app/toast";
import { readMultiRuntimeApi } from "~/lib/multi-runtime-api";
import { useAgentRuntimeStore } from "~/stores/agent-runtime-store";
import {
  AGENT_MODE_LABELS,
  AGENT_MODE_OPTIONS,
  AGENT_MODE_THINKING_LEVELS,
  AGENT_THINKING_LEVEL_LABELS,
  AGENT_THINKING_LEVEL_OPTIONS,
  agentModeSupportsThinkingLevelSelection,
  normalizedConfigurableThinkingLevel,
} from "~/lib/agent-mode-options";
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
  };

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

  const isAgentWindowAppearanceDirty =
    settings.agentWindowFontSmoothingAntialiased !==
      DEFAULT_UNIFIED_SETTINGS.agentWindowFontSmoothingAntialiased ||
    settings.agentWindowChatMaxWidth !== DEFAULT_UNIFIED_SETTINGS.agentWindowChatMaxWidth ||
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
    ? "Backend evlog JSONL files and local trace files."
    : "Backend evlog JSONL files.";

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

export function AgentsSettingsPanel() {
  const settings = useSettings();
  const { updateSettings } = useUpdateSettings();

  return (
    <SettingsPageContainer>
      <AgentRuntimeSettingsSections />

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
                void updateSettings({ enableAssistantStreaming: checked })
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
              onCheckedChange={(checked) => void updateSettings({ diffWordWrap: checked })}
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
              onCheckedChange={(checked) => void updateSettings({ confirmThreadArchive: checked })}
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
              onCheckedChange={(checked) => void updateSettings({ confirmThreadDelete: checked })}
            />
          }
        />
      </SettingsSection>
    </SettingsPageContainer>
  );
}

const AGENT_INTERACTION_MODE_LABELS: Partial<Record<AgentInteractionMode, string>> = {
  agent: "Agent",
  ask: "Ask",
  plan: "Plan",
  debug: "Debug",
};

const AGENT_INTERACTION_MODE_OPTIONS = AGENT_INTERACTION_MODES.map((value) => ({
  value,
  label: AGENT_INTERACTION_MODE_LABELS[value] ?? value,
}));

const AGENT_AUTH_STATE_LABELS: Record<AgentAuthStatus["state"], string> = {
  available: "Available",
  missing: "Missing",
  expired: "Expired",
  error: "Error",
  unknown: "Unknown",
};

function findCredentialAuthStatus(
  credential: AgentCredentialPreference,
  authStatuses: readonly AgentAuthStatus[],
): AgentAuthStatus | null {
  return (
    authStatuses.find(
      (status) =>
        status.authProviderId === credential.authProviderId &&
        (status.accountId === credential.accountId ||
          status.accountId === null ||
          credential.accountId === null),
    ) ?? null
  );
}

function findCredentialAuthFlow(
  credential: AgentCredentialPreference,
  authFlows: readonly AgentCredentialAuthFlow[],
): AgentCredentialAuthFlow | null {
  return authFlows.find((flow) => flow.authProviderId === credential.authProviderId) ?? null;
}

function describeCredentialState(status: AgentAuthStatus | null): string {
  if (status?.message) {
    return status.message;
  }
  switch (status?.state ?? "missing") {
    case "available":
      return "Pi auth storage has a usable credential.";
    case "expired":
      return "Pi auth storage has an expired credential.";
    case "error":
      return "Pi auth storage reported a credential error.";
    case "unknown":
      return "Pi runtime has not reported this credential yet.";
    case "missing":
      return "No credential configured in Pi auth storage.";
  }
}

function describeCredentialDisplayState(
  status: AgentAuthStatus | null,
  authFlow: AgentCredentialAuthFlow | null,
): string {
  if (authFlow?.state === "pending") {
    return authFlow.message ?? "Complete the in-progress Pi authentication flow.";
  }
  if (authFlow?.state === "error") {
    return authFlow.message ?? "Pi authentication failed.";
  }
  return describeCredentialState(status);
}

function resolveCredentialStatusLabel(
  status: AgentAuthStatus | null,
  authFlow: AgentCredentialAuthFlow | null,
): string {
  if (authFlow?.state === "pending") {
    return "Login pending";
  }
  if (authFlow?.state === "error") {
    return "Login failed";
  }
  return AGENT_AUTH_STATE_LABELS[status?.state ?? "missing"];
}

function resolveCredentialActionLabel(
  credential: AgentCredentialPreference,
  status: AgentAuthStatus | null,
): string {
  if (credential.kind === "codex-oauth") {
    return status?.state === "available" ? "Reauthorize" : "Login";
  }
  return status?.state === "available" ? "Update key" : "Add key";
}

function isApiKeyCredential(credential: AgentCredentialPreference): boolean {
  return credential.kind !== "codex-oauth";
}

function CredentialAuthFlowPanel({ flow }: { flow: AgentCredentialAuthFlow }) {
  const openVerificationUri = () => {
    if (!flow.verificationUri) {
      return;
    }
    const localApi = readLocalApi();
    if (localApi) {
      void localApi.shell.openExternal(flow.verificationUri);
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
    <div className="mt-3 rounded-md border border-multi-stroke-tertiary bg-multi-bg-quaternary px-3 py-2.5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <Text render={<div />} size="sm" tone="primary" weight="medium">
            {flow.state === "error" ? "Login failed" : "Waiting for login"}
          </Text>
          <Text render={<p />} size="base" tone="tertiary" className="mt-0.5">
            {flow.message ?? "Complete authentication to continue."}
          </Text>
        </div>
        {flow.verificationUri ? (
          <Button size="xs" variant="outline" onClick={openVerificationUri}>
            Open login page
          </Button>
        ) : null}
      </div>
      {flow.userCode ? (
        <div className="mt-2 flex min-w-0 items-center gap-2">
          <code className="min-w-0 rounded border border-multi-stroke-tertiary bg-multi-bg-primary px-2 py-1 font-multi-mono text-body text-multi-fg-primary">
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

function CredentialApiKeyForm({
  credential,
  disabled,
  draftValue,
  showCancel,
  onCancel,
  onDraftChange,
  onSubmit,
}: {
  credential: AgentCredentialPreference;
  disabled: boolean;
  draftValue: string;
  showCancel: boolean;
  onCancel: () => void;
  onDraftChange: (value: string) => void;
  onSubmit: (apiKey: string) => void;
}) {
  const inputId = `agent-credential-api-key-${credential.kind}`;
  const trimmedDraft = draftValue.trim();

  return (
    <form
      className="mt-3 rounded-md border border-multi-stroke-tertiary bg-multi-bg-quaternary px-3 py-2.5"
      onSubmit={(event) => {
        event.preventDefault();
        if (trimmedDraft.length > 0) {
          onSubmit(trimmedDraft);
        }
      }}
    >
      <label
        htmlFor={inputId}
        className={textVariants({ size: "sm", tone: "primary", weight: "medium" })}
      >
        API key
      </label>
      <div className="mt-2 flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          id={inputId}
          type="password"
          size="sm"
          value={draftValue}
          placeholder={`Paste ${credential.label}`}
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
        {showCancel ? (
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
        ) : null}
      </div>
      <Text render={<p />} size="sm" tone="tertiary" className="mt-2">
        Stored in Pi auth storage. Saved keys are never displayed here.
      </Text>
    </form>
  );
}

export function AgentRuntimeSettingsSections() {
  const snapshot = useAgentRuntimeStore((state) => state.snapshot);
  const setSnapshot = useAgentRuntimeStore((state) => state.setSnapshot);

  return <AgentRuntimeSettingsSectionsView snapshot={snapshot} setSnapshot={setSnapshot} />;
}

export function AgentRuntimeSettingsSectionsView({
  snapshot,
  setSnapshot,
}: {
  snapshot: MultiRuntimeHostSnapshot;
  setSnapshot: (snapshot: MultiRuntimeHostSnapshot) => void;
}) {
  const preferences = snapshot.preferences;
  const authStatuses = snapshot.authStatuses;
  const authFlows = snapshot.credentialAuthFlows;
  const [isSaving, setIsSaving] = useState(false);
  const [pendingCredentialKind, setPendingCredentialKind] = useState<AgentCredentialKind | null>(
    null,
  );
  const [editingApiKeyCredentialKind, setEditingApiKeyCredentialKind] =
    useState<AgentCredentialKind | null>(null);
  const [apiKeyDraftByKind, setApiKeyDraftByKind] = useState<
    Partial<Record<AgentCredentialKind, string>>
  >({});

  const updateAgentPreferences = (patch: AgentPreferencesPatch) => {
    setIsSaving(true);
    const runtimeApi = readMultiRuntimeApi();
    void runtimeApi
      .updatePreferences(patch)
      .then(async () => {
        const snapshot = await runtimeApi.getHostSnapshot();
        setSnapshot(snapshot);
      })
      .catch((error: unknown) => {
        toastManager.add({
          type: "error",
          title: "Failed to update agent preferences",
          description: error instanceof Error ? error.message : "Agent preference update failed.",
        });
      })
      .finally(() => setIsSaving(false));
  };

  const configureOAuthCredential = async (credential: AgentCredentialPreference) => {
    const runtimeApi = readMultiRuntimeApi();
    setPendingCredentialKind(credential.kind);
    try {
      const snapshot = await runtimeApi.configureCredential({
        authProviderId: credential.authProviderId,
        method: "oauth",
      });
      setSnapshot(snapshot);
    } catch (error: unknown) {
      toastManager.add({
        type: "error",
        title: "Failed to configure credential",
        description: error instanceof Error ? error.message : "Credential update failed.",
      });
    } finally {
      setPendingCredentialKind(null);
    }
  };

  const configureApiKeyCredential = async (
    credential: AgentCredentialPreference,
    apiKey: string,
  ) => {
    const trimmedApiKey = apiKey.trim();
    if (trimmedApiKey.length === 0) {
      return;
    }

    const runtimeApi = readMultiRuntimeApi();
    setPendingCredentialKind(credential.kind);
    try {
      const snapshot = await runtimeApi.configureCredential({
        authProviderId: credential.authProviderId,
        method: "api-key",
        apiKey: trimmedApiKey,
      });
      setSnapshot(snapshot);
      setApiKeyDraftByKind((previous) => {
        const next = { ...previous };
        delete next[credential.kind];
        return next;
      });
      setEditingApiKeyCredentialKind((current) =>
        current === credential.kind ? null : current,
      );
    } catch (error: unknown) {
      toastManager.add({
        type: "error",
        title: "Failed to save credential",
        description: error instanceof Error ? error.message : "Credential update failed.",
      });
    } finally {
      setPendingCredentialKind(null);
    }
  };

  const removeCredential = async (credential: AgentCredentialPreference) => {
    const runtimeApi = readMultiRuntimeApi();
    setPendingCredentialKind(credential.kind);
    try {
      const snapshot = await runtimeApi.configureCredential({
        authProviderId: credential.authProviderId,
        method: "logout",
      });
      setSnapshot(snapshot);
      setApiKeyDraftByKind((previous) => {
        const next = { ...previous };
        delete next[credential.kind];
        return next;
      });
      if (isApiKeyCredential(credential)) {
        setEditingApiKeyCredentialKind(credential.kind);
      }
    } catch (error: unknown) {
      toastManager.add({
        type: "error",
        title: "Failed to remove credential",
        description: error instanceof Error ? error.message : "Credential removal failed.",
      });
    } finally {
      setPendingCredentialKind(null);
    }
  };

  return (
    <>
      <SettingsSection title="Pi runtime">
        <SettingsRow
          title="Agent mode"
          description="Default speed/depth posture for new Pi sessions."
          control={
            <Select
              value={preferences.agentMode}
              onValueChange={(value) => {
                const option = AGENT_MODE_OPTIONS.find((entry) => entry.value === value);
                if (option) {
                  updateAgentPreferences({
                    agentMode: option.value,
                    thinkingLevel: AGENT_MODE_THINKING_LEVELS[option.value],
                  });
                }
              }}
            >
              <SelectTrigger
                size="xs"
                variant="outline"
                className="w-full sm:w-34"
                aria-label="Agent mode"
                disabled={isSaving}
              >
                <SelectValue>{AGENT_MODE_LABELS[preferences.agentMode]}</SelectValue>
              </SelectTrigger>
              <SelectPopup align="end" alignItemWithTrigger={false}>
                {AGENT_MODE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} hideIndicator value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          }
        />
        {agentModeSupportsThinkingLevelSelection(preferences.agentMode) ? (
          <SettingsRow
            title="Thinking level"
            description="Default reasoning depth for new Pi sessions in this agent mode."
            control={
              <Select
                value={normalizedConfigurableThinkingLevel(preferences.thinkingLevel)}
                onValueChange={(value) => {
                  const option = AGENT_THINKING_LEVEL_OPTIONS.find((entry) => entry.value === value);
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
                    {AGENT_THINKING_LEVEL_LABELS[
                      normalizedConfigurableThinkingLevel(preferences.thinkingLevel)
                    ]}
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
          title="Interaction mode"
          description="Default behavior for new agent turns."
          control={
            <Select
              value={preferences.interactionMode}
              onValueChange={(value) => {
                const option = AGENT_INTERACTION_MODE_OPTIONS.find(
                  (entry) => entry.value === value,
                );
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
                {AGENT_INTERACTION_MODE_OPTIONS.map((option) => (
                  <SelectItem key={option.value} hideIndicator value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectPopup>
            </Select>
          }
        />
      </SettingsSection>

      <SettingsSection title="Accounts">
        {preferences.credentials.map((credential) => {
          const status = findCredentialAuthStatus(credential, authStatuses);
          const authFlow = findCredentialAuthFlow(credential, authFlows);
          const isCredentialPending = pendingCredentialKind === credential.kind;
          const canStartCredentialAction = pendingCredentialKind === null || isCredentialPending;
          const isAvailable = status?.state === "available";
          const showApiKeyEditor =
            isApiKeyCredential(credential) &&
            (editingApiKeyCredentialKind === credential.kind || !isAvailable);
          const draftValue = apiKeyDraftByKind[credential.kind] ?? "";
          return (
            <SettingsRow
              key={credential.kind}
              title={credential.label}
              description={describeCredentialDisplayState(status, authFlow)}
              status={resolveCredentialStatusLabel(status, authFlow)}
              control={
                credential.kind === "codex-oauth" ? (
                  <>
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={!canStartCredentialAction}
                      onClick={() => void configureOAuthCredential(credential)}
                    >
                      {isCredentialPending
                        ? "Working..."
                        : resolveCredentialActionLabel(credential, status)}
                    </Button>
                    {isAvailable ? (
                      <Button
                        size="xs"
                        variant="ghost"
                        disabled={!canStartCredentialAction}
                        onClick={() => void removeCredential(credential)}
                      >
                        Sign out
                      </Button>
                    ) : null}
                  </>
                ) : showApiKeyEditor ? (
                  isAvailable ? (
                    <Button
                      size="xs"
                      variant="ghost"
                      disabled={!canStartCredentialAction}
                      onClick={() => void removeCredential(credential)}
                    >
                      Remove
                    </Button>
                  ) : null
                ) : (
                  <>
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={!canStartCredentialAction}
                      onClick={() => setEditingApiKeyCredentialKind(credential.kind)}
                    >
                      {resolveCredentialActionLabel(credential, status)}
                    </Button>
                    <Button
                      size="xs"
                      variant="ghost"
                      disabled={!canStartCredentialAction}
                      onClick={() => void removeCredential(credential)}
                    >
                      Remove
                    </Button>
                  </>
                )
              }
            >
              {showApiKeyEditor ? (
                <CredentialApiKeyForm
                  credential={credential}
                  disabled={!canStartCredentialAction || isCredentialPending}
                  draftValue={draftValue}
                  showCancel={isAvailable}
                  onCancel={() => {
                    setEditingApiKeyCredentialKind((current) =>
                      current === credential.kind ? null : current,
                    );
                    setApiKeyDraftByKind((previous) => {
                      const next = { ...previous };
                      delete next[credential.kind];
                      return next;
                    });
                  }}
                  onDraftChange={(value) =>
                    setApiKeyDraftByKind((previous) => ({
                      ...previous,
                      [credential.kind]: value,
                    }))
                  }
                  onSubmit={(apiKey) => void configureApiKeyCredential(credential, apiKey)}
                />
              ) : null}
              {authFlow ? <CredentialAuthFlowPanel flow={authFlow} /> : null}
            </SettingsRow>
          );
        })}
      </SettingsSection>

      <SettingsSection title="Pi session">
        <SettingsRow
          title="Session tree"
          description="Runtime session trees are persisted and rendered for branch navigation."
          status="Always on"
        />
      </SettingsSection>

      <SettingsSection title="Resources">
        <SettingsRow
          title="Workspace files"
          description="Project files are available to Pi runtime tools."
          status={preferences.resources.workspaceFiles ? "Active" : "Disabled"}
        />
        <SettingsRow
          title="Git"
          description="Repository context and git operations are available in runtime sessions."
          status={preferences.resources.git ? "Active" : "Disabled"}
        />
        <SettingsRow
          title="Terminal"
          description="Shell-backed tools run through the desktop runtime environment."
          status={preferences.resources.terminal ? "Active" : "Disabled"}
        />
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
