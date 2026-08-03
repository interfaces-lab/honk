import type { EffectTraceRecord } from "@honk/shared/observability";
import { describe, expect, it } from "vitest";

import { shouldRecordDesktopLocalTrace } from "./desktop-observability";

function traceRecord(name: string, exit: EffectTraceRecord["exit"]): EffectTraceRecord {
  return {
    type: "effect-span",
    name,
    kind: "internal",
    traceId: "trace",
    spanId: "span",
    sampled: true,
    startTimeUnixNano: "1",
    endTimeUnixNano: "2",
    durationMs: 1,
    attributes: {},
    events: [],
    links: [],
    exit,
  };
}

describe("shouldRecordDesktopLocalTrace", () => {
  it("drops successful IPC spans from local trace files", () => {
    expect(
      shouldRecordDesktopLocalTrace(traceRecord("desktop.ipc.invoke", { _tag: "Success" })),
    ).toBe(false);
    expect(
      shouldRecordDesktopLocalTrace(traceRecord("desktop.ipc.method", { _tag: "Success" })),
    ).toBe(false);
    expect(
      shouldRecordDesktopLocalTrace(
        traceRecord("desktop.ipc.window.setVibrancy", { _tag: "Success" }),
      ),
    ).toBe(false);
  });

  it("keeps failed IPC spans and unrelated successful spans", () => {
    expect(
      shouldRecordDesktopLocalTrace(
        traceRecord("desktop.ipc.invoke", { _tag: "Failure", cause: "boom" }),
      ),
    ).toBe(true);
    expect(
      shouldRecordDesktopLocalTrace(traceRecord("desktop.window.createMain", { _tag: "Success" })),
    ).toBe(true);
  });
});
