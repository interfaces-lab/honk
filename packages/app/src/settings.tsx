import * as stylex from "@stylexjs/stylex";
import { Dialog, Icon, IconButton, ListRow, Text } from "@honk/ui";
import {
  IconArchive1,
  IconBuildingBlocks,
  IconCrossSmall,
  IconEyeOpen,
  IconServer,
  IconSettingsGear2,
} from "@honk/ui/icons";
import { colorVars, controlVars, spaceVars } from "@honk/ui/tokens.stylex";
import * as React from "react";

import { SettingsAppearance } from "./settings-appearance";
import { SettingsArchived } from "./settings-archived";
import { SettingsGeneral } from "./settings-general";
import { SettingsProviders } from "./settings-providers";
import { SettingsServers } from "./settings-servers";
import {
  actions as settingsActions,
  useSettingsSelector,
  type SettingsSectionId,
} from "./settings-store";

const SETTINGS_GROUPS = [
  {
    label: "Preferences",
    sections: [
      { id: "general", label: "General", icon: IconSettingsGear2 },
      { id: "appearance", label: "Appearance", icon: IconEyeOpen },
    ],
  },
  {
    label: "Connections",
    sections: [
      { id: "servers", label: "Servers", icon: IconServer },
      { id: "providers", label: "Authentication", icon: IconBuildingBlocks },
    ],
  },
  {
    label: "History",
    sections: [{ id: "archived", label: "Archived", icon: IconArchive1 }],
  },
] as const satisfies readonly {
  readonly label: string;
  readonly sections: readonly {
    readonly id: SettingsSectionId;
    readonly label: string;
    readonly icon: typeof IconSettingsGear2;
  }[];
}[];

const SETTINGS_WIDE_MEDIA = "@media (min-width: 720px)";
const SETTINGS_NAV_WIDTH = "200px";
const SETTINGS_NAV_COMPACT_MAX_HEIGHT = "152px";
const SETTINGS_PANEL_MAX_WIDTH = "640px";
const SETTINGS_DIALOG_WIDTH = "calc(100% - 48px)";
const SETTINGS_DIALOG_MAX_WIDTH = "920px";
const SETTINGS_DIALOG_HEIGHT = "min(680px, calc(100dvh - 48px))";
const SETTINGS_CLOSE_CLEARANCE = `calc(${spaceVars["--honk-space-panel-pad"]} + ${controlVars["--honk-control-h-sm"]} + ${spaceVars["--honk-space-gutter"]})`;
const SETTINGS_SECTION_GAP = `calc(${spaceVars["--honk-space-panel-pad"]} * 2)`;
const SETTINGS_NAV_ITEM_GAP = "1px";
const HAIRLINE = "1px";
const SETTINGS_DIALOG_STYLE: React.CSSProperties = {
  width: SETTINGS_DIALOG_WIDTH,
  maxWidth: SETTINGS_DIALOG_MAX_WIDTH,
  height: SETTINGS_DIALOG_HEIGHT,
  maxHeight: SETTINGS_DIALOG_HEIGHT,
  padding: 0,
  gap: 0,
  overflow: "hidden",
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
      [SETTINGS_WIDE_MEDIA]: SETTINGS_NAV_WIDTH,
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
    gap: {
      default: SETTINGS_NAV_ITEM_GAP,
      [SETTINGS_WIDE_MEDIA]: spaceVars["--honk-space-panel-pad"],
    },
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
    gap: SETTINGS_NAV_ITEM_GAP,
  },
  navGroupLabel: {
    display: {
      default: "none",
      [SETTINGS_WIDE_MEDIA]: "flex",
    },
    alignItems: "center",
    minHeight: controlVars["--honk-control-h-sm"],
    paddingInline: controlVars["--honk-control-pad-md"],
  },
  navGroupList: {
    display: {
      default: "contents",
      [SETTINGS_WIDE_MEDIA]: "flex",
    },
    flexDirection: "column",
    gap: SETTINGS_NAV_ITEM_GAP,
  },
  navTitle: {
    minHeight: controlVars["--honk-control-h-md"],
    display: "flex",
    alignItems: "center",
    paddingInline: controlVars["--honk-control-pad-md"],
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
    overflowY: "auto",
    borderTopWidth: {
      default: HAIRLINE,
      [SETTINGS_WIDE_MEDIA]: 0,
    },
    borderTopStyle: "solid",
    borderTopColor: colorVars["--honk-color-border-muted"],
    borderLeftWidth: {
      default: 0,
      [SETTINGS_WIDE_MEDIA]: HAIRLINE,
    },
    borderLeftStyle: "solid",
    borderLeftColor: colorVars["--honk-color-border-muted"],
    paddingBlock: spaceVars["--honk-space-panel-pad"],
    paddingInlineStart: spaceVars["--honk-space-panel-pad"],
    paddingInlineEnd: {
      default: spaceVars["--honk-space-panel-pad"],
      [SETTINGS_WIDE_MEDIA]: SETTINGS_CLOSE_CLEARANCE,
    },
  },
  panelColumn: {
    width: "100%",
    maxWidth: SETTINGS_PANEL_MAX_WIDTH,
    display: "flex",
    flexDirection: "column",
    gap: SETTINGS_SECTION_GAP,
  },
});

