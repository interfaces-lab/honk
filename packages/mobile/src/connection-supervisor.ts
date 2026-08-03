export const MOBILE_CONNECTION_RETRY_DELAYS_MS = [1_000, 2_000, 4_000, 8_000, 16_000] as const;

export type SupervisedConnectionPhase = "connecting" | "reconnecting" | "connected" | "blocked";

export interface SupervisedConnectionState {
  readonly phase: SupervisedConnectionPhase;
  readonly attempt: number;
  readonly error: string | null;
  readonly retryAt: number | null;
}

export interface MobileConnectionSupervisorOperations {
  readonly connect: (attempt: number, signal: AbortSignal) => Promise<void>;
  readonly classifyFailure: (error: unknown) => "blocked" | "transient" | "transient-reset";
  readonly errorMessage: (error: unknown) => string;
  readonly publish: (state: SupervisedConnectionState) => void;
  readonly now?: () => number;
  readonly wait?: (signal: AbortSignal, delayMs: number) => Promise<void>;
}

export async function superviseMobileConnection(
  signal: AbortSignal,
  operations: MobileConnectionSupervisorOperations,
): Promise<"blocked" | "connected" | "stopped"> {
  const now = operations.now ?? Date.now;
  const wait = operations.wait ?? waitForMobileConnectionRetry;
  let failureCount = 0;
  let lastError: string | null = null;

  while (!signal.aborted) {
    const attempt = failureCount + 1;
    operations.publish({
      phase: failureCount === 0 ? "connecting" : "reconnecting",
      attempt,
      error: lastError,
      retryAt: null,
    });
    const outcome = await operations.connect(attempt, signal).then(
      () => ({ _tag: "Connected" as const }),
      (error: unknown) => ({ _tag: "Failed" as const, error }),
    );
    if (signal.aborted) return "stopped";
    if (outcome._tag === "Connected") {
      operations.publish({
        phase: "connected",
        attempt,
        error: null,
        retryAt: null,
      });
      return "connected";
    }

    lastError = operations.errorMessage(outcome.error);
    const failure = operations.classifyFailure(outcome.error);
    if (failure === "blocked") {
      operations.publish({
        phase: "blocked",
        attempt,
        error: lastError,
        retryAt: null,
      });
      return "blocked";
    }

    const delayIndex = failure === "transient-reset" ? 0 : failureCount;
    const delayMs =
      MOBILE_CONNECTION_RETRY_DELAYS_MS[
        Math.min(delayIndex, MOBILE_CONNECTION_RETRY_DELAYS_MS.length - 1)
      ] ?? 16_000;
    failureCount = delayIndex + 1;
    operations.publish({
      phase: "reconnecting",
      attempt,
      error: lastError,
      retryAt: now() + delayMs,
    });
    await wait(signal, delayMs);
  }
  return "stopped";
}

export function waitForMobileConnectionRetry(signal: AbortSignal, delayMs: number): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timeout = setTimeout(done, delayMs);
    function done(): void {
      clearTimeout(timeout);
      signal.removeEventListener("abort", done);
      resolve();
    }
    signal.addEventListener("abort", done, { once: true });
  });
}

export const MOBILE_BACKGROUND_RECONNECT_AFTER_MS = 10_000;

export type MobileApplicationActiveWakeup =
  | "application-active-probe"
  | "application-active-reconnect";

export function mobileApplicationActiveWakeup(
  backgroundedAt: number | null,
  activeAt: number,
): MobileApplicationActiveWakeup {
  return shouldReconnectAfterBackground(backgroundedAt, activeAt)
    ? "application-active-reconnect"
    : "application-active-probe";
}

export function shouldReconnectAfterBackground(
  backgroundedAt: number | null,
  activeAt: number,
): boolean {
  return (
    backgroundedAt !== null && activeAt - backgroundedAt >= MOBILE_BACKGROUND_RECONNECT_AFTER_MS
  );
}
