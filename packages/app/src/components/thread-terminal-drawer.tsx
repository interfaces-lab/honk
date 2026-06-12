import { FitAddon } from "@xterm/addon-fit";
import {
  IconConsoleSimple,
  IconCrossMediumDefault,
  IconPlusLarge,
  IconSplit,
  IconTrashCan,
} from "central-icons";
import {
  type ScopedThreadRef,
  type TerminalEvent,
  type TerminalSessionSnapshot,
  type ThreadId,
} from "@honk/contracts";
import { Terminal } from "@xterm/xterm";
import {
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type Dispatch,
  type RefObject,
  type SetStateAction,
  useEffect,
  useRef,
  useState,
} from "react";
import { Popover, PopoverPopup, PopoverTrigger } from "@honk/honkkit/popover";
import { openInPreferredEditor } from "../editor-preferences";
import {
  collectWrappedTerminalLinkLine,
  extractTerminalLinks,
  isTerminalLinkActivation,
  resolvePathLinkTarget,
  resolveWrappedTerminalLinkRange,
  wrappedTerminalLinkRangeIntersectsBufferLine,
} from "../lib/terminal-links";
import {
  isTerminalClearShortcut,
  terminalDeleteShortcutData,
  terminalNavigationShortcutData,
} from "../keybindings";
import {
  DEFAULT_THREAD_TERMINAL_HEIGHT,
  DEFAULT_THREAD_TERMINAL_ID,
  MAX_TERMINALS_PER_GROUP,
  type ThreadTerminalGroup,
} from "../types";
import { readEnvironmentApi } from "~/environment-api";
import { readLocalApi } from "~/local-api";
import { formatTerminalErrorDescription } from "~/lib/terminal-error-description";
import { clampTerminalDimensions, waitForTerminalLayoutFrame } from "~/lib/terminal-dimensions";
import { useMountEffect } from "~/hooks/use-mount-effect";
import {
  readTerminalHostFontFamily,
  readTerminalHostFontSize,
  readTerminalHostThemeForMount,
} from "~/components/shell/terminal/terminal-host-theme";
import { subscribeTerminalHostDocument } from "~/components/shell/terminal/terminal-xterm-host-sync";
import { selectTerminalEventEntries, useTerminalStateStore } from "../terminal-state-store";

const MIN_DRAWER_HEIGHT = 180;
const MAX_DRAWER_HEIGHT_RATIO = 0.75;

function useValueIdentityVersion<TValue>(value: TValue): number {
  const valueRef = useRef(value);
  const versionRef = useRef(0);
  if (valueRef.current !== value) {
    valueRef.current = value;
    versionRef.current += 1;
  }
  return versionRef.current;
}

function maxDrawerHeight(): number {
  if (typeof window === "undefined") return DEFAULT_THREAD_TERMINAL_HEIGHT;
  return Math.max(MIN_DRAWER_HEIGHT, Math.floor(window.innerHeight * MAX_DRAWER_HEIGHT_RATIO));
}

function clampDrawerHeight(height: number): number {
  const safeHeight = Number.isFinite(height) ? height : DEFAULT_THREAD_TERMINAL_HEIGHT;
  const maxHeight = maxDrawerHeight();
  return Math.min(Math.max(Math.round(safeHeight), MIN_DRAWER_HEIGHT), maxHeight);
}

interface TerminalWriteQueue {
  push(data: string): void;
  flush(done?: () => void): void;
  clear(): void;
}

function createTerminalWriteQueue(terminal: Terminal): TerminalWriteQueue {
  let chunks: string[] = [];
  let waiters: Array<() => void> = [];
  let scheduled = false;
  let writing = false;

  const settle = () => {
    if (scheduled || writing || chunks.length > 0) return;
    const nextWaiters = waiters;
    waiters = [];
    for (const done of nextWaiters) {
      done();
    }
  };

  const run = () => {
    if (writing) return;
    scheduled = false;
    const nextChunks = chunks;
    chunks = [];
    if (nextChunks.length === 0) {
      settle();
      return;
    }
    writing = true;
    terminal.write(nextChunks.join(""), () => {
      writing = false;
      if (chunks.length > 0 && !scheduled) {
        scheduled = true;
        queueMicrotask(run);
        return;
      }
      settle();
    });
  };

  return {
    push(data) {
      if (data.length === 0) return;
      chunks.push(data);
      if (scheduled || writing) return;
      scheduled = true;
      queueMicrotask(run);
    },
    flush(done) {
      if (!scheduled && !writing && chunks.length === 0) {
        done?.();
        return;
      }
      if (done) {
        waiters.push(done);
      }
      run();
    },
    clear() {
      chunks = [];
      waiters = [];
      scheduled = false;
    },
  };
}

function writeSystemMessage(writer: TerminalWriteQueue, message: string): void {
  writer.push(`\r\n[terminal] ${message}\r\n`);
}

function writeTerminalSnapshot(
  writer: TerminalWriteQueue,
  snapshot: TerminalSessionSnapshot,
): void {
  writer.clear();
  writer.push("\u001bc");
  if (snapshot.history.length > 0) {
    writer.push(snapshot.history);
  }
}

export function selectTerminalEventEntriesAfterSnapshot(
  entries: ReadonlyArray<{ id: number; event: TerminalEvent }>,
  snapshotUpdatedAt: string,
): ReadonlyArray<{ id: number; event: TerminalEvent }> {
  return entries.filter((entry) => entry.event.createdAt > snapshotUpdatedAt);
}

