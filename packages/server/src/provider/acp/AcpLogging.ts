import type { ProviderDriverKind, ThreadId } from "@multi/contracts";
import { Cause, Effect } from "effect";
import type * as EffectAcpProtocol from "effect-acp/protocol";

import type { EventNdjsonLogger } from "../EventNdjsonLogger.ts";
import type { AcpRequestLogEvent, AcpRuntimeOptions } from "./AcpRuntime.ts";

function writeNativeAcpLog(input: {
  readonly nativeEventLogger: EventNdjsonLogger | undefined;
  readonly provider: ProviderDriverKind;
  readonly threadId: ThreadId;
  readonly kind: "request" | "protocol";
  readonly payload: unknown;
}): Effect.Effect<void, never> {
  return Effect.gen(function* () {
    if (!input.nativeEventLogger) return;
    const observedAt = new Date().toISOString();
    yield* input.nativeEventLogger.write(
      {
        observedAt,
        event: {
          id: crypto.randomUUID(),
          kind: input.kind,
          provider: input.provider,
          createdAt: observedAt,
          threadId: input.threadId,
          payload: input.payload,
        },
      },
      input.threadId,
    );
  });
}

function formatRequestLogPayload(event: AcpRequestLogEvent) {
  return {
    method: event.method,
    status: event.status,
    request: event.payload,
    ...(event.result !== undefined ? { result: event.result } : {}),
    ...(event.cause !== undefined ? { cause: Cause.pretty(event.cause) } : {}),
  };
}

export function makeAcpNativeLoggers(input: {
  readonly nativeEventLogger: EventNdjsonLogger | undefined;
  readonly provider: ProviderDriverKind;
  readonly threadId: ThreadId;
}): Pick<AcpRuntimeOptions, "requestLogger" | "protocolLogging"> {
  return {
    requestLogger: (event) =>
      writeNativeAcpLog({
        nativeEventLogger: input.nativeEventLogger,
        provider: input.provider,
        threadId: input.threadId,
        kind: "request",
        payload: formatRequestLogPayload(event),
      }),
    ...(input.nativeEventLogger
      ? {
          protocolLogging: {
            logIncoming: true,
            logOutgoing: true,
            logger: (event: EffectAcpProtocol.AcpProtocolLogEvent) =>
              writeNativeAcpLog({
                nativeEventLogger: input.nativeEventLogger,
                provider: input.provider,
                threadId: input.threadId,
                kind: "protocol",
                payload: event,
              }),
          } satisfies NonNullable<AcpRuntimeOptions["protocolLogging"]>,
        }
      : {}),
  };
}
