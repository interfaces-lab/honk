import * as stylex from "@stylexjs/stylex";
import { Button, Dialog, Field, Icon, IconButton, Kbd, Spinner, Text } from "@honk/ui";
import { IconCrossMedium } from "@honk/ui/icons";
import {
  borderVars,
  colorVars,
  controlVars,
  fontVars,
  iconVars,
  motionVars,
  radiusVars,
  spaceVars,
} from "@honk/ui/tokens.stylex";
import * as React from "react";

import {
  MENU_DIALOG_STYLE,
  MENU_DIALOG_TITLE_STYLE,
  MENU_FIELD_STYLE,
} from "./command-menu-layout";
import { actions as commandMenuActions, useCommandMenuSelector } from "./command-menu-store";
import { connectDeviceRequest, useConnectDeviceRequest } from "./connect-device-request-store";
import { canManageDesktopRemoteHost } from "./desktop-bridge";
import { SETTINGS_DIALOG_STYLE, SETTINGS_DIALOG_TITLE_STYLE } from "./settings-layout";
import {
  actions as settingsActions,
  useSettingsSelector,
  type SettingsSectionId,
} from "./settings-store";
import { actions as tabActions } from "./tab-store";

const DeferredCommandMenuOverlay = React.lazy(() =>
  import("./command-menu").then((module) => ({ default: module.CommandMenuOverlay })),
);
const DeferredConnectDeviceDialog = React.lazy(() =>
  import("./connect-device").then((module) => ({ default: module.ConnectDeviceDialog })),
);
const DeferredSettingsOverlay = React.lazy(() =>
  import("./settings").then((module) => ({ default: module.SettingsOverlay })),
);

const COMMAND_SKELETON_ROWS = ["first", "second", "third", "fourth", "fifth"] as const;
const MENU_DROP_MAX_HEIGHT = "min(420px, 50dvh)";
// Matches Connect Device's permanent square stage. No shared size token owns dialog content geometry.
const CONNECTION_STAGE_SIZE = "288px";
const SETTINGS_WIDE_MEDIA = "@media (min-width: 720px)";
const SETTINGS_NAV_COMPACT_MAX_HEIGHT = "152px";
// Loading rows keep the same compact rail footprint without importing settings navigation icons.
const SETTINGS_NAV_LOADING_ROW_MIN_WIDTH = "152px";
const SETTINGS_CLOSE_CLEARANCE = `calc(${spaceVars["--honk-space-panel-pad"]} + ${controlVars["--honk-control-h-md"]} + ${spaceVars["--honk-space-gutter"]})`;
const SETTINGS_SECTION_GAP = "28px";
const SETTINGS_CONTENT_MAX_WIDTH = "680px";
const SETTINGS_SKELETON_ROWS = ["first", "second", "third", "fourth", "fifth"] as const;
const SETTINGS_LABELS: Readonly<Record<SettingsSectionId, string>> = {
  general: "General",
  appearance: "Appearance",
  servers: "Servers",
  connections: "Device access",
  providers: "Accounts",
  plugins: "Plugins",
  rules: "Rules, Skills, Subagents",
  tools: "MCP servers",
  hooks: "Hooks",
};

const stateEnter = stylex.keyframes({
  from: {
    opacity: 0,
    transform: `translateY(${spaceVars["--honk-space-gutter"]})`,
  },
  to: {
    opacity: 1,
    transform: "translateY(0)",
  },
});