export function selectPendingTerminalEventEntries(
  entries: ReadonlyArray<{ id: number; event: TerminalEvent }>,
  lastAppliedTerminalEventId: number,
): ReadonlyArray<{ id: number; event: TerminalEvent }> {
  return entries.filter((entry) => entry.id > lastAppliedTerminalEventId);
}

interface TerminalViewportProps {
  threadRef: ScopedThreadRef;
  threadId: ThreadId;
  terminalId: string;
  terminalLabel: string;
  cwd: string;
  worktreePath?: string | null;
  runtimeEnv?: Record<string, string>;
  onSessionExited: () => void;
  focusRequestId: number;
  autoFocus: boolean;
  resizeEpoch: number;
  drawerHeight: number;
}

function terminalRuntimeEnvKey(runtimeEnv: Record<string, string> | undefined): string {
  if (!runtimeEnv) return "";
  return Object.entries(runtimeEnv)
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join("\0");
}

export function TerminalViewport(props: TerminalViewportProps) {
  const lifecycleKey = [
    props.threadRef.environmentId,
    props.threadId,
    props.terminalId,
    props.cwd,
    props.worktreePath ?? "",
    terminalRuntimeEnvKey(props.runtimeEnv),
  ].join("\0");

  return <TerminalViewportInner key={lifecycleKey} {...props} />;
}

