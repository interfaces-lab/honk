import { type RefObject, type ReactNode, useRef, useState } from "react";

import { useMountEffect } from "~/hooks/use-mount-effect";
import { type SlowRpcAckRequest, useSlowRpcAckRequests } from "../rpc/request-latency-state";
import {
  getWsConnectionStatus,
  getWsConnectionUiState,
  setBrowserOnlineStatus,
  type WsConnectionStatus,
  type WsConnectionUiState,
  useWsConnectionStatus,
  WS_RECONNECT_MAX_ATTEMPTS,
} from "../rpc/ws-connection-state";
import { toastManager } from "~/app/toast";
import { getPrimaryEnvironmentConnection } from "../environments/runtime";

const FORCED_WS_RECONNECT_DEBOUNCE_MS = 5_000;
type WsAutoReconnectTrigger = "focus" | "online";
type WsReconnectRunner = (showFailureToast: boolean) => void;
type WsAutoReconnectRunner = (trigger: WsAutoReconnectTrigger) => void;
type ToastId = ReturnType<typeof toastManager.add>;
type ToastIdRef = RefObject<ToastId | null>;
type TimeoutIdRef = RefObject<number | null>;

function syncBrowserOnlineStatus() {
  setBrowserOnlineStatus(navigator.onLine);
}

const connectionTimeFormatter = new Intl.DateTimeFormat(undefined, {
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  month: "short",
  second: "2-digit",
});

export function shouldAutoReconnect(
  status: WsConnectionStatus,
  trigger: WsAutoReconnectTrigger,
): boolean {
  const uiState = getWsConnectionUiState(status);

  if (trigger === "online") {
    return (
      uiState === "offline" ||
      uiState === "reconnecting" ||
      uiState === "error" ||
      status.reconnectPhase === "exhausted"
    );
  }

  return (
    status.online &&
    status.hasConnected &&
    (uiState === "reconnecting" || status.reconnectPhase === "exhausted")
  );
}

export function shouldRestartStalledReconnect(
  status: WsConnectionStatus,
  expectedNextRetryAt: string,
): boolean {
  return (
    status.reconnectPhase === "waiting" &&
    status.nextRetryAt === expectedNextRetryAt &&
    status.online &&
    status.hasConnected
  );
}

function createWsConnectionStatusSyncKey(status: WsConnectionStatus, nowMs: number): string {
  return JSON.stringify([
    nowMs,
    status.attemptCount,
    status.closeCode,
    status.closeReason,
    status.connectedAt,
    status.disconnectedAt,
    status.hasConnected,
    status.lastError,
    status.lastErrorAt,
    status.nextRetryAt,
    status.online,
    status.phase,
    status.reconnectAttemptCount,
    status.reconnectMaxAttempts,
    status.reconnectPhase,
    status.socketUrl,
  ]);
}

function createReconnectCountdownClockKey(status: WsConnectionStatus): string {
  return JSON.stringify([status.reconnectPhase, status.nextRetryAt]);
}

function createStalledReconnectWatchdogKey(status: WsConnectionStatus): string {
  return JSON.stringify([
    status.hasConnected,
    status.nextRetryAt,
    status.online,
    status.reconnectAttemptCount,
    status.reconnectPhase,
  ]);
}

function createSlowRpcAckToastKey(
  slowRequests: ReadonlyArray<SlowRpcAckRequest>,
  status: WsConnectionStatus,
): string {
  return JSON.stringify([
    createWsConnectionStatusSyncKey(status, 0),
    slowRequests.map((request) => [request.requestId, request.thresholdMs]),
  ]);
}

