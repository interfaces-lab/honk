import { useSyncExternalStore } from "react";

const PAIRING_RESUME_KEY = "honk.desktop.resume-device-pairing";

const listeners = new Set<() => void>();
let isRequested = readResumeRequest();

function readResumeRequest(): boolean {
  return typeof window !== "undefined" && window.localStorage.getItem(PAIRING_RESUME_KEY) === "1";
}

function publish(next: boolean): void {
  if (isRequested === next) return;
  isRequested = next;
  for (const listener of listeners) listener();
}

const connectDeviceRequest = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getSnapshot: (): boolean => isRequested,
  actions: {
    open: (): void => publish(true),
    close: (): void => publish(false),
  },
  resume: {
    get: readResumeRequest,
    set(): void {
      window.localStorage.setItem(PAIRING_RESUME_KEY, "1");
    },
    clear(): void {
      window.localStorage.removeItem(PAIRING_RESUME_KEY);
    },
  },
} as const;

function useConnectDeviceRequest(): boolean {
  return useSyncExternalStore(
    (listener) => connectDeviceRequest.subscribe(listener),
    connectDeviceRequest.getSnapshot,
    () => false,
  );
}

export { connectDeviceRequest, useConnectDeviceRequest };
