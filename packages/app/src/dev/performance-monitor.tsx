import { useEffect, useState } from "react";

type ChromiumMemoryInfo = {
  readonly jsHeapSizeLimit: number;
  readonly totalJSHeapSize: number;
  readonly usedJSHeapSize: number;
};

type PerformanceWithMemory = Performance & {
  readonly memory?: ChromiumMemoryInfo;
};

type HeapSample = {
  readonly time: number;
  readonly usedBytes: number;
};

type MonitorSnapshot = {
  readonly fps: number;
  readonly memory: ChromiumMemoryInfo | null;
  readonly peakUsedBytes: number | null;
  readonly trendBytesPerMinute: number | null;
};

const INITIAL_SNAPSHOT: MonitorSnapshot = {
  fps: 0,
  memory: null,
  peakUsedBytes: null,
  trendBytesPerMinute: null,
};

const MEMORY_HISTORY_MS = 60_000;
const MEMORY_SAMPLE_INTERVAL_MS = 1_000;
const FPS_PUBLISH_INTERVAL_MS = 500;

export function DevPerformanceMonitor() {
  const [snapshot, setSnapshot] = useState<MonitorSnapshot>(INITIAL_SNAPSHOT);

  useEffect(() => {
    let animationFrame = 0;
    let frameCount = 0;
    let lastFpsPublishAt = window.performance.now();
    let lastMemorySampleAt = 0;
    let latestFps = 0;
    let peakUsedBytes: number | null = null;
    let memoryHistory: Array<HeapSample> = [];

    const tick = (time: number) => {
      frameCount += 1;

      const fpsElapsed = time - lastFpsPublishAt;
      const shouldPublishFps = fpsElapsed >= FPS_PUBLISH_INTERVAL_MS;
      const shouldSampleMemory = time - lastMemorySampleAt >= MEMORY_SAMPLE_INTERVAL_MS;

      if (shouldPublishFps) {
        latestFps = (frameCount * 1_000) / fpsElapsed;
        frameCount = 0;
        lastFpsPublishAt = time;
      }

      if (shouldSampleMemory) {
        lastMemorySampleAt = time;
      }

      if (shouldPublishFps || shouldSampleMemory) {
        const memory = shouldSampleMemory ? readMemoryInfo() : null;
        let trendBytesPerMinute: number | null = null;

        if (memory) {
          peakUsedBytes = Math.max(peakUsedBytes ?? 0, memory.usedJSHeapSize);
          memoryHistory = [
            ...memoryHistory.filter((sample) => time - sample.time <= MEMORY_HISTORY_MS),
            { time, usedBytes: memory.usedJSHeapSize },
          ];
          trendBytesPerMinute = calculateTrendBytesPerMinute(memoryHistory);
        }

        setSnapshot((current) => ({
          fps: latestFps,
          memory: memory ?? current.memory,
          peakUsedBytes,
          trendBytesPerMinute: memory ? trendBytesPerMinute : current.trendBytesPerMinute,
        }));
      }

      animationFrame = window.requestAnimationFrame(tick);
    };

    animationFrame = window.requestAnimationFrame(tick);

    return () => {
      window.cancelAnimationFrame(animationFrame);
    };
  }, []);

  const memory = snapshot.memory;
  const heapUsagePercent = memory
    ? Math.round((memory.usedJSHeapSize / memory.jsHeapSizeLimit) * 100)
    : null;

  return (
    <aside
      aria-label="Dev performance monitor"
      className="pointer-events-none fixed right-3 top-3 z-[2147483647] min-w-44 rounded-multi border border-multi-stroke-secondary bg-multi-bg-elevated/95 px-2.5 py-2 font-multi-mono text-[11px] leading-4 text-multi-fg-primary shadow-multi-popup backdrop-blur"
    >
      <div className="mb-1 flex items-center justify-between gap-4 font-multi text-caption text-multi-fg-secondary">
        <span>Dev Monitor</span>
        <span>{formatFps(snapshot.fps)}</span>
      </div>
      <MetricRow
        label="heap"
        value={
          memory
            ? `${formatBytes(memory.usedJSHeapSize)} / ${formatBytes(memory.totalJSHeapSize)}`
            : "unavailable"
        }
      />
      <MetricRow
        label="limit"
        value={
          memory && heapUsagePercent !== null
            ? `${formatBytes(memory.jsHeapSizeLimit)} ${heapUsagePercent}%`
            : "unavailable"
        }
      />
      <MetricRow
        label="peak"
        value={snapshot.peakUsedBytes !== null ? formatBytes(snapshot.peakUsedBytes) : "unavailable"}
      />
      <MetricRow
        label="trend"
        value={
          !memory
            ? "unavailable"
            : snapshot.trendBytesPerMinute !== null
            ? `${formatSignedBytes(snapshot.trendBytesPerMinute)}/min`
            : "warming up"
        }
      />
    </aside>
  );
}

function MetricRow(props: { readonly label: string; readonly value: string }) {
  return (
    <div className="grid grid-cols-[3.5rem_1fr] gap-3">
      <span className="text-multi-fg-tertiary">{props.label}</span>
      <span className="text-right tabular-nums">{props.value}</span>
    </div>
  );
}

function readMemoryInfo(): ChromiumMemoryInfo | null {
  return (window.performance as PerformanceWithMemory).memory ?? null;
}

function calculateTrendBytesPerMinute(history: ReadonlyArray<HeapSample>): number | null {
  const first = history[0];
  const last = history.at(-1);

  if (!first || !last || last.time === first.time) {
    return null;
  }

  const elapsedMinutes = (last.time - first.time) / 60_000;
  return (last.usedBytes - first.usedBytes) / elapsedMinutes;
}

function formatFps(fps: number): string {
  if (fps <= 0) {
    return "0 fps";
  }
  return `${Math.round(fps)} fps`;
}

function formatBytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatSignedBytes(bytes: number): string {
  const sign = bytes > 0 ? "+" : "";
  return `${sign}${formatBytes(bytes)}`;
}
