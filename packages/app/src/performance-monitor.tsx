import * as stylex from "@stylexjs/stylex";
import { Text, Tooltip } from "@honk/ui";
import { controlVars, spaceVars } from "@honk/ui/tokens.stylex";
import { useRouter } from "@tanstack/react-router";
import * as React from "react";

type ChromiumPerformance = Performance & {
  readonly memory?: {
    readonly usedJSHeapSize: number;
    readonly jsHeapSizeLimit: number;
  };
};

type EventTimingEntry = PerformanceEntry & {
  readonly interactionId?: number;
  readonly processingStart?: number;
};

type LayoutShiftEntry = PerformanceEntry & {
  readonly hadRecentInput: boolean;
  readonly value: number;
};

type PerformanceObserverOptions = PerformanceObserverInit & {
  readonly durationThreshold?: number;
};

type PerformanceSnapshot = {
  readonly cls: number | undefined;
  readonly delay: number | undefined;
  readonly fps: number | undefined;
  readonly frame: number | undefined;
  readonly heap: {
    readonly limit: number | undefined;
    readonly used: number | undefined;
  };
  readonly inp: number | undefined;
  readonly jank: number | undefined;
  readonly longTask: {
    readonly blocked: number | undefined;
    readonly count: number | undefined;
    readonly max: number | undefined;
  };
};

type NavigationSnapshot = {
  readonly duration: number | undefined;
  readonly pending: boolean;
};

type NavigationStore = {
  readonly getSnapshot: () => NavigationSnapshot;
  readonly subscribe: (listener: () => void) => () => void;
};

type MetricCellProps = {
  readonly isBad?: boolean;
  readonly isDim?: boolean;
  readonly label: string;
  readonly tip: string;
  readonly value: string;
};

const ROLLING_WINDOW_MS = 5_000;
const FRAME_SYNC_INTERVAL_MS = 250;
const METRIC_POLL_INTERVAL_MS = 1_000;
const EVENT_DURATION_THRESHOLD_MS = 16;
const JANK_FRAME_THRESHOLD_MS = 32;
const LONG_TASK_THRESHOLD_MS = 50;
const MAX_TRACKED_INTERACTIONS = 200;

const NAVIGATION_BAD_THRESHOLD_MS = 400;
const FPS_BAD_THRESHOLD = 50;
const FRAME_BAD_THRESHOLD_MS = 50;
const JANK_BAD_THRESHOLD = 8;
const LONG_TASK_BAD_THRESHOLD_MS = 200;
const INPUT_DELAY_BAD_THRESHOLD_MS = 100;
const INP_BAD_THRESHOLD_MS = 200;
const CLS_BAD_THRESHOLD = 0.1;
const HEAP_BAD_THRESHOLD = 0.8;

// The desktop window can shrink to 400px; stack each metric below this width so all nine still fit.
const COMPACT_MONITOR_MEDIA = "@media (max-width: 620px)";
const METRIC_COLUMNS = "repeat(9, minmax(0, 1fr))";

const EMPTY_PERFORMANCE_SNAPSHOT: PerformanceSnapshot = {
  cls: undefined,
  delay: undefined,
  fps: undefined,
  frame: undefined,
  heap: { limit: undefined, used: undefined },
  inp: undefined,
  jank: undefined,
  longTask: { blocked: undefined, count: undefined, max: undefined },
};

const EMPTY_NAVIGATION_SNAPSHOT: NavigationSnapshot = {
  duration: undefined,
  pending: false,
};

const styles = stylex.create({
  bar: {
    width: "100%",
    height: {
      default: controlVars["--honk-control-h-md"],
      [COMPACT_MONITOR_MEDIA]: controlVars["--honk-control-h-lg"],
    },
    flexShrink: 0,
    display: "grid",
    gridTemplateColumns: METRIC_COLUMNS,
    alignItems: "center",
    boxSizing: "border-box",
    paddingInline: spaceVars["--honk-space-panel-pad"],
    userSelect: "none",
  },
  cell: {
    minWidth: 0,
    display: "flex",
    flexDirection: {
      default: "row",
      [COMPACT_MONITOR_MEDIA]: "column",
    },
    alignItems: "center",
    justifyContent: "center",
    gap: {
      default: controlVars["--honk-control-gap"],
      [COMPACT_MONITOR_MEDIA]: 0,
    },
    overflow: "hidden",
  },
});

let performanceSnapshot = EMPTY_PERFORMANCE_SNAPSHOT;
let stopPerformanceMonitor: (() => void) | null = null;
const performanceListeners = new Set<() => void>();

