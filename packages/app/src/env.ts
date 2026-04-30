/**
 * True when running inside the Electron preload bridge, false in a regular browser.
 * The preload script sets window.nativeApi via contextBridge before any web-app
 * code executes, so this is reliable at module load time.
 */
export const isElectron =
  typeof window !== "undefined" &&
  (window.desktopBridge !== undefined || window.nativeApi !== undefined);

export function isElectronHost(): boolean {
  return isElectron;
}

export function applyHostMarkers() {
  if (typeof document === "undefined") return;
  if (isElectron) {
    document.documentElement.dataset.electron = "";
    return;
  }
  delete document.documentElement.dataset.electron;
}