export function WebSocketConnectionCoordinator() {
  const status = useWsConnectionStatus();
  const [nowMs, setNowMs] = useState(() => Date.now());
  const lastForcedReconnectAtRef = useRef(0);
  const toastIdRef = useRef<ReturnType<typeof toastManager.add> | null>(null);
  const toastResetTimerRef = useRef<number | null>(null);
  const previousUiStateRef = useRef<WsConnectionUiState>(getWsConnectionUiState(status));
  const previousDisconnectedAtRef = useRef<string | null>(status.disconnectedAt);

  const runReconnect = (showFailureToast: boolean) => {
    if (toastResetTimerRef.current !== null) {
      window.clearTimeout(toastResetTimerRef.current);
      toastResetTimerRef.current = null;
    }
    lastForcedReconnectAtRef.current = Date.now();
    void getPrimaryEnvironmentConnection()
      .reconnect()
      .catch((error) => {
        if (!showFailureToast) {
          console.warn("Automatic WebSocket reconnect failed", { error });
          return;
        }
        toastManager.add({
          type: "error",
          title: "Reconnect failed",
          description: error instanceof Error ? error.message : "Unable to restart the WebSocket.",
          data: {
            dismissAfterVisibleMs: 8_000,
            hideCopyButton: true,
          },
        });
      });
  };
  const triggerManualReconnect = () => {
    runReconnect(true);
  };
  const triggerAutoReconnect = (trigger: WsAutoReconnectTrigger) => {
    const currentStatus =
      trigger === "online" ? setBrowserOnlineStatus(true) : getWsConnectionStatus();

    if (!shouldAutoReconnect(currentStatus, trigger)) {
      return;
    }
    if (Date.now() - lastForcedReconnectAtRef.current < FORCED_WS_RECONNECT_DEBOUNCE_MS) {
      return;
    }

    runReconnect(false);
  };

  return (
    <>
      <BrowserConnectionListeners
        syncBrowserOnlineStatus={syncBrowserOnlineStatus}
        triggerAutoReconnect={triggerAutoReconnect}
      />
      <ReconnectCountdownClock
        key={createReconnectCountdownClockKey(status)}
        setNowMs={setNowMs}
        status={status}
      />
      <StalledReconnectWatchdog
        key={createStalledReconnectWatchdogKey(status)}
        runReconnect={runReconnect}
        status={status}
      />
      <WsConnectionToastSync
        key={createWsConnectionStatusSyncKey(status, nowMs)}
        nowMs={nowMs}
        previousDisconnectedAtRef={previousDisconnectedAtRef}
        previousUiStateRef={previousUiStateRef}
        status={status}
        toastIdRef={toastIdRef}
        toastResetTimerRef={toastResetTimerRef}
        triggerManualReconnect={triggerManualReconnect}
      />
      <WsConnectionToastResetCleanup toastResetTimerRef={toastResetTimerRef} />
    </>
  );
}

function BrowserConnectionListeners({
  syncBrowserOnlineStatus,
  triggerAutoReconnect,
}: {
  syncBrowserOnlineStatus: () => void;
  triggerAutoReconnect: WsAutoReconnectRunner;
}) {
  useMountEffect(() => {
    const handleOnline = () => {
      triggerAutoReconnect("online");
    };
    const handleFocus = () => {
      triggerAutoReconnect("focus");
    };

    syncBrowserOnlineStatus();
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", syncBrowserOnlineStatus);
    window.addEventListener("focus", handleFocus);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", syncBrowserOnlineStatus);
      window.removeEventListener("focus", handleFocus);
    };
  });

  return null;
}

function ReconnectCountdownClock({
  setNowMs,
  status,
}: {
  setNowMs: (nowMs: number) => void;
  status: WsConnectionStatus;
}) {
  useMountEffect(() => {
    if (status.reconnectPhase !== "waiting" || status.nextRetryAt === null) {
      return;
    }

    setNowMs(Date.now());
    const intervalId = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1_000);

    return () => {
      window.clearInterval(intervalId);
    };
  });

  return null;
}

