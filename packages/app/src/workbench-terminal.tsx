// ghostty-web over desktopBridge.pty. Terminal IDs own sessions; mounts only reparent their wrappers.
// Theme resolves StyleX token var() refs from computed style because Ghostty needs concrete JS colors.

import { create, props } from "@stylexjs/stylex";
import type { TerminalSessionSnapshot } from "@honk/shared/terminal";
import type { FitAddon, Ghostty, ITheme, Terminal } from "ghostty-web";
import { Button, Text } from "@honk/ui";
import { colorVars, controlVars, fontVars, spaceVars } from "@honk/ui/tokens.stylex";
import { type ReactElement, useEffect, useRef, useState } from "react";

import { getSnapshot, subscribe } from "./appearance-store";
import { getPtyBridge, type DesktopPtyBridge } from "./desktop-bridge";
import { errorMessage } from "./error-message";
import { readResolvedTheme, useResolvedTheme } from "./lib/use-resolved-theme";
import terminalStyles from "./workbench-terminal.module.css";

const TERMINAL_SCROLLBACK = 10_000;

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
  terminalArea: {
    position: "relative",
    flexGrow: 1,
    minHeight: 0,
  },
  hostContainer: {
    position: "absolute",
    inset: 0,
    overflow: "hidden",
  },
  scroller: {
    position: "absolute",
    insetBlock: 0,
    insetInlineEnd: 0,
    width: spaceVars["--honk-space-panel-pad"],
    overflowX: "hidden",
    overflowY: "auto",
  },
  scrollSpacer: {
    width: "100%",
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

let sharedGhostty: Promise<{
  readonly module: typeof import("ghostty-web");
  readonly ghostty: Ghostty;
}> | null = null;

function loadGhostty(): Promise<{
  readonly module: typeof import("ghostty-web");
  readonly ghostty: Ghostty;
}> {
  if (sharedGhostty !== null) return sharedGhostty;
  sharedGhostty = import("ghostty-web")
    .then(async (module) => ({ module, ghostty: await module.Ghostty.load() }))
    .catch((error: unknown) => {
      sharedGhostty = null;
      throw error;
    });
  return sharedGhostty;
}

// Ghostty parses every theme slot with parseColorToHex, which accepts only "#rrggbb" and comma-form
// "rgb()" and returns 0 (pure black) for anything else — while getComputedStyle serializes our hex8
// tokens as "rgba(...)". Flatten alpha onto `over` so translucent tokens cannot render as black.
function resolveComputedColor(
  probe: HTMLElement,
  reference: string,
  over: readonly number[],
): string {
  probe.style.color = reference;
  const channels = (getComputedStyle(probe).color.match(/[\d.]+/g) ?? []).map(Number);
  const alpha = channels[3] ?? 1;
  return `#${[0, 1, 2]
    .map((index) =>
      Math.round((channels[index] ?? 0) * alpha + (over[index] ?? 0) * (1 - alpha))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

function resolveTerminalTheme(host: HTMLElement): ITheme {
  const probe = document.createElement("span");
  host.append(probe);
  const background = resolveComputedColor(
    probe,
    String(colorVars["--honk-color-bg-deep"]),
    [0, 0, 0],
  );
  // The renderer fills each line with `background` before painting cell backgrounds, so flattening
  // against it reproduces exactly what a translucent slot would have blended to.
  const base = [1, 3, 5].map((offset) => Number.parseInt(background.slice(offset, offset + 2), 16));
  const slot = (reference: string): string => resolveComputedColor(probe, reference, base);
  // Terminal text owns its own token: chrome's text-primary carries an alpha the terminal must not
  // see. The accent-colored cursor is a deliberate Honk deviation from Cursor's terminalCursor.
  const foreground = slot(String(colorVars["--honk-color-terminal-foreground"]));
  const theme = {
    background,
    foreground,
    cursor: slot(String(colorVars["--honk-color-accent"])),
    cursorAccent: background,
    selectionBackground: slot(String(colorVars["--honk-color-terminal-selection"])),
    // Ghostty replaces the glyph color of every selected cell with this; without it the library
    // default (#1e1e1e) paints near-invisible text in dark mode.
    selectionForeground: foreground,
    black: slot(String(colorVars["--honk-color-terminal-black"])),
    red: slot(String(colorVars["--honk-color-terminal-red"])),
    green: slot(String(colorVars["--honk-color-terminal-green"])),
    yellow: slot(String(colorVars["--honk-color-terminal-yellow"])),
    blue: slot(String(colorVars["--honk-color-terminal-blue"])),
    magenta: slot(String(colorVars["--honk-color-terminal-magenta"])),
    cyan: slot(String(colorVars["--honk-color-terminal-cyan"])),
    white: slot(String(colorVars["--honk-color-terminal-white"])),
    brightBlack: slot(String(colorVars["--honk-color-terminal-bright-black"])),
    brightRed: slot(String(colorVars["--honk-color-terminal-bright-red"])),
    brightGreen: slot(String(colorVars["--honk-color-terminal-bright-green"])),
    brightYellow: slot(String(colorVars["--honk-color-terminal-bright-yellow"])),
    brightBlue: slot(String(colorVars["--honk-color-terminal-bright-blue"])),
    brightMagenta: slot(String(colorVars["--honk-color-terminal-bright-magenta"])),
    brightCyan: slot(String(colorVars["--honk-color-terminal-bright-cyan"])),
    brightWhite: slot(String(colorVars["--honk-color-terminal-bright-white"])),
  } satisfies ITheme;
  probe.remove();
  return theme;
}

type TerminalSession = {
  readonly terminal: Terminal;
  readonly fit: FitAddon;
  readonly bridge: DesktopPtyBridge;
  readonly ptyId: string;
  disposed: boolean;
  readonly cleanups: (() => void)[];
};

type TerminalRecovery =
  | { readonly status: "failed" }
  | { readonly status: "exited"; readonly code: number | null };

type PersistentTerminal = {
  readonly wrapper: HTMLDivElement;
  session: TerminalSession | null;
  recovery: TerminalRecovery | null;
  startRequest: object | null;
  readonly recoveryListeners: Set<(recovery: TerminalRecovery | null) => void>;
};

type TerminalScrollBinding = {
  readonly sync: () => void;
  readonly dispose: () => void;
};

const persistentTerminals = new Map<string, PersistentTerminal>();

function getPersistentTerminal(terminalID: string): PersistentTerminal {
  const existing = persistentTerminals.get(terminalID);
  if (existing !== undefined) return existing;

  const wrapper = document.createElement("div");
  wrapper.dataset.component = "terminal";
  wrapper.tabIndex = -1;
  const hostClassName = terminalStyles.host;
  if (hostClassName === undefined) throw new Error("Missing terminal host class");
  wrapper.className = hostClassName;
  const terminal = {
    wrapper,
    session: null,
    recovery: null,
    startRequest: null,
    recoveryListeners: new Set<(recovery: TerminalRecovery | null) => void>(),
  } satisfies PersistentTerminal;
  persistentTerminals.set(terminalID, terminal);
  return terminal;
}

function setTerminalRecovery(
  terminal: PersistentTerminal,
  recovery: TerminalRecovery | null,
): void {
  terminal.recovery = recovery;
  terminal.recoveryListeners.forEach((listener) => listener(recovery));
}

function bindTerminalUi(host: HTMLElement, terminal: Terminal): () => void {
  const handleCopy = (event: ClipboardEvent): void => {
    const selection = terminal.getSelection();
    if (selection.length === 0 || event.clipboardData === null) return;
    event.preventDefault();
    event.clipboardData.setData("text/plain", selection);
  };
  const handlePaste = (event: ClipboardEvent): void => {
    const text = event.clipboardData?.getData("text/plain") ?? "";
    if (text.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    terminal.paste(text);
  };
  // Ghostty focuses the host itself on every canvas mousedown and again on a deferred task inside
  // `focus()`, so the host — not the hidden textarea — is the element that ends up focused. Track
  // blink on the whole subtree with focusin/focusout, otherwise the textarea's transient focus
  // leaves the caret permanently unblinking.
  const handlePointerDown = (): void => terminal.focus();
  const handleFocusIn = (): void => terminal.setOption("cursorBlink", true);
  const handleFocusOut = (event: FocusEvent): void => {
    if (event.relatedTarget instanceof Node && host.contains(event.relatedTarget)) return;
    terminal.setOption("cursorBlink", false);
  };

  host.addEventListener("copy", handleCopy, true);
  host.addEventListener("paste", handlePaste, true);
  host.addEventListener("pointerdown", handlePointerDown);
  host.addEventListener("focusin", handleFocusIn);
  host.addEventListener("focusout", handleFocusOut);

  return () => {
    host.removeEventListener("copy", handleCopy, true);
    host.removeEventListener("paste", handlePaste, true);
    host.removeEventListener("pointerdown", handlePointerDown);
    host.removeEventListener("focusin", handleFocusIn);
    host.removeEventListener("focusout", handleFocusOut);
  };
}

function bindTerminalScrollport(
  terminal: Terminal,
  scroller: HTMLDivElement,
  spacer: HTMLDivElement,
): TerminalScrollBinding {
  const sync = (): void => {
    const cellHeight = terminal.renderer?.getMetrics().height;
    if (cellHeight === undefined || cellHeight === 0 || scroller.clientHeight === 0) return;
    // Size the spacer as scrollback plus the scroller's own viewport, not the grid's rows: the
    // panel height carries a sub-cell remainder, and sizing by rows would leave the bottommost
    // position unreachable by exactly that remainder — which the scroll handler would then
    // misread as a user scroll and pin the terminal one line above the live output.
    const scrollbackLength = terminal.getScrollbackLength();
    const height = `${String(scrollbackLength * cellHeight + scroller.clientHeight)}px`;
    if (spacer.style.height !== height) spacer.style.height = height;
    const scrollTop = (scrollbackLength - terminal.viewportY) * cellHeight;
    // Half-cell tolerance: mid-drag the thumb sits between line positions, and snapping it to
    // cell multiples on every render makes dragging jitter. Real line changes always differ by
    // at least one full cell.
    if (Math.abs(scroller.scrollTop - scrollTop) >= cellHeight / 2) scroller.scrollTop = scrollTop;
  };
  const handleScroll = (): void => {
    const cellHeight = terminal.renderer?.getMetrics().height;
    if (cellHeight === undefined || cellHeight === 0) return;
    const scrollbackLength = terminal.getScrollbackLength();
    const expected = (scrollbackLength - terminal.viewportY) * cellHeight;
    if (Math.abs(scroller.scrollTop - expected) < cellHeight / 2) return;
    terminal.scrollToLine(scrollbackLength - Math.round(scroller.scrollTop / cellHeight));
  };
  const scroll = terminal.onScroll(sync);
  const render = terminal.onRender(sync);
  scroller.addEventListener("scroll", handleScroll);
  sync();
  return {
    sync,
    dispose: () => {
      scroll.dispose();
      render.dispose();
      scroller.removeEventListener("scroll", handleScroll);
    },
  };
}

function openSession(
  host: HTMLElement,
  bridge: DesktopPtyBridge,
  cwd: string,
  attached: TerminalSessionSnapshot | null,
  fontSize: number,
  colorScheme: () => "light" | "dark",
  module: typeof import("ghostty-web"),
  ghostty: Ghostty,
  onExit: (code: number | null) => void,
  onFailure: () => void,
): TerminalSession {
  const terminal = new module.Terminal({
    fontSize,
    fontFamily: getComputedStyle(host).fontFamily,
    scrollback: TERMINAL_SCROLLBACK,
    cursorBlink: true,
    cursorStyle: "bar",
    allowTransparency: false,
    colorScheme: colorScheme(),
    convertEol: false,
    theme: resolveTerminalTheme(host),
    ghostty,
  });
  // FitAddon always reserves 15px for Ghostty's canvas scrollbar. Keep that reservation for sizing,
  // but prevent the private reveal hook from raising its opacity because the DOM overlay owns it.
  (terminal as unknown as { showScrollbar: () => void }).showScrollbar = () => {};
  const fit = new module.FitAddon();
  terminal.loadAddon(fit);

  const activeElement = document.activeElement;
  terminal.open(host);
  fit.fit();
  fit.observeResize();

  // A main-owned background job already has an id the agent and the tab agree on.
  const ptyId = attached?.terminalId ?? `pty_${crypto.randomUUID()}`;
  const session: TerminalSession = {
    terminal,
    fit,
    bridge,
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
    bindTerminalUi(host, terminal),
    bridge.onData(ptyId, (data) => {
      if (!session.disposed) terminal.write(data);
    }),
    bridge.onExit(ptyId, (code) => {
      if (!session.disposed) onExit(code);
    }),
    () => resize.dispose(),
    () => input.dispose(),
    () => fit.dispose(),
    subscribe(() => {
      if (!session.disposed && host.isConnected) {
        syncTerminalAppearance(session, host, getSnapshot().codeFontSize, colorScheme());
      }
    }),
  );

  const restoreFocus = (): void => {
    const current = document.activeElement;
    if (current !== host && !host.contains(current)) return;
    terminal.blur();
    terminal.textarea?.blur();
    if (activeElement instanceof HTMLElement && activeElement.isConnected) activeElement.focus();
  };
  restoreFocus();
  const restoreFocusTimer = window.setTimeout(restoreFocus, 0);
  session.cleanups.push(() => window.clearTimeout(restoreFocusTimer));

  if (attached !== null) {
    // Adopt the running job instead of spawning: replay what main buffered while no
    // renderer was listening, then let it keep streaming on the same id.
    if (attached.history.length > 0) terminal.write(attached.history);
    bridge.resize(ptyId, terminal.cols, terminal.rows);
    if (attached.status === "exited") onExit(attached.exitCode);
    return session;
  }

  void bridge
    .open({ id: ptyId, cwd, cols: terminal.cols, rows: terminal.rows })
    .then(() => {
      if (session.disposed) {
        bridge.close(ptyId);
        return;
      }
      // The backend drops resizes for a session it has not opened yet, and FitAddon's debounced
      // re-fit routinely lands inside this window. Replay the current grid so the shell never keeps
      // a stale column count and wraps its prompt caret at the wrong width.
      bridge.resize(ptyId, terminal.cols, terminal.rows);
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
  colorScheme: "light" | "dark",
): void {
  session.terminal.setOption("fontSize", fontSize);
  session.terminal.setOption("fontFamily", getComputedStyle(host).fontFamily);
  session.terminal.setOption("theme", resolveTerminalTheme(host));
  session.terminal.setOption("colorScheme", colorScheme);
  session.fit.fit();
}

function disposeSession(session: TerminalSession): void {
  session.disposed = true;
  session.cleanups.forEach((cleanup) => cleanup());
  session.bridge.close(session.ptyId);
  session.terminal.dispose();
}

function disposeWorkbenchTerminal(terminalID: string): void {
  const terminal = persistentTerminals.get(terminalID);
  if (terminal === undefined) return;
  terminal.startRequest = null;
  if (terminal.session !== null) disposeSession(terminal.session);
  terminal.session = null;
  terminal.wrapper.remove();
  persistentTerminals.delete(terminalID);
}

function WorkbenchTerminal({
  cwd,
  isVisible,
  terminalID,
}: {
  readonly cwd: string;
  readonly isVisible: boolean;
  readonly terminalID: string;
}): ReactElement {
  const bridge = getPtyBridge();
  const resolvedTheme = useResolvedTheme();
  const terminalRef = useRef<PersistentTerminal | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const spacerRef = useRef<HTMLDivElement | null>(null);
  const scrollBindingRef = useRef<TerminalScrollBinding | null>(null);
  const recoveryCleanupRef = useRef<(() => void) | null>(null);
  const [recovery, setRecovery] = useState<TerminalRecovery | null>(
    () => persistentTerminals.get(terminalID)?.recovery ?? null,
  );

  const bindScrollport = (session: TerminalSession): void => {
    scrollBindingRef.current?.dispose();
    scrollBindingRef.current = null;
    const scroller = scrollerRef.current;
    const spacer = spacerRef.current;
    if (scroller === null || spacer === null || !session.terminal.element?.isConnected) return;
    scrollBindingRef.current = bindTerminalScrollport(session.terminal, scroller, spacer);
  };

  const startSession = (terminal: PersistentTerminal, ptyBridge: DesktopPtyBridge): void => {
    const request = {};
    terminal.startRequest = request;
    if (terminal.recovery !== null) setTerminalRecovery(terminal, null);
    // Load the renderer before snapshotting a main-owned job. openSession subscribes to
    // live output after the snapshot, so this keeps that gap to one IPC round trip.
    void loadGhostty()
      .then(({ module, ghostty }) => {
        if (
          terminal.startRequest !== request ||
          terminal.session !== null ||
          !terminal.wrapper.isConnected
        ) {
          return null;
        }
        // A preload older than the renderer has no attach, and no main-owned job to adopt either.
        return (
          typeof ptyBridge.attach === "function"
            ? ptyBridge.attach(terminalID).catch(() => null)
            : Promise.resolve<TerminalSessionSnapshot | null>(null)
        ).then((attached) => ({ module, ghostty, attached }));
      })
      .then((loaded) => {
        if (
          loaded === null ||
          terminal.startRequest !== request ||
          terminal.session !== null ||
          !terminal.wrapper.isConnected
        ) {
          return;
        }
        terminal.session = openSession(
          terminal.wrapper,
          ptyBridge,
          cwd,
          loaded.attached,
          getSnapshot().codeFontSize,
          readResolvedTheme,
          loaded.module,
          loaded.ghostty,
          (code) => setTerminalRecovery(terminal, { status: "exited", code }),
          () => setTerminalRecovery(terminal, { status: "failed" }),
        );
        terminal.startRequest = null;
        bindScrollport(terminal.session);
      })
      .catch(() => {
        if (terminal.startRequest !== request || !terminal.wrapper.isConnected) return;
        terminal.startRequest = null;
        setTerminalRecovery(terminal, { status: "failed" });
      });
  };

  // The callback only owns wrapper attachment. The terminal ID owns the PTY lifetime.
  const attachHost = (element: HTMLDivElement | null): void => {
    if (element === null) {
      scrollBindingRef.current?.dispose();
      scrollBindingRef.current = null;
      recoveryCleanupRef.current?.();
      recoveryCleanupRef.current = null;
      const terminal = terminalRef.current;
      if (terminal !== null && terminal.wrapper.parentElement === hostRef.current) {
        terminal.wrapper.remove();
      }
      hostRef.current = null;
      terminalRef.current = null;
      return;
    }
    const terminal = getPersistentTerminal(terminalID);
    terminalRef.current = terminal;
    hostRef.current = element;
    element.append(terminal.wrapper);
    setRecovery(terminal.recovery);
    terminal.recoveryListeners.add(setRecovery);
    recoveryCleanupRef.current = () => terminal.recoveryListeners.delete(setRecovery);
    if (terminal.session !== null) {
      syncTerminalAppearance(
        terminal.session,
        terminal.wrapper,
        getSnapshot().codeFontSize,
        readResolvedTheme(),
      );
      bindScrollport(terminal.session);
      return;
    }
    // StrictMode's attach-detach-attach probe is synchronous. Wait one microtask before loading
    // Ghostty so the discarded attachment never opens a shell or owns the shared WASM instance.
    queueMicrotask(() => {
      const ptyBridge = getPtyBridge();
      if (
        hostRef.current !== element ||
        terminalRef.current !== terminal ||
        terminal.wrapper.parentElement !== element ||
        ptyBridge === null ||
        terminal.session !== null
      ) {
        return;
      }
      startSession(terminal, ptyBridge);
    });
  };

  const attachScroller = (element: HTMLDivElement | null): void => {
    scrollBindingRef.current?.dispose();
    scrollBindingRef.current = null;
    scrollerRef.current = element;
    const session = terminalRef.current?.session;
    if (element !== null && session !== null && session !== undefined) bindScrollport(session);
  };

  const attachSpacer = (element: HTMLDivElement | null): void => {
    scrollBindingRef.current?.dispose();
    scrollBindingRef.current = null;
    spacerRef.current = element;
    const session = terminalRef.current?.session;
    if (element !== null && session !== null && session !== undefined) bindScrollport(session);
  };

  useEffect(() => {
    const terminal = terminalRef.current;
    if (
      terminal?.session === null ||
      terminal?.session === undefined ||
      !terminal.wrapper.isConnected
    ) {
      return;
    }
    syncTerminalAppearance(
      terminal.session,
      terminal.wrapper,
      getSnapshot().codeFontSize,
      resolvedTheme,
    );
    scrollBindingRef.current?.sync();
  }, [resolvedTheme]);

  useEffect(() => {
    if (!isVisible) return;
    terminalRef.current?.session?.fit.fit();
    scrollBindingRef.current?.sync();
  }, [isVisible]);

  const restart = (): void => {
    const terminal = terminalRef.current;
    const ptyBridge = getPtyBridge();
    if (terminal === null || ptyBridge === null) return;
    terminal.startRequest = null;
    scrollBindingRef.current?.dispose();
    scrollBindingRef.current = null;
    if (terminal.session !== null) disposeSession(terminal.session);
    terminal.session = null;
    setTerminalRecovery(terminal, null);
    startSession(terminal, ptyBridge);
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
              : recovery.code === null
                ? "Process stopped"
                : `Process exited with code ${recovery.code}`}
          </Text>
          <Button size="sm" variant="quiet" onClick={restart}>
            Restart
          </Button>
        </div>
      ) : null}
      <div {...props(styles.terminalArea)}>
        <div ref={attachHost} {...props(styles.hostContainer)} />
        <div ref={attachScroller} data-honk-scrollport {...props(styles.scroller)}>
          <div ref={attachSpacer} {...props(styles.scrollSpacer)} />
        </div>
      </div>
    </div>
  );
}

export { disposeWorkbenchTerminal, WorkbenchTerminal };
