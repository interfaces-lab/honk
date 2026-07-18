// xterm.js over desktopBridge.pty. Callback-ref lifecycle: host mount/unmount owns the session.
// Theme resolves StyleX token var() refs from computed style because xterm needs concrete JS colors.

import { create, props } from "@stylexjs/stylex";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal, type ITheme } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { Button, Text } from "@honk/ui";
import { colorVars, controlVars, fontVars, spaceVars } from "@honk/ui/tokens.stylex";
import { type ReactElement, useCallback, useRef, useState } from "react";

import { getSnapshot, subscribe } from "./appearance-store";
import { getPtyBridge, type DesktopPtyBridge } from "./desktop-bridge";
import { errorMessage } from "./error-message";
import terminalStyles from "./workbench-terminal.module.css";

const TERMINAL_SCROLLBACK = 4000;

const styles = create({
  root: {
    position: "relative",
    flexGrow: 1,
    minHeight: 0,
    display: "flex",
    flexDirection: "column",
    boxSizing: "border-box",
    padding: spaceVars["--honk-space-gutter"],
    color: colorVars["--honk-color-text-primary"],
    backgroundColor: colorVars["--honk-color-bg-deep"],
    fontFamily: fontVars["--honk-font-family-mono"],
  },
  recovery: {
    flexShrink: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: controlVars["--honk-control-gap"],
    paddingBlockEnd: spaceVars["--honk-space-gutter"],
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

function resolveComputedColor(probe: HTMLElement, reference: string): string {
  probe.style.color = reference;
  return getComputedStyle(probe).color;
}

function resolveTerminalTheme(host: HTMLElement): ITheme {
  const probe = document.createElement("span");
  host.append(probe);
  const theme = {
    background: resolveComputedColor(probe, String(colorVars["--honk-color-bg-deep"])),
    foreground: resolveComputedColor(probe, String(colorVars["--honk-color-text-primary"])),
    cursor: resolveComputedColor(probe, String(colorVars["--honk-color-accent"])),
    cursorAccent: resolveComputedColor(probe, String(colorVars["--honk-color-bg-deep"])),
    selectionBackground: resolveComputedColor(
      probe,
      String(colorVars["--honk-color-terminal-selection"]),
    ),
    selectionInactiveBackground: resolveComputedColor(
      probe,
      String(colorVars["--honk-color-control-selected"]),
    ),
    scrollbarSliderBackground: resolveComputedColor(
      probe,
      String(colorVars["--honk-color-border-base"]),
    ),
    scrollbarSliderHoverBackground: resolveComputedColor(
      probe,
      String(colorVars["--honk-color-border-strong"]),
    ),
    scrollbarSliderActiveBackground: resolveComputedColor(
      probe,
      String(colorVars["--honk-color-text-faint"]),
    ),
    black: resolveComputedColor(probe, String(colorVars["--honk-color-terminal-black"])),
    red: resolveComputedColor(probe, String(colorVars["--honk-color-terminal-red"])),
    green: resolveComputedColor(probe, String(colorVars["--honk-color-terminal-green"])),
    yellow: resolveComputedColor(probe, String(colorVars["--honk-color-terminal-yellow"])),
    blue: resolveComputedColor(probe, String(colorVars["--honk-color-terminal-blue"])),
    magenta: resolveComputedColor(probe, String(colorVars["--honk-color-terminal-magenta"])),
    cyan: resolveComputedColor(probe, String(colorVars["--honk-color-terminal-cyan"])),
    white: resolveComputedColor(probe, String(colorVars["--honk-color-terminal-white"])),
    brightBlack: resolveComputedColor(
      probe,
      String(colorVars["--honk-color-terminal-bright-black"]),
    ),
    brightRed: resolveComputedColor(probe, String(colorVars["--honk-color-terminal-bright-red"])),
    brightGreen: resolveComputedColor(
      probe,
      String(colorVars["--honk-color-terminal-bright-green"]),
    ),
    brightYellow: resolveComputedColor(
      probe,
      String(colorVars["--honk-color-terminal-bright-yellow"]),
    ),
    brightBlue: resolveComputedColor(probe, String(colorVars["--honk-color-terminal-bright-blue"])),
    brightMagenta: resolveComputedColor(
      probe,
      String(colorVars["--honk-color-terminal-bright-magenta"]),
    ),
    brightCyan: resolveComputedColor(probe, String(colorVars["--honk-color-terminal-bright-cyan"])),
    brightWhite: resolveComputedColor(
      probe,
      String(colorVars["--honk-color-terminal-bright-white"]),
    ),
  };
  probe.remove();
  return theme;
}

type TerminalSession = {
  readonly terminal: Terminal;
  readonly fit: FitAddon;
  readonly observer: ResizeObserver;
  readonly ptyId: string;
  disposed: boolean;
  readonly cleanups: (() => void)[];
};

type TerminalRecovery =
  | { readonly status: "failed" }
  | { readonly status: "exited"; readonly code: number };

function openSession(
  host: HTMLElement,
  bridge: DesktopPtyBridge,
  cwd: string,
  fontSize: number,
  onExit: (code: number) => void,
  onFailure: () => void,
): TerminalSession {
  const terminal = new Terminal({
    fontSize,
    fontFamily: getComputedStyle(host).fontFamily,
    scrollback: TERMINAL_SCROLLBACK,
    cursorBlink: true,
    theme: resolveTerminalTheme(host),
  });
  const fit = new FitAddon();
  terminal.loadAddon(fit);
  terminal.open(host);
  fit.fit();

  const ptyId = `pty_${crypto.randomUUID()}`;
  const session: TerminalSession = {
    terminal,
    fit,
    observer: new ResizeObserver(() => {
      if (session.disposed) {
        return;
      }
      fit.fit();
    }),
    ptyId,
    disposed: false,
    cleanups: [],
  };
  const resize = terminal.onResize(({ cols, rows }) => {
    if (!session.disposed) bridge.resize(ptyId, cols, rows);
  });
  const input = terminal.onData((data) => {
    if (!session.disposed) bridge.write(ptyId, data);
  });
  session.cleanups.push(
    bridge.onData(ptyId, (data) => {
      if (!session.disposed) terminal.write(data);
    }),
    bridge.onExit(ptyId, (code) => {
      if (!session.disposed) onExit(code);
    }),
    () => resize.dispose(),
    () => input.dispose(),
    subscribe(() => {
      if (!session.disposed) {
        syncTerminalAppearance(session, host, getSnapshot().codeFontSize);
      }
    }),
  );
  session.observer.observe(host);

  void bridge
    .open({ id: ptyId, cwd, cols: terminal.cols, rows: terminal.rows })
    .then(() => {
      if (session.disposed) {
        bridge.close(ptyId);
      }
    })
    .catch((error: unknown) => {
      if (!session.disposed) {
        terminal.writeln(`\x1b[31mFailed to start shell: ${errorMessage(error)}\x1b[0m`);
        onFailure();
      }
    });

  return session;
}

function syncTerminalAppearance(
  session: TerminalSession,
  host: HTMLElement,
  fontSize: number,
): void {
  session.terminal.options.fontSize = fontSize;
  session.terminal.options.fontFamily = getComputedStyle(host).fontFamily;
  session.terminal.options.theme = resolveTerminalTheme(host);
  session.fit.fit();
}

function disposeSession(session: TerminalSession, bridge: DesktopPtyBridge | null): void {
  session.disposed = true;
  session.observer.disconnect();
  for (const cleanup of session.cleanups) {
    cleanup();
  }
  if (bridge !== null) {
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
}): ReactElement {
  const bridge = getPtyBridge();
  const sessionRef = useRef<TerminalSession | null>(null);
  const hostRef = useRef<HTMLElement | null>(null);
  const [recovery, setRecovery] = useState<TerminalRecovery | null>(null);

  // Ref identity owns the PTY lifetime, so this callback must survive visibility rerenders.
  const attachHost = useCallback(
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
        sessionRef.current = openSession(
          element,
          ptyBridge,
          cwd,
          getSnapshot().codeFontSize,
          (code) => setRecovery({ status: "exited", code }),
          () => setRecovery({ status: "failed" }),
        );
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
    setRecovery(null);
    sessionRef.current = openSession(
      host,
      ptyBridge,
      cwd,
      getSnapshot().codeFontSize,
      (code) => setRecovery({ status: "exited", code }),
      () => setRecovery({ status: "failed" }),
    );
  };

  if (bridge === null) {
    return (
      <div {...props(styles.center)}>
        <Text as="p" size="sm" tone="muted" weight="regular">
          Terminal needs the desktop shell
        </Text>
        <Text as="p" size="xs" tone="faint">
          The PTY bridge lives in the Electron preload — the web build has no shell to offer.
        </Text>
      </div>
    );
  }

  return (
    <div aria-hidden={!isVisible} {...props(styles.root)}>
      {recovery !== null ? (
        <div aria-live="polite" {...props(styles.recovery)}>
          <Text as="span" size="xs" tone="faint" tabularNums>
            {recovery.status === "failed"
              ? "Terminal failed to start"
              : `Process exited with code ${recovery.code}`}
          </Text>
          <Button size="sm" variant="quiet" onClick={restart}>
            Restart
          </Button>
        </div>
      ) : null}
      <div ref={attachHost} className={terminalStyles.host} />
    </div>
  );
}

export { WorkbenchTerminal };
