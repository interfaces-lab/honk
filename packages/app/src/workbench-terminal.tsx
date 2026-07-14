// The Terminal panel — xterm.js over the desktop PTY bridge (window.desktopBridge.pty; the
// old terminal spoke the deleted Core's PTY-over-HTTP, this one rides new desktop IPC). One
// shell per panel lifetime, spawned in the thread's cwd; Restart kills and respawns. Off
// desktop (web build / old preload) the panel states the truth instead of a dead prompt.
//
// Lifecycle is the callback-ref idiom (ADR 0025, tabs.tsx precedent): React hands us the host
// element on mount and null on unmount; xterm + PTY + ResizeObserver live and die there. The
// xterm theme reads honk's tokens at attach time by resolving the token var() references
// against the live computed style — xterm needs concrete colors in JS, and this keeps the
// values identical to the CSS without duplicating a palette.

import * as stylex from "@stylexjs/stylex";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { Button, Text } from "@honk/ui";
import { colorVars, controlVars, fontVars, spaceVars } from "@honk/ui/tokens.stylex";
import * as React from "react";

import { getPtyBridge, type DesktopPtyBridge } from "./desktop-bridge";

const TERMINAL_FONT_SIZE = 12;
const TERMINAL_SCROLLBACK = 4000;

const styles = stylex.create({
  root: {
    flexGrow: 1,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
  },
  toolbar: {
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    gap: controlVars["--honk-control-gap"],
    paddingInline: spaceVars["--honk-space-gutter"],
    paddingBlock: controlVars["--honk-control-gap"],
  },
  cwd: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: colorVars["--honk-color-text-faint"],
    fontFamily: fontVars["--honk-font-family-mono"],
    fontSize: fontVars["--honk-font-size-caption"],
  },
  spacer: { flexGrow: 1 },
  host: {
    flexGrow: 1,
    minHeight: 0,
    paddingInline: controlVars["--honk-control-gap"],
    paddingBlockEnd: controlVars["--honk-control-gap"],
    boxSizing: "border-box",
  },
  center: {
    flexGrow: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: controlVars["--honk-control-gap"],
    padding: spaceVars["--honk-space-panel-pad"],
    textAlign: "center",
  },
});

// Resolve a StyleX token reference ("var(--x)") to its concrete computed value — xterm's theme
// is plain JS colors, so the tokens must be read off the live document once at attach.
function resolveToken(reference: string, fallback: string): string {
  const name = /var\((--[^),\s]+)/.exec(reference)?.[1];
  if (name === undefined) {
    return fallback;
  }
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value.length > 0 ? value : fallback;
}

type TerminalSession = {
  readonly terminal: Terminal;
  readonly fit: FitAddon;
  readonly observer: ResizeObserver;
  ptyId: string | null;
  disposed: boolean;
  readonly cleanups: (() => void)[];
};

function openSession(
  host: HTMLElement,
  bridge: DesktopPtyBridge,
  cwd: string,
  onExit: (code: number) => void,
): TerminalSession {
  const terminal = new Terminal({
    fontSize: TERMINAL_FONT_SIZE,
    fontFamily: resolveToken(String(fontVars["--honk-font-family-mono"]), "monospace"),
    scrollback: TERMINAL_SCROLLBACK,
    cursorBlink: true,
    theme: {
      background: resolveToken(String(colorVars["--honk-color-bg-base"]), "#ffffff"),
      foreground: resolveToken(String(colorVars["--honk-color-text-primary"]), "#000000"),
      cursor: resolveToken(String(colorVars["--honk-color-text-primary"]), "#000000"),
      selectionBackground: resolveToken(String(colorVars["--honk-color-layer-02"]), "#DCE2EA"),
    },
  });
  const fit = new FitAddon();
  terminal.loadAddon(fit);
  terminal.open(host);
  fit.fit();

  const session: TerminalSession = {
    terminal,
    fit,
    observer: new ResizeObserver(() => {
      if (session.disposed) {
        return;
      }
      fit.fit();
      if (session.ptyId !== null) {
        bridge.resize(session.ptyId, terminal.cols, terminal.rows);
      }
    }),
    ptyId: null,
    disposed: false,
    cleanups: [],
  };
  session.observer.observe(host);

  void bridge
    .open({ cwd, cols: terminal.cols, rows: terminal.rows })
    .then(({ id }) => {
      if (session.disposed) {
        bridge.close(id);
        return;
      }
      session.ptyId = id;
      session.cleanups.push(bridge.onData(id, (data) => terminal.write(data)));
      session.cleanups.push(bridge.onExit(id, onExit));
      const input = terminal.onData((data) => {
        bridge.write(id, data);
      });
      session.cleanups.push(() => input.dispose());
      // The observer may have fitted before the PTY existed — sync the real size once.
      bridge.resize(id, terminal.cols, terminal.rows);
    })
    .catch((error: unknown) => {
      terminal.writeln(
        `\x1b[31mFailed to start shell: ${error instanceof Error ? error.message : String(error)}\x1b[0m`,
      );
    });

  return session;
}