function TerminalViewportInner({
  threadRef,
  threadId,
  terminalId,
  cwd,
  worktreePath,
  runtimeEnv,
  onSessionExited,
  focusRequestId,
  autoFocus,
  resizeEpoch,
  drawerHeight,
}: TerminalViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const environmentId = threadRef.environmentId;
  const hasHandledExitRef = useRef(false);
  const lastAppliedTerminalEventIdRef = useRef(0);
  const terminalHydratedRef = useRef(false);
  const onSessionExitedRef = useRef(onSessionExited);

  useEffect(() => {
    onSessionExitedRef.current = onSessionExited;
  }, [onSessionExited]);

  useMountEffect(() => {
    const mount = containerRef.current;
    if (!mount) return;

    let disposed = false;
    const api = readEnvironmentApi(environmentId);
    const localApi = readLocalApi();
    if (!api || !localApi) return;

    const fitAddon = new FitAddon();
    const terminal = new Terminal({
      cursorBlink: true,
      lineHeight: 1.2,
      fontSize: readTerminalHostFontSize(mount),
      scrollback: 5_000,
      fontFamily: readTerminalHostFontFamily(mount),
      theme: readTerminalHostThemeForMount(mount),
    });
    const writer = createTerminalWriteQueue(terminal);
    terminal.loadAddon(fitAddon);
    terminal.open(mount);
    fitAddon.fit();

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    const sendTerminalInput = async (data: string, fallbackError: string) => {
      const activeTerminal = terminalRef.current;
      if (!activeTerminal) return;
      try {
        await api.terminal.write({ threadId, terminalId, data });
      } catch (error) {
        writeSystemMessage(writer, formatTerminalErrorDescription(error, fallbackError));
      }
    };

    terminal.attachCustomKeyEventHandler((event) => {
      const navigationData = terminalNavigationShortcutData(event);
      if (navigationData !== null) {
        event.preventDefault();
        event.stopPropagation();
        void sendTerminalInput(navigationData, "Failed to move cursor");
        return false;
      }

      const deleteData = terminalDeleteShortcutData(event);
      if (deleteData !== null) {
        event.preventDefault();
        event.stopPropagation();
        void sendTerminalInput(deleteData, "Failed to delete terminal input");
        return false;
      }

      if (!isTerminalClearShortcut(event)) return true;
      event.preventDefault();
      event.stopPropagation();
      void sendTerminalInput("\u000c", "Failed to clear terminal");
      return false;
    });

    const terminalLinksDisposable = terminal.registerLinkProvider({
      provideLinks: (bufferLineNumber, callback) => {
        const activeTerminal = terminalRef.current;
        if (!activeTerminal) {
          callback(undefined);
          return;
        }

        const wrappedLine = collectWrappedTerminalLinkLine(bufferLineNumber, (bufferLineIndex) =>
          activeTerminal.buffer.active.getLine(bufferLineIndex),
        );
        if (!wrappedLine) {
          callback(undefined);
          return;
        }

        const links = extractTerminalLinks(wrappedLine.text)
          .map((match) => ({
            match,
            range: resolveWrappedTerminalLinkRange(wrappedLine, match),
          }))
          .filter(({ range }) =>
            wrappedTerminalLinkRangeIntersectsBufferLine(range, bufferLineNumber),
          );
        if (links.length === 0) {
          callback(undefined);
          return;
        }

        callback(
          links.map(({ match, range }) => ({
            text: match.text,
            range,
            activate: (event: MouseEvent) => {
              if (!isTerminalLinkActivation(event)) return;

              const latestTerminal = terminalRef.current;
              if (!latestTerminal) return;

              if (match.kind === "url") {
                void localApi.shell.openExternal(match.text).catch((error: unknown) => {
                  writeSystemMessage(
                    writer,
                    error instanceof Error ? error.message : "Unable to open link",
                  );
                });
                return;
              }

              const target = resolvePathLinkTarget(match.text, cwd);
              void openInPreferredEditor(localApi, target).catch((error) => {
                writeSystemMessage(
                  writer,
                  error instanceof Error ? error.message : "Unable to open path",
                );
              });
            },
          })),
        );
      },
    });

    const inputDisposable = terminal.onData((data) => {
      void api.terminal
        .write({ threadId, terminalId, data })
        .catch((err) =>
          writeSystemMessage(writer, formatTerminalErrorDescription(err, "Terminal write failed")),
        );
    });

    const handleCopy = (event: ClipboardEvent) => {
      const selection = terminal.getSelection();
      if (!selection) return;
      const clipboard = event.clipboardData;
      if (!clipboard) return;

      event.preventDefault();
      clipboard.setData("text/plain", selection);
    };
    const handlePaste = (event: ClipboardEvent) => {
      const plainText = event.clipboardData?.getData("text/plain") ?? "";
      const text = plainText || event.clipboardData?.getData("text") || "";
      if (!text) return;

      event.preventDefault();
      event.stopPropagation();
      terminal.paste(text);
    };
    mount.addEventListener("copy", handleCopy, true);
    mount.addEventListener("paste", handlePaste, true);

    let fitFrame: number | null = null;
    let lastSyncedSize = clampTerminalDimensions({ cols: terminal.cols, rows: terminal.rows });
    const fitAndResize = () => {
      fitFrame = null;
      if (disposed) return;
      const activeTerminal = terminalRef.current;
      const activeFitAddon = fitAddonRef.current;
      if (!activeTerminal || !activeFitAddon) return;
      const wasAtBottom =
        activeTerminal.buffer.active.viewportY >= activeTerminal.buffer.active.baseY;
      activeFitAddon.fit();
      if (wasAtBottom) {
        activeTerminal.scrollToBottom();
      }
      if (!terminalHydratedRef.current) {
        return;
      }
      const nextSize = clampTerminalDimensions({
        cols: activeTerminal.cols,
        rows: activeTerminal.rows,
      });
      if (lastSyncedSize.cols === nextSize.cols && lastSyncedSize.rows === nextSize.rows) {
        return;
      }
      lastSyncedSize = nextSize;
      void api.terminal
        .resize({
          threadId,
          terminalId,
          cols: nextSize.cols,
          rows: nextSize.rows,
        })
        .catch(() => undefined);
    };
    const scheduleFitAndResize = () => {
      if (disposed) return;
      if (fitFrame !== null) return;
      fitFrame = window.requestAnimationFrame(fitAndResize);
    };
    const resizeObserver = new ResizeObserver(scheduleFitAndResize);
    resizeObserver.observe(mount);
    if (document.fonts) {
      void document.fonts.ready.then(() => {
        if (!disposed) {
          scheduleFitAndResize();
        }
      });
    }

    const unsubscribeTerminalHost = subscribeTerminalHostDocument(
      () => containerRef.current,
      () => terminalRef.current,
      { onApplied: scheduleFitAndResize },
    );

    const applyTerminalEvent = (event: TerminalEvent) => {
      const activeTerminal = terminalRef.current;
      if (!activeTerminal) {
        return;
      }

      if (event.type === "activity") {
        return;
      }

      if (event.type === "output") {
        writer.push(event.data);
        return;
      }

      if (event.type === "started" || event.type === "restarted") {
        hasHandledExitRef.current = false;
        writeTerminalSnapshot(writer, event.snapshot);
        return;
      }

      if (event.type === "cleared") {
        activeTerminal.clear();
        writer.clear();
        writer.push("\u001bc");
        return;
      }

      if (event.type === "error") {
        writeSystemMessage(writer, event.message);
        return;
      }

      const details = [
        typeof event.exitCode === "number" ? `code ${event.exitCode}` : null,
        typeof event.exitSignal === "number" ? `signal ${event.exitSignal}` : null,
      ]
        .filter((value): value is string => value !== null)
        .join(", ");
      writeSystemMessage(
        writer,
        details.length > 0 ? `Process exited (${details})` : "Process exited",
      );
      if (hasHandledExitRef.current) {
        return;
      }
      hasHandledExitRef.current = true;
      window.setTimeout(() => {
        if (!hasHandledExitRef.current) {
          return;
        }
        onSessionExitedRef.current();
      }, 0);
    };
    const applyPendingTerminalEvents = (
      terminalEventEntries: ReadonlyArray<{ id: number; event: TerminalEvent }>,
    ) => {
      const pendingEntries = selectPendingTerminalEventEntries(
        terminalEventEntries,
        lastAppliedTerminalEventIdRef.current,
      );
      if (pendingEntries.length === 0) {
        return;
      }
      for (const entry of pendingEntries) {
        applyTerminalEvent(entry.event);
      }
      lastAppliedTerminalEventIdRef.current =
        pendingEntries.at(-1)?.id ?? lastAppliedTerminalEventIdRef.current;
    };

    const unsubscribeTerminalEvents = useTerminalStateStore.subscribe((state, previousState) => {
      if (!terminalHydratedRef.current) {
        return;
      }

      const previousLastEntryId =
        selectTerminalEventEntries(
          previousState.terminalEventEntriesByKey,
          threadRef,
          terminalId,
        ).at(-1)?.id ?? 0;
      const nextEntries = selectTerminalEventEntries(
        state.terminalEventEntriesByKey,
        threadRef,
        terminalId,
      );
      const nextLastEntryId = nextEntries.at(-1)?.id ?? 0;
      if (nextLastEntryId === previousLastEntryId) {
        return;
      }

      applyPendingTerminalEvents(nextEntries);
    });

    const openTerminal = async () => {
      try {
        await waitForTerminalLayoutFrame();
        if (disposed) return;
        const activeTerminal = terminalRef.current;
        const activeFitAddon = fitAddonRef.current;
        if (!activeTerminal || !activeFitAddon) return;
        activeFitAddon.fit();
        const openSize = clampTerminalDimensions({
          cols: activeTerminal.cols,
          rows: activeTerminal.rows,
        });
        lastSyncedSize = openSize;
        const snapshot = await api.terminal.open({
          threadId,
          terminalId,
          cwd,
          ...(worktreePath !== undefined ? { worktreePath } : {}),
          cols: openSize.cols,
          rows: openSize.rows,
          ...(runtimeEnv ? { env: runtimeEnv } : {}),
        });
        if (disposed) return;
        writeTerminalSnapshot(writer, snapshot);
        const bufferedEntries = selectTerminalEventEntries(
          useTerminalStateStore.getState().terminalEventEntriesByKey,
          threadRef,
          terminalId,
        );
        const replayEntries = selectTerminalEventEntriesAfterSnapshot(
          bufferedEntries,
          snapshot.updatedAt,
        );
        for (const entry of replayEntries) {
          applyTerminalEvent(entry.event);
        }
        lastAppliedTerminalEventIdRef.current = bufferedEntries.at(-1)?.id ?? 0;
        terminalHydratedRef.current = true;
        scheduleFitAndResize();
        if (autoFocus) {
          window.requestAnimationFrame(() => {
            activeTerminal.focus();
          });
        }
      } catch (err) {
        if (disposed) return;
        writeSystemMessage(writer, formatTerminalErrorDescription(err, "Failed to open terminal"));
      }
    };

    scheduleFitAndResize();
    void openTerminal();

    return () => {
      disposed = true;
      terminalHydratedRef.current = false;
      lastAppliedTerminalEventIdRef.current = 0;
      unsubscribeTerminalEvents();
      if (fitFrame !== null) {
        window.cancelAnimationFrame(fitFrame);
      }
      inputDisposable.dispose();
      terminalLinksDisposable.dispose();
      mount.removeEventListener("copy", handleCopy, true);
      mount.removeEventListener("paste", handlePaste, true);
      resizeObserver.disconnect();
      unsubscribeTerminalHost();
      terminalRef.current = null;
      fitAddonRef.current = null;
      terminal.dispose();
    };
  });

  return (
    <>
      <TerminalViewportFocusSync
        key={`${autoFocus}:${focusRequestId}`}
        autoFocus={autoFocus}
        terminalRef={terminalRef}
      />
      <TerminalViewportResizeSync
        key={`${drawerHeight}:${environmentId}:${resizeEpoch}:${terminalId}:${threadId}`}
        environmentId={environmentId}
        fitAddonRef={fitAddonRef}
        terminalId={terminalId}
        terminalRef={terminalRef}
        threadId={threadId}
      />
      <div
        ref={containerRef}
        className="thread-terminal-viewport relative h-full w-full bg-transparent"
      />
    </>
  );
}

