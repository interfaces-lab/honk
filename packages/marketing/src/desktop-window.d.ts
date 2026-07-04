import type { DesktopBridge, LocalApi } from "@honk/shared/desktop-api";

export {};

declare global {
  interface Window {
    desktopBridge?: DesktopBridge;
    nativeApi?: LocalApi;
    honkRuntime?: unknown;
  }
}
