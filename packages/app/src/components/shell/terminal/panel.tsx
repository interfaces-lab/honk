"use client";

import { type EnvironmentId, DEFAULT_TERMINAL_ID, type TerminalEvent } from "@multi/contracts";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useEffect, useRef, useState } from "react";

import {
  readTerminalHostFontFamily,
  readTerminalHostFontSize,
  readTerminalHostTheme,
} from "~/components/shell/terminal/terminal-host-theme";
import { useTheme } from "~/hooks/use-theme";
import { readNativeEnvironmentApi } from "~/lib/native-runtime-api";

function workbenchThreadId(cwd: string) {
  return `workbench:${cwd}`;
}

type WorkbenchTerminalApi = NonNullable<ReturnType<typeof readNativeEnvironmentApi>>["terminal"];

function readWorkbenchTerminalApi(
  environmentId: EnvironmentId | null | undefined,
): WorkbenchTerminalApi | null {
  return (
    readNativeEnvironmentApi(environmentId, {
      allowPrimaryEnvironmentFallback: true,
    })?.terminal ?? null
  );
}

export function TerminalPanel(props: { cwd: string | null; environmentId?: EnvironmentId | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const term = useRef<Terminal | null>(null);
  const fit = useRef<FitAddon | null>(null);
  const size = useRef<{ thread: string; cols: number; rows: number } | null>(null);
  const { resolvedTheme } = useTheme();
  const [bootErr, setBootErr] = useState<string | null>(null);

  const dev = import.meta.env.DEV;

  useEffect(() => {
    const el = ref.current;
    const api = readWorkbenchTerminalApi(props.environmentId);
    if (!el || !api || !props.cwd) return;

    const cwd = props.cwd;
    const thread = workbenchThreadId(cwd);
    const cfg = readTerminalHostTheme(el, resolvedTheme);
    const family = readTerminalHostFontFamily(el);
    const fontSize = readTerminalHostFontSize(el);

    let live = true;
    let off: (() => void) | undefined;
    let data: { dispose: () => void } | undefined;
    let next: Terminal | null = null;
    let addon: FitAddon | null = null;

    setBootErr(null);

    try {
      next = new Terminal({
        fontSize,
        fontFamily: family,
        cursorBlink: true,
        theme: cfg,
        scrollback: 10_000,
      });
      addon = new FitAddon();
      next.loadAddon(addon);
      el.replaceChildren();
      next.open(el);
      addon.fit();
      size.current = { thread, cols: next.cols, rows: next.rows };
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

    next.attachCustomKeyEventHandler((event) => {
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
      void api.clear({
        threadId: thread,
        terminalId: DEFAULT_TERMINAL_ID,
      });
      return false;
    });

    data = next.onData((chunk) => {
      void api.write({
        threadId: thread,
        terminalId: DEFAULT_TERMINAL_ID,
        data: chunk,
      });
    });

    const onEvent = (event: TerminalEvent) => {
      if (!live) return;
      if (event.threadId !== thread) return;
      if (event.terminalId !== DEFAULT_TERMINAL_ID) return;
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

    void api
      .open({
        threadId: thread,
        terminalId: DEFAULT_TERMINAL_ID,
        cwd,
        cols: next.cols,
        rows: next.rows,
      })
      .then((snap) => {
        if (!live) return;
        hydrate(snap.history);
      })
      .catch((err) => {
        if (dev) console.warn("[TerminalPanel] terminal.open failed", err);
        if (live) setBootErr("Could not open terminal session.");
      });

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
  }, [dev, props.cwd, props.environmentId, resolvedTheme]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new ResizeObserver(() => {
      const addon = fit.current;
      const next = term.current;
      const api = readWorkbenchTerminalApi(props.environmentId);
      if (!addon || !next || !api || !props.cwd) return;
      addon.fit();
      const thread = workbenchThreadId(props.cwd);
      const prev = size.current;
      if (prev && prev.thread === thread && prev.cols === next.cols && prev.rows === next.rows) {
        return;
      }
      size.current = { thread, cols: next.cols, rows: next.rows };
      void api.resize({
        threadId: thread,
        terminalId: DEFAULT_TERMINAL_ID,
        cols: next.cols,
        rows: next.rows,
      });
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, [props.cwd, props.environmentId]);

  if (!props.cwd) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center px-4 text-center">
        <p className="text-body text-muted-foreground/60">No workspace open</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background text-foreground">
      {bootErr ? (
        <p className="shrink-0 px-2 py-1 text-detail text-destructive">{bootErr}</p>
      ) : null}
      <div ref={ref} className="min-h-0 flex-1 overflow-hidden px-2 py-1" />
    </div>
  );
}
