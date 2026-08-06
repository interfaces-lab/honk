import * as stylex from "@stylexjs/stylex";
import { Combobox, FileTypeIcon, Icon, IconButton, Tooltip } from "@honk/ui";
import { IconCrossSmall, IconExpand45, IconMinimize45, IconPlusSmall } from "@honk/ui/icons";
import { basename } from "@honk/shared/paths";
import {
  colorVars,
  controlVars,
  fontVars,
  motionVars,
  radiusVars,
  spaceVars,
} from "@honk/ui/tokens.stylex";
import * as React from "react";

import { workbenchToolHeaderLayout } from "./workbench-layout.stylex";
import type {
  WorkbenchToolHeaderMenuItem,
  WorkbenchToolHeaderTab,
} from "./workbench-tool-header-types";

const FOCUS_RING_OFFSET_INSET = "-1px";
// Labels clamp at 200px and truncate with an ellipsis at rest; honk has no width token at that
// size.
const TAB_MAX_WIDTH = "200px";
const TAB_GAP = "1px";
// The strip is inset 4px, the close button parks at the same 4px from the pill edge, and each tab
// pads 5px/6px inline.
const TAB_STRIP_INSET = "4px";
const TAB_PAD_START = "5px";
const TAB_PAD_END = "6px";
// The pill floats centered in the 36px bar with a 5px block inset per side, landing it at 26px.
const TAB_PILL_HEIGHT = "calc(100% - 10px)";
// The close button overlays the pill's trailing cap: a 24px hit box inset 1px puts the 12px
// glyph's center 13px from the pill edge — dead center of the 26px-tall cap on both axes.
const TAB_CLOSE_INSET = "1px";
// Masks are physical gradients, so the pill flips a single angle var under `:dir(rtl)` and both
// masks read it: 90deg fades the label's trailing (inline-end) edge in LTR, 270deg mirrors it.
const TAB_FADE_ANGLE_LTR = "90deg";
const TAB_FADE_ANGLE_RTL = "270deg";
const TAB_FADE_ANGLE = `var(--_tab-fade-angle, ${TAB_FADE_ANGLE_LTR})`;
// On hover the label dissolves under the revealed close button instead of reserving space for it.
// Rest is a no-op two-stop mask, so the revealed mask has a same-shaped gradient to interpolate
// from. Revealed geometry: the glyph spans 19px→7px from the pill edge and the label ends 6px
// inside it, so the glyph's leading edge lands 13px inside the label; the fade is fully
// transparent by 12px with a 12px ramp, and has no opaque floor — a short label fades under the
// glyph rather than colliding with it.
const TAB_LABEL_MASK_REST = `linear-gradient(${TAB_FADE_ANGLE}, #000 100%, transparent 0)`;
const TAB_LABEL_MASK_REVEALED = `linear-gradient(${TAB_FADE_ANGLE}, #000 calc(100% - 24px), transparent calc(100% - 12px))`;