const styles = stylex.create({
  commandPanel: {
    display: "flex",
    flexDirection: "column",
    gap: 0,
    width: "100%",
    minWidth: 0,
    overflow: "hidden",
  },
  commandScope: {
    display: "flex",
    alignItems: "center",
    flexShrink: 0,
    gap: controlVars["--honk-control-gap"],
    paddingBlock: controlVars["--honk-control-gap"],
    paddingInline: spaceVars["--honk-space-control-pad-x"],
    borderRadius: radiusVars["--honk-radius-control"],
    backgroundColor: colorVars["--honk-color-layer-02"],
    color: colorVars["--honk-color-text-muted"],
    fontSize: fontVars["--honk-font-size-caption"],
    fontWeight: fontVars["--honk-font-weight-regular"],
    whiteSpace: "nowrap",
  },
  commandHints: {
    display: "flex",
    alignItems: "center",
    gap: controlVars["--honk-control-gap"],
    flexShrink: 0,
    color: colorVars["--honk-color-text-faint"],
  },
  commandDrop: {
    display: "flex",
    flexDirection: "column",
    // Matches the command menu's one-pixel inter-row seam.
    // oxlint-disable-next-line honk/design-no-raw-values -- command result rows use a fixed one-pixel seam; no spacing token owns it
    gap: "1px",
    width: "100%",
    boxSizing: "border-box",
    padding: spaceVars["--honk-space-gutter"],
    backgroundColor: "transparent",
    maxHeight: MENU_DROP_MAX_HEIGHT,
    overflowY: "auto",
    overscrollBehavior: "contain",
  },
  commandRow: {
    minHeight: controlVars["--honk-control-h-md"],
    display: "flex",
    alignItems: "center",
    gap: controlVars["--honk-control-gap"],
    paddingInline: controlVars["--honk-control-pad-md"],
    paddingBlock: controlVars["--honk-control-gap"],
    borderRadius: radiusVars["--honk-radius-control"],
  },
  commandGlyph: {
    width: iconVars["--honk-icon-size-md"],
    height: iconVars["--honk-icon-size-md"],
    flexShrink: 0,
    borderRadius: radiusVars["--honk-radius-control"],
    backgroundColor: colorVars["--honk-color-layer-02"],
  },
  commandLine: {
    width: "55%",
    height: fontVars["--honk-leading-title"],
    borderRadius: radiusVars["--honk-radius-control"],
    backgroundColor: colorVars["--honk-color-layer-02"],
  },
  commandMeta: {
    width: "15%",
    height: fontVars["--honk-leading-detail"],
    marginInlineStart: "auto",
    borderRadius: radiusVars["--honk-radius-control"],
    backgroundColor: colorVars["--honk-color-layer-02"],
  },
  connectClose: {
    position: "absolute",
    top: spaceVars["--honk-space-gutter"],
    right: spaceVars["--honk-space-gutter"],
  },
  connectBody: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    minWidth: 0,
  },
  connectState: {
    width: "100%",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: spaceVars["--honk-space-panel-pad"],
    textAlign: "center",
    animationName: stateEnter,
    animationDuration: {
      default: motionVars["--honk-motion-duration-fast"],
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    animationTimingFunction: motionVars["--honk-motion-ease-out"],
  },
  connectStage: {
    width: CONNECTION_STAGE_SIZE,
    maxWidth: "100%",
    aspectRatio: "1",
    boxSizing: "border-box",
    display: "grid",
    placeItems: "center",
    borderRadius: radiusVars["--honk-radius-window"],
    overflow: "hidden",
    backgroundColor: colorVars["--honk-color-layer-01"],
  },
  connectStageVisual: {
    boxSizing: "border-box",
    width: `calc(${controlVars["--honk-control-h-lg"]} * 2)`,
    aspectRatio: "1",
    display: "grid",
    placeItems: "center",
    borderWidth: borderVars["--honk-border-hairline"],
    borderStyle: "solid",
    borderColor: colorVars["--honk-color-border-base"],
    borderRadius: radiusVars["--honk-radius-window"],
    backgroundColor: colorVars["--honk-color-bg-base"],
  },
  connectCopy: {
    width: "100%",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: controlVars["--honk-control-gap"],
  },
  liveStatus: {
    position: "absolute",
    width: borderVars["--honk-border-hairline"],
    height: borderVars["--honk-border-hairline"],
    padding: 0,
    overflow: "hidden",
    clipPath: "inset(50%)",
    whiteSpace: "nowrap",
    borderWidth: 0,
  },
  settingsRoot: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: "0%",
    minHeight: 0,
    display: "flex",
    flexDirection: {
      default: "column",
      [SETTINGS_WIDE_MEDIA]: "row",
    },
    overflow: "hidden",
  },
  settingsNav: {
    width: {
      default: "100%",
      [SETTINGS_WIDE_MEDIA]: "200px",
    },
    flexShrink: 0,
    display: "flex",
    flexDirection: "column",
    gap: spaceVars["--honk-space-gutter"],
    padding: spaceVars["--honk-space-panel-pad"],
    minHeight: 0,
    maxHeight: {
      default: SETTINGS_NAV_COMPACT_MAX_HEIGHT,
      [SETTINGS_WIDE_MEDIA]: "none",
    },
    backgroundColor: colorVars["--honk-color-layer-01"],
  },
  settingsNavList: {
    display: "flex",
    flexDirection: {
      default: "row",
      [SETTINGS_WIDE_MEDIA]: "column",
    },
    // oxlint-disable-next-line honk/design-no-raw-values -- settings navigation uses the permanent one-pixel inter-row seam from settings.tsx
    gap: "1px",
    minHeight: 0,
    overflow: "hidden",
  },
  settingsNavRow: {
    minWidth: SETTINGS_NAV_LOADING_ROW_MIN_WIDTH,
    minHeight: controlVars["--honk-control-h-md"],
    display: "flex",
    alignItems: "center",
    gap: controlVars["--honk-control-gap"],
    paddingInline: controlVars["--honk-control-pad-md"],
    borderRadius: radiusVars["--honk-radius-control"],
    backgroundColor: colorVars["--honk-color-layer-02"],
  },
  settingsClose: {
    position: "absolute",
    top: spaceVars["--honk-space-panel-pad"],
    right: spaceVars["--honk-space-panel-pad"],
    zIndex: 1,
  },
  settingsPanel: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: "0%",
    minWidth: 0,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    borderTopWidth: {
      default: borderVars["--honk-border-hairline"],
      [SETTINGS_WIDE_MEDIA]: 0,
    },
    borderTopStyle: "solid",
    borderTopColor: colorVars["--honk-color-border-muted"],
    borderLeftWidth: {
      default: 0,
      [SETTINGS_WIDE_MEDIA]: borderVars["--honk-border-hairline"],
    },
    borderLeftStyle: "solid",
    borderLeftColor: colorVars["--honk-color-border-muted"],
  },
  settingsHeader: {
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    paddingBlock: spaceVars["--honk-space-panel-pad"],
    paddingInlineStart: spaceVars["--honk-space-panel-pad"],
    paddingInlineEnd: {
      default: spaceVars["--honk-space-panel-pad"],
      [SETTINGS_WIDE_MEDIA]: SETTINGS_CLOSE_CLEARANCE,
    },
  },
  settingsScroll: {
    flexGrow: 1,
    minHeight: 0,
    overflow: "hidden",
    paddingBlockEnd: spaceVars["--honk-space-panel-pad"],
    paddingInlineStart: spaceVars["--honk-space-panel-pad"],
    paddingInlineEnd: {
      default: spaceVars["--honk-space-panel-pad"],
      [SETTINGS_WIDE_MEDIA]: SETTINGS_CLOSE_CLEARANCE,
    },
  },
  settingsColumn: {
    width: "100%",
    maxWidth: SETTINGS_CONTENT_MAX_WIDTH,
    display: "flex",
    flexDirection: "column",
    // oxlint-disable-next-line honk/design-no-raw-values -- fallback preserves the permanent 28px settings section rhythm
    gap: SETTINGS_SECTION_GAP,
  },
  settingsBlockLine: {
    width: "100%",
    height: controlVars["--honk-control-h-md"],
    borderRadius: radiusVars["--honk-radius-control"],
    backgroundColor: colorVars["--honk-color-layer-01"],
  },
});

