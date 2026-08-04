import * as stylex from "@stylexjs/stylex";
import { Dialog, Icon, IconButton, ListRow, Separator, Text } from "@honk/ui";
import {
  IconBrush,
  IconCrossMedium,
  IconModelcontextprotocol,
  IconPeopleIdCard2,
  IconPuzzle,
  IconServer,
  IconSettingsGear2,
  IconShieldCode,
  IconUserKey,
  IconWebhooks,
} from "@honk/ui/icons";
import { borderVars, colorVars, controlVars, spaceVars } from "@honk/ui/tokens.stylex";
import * as React from "react";

import { canManageDesktopRemoteHost } from "./desktop-bridge";
import { SettingsPanelSkeleton } from "./settings-controls";
import {
  actions as settingsActions,
  useSettingsSelector,
  type SettingsSectionId,
} from "./settings-store";

// Groups are separated by a hairline rule, never by a text label — Cursor's rail has no group
// headings, and the icons plus adjacency already carry the grouping.
const SETTINGS_GROUPS = [
  {
    id: "preferences",
    sections: [
      { id: "general", label: "General", icon: IconSettingsGear2 },
      { id: "appearance", label: "Appearance", icon: IconBrush },
    ],
  },
  {
    id: "connections",
    sections: [
      { id: "servers", label: "Servers", icon: IconServer },
      { id: "connections", label: "Device access", icon: IconUserKey },
      { id: "providers", label: "Accounts", icon: IconPeopleIdCard2 },
    ],
  },
  {
    id: "customization",
    sections: [
      { id: "plugins", label: "Plugins", icon: IconPuzzle },
      { id: "rules", label: "Rules, Skills, Subagents", icon: IconShieldCode },
      { id: "tools", label: "MCP servers", icon: IconModelcontextprotocol },
      { id: "hooks", label: "Hooks", icon: IconWebhooks },
    ],
  },
] as const satisfies readonly {
  readonly id: string;
  readonly sections: readonly {
    readonly id: SettingsSectionId;
    readonly label: string;
    readonly icon: typeof IconSettingsGear2;
  }[];
}[];

function sectionLabelFor(id: SettingsSectionId): string {
  const sections = SETTINGS_GROUPS.flatMap<{
    readonly id: SettingsSectionId;
    readonly label: string;
    readonly icon: typeof IconSettingsGear2;
  }>((group) => group.sections);
  return sections.find((item) => item.id === id)?.label ?? "Settings";
}

const PANELS = {
  general: React.lazy(() =>
    import("./settings-general").then((module) => ({ default: module.SettingsGeneral })),
  ),
  servers: React.lazy(() =>
    import("./settings-servers").then((module) => ({ default: module.SettingsServers })),
  ),
  connections: React.lazy(() =>
    import("./settings-connections").then((module) => ({ default: module.SettingsConnections })),
  ),
  providers: React.lazy(() =>
    import("./settings-providers").then((module) => ({ default: module.SettingsProviders })),
  ),
  plugins: React.lazy(() =>
    import("./settings-plugins").then((module) => ({ default: module.SettingsPlugins })),
  ),
  rules: React.lazy(() =>
    import("./settings-rules").then((module) => ({ default: module.SettingsRules })),
  ),
  tools: React.lazy(() =>
    import("./settings-mcp").then((module) => ({ default: module.SettingsMcp })),
  ),
  hooks: React.lazy(() =>
    import("./settings-hooks").then((module) => ({ default: module.SettingsHooks })),
  ),
  appearance: React.lazy(() =>
    import("./settings-appearance").then((module) => ({ default: module.SettingsAppearance })),
  ),
} satisfies Record<SettingsSectionId, React.LazyExoticComponent<React.ComponentType>>;