function publishPerformance(patch: Partial<PerformanceSnapshot>): void {
  performanceSnapshot = { ...performanceSnapshot, ...patch };
  for (const listener of performanceListeners) listener();
}

function getPerformanceSnapshot(): PerformanceSnapshot {
  return performanceSnapshot;
}

function getPerformanceServerSnapshot(): PerformanceSnapshot {
  return EMPTY_PERFORMANCE_SNAPSHOT;
}

function trimWindow(
  entries: Array<{ readonly at: number; readonly duration: number }>,
  at: number,
) {
  while (entries[0] !== undefined && at - entries[0].at > ROLLING_WINDOW_MS) {
    entries.shift();
  }
}

function startPerformanceMonitor(): () => void {
  const observers: PerformanceObserver[] = [];
  const frames: Array<{ readonly at: number; readonly duration: number }> = [];
  const longTasks: Array<{ readonly at: number; readonly duration: number }> = [];
  const interactions = new Map<
    number | string,
    { readonly at: number; readonly delay: number; readonly duration: number }
  >();
  let hasLongTaskObserver = false;
  let intervalID: number | undefined;
  let animationFrameID = 0;
  let lastFrameAt = 0;
  let lastFrameSyncAt = 0;

  const syncFrames = (at: number): void => {
    trimWindow(frames, at);
    const total = frames.reduce((sum, entry) => sum + entry.duration, 0);
    const frame = frames.reduce((max, entry) => Math.max(max, entry.duration), 0);
    publishPerformance({
      fps: total > 0 ? (frames.length * 1_000) / total : undefined,
      frame: frame > 0 ? frame : undefined,
      jank: frames.filter((entry) => entry.duration > JANK_FRAME_THRESHOLD_MS).length,
    });
  };

  const syncLongTasks = (at = performance.now()): void => {
    if (!hasLongTaskObserver) return;
    trimWindow(longTasks, at);
    publishPerformance({
      longTask: {
        blocked: longTasks.reduce(
          (sum, entry) => sum + Math.max(0, entry.duration - LONG_TASK_THRESHOLD_MS),
          0,
        ),
        count: longTasks.length,
        max: longTasks.reduce((max, entry) => Math.max(max, entry.duration), 0),
      },
    });
  };

  const syncInteractions = (at = performance.now()): void => {
    for (const [key, entry] of interactions) {
      if (at - entry.at > ROLLING_WINDOW_MS) interactions.delete(key);
    }
    let delay = 0;
    let inp = 0;
    for (const entry of interactions.values()) {
      delay = Math.max(delay, entry.delay);
      inp = Math.max(inp, entry.duration);
    }
    publishPerformance({
      delay: delay > 0 ? delay : undefined,
      inp: inp > 0 ? inp : undefined,
    });
  };

  const syncHeap = (): void => {
    const memory = (performance as ChromiumPerformance).memory;
    if (memory === undefined) return;
    publishPerformance({
      heap: { limit: memory.jsHeapSizeLimit, used: memory.usedJSHeapSize },
    });
  };

  const resetRollingMetrics = (): void => {
    frames.length = 0;
    longTasks.length = 0;
    interactions.clear();
    lastFrameAt = 0;
    lastFrameSyncAt = 0;
    publishPerformance({
      delay: undefined,
      fps: undefined,
      frame: undefined,
      inp: undefined,
      jank: undefined,
      ...(hasLongTaskObserver
        ? { longTask: { blocked: 0, count: 0, max: 0 } }
        : { longTask: EMPTY_PERFORMANCE_SNAPSHOT.longTask }),
    });
  };

  const observe = (
    type: string,
    options: PerformanceObserverOptions,
    onEntries: (entries: PerformanceEntry[]) => void,
  ): boolean => {
    if (
      typeof PerformanceObserver === "undefined" ||
      !(PerformanceObserver.supportedEntryTypes ?? []).includes(type)
    ) {
      return false;
    }
    const observer = new PerformanceObserver((list) => {
      onEntries(list.getEntries());
    });
    try {
      observer.observe(options);
      observers.push(observer);
      return true;
    } catch {
      observer.disconnect();
      return false;
    }
  };

  if (
    observe("layout-shift", { buffered: true, type: "layout-shift" }, (entries) => {
      const shift = entries.reduce((sum, entry) => {
        const layoutShift = entry as LayoutShiftEntry;
        return layoutShift.hadRecentInput ? sum : sum + layoutShift.value;
      }, 0);
      if (shift > 0) publishPerformance({ cls: (performanceSnapshot.cls ?? 0) + shift });
    })
  ) {
    publishPerformance({ cls: 0 });
  }

  if (
    observe("longtask", { buffered: true, type: "longtask" }, (entries) => {
      const at = performance.now();
      longTasks.push(
        ...entries.map((entry) => ({ at: entry.startTime, duration: entry.duration })),
      );
      syncLongTasks(at);
    })
  ) {
    hasLongTaskObserver = true;
    publishPerformance({ longTask: { blocked: 0, count: 0, max: 0 } });
  }

  observe(
    "event",
    { buffered: true, durationThreshold: EVENT_DURATION_THRESHOLD_MS, type: "event" },
    (entries) => {
      for (const rawEntry of entries) {
        const entry = rawEntry as EventTimingEntry;
        if (entry.duration < EVENT_DURATION_THRESHOLD_MS) continue;
        const key =
          entry.interactionId !== undefined && entry.interactionId > 0
            ? entry.interactionId
            : `${entry.name}:${Math.round(entry.startTime)}`;
        const previous = interactions.get(key);
        const delay = Math.max(0, (entry.processingStart ?? entry.startTime) - entry.startTime);
        interactions.set(key, {
          at: entry.startTime,
          delay: Math.max(previous?.delay ?? 0, delay),
          duration: Math.max(previous?.duration ?? 0, entry.duration),
        });
        if (interactions.size > MAX_TRACKED_INTERACTIONS) {
          const oldest = interactions.keys().next().value;
          if (oldest !== undefined) interactions.delete(oldest);
        }
      }
      syncInteractions();
    },
  );

  const frameLoop = (at: number): void => {
    if (document.visibilityState !== "visible") {
      animationFrameID = 0;
      return;
    }
    if (lastFrameAt === 0) {
      lastFrameAt = at;
      animationFrameID = requestAnimationFrame(frameLoop);
      return;
    }
    frames.push({ at, duration: at - lastFrameAt });
    lastFrameAt = at;
    if (at - lastFrameSyncAt >= FRAME_SYNC_INTERVAL_MS) {
      lastFrameSyncAt = at;
      syncFrames(at);
    }
    animationFrameID = requestAnimationFrame(frameLoop);
  };

  const stopSampling = (): void => {
    if (animationFrameID !== 0) cancelAnimationFrame(animationFrameID);
    animationFrameID = 0;
    if (intervalID === undefined) return;
    clearInterval(intervalID);
    intervalID = undefined;
  };

  const startSampling = (): void => {
    if (document.visibilityState !== "visible") return;
    if (intervalID === undefined) {
      intervalID = window.setInterval(() => {
        syncLongTasks();
        syncInteractions();
        syncHeap();
      }, METRIC_POLL_INTERVAL_MS);
    }
    if (animationFrameID === 0) animationFrameID = requestAnimationFrame(frameLoop);
  };

  const handleVisibilityChange = (): void => {
    if (document.visibilityState !== "visible") {
      stopSampling();
      return;
    }
    resetRollingMetrics();
    startSampling();
  };

  syncHeap();
  startSampling();
  document.addEventListener("visibilitychange", handleVisibilityChange);

  return () => {
    stopSampling();
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    for (const observer of observers) observer.disconnect();
  };
}

