import * as stylex from "@stylexjs/stylex";
import { colorVars, controlVars } from "@honk/ui/tokens.stylex";
import * as React from "react";

import { useHonkDesktopPanes } from "./runtime";
import type { HonkDesktopPaneContribution } from "./sdk";

const PANE_KEYBOARD_RESIZE_STEP = 8;

const styles = stylex.create({
  root: {
    width: "100%",
    minWidth: 0,
    minHeight: 0,
    flexGrow: 1,
    display: "flex",
    overflow: "hidden",
  },
  content: {
    minWidth: 0,
    minHeight: 0,
    flexGrow: 1,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  pane: {
    position: "relative",
    minWidth: 0,
    minHeight: 0,
    flexGrow: 0,
    flexShrink: 0,
    display: "flex",
    flexDirection: "column",
    overflow: "hidden",
  },
  resizeHandle: {
    position: "absolute",
    insetBlock: 0,
    width: "8px",
    borderStyle: "none",
    padding: 0,
    backgroundColor: "transparent",
    cursor: "col-resize",
    touchAction: "none",
    outlineColor: colorVars["--honk-color-accent"],
    outlineStyle: { default: "none", ":focus-visible": "solid" },
    outlineWidth: controlVars["--honk-control-focus-ring-width"],
    outlineOffset: "-2px",
  },
  resizeHandleLeft: {
    right: 0,
  },
  resizeHandleRight: {
    left: 0,
  },
});

const dynamic = stylex.create({
  paneSize: (size: number) => ({
    width: `${size}px`,
    flexBasis: `${size}px`,
  }),
});

function HonkDesktopExtensionLayout({
  children,
}: {
  readonly children: React.ReactNode;
}): React.ReactElement {
  const panes = useHonkDesktopPanes().filter((pane) => pane.isOpen);
  const left = panes.filter((pane) => pane.side === "left");
  const right = panes.filter((pane) => pane.side === "right");

  return (
    <div {...stylex.props(styles.root)}>
      {left.map((pane) => (
        <ExtensionPane key={pane.key} pane={pane} />
      ))}
      <div {...stylex.props(styles.content)}>{children}</div>
      {right.map((pane) => (
        <ExtensionPane key={pane.key} pane={pane} />
      ))}
    </div>
  );
}

function ExtensionPane({
  pane,
}: {
  readonly pane: HonkDesktopPaneContribution;
}): React.ReactElement {
  const resizeSession = React.useRef<{
    readonly pointerId: number;
    readonly originX: number;
    readonly initialSize: number;
  } | null>(null);

  return (
    <section
      aria-label={pane.extension.name}
      data-honk-desktop-pane={pane.key}
      {...stylex.props(styles.pane, dynamic.paneSize(pane.size))}
    >
      {pane.render()}
      {pane.resizable ? (
        <div
          role="separator"
          aria-label={`Resize ${pane.extension.name}`}
          aria-orientation="vertical"
          aria-valuemin={pane.minSize}
          aria-valuemax={pane.maxSize}
          aria-valuenow={pane.size}
          tabIndex={0}
          onKeyDown={(event) => {
            const direction = pane.side === "left" ? 1 : -1;
            if (event.key === "ArrowLeft") {
              event.preventDefault();
              pane.controller.resize(pane.size - PANE_KEYBOARD_RESIZE_STEP * direction);
            } else if (event.key === "ArrowRight") {
              event.preventDefault();
              pane.controller.resize(pane.size + PANE_KEYBOARD_RESIZE_STEP * direction);
            } else if (event.key === "Home") {
              event.preventDefault();
              pane.controller.resize(pane.minSize);
            } else if (event.key === "End") {
              event.preventDefault();
              pane.controller.resize(pane.maxSize);
            }
          }}
          onPointerDown={(event) => {
            if (event.button !== 0) {
              return;
            }
            resizeSession.current = {
              pointerId: event.pointerId,
              originX: event.clientX,
              initialSize: pane.size,
            };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            const session = resizeSession.current;
            if (session === null || session.pointerId !== event.pointerId) {
              return;
            }
            const delta =
              pane.side === "left"
                ? event.clientX - session.originX
                : session.originX - event.clientX;
            pane.controller.resize(session.initialSize + delta);
          }}
          onPointerUp={(event) => {
            if (resizeSession.current?.pointerId !== event.pointerId) {
              return;
            }
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.currentTarget.releasePointerCapture(event.pointerId);
            }
            resizeSession.current = null;
          }}
          onPointerCancel={(event) => {
            if (resizeSession.current?.pointerId !== event.pointerId) {
              return;
            }
            if (event.currentTarget.hasPointerCapture(event.pointerId)) {
              event.currentTarget.releasePointerCapture(event.pointerId);
            }
            resizeSession.current = null;
          }}
          {...stylex.props(
            styles.resizeHandle,
            pane.side === "left" ? styles.resizeHandleLeft : styles.resizeHandleRight,
          )}
        />
      ) : null}
    </section>
  );
}

export { HonkDesktopExtensionLayout };
