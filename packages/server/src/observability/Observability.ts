import path from "node:path";

import { configureMultiEvlog, configureMultiProcessMetadata, effectLogLevel } from "@multi/shared/logging";
import { makeLocalFileTracer, makeTraceSink } from "@multi/shared/observability";
import { Effect, Layer, References, Tracer } from "effect";
import { OtlpMetrics, OtlpSerialization, OtlpTracer } from "effect/unstable/observability";

import { ServerConfig } from "../config.ts";
import { ServerLoggerLive } from "../server-logger.ts";

const otlpSerializationLayer = OtlpSerialization.layerJson;
const SERVER_EVLOG_MAX_BYTES = 10 * 1024 * 1024;

export const ObservabilityLive = Layer.unwrap(
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    const processMetadata = configureMultiProcessMetadata("server");

    configureMultiEvlog({
      logsDir: path.join(config.logsDir, "evlog"),
      service: "multi-server",
      environment: config.mode,
      minLevel: effectLogLevel(config.logLevel),
      maxFiles: config.traceMaxFiles,
      maxSizePerFile: SERVER_EVLOG_MAX_BYTES,
    });

    const traceReferencesLayer = Layer.mergeAll(
      Layer.succeed(Tracer.MinimumTraceLevel, config.traceMinLevel),
      Layer.succeed(References.TracerTimingEnabled, config.traceTimingEnabled),
    );

    const tracerLayer = Layer.unwrap(
      Effect.gen(function* () {
        const sink = yield* makeTraceSink({
          filePath: config.serverTracePath,
          maxBytes: config.traceMaxBytes,
          maxFiles: config.traceMaxFiles,
          batchWindowMs: config.traceBatchWindowMs,
        });
        const delegate =
          config.otlpTracesUrl === undefined
            ? undefined
            : yield* OtlpTracer.make({
                url: config.otlpTracesUrl,
                exportInterval: `${config.otlpExportIntervalMs} millis`,
                resource: {
                  serviceName: config.otlpServiceName,
                  attributes: {
                    "service.runtime": "multi-server",
                    "service.mode": config.mode,
                    "multi.run_id": processMetadata.runId,
                    "multi.process_role": processMetadata.processRole,
                  },
                },
              });

        const tracer = yield* makeLocalFileTracer({
          filePath: config.serverTracePath,
          maxBytes: config.traceMaxBytes,
          maxFiles: config.traceMaxFiles,
          batchWindowMs: config.traceBatchWindowMs,
          sink,
          ...(delegate ? { delegate } : {}),
        });

        return Layer.succeed(Tracer.Tracer, tracer);
      }),
    ).pipe(Layer.provideMerge(otlpSerializationLayer));

    const metricsLayer =
      config.otlpMetricsUrl === undefined
        ? Layer.empty
        : OtlpMetrics.layer({
            url: config.otlpMetricsUrl,
            exportInterval: `${config.otlpExportIntervalMs} millis`,
            resource: {
              serviceName: config.otlpServiceName,
              attributes: {
                "service.runtime": "multi-server",
                "service.mode": config.mode,
                "multi.run_id": processMetadata.runId,
                "multi.process_role": processMetadata.processRole,
              },
            },
          }).pipe(Layer.provideMerge(otlpSerializationLayer));

    return Layer.mergeAll(
      ServerLoggerLive,
      traceReferencesLayer,
      tracerLayer,
      metricsLayer,
    );
  }),
);