function TerminalViewportFocusSync({
  autoFocus,
  terminalRef,
}: {
  autoFocus: boolean;
  terminalRef: RefObject<Terminal | null>;
}) {
  useMountEffect(() => {
    if (!autoFocus) return;
    const terminal = terminalRef.current;
    if (!terminal) return;
    const frame = window.requestAnimationFrame(() => {
      terminal.focus();
    });
    return () => {
      window.cancelAnimationFrame(frame);
    };
  });

  return null;
}

function TerminalViewportResizeSync({
  environmentId,
  fitAddonRef,
  terminalId,
  terminalRef,
  threadId,
}: {
  environmentId: ScopedThreadRef["environmentId"];
  fitAddonRef: RefObject<FitAddon | null>;
  terminalId: string;
  terminalRef: RefObject<Terminal | null>;
  threadId: ThreadId;
}) {
  useMountEffect(() => {
    const api = readEnvironmentApi(environmentId);
    const terminal = terminalRef.current;
    const fitAddon = fitAddonRef.current;
    if (!api || !terminal || !fitAddon) return;
    const wasAtBottom = terminal.buffer.active.viewportY >= terminal.buffer.active.baseY;
    const frame = window.requestAnimationFrame(() => {
      fitAddon.fit();
      if (wasAtBottom) {
        terminal.scrollToBottom();
      }
      const nextSize = clampTerminalDimensions({ cols: terminal.cols, rows: terminal.rows });
      void api.terminal
        .resize({
          threadId,
          terminalId,
          cols: nextSize.cols,
          rows: nextSize.rows,
        })
        .catch(() => undefined);
    });
    return () => {
      window.cancelAnimationFrame(frame);
    };
  });

  return null;
}

