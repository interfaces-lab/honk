import * as stylex from "@stylexjs/stylex";
import {
  FileTypeIcon,
  Icon,
  Popover,
  type Glyph,
  type IconSize,
  type IconTone,
} from "@honk/ui";
import {
  IconArrowLeft,
  IconBranch,
  IconBubble2,
  IconBubbleCheck,
  IconBug,
  IconBuildingBlocks,
  IconChatBubbles,
  IconCheckmark1,
  IconConsoleSimple,
  IconFolder1,
  IconGlobe,
  IconSend,
} from "@honk/ui/icons";
import {
  colorVars,
  composerVars,
  controlVars,
  fontVars,
  radiusVars,
  spaceVars,
} from "@honk/ui/tokens.stylex";
import * as React from "react";

import { promptMenuItemInteractionProps } from "./prompt-menu-interaction";
import type { SwitchableModeId } from "../modes";

const MAX_EXPANDED_PATH_SEGMENTS = 4;
// Shared edge gutter with the menu/picker/combobox popups so every dropdown insets its
// rounded row highlight the same distance from the popup wall.
const PANEL_EDGE_PAD = controlVars["--honk-control-menu-pad"];
// Matches the gutter the composer's other floating surfaces leave against their anchor.
const MENU_GAP_PX = 8;

// A live rect the menu positions against: the DOM range covering the "/" or "@" token being typed.
// `contextElement` gives the positioner a real node to hang scroll and resize listeners off, which a
// bare rect closure cannot supply. Identity must change whenever the rect moves — the positioner
// only recomputes when the anchor it was handed is a different object.
export type PromptMenuAnchor = {
  readonly getBoundingClientRect: () => DOMRect;
  readonly contextElement?: Element;
};

export type PromptMenuItemKind =
  | "back"
  | "branch"
  | "browser"
  | "chat"
  | "command"
  | "file"
  | "folder"
  | "mode"
  | "skill"
  | "source-files"
  | "source-chats";

// Mode rows carry the mode they switch into. Build is absent by construction: it is the resting
// state you return to by reselecting the active mode, so it has no row and no glyph.
export type PromptMenuItem = {
  readonly key: string;
  readonly title: string;
  readonly detail: string | null;
  readonly section?: string;
  readonly path?: string;
  readonly isCurrent?: boolean;
} & (
  | { readonly kind: Exclude<PromptMenuItemKind, "mode">; readonly mode?: never }
  | { readonly kind: "mode"; readonly mode: SwitchableModeId }
);

const MODE_ICONS: Readonly<Record<SwitchableModeId, Glyph>> = {
  plan: IconSend,
  debug: IconBug,
  ask: IconBubbleCheck,
};

function itemIcon(item: PromptMenuItem): Glyph | null {
  if (item.isCurrent === true) return IconCheckmark1;
  switch (item.kind) {
    case "back":
      return IconArrowLeft;
    case "branch":
      return IconBranch;
    case "browser":
      return IconGlobe;
    case "chat":
      return IconBubble2;
    case "source-chats":
      return IconChatBubbles;
    case "command":
      return IconConsoleSimple;
    case "file":
      return null;
    case "folder":
    case "source-files":
      return IconFolder1;
    case "mode":
      return MODE_ICONS[item.mode];
    case "skill":
      return IconBuildingBlocks;
  }
}

export function PromptMenuItemIcon({
  item,
  size = "md",
  tone,
}: {
  readonly item: PromptMenuItem;
  readonly size?: IconSize;
  readonly tone?: IconTone;
}): React.ReactElement {
  const icon = itemIcon(item);
  if (icon === null) {
    if (tone === undefined) {
      return <FileTypeIcon path={item.path ?? item.key} size={size} />;
    }
    return <FileTypeIcon path={item.path ?? item.key} size={size} tone={tone} />;
  }
  return (
    <Icon
      icon={icon}
      size={size}
      tone={item.isCurrent === true ? "accent" : (tone ?? "muted")}
    />
  );
}

// Both surfaces ride @honk/ui Popover, which portals out of the composer's clipping ancestors and
// owns collision handling. These only restate the menu's own paint and its intrinsic box.
const PANEL_STYLE = {
  boxSizing: "border-box",
  display: "flex",
  flexDirection: "column",
  width: composerVars["--honk-composer-menu-width"],
  maxWidth: "var(--available-width)",
  maxHeight: `min(${composerVars["--honk-composer-menu-max-height"]}, var(--available-height))`,
  overflowY: "auto",
  overscrollBehavior: "contain",
  padding: PANEL_EDGE_PAD,
  borderRadius: radiusVars["--honk-radius-menu"],
} as const satisfies React.CSSProperties;

