import * as stylex from "@stylexjs/stylex";
import * as React from "react";

import { colorVars, elevationVars, fontVars, radiusVars, spaceVars } from "./tokens.stylex";

// Timeline geometry stays fixed so user-message stops remain a quiet navigation aid.
const RAIL_WIDTH_PX = 56;
const MAX_PREVIEW_WIDTH_PX = 320;
const RAIL_WIDTH = `${String(RAIL_WIDTH_PX)}px`;
const STOP_HEIGHT = "28px";
const STOP_MARK_HEIGHT = "1px";
const STOP_MARK_WIDTH = "14px";
const STOP_MARK_ACTIVE_WIDTH_PX = 18;
const STOP_MARK_ACTIVE_WIDTH = `${String(STOP_MARK_ACTIVE_WIDTH_PX)}px`;
const FOCUS_RING = `inset 0 0 0 1px ${colorVars["--honk-color-accent"]}`;
const PREVIEW_RING = `inset 0 0 0 1px ${colorVars["--honk-color-border-muted"]}`;

const styles = stylex.create({
  root: {
    position: "absolute",
    insetBlock: 0,
    insetInlineEnd: 0,
    width: RAIL_WIDTH,
    pointerEvents: "none",
    overflow: "visible",
    color: colorVars["--honk-color-text-muted"],
  },
  list: {
    position: "absolute",
    insetBlock: 0,
    insetInline: 0,
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    margin: 0,
    padding: 0,
    listStyle: "none",
  },
  stop: {
    position: "relative",
    flexShrink: 0,
    width: "100%",
    height: STOP_HEIGHT,
  },
  button: {
    position: "relative",
    display: "block",
    width: "100%",
    height: "100%",
    margin: 0,
    padding: 0,
    borderWidth: 0,
    borderRadius: radiusVars["--honk-radius-control"],
    backgroundColor: "transparent",
    color: {
      default: colorVars["--honk-color-text-muted"],
      ":hover": { "@media (hover: hover)": colorVars["--honk-color-text-primary"] },
      ":focus-visible": colorVars["--honk-color-text-primary"],
    },
    fontFamily: fontVars["--honk-font-family-ui"],
    fontSize: fontVars["--honk-font-size-caption"],
    textAlign: "end",
    outline: "none",
    boxShadow: { default: "none", ":focus-visible": FOCUS_RING },
    cursor: "pointer",
    pointerEvents: "auto",
  },
  buttonActive: {
    color: {
      default: colorVars["--honk-color-text-primary"],
      ":hover": { "@media (hover: hover)": colorVars["--honk-color-text-primary"] },
      ":focus-visible": colorVars["--honk-color-text-primary"],
    },
  },
  mark: {
    position: "absolute",
    top: "50%",
    insetInlineEnd: 0,
    width: STOP_MARK_WIDTH,
    height: STOP_MARK_HEIGHT,
    backgroundColor: "currentColor",
    transform: "translateY(-50%)",
  },
  markActive: { width: STOP_MARK_ACTIVE_WIDTH },
  preview: {
    position: "absolute",
    top: "50%",
    insetInlineStart: `calc(100% + ${spaceVars["--honk-space-gutter"]})`,
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    gap: spaceVars["--honk-space-gutter"],
    minWidth: 0,
    paddingBlock: spaceVars["--honk-space-panel-pad"],
    paddingInline: spaceVars["--honk-space-panel-pad"],
    pointerEvents: "none",
    transform: "translateY(-50%)",
    borderRadius: radiusVars["--honk-radius-window"],
    backgroundColor: colorVars["--honk-color-bg-base"],
    boxShadow: `${PREVIEW_RING}, ${elevationVars["--honk-elevation-floating"]}`,
    textAlign: "start",
  },
  previewLine: {
    minWidth: 0,
    overflow: "hidden",
    whiteSpace: "nowrap",
    textOverflow: "ellipsis",
    fontFamily: fontVars["--honk-font-family-ui"],
    fontSize: fontVars["--honk-font-size-body"],
    lineHeight: fontVars["--honk-leading-body"],
  },
  previewUser: {
    color: colorVars["--honk-color-text-primary"],
  },
  previewAssistant: {
    color: colorVars["--honk-color-text-muted"],
  },
});

