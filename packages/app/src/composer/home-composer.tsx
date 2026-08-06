import * as stylex from "@stylexjs/stylex";
import {
  OPEN_CODE_LOCAL_SESSION_TARGET,
  normalizeOpenCodeSessionTarget,
  openCodeLocationRef,
  openCodeWorkspaceSessionTarget,
  type OpenCodeLocationInfo,
  type OpenCodeLocationRef,
  type OpenCodeServerKey,
  type OpenCodeSessionTarget,
} from "@honk/opencode";
import { basename } from "@honk/shared/paths";
import { Combobox, Icon, Kbd, PillButton, type ComboboxGroup } from "@honk/ui";
import {
  IconBranch,
  IconBug,
  IconComputerUse,
  IconFolder1,
  IconFolderOpen,
  IconTodos,
  IconWindowSquare,
  IconWindowSquarePlus,
} from "@honk/ui/icons";
import {
  colorVars,
  composerVars,
  controlVars,
  fontVars,
  radiusVars,
  spaceVars,
  workbenchSurfaceVars,
} from "@honk/ui/tokens.stylex";
import * as React from "react";

import { actions as appSettingsActions, useAppSettings } from "../app-settings-store";
import { canPickFolder, pickFolder } from "../desktop-bridge";
import { honkFusionAgentName } from "@honk/opencode/pairing";
import { actions as modeActions, modeAgentName, MODES, nextModeId, useHomeMode } from "../modes";
import { submissionModel, useModelSelection } from "../presets";
import { promptFilesFromPaths, type AppSessionSummary } from "../open-code-view";
import { actions as tabActions } from "../tab-store";
import { useSessionInventoryWatch } from "../use-sdk-watch";
import { getBoundOpenCodeClient, getOpenCodeClient } from "../watch-registry";
import { ComposerAttachmentButton, ModeControl, ModelSelector } from "./controls";
import { readComposerDraft, writeComposerDraft } from "./draft-store";
import { useFocusOnType, type FocusOnTypeScope } from "./focus-on-type";
import { suggestedModeForPrompt, type ModeSuggestionUsage } from "./mode-suggestion";
import { PromptEditor } from "./prompt-editor";
import { ComposerSubmitButton } from "./submit-button";
import type { PromptEditorHandle, PromptSubmit } from "./types";