function subscribePerformance(listener: () => void): () => void {
  performanceListeners.add(listener);
  if (performanceListeners.size === 1 && typeof window !== "undefined") {
    stopPerformanceMonitor = startPerformanceMonitor();
  }
  return () => {
    performanceListeners.delete(listener);
    if (performanceListeners.size === 0) {
      stopPerformanceMonitor?.();
      stopPerformanceMonitor = null;
    }
  };
}

function isSessionPath(pathname: string): boolean {
  return pathname.includes("/session/");
}

function createNavigationStore(router: ReturnType<typeof useRouter>): NavigationStore {
  let snapshot = EMPTY_NAVIGATION_SNAPSHOT;
  let startedAt = 0;
  let firstPaintFrame = 0;
  let secondPaintFrame = 0;
  let stopRouterSubscriptions: (() => void) | null = null;
  const listeners = new Set<() => void>();

  const publish = (next: NavigationSnapshot): void => {
    snapshot = next;
    for (const listener of listeners) listener();
  };

  const cancelPaintFrames = (): void => {
    if (firstPaintFrame !== 0) cancelAnimationFrame(firstPaintFrame);
    if (secondPaintFrame !== 0) cancelAnimationFrame(secondPaintFrame);
    firstPaintFrame = 0;
    secondPaintFrame = 0;
  };

  const startRouterSubscriptions = (): (() => void) => {
    const stopBeforeNavigate = router.subscribe("onBeforeNavigate", (event) => {
      const fromPath = event.fromLocation?.pathname ?? "";
      const toPath = event.toLocation.pathname;
      if (!(isSessionPath(fromPath) || isSessionPath(toPath))) return;
      cancelPaintFrames();
      startedAt = performance.now();
      publish({ duration: undefined, pending: true });
    });
    const stopResolved = router.subscribe("onResolved", (event) => {
      if (startedAt === 0) return;
      const fromPath = event.fromLocation?.pathname ?? "";
      const toPath = event.toLocation.pathname;
      if (!(isSessionPath(fromPath) || isSessionPath(toPath))) return;
      const transitionStartedAt = startedAt;
      startedAt = 0;
      cancelPaintFrames();
      firstPaintFrame = requestAnimationFrame(() => {
        firstPaintFrame = 0;
        secondPaintFrame = requestAnimationFrame(() => {
          secondPaintFrame = 0;
          publish({ duration: performance.now() - transitionStartedAt, pending: false });
        });
      });
    });
    return () => {
      stopBeforeNavigate();
      stopResolved();
      cancelPaintFrames();
    };
  };

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      if (listeners.size === 1) stopRouterSubscriptions = startRouterSubscriptions();
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          stopRouterSubscriptions?.();
          stopRouterSubscriptions = null;
        }
      };
    },
  };
}

