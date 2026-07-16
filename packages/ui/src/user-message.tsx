// Sole bubbled thread element. Assistant output never routes here.

import * as stylex from "@stylexjs/stylex";
import * as React from "react";

import { Button } from "./button";
import { applyStyle, type HonkStyle, type StyleProp } from "./style";
import { colorVars, conversationVars, fontVars, radiusVars } from "./tokens.stylex";

// Cursor 3.11.25 UserMessageBox uses spacing-2 inline and spacing-1.5 block.
const BUBBLE_PAD_X = "10px";
const BUBBLE_PAD_Y = "8px";
const BUBBLE_CONTENT_GAP = "6px";
const BUBBLE_FOOTER_GAP = "4px";
const RING_WIDTH = "1px";
// Black carries mask alpha only; the 65% stop is fixed Cursor clipping geometry.
const PREVIEW_FADE_MASK = "linear-gradient(to bottom, black 65%, transparent 100%)";

// Cursor UserMessageBox. Four 18px lines collapse at 72px.
const PREVIEW_COLLAPSED_HEIGHT = 72;
const PREVIEW_EXPANDED_MAX_HEIGHT = 300;

const styles = stylex.create({
  row: {
    boxSizing: "border-box",
    display: "flex",
    justifyContent: "flex-end",
    minWidth: 0,
    width: "100%",
  },
  bubble: {
    position: "relative",
    isolation: "isolate",
    boxSizing: "border-box",
    width: "100%",
    maxWidth: "100%",
    minWidth: 0,
    overflow: "hidden",
    borderRadius: radiusVars["--honk-radius-bubble"],
    backgroundColor: colorVars["--honk-color-message-bubble-bg"],
    // Inset box-shadow ring. Never a border.
    "::after": {
      content: '""',
      position: "absolute",
      inset: 0,
      borderRadius: "inherit",
      boxShadow: `inset 0 0 0 ${RING_WIDTH} ${colorVars["--honk-color-message-bubble-ring"]}`,
      pointerEvents: "none",
    },
  },
  editableBubble: {
    cursor: "pointer",
  },
  content: {
    boxSizing: "border-box",
    display: "flex",
    flexDirection: "column",
    gap: BUBBLE_CONTENT_GAP,
    minWidth: 0,
    width: "100%",
    paddingInline: BUBBLE_PAD_X,
    paddingBlock: BUBBLE_PAD_Y,
    fontFamily: fontVars["--honk-font-family-ui"],
    fontSize: fontVars["--honk-font-size-body-lg"],
    lineHeight: fontVars["--honk-leading-heading"],
    color: colorVars["--honk-color-fg"],
    overflowWrap: "anywhere",
  },
  footer: {
    marginTop: BUBBLE_FOOTER_GAP,
  },
  previewRoot: {
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
  },
  previewViewport: {
    minWidth: 0,
  },
  previewCollapsed: {
    maxHeight: PREVIEW_COLLAPSED_HEIGHT,
    overflow: "hidden",
  },
  previewFaded: {
    maskImage: PREVIEW_FADE_MASK,
  },
  previewExpanded: {
    maxHeight: PREVIEW_EXPANDED_MAX_HEIGHT,
    overflowY: "auto",
  },
  previewContent: {
    minWidth: 0,
  },
});

const forward = {
  previewToggle: {
    alignSelf: "flex-end",
    marginBlockStart: conversationVars["--honk-conversation-row-gap"],
  },
} satisfies Record<string, HonkStyle>;

interface UserMessageProps {
  children?: React.ReactNode;
  footer?: React.ReactNode | undefined;
  onEdit?: (() => void) | undefined;
  style?: StyleProp<HonkStyle>;
}

interface UserMessagePreviewProps {
  children?: React.ReactNode;
  style?: StyleProp<HonkStyle>;
}

function UserMessagePreview({ children, style }: UserMessagePreviewProps): React.ReactElement {
  const [isExpanded, setExpanded] = React.useState(false);
  const [isCollapsible, setCollapsible] = React.useState(false);
  const viewportRef = React.useRef<HTMLDivElement | null>(null);
  const previewId = React.useId();

  const contentRef: React.RefCallback<HTMLDivElement> = (node) => {
    if (node === null) {
      return;
    }

    const measure = (): void => {
      const contentHeight = node.scrollHeight;
      setCollapsible(contentHeight > PREVIEW_COLLAPSED_HEIGHT);
    };
    measure();
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(measure);
      // react-doctor-disable-next-line react-doctor/effect-needs-cleanup -- React 19 runs the returned callback-ref teardown, which disconnects this observer.
      observer.observe(node);
      return () => {
        observer.disconnect();
      };
    }
  };

  return (
    <div data-user-message-preview="" {...applyStyle(stylex.props(styles.previewRoot), style)}>
      <div
        id={previewId}
        ref={viewportRef}
        data-expanded={isExpanded ? "" : undefined}
        {...stylex.props(
          styles.previewViewport,
          isExpanded ? styles.previewExpanded : styles.previewCollapsed,
          isCollapsible && !isExpanded && styles.previewFaded,
        )}
      >
        <div ref={contentRef} {...stylex.props(styles.previewContent)}>
          {children}
        </div>
      </div>
      {isCollapsible ? (
        <Button
          variant="quiet"
          size="sm"
          aria-expanded={isExpanded}
          aria-controls={previewId}
          style={forward.previewToggle}
          onClick={() => {
            if (viewportRef.current !== null) {
              viewportRef.current.scrollTop = 0;
            }
            setExpanded((current) => !current);
          }}
        >
          {isExpanded ? "Show less" : "Show more"}
        </Button>
      ) : null}
    </div>
  );
}

function UserMessageRoot({
  children,
  footer,
  onEdit,
  style,
}: UserMessageProps): React.ReactElement {
  const beginEdit = (event: React.MouseEvent<HTMLDivElement>): void => {
    if (onEdit === undefined) return;
    const selection = window.getSelection();
    if (selection !== null && !selection.isCollapsed) return;
    const interactive =
      event.target instanceof Element
        ? event.target.closest("button, a, input, textarea, select, [role='button']")
        : null;
    if (interactive !== null) return;
    onEdit();
  };

  return (
    <div {...stylex.props(styles.row)}>
      <div
        data-message-bubble="user"
        data-message-bubble-surface=""
        {...(onEdit === undefined
          ? {}
          : {
              onClick: beginEdit,
            })}
        {...applyStyle(
          stylex.props(styles.bubble, onEdit !== undefined && styles.editableBubble),
          style,
        )}
      >
        <div {...stylex.props(styles.content)}>
          {children}
          {footer != null && <div {...stylex.props(styles.footer)}>{footer}</div>}
        </div>
      </div>
    </div>
  );
}

const UserMessage = Object.assign(UserMessageRoot, { Preview: UserMessagePreview });

export { UserMessage };
export type { UserMessagePreviewProps, UserMessageProps };