const styles = stylex.create({
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
  },
  tabs: {
    height: "100%",
    display: "flex",
    alignItems: "stretch",
    // oxlint-disable-next-line honk/design-no-raw-values -- 1px seam between adjacent tab controls is a fixed hairline, no spacing token owns it
    gap: TAB_GAP,
    // oxlint-disable-next-line honk/design-no-raw-values -- 4px tab-strip inset is fixed geometry; no spacing token sits between 0 and the 8px gutter
    paddingInlineStart: TAB_STRIP_INSET,
    boxSizing: "border-box",
    flexShrink: 0,
  },
  // The tab is a pill centered in the bar, not a full-height segment. StyleX 0.19 has no
  // descendant selectors, so the pill exposes the close-button reveal and the label fade through
  // private `--_` vars its children read.
  tabItem: {
    position: "relative",
    flexShrink: 0,
    maxWidth: TAB_MAX_WIDTH,
    height: TAB_PILL_HEIGHT,
    marginBlock: "auto",
    borderRadius: radiusVars["--honk-radius-control"],
    display: "flex",
    alignItems: "center",
    // One angle drives both label masks, so RTL flips the whole fade in one place.
    "--_tab-fade-angle": {
      default: TAB_FADE_ANGLE_LTR,
      ":dir(rtl)": TAB_FADE_ANGLE_RTL,
    },
    // Hover reveals close; focus-within keeps it usable when a keyboard lands on it. Pointers
    // without hover never reach either state, so they get the close button permanently.
    "--_reveal": {
      default: "0",
      "@media (hover: none)": "1",
      ":focus-within": "1",
      ":hover": { "@media (hover: hover)": "1" },
    },
    "--_close-pointer-events": {
      default: "none",
      "@media (hover: none)": "auto",
      ":focus-within": "auto",
      ":hover": { "@media (hover: hover)": "auto" },
    },
    // The label fades out under the revealed close button rather than reserving room for it, so an
    // idle tab keeps its full label and hovering one never re-measures the strip.
    "--_label-mask": {
      default: TAB_LABEL_MASK_REST,
      "@media (hover: none)": TAB_LABEL_MASK_REVEALED,
      ":focus-within": TAB_LABEL_MASK_REVEALED,
      ":hover": { "@media (hover: hover)": TAB_LABEL_MASK_REVEALED },
    },
    color: {
      default: colorVars["--honk-color-text-muted"],
      ":hover": { "@media (hover: hover)": colorVars["--honk-color-text-primary"] },
    },
    // Hover and active share one 6% fill; only the text color separates them.
    backgroundColor: {
      default: "transparent",
      ":hover": { "@media (hover: hover)": colorVars["--honk-color-tab-hover"] },
    },
    // Tabs ship no box-shadow in any state: the raised reading comes from the fill plus
    // the pill radius alone. Do not add elevation here.
    fontFamily: fontVars["--honk-font-family-ui"],
    fontSize: fontVars["--honk-font-size-body"],
    fontWeight: fontVars["--honk-font-weight-regular"],
    lineHeight: 1.5,
    userSelect: "none",
    transitionProperty: "background-color, color",
    transitionDuration: {
      default: motionVars["--honk-motion-duration-hover"],
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: motionVars["--honk-motion-ease-out"],
  },
  // Active reuses the hover fill and brightens the label; its close button stays visible so the
  // reserved slot never reads as a void on a filled pill.
  tabItemActive: {
    color: colorVars["--honk-color-text-primary"],
    backgroundColor: colorVars["--honk-color-tab-hover"],
  },
  tab: {
    flexGrow: 1,
    minWidth: 0,
    height: "100%",
    display: "flex",
    alignItems: "center",
    gap: controlVars["--honk-control-gap"],
    // oxlint-disable-next-line honk/design-no-raw-values -- 5px tab lead-in is fixed geometry; no control pad token is 5px
    paddingInlineStart: TAB_PAD_START,
    // oxlint-disable-next-line honk/design-no-raw-values -- 6px tab trail is fixed geometry; no control pad token is 6px
    paddingInlineEnd: TAB_PAD_END,
    borderWidth: 0,
    // Paints no fill of its own; the radius only exists so the focus ring traces the pill.
    borderRadius: radiusVars["--honk-radius-control"],
    color: "inherit",
    backgroundColor: "transparent",
    font: "inherit",
    // Honk deliberately keeps an accent focus ring here: a stronger, visible
    // keyboard affordance is worth the divergence from the bundle.
    outlineColor: colorVars["--honk-color-accent"],
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineWidth: controlVars["--honk-control-focus-ring-width"],
    outlineOffset: FOCUS_RING_OFFSET_INSET,
  },
  // Masked on the label alone: the leading tab glyph is a sibling, so it never enters the fade, and
  // the gradient is opaque from 0 so the label's own leading edge stays intact. At rest a clamped
  // label truncates with an ellipsis; the fade is purely the hover treatment under the close glyph.
  tabLabel: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    maskImage: "var(--_label-mask, none)",
    // The pill already cross-fades its fill and text at the hover duration; sharing that timing
    // keeps one hover reading instead of two.
    transitionProperty: "mask-image",
    transitionDuration: {
      default: motionVars["--honk-motion-duration-hover"],
      "@media (prefers-reduced-motion: reduce)": "0s",
    },
    transitionTimingFunction: motionVars["--honk-motion-ease-out"],
  },
  // The close control is a bare glyph pinned over the pill's trailing cap, hidden until the pill
  // is hovered or focused: it paints no fill in any state, so the pill's background stays the only
  // one, and the label fades beneath it instead of moving aside. IconButton would bring its quiet
  // hover fill, hence a raw button holding only color, focus ring, and geometry.
  closeButton: {
    position: "absolute",
    insetInlineEnd: TAB_CLOSE_INSET,
    insetBlock: 0,
    zIndex: 1,
    marginBlock: "auto",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    boxSizing: "border-box",
    width: controlVars["--honk-control-h-sm"],
    height: controlVars["--honk-control-h-sm"],
    padding: 0,
    borderWidth: 0,
    borderRadius: radiusVars["--honk-radius-control"],
    backgroundColor: "transparent",
    color: {
      default: "inherit",
      ":hover": { "@media (hover: hover)": colorVars["--honk-color-text-primary"] },
    },
    opacity: "var(--_reveal, 0)",
    pointerEvents: "var(--_close-pointer-events, none)",
    outlineColor: colorVars["--honk-color-accent"],
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineWidth: controlVars["--honk-control-focus-ring-width"],
    outlineOffset: FOCUS_RING_OFFSET_INSET,
  },
  newTabAction: {
    flexShrink: 0,
    height: TAB_PILL_HEIGHT,
    marginBlock: "auto",
    display: "flex",
    alignItems: "center",
    // oxlint-disable-next-line honk/design-no-raw-values -- 4px aligns the new-tab trigger with the tab-strip inset; no spacing token owns this sub-gutter offset
    paddingInlineStart: TAB_STRIP_INSET,
  },
  end: {
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    gap: controlVars["--honk-control-gap"],
    boxSizing: "border-box",
    paddingInlineStart: spaceVars["--honk-space-gutter"],
    paddingInlineEnd: spaceVars["--honk-space-panel-pad"],
  },
  // `workbench.tsx` paints the panel toggle over this slot from outside the header, so the header
  // owns the space it occupies and nothing else.
  endToggleReservation: {
    flexShrink: 0,
    width: controlVars["--honk-control-h-sm"],
  },
  menuLabel: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
});