function useNavigationSnapshot(): NavigationSnapshot {
  const router = useRouter();
  const storeRef = React.useRef<{
    readonly router: typeof router;
    readonly store: NavigationStore;
  } | null>(null);
  if (storeRef.current === null || storeRef.current.router !== router) {
    storeRef.current = { router, store: createNavigationStore(router) };
  }
  return React.useSyncExternalStore(
    storeRef.current.store.subscribe,
    storeRef.current.store.getSnapshot,
    () => EMPTY_NAVIGATION_SNAPSHOT,
  );
}

function formatMilliseconds(value: number | undefined, decimalPlaces = 0): string | undefined {
  if (value === undefined || Number.isNaN(value)) return undefined;
  return `${value.toFixed(decimalPlaces)}ms`;
}

function formatInteger(value: number | undefined): string | undefined {
  if (value === undefined || Number.isNaN(value)) return undefined;
  return `${Math.round(value)}`;
}

function formatMegabytes(value: number | undefined): string | undefined {
  if (value === undefined || Number.isNaN(value)) return undefined;
  const megabytes = value / 1_024 / 1_024;
  return `${megabytes >= 1_024 ? megabytes.toFixed(0) : megabytes.toFixed(1)}MB`;
}

function exceedsThreshold(value: number | undefined, threshold: number, isLowBad = false): boolean {
  if (value === undefined || Number.isNaN(value)) return false;
  return isLowBad ? value < threshold : value > threshold;
}

function MetricCell({ isBad, isDim, label, tip, value }: MetricCellProps): React.ReactElement {
  return (
    <Tooltip label={tip}>
      <div aria-label={`${label}: ${value}. ${tip}`} {...stylex.props(styles.cell)}>
        <Text size="xs" tone="faint" weight="semibold" family="mono" truncate>
          {label}
        </Text>
        <Text
          size="sm"
          tone={isBad ? "err" : isDim ? "faint" : "primary"}
          weight="semibold"
          family="mono"
          tabularNums
          truncate
        >
          {value}
        </Text>
      </div>
    </Tooltip>
  );
}

// Visible by default in DEV. Command menu can dismiss (unmount) or restore the footer bar.
let performanceMonitorVisible = true;
const visibilityListeners = new Set<() => void>();

function publishVisibility(visible: boolean): void {
  if (performanceMonitorVisible === visible) return;
  performanceMonitorVisible = visible;
  for (const listener of visibilityListeners) listener();
}

function subscribeVisibility(listener: () => void): () => void {
  visibilityListeners.add(listener);
  return () => {
    visibilityListeners.delete(listener);
  };
}

export function isPerformanceMonitorVisible(): boolean {
  return performanceMonitorVisible;
}

export function usePerformanceMonitorVisible(): boolean {
  return React.useSyncExternalStore(
    subscribeVisibility,
    isPerformanceMonitorVisible,
    () => true,
  );
}

export const performanceMonitorActions = {
  dismiss(): void {
    publishVisibility(false);
  },
  show(): void {
    publishVisibility(true);
  },
  toggle(): void {
    publishVisibility(!performanceMonitorVisible);
  },
};