interface ThreadTerminalDrawerProps {
  threadRef: ScopedThreadRef;
  threadId: ThreadId;
  cwd: string;
  worktreePath?: string | null;
  runtimeEnv?: Record<string, string>;
  visible?: boolean;
  height: number;
  terminalIds: string[];
  activeTerminalId: string;
  terminalGroups: ThreadTerminalGroup[];
  activeTerminalGroupId: string;
  focusRequestId: number;
  onSplitTerminal: () => void;
  onNewTerminal: () => void;
  splitShortcutLabel?: string | undefined;
  newShortcutLabel?: string | undefined;
  closeShortcutLabel?: string | undefined;
  onActiveTerminalChange: (terminalId: string) => void;
  onCloseTerminal: (terminalId: string) => void;
  onHeightChange: (height: number) => void;
}

interface TerminalActionButtonProps {
  label: string;
  className: string;
  onClick: () => void;
  children: ReactNode;
}

function TerminalActionButton({ label, className, onClick, children }: TerminalActionButtonProps) {
  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        render={<button type="button" className={className} onClick={onClick} aria-label={label} />}
      >
        {children}
      </PopoverTrigger>
      <PopoverPopup
        tooltipStyle
        side="bottom"
        sideOffset={6}
        align="center"
        className="pointer-events-none select-none"
      >
        {label}
      </PopoverPopup>
    </Popover>
  );
}

function ThreadTerminalDrawerHeightResetSync({
  drawerHeightRef,
  height,
  lastSyncedHeightRef,
  setDrawerHeight,
}: {
  drawerHeightRef: RefObject<number>;
  height: number;
  lastSyncedHeightRef: RefObject<number>;
  setDrawerHeight: Dispatch<SetStateAction<number>>;
}) {
  useMountEffect(() => {
    const clampedHeight = clampDrawerHeight(height);
    setDrawerHeight(clampedHeight);
    drawerHeightRef.current = clampedHeight;
    lastSyncedHeightRef.current = clampedHeight;
  });

  return null;
}

function ThreadTerminalDrawerWindowResizeSync({
  handleWindowResize,
}: {
  handleWindowResize: () => void;
}) {
  useMountEffect(() => {
    const onWindowResize = () => {
      handleWindowResize();
    };
    window.addEventListener("resize", onWindowResize);
    return () => {
      window.removeEventListener("resize", onWindowResize);
    };
  });

  return null;
}

function ThreadTerminalDrawerVisibleResizeEpochSync({
  setResizeEpoch,
}: {
  setResizeEpoch: Dispatch<SetStateAction<number>>;
}) {
  useMountEffect(() => {
    setResizeEpoch((value) => value + 1);
  });

  return null;
}

function ThreadTerminalDrawerUnmountHeightSync({
  drawerHeightRef,
  syncHeight,
}: {
  drawerHeightRef: RefObject<number>;
  syncHeight: (nextHeight: number) => void;
}) {
  useMountEffect(() => {
    return () => {
      syncHeight(drawerHeightRef.current);
    };
  });

  return null;
}