const PREVIEW_STYLE = {
  boxSizing: "border-box",
  width: composerVars["--honk-composer-menu-preview-width"],
  maxWidth: "var(--available-width)",
  maxHeight: `min(${composerVars["--honk-composer-menu-preview-max-height"]}, var(--available-height))`,
  overflow: "hidden",
  padding: controlVars["--honk-control-gap"],
  borderRadius: radiusVars["--honk-radius-menu"],
  // The preview is read-only chrome; keeping it inert stops a stray press from stealing the caret.
  pointerEvents: "none",
} as const satisfies React.CSSProperties;

// Stay on the inline axis so the preview never lands on top of the list it describes.
const SAME_AXIS_ONLY = { side: "flip", align: "shift", fallbackAxisSide: "none" } as const;

const styles = stylex.create({
  section: {
    boxSizing: "border-box",
    flexShrink: 0,
    height: controlVars["--honk-control-h-sm"],
    display: "flex",
    alignItems: "center",
    paddingInline: controlVars["--honk-control-pad-sm"],
    color: colorVars["--honk-color-text-muted"],
    fontFamily: fontVars["--honk-font-family-ui"],
    fontSize: fontVars["--honk-font-size-caption"],
  },
  row: {
    appearance: "none",
    boxSizing: "border-box",
    width: "100%",
    minWidth: 0,
    flexShrink: 0,
    height: controlVars["--honk-control-h-sm"],
    display: "flex",
    alignItems: "center",
    gap: controlVars["--honk-control-gap"],
    paddingBlock: 0,
    paddingInline: controlVars["--honk-control-pad-sm"],
    borderWidth: 0,
    borderRadius: radiusVars["--honk-radius-control"],
    backgroundColor: {
      default: "transparent",
      ":hover": { "@media (hover: hover)": colorVars["--honk-color-state-hover"] },
    },
    color: colorVars["--honk-color-text-primary"],
    fontFamily: fontVars["--honk-font-family-ui"],
    textAlign: "start",
  },
  rowWithDetail: {
    height: "auto",
    minHeight: controlVars["--honk-control-h-lg"],
    // oxlint-disable-next-line honk/design-no-raw-values -- 4px block pad is the compact two-line row intrinsic
    paddingBlock: "4px",
  },
  rowSelected: {
    backgroundColor: {
      default: colorVars["--honk-color-control-selected"],
      ":hover": {
        "@media (hover: hover)": colorVars["--honk-color-control-selected"],
      },
    },
  },
  rowText: { minWidth: 0, display: "flex", flexDirection: "column" },
  title: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    fontSize: fontVars["--honk-font-size-body"],
    lineHeight: fontVars["--honk-leading-body"],
  },
  detail: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: colorVars["--honk-color-text-muted"],
    fontSize: fontVars["--honk-font-size-detail"],
    lineHeight: fontVars["--honk-leading-detail"],
  },
  empty: {
    minHeight: controlVars["--honk-control-h-lg"],
    display: "flex",
    alignItems: "center",
    paddingInline: controlVars["--honk-control-pad-sm"],
    color: colorVars["--honk-color-text-faint"],
    fontFamily: fontVars["--honk-font-family-ui"],
    fontSize: fontVars["--honk-font-size-detail"],
  },
  previewTitle: {
    margin: 0,
    color: colorVars["--honk-color-text-primary"],
    fontSize: fontVars["--honk-font-size-body"],
    fontWeight: fontVars["--honk-font-weight-semibold"],
  },
  previewBody: {
    marginBlockStart: spaceVars["--honk-space-gutter"],
    marginBlockEnd: 0,
    color: colorVars["--honk-color-text-muted"],
    fontSize: fontVars["--honk-font-size-body"],
    lineHeight: fontVars["--honk-leading-body"],
    whiteSpace: "pre-wrap",
  },
  staircase: { display: "flex", flexDirection: "column", minWidth: 0 },
  pathRow: {
    minWidth: 0,
    minHeight: controlVars["--honk-control-h-md"],
    display: "flex",
    alignItems: "stretch",
  },
  pathRail: {
    boxSizing: "border-box",
    flexShrink: 0,
    width: controlVars["--honk-control-pad-lg"],
    borderInlineStartWidth: controlVars["--honk-control-border-width"],
    borderInlineStartStyle: "solid",
    borderInlineStartColor: colorVars["--honk-color-border-muted"],
  },
  pathLabel: {
    minWidth: 0,
    display: "flex",
    alignItems: "center",
    gap: controlVars["--honk-control-gap"],
    color: colorVars["--honk-color-text-muted"],
    fontSize: fontVars["--honk-font-size-detail"],
  },
  pathLabelLeaf: { color: colorVars["--honk-color-text-primary"] },
  pathText: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
});

