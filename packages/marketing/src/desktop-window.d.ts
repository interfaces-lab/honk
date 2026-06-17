export {};

declare global {
  interface Window {
    desktopBridge?: unknown;
    nativeApi?: unknown;
    honkRuntime?: unknown;
  }
}