const EMPTY_DIRECTORY_PATHS: readonly string[] = Object.freeze([]);
const EMPTY_SESSION_SUMMARIES: readonly AppSessionSummary[] = Object.freeze([]);
const COMPOSER_RING = `inset 0 0 0 1px ${workbenchSurfaceVars["--honk-workbench-input-border"]}`;
const COMPOSER_RING_ACTIVE = `inset 0 0 0 1px ${workbenchSurfaceVars["--honk-workbench-input-border-active"]}`;
const LOCAL_TARGET_VALUE = "target:main-checkout";
const NEW_WORKTREE_TARGET_VALUE = "target:new-worktree";
const WORKTREE_TARGET_VALUE_PREFIX = "target:worktree:";
const HOME_COMPOSER_MIN_HEIGHT = "96px";
// Keeps branch names subordinate to project and worktree controls in the compact footer.
const COMPOSER_FOOTER_BRANCH_MAX_WIDTH = "180px";
const styles = stylex.create({
  root: { display: "flex", flexDirection: "column", width: "100%", minHeight: 0 },
  card: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    minHeight: HOME_COMPOSER_MIN_HEIGHT,
    backgroundColor: workbenchSurfaceVars["--honk-workbench-input-background"],
    borderRadius: radiusVars["--honk-radius-panel"],
    boxShadow: {
      default: COMPOSER_RING,
      ":hover": { "@media (hover: hover)": COMPOSER_RING_ACTIVE },
      ":focus-within": COMPOSER_RING_ACTIVE,
    },
  },
  footer: {
    height: composerVars["--honk-composer-state-band-height"],
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    gap: controlVars["--honk-control-gap"],
    // oxlint-disable-next-line honk/design-no-raw-values -- 16px composer footer inline padding is fixed geometry, no spacing token owns 16px
    paddingInline: "16px",
  },
  footerSpacer: { flexGrow: 1 },
  modeNudgeLabel: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  locationLabel: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  locationBar: {
    flexShrink: 0,
    minHeight: controlVars["--honk-control-h-sm"],
    marginTop: spaceVars["--honk-space-gutter"],
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexWrap: "wrap",
    gap: controlVars["--honk-control-gap"],
    color: colorVars["--honk-color-text-muted"],
    fontFamily: fontVars["--honk-font-family-ui"],
    fontSize: fontVars["--honk-font-size-detail"],
  },
  slash: {
    color: colorVars["--honk-color-text-faint"],
    userSelect: "none",
  },
  targetLabel: {
    maxWidth: controlVars["--honk-control-picker-max-w"],
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  branch: {
    minWidth: 0,
    display: "inline-flex",
    alignItems: "center",
    gap: controlVars["--honk-control-gap"],
    color: colorVars["--honk-color-text-muted"],
  },
  branchLabel: {
    maxWidth: COMPOSER_FOOTER_BRANCH_MAX_WIDTH,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
});

type LoadedLocation = {
  readonly key: string;
  readonly info: OpenCodeLocationInfo | null;
};

type LoadedBranch = {
  readonly key: string;
  readonly branch: string | null;
};

function locationKey(
  server: OpenCodeServerKey | undefined,
  location: OpenCodeLocationRef | undefined,
): string {
  return JSON.stringify([
    server ?? null,
    location?.directory ?? null,
    location?.workspaceID ?? null,
  ]);
}

function sessionTargetLabel(target: OpenCodeSessionTarget): string {
  if (target.type === "local") return "Main checkout";
  if (target.type === "new-workspace") return "New worktree";
  return basename(target.location.directory);
}

function targetIcon(target: OpenCodeSessionTarget) {
  if (target.type === "local") return IconComputerUse;
  if (target.type === "new-workspace") return IconWindowSquarePlus;
  return IconWindowSquare;
}

function worktreeTargetValue(
  server: OpenCodeServerKey | undefined,
  location: OpenCodeLocationRef,
): string {
  return `${WORKTREE_TARGET_VALUE_PREFIX}${locationKey(server, location)}`;
}

function sessionWorktreeLocations(input: {
  readonly sessions: readonly AppSessionSummary[];
  readonly server: OpenCodeServerKey | undefined;
  readonly projectID: string | undefined;
  readonly projectDirectory: string | undefined;
  readonly target: OpenCodeSessionTarget;
}): readonly OpenCodeLocationRef[] {
  if (
    input.server === undefined ||
    input.projectID === undefined ||
    input.projectDirectory === undefined
  ) {
    return [];
  }

  const seen = new Set<string>();
  const locations: OpenCodeLocationRef[] = [];
  const add = (location: OpenCodeLocationRef): void => {
    if (location.directory === input.projectDirectory) return;
    const key = locationKey(input.server, location);
    if (seen.has(key)) return;
    seen.add(key);
    locations.push(openCodeLocationRef(location));
  };

  for (const session of input.sessions) {
    if (session.server !== input.server || session.projectId !== input.projectID) continue;
    add(session.location);
  }
  if (input.target.type === "workspace") add(input.target.location);

  return locations.sort((left, right) =>
    basename(left.directory).localeCompare(basename(right.directory), undefined, {
      numeric: true,
    }),
  );
}

export function HomeComposer({
  location,
  directoryLabel,
  projectID,
  projectDirectory,
  recentDirectories = EMPTY_DIRECTORY_PATHS,
  server,
  target,
  onDirectoryPicked,
  onTargetChange,
  draftPersistenceKey,
  draftKey,
  replaceSessionKey,
  autoFocus = false,
  focusOnTypeScope,
}: {
  readonly location?: OpenCodeLocationRef;
  readonly directoryLabel?: string;
  readonly projectID?: string;
  readonly projectDirectory?: string;
  readonly recentDirectories?: readonly string[];
  readonly server?: OpenCodeServerKey;
  readonly target?: OpenCodeSessionTarget;
  readonly onDirectoryPicked?: (path: string) => void;
  readonly onTargetChange?: (target: OpenCodeSessionTarget) => void;
  // Stable identity for composer surfaces that are not draft or session tabs.
  readonly draftPersistenceKey?: string;
  // Replace this draft tab after OpenCode accepts the first prompt.
  readonly draftKey?: string;
  // Close this empty session tab once the new session opens in its place.
  readonly replaceSessionKey?: string;
  readonly autoFocus?: boolean;
  readonly focusOnTypeScope?: FocusOnTypeScope;
}): React.ReactElement {
  const modelSelection = useModelSelection();
  const appSettings = useAppSettings();
  const mode = useHomeMode();
  const editorRef = React.useRef<PromptEditorHandle | null>(null);
  useFocusOnType(editorRef, focusOnTypeScope);
  const composerDraftKey = draftPersistenceKey ?? draftKey ?? replaceSessionKey;
  const initialDraft =
    composerDraftKey === undefined ? undefined : readComposerDraft(composerDraftKey);
  const [hasText, setHasText] = React.useState(false);
  const [isBrowsing, setBrowsing] = React.useState(false);
  const [modeSuggestionState, setModeSuggestionState] = React.useState<{
    readonly key: string | undefined;
    readonly text: string;
    readonly used: ModeSuggestionUsage;
  }>(() => ({
    key: composerDraftKey,
    text: initialDraft?.text ?? "",
    used: { plan: false, debug: false },
  }));
  const currentModeSuggestionState =
    modeSuggestionState.key === composerDraftKey
      ? modeSuggestionState
      : {
          key: composerDraftKey,
          text: initialDraft?.text ?? "",
          used: { plan: false, debug: false },
        };
  const suggestedMode = suggestedModeForPrompt(
    currentModeSuggestionState.text,
    mode,
    currentModeSuggestionState.used,
  );
  const acceptSuggestedMode = (): void => {
    if (suggestedMode === null) return;
    setModeSuggestionState({
      ...currentModeSuggestionState,
      used: {
        ...currentModeSuggestionState.used,
        [suggestedMode]: true,
      },
    });
    modeActions.setHomeMode(suggestedMode);
    editorRef.current?.focus();
  };
  const sessionInventory = useSessionInventoryWatch();
  const client = server === undefined ? getBoundOpenCodeClient() : getOpenCodeClient(server);
  const activeServer = client?.server.key ?? server;
  const sourceDirectory = location?.directory;
  const sourceWorkspaceID = location?.workspaceID;
  // Submission always runs exactly what the user picked; a disconnected
  // account fails the run at runtime instead of being remapped or blocked.
  const submissionPlan = submissionModel(modelSelection);
  const sourceKey = locationKey(activeServer, location);
  const defaultTarget: OpenCodeSessionTarget =
    appSettings.defaultThreadEnvironment === "worktree"
      ? { type: "new-workspace" }
      : OPEN_CODE_LOCAL_SESSION_TARGET;
  const [internalTarget, setInternalTarget] = React.useState<{
    readonly sourceKey: string;
    readonly target: OpenCodeSessionTarget | null;
  }>(() => ({ sourceKey, target: null }));
  const selectedTarget = normalizeOpenCodeSessionTarget(
    target ??
      (internalTarget.sourceKey === sourceKey
        ? (internalTarget.target ?? defaultTarget)
        : defaultTarget),
  );
  const [loadedLocation, setLoadedLocation] = React.useState<LoadedLocation | null>(null);
  const [loadedBranch, setLoadedBranch] = React.useState<LoadedBranch | null>(null);

  React.useEffect(() => {
    if (
      client === null ||
      sourceDirectory === undefined ||
      (projectID !== undefined && projectDirectory !== undefined)
    ) {
      return;
    }
    const sourceLocation = openCodeLocationRef({
      directory: sourceDirectory,
      ...(sourceWorkspaceID === undefined ? {} : { workspaceID: sourceWorkspaceID }),
    });
    let active = true;
    void client
      .resolveLocation(sourceLocation)
      .then((info) => {
        if (active) setLoadedLocation({ key: sourceKey, info });
      })
      .catch(() => {
        if (active) setLoadedLocation({ key: sourceKey, info: null });
      });
    return () => {
      active = false;
    };
  }, [client, projectDirectory, projectID, sourceDirectory, sourceKey, sourceWorkspaceID]);

  const resolvedLocation = loadedLocation?.key === sourceKey ? loadedLocation.info : null;
  const resolvedProjectID =
    resolvedLocation !== null && resolvedLocation.project.id !== "global"
      ? resolvedLocation.project.id
      : projectID === "global"
        ? undefined
        : projectID;
  const resolvedProjectDirectory =
    resolvedLocation !== null && resolvedLocation.project.id !== "global"
      ? resolvedLocation.project.directory
      : projectDirectory;
  const worktreeEnabled = resolvedProjectID !== undefined && resolvedProjectDirectory !== undefined;
  const effectiveTarget =
    resolvedLocation?.project.id === "global" || !worktreeEnabled
      ? OPEN_CODE_LOCAL_SESSION_TARGET
      : selectedTarget;
  const promptLocation =
    effectiveTarget.type === "workspace"
      ? effectiveTarget.location
      : resolvedProjectDirectory === undefined
        ? location
        : openCodeLocationRef({ directory: resolvedProjectDirectory });
  const promptDirectory = promptLocation?.directory;
  const promptWorkspaceID = promptLocation?.workspaceID;
  const branchKey = locationKey(activeServer, promptLocation);

  React.useEffect(() => {
    if (client === null || promptDirectory === undefined) return;
    const branchLocation = openCodeLocationRef({
      directory: promptDirectory,
      ...(promptWorkspaceID === undefined ? {} : { workspaceID: promptWorkspaceID }),
    });
    let active = true;
    void client.vcs
      .info(branchLocation)
      .then((info) => {
        if (active) setLoadedBranch({ key: branchKey, branch: info.branch ?? null });
      })
      .catch(() => {
        if (active) setLoadedBranch({ key: branchKey, branch: null });
      });
    return () => {
      active = false;
    };
  }, [branchKey, client, promptDirectory, promptWorkspaceID]);

  const branch = loadedBranch?.key === branchKey ? loadedBranch.branch : null;
  const worktrees = sessionWorktreeLocations({
    sessions: sessionInventory.state?.rootSessions ?? EMPTY_SESSION_SUMMARIES,
    server: activeServer,
    projectID: resolvedProjectID,
    projectDirectory: resolvedProjectDirectory,
    target: effectiveTarget,
  });
  const worktreeStatus =
    sessionInventory.state === null && sessionInventory.status === "connecting"
      ? "Loading worktrees…"
      : sessionInventory.state === null &&
          (sessionInventory.status === "closed" ||
            sessionInventory.status === "unauthorized" ||
            sessionInventory.status === "reconnecting")
        ? "Couldn’t load worktrees."
        : undefined;
  const worktreeByValue = new Map(
    worktrees.map((worktree) => [worktreeTargetValue(activeServer, worktree), worktree] as const),
  );
  const selectedTargetValue =
    effectiveTarget.type === "local"
      ? LOCAL_TARGET_VALUE
      : effectiveTarget.type === "new-workspace"
        ? NEW_WORKTREE_TARGET_VALUE
        : worktreeTargetValue(activeServer, effectiveTarget.location);
  const projectLabel =
    directoryLabel ??
    (resolvedProjectDirectory === undefined
      ? location === undefined
        ? "Default"
        : basename(location.directory)
      : basename(resolvedProjectDirectory));
  const projectGroups: readonly ComboboxGroup[] = [
    ...(location === undefined
      ? []
      : [
          {
            label: "Current project",
            pinned: true,
            options: [
              {
                value: location.directory,
                label: projectLabel,
                description: location.directory,
                leading: <Icon icon={IconFolder1} size="sm" tone="muted" />,
              },
            ],
          },
        ]),
    {
      label: "Recent projects",
      options: recentDirectories
        .filter((path) => path !== location?.directory)
        .map((path) => ({
          value: path,
          label: basename(path),
          description: path,
          leading: <Icon icon={IconComputerUse} size="sm" tone="muted" />,
        })),
    },
  ];
  const targetGroups: readonly ComboboxGroup[] = [
    {
      label: "Run in",
      pinned: true,
      options: [
        {
          value: LOCAL_TARGET_VALUE,
          label: "Main checkout",
          keywords: ["local", "repository"],
          leading: <Icon icon={IconFolder1} size="sm" tone="muted" />,
        },
        {
          value: NEW_WORKTREE_TARGET_VALUE,
          label: "New worktree",
          keywords: ["workspace", "copy", "branch"],
          leading: <Icon icon={IconWindowSquarePlus} size="sm" tone="muted" />,
        },
      ],
    },
    {
      label: "Existing worktrees",
      options: worktrees.map((worktree) => ({
        value: worktreeTargetValue(activeServer, worktree),
        label: basename(worktree.directory),
        description: worktree.directory,
        leading: <Icon icon={IconWindowSquare} size="sm" tone="muted" />,
      })),
    },
  ];

  const selectTarget = (next: OpenCodeSessionTarget): void => {
    const normalized = normalizeOpenCodeSessionTarget(next);
    setInternalTarget({ sourceKey, target: normalized });
    onTargetChange?.(normalized);
  };

  const handleSubmit = (payload: PromptSubmit) => {
    // Build carries the selected Fusion stop in its agent name (ADR 0001).
    const submission = tabActions.submitNew(
      {
        prompt: payload.text,
        agent:
          mode === "build" && submissionPlan.fusionStop !== undefined
            ? honkFusionAgentName(submissionPlan.fusionStop)
            : modeAgentName(mode),
        mode,
        model: submissionPlan.model,
        ...(submissionPlan.variant === undefined ? {} : { variant: submissionPlan.variant }),
        ...(activeServer === undefined ? {} : { server: activeServer }),
        ...(location === undefined ? {} : { location }),
        target: effectiveTarget,
        ...(payload.files.length > 0 ? { files: promptFilesFromPaths(payload.files) } : {}),
        ...(payload.command !== null ? { command: payload.command } : {}),
      },
      draftKey !== undefined
        ? { replaceDraftKey: draftKey }
        : replaceSessionKey !== undefined
          ? { replaceSessionKey }
          : undefined,
    );
    // Use this directory as the default for later tabs.
    if (location !== undefined) {
      appSettingsActions.setDefaultProjectDirectory(location.directory);
    }
    // A per-prompt mode change does not replace the configured default for the next thread.
    modeActions.resetHomeMode();
    return submission;
  };

  const chooseTarget = (path: string): void => {
    selectTarget(defaultTarget);
    onDirectoryPicked?.(path);
  };

  const browseForTarget = (): void => {
    setBrowsing(true);
    void pickFolder(location?.directory ?? null)
      .then((path) => {
        if (path !== null) {
          chooseTarget(path);
        }
      })
      .finally(() => {
        setBrowsing(false);
      });
  };

  return (
    <div {...stylex.props(styles.root)}>
      <div
        {...stylex.props(styles.card)}
        onKeyDown={(event) => {
          if (
            event.target instanceof Element &&
            event.target.closest('[data-slot^="picker-"], [data-slot="popover"]') !== null
          ) {
            return;
          }
          if (event.key === "Tab" && event.shiftKey && !event.defaultPrevented) {
            event.preventDefault();
            if (suggestedMode !== null) {
              acceptSuggestedMode();
              return;
            }
            modeActions.setHomeMode(nextModeId(mode));
          }
        }}
      >
        <PromptEditor
          // Lexical's initial document is editor-scoped. A different draft key is a different editor,
          // so switching new-session tabs restores that draft instead of retaining the prior tab's text.
          key={composerDraftKey}
          placeholder="Describe a task…"
          ariaLabel="New thread prompt"
          autoFocus={autoFocus}
          client={client}
          modes={MODES}
          currentMode={mode}
          onModeSelect={(id) => modeActions.setHomeMode(id)}
          menuPlacement="below"
          {...(promptDirectory !== undefined ? { directory: promptDirectory } : {})}
          onSubmit={handleSubmit}
          onHasTextChange={setHasText}
          onDraftChange={(draft) => {
            if (draft.text !== currentModeSuggestionState.text) {
              setModeSuggestionState({
                key: composerDraftKey,
                text: draft.text,
                used: { plan: false, debug: false },
              });
            }
            if (composerDraftKey !== undefined) writeComposerDraft(composerDraftKey, draft);
          }}
          {...(initialDraft === undefined ? {} : { initialDraft })}
          handleRef={editorRef}
        />
        <div {...stylex.props(styles.footer)}>
          <ComposerAttachmentButton editorRef={editorRef} />
          <ModeControl
            value={mode}
            onValueChange={(id) => {
              modeActions.setHomeMode(id);
            }}
          />
          <ModelSelector />
          <div {...stylex.props(styles.footerSpacer)} />
          {suggestedMode === null ? null : (
            <PillButton
              density="notification"
              aria-label={`Try ${suggestedMode === "plan" ? "Plan" : "Debug"} Mode. Shift plus Tab`}
              iconStart={
                <Icon
                  icon={suggestedMode === "plan" ? IconTodos : IconBug}
                  size="sm"
                  tone={suggestedMode === "plan" ? "warn" : "err"}
                />
              }
              onClick={acceptSuggestedMode}
            >
              <span {...stylex.props(styles.modeNudgeLabel)}>
                Try {suggestedMode === "plan" ? "Plan" : "Debug"} Mode
              </span>
              <Kbd size="sm">Shift+Tab</Kbd>
            </PillButton>
          )}
          <ComposerSubmitButton
            disabled={!hasText}
            onClick={() => {
              editorRef.current?.submit();
            }}
          />
        </div>
      </div>
      {onDirectoryPicked === undefined ? null : (
        <div {...stylex.props(styles.locationBar)}>
          <Combobox
            value={location?.directory ?? null}
            disabled={isBrowsing}
            onValueChange={chooseTarget}
            groups={projectGroups}
            accessibilityLabel="Project"
            searchPlaceholder="Search projects…"
            emptyLabel="No recent projects."
            noMatchesLabel="No matching projects."
            width="wide"
            size="sm"
            tone="quiet"
            title={location?.directory ?? "Choose the project for this session"}
            actions={
              canPickFolder()
                ? [
                    {
                      label: isBrowsing ? "Opening…" : "Open Folder…",
                      leading: <Icon icon={IconFolderOpen} size="sm" tone="muted" />,
                      disabled: isBrowsing,
                      onSelect: browseForTarget,
                    },
                  ]
                : []
            }
          >
            <Icon icon={IconFolder1} size="sm" />
            <span {...stylex.props(styles.locationLabel)}>{projectLabel}</span>
          </Combobox>

          {worktreeEnabled ? (
            <>
              <span {...stylex.props(styles.slash)}>/</span>
              <Combobox
                value={selectedTargetValue}
                onValueChange={(nextValue) => {
                  if (nextValue === LOCAL_TARGET_VALUE) {
                    selectTarget(OPEN_CODE_LOCAL_SESSION_TARGET);
                    return;
                  }
                  if (nextValue === NEW_WORKTREE_TARGET_VALUE) {
                    selectTarget({ type: "new-workspace" });
                    return;
                  }
                  const worktree = worktreeByValue.get(nextValue);
                  if (worktree !== undefined) {
                    selectTarget(openCodeWorkspaceSessionTarget(worktree));
                  }
                }}
                groups={targetGroups}
                accessibilityLabel="Run session in"
                searchPlaceholder="Search worktrees…"
                emptyLabel="No existing worktrees."
                noMatchesLabel="No matching worktrees."
                {...(worktreeStatus === undefined ? {} : { status: worktreeStatus })}
                width="wide"
                size="sm"
                tone="quiet"
                title={
                  effectiveTarget.type === "workspace"
                    ? effectiveTarget.location.directory
                    : sessionTargetLabel(effectiveTarget)
                }
                onOpenChangeComplete={(open) => {
                  if (!open) editorRef.current?.focus();
                }}
              >
                <Icon icon={targetIcon(effectiveTarget)} size="sm" />
                <span {...stylex.props(styles.targetLabel)}>
                  {sessionTargetLabel(effectiveTarget)}
                </span>
              </Combobox>
            </>
          ) : null}

          {branch === null ? null : (
            <>
              <span {...stylex.props(styles.slash)}>/</span>
              <span {...stylex.props(styles.branch)} title={branch}>
                <Icon icon={IconBranch} size="sm" tone="muted" />
                <span {...stylex.props(styles.branchLabel)}>{branch}</span>
              </span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
