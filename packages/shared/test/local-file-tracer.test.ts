import { makeLocalFileTracer, type EffectTraceRecord, type TraceSink } from "../src/observability";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

function memoryTraceSink(records: EffectTraceRecord[]): TraceSink {
  return {
    filePath: "memory.trace.ndjson",
    push(record) {
      records.push(record as EffectTraceRecord);
    },
    flush: Effect.void,
    close: () => Effect.void,
  };
}

describe("makeLocalFileTracer", () => {
  it("filters local trace records without disabling tracing", async () => {
    const records: EffectTraceRecord[] = [];
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const tracer = yield* makeLocalFileTracer({
            filePath: "memory.trace.ndjson",
            maxBytes: 1024,
            maxFiles: 1,
            batchWindowMs: 1,
            sink: memoryTraceSink(records),
            recordFilter: (record) => record.name !== "drop-me",
          });

          yield* Effect.succeed("dropped").pipe(
            Effect.withSpan("drop-me"),
            Effect.withTracer(tracer),
          );
          yield* Effect.succeed("kept").pipe(Effect.withSpan("keep-me"), Effect.withTracer(tracer));
        }),
      ),
    );

    expect(records.map((record) => record.name)).toEqual(["keep-me"]);
  });
});
