import type { DesktopBridge, LocalApi, MultiRuntimeApi } from "@multi/contracts";

declare global {
  interface Window {
    nativeApi?: LocalApi;
    desktopBridge?: DesktopBridge;
    multiRuntime?: MultiRuntimeApi;
  }
}

export {};