function showsDetail(item: PromptMenuItem): boolean {
  return item.detail !== null && item.kind !== "command" && item.kind !== "skill";
}

export function PromptMenuPathPreview({
  item,
}: {
  readonly item: PromptMenuItem;
}): React.ReactElement {
  const segments = (item.path ?? item.key).split(/[\\/]/).filter(Boolean);
  const isFile = item.kind === "file";
  const directorySegments = isFile ? segments.slice(0, -1) : segments;
  const collapsedCount = Math.max(0, directorySegments.length - MAX_EXPANDED_PATH_SEGMENTS);
  const rows = [
    ...(collapsedCount === 0
      ? []
      : [
          {
            key: "collapsed",
            label: directorySegments.slice(0, collapsedCount).join("/"),
            depth: 0,
            isLeaf: false,
            isFile: false,
          },
        ]),
    ...directorySegments.slice(collapsedCount).map((segment, index) => ({
      key: `directory:${String(index)}:${segment}`,
      label: segment,
      depth: index + (collapsedCount === 0 ? 0 : 1),
      isLeaf: !isFile && index === directorySegments.length - collapsedCount - 1,
      isFile: false,
    })),
    ...(isFile
      ? [
          {
            key: "file",
            label: segments.at(-1) ?? item.title,
            depth: directorySegments.length - collapsedCount + (collapsedCount === 0 ? 0 : 1),
            isLeaf: true,
            isFile: true,
          },
        ]
      : []),
  ];

  return (
    <div {...stylex.props(styles.staircase)}>
      {rows.map((row) => (
        <div key={row.key} {...stylex.props(styles.pathRow)}>
          {Array.from({ length: row.depth }, (_, index) => (
            <span key={index} aria-hidden="true" {...stylex.props(styles.pathRail)} />
          ))}
          <span {...stylex.props(styles.pathLabel, row.isLeaf && styles.pathLabelLeaf)}>
            {row.isFile ? (
              <PromptMenuItemIcon item={item} size="sm" />
            ) : (
              <Icon icon={IconFolder1} size="sm" tone={row.isLeaf ? "muted" : "faint"} />
            )}
            <span {...stylex.props(styles.pathText)}>{row.label}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

// Null means the item has nothing worth a second panel, which is what closes the preview popover.
function previewContent(item: PromptMenuItem): React.ReactElement | null {
  if (item.kind === "file" || item.kind === "folder") {
    return <PromptMenuPathPreview key={item.path ?? item.key} item={item} />;
  }
  if (item.detail === null || (item.kind !== "skill" && item.kind !== "command")) return null;
  return (
    <>
      <h3 {...stylex.props(styles.previewTitle)}>{item.title}</h3>
      <p {...stylex.props(styles.previewBody)}>{item.detail}</p>
    </>
  );
}

export function PromptMenu({
  anchor,
  items,
  selectedIndex,
  placement,
  emptyLabel,
  isLoading,
  listboxId,
  onSelect,
  onHighlight,
  isKeyboardNavigation,
}: {
  readonly anchor: PromptMenuAnchor;
  readonly items: readonly PromptMenuItem[];
  readonly selectedIndex: number;
  readonly placement: "above" | "below";
  readonly emptyLabel: string;
  readonly isLoading: boolean;
  readonly listboxId: string;
  readonly onSelect: (item: PromptMenuItem) => void;
  readonly onHighlight: (index: number) => void;
  readonly isKeyboardNavigation: boolean;
}): React.ReactElement {
  const pointerDownItemKeyRef = React.useRef<string | null>(null);
  const panelElementRef = React.useRef<HTMLDivElement | null>(null);
  // Pair the node with the item it represents. Results can change before callback refs commit, and
  // a detached button is not an honest anchor for the next result's preview.
  const [previewAnchor, setPreviewAnchor] = React.useState<{
    readonly itemKey: string;
    readonly element: HTMLButtonElement;
  } | null>(null);
  const selected = items[selectedIndex];
  const selectedKey = selected?.key ?? null;
  const hasOnlyBackItem = items.length === 1 && items[0]?.kind === "back";
  const preview = selected === undefined ? null : previewContent(selected);
  const selectedElement =
    previewAnchor !== null &&
    previewAnchor.itemKey === selectedKey &&
    previewAnchor.element.isConnected
      ? previewAnchor.element
      : null;
  // React invokes a changed callback ref with null before attaching the replacement. Keep this
  // identity stable until its captured selection changes so its state update cannot render-loop.
  const trackSelectedRow = React.useCallback(
    (element: HTMLButtonElement | null): void => {
      setPreviewAnchor((current) => {
        if (element === null || selectedKey === null) {
          return current?.itemKey === selectedKey ? null : current;
        }
        if (current?.itemKey === selectedKey && current.element === element) return current;
        return { itemKey: selectedKey, element };
      });
      const panel = panelElementRef.current;
      if (element === null || panel === null || !isKeyboardNavigation) return;
      if (element.offsetTop < panel.scrollTop) {
        panel.scrollTop = element.offsetTop;
        return;
      }
      if (element.offsetTop + element.offsetHeight > panel.scrollTop + panel.clientHeight) {
        panel.scrollTop = element.offsetTop + element.offsetHeight - panel.clientHeight;
      }
    },
    [isKeyboardNavigation, selectedKey],
  );
  return (
    <>
      <Popover.Root modal={false} open>
        <Popover.Popup
          ref={panelElementRef}
          id={listboxId}
          role="listbox"
          aria-label="Composer suggestions"
          aria-busy={isLoading}
          anchor={anchor}
          positionMethod="fixed"
          side={placement === "above" ? "top" : "bottom"}
          align="start"
          sideOffset={MENU_GAP_PX}
          collisionAvoidance={SAME_AXIS_ONLY}
          initialFocus={false}
          finalFocus={false}
          style={PANEL_STYLE}
        >
          {items.length === 0 ? (
            <div role="status" aria-live="polite" {...stylex.props(styles.empty)}>
              {emptyLabel}
            </div>
          ) : (
            <>
              {items.map((item, index) => {
                const previousSection = items[index - 1]?.section;
                return (
                  <React.Fragment key={item.key}>
                    {item.section !== undefined && item.section !== previousSection ? (
                      <div role="presentation" {...stylex.props(styles.section)}>
                        {item.section}
                      </div>
                    ) : null}
                    <button
                      id={`${listboxId}-option-${String(index)}`}
                      ref={index === selectedIndex ? trackSelectedRow : null}
                      type="button"
                      tabIndex={-1}
                      role="option"
                      aria-selected={index === selectedIndex}
                      data-canonical-control-exception="Composer suggestion row: focus remains in Lexical while this composite owns keyboard selection."
                      {...stylex.props(
                        styles.row,
                        showsDetail(item) && styles.rowWithDetail,
                        index === selectedIndex && styles.rowSelected,
                      )}
                      {...promptMenuItemInteractionProps(
                        item,
                        onSelect,
                        index === selectedIndex,
                        pointerDownItemKeyRef,
                      )}
                      onPointerMove={() => {
                        if (isKeyboardNavigation || index !== selectedIndex) onHighlight(index);
                      }}
                    >
                      <PromptMenuItemIcon item={item} />
                      <span {...stylex.props(styles.rowText)}>
                        <span {...stylex.props(styles.title)}>{item.title}</span>
                        {showsDetail(item) ? (
                          <span {...stylex.props(styles.detail)}>{item.detail}</span>
                        ) : null}
                      </span>
                    </button>
                  </React.Fragment>
                );
              })}
              {hasOnlyBackItem ? (
                <div role="status" aria-live="polite" {...stylex.props(styles.empty)}>
                  {emptyLabel}
                </div>
              ) : null}
            </>
          )}
        </Popover.Popup>
      </Popover.Root>
      {preview === null || selectedElement === null || selected === undefined ? null : (
        <Popover.Root modal={false} open>
          <Popover.Popup
            aria-label={`${selected.title} preview`}
            anchor={selectedElement}
            positionMethod="fixed"
            side="inline-end"
            align="start"
            sideOffset={MENU_GAP_PX}
            collisionAvoidance={SAME_AXIS_ONLY}
            initialFocus={false}
            finalFocus={false}
            style={PREVIEW_STYLE}
          >
            {preview}
          </Popover.Popup>
        </Popover.Root>
      )}
    </>
  );
}