function DevelopmentPerformanceMonitor(): React.ReactElement | null {
  const visible = usePerformanceMonitorVisible();
  if (!visible) return null;
  return <PerformanceMonitorBar />;
}

function PerformanceMonitorBar(): React.ReactElement {
  const metrics = React.useSyncExternalStore(
    subscribePerformance,
    getPerformanceSnapshot,
    getPerformanceServerSnapshot,
  );
  const navigation = useNavigationSnapshot();
  const unavailable = "N/A";
  const heapRatio =
    metrics.heap.limit === undefined || metrics.heap.limit === 0
      ? undefined
      : (metrics.heap.used ?? 0) / metrics.heap.limit;
  const heapValue = heapRatio === undefined ? unavailable : `${Math.round(heapRatio * 100)}%`;
  const longTaskValue =
    metrics.longTask.count === undefined
      ? unavailable
      : `${formatInteger(metrics.longTask.blocked) ?? unavailable}/${metrics.longTask.count}`;
  const navigationValue = navigation.pending
    ? "..."
    : (formatInteger(navigation.duration) ?? unavailable);

  return (
    <aside aria-label="Development performance diagnostics" {...stylex.props(styles.bar)}>
      <MetricCell
        label="NAV"
        tip="Last completed route transition touching a chat, measured from router start until the first paint after it settles."
        value={navigationValue}
        isBad={exceedsThreshold(navigation.duration, NAVIGATION_BAD_THRESHOLD_MS)}
        isDim={navigation.duration === undefined && !navigation.pending}
      />
      <MetricCell
        label="FPS"
        tip="Rolling frames per second over the last 5 seconds."
        value={formatInteger(metrics.fps) ?? unavailable}
        isBad={exceedsThreshold(metrics.fps, FPS_BAD_THRESHOLD, true)}
        isDim={metrics.fps === undefined}
      />
      <MetricCell
        label="FRAME"
        tip="Worst frame time over the last 5 seconds."
        value={formatInteger(metrics.frame) ?? unavailable}
        isBad={exceedsThreshold(metrics.frame, FRAME_BAD_THRESHOLD_MS)}
        isDim={metrics.frame === undefined}
      />
      <MetricCell
        label="JANK"
        tip="Frames over 32ms in the last 5 seconds."
        value={metrics.jank === undefined ? unavailable : `${metrics.jank}`}
        isBad={exceedsThreshold(metrics.jank, JANK_BAD_THRESHOLD)}
        isDim={metrics.jank === undefined}
      />
      <MetricCell
        label="LONG"
        tip={`Blocked time and long-task count in the last 5 seconds. Max task: ${
          formatMilliseconds(metrics.longTask.max) ?? unavailable
        }.`}
        value={longTaskValue}
        isBad={exceedsThreshold(metrics.longTask.blocked, LONG_TASK_BAD_THRESHOLD_MS)}
        isDim={metrics.longTask.count === undefined}
      />
      <MetricCell
        label="DELAY"
        tip="Worst observed input delay in the last 5 seconds."
        value={formatInteger(metrics.delay) ?? unavailable}
        isBad={exceedsThreshold(metrics.delay, INPUT_DELAY_BAD_THRESHOLD_MS)}
        isDim={metrics.delay === undefined}
      />
      <MetricCell
        label="INP"
        tip="Approximate interaction duration over the last 5 seconds. This is INP-like, not the official Web Vitals INP."
        value={formatInteger(metrics.inp) ?? unavailable}
        isBad={exceedsThreshold(metrics.inp, INP_BAD_THRESHOLD_MS)}
        isDim={metrics.inp === undefined}
      />
      <MetricCell
        label="CLS"
        tip="Cumulative layout shift for the current app lifetime."
        value={metrics.cls === undefined ? unavailable : metrics.cls.toFixed(2)}
        isBad={exceedsThreshold(metrics.cls, CLS_BAD_THRESHOLD)}
        isDim={metrics.cls === undefined}
      />
      <MetricCell
        label="MEM"
        tip={
          metrics.heap.used === undefined
            ? "Used JS heap versus heap limit. Chromium only."
            : `Used JS heap versus heap limit. ${
                formatMegabytes(metrics.heap.used) ?? unavailable
              } of ${formatMegabytes(metrics.heap.limit) ?? unavailable}.`
        }
        value={heapValue}
        isBad={exceedsThreshold(heapRatio, HEAP_BAD_THRESHOLD)}
        isDim={metrics.heap.used === undefined}
      />
    </aside>
  );
}

export { DevelopmentPerformanceMonitor };
