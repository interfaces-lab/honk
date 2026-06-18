import type { DesktopBridge, LocalApi, HonkRuntimeApi } from "@honk/contracts";

export {};

declare global {
  interface Window {
    desktopBridge?: DesktopBridge;
    nativeApi?: LocalApi;
    honkRuntime?: HonkRuntimeApi;
  }
}