const SETTINGS_WIDE_MEDIA = "@media (min-width: 720px)";
const SETTINGS_NAV_COMPACT_MAX_HEIGHT = "152px";
// Dialog.Popup takes overrides as an inline style object, so these stay React.CSSProperties.
// Every value is named here rather than written inline so the sheet geometry stays tracked.
//
// `.cursor-settings-layout-main{padding:0 0 0 48px}` plus the 48px right gutter: Cursor's settings
// shell keeps a 48px minimum edge on both sides, which is what the sheet leaves to the viewport.
const SETTINGS_DIALOG_VIEWPORT_GUTTER = "48px";
// Honk's sheet cap. Cursor's own editor tab is fluid; the sheet keeps a reading-width bound.
const SETTINGS_DIALOG_MAX_WIDTH = "920px";
// Reference sheet height with the same 48px total viewport clearance as the width.
const SETTINGS_DIALOG_HEIGHT = `min(744px, calc(100dvh - ${SETTINGS_DIALOG_VIEWPORT_GUTTER}))`;
const SETTINGS_CLOSE_CLEARANCE = `calc(${spaceVars["--honk-space-panel-pad"]} + ${controlVars["--honk-control-h-md"]} + ${spaceVars["--honk-space-gutter"]})`;
// `.cursor-settings-tab-content{gap:28px}` (`--cursor-spacing-7`): section-to-section rhythm.
const SETTINGS_SECTION_GAP = "28px";
// `.glass-settings-tab{max-width:42.5rem}` — the 680px content column Cursor's React tab shell and
// embedded settings panel both use.
const SETTINGS_CONTENT_MAX_WIDTH = "680px";
// `.cursor-settings-sidebar-cells{gap:1px}`.
const SETTINGS_NAV_ITEM_GAP = "1px";
const VISUALLY_HIDDEN_TITLE_SIZE = "1px";
const SETTINGS_DIALOG_STYLE: React.CSSProperties = {
  width: `calc(100% - ${SETTINGS_DIALOG_VIEWPORT_GUTTER})`,
  maxWidth: SETTINGS_DIALOG_MAX_WIDTH,
  height: SETTINGS_DIALOG_HEIGHT,
  maxHeight: SETTINGS_DIALOG_HEIGHT,
  padding: 0,
  gap: 0,
  overflow: "hidden",
};
const SETTINGS_DIALOG_TITLE_STYLE: React.CSSProperties = {
  position: "absolute",
  width: VISUALLY_HIDDEN_TITLE_SIZE,
  height: VISUALLY_HIDDEN_TITLE_SIZE,
  overflow: "hidden",
  clipPath: "inset(50%)",
  whiteSpace: "nowrap",
};