function CommandMenuOverlayHost(): React.ReactElement | null {
  const open = useCommandMenuSelector((snapshot) => snapshot.open);
  if (!open) return null;
  return (
    <React.Suspense fallback={<CommandMenuLoadingOverlay />}>
      <DeferredCommandMenuOverlay />
    </React.Suspense>
  );
}

function CommandMenuLoadingOverlay(): React.ReactElement {
  const door = useCommandMenuSelector((snapshot) => snapshot.door);
  const query = useCommandMenuSelector((snapshot) => snapshot.query);
  const label = door === "threads" ? "Open thread" : "Command menu";
  const start = (): void => {
    const prompt = query.trim();
    if (prompt.length === 0) tabActions.openNew();
    else tabActions.openNew({ prompt });
    commandMenuActions.close();
    commandMenuActions.setQuery("");
  };

  return (
    <Dialog.Root
      open
      onOpenChange={(next) => {
        if (!next) commandMenuActions.close();
      }}
    >
      <Dialog.Popup style={MENU_DIALOG_STYLE}>
        <Dialog.Title style={MENU_DIALOG_TITLE_STYLE}>{label}</Dialog.Title>
        <div {...stylex.props(styles.commandPanel)}>
          <Field size="lg" style={MENU_FIELD_STYLE}>
            <span {...stylex.props(styles.commandScope)}>
              {door === "threads" ? "Threads" : "Anywhere"}
            </span>
            <Field.Input
              value={query}
              placeholder={door === "threads" ? "Search threads…" : "Search commands and threads…"}
              aria-label={door === "threads" ? "Search threads" : "Command menu"}
              onChange={(event) => {
                commandMenuActions.setQuery(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  start();
                }
              }}
            />
            <span {...stylex.props(styles.commandHints)}>
              <Kbd size="sm">Tab</Kbd>
              <Text as="span" size="xs" tone="faint">
                where
              </Text>
            </span>
            <Button size="sm" variant="neutral" onClick={start}>
              ⏎ Start
            </Button>
          </Field>
          <div
            role="status"
            aria-label={`Loading ${label.toLocaleLowerCase()}`}
            {...stylex.props(styles.commandDrop)}
          >
            {COMMAND_SKELETON_ROWS.map((row) => (
              <div key={row} aria-hidden="true" {...stylex.props(styles.commandRow)}>
                <div {...stylex.props(styles.commandGlyph)} />
                <div {...stylex.props(styles.commandLine)} />
                <div {...stylex.props(styles.commandMeta)} />
              </div>
            ))}
          </div>
        </div>
      </Dialog.Popup>
    </Dialog.Root>
  );
}