export default function ThreadTerminalDrawer({
  threadRef,
  threadId,
  cwd,
  worktreePath,
  runtimeEnv,
  visible = true,
  height,
  terminalIds,
  activeTerminalId,
  terminalGroups,
  activeTerminalGroupId,
  focusRequestId,
  onSplitTerminal,
  onNewTerminal,
  splitShortcutLabel,
  newShortcutLabel,
  closeShortcutLabel,
  onActiveTerminalChange,
  onCloseTerminal,
  onHeightChange,
}: ThreadTerminalDrawerProps) {
  const [drawerHeight, setDrawerHeight] = useState(() => clampDrawerHeight(height));
  const [resizeEpoch, setResizeEpoch] = useState(0);
  const drawerHeightRef = useRef(drawerHeight);
  const lastSyncedHeightRef = useRef(clampDrawerHeight(height));
  const onHeightChangeRef = useRef(onHeightChange);
  const resizeStateRef = useRef<{
    pointerId: number;
    startY: number;
    startHeight: number;
  } | null>(null);
  const didResizeDuringDragRef = useRef(false);

  const cleanedTerminalIds = [
    ...new Set(terminalIds.map((id) => id.trim()).filter((id) => id.length > 0)),
  ];
  const normalizedTerminalIds =
    cleanedTerminalIds.length > 0 ? cleanedTerminalIds : [DEFAULT_THREAD_TERMINAL_ID];

  const resolvedActiveTerminalId = normalizedTerminalIds.includes(activeTerminalId)
    ? activeTerminalId
    : (normalizedTerminalIds[0] ?? DEFAULT_THREAD_TERMINAL_ID);

  const validTerminalIdSet = new Set(normalizedTerminalIds);
  const assignedTerminalIds = new Set<string>();
  const usedGroupIds = new Set<string>();
  const nextTerminalGroups: ThreadTerminalGroup[] = [];

  const assignUniqueGroupId = (groupId: string): string => {
    if (!usedGroupIds.has(groupId)) {
      usedGroupIds.add(groupId);
      return groupId;
    }
    let suffix = 2;
    while (usedGroupIds.has(`${groupId}-${suffix}`)) {
      suffix += 1;
    }
    const uniqueGroupId = `${groupId}-${suffix}`;
    usedGroupIds.add(uniqueGroupId);
    return uniqueGroupId;
  };

  for (const terminalGroup of terminalGroups) {
    const nextTerminalIds = [
      ...new Set(terminalGroup.terminalIds.map((id) => id.trim()).filter((id) => id.length > 0)),
    ].filter((terminalId) => {
      if (!validTerminalIdSet.has(terminalId)) return false;
      if (assignedTerminalIds.has(terminalId)) return false;
      return true;
    });
    if (nextTerminalIds.length === 0) continue;

    for (const terminalId of nextTerminalIds) {
      assignedTerminalIds.add(terminalId);
    }

    const baseGroupId =
      terminalGroup.id.trim().length > 0
        ? terminalGroup.id.trim()
        : `group-${nextTerminalIds[0] ?? DEFAULT_THREAD_TERMINAL_ID}`;
    nextTerminalGroups.push({
      id: assignUniqueGroupId(baseGroupId),
      terminalIds: nextTerminalIds,
    });
  }

  for (const terminalId of normalizedTerminalIds) {
    if (assignedTerminalIds.has(terminalId)) continue;
    nextTerminalGroups.push({
      id: assignUniqueGroupId(`group-${terminalId}`),
      terminalIds: [terminalId],
    });
  }

  const resolvedTerminalGroups =
    nextTerminalGroups.length > 0
      ? nextTerminalGroups
      : [
          {
            id: `group-${resolvedActiveTerminalId}`,
            terminalIds: [resolvedActiveTerminalId],
          },
        ];

  const indexById = resolvedTerminalGroups.findIndex(
    (terminalGroup) => terminalGroup.id === activeTerminalGroupId,
  );
  const indexByTerminal = resolvedTerminalGroups.findIndex((terminalGroup) =>
    terminalGroup.terminalIds.includes(resolvedActiveTerminalId),
  );
  const resolvedActiveGroupIndex =
    indexById >= 0 ? indexById : indexByTerminal >= 0 ? indexByTerminal : 0;

  const visibleTerminalIds = resolvedTerminalGroups[resolvedActiveGroupIndex]?.terminalIds ?? [
    resolvedActiveTerminalId,
  ];
  const hasTerminalSidebar = normalizedTerminalIds.length > 1;
  const isSplitView = visibleTerminalIds.length > 1;
  const showGroupHeaders =
    resolvedTerminalGroups.length > 1 ||
    resolvedTerminalGroups.some((terminalGroup) => terminalGroup.terminalIds.length > 1);
  const hasReachedSplitLimit = visibleTerminalIds.length >= MAX_TERMINALS_PER_GROUP;
  const terminalLabelById = new Map(
    normalizedTerminalIds.map((terminalId, index) => [terminalId, `Terminal ${index + 1}`]),
  );
  const splitTerminalActionLabel = hasReachedSplitLimit
    ? `Split Terminal (max ${MAX_TERMINALS_PER_GROUP} per group)`
    : splitShortcutLabel
      ? `Split Terminal (${splitShortcutLabel})`
      : "Split Terminal";
  const newTerminalActionLabel = newShortcutLabel
    ? `New Terminal (${newShortcutLabel})`
    : "New Terminal";
  const closeTerminalActionLabel = closeShortcutLabel
    ? `Close Terminal (${closeShortcutLabel})`
    : "Close Terminal";
  const onSplitTerminalAction = () => {
    if (hasReachedSplitLimit) return;
    onSplitTerminal();
  };
  const onNewTerminalAction = () => {
    onNewTerminal();
  };

  onHeightChangeRef.current = onHeightChange;
  drawerHeightRef.current = drawerHeight;

  const runtimeEnvVersion = useValueIdentityVersion(runtimeEnv);
  const terminalViewportSessionKey = [
    threadRef.environmentId,
    threadId,
    cwd,
    runtimeEnvVersion,
  ].join("\0");

  const syncHeight = (nextHeight: number) => {
    const clampedHeight = clampDrawerHeight(nextHeight);
    if (lastSyncedHeightRef.current === clampedHeight) return;
    lastSyncedHeightRef.current = clampedHeight;
    onHeightChangeRef.current(clampedHeight);
  };

  const handleResizePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    didResizeDuringDragRef.current = false;
    resizeStateRef.current = {
      pointerId: event.pointerId,
      startY: event.clientY,
      startHeight: drawerHeightRef.current,
    };
  };

  const handleResizePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const resizeState = resizeStateRef.current;
    if (!resizeState || resizeState.pointerId !== event.pointerId) return;
    event.preventDefault();
    const clampedHeight = clampDrawerHeight(
      resizeState.startHeight + (resizeState.startY - event.clientY),
    );
    if (clampedHeight === drawerHeightRef.current) {
      return;
    }
    didResizeDuringDragRef.current = true;
    drawerHeightRef.current = clampedHeight;
    setDrawerHeight(clampedHeight);
  };

  const handleResizePointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    const resizeState = resizeStateRef.current;
    if (!resizeState || resizeState.pointerId !== event.pointerId) return;
    resizeStateRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (!didResizeDuringDragRef.current) {
      return;
    }
    syncHeight(drawerHeightRef.current);
    setResizeEpoch((value) => value + 1);
  };

  const handleWindowResize = () => {
    const clampedHeight = clampDrawerHeight(drawerHeightRef.current);
    const changed = clampedHeight !== drawerHeightRef.current;
    if (changed) {
      setDrawerHeight(clampedHeight);
      drawerHeightRef.current = clampedHeight;
    }
    if (!resizeStateRef.current) {
      syncHeight(clampedHeight);
    }
    setResizeEpoch((value) => value + 1);
  };

  return (
    <aside
      className="thread-terminal-drawer relative flex min-w-0 shrink-0 flex-col overflow-hidden border-t"
      style={{ height: `${drawerHeight}px` }}
    >
      <ThreadTerminalDrawerHeightResetSync
        key={`${threadId}:${height}`}
        drawerHeightRef={drawerHeightRef}
        height={height}
        lastSyncedHeightRef={lastSyncedHeightRef}
        setDrawerHeight={setDrawerHeight}
      />
      {visible ? (
        <>
          <ThreadTerminalDrawerWindowResizeSync handleWindowResize={handleWindowResize} />
          <ThreadTerminalDrawerVisibleResizeEpochSync setResizeEpoch={setResizeEpoch} />
        </>
      ) : null}
      <ThreadTerminalDrawerUnmountHeightSync
        drawerHeightRef={drawerHeightRef}
        syncHeight={syncHeight}
      />
      <div
        className="absolute inset-x-0 top-0 z-20 h-1.5 cursor-row-resize"
        onPointerDown={handleResizePointerDown}
        onPointerMove={handleResizePointerMove}
        onPointerUp={handleResizePointerEnd}
        onPointerCancel={handleResizePointerEnd}
      />

      {!hasTerminalSidebar && (
        <div className="pointer-events-none absolute right-2 top-2 z-20">
          <div className="pointer-events-auto inline-flex items-center overflow-hidden rounded-md border border-honk-terminal-border bg-honk-terminal-toolbar-background shadow-honk-toolbar">
            <TerminalActionButton
              className={`p-1 text-honk-terminal-muted-foreground transition-colors hover:bg-honk-terminal-hover-background hover:text-honk-terminal-foreground ${
                hasReachedSplitLimit
                  ? "cursor-not-allowed opacity-45 hover:bg-transparent"
                  : "hover:bg-accent"
              }`}
              onClick={onSplitTerminalAction}
              label={splitTerminalActionLabel}
            >
              <IconSplit className="size-3.25" />
            </TerminalActionButton>
            <div className="h-4 w-px bg-honk-terminal-border-subtle" />
            <TerminalActionButton
              className="p-1 text-honk-terminal-muted-foreground transition-colors hover:bg-honk-terminal-hover-background hover:text-honk-terminal-foreground"
              onClick={onNewTerminalAction}
              label={newTerminalActionLabel}
            >
              <IconPlusLarge className="size-3.25" />
            </TerminalActionButton>
            <div className="h-4 w-px bg-honk-terminal-border-subtle" />
            <TerminalActionButton
              className="p-1 text-honk-terminal-muted-foreground transition-colors hover:bg-honk-terminal-hover-background hover:text-honk-terminal-foreground"
              onClick={() => onCloseTerminal(resolvedActiveTerminalId)}
              label={closeTerminalActionLabel}
            >
              <IconTrashCan className="size-3.25" />
            </TerminalActionButton>
          </div>
        </div>
      )}

      <div className="min-h-0 w-full flex-1">
        <div className={`flex h-full min-h-0 ${hasTerminalSidebar ? "gap-1.5" : ""}`}>
          <div className="min-w-0 flex-1">
            {isSplitView ? (
              <div
                className="grid h-full w-full min-w-0 gap-0 overflow-hidden"
                style={{
                  gridTemplateColumns: `repeat(${visibleTerminalIds.length}, minmax(0, 1fr))`,
                }}
              >
                {visibleTerminalIds.map((terminalId) => (
                  <div
                    key={terminalId}
                    data-active={terminalId === resolvedActiveTerminalId ? "true" : "false"}
                    role="presentation"
                    className="min-h-0 min-w-0 border-l border-honk-terminal-border-subtle first:border-l-0 data-[active=true]:border-honk-terminal-border"
                    onMouseDown={() => {
                      if (terminalId !== resolvedActiveTerminalId) {
                        onActiveTerminalChange(terminalId);
                      }
                    }}
                  >
                    <div className="h-full">
                      <TerminalViewport
                        key={`${terminalViewportSessionKey}:${terminalId}`}
                        threadRef={threadRef}
                        threadId={threadId}
                        terminalId={terminalId}
                        terminalLabel={terminalLabelById.get(terminalId) ?? "Terminal"}
                        cwd={cwd}
                        {...(worktreePath !== undefined ? { worktreePath } : {})}
                        {...(runtimeEnv ? { runtimeEnv } : {})}
                        onSessionExited={() => onCloseTerminal(terminalId)}
                        focusRequestId={focusRequestId}
                        autoFocus={terminalId === resolvedActiveTerminalId}
                        resizeEpoch={resizeEpoch}
                        drawerHeight={drawerHeight}
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="h-full">
                <TerminalViewport
                  key={`${terminalViewportSessionKey}:${resolvedActiveTerminalId}`}
                  threadRef={threadRef}
                  threadId={threadId}
                  terminalId={resolvedActiveTerminalId}
                  terminalLabel={terminalLabelById.get(resolvedActiveTerminalId) ?? "Terminal"}
                  cwd={cwd}
                  {...(worktreePath !== undefined ? { worktreePath } : {})}
                  {...(runtimeEnv ? { runtimeEnv } : {})}
                  onSessionExited={() => onCloseTerminal(resolvedActiveTerminalId)}
                  focusRequestId={focusRequestId}
                  autoFocus
                  resizeEpoch={resizeEpoch}
                  drawerHeight={drawerHeight}
                />
              </div>
            )}
          </div>

          {hasTerminalSidebar && (
            <aside className="flex w-36 min-w-36 flex-col border border-honk-terminal-border bg-transparent">
              <div className="flex h-[22px] items-stretch justify-end border-b border-honk-terminal-border-subtle bg-transparent">
                <div className="inline-flex h-full items-stretch">
                  <TerminalActionButton
                    className={`inline-flex h-full items-center px-1 text-honk-terminal-muted-foreground transition-colors hover:bg-honk-terminal-hover-background hover:text-honk-terminal-foreground ${
                      hasReachedSplitLimit
                        ? "cursor-not-allowed opacity-45 hover:bg-transparent"
                        : "hover:bg-accent/70"
                    }`}
                    onClick={onSplitTerminalAction}
                    label={splitTerminalActionLabel}
                  >
                    <IconSplit className="size-3.25" />
                  </TerminalActionButton>
                  <TerminalActionButton
                    className="inline-flex h-full items-center border-l border-honk-terminal-border-subtle px-1 text-honk-terminal-muted-foreground transition-colors hover:bg-honk-terminal-hover-background hover:text-honk-terminal-foreground"
                    onClick={onNewTerminalAction}
                    label={newTerminalActionLabel}
                  >
                    <IconPlusLarge className="size-3.25" />
                  </TerminalActionButton>
                  <TerminalActionButton
                    className="inline-flex h-full items-center border-l border-honk-terminal-border-subtle px-1 text-honk-terminal-muted-foreground transition-colors hover:bg-honk-terminal-hover-background hover:text-honk-terminal-foreground"
                    onClick={() => onCloseTerminal(resolvedActiveTerminalId)}
                    label={closeTerminalActionLabel}
                  >
                    <IconTrashCan className="size-3.25" />
                  </TerminalActionButton>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-1 py-1">
                {resolvedTerminalGroups.map((terminalGroup, groupIndex) => {
                  const isGroupActive =
                    terminalGroup.terminalIds.includes(resolvedActiveTerminalId);
                  const groupActiveTerminalId = isGroupActive
                    ? resolvedActiveTerminalId
                    : (terminalGroup.terminalIds[0] ?? resolvedActiveTerminalId);

                  return (
                    <div key={terminalGroup.id} className="pb-0.5">
                      {showGroupHeaders && (
                        <button
                          type="button"
                          data-active={isGroupActive ? "true" : "false"}
                          className="flex w-full items-center rounded px-1 py-0.5 text-caption text-honk-terminal-muted-foreground uppercase tracking-[0.08em] hover:bg-honk-terminal-hover-background hover:text-honk-terminal-foreground data-[active=true]:bg-honk-terminal-active-background data-[active=true]:text-honk-terminal-foreground"
                          onClick={() => onActiveTerminalChange(groupActiveTerminalId)}
                        >
                          {terminalGroup.terminalIds.length > 1
                            ? `Split ${groupIndex + 1}`
                            : `Terminal ${groupIndex + 1}`}
                        </button>
                      )}

                      <div
                        className={showGroupHeaders ? "ml-1 border-l border-border/60 pl-1.5" : ""}
                      >
                        {terminalGroup.terminalIds.map((terminalId) => {
                          const isActive = terminalId === resolvedActiveTerminalId;
                          const closeTerminalLabel = `Close ${
                            terminalLabelById.get(terminalId) ?? "terminal"
                          }${isActive && closeShortcutLabel ? ` (${closeShortcutLabel})` : ""}`;
                          return (
                            <div
                              key={terminalId}
                              data-active={isActive ? "true" : "false"}
                              className="group flex items-center gap-1 rounded px-1 py-0.5 text-detail text-honk-terminal-muted-foreground hover:bg-honk-terminal-hover-background hover:text-honk-terminal-foreground data-[active=true]:bg-honk-terminal-active-background data-[active=true]:text-honk-terminal-foreground"
                            >
                              {showGroupHeaders && (
                                <span className="text-caption text-muted-foreground/80">└</span>
                              )}
                              <button
                                type="button"
                                className="flex min-w-0 flex-1 items-center gap-1 text-left"
                                onClick={() => onActiveTerminalChange(terminalId)}
                              >
                                <IconConsoleSimple className="size-3 shrink-0" />
                                <span className="truncate">
                                  {terminalLabelById.get(terminalId) ?? "Terminal"}
                                </span>
                              </button>
                              {normalizedTerminalIds.length > 1 && (
                                <Popover>
                                  <PopoverTrigger
                                    openOnHover
                                    render={
                                      <button
                                        type="button"
                                        className="inline-flex size-3.5 items-center justify-center rounded text-xs font-medium leading-none text-honk-terminal-muted-foreground opacity-0 transition hover:bg-honk-terminal-hover-background hover:text-honk-terminal-foreground group-hover:opacity-100"
                                        onClick={() => onCloseTerminal(terminalId)}
                                        aria-label={closeTerminalLabel}
                                      />
                                    }
                                  >
                                    <IconCrossMediumDefault className="size-2.5" />
                                  </PopoverTrigger>
                                  <PopoverPopup
                                    tooltipStyle
                                    side="bottom"
                                    sideOffset={6}
                                    align="center"
                                    className="pointer-events-none select-none"
                                  >
                                    {closeTerminalLabel}
                                  </PopoverPopup>
                                </Popover>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </aside>
          )}
        </div>
      </div>
    </aside>
  );
}
