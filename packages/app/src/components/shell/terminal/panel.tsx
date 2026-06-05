"use client";

import { type EnvironmentId, DEFAULT_TERMINAL_ID, type TerminalEvent } from "@multi/contracts";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useEffect, useRef, useState } from "react";

import {
  readTerminalHostFontFamily,
  readTerminalHostFontSize,
  readTerminalHostThemeForMount,
} from "~/components/shell/terminal/terminal-host-theme";
import { subscribeTerminalHostDocument } from "~/components/shell/terminal/terminal-xterm-host-sync";
import { terminalDeleteShortcutData, terminalNavigationShortcutData } from "~/keybindings";
import {
  readWorkbenchTerminalApi,
  workbenchTerminalThreadId,
} from "~/components/shell/terminal/workbench-terminal";
import { clampTerminalDimensions, waitForTerminalLayoutFrame } from "~/lib/terminal-dimensions";
import { useEnvironmentApiReady } from "~/hooks/use-environment-api-ready";
import { useMountEffect } from "~/hooks/use-mount-effect";

export function TerminalPanel(props: {
  cwd: string | null;
  workspaceKey: string | null;
  environmentId?: EnvironmentId | null;
  terminalId?: string;
}) {
  const activeTerminalId = props.terminalId ?? DEFAULT_TERMINAL_ID;
  const environmentApiReady = useEnvironmentApiReady(props.environmentId);
  const terminalApiReady = props.environmentId ? environmentApiReady : true;

  useEffect(() => {
    if (props.cwd) {
      return;
    }
  }, [activeTerminalId, props.cwd, props.environmentId, props.workspaceKey]);

  if (!props.cwd) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center px-4 text-center">
        <p className="text-body text-muted-foreground/60">No project open</p>
      </div>
    );
  }

  if (!terminalApiReady) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center px-4 text-center">
        <p className="text-body text-muted-foreground/60">Preparing terminal...</p>
      </div>
    );
  }

  return (
    <TerminalPanelSession
      key={createTerminalPanelSessionKey({
        cwd: props.cwd,
        environmentId: props.environmentId,
        terminalId: activeTerminalId,
        workspaceKey: props.workspaceKey,
      })}
      cwd={props.cwd}
      workspaceKey={props.workspaceKey}
      environmentId={props.environmentId}
      terminalId={activeTerminalId}
    />
  );
}

function createTerminalPanelSessionKey(input: {
  cwd: string;
  environmentId: EnvironmentId | null | undefined;
  terminalId: string;
  workspaceKey: string | null;
}): string {
  return JSON.stringify([input.workspaceKey, input.cwd, input.environmentId ?? null, input.terminalId]);
}

