// The user message — the ONLY bubbled element in the app (locked.html §5: "User messages are
// the only bubbled element in the app" — the one hard law of the thread surface; assistant
// output never routes through here). Anatomy and every value ported exactly from honkkit's
// ConversationBubble user branch (packages/honkkit/src/conversation-bubble.tsx: userRow /
// userBubble / userContent / userFooter) + its surface CSS (packages/honkkit/src/styles.css
// [data-message-bubble-surface]):
//   • the row justifies flex-end but the bubble is width:100% — right-alignment is latent, the
//     bubble spans the full timeline column today (recon memo §2 / locked-law delta 7);
//   • surface: 12px radius, elevated bubble background, and an ::after INSET RING (1px,
//     stroke-tertiary in light / stroke-secondary in dark — carried inside the ring token),
//     never a border;
//   • content: 10px/8px padding, 6px column gap, 13px text on the app window's inherited 16px
//     leading (shell.css .agent-window line-height = 13px + 3px) — the user bubble does NOT
//     take the 18px conversation leading.
//
// Editing stays caller-owned. Long-text preview is a compound child because it must clip only the
// prompt text, never attachments or the footer. It measures through a callback-ref ResizeObserver
// (no lifecycle effect) and keeps only its disclosure state locally.

import * as stylex from "@stylexjs/stylex";
import * as React from "react";

import { Button } from "./button";
import { colorVars, conversationVars, fontVars, radiusVars } from "./tokens.stylex";

// ── Bubble anatomy (non-tokenized intrinsics, justified per the stylex skill) ──────────────
// The app's exact interior numbers, private to this component — promote to tokens only when a
// second consumer appears (tabs.tsx precedent).
const BUBBLE_PAD_X = "10px"; // px-2.5 on userContent (conversation-bubble.tsx call site)
const BUBBLE_PAD_Y = "8px"; // py-2 on userContent
const BUBBLE_CONTENT_GAP = "6px"; // userContent's --honk-spacing-1-5 column gap
const BUBBLE_FOOTER_GAP = "4px"; // userFooter's --honk-spacing-1 margin-top
const RING_WIDTH = "1px"; // the inset ring is a hairline, like shell.tsx's HAIRLINE_WIDTH

// Cursor's UserMessageBox measurements, recovered from workbench.desktop.main.js: four 18px
// conversation lines collapse at 72px, expansion scrolls after 300px, and scroll edges fade over
// 16px. These are component mechanics, not shared design values, so they stay named intrinsics.
const PREVIEW_COLLAPSED_HEIGHT = 72;
const PREVIEW_EXPANDED_MAX_HEIGHT = 300;
const PREVIEW_SCROLL_EPSILON = 1;
const PREVIEW_FADE_SIZE = "16px";
const PREVIEW_COLLAPSED_MASK = "linear-gradient(to bottom, black 65%, transparent 100%)";
const PREVIEW_BOTTOM_MASK = `linear-gradient(to bottom, black 0, black calc(100% - ${PREVIEW_FADE_SIZE}), transparent 100%)`;
const PREVIEW_BOTH_MASK =
  `linear-gradient(to bottom, transparent 0, black ${PREVIEW_FADE_SIZE}, ` +
  `black calc(100% - ${PREVIEW_FADE_SIZE}), transparent 100%)`;
const PREVIEW_TOP_MASK = `linear-gradient(to bottom, transparent 0, black ${PREVIEW_FADE_SIZE}, black 100%)`;

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
    // The ring is an ::after inset box-shadow, never a border (styles.css
    // [data-message-bubble-surface]::after; menu-styles exemplar names this the pattern).
    "::after": {
      content: '""',
      position: "absolute",
      inset: 0,
      borderRadius: "inherit",
      boxShadow: `inset 0 0 0 ${RING_WIDTH} ${colorVars["--honk-color-message-bubble-ring"]}`,
      pointerEvents: "none",
    },
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
    fontSize: fontVars["--honk-text-title"],
    // leading-body = 16px: the .agent-window inherited leading, NOT the conversation 18px.
    lineHeight: fontVars["--honk-leading-body"],
    color: colorVars["--honk-color-fg"],
    overflowWrap: "anywhere", // break-words wrap-anywhere on the app's body text
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
    WebkitMaskImage: PREVIEW_COLLAPSED_MASK,
    maskImage: PREVIEW_COLLAPSED_MASK,
  },
  previewExpanded: {
    maxHeight: PREVIEW_EXPANDED_MAX_HEIGHT,
    overflowY: "auto",
  },
  previewFadeBottom: {
    WebkitMaskImage: PREVIEW_BOTTOM_MASK,
    maskImage: PREVIEW_BOTTOM_MASK,
  },
  previewFadeBoth: {
    WebkitMaskImage: PREVIEW_BOTH_MASK,
    maskImage: PREVIEW_BOTH_MASK,
  },
  previewFadeTop: {
    WebkitMaskImage: PREVIEW_TOP_MASK,
    maskImage: PREVIEW_TOP_MASK,
  },
  previewContent: {
    minWidth: 0,
  },
  previewToggle: {
    alignSelf: "flex-end",
    marginBlockStart: conversationVars["--honk-conversation-row-gap"],
  },
});

