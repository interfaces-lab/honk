import * as stylex from "@stylexjs/stylex";
import { Icon, IconButton, Menu, type Glyph } from "@honk/ui";
import { IconCrossSmall, IconPlusSmall } from "@honk/ui/icons";
import {
  colorVars,
  controlVars,
  fontVars,
  motionVars,
  radiusVars,
  spaceVars,
} from "@honk/ui/tokens.stylex";
import * as React from "react";

import { workbenchLayout } from "./workbench-layout.stylex";

const HAIRLINE = "1px";
const HEADER_SEPARATOR_SHADOW = `inset 0 -${HAIRLINE} 0 ${colorVars["--honk-color-border-muted"]}`;
const ISLAND_GAP = "1px";
const FOCUS_RING_OFFSET_INSET = "-1px";

const styles = stylex.create({
  root: {
    flexShrink: 0,
    height: workbenchLayout.headerHeight,
    minWidth: 0,
    display: "flex",
    alignItems: "center",
    boxSizing: "border-box",
    boxShadow: HEADER_SEPARATOR_SHADOW,
  },
  scroll: {
    flexGrow: 1,
    flexShrink: 1,
    minWidth: 0,
    height: "100%",
    overflowX: "auto",
    overflowY: "hidden",
    scrollbarWidth: "none",
  },
  tabStrip: {
    width: "max-content",
    height: "100%",
    display: "flex",
    alignItems: "center",
    // oxlint-disable-next-line honk/design-no-raw-values -- 1px seam between adjacent tab controls is a fixed hairline, no spacing token owns it
    gap: ISLAND_GAP,
  },
  tabs: {
    height: "100%",
    display: "flex",
    alignItems: "center",
    // oxlint-disable-next-line honk/design-no-raw-values -- 1px seam between adjacent tab controls is a fixed hairline, no spacing token owns it
    gap: ISLAND_GAP,
    paddingInlineStart: spaceVars["--honk-space-gutter"],
    boxSizing: "border-box",
    flexShrink: 0,
  },
  tabIsland: {
    position: "relative",
    flexShrink: 0,
    maxWidth: "144px",
    height: controlVars["--honk-control-h-sm"],
    display: "flex",
    alignItems: "center",
    borderRadius: radiusVars["--honk-radius-control"],
    color: {
      default: colorVars["--honk-color-text-muted"],
      ":hover": { "@media (hover: hover)": colorVars["--honk-color-text-primary"] },
    },
    backgroundColor: {
      default: "transparent",
      ":hover": { "@media (hover: hover)": colorVars["--honk-color-state-hover"] },
    },
    fontFamily: fontVars["--honk-font-family-ui"],
    fontSize: fontVars["--honk-font-size-body"],
    fontWeight: fontVars["--honk-font-weight-regular"],
    lineHeight: 1,
    userSelect: "none",
    cursor: "pointer",
    outlineColor: colorVars["--honk-color-accent"],
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineWidth: controlVars["--honk-control-focus-ring-width"],
    outlineOffset: FOCUS_RING_OFFSET_INSET,
    transitionProperty: "background-color, color",
    transitionDuration: {
      default: motionVars["--honk-motion-duration-hover"],
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: motionVars["--honk-motion-ease-out"],
  },
  tabIslandActive: {
    color: colorVars["--honk-color-text-primary"],
    backgroundColor: colorVars["--honk-color-state-hover"],
  },
  tab: {
    minWidth: 0,
    height: "100%",
    display: "flex",
    alignItems: "center",
    gap: controlVars["--honk-control-gap"],
    paddingInline: controlVars["--honk-control-pad-sm"],
    borderWidth: 0,
    borderRadius: radiusVars["--honk-radius-control"],
    color: "inherit",
    backgroundColor: "transparent",
    font: "inherit",
    cursor: "pointer",
    outlineColor: colorVars["--honk-color-accent"],
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineWidth: controlVars["--honk-control-focus-ring-width"],
    outlineOffset: FOCUS_RING_OFFSET_INSET,
  },
  tabLabel: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  newTabAction: {
    flexShrink: 0,
    height: "100%",
    display: "flex",
    alignItems: "center",
  },
  end: {
    flexShrink: 0,
    width: `calc(${controlVars["--honk-control-h-sm"]} + ${spaceVars["--honk-space-gutter"]} + ${spaceVars["--honk-space-panel-pad"]})`,
    boxSizing: "border-box",
    paddingInlineStart: spaceVars["--honk-space-gutter"],
    paddingInlineEnd: spaceVars["--honk-space-panel-pad"],
  },
  menuLabel: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
});

type WorkbenchToolHeaderTab = {
  readonly id: string;
  readonly label: string;
  readonly icon: Glyph;
  readonly closable: boolean;
  readonly showLabel: boolean;
};

type WorkbenchToolHeaderMenuItem = {
  readonly id: string;
  readonly label: string;
  readonly icon: Glyph;
  readonly disabled?: boolean;
};

function WorkbenchToolHeader({
  tabs,
  activeTabID,
  menuItems,
  onActivate,
  onClose,
  onCreate,
}: {
  readonly tabs: readonly WorkbenchToolHeaderTab[];
  readonly activeTabID: string;
  readonly menuItems: readonly WorkbenchToolHeaderMenuItem[];
  readonly onActivate: (id: string) => void;
  readonly onClose: (id: string) => void;
  readonly onCreate: (id: string) => void;
}): React.ReactElement {
  const tabRefs = React.useRef(new Map<string, HTMLButtonElement>());
  const pendingFocusIDRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    tabRefs.current.get(activeTabID)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeTabID]);

  React.useLayoutEffect(() => {
    const pendingFocusID = pendingFocusIDRef.current;
    if (pendingFocusID === null) return;
    const target = tabRefs.current.get(pendingFocusID) ?? tabRefs.current.get(activeTabID);
    if (target === undefined) return;
    pendingFocusIDRef.current = null;
    target.focus();
  }, [activeTabID, tabs]);

  const activateAndFocus = (index: number): void => {
    const tab = tabs[index];
    if (tab === undefined) return;
    onActivate(tab.id);
    tabRefs.current.get(tab.id)?.focus();
  };

  const closeAndRestoreFocus = (tab: WorkbenchToolHeaderTab, index: number): void => {
    pendingFocusIDRef.current =
      tab.id === activeTabID ? (tabs[index + 1]?.id ?? tabs[index - 1]?.id ?? null) : activeTabID;
    onClose(tab.id);
  };

  return (
    <div {...stylex.props(styles.root)}>
      <div {...stylex.props(styles.scroll)}>
        <div {...stylex.props(styles.tabStrip)}>
          <div role="tablist" aria-label="Workbench tabs" {...stylex.props(styles.tabs)}>
            {tabs.map((tab, index) => {
              const active = tab.id === activeTabID;
              return (
                <div
                  key={tab.id}
                  title={tab.label}
                  {...stylex.props(styles.tabIsland, active && styles.tabIslandActive)}
                >
                  <button
                    ref={(node) => {
                      if (node === null) tabRefs.current.delete(tab.id);
                      else tabRefs.current.set(tab.id, node);
                    }}
                    type="button"
                    role="tab"
                    data-canonical-control-exception="Roving tab semantics require direct focus ownership."
                    tabIndex={active ? 0 : -1}
                    aria-label={tab.label}
                    aria-selected={active}
                    {...stylex.props(styles.tab)}
                    onClick={() => {
                      onActivate(tab.id);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "ArrowLeft") {
                        event.preventDefault();
                        activateAndFocus(index <= 0 ? tabs.length - 1 : index - 1);
                        return;
                      }
                      if (event.key === "ArrowRight") {
                        event.preventDefault();
                        activateAndFocus(index >= tabs.length - 1 ? 0 : index + 1);
                        return;
                      }
                      if (event.key === "Home") {
                        event.preventDefault();
                        activateAndFocus(0);
                        return;
                      }
                      if (event.key === "End") {
                        event.preventDefault();
                        activateAndFocus(tabs.length - 1);
                        return;
                      }
                      if (event.key === "Delete" && tab.closable) {
                        event.preventDefault();
                        closeAndRestoreFocus(tab, index);
                      }
                    }}
                  >
                    <Icon icon={tab.icon} size="sm" />
                    {tab.showLabel ? (
                      <span {...stylex.props(styles.tabLabel)}>{tab.label}</span>
                    ) : null}
                  </button>
                  {tab.closable ? (
                    <IconButton
                      type="button"
                      aria-label={`Close ${tab.label}`}
                      size="sm"
                      variant="quiet"
                      onClick={() => {
                        closeAndRestoreFocus(tab, index);
                      }}
                    >
                      <Icon icon={IconCrossSmall} size="xs" />
                    </IconButton>
                  ) : null}
                </div>
              );
            })}
          </div>
          <div {...stylex.props(styles.newTabAction)}>
            <Menu.Root>
              <Menu.Trigger
                render={
                  <IconButton type="button" aria-label="New Tab" size="sm" variant="quiet">
                    <Icon icon={IconPlusSmall} size="sm" />
                  </IconButton>
                }
              />
              <Menu.Popup side="bottom" align="end">
                {menuItems.map((item) => (
                  <Menu.Item
                    key={item.id}
                    disabled={item.disabled}
                    onClick={() => {
                      onCreate(item.id);
                    }}
                  >
                    <Icon icon={item.icon} size="sm" tone="muted" />
                    <span {...stylex.props(styles.menuLabel)}>{item.label}</span>
                  </Menu.Item>
                ))}
              </Menu.Popup>
            </Menu.Root>
          </div>
        </div>
      </div>
      <div aria-hidden="true" {...stylex.props(styles.end)} />
    </div>
  );
}

export { WorkbenchToolHeader };
export type { WorkbenchToolHeaderMenuItem, WorkbenchToolHeaderTab };
