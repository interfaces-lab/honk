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
import { Combobox, Icon, type ComboboxGroup } from "@honk/ui";
import {
  IconBranch,
  IconComputerUse,
  IconFolder1,
  IconFolderOpen,
  IconWindowSquare,
  IconWindowSquarePlus,
} from "@honk/ui/icons";
import {
  colorVars,
  controlVars,
  fontVars,
  radiusVars,
  spaceVars,
  workbenchSurfaceVars,
} from "@honk/ui/tokens.stylex";
import * as React from "react";

import { actions as appSettingsActions } from "../app-settings-store";
import { canPickFolder, pickFolder } from "../desktop-bridge";
import {
  actions as modeActions,
  DEFAULT_MODE,
  modeAgentName,
  nextModeId,
  useHomeMode,
} from "../modes";
import {
  actions as presetActions,
  openCodeGoPreset,
  PRESETS,
  presetById,
  type PresetDefinition,
  useSelectedPreset,
} from "../presets";
import { promptFilesFromPaths, type AppSessionSummary } from "../open-code-view";
import { actions as tabActions } from "../tab-store";
import { useOpenCodeCatalogRevision, useSessionInventoryWatch } from "../use-sdk-watch";
import { getBoundOpenCodeClient, getOpenCodeClient } from "../watch-registry";
import { ComposerAttachmentButton, ModeControl, PresetSelector } from "./controls";
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
const styles = stylex.create({
  root: { display: "flex", flexDirection: "column", width: "100%", minHeight: 0 },
  card: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    minHeight: "96px",
    backgroundColor: workbenchSurfaceVars["--honk-workbench-input-background"],
    borderRadius: radiusVars["--honk-radius-panel"],
    boxShadow: {
      default: COMPOSER_RING,
      ":hover": { "@media (hover: hover)": COMPOSER_RING_ACTIVE },
      ":focus-within": COMPOSER_RING_ACTIVE,
    },
  },
  footer: {
    height: "44px",
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    gap: controlVars["--honk-control-gap"],
    // oxlint-disable-next-line honk/design-no-raw-values -- 16px composer footer inline padding is fixed geometry, no spacing token owns 16px
    paddingInline: "16px",
  },
  footerSpacer: { flexGrow: 1 },
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
    // A branch name stays subordinate to the project and worktree controls in the compact footer.
    maxWidth: "180px",
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
  resolveLocationOnMount = true,
  recentDirectories = EMPTY_DIRECTORY_PATHS,
  server,
  target,
  onDirectoryPicked,
  onTargetChange,
  draftKey,
  autoFocus = false,
}: {
  readonly location?: OpenCodeLocationRef;
  readonly directoryLabel?: string;
  readonly projectID?: string;
  readonly projectDirectory?: string;
  /** Resolve newly picked locations eagerly so their worktree controls become available. */
  readonly resolveLocationOnMount?: boolean;
  readonly recentDirectories?: readonly string[];
  readonly server?: OpenCodeServerKey;
  readonly target?: OpenCodeSessionTarget;
  readonly onDirectoryPicked?: (path: string) => void;
  readonly onTargetChange?: (target: OpenCodeSessionTarget) => void;
  // Replace this draft tab after OpenCode accepts the first prompt.
  readonly draftKey?: string;
  readonly autoFocus?: boolean;
}): React.ReactElement {
  const presetId = useSelectedPreset();
  const catalogRevision = useOpenCodeCatalogRevision();
  const mode = useHomeMode();
  const editorRef = React.useRef<PromptEditorHandle | null>(null);
  const [hasText, setHasText] = React.useState(false);
  const [isBrowsing, setBrowsing] = React.useState(false);
  const sessionInventory = useSessionInventoryWatch();
  const client = server === undefined ? getBoundOpenCodeClient() : getOpenCodeClient(server);
  const activeServer = client?.server.key ?? server;
  const sourceDirectory = location?.directory;
  const sourceWorkspaceID = location?.workspaceID;
  const modelCatalogKey = JSON.stringify([
    client?.server.key ?? null,
    sourceDirectory ?? null,
    sourceWorkspaceID ?? null,
  ]);
  const [openCodeGoCatalog, setOpenCodeGoCatalog] = React.useState<{
    readonly key: string;
    readonly preset: PresetDefinition | null;
  } | null>(null);
  const availableOpenCodeGoPreset =
    openCodeGoCatalog?.key === modelCatalogKey ? openCodeGoCatalog.preset : null;
  const presets =
    availableOpenCodeGoPreset === null
      ? PRESETS
      : Object.freeze([...PRESETS, availableOpenCodeGoPreset]);
  const preset = presetById(presetId, presets);
  const sourceKey = locationKey(activeServer, location);
  const [internalTarget, setInternalTarget] = React.useState<{
    readonly sourceKey: string;
    readonly target: OpenCodeSessionTarget;
  }>(() => ({ sourceKey, target: OPEN_CODE_LOCAL_SESSION_TARGET }));
  const selectedTarget = normalizeOpenCodeSessionTarget(
    target ??
      (internalTarget.sourceKey === sourceKey
        ? internalTarget.target
        : OPEN_CODE_LOCAL_SESSION_TARGET),
  );
  const [loadedLocation, setLoadedLocation] = React.useState<LoadedLocation | null>(null);
  const [loadedBranch, setLoadedBranch] = React.useState<LoadedBranch | null>(null);

  React.useEffect(() => {
    if (client === null) return;
    let active = true;
    void client.models
      .list(
        sourceDirectory === undefined
          ? undefined
          : {
              directory: sourceDirectory,
              ...(sourceWorkspaceID === undefined ? {} : { workspaceID: sourceWorkspaceID }),
            },
      )
      .then((result) => {
        if (!active) return;
        setOpenCodeGoCatalog({ key: modelCatalogKey, preset: openCodeGoPreset(result.data) });
      })
      .catch(() => {
        if (active) setOpenCodeGoCatalog({ key: modelCatalogKey, preset: null });
      });
    return () => {
      active = false;
    };
  }, [catalogRevision, client, modelCatalogKey, sourceDirectory, sourceWorkspaceID]);

  React.useEffect(() => {
    if (
      client === null ||
      sourceDirectory === undefined ||
      !resolveLocationOnMount ||
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
  }, [
    client,
    projectDirectory,
    projectID,
    resolveLocationOnMount,
    sourceDirectory,
    sourceKey,
    sourceWorkspaceID,
  ]);

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
  const worktreeEnabled =
    resolvedProjectID !== undefined && resolvedProjectDirectory !== undefined;
  const effectiveTarget =
    resolvedLocation?.project.id === "global" ? OPEN_CODE_LOCAL_SESSION_TARGET : selectedTarget;
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

  const handleSubmit = (payload: PromptSubmit): void => {
    // Each prompt uses the selected mode and preset. Open threads store their own mode.
    tabActions.openNew(
      {
        prompt: payload.text,
        agent: modeAgentName(mode),
        mode,
        model: preset.mainModel,
        ...(preset.mainVariant === undefined ? {} : { variant: preset.mainVariant }),
        ...(activeServer === undefined ? {} : { server: activeServer }),
        ...(location === undefined ? {} : { location }),
        target: effectiveTarget,
        ...(payload.files.length > 0 ? { files: promptFilesFromPaths(payload.files) } : {}),
        ...(payload.command !== null ? { command: payload.command } : {}),
      },
      draftKey === undefined ? undefined : { replaceDraftKey: draftKey },
    );
    // Use this directory as the default for later tabs.
    if (location !== undefined) {
      appSettingsActions.setDefaultProjectDirectory(location.directory);
    }
    // Apply a non-build mode to this thread only. New threads start in build mode again.
    if (mode !== DEFAULT_MODE) {
      modeActions.setHomeMode(DEFAULT_MODE);
    }
  };

  const chooseTarget = (path: string): void => {
    selectTarget(OPEN_CODE_LOCAL_SESSION_TARGET);
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
            event.target.closest('[data-slot^="picker-"]') !== null
          ) {
            return;
          }
          if (event.key === "Tab" && event.shiftKey && !event.defaultPrevented) {
            event.preventDefault();
            modeActions.setHomeMode(nextModeId(mode));
          }
        }}
      >
        <PromptEditor
          placeholder="Describe a task…"
          ariaLabel="New thread prompt"
          autoFocus={autoFocus}
          menuPlacement="below"
          {...(promptDirectory !== undefined ? { directory: promptDirectory } : {})}
          onSubmit={handleSubmit}
          onHasTextChange={setHasText}
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
          <PresetSelector
            value={preset.id}
            presets={presets}
            onValueChange={(id) => {
              presetActions.select(id);
            }}
          />
          <div {...stylex.props(styles.footerSpacer)} />
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