function WorkbenchToolHeader({
  tabs,
  activeTabID,
  isMaximized,
  menuItems,
  onActivate,
  onClose,
  onCreate,
  onToggleMaximized,
  onSearchFiles,
  onOpenFile,
}: {
  readonly tabs: readonly WorkbenchToolHeaderTab[];
  readonly activeTabID: string;
  readonly isMaximized: boolean;
  readonly menuItems: readonly WorkbenchToolHeaderMenuItem[];
  readonly onActivate: (id: string) => void;
  readonly onClose: (id: string) => void;
  readonly onCreate: (id: string) => void;
  readonly onToggleMaximized: () => void;
  // Quick-open: fuzzy file search backing the "+" popup's Files section.
  readonly onSearchFiles?: (query: string) => Promise<readonly string[]>;
  readonly onOpenFile?: (path: string) => void;
}): React.ReactElement {
  const tabRefs = React.useRef(new Map<string, HTMLButtonElement>());
  const pendingFocusIDRef = React.useRef<string | null>(null);
  const [fileResults, setFileResults] = React.useState<readonly string[]>([]);
  const searchSequenceRef = React.useRef(0);

  const searchFiles = (query: string): void => {
    const trimmed = query.trim();
    const sequence = ++searchSequenceRef.current;
    if (trimmed.length === 0 || onSearchFiles === undefined) {
      setFileResults([]);
      return;
    }
    void onSearchFiles(trimmed).then(
      (paths) => {
        if (searchSequenceRef.current === sequence) setFileResults(paths.slice(0, 8));
      },
      () => {
        // Quick-open search is best-effort; a failed lookup just leaves the Apps rows.
        if (searchSequenceRef.current === sequence) setFileResults([]);
      },
    );
  };

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

  // The glyph and the label both flip; the control is not a pressed toggle, so a screen reader
  // announces one unambiguous action instead of an action plus a contradicting pressed state.
  const fullScreenLabel = isMaximized ? "Exit full screen" : "Enter full screen";

  return (
    <div {...stylex.props(workbenchToolHeaderLayout.root)}>
      <div {...stylex.props(styles.scroll)}>
        <div {...stylex.props(styles.tabStrip)}>
          <div role="tablist" aria-label="Workbench tabs" {...stylex.props(styles.tabs)}>
            {tabs.map((tab, index) => {
              const active = tab.id === activeTabID;
              return (
                <div
                  key={tab.id}
                  title={tab.title ?? tab.label}
                  // The tab and its close button are siblings, so the pill's own box sits inside
                  // neither. The pill owns the interactive cursor so sweeping across it never flips.
                  data-cursor-pointer-control=""
                  {...stylex.props(styles.tabItem, active && styles.tabItemActive)}
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
                    aria-label={tab.title ?? tab.label}
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
                    {tab.filePath === undefined ? (
                      <Icon icon={tab.icon} size="sm" />
                    ) : (
                      <FileTypeIcon path={tab.filePath} size="sm" />
                    )}
                    {tab.showLabel ? (
                      <span {...stylex.props(styles.tabLabel)}>{tab.label}</span>
                    ) : null}
                  </button>
                  {tab.closable ? (
                    <button
                      type="button"
                      aria-label={`Close ${tab.label}`}
                      data-canonical-control-exception="The close glyph rides the pill's own fill; a canonical IconButton would paint a second background inside it."
                      {...stylex.props(styles.closeButton)}
                      onClick={() => {
                        closeAndRestoreFocus(tab, index);
                      }}
                    >
                      <Icon icon={IconCrossSmall} size="xs" />
                    </button>
                  ) : null}
                </div>
              );
            })}
          </div>
          <div {...stylex.props(styles.newTabAction)}>
            <Combobox
              value={null}
              accessibilityLabel="New Tab"
              searchPlaceholder="Open any file, tool, …"
              width="wide"
              align="end"
              trigger={
                <IconButton type="button" aria-label="New Tab" size="sm" variant="quiet">
                  <Icon icon={IconPlusSmall} size="sm" />
                </IconButton>
              }
              groups={[
                {
                  label: "Apps",
                  options: menuItems.map((item) => ({
                    value: item.id,
                    label: item.label,
                    leading: <Icon icon={item.icon} size="sm" tone="muted" />,
                    ...(item.disabled === undefined ? {} : { disabled: item.disabled }),
                  })),
                },
                ...(fileResults.length > 0 && onOpenFile !== undefined
                  ? [
                      {
                        label: "Files",
                        // Server-ranked fuzzy results: pinned so the client filter does not re-filter them.
                        pinned: true,
                        options: fileResults.map((path) => ({
                          value: `file:${path}`,
                          label: basename(path),
                          description: path,
                          leading: <FileTypeIcon path={path} size="sm" />,
                        })),
                      },
                    ]
                  : []),
              ]}
              onQueryChange={searchFiles}
              onValueChange={(value) => {
                if (value.startsWith("file:")) {
                  onOpenFile?.(value.slice("file:".length));
                  return;
                }
                onCreate(value);
              }}
            />
          </div>
        </div>
      </div>
      <div {...stylex.props(styles.end)}>
        <Tooltip label={fullScreenLabel}>
          <IconButton
            type="button"
            aria-label={fullScreenLabel}
            size="sm"
            variant="quiet"
            onClick={onToggleMaximized}
          >
            <Icon icon={isMaximized ? IconMinimize45 : IconExpand45} size="sm" />
          </IconButton>
        </Tooltip>
        <span aria-hidden="true" {...stylex.props(styles.endToggleReservation)} />
      </div>
    </div>
  );
}

export { WorkbenchToolHeader };