function disposeSession(session: TerminalSession, bridge: DesktopPtyBridge | null): void {
  session.disposed = true;
  session.observer.disconnect();
  for (const cleanup of session.cleanups) {
    cleanup();
  }
  if (session.ptyId !== null && bridge !== null) {
    bridge.close(session.ptyId);
  }
  session.terminal.dispose();
}

function WorkbenchTerminal({
  cwd,
  isVisible,
}: {
  readonly cwd: string;
  readonly isVisible: boolean;
}): React.ReactElement {
  const bridge = getPtyBridge();
  const sessionRef = React.useRef<TerminalSession | null>(null);
  const hostRef = React.useRef<HTMLElement | null>(null);
  const [exitCode, setExitCode] = React.useState<number | null>(null);
  // A hidden panel has zero size; re-fit when it becomes visible again.
  const lastVisibleRef = React.useRef(isVisible);
  if (isVisible && !lastVisibleRef.current) {
    requestAnimationFrame(() => sessionRef.current?.fit.fit());
  }
  lastVisibleRef.current = isVisible;

  const attachHost = React.useCallback(
    (element: HTMLDivElement | null): void => {
      if (element === null) {
        if (sessionRef.current !== null) {
          disposeSession(sessionRef.current, getPtyBridge());
          sessionRef.current = null;
        }
        hostRef.current = null;
        return;
      }
      hostRef.current = element;
      // Deferred one microtask: StrictMode's attach→detach→attach probe runs synchronously in
      // the commit, so opening here would spawn a shell (login scripts and all) that the probe
      // immediately orphans. After the microtask only the surviving attachment still matches.
      queueMicrotask(() => {
        const ptyBridge = getPtyBridge();
        if (hostRef.current !== element || ptyBridge === null || sessionRef.current !== null) {
          return;
        }
        sessionRef.current = openSession(element, ptyBridge, cwd, setExitCode);
      });
    },
    [cwd],
  );

  const restart = (): void => {
    const host = hostRef.current;
    const ptyBridge = getPtyBridge();
    if (host === null || ptyBridge === null) {
      return;
    }
    if (sessionRef.current !== null) {
      disposeSession(sessionRef.current, ptyBridge);
    }
    setExitCode(null);
    sessionRef.current = openSession(host, ptyBridge, cwd, setExitCode);
  };

  if (bridge === null) {
    return (
      <div {...stylex.props(styles.center)}>
        <Text as="p" size="sm" tone="muted" weight="medium">
          Terminal needs the desktop shell
        </Text>
        <Text as="p" size="xs" tone="faint">
          The PTY bridge lives in the Electron preload — the web build has no shell to offer.
        </Text>
      </div>
    );
  }

  return (
    <div {...stylex.props(styles.root)}>
      <div {...stylex.props(styles.toolbar)}>
        <span {...stylex.props(styles.cwd)}>{cwd}</span>
        <div {...stylex.props(styles.spacer)} />
        {exitCode !== null && (
          <Text as="span" size="xs" tone="faint" tabularNums>
            exited {exitCode}
          </Text>
        )}
        <Button size="sm" variant="ghost" onClick={restart}>
          Restart
        </Button>
      </div>
      <div ref={attachHost} {...stylex.props(styles.host)} />
    </div>
  );
}

export { WorkbenchTerminal };
