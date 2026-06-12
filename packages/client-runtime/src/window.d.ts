import type { DesktopBridge, LocalApi, HonkRuntimeApi } from "@honk/contracts";

declare global {
  interface Window {
    nativeApi?: LocalApi;
    desktopBridge?: DesktopBridge;
    honkRuntime?: HonkRuntimeApi;
  }
}

export {};
