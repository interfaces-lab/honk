/// <reference types="vite/client" />

import type { DesktopBridge, LocalApi, MultiRuntimeApi } from "@multi/contracts";

interface ImportMetaEnv {
  readonly APP_VERSION: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare global {
  interface HTMLWebViewElement extends HTMLElement {
    canGoBack: () => boolean;
    canGoForward: () => boolean;
    getURL: () => string;
    goBack: () => void;
    goForward: () => void;
    loadURL: (url: string) => Promise<void>;
    reload: () => void;
  }

  interface Window {
    nativeApi?: LocalApi;
    desktopBridge?: DesktopBridge;
    multiRuntime?: MultiRuntimeApi;
  }
}