interface UserMessageProps {
  children?: React.ReactNode;
  // Below-the-text slot: the app puts turn-failure StatusNotice rows here.
  footer?: React.ReactNode | undefined;
  // Caller override on the bubble surface, merged last (charter merge order).
  xstyle?: stylex.StyleXStyles;
}

interface UserMessagePreviewProps {
  children?: React.ReactNode;
  xstyle?: stylex.StyleXStyles;
}

type PreviewScrollEdge = "start" | "middle" | "end";

function previewScrollEdge(viewport: HTMLDivElement): PreviewScrollEdge {
  if (viewport.scrollTop <= PREVIEW_SCROLL_EPSILON) {
    return "start";
  }
  if (
    viewport.scrollTop + viewport.clientHeight >=
    viewport.scrollHeight - PREVIEW_SCROLL_EPSILON
  ) {
    return "end";
  }
  return "middle";
}

function UserMessagePreview({ children, xstyle }: UserMessagePreviewProps): React.ReactElement {
  const [isExpanded, setExpanded] = React.useState(false);
  const [isCollapsible, setCollapsible] = React.useState(false);
  const [hasExpandedOverflow, setExpandedOverflow] = React.useState(false);
  const [scrollEdge, setScrollEdge] = React.useState<PreviewScrollEdge>("start");
  const viewportRef = React.useRef<HTMLDivElement | null>(null);
  const previewId = React.useId();

  const contentRef: React.RefCallback<HTMLDivElement> = (node) => {
    if (node === null) {
      return;
    }

    const measure = (): void => {
      const contentHeight = node.scrollHeight;
      setCollapsible(contentHeight > PREVIEW_COLLAPSED_HEIGHT);
      setExpandedOverflow(contentHeight > PREVIEW_EXPANDED_MAX_HEIGHT);
    };
    measure();
    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(measure);
      observer.observe(node);
      return () => {
        observer.disconnect();
      };
    }
  };

  const expandedFade =
    scrollEdge === "start"
      ? styles.previewFadeBottom
      : scrollEdge === "end"
        ? styles.previewFadeTop
        : styles.previewFadeBoth;

  return (
    <div data-user-message-preview="" {...stylex.props(styles.previewRoot, xstyle)}>
      <div
        id={previewId}
        ref={viewportRef}
        data-expanded={isExpanded ? "" : undefined}
        onScroll={(event) => {
          setScrollEdge(previewScrollEdge(event.currentTarget));
        }}
        {...stylex.props(
          styles.previewViewport,
          isExpanded ? styles.previewExpanded : styles.previewCollapsed,
          isExpanded && hasExpandedOverflow && expandedFade,
        )}
      >
        <div ref={contentRef} {...stylex.props(styles.previewContent)}>
          {children}
        </div>
      </div>
      {isCollapsible ? (
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={isExpanded}
          aria-controls={previewId}
          xstyle={styles.previewToggle}
          onClick={() => {
            if (viewportRef.current !== null) {
              viewportRef.current.scrollTop = 0;
            }
            setScrollEdge("start");
            setExpanded((current) => !current);
          }}
        >
          {isExpanded ? "Show less" : "Show more"}
        </Button>
      ) : null}
    </div>
  );
}

function UserMessageRoot({ children, footer, xstyle }: UserMessageProps): React.ReactElement {
  return (
    <div {...stylex.props(styles.row)}>
      <div
        // The app's DOM contract for the bubble surface (conversation-bubble.tsx); styling
        // here never reads it — it exists for tests and consumers.
        data-message-bubble="user"
        data-message-bubble-surface=""
        {...stylex.props(styles.bubble, xstyle)}
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