function StalledReconnectWatchdog({
  runReconnect,
  status,
}: {
  runReconnect: WsReconnectRunner;
  status: WsConnectionStatus;
}) {
  useMountEffect(() => {
    if (
      status.reconnectPhase !== "waiting" ||
      status.nextRetryAt === null ||
      !status.online ||
      !status.hasConnected
    ) {
      return;
    }

    const nextRetryAt = status.nextRetryAt;
    const timeoutMs = Math.max(0, new Date(nextRetryAt).getTime() - Date.now()) + 1_500;
    const timeoutId = window.setTimeout(() => {
      const currentStatus = getWsConnectionStatus();
      if (!shouldRestartStalledReconnect(currentStatus, nextRetryAt)) {
        return;
      }

      runReconnect(false);
    }, timeoutMs);

    return () => {
      window.clearTimeout(timeoutId);
    };
  });

  return null;
}

function WsConnectionToastSync({
  nowMs,
  previousDisconnectedAtRef,
  previousUiStateRef,
  status,
  toastIdRef,
  toastResetTimerRef,
  triggerManualReconnect,
}: {
  nowMs: number;
  previousDisconnectedAtRef: RefObject<string | null>;
  previousUiStateRef: RefObject<WsConnectionUiState>;
  status: WsConnectionStatus;
  toastIdRef: ToastIdRef;
  toastResetTimerRef: TimeoutIdRef;
  triggerManualReconnect: () => void;
}) {
  useMountEffect(() => {
    const uiState = getWsConnectionUiState(status);
    const previousUiState = previousUiStateRef.current;
    const previousDisconnectedAt = previousDisconnectedAtRef.current;
    const shouldShowReconnectToast = status.hasConnected && uiState === "reconnecting";
    const shouldShowOfflineToast = uiState === "offline" && status.disconnectedAt !== null;
    const shouldShowExhaustedToast = status.hasConnected && status.reconnectPhase === "exhausted";

    if (
      toastResetTimerRef.current !== null &&
      (shouldShowReconnectToast || shouldShowOfflineToast || shouldShowExhaustedToast)
    ) {
      window.clearTimeout(toastResetTimerRef.current);
      toastResetTimerRef.current = null;
    }

    if (shouldShowReconnectToast || shouldShowOfflineToast || shouldShowExhaustedToast) {
      const reconnectAttempt = Math.max(
        1,
        Math.min(status.reconnectAttemptCount, WS_RECONNECT_MAX_ATTEMPTS),
      );
      const reconnectAttemptLabel = `Attempt ${reconnectAttempt}/${status.reconnectMaxAttempts}`;
      const reconnectCountdown =
        status.nextRetryAt === null
          ? null
          : `${Math.max(1, Math.ceil(Math.max(0, new Date(status.nextRetryAt).getTime() - nowMs) / 1000))}s`;
      const toastPayload = shouldShowOfflineToast
        ? {
            description: "WebSocket disconnected. Waiting for network.",
            timeout: 0,
            title: "Offline",
            type: "warning" as const,
            data: {
              hideCopyButton: true,
            },
          }
        : shouldShowExhaustedToast
          ? {
              actionProps: {
                children: "Retry",
                onClick: triggerManualReconnect,
              },
              description: "Retries exhausted trying to reconnect",
              timeout: 0,
              title: "Disconnected from Multi Server",
              type: "error" as const,
              data: {
                hideCopyButton: true,
              },
            }
          : {
              actionProps: {
                children: "Retry now",
                onClick: triggerManualReconnect,
              },
              description:
                reconnectCountdown === null
                  ? `Reconnecting... ${reconnectAttemptLabel}`
                  : `Reconnecting in ${reconnectCountdown}... ${reconnectAttemptLabel}`,
              timeout: 0,
              title: "Disconnected from Multi Server",
              type: "loading" as const,
              data: {
                hideCopyButton: true,
              },
            };

      if (toastIdRef.current) {
        toastManager.update(toastIdRef.current, toastPayload);
      } else {
        toastIdRef.current = toastManager.add(toastPayload);
      }
    } else if (toastIdRef.current) {
      toastManager.close(toastIdRef.current);
      toastIdRef.current = null;
    }

    if (
      uiState === "connected" &&
      (previousUiState === "offline" || previousUiState === "reconnecting") &&
      previousDisconnectedAt !== null
    ) {
      const disconnectedAtLabel = previousDisconnectedAt
        ? connectionTimeFormatter.format(new Date(previousDisconnectedAt))
        : null;
      const reconnectedAtLabel = status.connectedAt
        ? connectionTimeFormatter.format(new Date(status.connectedAt))
        : null;
      const description =
        disconnectedAtLabel && reconnectedAtLabel
          ? `Disconnected at ${disconnectedAtLabel} and reconnected at ${reconnectedAtLabel}.`
          : reconnectedAtLabel
            ? `Connection restored at ${reconnectedAtLabel}.`
            : "Connection restored.";
      const successToast = {
        description,
        title: "Reconnected to Multi Server",
        type: "success" as const,
        timeout: 0,
        data: {
          dismissAfterVisibleMs: 8_000,
          hideCopyButton: true,
        },
      };

      if (toastIdRef.current) {
        toastManager.update(toastIdRef.current, successToast);
      } else {
        toastIdRef.current = toastManager.add(successToast);
      }

      toastResetTimerRef.current = window.setTimeout(() => {
        toastIdRef.current = null;
        toastResetTimerRef.current = null;
      }, 8_250);
    }

    previousUiStateRef.current = uiState;
    previousDisconnectedAtRef.current = status.disconnectedAt;
  });

  return null;
}

