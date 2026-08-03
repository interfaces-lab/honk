// Shared floating tray anatomy. Placement stays with the caller; chrome and scrolling live here.

import { create, props } from "@stylexjs/stylex";
import {
  useState,
  type ComponentProps,
  type ReactElement,
  type ReactNode,
  type UIEvent,
} from "react";

import {
  borderVars,
  colorVars,
  controlVars,
  elevationVars,
  fontVars,
  radiusVars,
  spaceVars,
  workbenchSurfaceVars,
} from "./tokens.stylex";
import { INITIAL_SCROLL_EDGES, trayScrollEdges } from "./tray-scroll";

const EDGE_FADE_EXTENT = `calc(${spaceVars["--honk-space-gutter"]} * 3)`;
const DEFAULT_TRAY_MAX_HEIGHT = 220;
const CONVERSATION_TRAY_MIN_WIDTH = "150px";
const TRAY_RING = `inset 0 0 0 ${borderVars["--honk-border-hairline"]} var(--_tray-ring-color)`;

const styles = create({
  root: {
    "--_tray-ring-color": colorVars["--honk-color-stroke-secondary"],
    position: "relative",
    isolation: "isolate",
    boxSizing: "border-box",
    minWidth: 0,
    minHeight: 0,
    width: "100%",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
    borderRadius: radiusVars["--honk-radius-window"],
    backgroundColor: colorVars["--honk-color-bg-base"],
    boxShadow: elevationVars["--honk-elevation-workbench"],
    color: colorVars["--honk-color-text-primary"],
    fontFamily: fontVars["--honk-font-family-ui"],
    fontSize: fontVars["--honk-font-size-body"],
    lineHeight: fontVars["--honk-leading-body"],
    "::after": {
      content: '""',
      position: "absolute",
      inset: 0,
      zIndex: 2,
      borderRadius: "inherit",
      boxShadow: TRAY_RING,
      pointerEvents: "none",
    },
  },
  rootConversation: {
    "--_tray-ring-color": {
      default: workbenchSurfaceVars["--honk-workbench-input-border"],
      ":hover": {
        "@media (hover: hover)": workbenchSurfaceVars["--honk-workbench-input-border-active"],
      },
      ":focus-within": workbenchSurfaceVars["--honk-workbench-input-border-active"],
    },
    minWidth: CONVERSATION_TRAY_MIN_WIDTH,
    borderRadius: radiusVars["--honk-radius-bubble"],
    backgroundColor: workbenchSurfaceVars["--honk-workbench-input-background"],
    boxShadow: "none",
  },
  rootEmbedded: {
    borderRadius: 0,
    boxShadow: "none",
    "::after": {
      boxShadow: "none",
    },
  },
  rootUnbounded: {
    "--_tray-scroll-max-height": "none",
  },
  header: {
    boxSizing: "border-box",
    minWidth: 0,
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: controlVars["--honk-control-gap"],
    paddingBlockStart: spaceVars["--honk-space-gutter"],
    paddingBlockEnd: spaceVars["--honk-space-gutter"],
    paddingInline: spaceVars["--honk-space-panel-pad"],
  },
  headerRowsExpanded: {
    paddingBlockEnd: 0,
  },
  headerSummary: {
    paddingBlockStart: 0,
    paddingBlockEnd: 0,
    paddingInline: 0,
  },
  scrollArea: {
    position: "relative",
    minWidth: 0,
    minHeight: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: "auto",
    maxHeight: "var(--_tray-scroll-max-height)",
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  scroller: {
    minWidth: 0,
    minHeight: 0,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: "auto",
    overflowY: "auto",
    overscrollBehavior: "contain",
    outlineColor: colorVars["--honk-color-accent"],
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineWidth: controlVars["--honk-control-focus-ring-width"],
    outlineOffset: `calc(${controlVars["--honk-control-focus-ring-offset"]} * -1)`,
  },
  content: {
    boxSizing: "border-box",
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: spaceVars["--honk-space-gutter"],
    paddingBlock: `calc(${controlVars["--honk-control-menu-pad"]} / 2)`,
    paddingInline: spaceVars["--honk-space-panel-pad"],
  },
  contentBlockInset: {
    paddingInline: 0,
  },
  footer: {
    boxSizing: "border-box",
    minWidth: 0,
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: spaceVars["--honk-space-gutter"],
    paddingBlockStart: controlVars["--honk-control-menu-pad"],
    paddingBlockEnd: `calc(${spaceVars["--honk-space-panel-pad"]} / 2)`,
    paddingInline: spaceVars["--honk-space-panel-pad"],
    borderTopWidth: borderVars["--honk-border-hairline"],
    borderTopStyle: "solid",
    borderTopColor: colorVars["--honk-color-border-muted"],
  },
  footerUndivided: {
    borderTopWidth: 0,
  },
});

const dynamicStyles = create({
  scrollMask: (maskImage: string) => ({ maskImage }),
  scrollAreaMaxHeight: (px: number) => ({
    "--_tray-scroll-max-height": `${String(px)}px`,
  }),
});

interface TrayRootProps extends Omit<
  ComponentProps<"section">,
  "aria-label" | "className" | "style"
> {
  "aria-label": string;
  // Null lets the scroll region consume the tray's available height.
  maxHeight?: number | null;
  surface?: "floating" | "conversation" | "embedded";
}

interface TrayHeaderProps extends Omit<ComponentProps<"header">, "className" | "style"> {
  children?: ReactNode;
  density?: "default" | "summary";
  rowsExpanded?: boolean;
}

interface TrayScrollAreaProps extends Omit<
  ComponentProps<"div">,
  "aria-label" | "children" | "className" | "onScroll" | "ref" | "role" | "style" | "tabIndex"
> {
  "aria-label": string;
  children?: ReactNode;
  inset?: "all" | "block";
  onScrollerElement?: (element: HTMLDivElement | null) => void;
}

interface TrayFooterProps extends Omit<ComponentProps<"footer">, "className" | "style"> {
  children?: ReactNode;
  divided?: boolean;
}

function TrayRoot({
  children,
  maxHeight = DEFAULT_TRAY_MAX_HEIGHT,
  surface = "floating",
  ...rest
}: TrayRootProps): ReactElement {
  return (
    <section
      {...rest}
      data-slot="tray"
      {...props(
        styles.root,
        surface === "conversation" && styles.rootConversation,
        surface === "embedded" && styles.rootEmbedded,
        maxHeight === null ? styles.rootUnbounded : dynamicStyles.scrollAreaMaxHeight(maxHeight),
      )}
    >
      {children}
    </section>
  );
}

function TrayHeader({
  children,
  density = "default",
  rowsExpanded = false,
  ...rest
}: TrayHeaderProps): ReactElement {
  return (
    <header
      {...rest}
      data-slot="tray-header"
      {...props(
        styles.header,
        rowsExpanded && styles.headerRowsExpanded,
        density === "summary" && styles.headerSummary,
      )}
    >
      {children}
    </header>
  );
}

function TrayScrollArea({
  "aria-label": ariaLabel,
  children,
  inset = "all",
  onScrollerElement,
  ...rest
}: TrayScrollAreaProps): ReactElement {
  const [edges, setEdges] = useState(INITIAL_SCROLL_EDGES);

  const publish = (element: HTMLDivElement): void => {
    const maxScroll = Math.max(0, element.scrollHeight - element.clientHeight);
    const next = trayScrollEdges(element.scrollTop, maxScroll);
    setEdges((current) =>
      current.startOpacity === next.startOpacity && current.endOpacity === next.endOpacity
        ? current
        : next,
    );
  };

  const scrollerRef = (element: HTMLDivElement | null): (() => void) | undefined => {
    onScrollerElement?.(element);
    if (element === null) return;

    const content = element.firstElementChild;
    let frame = 0;
    const schedule = (): void => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        publish(element);
      });
    };
    const resizeObserver =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    resizeObserver?.observe(element);
    if (content !== null) resizeObserver?.observe(content);
    publish(element);

    return () => {
      cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      onScrollerElement?.(null);
    };
  };

  const isOverflowing = edges.startOpacity > 0 || edges.endOpacity > 0;
  // Mask alpha only: Cursor fades the first and last 24px of overflowing tray content.
  const scrollMask = `linear-gradient(to bottom, rgba(0, 0, 0, ${String(
    1 - edges.startOpacity,
  )}) 0px, black ${EDGE_FADE_EXTENT}, black calc(100% - ${EDGE_FADE_EXTENT}), rgba(0, 0, 0, ${String(
    1 - edges.endOpacity,
  )}) 100%)`;
  const onScroll = (event: UIEvent<HTMLDivElement>): void => {
    publish(event.currentTarget);
  };

  return (
    <div {...props(styles.scrollArea)}>
      <div
        {...rest}
        ref={scrollerRef}
        role="region"
        aria-label={ariaLabel}
        tabIndex={isOverflowing ? 0 : undefined}
        onScroll={onScroll}
        {...props(styles.scroller, dynamicStyles.scrollMask(scrollMask))}
      >
        <div {...props(styles.content, inset === "block" && styles.contentBlockInset)}>
          {children}
        </div>
      </div>
    </div>
  );
}

function TrayFooter({ children, divided = true, ...rest }: TrayFooterProps): ReactElement {
  return (
    <footer
      {...rest}
      data-slot="tray-footer"
      {...props(styles.footer, !divided && styles.footerUndivided)}
    >
      {children}
    </footer>
  );
}

const Tray = Object.assign(TrayRoot, {
  Header: TrayHeader,
  ScrollArea: TrayScrollArea,
  Footer: TrayFooter,
});

export { Tray };
export type { TrayFooterProps, TrayHeaderProps, TrayRootProps, TrayScrollAreaProps };