export function SettingsOverlay(): React.ReactElement {
  const open = useSettingsSelector((snapshot) => snapshot.open);
  const section = useSettingsSelector((snapshot) => snapshot.section);
  const activeSectionRef = React.useRef<HTMLButtonElement>(null);

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) settingsActions.close();
      }}
    >
      <Dialog.Popup style={SETTINGS_DIALOG_STYLE} initialFocus={activeSectionRef}>
        <div {...stylex.props(styles.close)}>
          <Dialog.Close
            render={
              <IconButton size="sm" variant="quiet" aria-label="Close settings">
                <Icon icon={IconCrossSmall} size="sm" />
              </IconButton>
            }
          />
        </div>

        <div {...stylex.props(styles.root)}>
          <nav {...stylex.props(styles.nav)} aria-label="Settings sections">
            <div {...stylex.props(styles.navTitle)}>
              <Dialog.Title>Settings</Dialog.Title>
            </div>
            <div {...stylex.props(styles.navList)}>
              {SETTINGS_GROUPS.map((group) => (
                <div key={group.label} {...stylex.props(styles.navGroup)}>
                  <div {...stylex.props(styles.navGroupLabel)}>
                    <Text size="xs" tone="faint" weight="medium">
                      {group.label}
                    </Text>
                  </div>
                  <div {...stylex.props(styles.navGroupList)}>
                    {group.sections.map((item) => {
                      const active = item.id === section;
                      return (
                        <ListRow
                          key={item.id}
                          {...(active ? { ref: activeSectionRef } : {})}
                          isSelected={active}
                          aria-current={active ? "page" : undefined}
                          onClick={() => {
                            settingsActions.setSection(item.id);
                          }}
                        >
                          <ListRow.Slot>
                            <Icon icon={item.icon} size="sm" tone={active ? "accent" : "muted"} />
                          </ListRow.Slot>
                          <ListRow.Title>{item.label}</ListRow.Title>
                        </ListRow>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </nav>

          <div {...stylex.props(styles.panel)}>
            <div {...stylex.props(styles.panelColumn)}>
              {section === "general" ? (
                <SettingsGeneral />
              ) : section === "servers" ? (
                <SettingsServers />
              ) : section === "providers" ? (
                <SettingsProviders />
              ) : section === "appearance" ? (
                <SettingsAppearance />
              ) : (
                <SettingsArchived />
              )}
            </div>
          </div>
        </div>
      </Dialog.Popup>
    </Dialog.Root>
  );
}
