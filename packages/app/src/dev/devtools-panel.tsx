import { useEffect, useRef } from "react";

import { RouterDevtoolsPanel } from "./router-devtools";

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

type ReportSample = {
  readonly relativeMs: number;
  readonly fps: number;
  readonly memory: ChromiumMemoryInfo | null;
  readonly peakUsedBytes: number | null;
  readonly trendBytesPerMinute: number | null;
};

type NavigatorWithDeviceMemory = Navigator & {
  readonly deviceMemory?: number;
};

type DevPerformanceMonitorApi = {
  readonly exportReport: () => void;
  readonly getSamples: () => ReadonlyArray<ReportSample>;
  readonly getSnapshot: () => MonitorSnapshot;
};

declare global {
  interface Window {
    __MULTI_DEV_PERFORMANCE_MONITOR__?: DevPerformanceMonitorApi;
  }
}

const INITIAL_SNAPSHOT: MonitorSnapshot = {
  fps: 0,
  memory: null,
  peakUsedBytes: null,
  trendBytesPerMinute: null,
};

const MONITOR_MAX_SAMPLES = 7_200;
const MEMORY_HISTORY_MS = 60_000;
const MEMORY_SAMPLE_INTERVAL_MS = 1_000;
const FPS_PUBLISH_INTERVAL_MS = 500;

export function DevDevtoolsPanel() {
  if (!import.meta.env.DEV) {
    return null;
  }

  return (
    <>
      <DevPerformanceMonitor />
      <RouterDevtoolsPanel />
    </>
  );
}

function DevPerformanceMonitor() {
  const snapshotRef = useRef<MonitorSnapshot>(INITIAL_SNAPSHOT);
  const startedAtRef = useRef(new Date().toISOString());
  const samplesRef = useRef<Array<ReportSample>>([]);

  useEffect(() => {
    const monitorApi: DevPerformanceMonitorApi = {
      exportReport: () =>
        exportMonitorReport(startedAtRef.current, snapshotRef.current, samplesRef.current),
      getSamples: () => [...samplesRef.current],
      getSnapshot: () => snapshotRef.current,
    };

    window.__MULTI_DEV_PERFORMANCE_MONITOR__ = monitorApi;

    return () => {
      if (window.__MULTI_DEV_PERFORMANCE_MONITOR__ === monitorApi) {
        delete window.__MULTI_DEV_PERFORMANCE_MONITOR__;
      }
    };
  }, []);

  useEffect(() => {
    let animationFrame = 0;
    let frameCount = 0;
    const startedAt = window.performance.now();
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

        if (shouldSampleMemory) {
          samplesRef.current = [
            ...samplesRef.current.slice(-(MONITOR_MAX_SAMPLES - 1)),
            {
              relativeMs: Math.round(time - startedAt),
              fps: latestFps,
              memory,
              peakUsedBytes,
              trendBytesPerMinute,
            },
          ];
        }

        snapshotRef.current = {
          fps: latestFps,
          memory: memory ?? snapshotRef.current.memory,
          peakUsedBytes,
          trendBytesPerMinute: memory
            ? trendBytesPerMinute
            : snapshotRef.current.trendBytesPerMinute,
        };
      }

      animationFrame = window.requestAnimationFrame(tick);
    };

    animationFrame = window.requestAnimationFrame(tick);

    return () => {
      window.cancelAnimationFrame(animationFrame);
    };
  }, []);

  return null;
}

function readMemoryInfo(): ChromiumMemoryInfo | null {
  return (window.performance as PerformanceWithMemory).memory ?? null;
}

function exportMonitorReport(
  startedAt: string,
  snapshot: MonitorSnapshot,
  samples: ReadonlyArray<ReportSample>,
): void {
  const exportedAt = new Date().toISOString();
  const report = {
    kind: "multi-dev-performance-monitor",
    version: 1,
    startedAt,
    exportedAt,
    location: window.location.href,
    userAgent: navigator.userAgent,
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemoryGb: readNavigatorDeviceMemory(),
    summary: snapshot,
    samples,
  };
  const blob = new Blob([JSON.stringify(report, null, 2)], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");

  anchor.href = url;
  anchor.download = `multi-dev-performance-${exportedAt.replaceAll(":", "-")}.json`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function readNavigatorDeviceMemory(): number | null {
  return (navigator as NavigatorWithDeviceMemory).deviceMemory ?? null;
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