function WsConnectionToastResetCleanup({
  toastResetTimerRef,
}: {
  toastResetTimerRef: TimeoutIdRef;
}) {
  useMountEffect(() => {
    return () => {
      if (toastResetTimerRef.current !== null) {
        window.clearTimeout(toastResetTimerRef.current);
      }
    };
  });

  return null;
}

export function SlowRpcAckToastCoordinator() {
  const slowRequests = useSlowRpcAckRequests();
  const status = useWsConnectionStatus();
  const toastIdRef = useRef<ReturnType<typeof toastManager.add> | null>(null);

  return (
    <SlowRpcAckToastSync
      key={createSlowRpcAckToastKey(slowRequests, status)}
      slowRequests={slowRequests}
      status={status}
      toastIdRef={toastIdRef}
    />
  );
}

function SlowRpcAckToastSync({
  slowRequests,
  status,
  toastIdRef,
}: {
  slowRequests: ReadonlyArray<SlowRpcAckRequest>;
  status: WsConnectionStatus;
  toastIdRef: ToastIdRef;
}) {
  useMountEffect(() => {
    if (getWsConnectionUiState(status) !== "connected") {
      if (toastIdRef.current) {
        toastManager.close(toastIdRef.current);
        toastIdRef.current = null;
      }
      return;
    }

    if (slowRequests.length === 0) {
      if (toastIdRef.current) {
        toastManager.close(toastIdRef.current);
        toastIdRef.current = null;
      }
      return;
    }

    const slowRequestCount = slowRequests.length;
    const slowRequestThresholdSeconds = Math.round((slowRequests[0]?.thresholdMs ?? 0) / 1000);
    const nextToast = {
      description: `${slowRequestCount} request${slowRequestCount === 1 ? "" : "s"} waiting longer than ${slowRequestThresholdSeconds}s.`,
      timeout: 0,
      title: "Some requests are slow",
      type: "warning" as const,
    };

    if (toastIdRef.current) {
      toastManager.update(toastIdRef.current, nextToast);
    } else {
      toastIdRef.current = toastManager.add(nextToast);
    }
  });

  return null;
}

export function WebSocketConnectionSurface({ children }: { readonly children: ReactNode }) {
  return children;
}
