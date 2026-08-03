import type {
  DesktopRemoteHostDevice,
  DesktopRemoteHostState,
  DesktopServerExposureMode,
  DesktopServerExposureState,
} from "@honk/shared/desktop-api";
import { useEffect, useRef, useState } from "react";

import { useConnectDeviceSnapshot } from "./connect-device-controller";
import {
  canManageDesktopRemoteHost,
  configureDesktopServerExposure,
  getDesktopRemoteHostState,
  getDesktopServerExposureState,
  renameDesktopRemoteDevice,
  revokeDesktopRemoteDevice,
  setDesktopRemoteHostName,
} from "./desktop-bridge";

const CONNECTIONS_REFRESH_INTERVAL_MS = 3_000;
const CONNECTIONS_RESTART_TIMEOUT_MS = 15_000;

export function useConnectionsSettingsState() {
  const available = canManageDesktopRemoteHost();
  const pairing = useConnectDeviceSnapshot();
  const [host, setHost] = useState<DesktopRemoteHostState | null>(null);
  const [exposure, setExposure] = useState<DesktopServerExposureState | null>(null);
  const [hostName, setHostName] = useState("");
  const [publicUrl, setPublicUrl] = useState("");
  const [operation, setOperation] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const [revokeDevice, setRevokeDevice] = useState<DesktopRemoteHostDevice | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [refreshGeneration, setRefreshGeneration] = useState(0);
  const requestGeneration = useRef(0);
  const operationRef = useRef<string | null>(null);
  const hasLoaded = useRef(false);
  const hostNameDirty = useRef(false);
  const publicUrlDirty = useRef(false);
  const expectedRestart = useRef<{
    readonly endpointUrl: string | null;
    readonly expiresAt: number;
  } | null>(null);

  useEffect(() => {
    if (!available) return;
    const loadConnections = (initial: boolean): void => {
      if (!initial && operationRef.current !== null) return;
      const request = requestGeneration.current + 1;
      requestGeneration.current = request;
      void Promise.all([getDesktopRemoteHostState(), getDesktopServerExposureState()]).then(
        ([nextHost, nextExposure]) => {
          if (request !== requestGeneration.current) return;
          if (nextHost === null || nextExposure === null) {
            if (initial) {
              setLoadError("Connections are not available in this version of Honk.");
              setLoaded(true);
            }
            return;
          }

          const restart = expectedRestart.current;
          if (restart !== null && Date.now() < restart.expiresAt) {
            setHost({
              ...nextHost,
              status: "starting",
              publicUrl: restart.endpointUrl,
              errorMessage: null,
              serveEnableUrl: null,
            });
          } else if (restart !== null) {
            setHost({
              ...nextHost,
              status: "error",
              publicUrl: restart.endpointUrl,
              errorMessage: "Honk did not finish restarting device connections.",
              serveEnableUrl: null,
            });
            setError("Honk did not finish restarting device connections. Try the setting again.");
          } else {
            setHost(nextHost);
          }
          setExposure(nextExposure);
          setRefreshError(null);
          if (!hostNameDirty.current) setHostName(nextHost.name);
          if (!publicUrlDirty.current) setPublicUrl(nextExposure.customUrl ?? "");
          hasLoaded.current = true;
          setLoaded(true);
        },
        (cause: unknown) => {
          if (request !== requestGeneration.current) return;
          if (initial) {
            setLoadError(connectionSettingsError(cause, "Connections could not be loaded."));
            setLoaded(true);
            return;
          }
          setRefreshError(
            connectionSettingsError(cause, "Connection status could not be refreshed."),
          );
        },
      );
    };

    loadConnections(!hasLoaded.current);
    const interval = window.setInterval(
      () => loadConnections(false),
      CONNECTIONS_REFRESH_INTERVAL_MS,
    );
    return () => {
      window.clearInterval(interval);
      requestGeneration.current += 1;
    };
  }, [available, pairing.status, refreshGeneration]);

  const beginOperation = (name: string): number => {
    const request = requestGeneration.current + 1;
    requestGeneration.current = request;
    operationRef.current = name;
    setOperation(name);
    setError(null);
    return request;
  };

  const finishOperation = (request: number): void => {
    if (request !== requestGeneration.current) return;
    operationRef.current = null;
    setOperation(null);
  };

  const saveName = (): Promise<void> => {
    const normalized = hostName.trim();
    if (normalized.length === 0 || normalized === host?.name) return Promise.resolve();
    const request = beginOperation("name");
    return setDesktopRemoteHostName(normalized)
      .then((next) => {
        if (next === null) throw new Error("Computer naming is unavailable.");
        if (request !== requestGeneration.current) return;
        hostNameDirty.current = false;
        setHost(next);
        setHostName(next.name);
      })
      .catch((cause: unknown) => {
        if (request !== requestGeneration.current) return;
        setError(connectionSettingsError(cause, "The computer name could not be saved."));
      })
      .then(() => finishOperation(request));
  };

  const rename = (deviceID: string, label: string): Promise<boolean> => {
    const request = beginOperation(`rename:${deviceID}`);
    return renameDesktopRemoteDevice(deviceID, label)
      .then((next) => {
        if (next === null) throw new Error("Device naming is unavailable.");
        if (request !== requestGeneration.current) return false;
        setHost(next);
        return true;
      })
      .catch((cause: unknown) => {
        if (request === requestGeneration.current) {
          setError(connectionSettingsError(cause, "The device name could not be saved."));
        }
        return false;
      })
      .then((renamed) => {
        finishOperation(request);
        return renamed;
      });
  };

  const revoke = (): Promise<void> => {
    if (revokeDevice === null) return Promise.resolve();
    const device = revokeDevice;
    const request = beginOperation(`revoke:${device.id}`);
    setRevokeError(null);
    return revokeDesktopRemoteDevice(device.id)
      .then((next) => {
        if (next === null) throw new Error("Device access management is unavailable.");
        if (request !== requestGeneration.current) return;
        setHost(next);
        setRevokeDevice(null);
      })
      .catch((cause: unknown) => {
        if (request !== requestGeneration.current) return;
        setRevokeError(
          connectionSettingsError(cause, `Access for ${device.label} could not be removed.`),
        );
      })
      .then(() => finishOperation(request));
  };

  const configure = (
    mode: DesktopServerExposureMode,
    nextPublicUrl: string | null,
  ): Promise<void> => {
    const request = beginOperation(`configure:${mode}`);
    expectedRestart.current = null;
    setHost((current) =>
      current === null ? null : { ...current, status: "starting", errorMessage: null },
    );
    return configureDesktopServerExposure({ mode, publicUrl: nextPublicUrl })
      .then((change) => {
        if (change === null) throw new Error("Connection settings are unavailable.");
        if (request !== requestGeneration.current) return;
        expectedRestart.current = change.requiresRelaunch
          ? {
              endpointUrl: change.state.endpointUrl,
              expiresAt: Date.now() + CONNECTIONS_RESTART_TIMEOUT_MS,
            }
          : null;
        publicUrlDirty.current = false;
        setExposure(change.state);
        setPublicUrl(change.state.customUrl ?? "");
      })
      .catch((cause: unknown) => {
        if (request !== requestGeneration.current) return;
        const message = connectionSettingsError(cause, "Device connections could not be changed.");
        setHost((current) =>
          current === null ? null : { ...current, status: "error", errorMessage: message },
        );
        setError(message);
      })
      .then(() => {
        if (request !== requestGeneration.current) return;
        finishOperation(request);
        setRefreshGeneration((current) => current + 1);
      });
  };

  return {
    available,
    host,
    exposure,
    hostName,
    publicUrl,
    operation,
    error: error ?? host?.errorMessage ?? refreshError,
    loadError,
    revokeError,
    revokeDevice,
    loaded,
    activeDevices: (host?.devices.filter((device) => device.revokedAt === null) ?? []).toSorted(
      (left, right) => right.createdAt.localeCompare(left.createdAt),
    ),
    revokedDevices: (host?.devices.filter((device) => device.revokedAt !== null) ?? []).toSorted(
      (left, right) => (right.revokedAt ?? "").localeCompare(left.revokedAt ?? ""),
    ),
    isBusy: operation !== null || host?.status === "starting",
    setHostName(value: string): void {
      hostNameDirty.current = true;
      setHostName(value);
    },
    setPublicUrl(value: string): void {
      publicUrlDirty.current = true;
      setPublicUrl(value);
    },
    retryLoad(): void {
      setLoaded(false);
      setLoadError(null);
      setRefreshGeneration((current) => current + 1);
    },
    saveName,
    rename,
    requestRevoke(device: DesktopRemoteHostDevice): void {
      setRevokeError(null);
      setRevokeDevice(device);
    },
    dismissRevoke(): void {
      if (operation?.startsWith("revoke:") === true) return;
      setRevokeError(null);
      setRevokeDevice(null);
    },
    revoke,
    configure,
  } as const;
}

function connectionSettingsError(cause: unknown, fallback: string): string {
  return cause instanceof Error && cause.message.trim().length > 0 ? cause.message : fallback;
}