function ConnectDeviceDialogHost(): React.ReactElement | null {
  const available = canManageDesktopRemoteHost();
  const isRequested = useConnectDeviceRequest();

  if (!available || !isRequested) return null;
  return (
    <React.Suspense fallback={<ConnectDeviceLoadingDialog />}>
      <DeferredConnectDeviceDialog />
    </React.Suspense>
  );
}

function ConnectDeviceLoadingDialog(): React.ReactElement {
  return (
    <Dialog.Root
      open
      onOpenChange={(next) => {
        if (!next) connectDeviceRequest.actions.close();
      }}
    >
      <Dialog.Popup>
        <div {...stylex.props(styles.connectClose)}>
          <IconButton
            size="sm"
            variant="quiet"
            aria-label="Close device connection"
            onClick={connectDeviceRequest.actions.close}
          >
            <Icon icon={IconCrossMedium} size="sm" />
          </IconButton>
        </div>
        <Dialog.Header>
          <Dialog.Title>Connect a device</Dialog.Title>
          <Dialog.Description>
            Use this computer from your phone, tablet, or another computer.
          </Dialog.Description>
        </Dialog.Header>
        <div
          role="status"
          aria-live="polite"
          aria-atomic="true"
          {...stylex.props(styles.liveStatus)}
        >
          Checking device connections.
        </div>
        <div {...stylex.props(styles.connectBody)}>
          <div {...stylex.props(styles.connectState)}>
            <div {...stylex.props(styles.connectStage)}>
              <div {...stylex.props(styles.connectStageVisual)}>
                <Spinner size="lg" />
              </div>
            </div>
            <div {...stylex.props(styles.connectCopy)}>
              <Text as="p" size="lg" weight="semibold">
                Checking this computer
              </Text>
              <Text as="p" size="sm" tone="muted">
                This should only take a moment.
              </Text>
            </div>
          </div>
        </div>
      </Dialog.Popup>
    </Dialog.Root>
  );
}

function SettingsOverlayHost(): React.ReactElement | null {
  const open = useSettingsSelector((snapshot) => snapshot.open);
  if (!open) return null;
  return (
    <React.Suspense fallback={<SettingsLoadingOverlay />}>
      <DeferredSettingsOverlay />
    </React.Suspense>
  );
}

function SettingsLoadingOverlay(): React.ReactElement {
  const section = useSettingsSelector((snapshot) => snapshot.section);
  const closeButtonRef = React.useRef<HTMLButtonElement>(null);

  return (
    <Dialog.Root
      open
      onOpenChange={(nextOpen) => {
        if (!nextOpen) settingsActions.close();
      }}
    >
      <Dialog.Popup style={SETTINGS_DIALOG_STYLE} initialFocus={closeButtonRef}>
        <Dialog.Title style={SETTINGS_DIALOG_TITLE_STYLE}>Settings</Dialog.Title>
        <div {...stylex.props(styles.settingsClose)}>
          <Dialog.Close
            render={
              <IconButton
                ref={closeButtonRef}
                size="md"
                variant="quiet"
                aria-label="Close settings"
              >
                <Icon icon={IconCrossMedium} size="md" />
              </IconButton>
            }
          />
        </div>
        <div {...stylex.props(styles.settingsRoot)}>
          <nav aria-label="Loading settings sections" {...stylex.props(styles.settingsNav)}>
            <div {...stylex.props(styles.settingsNavList)}>
              {SETTINGS_SKELETON_ROWS.map((row) => (
                <div key={row} aria-hidden="true" {...stylex.props(styles.settingsNavRow)} />
              ))}
            </div>
          </nav>
          <section
            aria-label={`Loading ${SETTINGS_LABELS[section]}`}
            {...stylex.props(styles.settingsPanel)}
          >
            <header {...stylex.props(styles.settingsHeader)}>
              <Text as="p" size="xl" weight="semibold">
                {SETTINGS_LABELS[section]}
              </Text>
            </header>
            <div role="status" {...stylex.props(styles.settingsScroll)}>
              <span {...stylex.props(styles.liveStatus)}>Loading settings.</span>
              <div aria-hidden="true" {...stylex.props(styles.settingsColumn)}>
                {["primary", "secondary", "tertiary"].map((block) => (
                  <span key={block} {...stylex.props(styles.settingsBlockLine)} />
                ))}
              </div>
            </div>
          </section>
        </div>
      </Dialog.Popup>
    </Dialog.Root>
  );
}

export { CommandMenuOverlayHost, ConnectDeviceDialogHost, SettingsOverlayHost };