function TerminalPanelSession({
  cwd,
  workspaceKey,
  environmentId,
  terminalId,
}: {
  cwd: string;
  workspaceKey: string | null;
  environmentId: EnvironmentId | null | undefined;
  terminalId: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const term = useRef<Terminal | null>(null);
  const fit = useRef<FitAddon | null>(null);
  const size = useRef<{ thread: string; cols: number; rows: number } | null>(null);
  const openSession = useRef<{ thread: string; terminalId: string } | null>(null);
  const [bootErr, setBootErr] = useState<string | null>(null);

  const dev = import.meta.env.DEV;

  useMountEffect(() => {
    const el = ref.current;
    const api = readWorkbenchTerminalApi(environmentId);
    console.log("[workspace.terminal.mount]", {
      cwd,
      workspaceKey,
      environmentId: environmentId ?? null,
      terminalId,
      hasElement: el !== null,
      hasApi: api !== null,
    });
    if (!el) {
      return;
    }
    if (!api) {
      setBootErr("Terminal API unavailable for this workspace.");
      return;
    }

    const thread = workbenchTerminalThreadId(workspaceKey ?? cwd);
    const termId = terminalId;
    const cfg = readTerminalHostThemeForMount(el);
    const family = readTerminalHostFontFamily(el);
    const fontSize = readTerminalHostFontSize(el);

    let live = true;
    let off: (() => void) | undefined;
    let data: { dispose: () => void } | undefined;
    let next: Terminal | null = null;
    let addon: FitAddon | null = null;

    openSession.current = null;
    setBootErr(null);

    try {
      next = new Terminal({
        fontSize,
        fontFamily: family,
        cursorBlink: true,
        lineHeight: 1.2,
        theme: cfg,
        scrollback: 10_000,
      });
      addon = new FitAddon();
      next.loadAddon(addon);
      el.replaceChildren();
      next.open(el);
      addon.fit();
      size.current = {
        thread,
        ...clampTerminalDimensions({ cols: next.cols, rows: next.rows }),
      };
      term.current = next;
      fit.current = addon;
    } catch (err) {
      if (dev) console.warn("[TerminalPanel] xterm init failed", err);
      setBootErr("Could not load terminal renderer.");
      return () => {
        live = false;
        off?.();
        data?.dispose();
        next?.dispose();
        term.current = null;
        fit.current = null;
        size.current = null;
        el.replaceChildren();
      };
    }

    let seed: string | null = null;

    const hydrate = (value: string | null | undefined) => {
      const nextValue = value ?? "";
      if (seed === nextValue) return;
      seed = nextValue;
      if (nextValue) next.write(nextValue);
    };

    const clear = () => {
      seed = "";
      next.clear();
    };

    const sendTerminalInput = (data: string) => {
      if (openSession.current?.thread !== thread || openSession.current.terminalId !== termId) {
        return;
      }
      void api
        .write({
          threadId: thread,
          terminalId: termId,
          data,
        })
        .catch(() => undefined);
    };

    next.attachCustomKeyEventHandler((event) => {
      const navigationData = terminalNavigationShortcutData(event);
      if (navigationData !== null) {
        event.preventDefault();
        event.stopPropagation();
        sendTerminalInput(navigationData);
        return false;
      }

      const deleteData = terminalDeleteShortcutData(event);
      if (deleteData !== null) {
        event.preventDefault();
        event.stopPropagation();
        sendTerminalInput(deleteData);
        return false;
      }

      const hit =
        event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.shiftKey &&
        event.code === "KeyK";
      if (!hit) return true;
      event.preventDefault();
      event.stopPropagation();
      clear();
      if (openSession.current?.thread === thread && openSession.current.terminalId === termId) {
        void api
          .clear({
            threadId: thread,
            terminalId: termId,
          })
          .catch(() => undefined);
      }
      return false;
    });

    data = next.onData((chunk) => {
      sendTerminalInput(chunk);
    });

    const onEvent = (event: TerminalEvent) => {
      if (!live) return;
      if (event.threadId !== thread) return;
      if (event.terminalId !== termId) return;
      if (event.type === "output") {
        next.write(event.data);
        return;
      }
      if (event.type === "cleared") {
        clear();
        return;
      }
      if (event.type === "started" || event.type === "restarted") {
        clear();
      }
    };

    off = api.onEvent(onEvent);

    const syncPtySize = (terminal: Terminal) => {
      const addon = fit.current;
      if (!addon || !live) return;
      addon.fit();
      if (openSession.current?.thread !== thread || openSession.current?.terminalId !== termId) {
        return;
      }
      const nextSize = clampTerminalDimensions({
        cols: terminal.cols,
        rows: terminal.rows,
      });
      const prev = size.current;
      if (
        prev &&
        prev.thread === thread &&
        prev.cols === nextSize.cols &&
        prev.rows === nextSize.rows
      ) {
        return;
      }
      size.current = { thread, ...nextSize };
      void api
        .resize({
          threadId: thread,
          terminalId: termId,
          cols: nextSize.cols,
          rows: nextSize.rows,
        })
        .catch(() => undefined);
    };

    const unsubscribeTerminalHost = subscribeTerminalHostDocument(
      () => ref.current,
      () => term.current,
      {
        onApplied: () => {
          const t = term.current;
          if (t) syncPtySize(t);
        },
      },
    );

    const openTerminal = async () => {
      await waitForTerminalLayoutFrame();
      if (!live) return;

      const activeTerminal = term.current;
      const activeFitAddon = fit.current;
      if (!activeTerminal || !activeFitAddon) return;

      activeFitAddon.fit();
      const openSize = clampTerminalDimensions({
        cols: activeTerminal.cols,
        rows: activeTerminal.rows,
      });
      size.current = { thread, ...openSize };
      console.log("[workspace.terminal.open.start]", {
        cwd,
        workspaceKey,
        environmentId: environmentId ?? null,
        terminalId: termId,
        threadId: thread,
        cols: openSize.cols,
        rows: openSize.rows,
      });

      try {
        const snap = await api.open({
          threadId: thread,
          terminalId: termId,
          cwd,
          cols: openSize.cols,
          rows: openSize.rows,
        });
        if (!live) return;
        openSession.current = { thread, terminalId: termId };
        console.log("[workspace.terminal.open.success]", {
          cwd,
          workspaceKey,
          environmentId: environmentId ?? null,
          terminalId: termId,
          threadId: thread,
          historyLength: snap.history.length,
        });
        hydrate(snap.history);
        syncPtySize(activeTerminal);
      } catch (err) {
        console.log("[workspace.terminal.open.error]", {
          cwd,
          workspaceKey,
          environmentId: environmentId ?? null,
          terminalId: termId,
          threadId: thread,
          error: err instanceof Error ? { name: err.name, message: err.message } : String(err),
        });
        if (dev) console.warn("[TerminalPanel] terminal.open failed", err);
        if (live) {
          openSession.current = null;
          setBootErr("Could not open terminal session.");
        }
      }
    };
    void openTerminal();

    return () => {
      live = false;
      if (openSession.current?.thread === thread && openSession.current.terminalId === termId) {
        openSession.current = null;
      }
      unsubscribeTerminalHost();
      off?.();
      data?.dispose();
      next?.dispose();
      term.current = null;
      fit.current = null;
      size.current = null;
      el.replaceChildren();
    };
  });

  useMountEffect(() => {
    const el = ref.current;
    if (!el) return;
    const termId = terminalId;
    let fitFrame: number | null = null;
    const fitAndResize = () => {
      fitFrame = null;
      const addon = fit.current;
      const next = term.current;
      const api = readWorkbenchTerminalApi(environmentId);
      if (!addon || !next || !api) return;
      addon.fit();
      const thread = workbenchTerminalThreadId(workspaceKey ?? cwd);
      if (openSession.current?.thread !== thread || openSession.current.terminalId !== termId) {
        return;
      }
      const nextSize = clampTerminalDimensions({
        cols: next.cols,
        rows: next.rows,
      });
      const prev = size.current;
      if (
        prev &&
        prev.thread === thread &&
        prev.cols === nextSize.cols &&
        prev.rows === nextSize.rows
      ) {
        return;
      }
      size.current = { thread, ...nextSize };
      void api
        .resize({
          threadId: thread,
          terminalId: termId,
          cols: nextSize.cols,
          rows: nextSize.rows,
        })
        .catch(() => undefined);
    };
    const scheduleFitAndResize = () => {
      if (fitFrame !== null) return;
      fitFrame = window.requestAnimationFrame(fitAndResize);
    };
    const obs = new ResizeObserver(scheduleFitAndResize);
    obs.observe(el);
    return () => {
      obs.disconnect();
      if (fitFrame !== null) {
        window.cancelAnimationFrame(fitFrame);
      }
    };
  });

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {bootErr ? (
        <p className="shrink-0 px-2 py-1 text-detail text-destructive">{bootErr}</p>
      ) : null}
      <div ref={ref} className="workbench-terminal-viewport min-h-0 flex-1 overflow-hidden" />
    </div>
  );
}