const styles = stylex.create({
  root: {
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
  nav: {
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
  navList: {
    display: "flex",
    flexDirection: {
      default: "row",
      [SETTINGS_WIDE_MEDIA]: "column",
    },
    // oxlint-disable-next-line honk/design-no-raw-values -- 1px nav-row separation is a fixed hairline gap; smallest spacing token is the 8px gutter
    gap: SETTINGS_NAV_ITEM_GAP,
    minHeight: 0,
    flexGrow: {
      default: 0,
      [SETTINGS_WIDE_MEDIA]: 1,
    },
    overflowX: {
      default: "auto",
      [SETTINGS_WIDE_MEDIA]: "visible",
    },
  },
  navGroup: {
    display: {
      default: "contents",
      [SETTINGS_WIDE_MEDIA]: "flex",
    },
    flexDirection: "column",
    // oxlint-disable-next-line honk/design-no-raw-values -- 1px nav-row separation is a fixed hairline gap; smallest spacing token is the 8px gutter
    gap: SETTINGS_NAV_ITEM_GAP,
  },
  // `<div class="w-full my-2"><hr class=cursor-settings-sidebar-divider>` — full-rail hairline with
  // an 8px block margin, replacing the group headings. The compact rail scrolls horizontally, where
  // a horizontal rule would only add noise.
  navDivider: {
    display: {
      default: "none",
      [SETTINGS_WIDE_MEDIA]: "block",
    },
    width: "100%",
    marginBlock: spaceVars["--honk-space-gutter"],
  },
  close: {
    position: "absolute",
    top: spaceVars["--honk-space-panel-pad"],
    right: spaceVars["--honk-space-panel-pad"],
    zIndex: 1,
  },
  panel: {
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
  // The page header stays put while sections switch below it, so the title and close control
  // never jump between panels — Cursor's tab header (`.glass-settings-tab__header`) plays the
  // same anchoring role above the scrolling tab content.
  pageHeader: {
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    gap: spaceVars["--honk-space-gutter"],
    paddingBlock: spaceVars["--honk-space-panel-pad"],
    paddingInlineStart: spaceVars["--honk-space-panel-pad"],
    // In the wide arm the absolute close control overlays the header's end; compact places the
    // close over the nav strip instead, so the header needs no clearance there.
    paddingInlineEnd: {
      default: spaceVars["--honk-space-panel-pad"],
      [SETTINGS_WIDE_MEDIA]: SETTINGS_CLOSE_CLEARANCE,
    },
  },
  panelScroll: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: "0%",
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    overflowY: "auto",
    paddingBlockEnd: spaceVars["--honk-space-panel-pad"],
    paddingInlineStart: spaceVars["--honk-space-panel-pad"],
    paddingInlineEnd: {
      default: spaceVars["--honk-space-panel-pad"],
      [SETTINGS_WIDE_MEDIA]: SETTINGS_CLOSE_CLEARANCE,
    },
  },
  panelColumn: {
    width: "100%",
    maxWidth: SETTINGS_CONTENT_MAX_WIDTH,
    display: "flex",
    flexDirection: "column",
    // oxlint-disable-next-line honk/design-no-raw-values -- 28px section rhythm is Cursor's tab-content intrinsic; honk's spacing tokens stop at 12px
    gap: SETTINGS_SECTION_GAP,
  },
});

export function SettingsOverlay(): React.ReactElement {
  const open = useSettingsSelector((snapshot) => snapshot.open);
  const requestedSection = useSettingsSelector((snapshot) => snapshot.section);
  const desktopConnectionsAvailable = canManageDesktopRemoteHost();
  const section =
    requestedSection === "connections" && !desktopConnectionsAvailable
      ? "servers"
      : requestedSection;
  const activeSectionRef = React.useRef<HTMLButtonElement>(null);
  const Panel = PANELS[section];

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) settingsActions.close();
      }}
    >
      <Dialog.Popup style={SETTINGS_DIALOG_STYLE} initialFocus={activeSectionRef}>
        <Dialog.Title style={SETTINGS_DIALOG_TITLE_STYLE}>Settings</Dialog.Title>
        <div {...stylex.props(styles.close)}>
          <Dialog.Close
            render={
              <IconButton size="md" variant="quiet" aria-label="Close settings">
                <Icon icon={IconCrossMedium} size="md" />
              </IconButton>
            }
          />
        </div>

        <div {...stylex.props(styles.root)}>
          <nav {...stylex.props(styles.nav)} aria-label="Settings sections">
            <div {...stylex.props(styles.navList)}>
              {SETTINGS_GROUPS.map((group, groupIndex) => (
                <React.Fragment key={group.id}>
                  {groupIndex === 0 ? null : (
                    <div {...stylex.props(styles.navDivider)}>
                      <Separator />
                    </div>
                  )}
                  <div {...stylex.props(styles.navGroup)}>
                    {group.sections.map((item) => {
                      if (item.id === "connections" && !desktopConnectionsAvailable) return null;
                      const active = item.id === section;
                      return (
                        <ListRow
                          key={item.id}
                          {...(active ? { ref: activeSectionRef } : {})}
                          size="menu"
                          isSelected={active}
                          aria-current={active ? "page" : undefined}
                          onClick={() => {
                            settingsActions.setSection(item.id);
                          }}
                        >
                          <ListRow.Slot>
                            {/* The selected row already carries the tint and primary label;
                                tinting its icon too would spend accent on navigation. */}
                            <Icon icon={item.icon} size="sm" tone={active ? "current" : "muted"} />
                          </ListRow.Slot>
                          <ListRow.Title>{item.label}</ListRow.Title>
                        </ListRow>
                      );
                    })}
                  </div>
                </React.Fragment>
              ))}
            </div>
          </nav>

          <div {...stylex.props(styles.panel)}>
            <header {...stylex.props(styles.pageHeader)}>
              {/* Cursor's page title is 17px/21px medium (`.glass-settings-tab__title`); honk's
                  heading token (16px/21px semibold) is the token-mapped equivalent. */}
              <Text as="p" size="xl" weight="semibold">
                {sectionLabelFor(section)}
              </Text>
            </header>
            <div key={section} {...stylex.props(styles.panelScroll)}>
              <div {...stylex.props(styles.panelColumn)}>
                <React.Suspense
                  fallback={<SettingsPanelSkeleton label={sectionLabelFor(section)} />}
                >
                  <Panel />
                </React.Suspense>
              </div>
            </div>
          </div>
        </div>
      </Dialog.Popup>
    </Dialog.Root>
  );
}