const dynamic = stylex.create({
  previewWidth: (widthPx: number) => ({ width: `${String(widthPx)}px` }),
  stopHeight: (itemCount: number) => ({
    height: `min(${STOP_HEIGHT}, calc(100% / ${String(itemCount)}))`,
  }),
});

interface TimelineNavigatorItem {
  readonly id: string;
  readonly userText: string;
  readonly assistantText: string | null;
}

interface TimelineNavigatorProps {
  readonly items: readonly TimelineNavigatorItem[];
  readonly activeId: string | null;
  readonly availableWidthPx: number;
  readonly onNavigate: (id: string) => void;
  readonly "aria-label"?: string;
}

function TimelineNavigator({
  items,
  activeId,
  availableWidthPx,
  onNavigate,
  "aria-label": ariaLabel = "Conversation timeline",
}: TimelineNavigatorProps): React.ReactElement | null {
  const [hoveredId, setHoveredId] = React.useState<string | null>(null);
  const buttonRefs = React.useRef(new Map<string, HTMLButtonElement>());

  if (items.length < 2) return null;

  const previewWidthPx = Math.min(MAX_PREVIEW_WIDTH_PX, Math.max(0, Math.floor(availableWidthPx)));

  const navigateByKeyboard = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
  ): void => {
    let nextIndex: number | null = null;
    if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      nextIndex = Math.min(items.length - 1, index + 1);
    } else if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      nextIndex = Math.max(0, index - 1);
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = items.length - 1;
    }
    if (nextIndex === null) return;
    event.preventDefault();
    const next = items[nextIndex];
    if (next === undefined) return;
    buttonRefs.current.get(next.id)?.focus();
    onNavigate(next.id);
  };

  return (
    <nav aria-label={ariaLabel} {...stylex.props(styles.root)}>
      <ol {...stylex.props(styles.list)}>
        {items.map((item, index) => {
          const isActive = item.id === activeId;
          return (
            <li key={item.id} {...stylex.props(styles.stop, dynamic.stopHeight(items.length))}>
              <button
                ref={(element) => {
                  if (element === null) {
                    buttonRefs.current.delete(item.id);
                    return;
                  }
                  buttonRefs.current.set(item.id, element);
                  return () => {
                    buttonRefs.current.delete(item.id);
                  };
                }}
                type="button"
                aria-current={isActive ? "location" : undefined}
                aria-label={`Go to message ${String(index + 1)}: ${item.userText}`}
                tabIndex={isActive ? 0 : -1}
                {...stylex.props(styles.button, isActive && styles.buttonActive)}
                onPointerEnter={() => setHoveredId(item.id)}
                onPointerLeave={() => setHoveredId(null)}
                onFocus={() => setHoveredId(item.id)}
                onBlur={() => setHoveredId(null)}
                onClick={() => onNavigate(item.id)}
                onKeyDown={(event) => navigateByKeyboard(event, index)}
              >
                {hoveredId === item.id && previewWidthPx > 0 ? (
                  <span
                    aria-hidden={true}
                    {...stylex.props(styles.preview, dynamic.previewWidth(previewWidthPx))}
                  >
                    <span {...stylex.props(styles.previewLine, styles.previewUser)}>
                      {item.userText}
                    </span>
                    {item.assistantText !== null ? (
                      <span {...stylex.props(styles.previewLine, styles.previewAssistant)}>
                        {item.assistantText}
                      </span>
                    ) : null}
                  </span>
                ) : null}
                <span
                  aria-hidden={true}
                  {...stylex.props(styles.mark, isActive && styles.markActive)}
                />
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export { TimelineNavigator };
export type { TimelineNavigatorItem, TimelineNavigatorProps };
