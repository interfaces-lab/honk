/// <reference types="vite/client" />

import type { DesktopBridge, LocalApi, HonkRuntimeApi } from "@honk/contracts";

interface ImportMetaEnv {
  readonly APP_VERSION: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface DesktopAuxEndpoint {
  readonly baseUrl: string;
  readonly bearer: string;
}

interface DesktopAuxBridge {
  readonly getAuxEndpoint?: () => Promise<DesktopAuxEndpoint | null>;
}

declare global {
  interface HTMLWebViewElement extends HTMLElement {
    canGoBack: () => boolean;
    canGoForward: () => boolean;
    capturePage?: (callback: (image: { toDataURL: () => string }) => void) => void;
    clearHistory?: () => void;
    getTitle?: () => string;
    getWebContentsId?: () => number;
    getURL: () => string;
    goBack: () => void;
    goForward: () => void;
    loadURL: (url: string) => Promise<void>;
    openDevTools?: () => void;
    reload: () => void;
    reloadIgnoringCache?: () => void;
  }

  interface Window {
    nativeApi?: LocalApi;
    desktopBridge?: DesktopBridge & DesktopAuxBridge;
    honkRuntime?: HonkRuntimeApi;
  }
}
